import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createCloseService } from "./close-transaction";
import { createCloseActions } from "./close-actions-factory";


const id = (n: number) => `34000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-11-01T00:00:00Z");
const finance: LedgerAuthorization = {
  userId: id(1), userAccountId: id(1), idpSubject: "rates-finance",
  globalRole: "central_finance", roles: ["central_finance"],
  companyIds: [id(5)], companyGrants: [], employeeCompanyId: null,
};
let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let service: ReturnType<typeof createCloseService>;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  database = drizzle(pool, { schema });
  service = createCloseService(database, { now: () => now });
});
beforeEach(async()=>{
  await owner.query(`TRUNCATE audit_log,close_run,statement_line,statement,license_assignment,person,company,vendor_account,license_type,vendor,user_account CASCADE`);
  await owner.query(`INSERT INTO user_account (id,email,global_role,status,created_at) VALUES ($1,'rates@test.invalid','central_finance','active',$2)`, [id(1), now]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES ($1,'Manual','manual','none',false,false,false,false,'email','active',$2,$3)`, [id(2), now, id(1)]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES ($1,$2,'Pilot org','orchestration',0,'active',$3,$4)`, [id(3), id(2), now, id(1)]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by) VALUES ($1,$2,'Seat','seat','active',$3,$4)`, [id(4), id(2), now, id(1)]);
  await owner.query(`INSERT INTO company (id,name,code,type,status,created_at,created_by) VALUES ($1,'A','RATE-A','internal','active',$2,$3),($4,'B','RATE-B','internal','active',$2,$3)`, [id(5), now, id(1), id(6)]);

  await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by) VALUES ($1,'person@test.invalid','Transfer Person',$2,'active',$3,$4)`, [id(7), id(5), now, id(1)]);
  await owner.query(`INSERT INTO license_assignment (id,person_id,company_id,vendor_account_id,license_type_id,started_on,ended_on,end_reason,source_kind,note,created_at,created_by) VALUES
    ($1,$3,$4,$6,$7,'2026-01-01','2026-01-09','reallocated','manual','transfer',$8,$9),
    ($2,$3,$5,$6,$7,'2026-01-10',NULL,NULL,'manual','transfer',$8,$9)`, [id(8),id(9),id(7),id(5),id(6),id(3),id(4),now,id(1)]);
  await owner.query(`INSERT INTO rate_card (vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by) VALUES ($1,$2,62,'2026-01-01',$3,$4)`, [id(3),id(4),now,id(1)]);
});
afterAll(async () => { await pool?.end(); await owner?.end(); await fixture?.stop(); });


async function snapshot(period = "2026-01") {
  return (await owner.query(`SELECT s.company_id,s.opening_seats,s.total_usd,l.* FROM statement s LEFT JOIN statement_line l ON l.statement_id=s.id WHERE s.period=$1 ORDER BY s.company_id,l.period_from,l.id`, [period])).rows;
}
test("writes dated license-only statements and preserves byte-identical financial evidence on rerun", async () => {
  const run = await service.runClose(finance, { period: "2026-01", note: "First close" });
  expect(run.status).toBe("succeeded");
  expect(run.note).toBe("First close");
  expect(run.startedAt).toEqual(now); expect(run.finishedAt).toEqual(now);
  const first = await snapshot();
  expect(first.map(r => [r.company_id,r.person_id,r.period_from.toISOString().slice(0,10),r.period_to.toISOString().slice(0,10),r.license_days,r.amount_usd,r.opening_seats,r.total_usd])).toEqual([
    [id(5),id(7),"2026-01-01","2026-01-09",9,"18.00",1,"18.00"],
  ]);
  // The unpermitted company B is not included in this scoped run.
  expect((await owner.query(`SELECT company_id,close_run_id FROM statement`)).rows).toEqual([{ company_id:id(5),close_run_id:run.id }]);
  const again = await service.runClose(finance, { period: "2026-01" });
  expect(again.id).not.toBe(run.id);
  expect(await snapshot()).toEqual(first);
  expect((await owner.query(`SELECT close_run_id FROM statement`)).rows).toEqual([{close_run_id:again.id}]);
  const all = await service.runClose({ ...finance, companyIds:[id(5),id(6)] }, { period: "2026-01" });
  expect(all.status).toBe("succeeded");
  const both = await snapshot();
  expect(both.map(r => [r.company_id,r.license_days,r.amount_usd])).toEqual([[id(5),9,"18.00"],[id(6),22,"44.00"]]);
  expect(both.every(r => r.kind === "license")).toBe(true);
  expect(both.map(r=>r.opening_seats)).toEqual([1,0]);
  expect((await owner.query(`SELECT action,entity_type,actor_user_id,occurred_at,after->>'status' AS status FROM audit_log WHERE entity_id=$1 ORDER BY action`,[all.id])).rows).toEqual([{action:"close.started",entity_type:"CloseRun",actor_user_id:id(1),occurred_at:now,status:"running"},{action:"close.succeeded",entity_type:"CloseRun",actor_user_id:id(1),occurred_at:now,status:"succeeded"}]);
});

test("recalculates changed drafts, preserves finals and reconciled statements, and handles concurrent reruns", async () => {
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  await owner.query(`UPDATE statement SET status='final' WHERE company_id=$1`,[id(5)]);
  const final = (await owner.query(`SELECT * FROM statement WHERE company_id=$1`,[id(5)])).rows;
  const finalLines = (await snapshot()).filter(r => r.company_id===id(5));
  await owner.query(`UPDATE license_assignment SET ended_on='2026-01-20',end_reason='inactive' WHERE id=$1`,[id(9)]);
  const results = await Promise.all([1,2].map(() => service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"})));
  expect(results.map(r=>r.status)).toEqual(["succeeded","succeeded"]);
  expect((await owner.query(`SELECT * FROM statement WHERE company_id=$1`,[id(5)])).rows).toEqual(final);
  expect((await snapshot()).filter(r=>r.company_id===id(5))).toEqual(finalLines);
  expect((await snapshot()).find(r=>r.company_id===id(6))).toMatchObject({license_days:11,amount_usd:"22.00",total_usd:"22.00"});
  await owner.query(`UPDATE statement SET status='reconciled' WHERE company_id=$1`,[id(6)]);
  const before=await snapshot();
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  expect(await snapshot()).toEqual(before);
});

test("missing rate fails durably with note and no partial statements", async () => {
  await owner.query(`INSERT INTO license_assignment (person_id,company_id,vendor_account_id,license_type_id,started_on,ended_on,end_reason,source_kind,note,created_at,created_by) VALUES ($1,$2,$3,$4,'2025-12-01','2025-12-31','inactive','manual','historical',$5,$6)`,[id(7),id(5),id(3),id(4),now,id(1)]);
  const run=await service.runClose(finance,{period:"2025-12",note:"Missing rates"});
  expect(run.status).toBe("failed"); expect(run.note).toBe("Missing rates\nCLOSE_RATE_COVERAGE");
  expect(run.finishedAt).toEqual(now);
  expect((await service.latestRun(finance,"2025-12"))?.id).toBe(run.id);
  expect(await snapshot("2025-12")).toEqual([]);
  expect((await owner.query(`SELECT status FROM close_run WHERE id=$1`,[run.id])).rows).toEqual([{status:"failed"}]);
});

test("rejects wrong roles, malformed input and client company overrides before a run exists", async () => {
  const before=(await owner.query(`SELECT count(*)::int AS n FROM close_run`)).rows;
  for(const authorization of [null,{...finance,globalRole:null,roles:["company_finance"]} as LedgerAuthorization]) {
    await expect(service.runClose(authorization,{period:"2026-01"})).rejects.toThrow("CLOSE_ACCESS_FORBIDDEN");
    await expect(service.latestRun(authorization,"2026-01")).rejects.toThrow("CLOSE_ACCESS_FORBIDDEN");
  }
  for(const input of [{period:"2026-13"},{period:"2026-01",companyId:id(6)},{period:"2026-01",note:"x".repeat(2001)}]) await expect(service.runClose(finance,input)).rejects.toThrow();
  expect((await owner.query(`SELECT count(*)::int AS n FROM close_run`)).rows).toEqual(before);
});

test("final statement and line writes reject at the database boundary", async () => {
  await service.runClose(finance,{period:"2026-01"});
  await owner.query(`UPDATE statement SET status='final' WHERE company_id=$1`,[id(5)]);
  const row=(await snapshot())[0]!;
  await expect(pool.query(`UPDATE statement SET total_usd=0 WHERE id=$1`,[row.statement_id])).rejects.toMatchObject({code:"23514"});
  await expect(pool.query(`DELETE FROM statement_line WHERE id=$1`,[row.id])).rejects.toMatchObject({code:"42501"});
  await expect(pool.query(`SELECT public.clear_draft_license_lines($1,$2,$3)`,[row.statement_id,id(5),id(1)])).rejects.toMatchObject({code:"23514"});
  await expect(pool.query(`SELECT public.clear_draft_license_lines($1,$2,$3)`,[row.statement_id,id(5),id(99)])).rejects.toMatchObject({code:"42501"});
  await expect(owner.query(`UPDATE statement_line SET amount_usd=0 WHERE id=$1`,[row.id])).rejects.toMatchObject({code:"23514"});
  await expect(pool.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES ($1,'license',$2,0)`,[row.statement_id,id(3)])).rejects.toMatchObject({code:"23514"});
});


