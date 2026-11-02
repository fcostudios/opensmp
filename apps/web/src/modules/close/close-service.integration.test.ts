import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createLicenseCloseRepository } from "@smp/db/license-close";
import { computeLicenseClose, monthBounds } from "@smp/domain/close/license-close";
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

// US-035: these oracles kill omitted scope/confirmation/status/rate-validation guards.
test("single finalization confirms scope, locks consumed rates and retries without changing immutable bytes", async () => {
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  const rows=(await owner.query(`SELECT * FROM statement ORDER BY company_id`)).rows;
  const a=rows[0], b=rows[1];
  const command={period:"2026-01",statementId:a.id,confirmed:true};
  await expect(service.finalizeStatement(finance,{...command,confirmed:false})).rejects.toThrow();
  await expect(service.finalizeStatement(finance,{...command,statementId:b.id})).rejects.toThrow("STATEMENT_NOT_FOUND");
  await expect(service.finalizeStatement(finance,{...command,period:"2026-02"})).rejects.toThrow("STATEMENT_NOT_FOUND");
  const before=await snapshot();
  expect(await service.finalizeStatement(finance,command)).toEqual([a.id]);
  expect((await owner.query(`SELECT status FROM statement ORDER BY company_id`)).rows).toEqual([{status:"final"},{status:"draft"}]);
  expect(await snapshot()).toEqual(before);
  const headers=(await owner.query(`SELECT * FROM statement ORDER BY company_id`)).rows;
  expect(await service.finalizeStatement(finance,command)).toEqual([]);
  expect((await owner.query(`SELECT * FROM statement ORDER BY company_id`)).rows).toEqual(headers);
  expect((await owner.query(`SELECT action,company_id,before->>'status' AS before,after->>'status' AS after,occurred_at FROM audit_log WHERE entity_type='Statement'`)).rows).toEqual([{action:"statement.finalized",company_id:id(5),before:"draft",after:"final",occurred_at:now}]);
  expect((await owner.query(`SELECT public.rate_card_is_locked(r) AS locked FROM rate_card r`)).rows).toEqual([{locked:true}]);
  await expect(owner.query(`UPDATE rate_card SET monthly_rate_usd=99`)).rejects.toMatchObject({code:"23514"});
  await expect(owner.query(`UPDATE statement_line SET amount_usd=99 WHERE statement_id=$1`,[a.id])).rejects.toMatchObject({code:"23514"});
  // Later corrections go on the next draft; reruns preserve them and the final.
  await service.runClose(finance,{period:"2026-02"});
  const next=(await owner.query(`SELECT id FROM statement WHERE period='2026-02' AND company_id=$1`,[id(5)])).rows[0];
  await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd,note) VALUES($1,'adjustment',$2,-1.25,'January correction')`,[next.id,id(3)]);
  await service.runClose(finance,{period:"2026-02"});
  expect((await owner.query(`SELECT total_usd FROM statement WHERE id=$1`,[next.id])).rows).toEqual([{total_usd:"-1.25"}]);
  expect(await snapshot()).toEqual(before);
});

test("period finalization is atomic, company scoped, role gated and rejects stale draft rates", async () => {
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  const command={period:"2026-01",confirmed:true};
  for(const auth of [null,{...finance,globalRole:null,roles:["central_finance"]} as LedgerAuthorization]) {
    await expect(service.finalizeStatements(auth,command)).rejects.toThrow("CLOSE_ACCESS_FORBIDDEN");
    await expect(service.finalizeStatement(auth,{...command,statementId:id(99)})).rejects.toThrow("CLOSE_ACCESS_FORBIDDEN");
  }
  for(const input of [{...command,confirmed:false},{...command,period:"2026-13"},{...command,companyId:id(6)}]) await expect(service.finalizeStatements(finance,input)).rejects.toThrow();
  await owner.query(`UPDATE rate_card SET monthly_rate_usd=93`);
  await expect(service.finalizeStatements(finance,command)).rejects.toThrow("STATEMENT_RATES_CHANGED");
  expect((await owner.query(`SELECT DISTINCT status FROM statement`)).rows).toEqual([{status:"draft"}]);
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  expect((await service.finalizeStatements({...finance,globalRole:"group_admin"},command))).toHaveLength(1);
  expect((await service.statements(finance,"2026-01")).map(s=>[s.companyId,s.status])).toEqual([[id(5),"final"]]);
  expect((await service.statements({...finance,companyIds:[]},"2026-01"))).toEqual([]);
  expect((await owner.query(`SELECT company_id,status FROM statement ORDER BY company_id`)).rows).toEqual([{company_id:id(5),status:"final"},{company_id:id(6),status:"draft"}]);
  expect(await service.finalizeStatements(finance,command)).toEqual([]);
});

test("finalization actions require confirmation, authenticate and invalidate every consuming screen", async () => {
  await service.runClose(finance,{period:"2026-01"});
  const row=(await owner.query(`SELECT id FROM statement`)).rows[0];
  const paths:string[]=[];
  const actions=createCloseActions({database,now:()=>now,loadAuthorization:async()=>finance,revalidate:path=>{paths.push(path);}});
  const form=new FormData();form.set("period","2026-01");form.set("statementId",row.id);
  expect(await actions.finalizeStatement({status:"idle"},form)).toEqual({status:"error"});
  expect(paths).toEqual([]);
  expect(await actions.finalizeStatements({status:"idle"},form)).toEqual({status:"error"});
  form.set("confirmed","false");
  expect(await actions.finalizeStatements({status:"idle"},form)).toEqual({status:"error"});
  form.set("confirmed","true");
  expect(await actions.finalizeStatement({status:"idle"},form)).toEqual({status:"finalized",count:1});
  expect(paths).toEqual(["/cierre","/estados-de-cuenta","/tarifas"]);
  paths.length=0;
  expect(await actions.finalizeStatements({status:"idle"},form)).toEqual({status:"finalized",count:0});
  expect(paths).toEqual(["/cierre","/estados-de-cuenta","/tarifas"]);
  for(const loadAuthorization of [async()=>null,async()=>{throw new Error("session unavailable");},async()=>({...finance,globalRole:null} as LedgerAuthorization)]) {
    const denied=createCloseActions({database,loadAuthorization,revalidate:()=>{throw new Error("unexpected invalidation");}});
    expect(await denied.finalizeStatement({status:"idle"},form)).toEqual({status:"error"});
    expect(await denied.finalizeStatements({status:"idle"},form)).toEqual({status:"error"});
  }
});

test("bulk finalization rolls back every status and rate lock when the final audit fails",async()=>{
  const all={...finance,companyIds:[id(5),id(6)]};
  await service.runClose(all,{period:"2026-01"});
  const before=await snapshot();
  await owner.query(`CREATE FUNCTION reject_us035_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='statements.finalization_requested' THEN RAISE EXCEPTION 'injected audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_us035_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_us035_audit()`);
  try {
    await expect(service.finalizeStatements(all,{period:"2026-01",confirmed:true})).rejects.toThrow("injected audit fault");
    expect((await owner.query(`SELECT DISTINCT status FROM statement`)).rows).toEqual([{status:"draft"}]);
    expect((await owner.query(`SELECT public.rate_card_is_locked(r) AS locked FROM rate_card r`)).rows).toEqual([{locked:false}]);
    expect((await owner.query(`SELECT action FROM audit_log WHERE entity_type IN ('Statement','StatementFinalization')`)).rows).toEqual([]);
    expect(await snapshot()).toEqual(before);
  } finally {await owner.query(`DROP TRIGGER reject_us035_audit ON audit_log; DROP FUNCTION reject_us035_audit()`);}
  expect((await service.finalizeStatements(all,{period:"2026-01",confirmed:true}))).toHaveLength(2);
  await owner.query(`UPDATE statement SET status='reconciled' WHERE company_id=$1`,[id(5)]);
  const headers=(await owner.query(`SELECT * FROM statement ORDER BY id`)).rows;
  expect(await service.finalizeStatements(all,{period:"2026-01",confirmed:true})).toEqual([]);
  expect((await owner.query(`SELECT * FROM statement ORDER BY id`)).rows).toEqual(headers);
});

