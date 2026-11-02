import { once } from "node:events";
import pg from "pg";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import { createSmtpMailer } from "@smp/notifications";
let createDeferredJobHandlers:typeof import("./deferred.js").createDeferredJobHandlers;
let createScheduledCloseJob:typeof import("./close-schedule.js").createScheduledCloseJob;
import { createJobIdempotencyBoundary } from "../idempotency.js";
import { createJobIdempotencyKey } from "@smp/domain";
import { createAlertEvaluationJob } from "../alerts/evaluate-alerts.js";

let fixture:PostgresFixture, owner:pg.Client, smtp:SMTPServer, mailer:ReturnType<typeof createSmtpMailer>;
const messages:string[]=[];
const company="51000000-0000-4000-8000-000000000001";
const system="00000000-0000-0000-0000-000000000001";
const calendar={holidays:new Set(["2026-01-01","2026-04-03","2026-11-02","2026-11-03"])};
function handlers() { return createDeferredJobHandlers(calendar,{connectionString:fixture.appUrl,now:()=>new Date("2026-11-06T10:30:00Z"),sleep:async()=>{},transport:fetch,workerId:"us051",mailer}); }
async function precheck(at:string) {
  const date=new Date(at), key=createJobIdempotencyKey("closePrecheck",{at:date});
  const boundary=createJobIdempotencyBoundary(fixture.appUrl);
  try {return await boundary.execute({idempotencyKey:key,instanceId:"us051",jobName:"closePrecheck",now:()=>date,run:()=>handlers().closePrecheck({at:date,idempotencyKey:key,jobId:"us051-close",jobName:"closePrecheck"})});}
  finally {await boundary.close();}
}
beforeAll(async()=>{
  fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();
  smtp=new SMTPServer({authOptional:true,disabledCommands:["AUTH","STARTTLS"],onData(stream,_session,callback){let message="";stream.setEncoding("utf8");stream.on("data",chunk=>message+=chunk);stream.on("end",()=>{messages.push(message);callback();});}});
  smtp.listen(0,"127.0.0.1");await once(smtp.server,"listening");const address=smtp.server.address();if(!address||typeof address==="string")throw new Error("SMTP unavailable");mailer=createSmtpMailer(`smtp://127.0.0.1:${address.port}`);
});
beforeEach(async()=>{
  vi.resetModules();
  ({createDeferredJobHandlers}=await import("./deferred.js"));
  ({createScheduledCloseJob}=await import("./close-schedule.js"));
  await owner.query("TRUNCATE audit_log, close_run, statement, alert_event CASCADE");
  await owner.query("TRUNCATE pgboss.worker_job_execution");
  await owner.query("UPDATE alert_rule SET enabled=type IN ('close_missed','provisioning_failure')");
  await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Close A','CLS-A','internal','active','2026-01-01',$2) ON CONFLICT(id) DO NOTHING`,[company,system]);
  messages.length=0;
});
afterAll(async()=>{await new Promise<void>(resolve=>smtp.close(()=>resolve()));await owner?.end();await fixture?.stop();});