test("manual action authenticates, validates, commits and revalidates the close page", async () => {
  const paths:string[]=[];
  const actions=createCloseActions({database,now:()=>now,loadAuthorization:async()=>finance,revalidate:path=>{paths.push(path);}});
  const form=new FormData(); form.set("period","2026-02"); form.set("note","Manual close");
  const result=await actions.runClose({status:"idle"},form);
  expect(result).toMatchObject({status:"succeeded",durationMs:0}); expect(paths).toEqual(["/cierre"]);
  expect((await service.latestRun(finance,"2026-02"))?.id).toBe("runId" in result ? result.runId : "missing");
  expect((await service.latestRun(finance,"2026-02"))?.note).toBe("Manual close");
  expect(await service.latestRun({...finance,userAccountId:id(99),companyIds:[id(6)]},"2026-02")).toBeNull();
  form.set("period","2026-13");
  expect(await actions.runClose({status:"idle"},form)).toEqual({status:"error"}); expect(paths).toHaveLength(1);
  for(const loadAuthorization of [async()=>null,async()=>{throw new Error("session unavailable");}]) {
    const denied=createCloseActions({database,loadAuthorization,revalidate:path=>{paths.push(path);}});
    expect(await denied.runClose({status:"idle"},form)).toEqual({status:"error"});
  }
  expect(paths).toHaveLength(1);
});