test("only consumed dated rates lock and another period remains draft",async()=>{
  await owner.query(`UPDATE rate_card SET effective_to='2026-01-31'`);
  await owner.query(`INSERT INTO rate_card(vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by) VALUES($1,$2,93,'2026-02-01',$3,$4)`,[id(3),id(4),now,id(1)]);
  await service.runClose(finance,{period:"2026-01"});
  await service.runClose(finance,{period:"2026-02"});
  expect(await service.finalizeStatements({...finance,companyIds:[]},{period:"2026-01",confirmed:true})).toEqual([]);
  expect((await service.finalizeStatements(finance,{period:"2026-01",confirmed:true}))).toHaveLength(1);
  expect((await owner.query(`SELECT effective_from::text,public.rate_card_is_locked(r) AS locked FROM rate_card r ORDER BY effective_from`)).rows).toEqual([{effective_from:"2026-01-01",locked:true},{effective_from:"2026-02-01",locked:false}]);
  expect((await service.statements(finance,"2026-02")).map(s=>s.status)).toEqual(["draft"]);
  await expect(service.statements(null,"2026-01")).rejects.toThrow("CLOSE_ACCESS_FORBIDDEN");
  await expect(service.statements(finance,"invalid")).rejects.toThrow();
});

test("finalization rejects missing or shortened rate coverage and incomplete license evidence",async()=>{
  await owner.query(`INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,'Other seat','seat','active',$3,$4)`,[id(40),id(2),now,id(1)]);
  await owner.query(`INSERT INTO rate_card(vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by) VALUES($1,$2,62,'2026-01-01',$3,$4)`,[id(3),id(40),now,id(1)]);
  for(const fault of [
    `UPDATE rate_card SET monthly_rate_usd=93 WHERE license_type_id='${id(4)}'`,
    `UPDATE rate_card SET effective_from='2026-01-02' WHERE license_type_id='${id(4)}'`,
    `UPDATE rate_card SET effective_to='2026-01-08' WHERE license_type_id='${id(4)}'`,
    `UPDATE statement_line SET period_from=NULL`,
    `UPDATE statement_line SET period_to=NULL`,
    `UPDATE statement_line SET license_type_id=NULL`,
  ]) {
    // Open-ended coverage must still reject a missing segment end date.
    await owner.query(`UPDATE rate_card SET monthly_rate_usd=62,effective_from='2026-01-01',effective_to=NULL WHERE license_type_id=$1`,[id(4)]);
    expect((await service.runClose(finance,{period:"2026-01"})).status).toBe("succeeded");
    await owner.query(fault);
    await expect(service.finalizeStatements(finance,{period:"2026-01",confirmed:true})).rejects.toThrow("STATEMENT_RATES_CHANGED");
    expect((await service.statements(finance,"2026-01")).map(s=>s.status)).toEqual(["draft"]);
  }
});