test("earlier no-ops cannot consume bd-3; holiday-aware scheduled close runs once and preserves system identity",async()=>{
  expect((await precheck("2026-11-04T10:30:00Z")).result).toEqual({processed:0,status:"succeeded"});
  expect((await precheck("2026-11-05T10:30:00Z")).result).toEqual({processed:0,status:"succeeded"});
  expect((await precheck("2026-11-06T10:30:00Z")).result).toEqual({processed:1,status:"succeeded"});
  expect((await precheck("2026-11-06T10:30:00Z")).replayed).toBe(true);
  expect((await owner.query("SELECT period,status,triggered_by FROM close_run")).rows).toEqual([{period:"2026-10",status:"succeeded",triggered_by:system}]);
  expect((await owner.query("SELECT company_id,period,status,total_usd FROM statement")).rows).toEqual([{company_id:company,period:"2026-10",status:"draft",total_usd:"0.00"}]);
  expect((await owner.query("SELECT status,global_role FROM user_account WHERE id=$1",[system])).rows).toEqual([{status:"disabled",global_role:null}]);
  expect((await owner.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND usename='ledger_app'",[fixture.databaseName])).rows).toEqual([{count:0}]);
});

test("watchdog works without ever calling the close handler, including weekends, holidays and UTC month edges",async()=>{
  const job=createAlertEvaluationJob({connectionString:fixture.appUrl,calendar,mailer,workerId:"watchdog-only"});
  try {
    expect((await job.run(new Date("2026-04-07T04:59:59Z"))).processed).toBe(0);
    expect((await job.run(new Date("2026-04-07T05:00:00Z"))).processed).toBe(1);
    expect((await job.run(new Date("2026-04-11T15:00:00Z"))).processed).toBe(0);
    expect((await owner.query(`SELECT subject_ref FROM alert_event e JOIN alert_rule r ON r.id=e.alert_rule_id WHERE r.type='close_missed'`)).rows).toEqual([{subject_ref:{period:"2026-03"}}]);
    expect(messages).toHaveLength(1);expect(messages[0]).toContain("2026-03");
    // UTC May 1 is still April in Guayaquil: April's missing March close remains the subject.
    await job.run(new Date("2026-05-01T03:00:00Z"));expect(messages).toHaveLength(1);
    await owner.query(`INSERT INTO close_run(period,status,started_at,created_at) VALUES('2026-04','running','2026-05-05','2026-05-05')`);
    await job.run(new Date("2026-05-09T15:00:00Z"));expect(messages).toHaveLength(1);
  } finally {await job.close();}
});

test("failed scheduled close is persisted, alerted by provisioning-failure routing and not mistaken for a missing run",async()=>{
  await owner.query(`INSERT INTO alert_rule(type,scope_kind,company_id,threshold,channel,enabled,created_at,created_by) VALUES('provisioning_failure','company',$1,'{"failures":1}','email',true,'2026-01-01',$2)`,[company,system]);
  await owner.query(`CREATE FUNCTION fail_us051_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'close write fault'; END $$; CREATE TRIGGER fail_us051_close BEFORE INSERT ON statement FOR EACH ROW EXECUTE FUNCTION fail_us051_close()`);
  try {
    await expect(precheck("2026-11-06T10:30:00Z")).rejects.toMatchObject({code:"CLOSE_FAILED"});
    expect((await owner.query("SELECT status,note FROM close_run")).rows).toEqual([{status:"failed",note:"CLOSE_FAILED"}]);
    const job=createAlertEvaluationJob({connectionString:fixture.appUrl,calendar,mailer,workerId:"failure-eval"});
    try {expect(await job.run(new Date("2026-11-07T15:07:00Z"))).toEqual({processed:1,status:"succeeded"});expect(await job.run(new Date("2026-11-07T15:22:00Z"))).toEqual({processed:0,status:"succeeded"});}finally{await job.close();}
    expect((await owner.query(`SELECT r.type,e.subject_ref FROM alert_event e JOIN alert_rule r ON r.id=e.alert_rule_id`)).rows).toEqual([{type:"provisioning_failure",subject_ref:{period:"2026-10"}}]);
    expect(messages).toHaveLength(1);expect(messages[0]).toContain("provisioning_failure");
  } finally {await owner.query("DROP TRIGGER fail_us051_close ON statement; DROP FUNCTION fail_us051_close()");await owner.query("DELETE FROM alert_rule WHERE company_id=$1",[company]);}
});

test("January schedule selects December and a UTC month boundary remains on the Ecuador calendar",async()=>{
  const job=createScheduledCloseJob({connectionString:fixture.appUrl,calendar,now:()=>new Date("2026-01-06T10:30:00Z")});
  try {
    expect(await job.run(new Date("2026-01-06T10:30:00Z"))).toEqual({processed:1,status:"succeeded"});
    expect((await owner.query("SELECT period FROM close_run")).rows).toEqual([{period:"2025-12"}]);
    expect(await job.run(new Date("2026-02-01T03:00:00Z"))).toEqual({processed:0,status:"succeeded"});
  } finally {await job.close();}
  expect((await owner.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND usename='ledger_app'",[fixture.databaseName])).rows).toEqual([{count:0}]);
});

test("watchdog fires on Saturday immediately after Friday bd-3 and ignores company-scoped rules",async()=>{
  await owner.query(`INSERT INTO alert_rule(type,scope_kind,company_id,threshold,enabled,created_at,created_by,channel) VALUES('close_missed','company',$1,'{"businessDays":0}',true,'2026-01-01',$2,'email')`,[company,system]);
  const job=createAlertEvaluationJob({connectionString:fixture.appUrl,calendar,mailer,workerId:"weekend-watchdog"});
  try {
    expect((await job.run(new Date("2026-07-04T04:59:59Z"))).processed).toBe(0);
    expect((await job.run(new Date("2026-07-04T05:00:00Z"))).processed).toBe(1);
    expect((await owner.query(`SELECT r.scope_kind,e.subject_ref FROM alert_event e JOIN alert_rule r ON r.id=e.alert_rule_id`)).rows).toEqual([{scope_kind:"global",subject_ref:{period:"2026-06"}}]);
  }finally{await job.close();await owner.query("DELETE FROM alert_rule WHERE company_id=$1",[company]);}
});