test("retains signed adjustment lines while recomputing license-only draft totals",async()=>{
  await service.runClose(finance,{period:"2026-02"});
  const draft=(await owner.query(`SELECT id FROM statement WHERE period='2026-02' AND company_id=$1`,[id(5)])).rows[0];
  await owner.query(`INSERT INTO statement_line (statement_id,kind,vendor_account_id,amount_usd,note) VALUES ($1,'adjustment',$2,-1.25,'Prior correction')`,[draft.id,id(3)]);
  expect((await service.runClose(finance,{period:"2026-02"})).status).toBe("succeeded");
  expect((await owner.query(`SELECT total_usd FROM statement WHERE id=$1`,[draft.id])).rows).toEqual([{total_usd:"-1.25"}]);
  expect((await owner.query(`SELECT note,amount_usd FROM statement_line WHERE statement_id=$1 AND kind='adjustment'`,[draft.id])).rows).toEqual([{note:"Prior correction",amount_usd:"-1.25"}]);
});


test("draft deletion works and reconciled status cannot regress to final",async()=>{
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  await owner.query(`UPDATE statement SET status='reconciled' WHERE company_id=$1`,[id(6)]);
  await owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES ($1,$2,'2020-01','draft',0,0,$3,$3)`,[id(90),id(5),now]);
  await owner.query(`DELETE FROM statement WHERE id=$1`,[id(90)]);
  expect((await owner.query(`SELECT id FROM statement WHERE id=$1`,[id(90)])).rows).toEqual([]);
  await expect(owner.query(`UPDATE statement SET status='final' WHERE company_id=$1 AND period='2026-01'`,[id(6)])).rejects.toMatchObject({code:"23514"});
});


test("a persistence failure after replacing the first draft rolls back all companies and leaves a failed run",async()=>{
  await owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES ($1,$2,'2026-03','draft',1,10,$3,$3)`,[id(91),id(5),now]);
  await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES ($1,'license',$2,10)`,[id(91),id(3)]);
  const before=await snapshot("2026-03");
  await owner.query(`CREATE FUNCTION reject_us034_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.period='2026-03' AND NEW.company_id='${id(6)}'::uuid THEN RAISE EXCEPTION 'injected write fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_us034_write BEFORE UPDATE ON statement FOR EACH ROW EXECUTE FUNCTION reject_us034_write()`);
  try {
    const run=await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-03"});
    expect(run.status).toBe("failed");expect(run.note).toBe("CLOSE_FAILED");expect(await snapshot("2026-03")).toEqual(before);
    const action=createCloseActions({database,now:()=>now,loadAuthorization:async()=>({...finance,companyIds:[id(5),id(6)]}),revalidate:()=>undefined});
    const form=new FormData();form.set("period","2026-03");
    expect(await action.runClose({status:"idle"},form)).toMatchObject({status:"failed",durationMs:0});
  } finally {await owner.query(`DROP TRIGGER reject_us034_write ON statement; DROP FUNCTION reject_us034_write()`);}
});