test("finalization shares the close period lock and a different period can proceed",async()=>{
  await service.runClose(finance,{period:"2026-03"});
  const locker=await fixture.connectAsOwner();const writer=await fixture.connectAsApp();
  try {
    await locker.query("BEGIN");await locker.query(`SELECT pg_advisory_xact_lock(hashtextextended('license-close:2026-03',0))`);
    const lockerPid=(await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("SET statement_timeout='10s'");
    let settled=false;
    const pending=createCloseService(drizzle(writer,{schema}),{now:()=>now}).finalizeStatements(finance,{period:"2026-03",confirmed:true}).finally(()=>{settled=true;});
    try {
      let blocked=false;
      while(!settled&&!blocked) blocked=(await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`,[lockerPid,writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
      expect((await service.runClose(finance,{period:"2026-04"})).status).toBe("succeeded");
    } finally {await locker.query("COMMIT");}
    expect(await pending).toHaveLength(1);
    expect((await service.statements(finance,"2026-03")).map(s=>s.status)).toEqual(["final"]);
    expect((await service.statements(finance,"2026-04")).map(s=>s.status)).toEqual(["draft"]);
  } finally {await locker.query("ROLLBACK");await locker.end();await writer.end();}
});

test("a rate edit that wins the account lock invalidates the waiting finalization",async()=>{
  await service.runClose(finance,{period:"2026-01"});
  const locker=await fixture.connectAsOwner();const writer=await fixture.connectAsApp();
  try {
    await locker.query("BEGIN");await locker.query(`UPDATE rate_card SET monthly_rate_usd=93 WHERE license_type_id=$1`,[id(4)]);
    const lockerPid=(await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("SET statement_timeout='10s'");
    let settled=false;
    const pending=createCloseService(drizzle(writer,{schema}),{now:()=>now}).finalizeStatements(finance,{period:"2026-01",confirmed:true}).then(()=>"unexpected success",error=>error.message).finally(()=>{settled=true;});
    try {
      let blocked=false;
      while(!settled&&!blocked) blocked=(await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`,[lockerPid,writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
    } finally {await locker.query("COMMIT");}
    expect(await pending).toBe("STATEMENT_RATES_CHANGED");
    expect((await service.statements(finance,"2026-01")).map(s=>s.status)).toEqual(["draft"]);
    expect((await owner.query(`SELECT public.rate_card_is_locked(r) AS locked FROM rate_card r`)).rows).toEqual([{locked:false}]);
  } finally {await locker.query("ROLLBACK");await locker.end();await writer.end();}
});


test("inclusive rate end dates can finalize, and another consumed account cannot mask a stale rate",async()=>{
  await owner.query(`UPDATE rate_card SET effective_to='2026-01-09'`);
  expect((await service.runClose(finance,{period:"2026-01"})).status).toBe("succeeded");
  expect(await service.finalizeStatements(finance,{period:"2026-01",confirmed:true})).toHaveLength(1);
  // Next-period drafts consuming two accounts must each match their own rate.
  await owner.query(`INSERT INTO rate_card(vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by) VALUES($1,$2,62,'2026-02-01',$3,$4)`,[id(3),id(4),now,id(1)]);
  await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Second account','orchestration',0,'active',$3,$4)`,[id(50),id(2),now,id(1)]);
  await owner.query(`INSERT INTO rate_card(vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by) VALUES($1,$2,62,'2026-02-01',$3,$4)`,[id(50),id(4),now,id(1)]);
  await service.runClose({...finance,companyIds:[id(6)]},{period:"2026-02"});
  await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,license_type_id,period_from,period_to,rate_usd,amount_usd) SELECT id,'license',$1,$2,'2026-02-01','2026-02-28',62,62 FROM statement WHERE period='2026-02' AND company_id=$3`,[id(50),id(4),id(6)]);
  await owner.query(`UPDATE rate_card SET monthly_rate_usd=93 WHERE vendor_account_id=$1 AND effective_from='2026-02-01'`,[id(3)]);
  await expect(service.finalizeStatements({...finance,companyIds:[id(6)]},{period:"2026-02",confirmed:true})).rejects.toThrow("STATEMENT_RATES_CHANGED");
  expect((await service.statements(finance,"2026-02"))).toEqual([]);
});

test("each finalization command records its actor, scope, time and stable period audit identity",async()=>{
  const commandIds=new Map<string,string>();
  for(const period of ["2026-01","2026-02"]) {
    await service.runClose({...finance,companyIds:[id(5),id(6)]},{period});
    const rows=(await owner.query(`SELECT id FROM statement WHERE period=$1 ORDER BY company_id`,[period])).rows;
    expect(await service.finalizeStatement(finance,{period,statementId:rows[0].id,confirmed:true})).toEqual([rows[0].id]);
    expect(await service.finalizeStatements({...finance,companyIds:[id(6)]},{period,confirmed:true})).toEqual([rows[1].id]);
    const audits=(await owner.query(`SELECT action,entity_type,entity_id,actor_user_id,company_id,before,after,occurred_at FROM audit_log WHERE entity_type='StatementFinalization' ORDER BY occurred_at,id`)).rows;
    const current=audits.filter(r=>r.after.statementIds.includes(rows[0].id)||r.after.statementIds.includes(rows[1].id));
    expect(current).toHaveLength(2);
    expect(new Set(current.map(r=>r.entity_id)).size).toBe(1);
    for(const row of rows) expect(current.find(r=>r.after.statementIds.includes(row.id))).toMatchObject({action:"statements.finalization_requested",entity_type:"StatementFinalization",actor_user_id:id(1),company_id:null,before:null,after:{statementIds:[row.id]},occurred_at:now});
    commandIds.set(period,current[0].entity_id);
  }
  expect(commandIds.get("2026-01")).not.toBe(commandIds.get("2026-02"));
});

test("finance sees scheduled failures without statements and sees a committed running record while close waits",async()=>{
  // A failed scheduled run has no statement through which to discover it.
  await owner.query(`INSERT INTO user_account(id,email,status,created_at) VALUES('00000000-0000-0000-0000-000000000001','system@ledger.invalid','disabled',$1)`,[now]);
  await owner.query(`INSERT INTO close_run(period,status,started_at,finished_at,triggered_by,created_at,note) VALUES('2026-10','failed',$1,$1,'00000000-0000-0000-0000-000000000001',$1,'CLOSE_FAILED')`,[now]);
  expect(await service.latestRun(finance,"2026-10")).toMatchObject({status:"failed",note:"CLOSE_FAILED",triggeredByName:"system@ledger.invalid"});
  expect(await service.latestRun({...finance,globalRole:null},"2026-10").catch(e=>e.message)).toBe("CLOSE_ACCESS_FORBIDDEN");
  const locker=await fixture.connectAsOwner(), writer=await fixture.connectAsApp();
  try {
    await locker.query("BEGIN");await locker.query(`SELECT pg_advisory_xact_lock(hashtextextended('license-close:2026-09',0))`);
    const lockerPid=(await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("SET statement_timeout='10s'");
    let settled=false;
    const pending=createLicenseCloseRepository(drizzle(writer,{schema}),{computeLicenseClose,monthBounds}).runClose(finance,{period:"2026-09",note:null},()=>now).finally(()=>{settled=true;});
    try {
      let blocked=false;
      while(!settled&&!blocked) blocked=(await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`,[lockerPid,writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
      expect(await service.latestRun(finance,"2026-09")).toMatchObject({status:"running",finishedAt:null,triggeredByName:"rates@test.invalid"});
    } finally {await locker.query("COMMIT");await pending;}
  } finally {await locker.end();await writer.end();}
});

test("workbench totals and counts stay period and company scoped",async()=>{
  await service.runClose({...finance,companyIds:[id(5),id(6)]},{period:"2026-01"});
  expect(await service.summary(finance,"2026-01")).toEqual({generated:1,drafts:1,finals:0,totalUsd:"18.00",companies:1});
  expect(await service.summary({...finance,companyIds:[id(6)]},"2026-01")).toEqual({generated:1,drafts:1,finals:0,totalUsd:"44.00",companies:1});
  expect(await service.summary(finance,"2026-02")).toEqual({generated:0,drafts:0,finals:0,totalUsd:"0.00",companies:1});
});
