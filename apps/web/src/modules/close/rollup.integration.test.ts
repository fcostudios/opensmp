import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import fc from "fast-check";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createCloseService } from "./close-transaction";
import { createStatementRepository } from "../statements/repository";

const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-11-01T12:00:00Z");
const finance: LedgerAuthorization = { userId:id(1),userAccountId:id(1),idpSubject:"statements-finance",globalRole:"central_finance",roles:["central_finance"],companyIds:[2,3,4,5,6].map(id),companyGrants:[],employeeCompanyId:null };
const own: LedgerAuthorization = {...finance,globalRole:null,roles:["company_finance","viewer"],companyIds:[id(2),id(3)],companyGrants:[{companyId:id(2),role:"finance"},{companyId:id(3),role:"viewer"}]};
let fixture: PostgresFixture; let owner: pg.Client; let pool: pg.Pool;
let repository: ReturnType<typeof createStatementRepository>;
let close: ReturnType<typeof createCloseService>;
beforeAll(async()=>{
 fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();pool=new pg.Pool({connectionString:fixture.appUrl});
 const database=drizzle(pool,{schema});repository=createStatementRepository(database);let tick=0;close=createCloseService(database,{now:()=>new Date(now.valueOf()+1000*tick++)});
 await owner.query(`INSERT INTO user_account(id,email,global_role,status,created_at) VALUES($1,'finance@statements.invalid','central_finance','active',$2)`,[id(1),now]);
 for(let n=2;n<=6;n++)await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,$2,$3,'internal','active',$4,$5)`,[id(n),`Pilot ${n}`,`P${n}`,now,id(1)]);
 await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Manual','manual','none',false,false,false,false,'email','active',$2,$3)`,[id(10),now,id(1)]);
 await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Seats','orchestration',0,'active',$3,$4)`,[id(11),id(10),now,id(1)]);
 await owner.query(`INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,'Seat','seat','active',$3,$4)`,[id(12),id(10),now,id(1)]);
 await owner.query(`INSERT INTO rate_card(vendor_account_id,license_type_id,monthly_rate_usd,effective_from,effective_to,created_at,created_by) VALUES($1,$2,62,'2026-01-01','2026-01-15',$3,$4),($1,$2,62,'2026-01-16',NULL,$3,$4)`,[id(11),id(12),now,id(1)]);
 await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,'person@statements.invalid','Pilot Person',$2,'active',$3,$4)`,[id(13),id(2),now,id(1)]);
 await owner.query(`INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,ended_on,end_reason,source_kind,note,created_at,created_by) VALUES($1,$2,$3,$4,$5,'2025-12-01','2026-01-09','inactive','manual','opening',$6,$7),($8,$2,$3,$4,$5,'2026-01-10','2026-01-31','inactive','manual','joined',$6,$7)`,[id(14),id(13),id(2),id(11),id(12),now,id(1),id(15)]);
});
beforeEach(async()=>{await owner.query("TRUNCATE reconciliation_variance_line,reconciliation,statement_line,statement,close_run,audit_log CASCADE");await owner.query(`UPDATE license_assignment SET started_on='2026-01-10',ended_on='2026-01-31' WHERE id=$1`,[id(15)]);await close.runClose(finance,{period:"2026-01"});});
afterAll(async()=>{await pool?.end();await owner?.end();await fixture?.stop();});


import { createRollupService } from "./rollup-transaction";
import { createReconciliationService } from "./reconciliation-transaction";
const service = () => createRollupService(drizzle(pool,{schema}),()=>now);
// Wrong period/scope, duplicated header totals, float rounding and stale snapshots are the targeted faults.
test("exports five pilot headers once, exact USD and scoped audit; empty periods remain empty",async()=>{
 const download=await service().exportRollupCsv(finance,"2026-01");
 expect(download.filename).toBe("rollup-2026-01.csv");
 expect(download.csv).toBe('Company,Period,Total (USD)\r\nP2 · Pilot 2,2026-01,62.00\r\nP3 · Pilot 3,2026-01,0.00\r\nP4 · Pilot 4,2026-01,0.00\r\nP5 · Pilot 5,2026-01,0.00\r\nP6 · Pilot 6,2026-01,0.00\r\n');
 const audit=(await owner.query("SELECT action,entity_type,company_id,\"before\",note,actor_user_id,occurred_at,\"after\" FROM audit_log WHERE action='rollup.export_csv'")).rows;
 expect(audit).toHaveLength(1);expect(audit[0]).toMatchObject({entity_type:"StatementRollup",company_id:null,before:null,note:null,actor_user_id:finance.userAccountId,occurred_at:now,after:{period:"2026-01",totalUsd:"62.00",companyIds:finance.companyIds,statementCount:5}});
 const partial={...finance,companyIds:[id(3)]};
 expect((await service().exportRollupCsv(partial,"2026-01")).csv).toBe('Company,Period,Total (USD)\r\nP3 · Pilot 3,2026-01,0.00\r\n');
 const empty=await service().read(finance,"2024-01");
 expect(empty.statements.rows).toEqual([]);expect(empty.reconciliationTotalUsd).toBe("0.00");expect(empty.ties).toBe(false);
 expect((await service().exportRollupCsv(finance,"2024-01")).csv).toBe('Company,Period,Total (USD)\r\n');
 for(const auth of [null,own,{...finance,globalRole:null} as LedgerAuthorization]) {
  await expect(service().read(auth,"2026-01")).rejects.toThrow("ROLLUP_FORBIDDEN");
  await expect(service().exportRollupCsv(auth,"2026-01")).rejects.toThrow("ROLLUP_FORBIDDEN");
 }
 await expect(service().read(finance,"2026-13")).rejects.toThrow();
 await expect(service().exportRollupCsv(finance,"bad")).rejects.toThrow();
});
test("same-period finalized contribution ties to US-038; drafts and stale snapshots cannot tie",async()=>{
 let rollup=await service().read(finance,"2026-01");
 expect(rollup.statements.totals.totalUsd).toBe("62.00");expect(rollup.reconciliationTotalUsd).toBe("0.00");expect(rollup.ties).toBe(false);
 await owner.query("UPDATE statement SET status='final'");
 rollup=await service().read(finance,"2026-01");
 expect(rollup.reconciliationTotalUsd).toBe("62.00");expect(rollup.ties).toBe(true);
 const recon=createReconciliationService(drizzle(pool,{schema}),{now:()=>now});
 await recon.saveInvoiceAmount(finance,{period:"2026-01",vendorAccountId:id(11),invoiceAmountUsd:"62.00"});
 expect((await service().read(finance,"2026-01")).ties).toBe(true);
 await owner.query("TRUNCATE reconciliation CASCADE");
 await owner.query("INSERT INTO reconciliation(period,vendor_account_id,rollup_amount_usd,invoice_amount_usd,variance_usd,status,created_at) VALUES('2026-01',$1,61,61,0,'reconciled',$2)",[id(11),now]);
 rollup=await service().read(finance,"2026-01");expect(rollup.reconciliationTotalUsd).toBe("61.00");expect(rollup.ties).toBe(false);
 expect((await service().read(finance,"2026-02")).ties).toBe(false);
});
test("signed money conserves cents in CSV and group total across generated pilot statements",async()=>{
 await fc.assert(fc.asyncProperty(fc.array(fc.integer({min:-99999999,max:99999999}),{minLength:5,maxLength:5}),async amounts=>{
  for(let n=0;n<5;n++)await owner.query("UPDATE statement SET total_usd=$1 WHERE company_id=$2",[(amounts[n]!/100).toFixed(2),id(n+2)]);
  const rollup=await service().read(finance,"2026-01");
  expect(Math.round(Number(rollup.statements.totals.totalUsd)*100)).toBe(amounts.reduce((a,b)=>a+b,0));
  const csv=(await service().exportRollupCsv(finance,"2026-01")).csv;
  expect(csv.trim().split("\r\n").slice(1).map(line=>Math.round(Number(line.split(",").at(-1))*100))).toEqual(amounts);
 }),{seed:39,numRuns:12});
});
test("CSV escapes spreadsheet names and audit failures prevent a successful download",async()=>{
 await owner.query("UPDATE company SET code='=1+1',name=$1 WHERE id=$2",['Quoted, "name"',id(2)]);
 expect((await service().exportRollupCsv(finance,"2026-01")).csv).toContain('"\'=1+1 · Quoted, ""name"""');
 await owner.query("CREATE FUNCTION reject_rollup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_rollup_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_rollup_audit()");
 try {await expect(service().exportRollupCsv(finance,"2026-01")).rejects.toThrow("audit unavailable");}
 finally {await owner.query("DROP TRIGGER reject_rollup_audit ON audit_log; DROP FUNCTION reject_rollup_audit()");}
});

test("offsetting missing organization contributions cannot masquerade as a zero tie",async()=>{
 // A partial vendor invoice is hidden by US-038 even when its visible signed lines cancel.
 await owner.query("UPDATE statement SET total_usd=0");
 const rows=await repository.read(finance,{period:"2026-01"});
 await owner.query("UPDATE statement_line SET amount_usd=0");
 await owner.query("UPDATE statement SET status='final'");
 // Add an out-of-scope company contribution to this same account in another finalized statement.
 await owner.query("INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Foreign','FOREIGN','internal','active',$2,$3)",[id(99),now,id(1)]);
 await owner.query("INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'2026-01','draft',0,1,$3,$3)",[id(98),id(99),now]);
 await owner.query("INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES($1,'adjustment',$2,1)",[id(98),id(11)]);
 await owner.query("UPDATE statement SET status='final' WHERE id=$1",[id(98)]);
 expect(rows.rows).toHaveLength(5);
 const rollup=await service().read(finance,"2026-01");
 expect(rollup.statements.totals.totalUsd).toBe("0.00");expect(rollup.reconciliationTotalUsd).toBe("0.00");expect(rollup.ties).toBe(false);
});

test("finalized signed company contributions conserve the same cents across both projections",async()=>{
 let iteration=0;
 await fc.assert(fc.asyncProperty(fc.array(fc.integer({min:-99999999,max:99999999}),{minLength:5,maxLength:5}),async amounts=>{
  const period=`2025-${String(++iteration).padStart(2,"0")}`;
  for(let n=0;n<5;n++) {
   const inserted=await owner.query("INSERT INTO statement(company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'draft',0,$3,$4,$4) RETURNING id",[id(n+2),period,(amounts[n]!/100).toFixed(2),now]);
   await owner.query("INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES($1,'adjustment',$2,$3)",[inserted.rows[0].id,id(11),(amounts[n]!/100).toFixed(2)]);
  }
  await owner.query("UPDATE statement SET status='final' WHERE period=$1",[period]);
  const rollup=await service().read({...finance,globalRole:"group_admin"},period);
  expect(Math.round(Number(rollup.reconciliationTotalUsd)*100)).toBe(amounts.reduce((a,b)=>a+b,0));
  expect(rollup.reconciliationTotalUsd).toBe(rollup.statements.totals.totalUsd);expect(rollup.ties).toBe(true);
 }),{seed:390,numRuns:8});
});

// This kills removal of the OUTER repeatable-read isolation; nested repository savepoints inherit it.
test("a concurrent draft replacement cannot mix rollup rows and totals across snapshots",async()=>{
 await owner.query(`ALTER TABLE statement_line RENAME TO us039_statement_line;
 CREATE FUNCTION us039_pause_read() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(39039); RETURN true; END $$;
 CREATE VIEW statement_line AS SELECT * FROM us039_statement_line WHERE us039_pause_read();
 GRANT SELECT ON statement_line TO ledger_app`);
 await owner.query("SELECT pg_advisory_lock(39039)");
 const pid=(await owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
 let settled=false;
 const pending=service().read(finance,"2026-01").finally(()=>{settled=true;});
 void pending.catch(()=>undefined);
 try {
  let blocked=false;
  while(!settled&&!blocked)blocked=(await owner.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS blocked",[pid])).rows[0].blocked;
  expect(blocked).toBe(true);
  await owner.query("UPDATE statement SET total_usd=82 WHERE company_id=$1 AND period='2026-01'",[id(2)]);
  await owner.query("SELECT pg_advisory_unlock(39039)");
  const rollup=await pending;
  expect(rollup.statements.rows[0]?.totalUsd).toBe("62.00");
  expect(rollup.statements.totals.totalUsd).toBe("62.00");
 } finally {
  await owner.query("SELECT pg_advisory_unlock_all()");
  await pending.catch(()=>undefined);
  await owner.query("DROP VIEW statement_line; DROP FUNCTION us039_pause_read(); ALTER TABLE us039_statement_line RENAME TO statement_line");
 }
});

test.each(["partial-zero-account","offset-empty-headers","empty-draft"])("equal aggregate money cannot hide %s",async scenario=>{
 if(scenario === "partial-zero-account") {
  await owner.query("INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Partially scoped','orchestration',0,'active',$3,$4)",[id(21),id(10),now,id(1)]);
  await owner.query("INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Foreign','FOREIGN','internal','active',$2,$3) ON CONFLICT(id) DO NOTHING",[id(99),now,id(1)]);
  await owner.query("INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'2026-01','draft',0,1,$3,$3)",[id(98),id(99),now]);
  const ownZero=(await owner.query("SELECT id FROM statement WHERE company_id=$1 AND period='2026-01'",[id(3)])).rows[0].id;
  await owner.query("INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES($1,'adjustment',$2,0),($3,'adjustment',$2,1)",[ownZero,id(21),id(98)]);
 } else if(scenario === "offset-empty-headers") {
  await owner.query("UPDATE statement SET total_usd=CASE WHEN company_id=$1 THEN 5 WHEN company_id=$2 THEN -5 ELSE total_usd END",[id(3),id(4)]);
 }
 if(scenario === "empty-draft")await owner.query("UPDATE statement SET status='final' WHERE company_id<>$1",[id(3)]);
 else await owner.query("UPDATE statement SET status='final'");
 const rollup=await service().read(finance,"2026-01");
 expect(rollup.statements.totals.totalUsd).toBe("62.00");
 expect(rollup.reconciliationTotalUsd).toBe("62.00");
 expect(rollup.ties).toBe(false);
});


test.each(["finance","approver","viewer"] as const)("US-047 %s grants never authorize group rollup or export writes", async role => {
 const scoped={...own,companyGrants:[{companyId:id(2),role}]};
 const before=(await owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action='rollup.export_csv'")).rows;
 await expect(service().read(scoped,"2026-01")).rejects.toThrow("ROLLUP_FORBIDDEN");
 await expect(service().exportRollupCsv(scoped,"2026-01")).rejects.toThrow("ROLLUP_FORBIDDEN");
 expect((await owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action='rollup.export_csv'")).rows).toEqual(before);
});