test("a finalization that wins the row lock is preserved by the waiting close",async()=>{
  await owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES ($1,$2,'2026-03','draft',0,0,$3,$3)`,[id(91),id(5),now]);
  const locker=await fixture.connectAsOwner();const writer=await fixture.connectAsApp();
  try {
    await locker.query("BEGIN");await locker.query(`UPDATE statement SET status='final' WHERE id=$1`,[id(91)]);
    const before=(await locker.query(`SELECT * FROM statement WHERE id=$1`,[id(91)])).rows;
    const lockerPid=(await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("SET statement_timeout='10s'");
    let settled=false;
    const pending=createCloseService(drizzle(writer,{schema}),{now:()=>now}).runClose(finance,{period:"2026-03"}).finally(()=>{settled=true;});
    try {
      let blocked=false;
      while(!settled&&!blocked) blocked=(await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`,[lockerPid,writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
    } finally {await locker.query("COMMIT");}
    expect((await pending).status).toBe("succeeded");
    expect((await owner.query(`SELECT * FROM statement WHERE id=$1`,[id(91)])).rows).toEqual(before);
  } finally {await locker.query("ROLLBACK");await locker.end();await writer.end();}
});


test("closing another period preserves every prior statement and latest-run reads respect period and scoped consumption",async()=>{
  let clock=now.valueOf();const timed=createCloseService(database,{now:()=>new Date(clock+=1000)});
  const authorization={...finance,companyIds:[id(5),id(6)]};
  const jan=await timed.runClose(authorization,{period:"2026-01"});const before=await snapshot();
  const headers=(await owner.query(`SELECT * FROM statement WHERE period='2026-01' ORDER BY company_id`)).rows;
  const feb=await timed.runClose(authorization,{period:"2026-02"});
  expect(feb.durationMs).toBe(1000);expect(await snapshot()).toEqual(before);
  expect((await owner.query(`SELECT * FROM statement WHERE period='2026-01' ORDER BY company_id`)).rows).toEqual(headers);
  expect((await owner.query(`SELECT company_id,opening_seats,total_usd FROM statement WHERE period='2026-02' ORDER BY company_id`)).rows).toEqual([{company_id:id(5),opening_seats:0,total_usd:"0.00"},{company_id:id(6),opening_seats:1,total_usd:"62.00"}]);
  expect((await timed.latestRun(finance,"2026-01"))?.id).toBe(jan.id);
  expect((await timed.latestRun({...finance,userAccountId:id(99)},"2026-02"))?.id).toBe(feb.id);
  const febRows=await snapshot("2026-02");
  await timed.runClose(finance,{period:"2026-01"});
  expect(await snapshot("2026-02")).toEqual(febRows);
});

test("an excluded company's unpriced seats and an inactive company never enter the scoped close",async()=>{
  await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Unpriced org','orchestration',0,'active',$3,$4)`,[id(20),id(2),now,id(1)]);
  await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,'foreign@close.invalid','Foreign',$2,'active',$3,$4)`,[id(21),id(6),now,id(1)]);
  await owner.query(`INSERT INTO license_assignment(person_id,company_id,vendor_account_id,license_type_id,started_on,source_kind,note,created_at) VALUES($1,$2,$3,$4,'2026-01-01','manual','unpriced',$5)`,[id(21),id(6),id(20),id(4),now]);
  await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Inactive','CLOSE-INACTIVE','internal','inactive',$2,$3)`,[id(22),now,id(1)]);
  const run=await service.runClose({...finance,companyIds:[id(5),id(22)]},{period:"2026-01"});
  expect(run.status).toBe("succeeded");expect((await owner.query(`SELECT company_id,total_usd FROM statement`)).rows).toEqual([{company_id:id(5),total_usd:"18.00"}]);
  expect((await service.runClose({...finance,companyIds:[id(6)]},{period:"2026-01"})).status).toBe("failed");
});


test("default production clock persists trusted instants, and omitted notes remain null",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  try {
    const service=createCloseService(database);const run=await service.runClose(finance,{period:"2026-02"});
    expect(run.startedAt).toEqual(now);expect(run.finishedAt).toEqual(now);expect(run.durationMs).toBe(0);
    const action=createCloseActions({database,loadAuthorization:async()=>finance,revalidate:()=>undefined});
    const form=new FormData();form.set("period","2026-04");form.set("note","");
    expect((await action.runClose({status:"idle"},form)).status).toBe("succeeded");
    expect((await service.latestRun(finance,"2026-04"))?.note).toBeNull();
  } finally {vi.useRealTimers();}
});

test("close holds a period advisory lock while blocked on rates, and another period remains executable",async()=>{
  const locker=await fixture.connectAsOwner();const writer=await fixture.connectAsApp();
  try {
    await locker.query("BEGIN");await locker.query(`SELECT id FROM vendor_account WHERE id=$1 FOR UPDATE`,[id(3)]);
    const lockerPid=(await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("SET statement_timeout='10s'");let settled=false;
    const pending=createCloseService(drizzle(writer,{schema}),{now:()=>now}).runClose(finance,{period:"2026-01"}).finally(()=>{settled=true;});
    try {
      let blocked=false;
      while(!settled&&!blocked)blocked=(await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`,[lockerPid,writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
      expect((await owner.query(`SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted`,[writerPid])).rows[0].n).toBeGreaterThan(0);
      expect((await service.runClose(finance,{period:"2026-02"})).status).toBe("succeeded");
    } finally {await locker.query("ROLLBACK");await pending;}
  } finally {await locker.query("ROLLBACK");await locker.end();await writer.end();}
});
