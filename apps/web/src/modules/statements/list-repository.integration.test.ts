import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import fc from "fast-check";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createCloseService } from "../close/close-transaction";
import { createStatementRepository } from "./repository";

const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-11-01T12:00:00Z");
const finance: LedgerAuthorization = { userId:id(1),userAccountId:id(1),idpSubject:"statements-finance",globalRole:"central_finance",roles:["central_finance"],companyIds:[2,3,4,5,6].map(id),companyGrants:[],employeeCompanyId:null };
const own: LedgerAuthorization = {...finance,globalRole:null,roles:["company_finance","viewer"],companyIds:[id(2),id(3)],companyGrants:[{companyId:id(2),role:"finance"}]};
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
beforeEach(async()=>{await owner.query("TRUNCATE statement_line,statement,close_run,audit_log CASCADE");await owner.query(`UPDATE license_assignment SET started_on='2026-01-10',ended_on='2026-01-31' WHERE id=$1`,[id(15)]);await close.runClose(finance,{period:"2026-01"});});
afterAll(async()=>{await pool?.end();await owner?.end();await fixture?.stop();});

test("five pilot rows retain evidence and stamp; reruns replace drafts and immutable statuses remain visible",async()=>{
 const first=await close.runClose(finance,{period:"2026-01"});
 let data=await repository.read(finance,{period:"2026-01"});
 expect(data.rows.map(r=>r.companyCode)).toEqual(["P2","P3","P4","P5","P6"]);
 expect(data.totals).toEqual({generated:5,draft:5,final:0,reconciled:0,totalUsd:"62.00"});
 const row=data.rows[0]!;
 expect(row).toMatchObject({companyId:id(2),period:"2026-01",status:"draft",openingSeats:1,seatDays:31,rates:["62.00"],totalUsd:"62.00",closeRunId:first.id});
 expect(row.generatedAt).toEqual(first.startedAt);
 expect(row.joiners).toEqual([{assignmentId:id(15),personId:id(13),date:"2026-01-10"}]);
 expect(row.leavers).toEqual([{assignmentId:id(14),personId:id(13),date:"2026-01-09"},{assignmentId:id(15),personId:id(13),date:"2026-01-31"}]);
 await owner.query(`UPDATE statement SET status='final' WHERE company_id=$1`,[id(3)]);
 await owner.query(`UPDATE statement SET status='reconciled' WHERE company_id=$1`,[id(4)]);
 await owner.query(`UPDATE license_assignment SET ended_on='2026-01-20' WHERE id=$1`,[id(15)]);
 const second=await close.runClose(finance,{period:"2026-01"});
 data=await repository.read(finance,{period:"2026-01"});
 expect(data.rows.map(r=>r.id)).toContain(row.id);expect(data.rows).toHaveLength(5);
 expect(data.latest?.id).toBe(second.id);
 expect(data.rows[0]).toMatchObject({totalUsd:"40.00",seatDays:20,closeRunId:second.id});
 expect(data.rows[1]?.closeRunId).toBe(first.id);
 expect(data.totals).toEqual({generated:5,draft:3,final:1,reconciled:1,totalUsd:"40.00"});
 expect((await repository.read(finance,{period:"2026-01",status:"final"})).rows.map(r=>r.companyId)).toEqual([id(3)]);
 expect((await repository.read({...finance,globalRole:"group_admin"},{period:"2026-01",companyId:id(2)})).totals.totalUsd).toBe("40.00");
});

test("finance grants constrain rows, company choices, counts and runs even with broader company authorization",async()=>{
 const data=await repository.read(own,{period:"2026-01"});
 expect(data.rows.map(r=>r.companyId)).toEqual([id(2)]);expect(data.companies.map(c=>c.id)).toEqual([id(2)]);expect(data.totals.generated).toBe(1);expect(data.latest?.note).toBeNull();
 for(const companyId of [id(3),id(99)])await expect(repository.read(own,{period:"2026-01",companyId})).rejects.toThrow("STATEMENTS_ACCESS_FORBIDDEN");
 for(const auth of [null,{...own,companyGrants:[],roles:["company_finance"]} as LedgerAuthorization])await expect(repository.read(auth,{period:"2026-01"})).rejects.toThrow("STATEMENTS_ACCESS_FORBIDDEN");
 for(const input of [{period:"2026-13"},{period:"2026-01",status:"invented"},{period:"2026-01",companyId:"invalid"},{period:"2026-01",closeRunId:id(1)}])await expect(repository.read(finance,input)).rejects.toThrow();
});

test("empty and failed-close periods show authorized latest-run metadata, never another scope failure",async()=>{
 const failed=await close.runClose(finance,{period:"2025-12",note:"Missing rate"});expect(failed.status).toBe("failed");
 const data=await repository.read(finance,{period:"2025-12"});expect(data.rows).toEqual([]);expect(data.latest?.id).toBe(failed.id);expect(data.latest?.status).toBe("failed");expect(data.period).toBe("2025-12");expect(data.totals.totalUsd).toBe("0.00");
 expect((await repository.read(own,{period:"2025-12"})).latest).toBeNull();
 const empty=await repository.read(finance,{period:"2024-01"});expect(empty.latest).toBeNull();expect(empty.rows).toEqual([]);
});

test("group money sum conserves signed cents over visible rows",async()=>{
 await fc.assert(fc.asyncProperty(fc.array(fc.integer({min:-99999999,max:99999999}),{minLength:5,maxLength:5}),async cents=>{
  for(let n=0;n<5;n++)await owner.query(`INSERT INTO statement(company_id,period,status,opening_seats,total_usd,generated_at,created_at,close_run_id) SELECT $1,'2026-06','draft',0,$2,$3,$3,id FROM close_run WHERE period='2026-01' ORDER BY started_at,id LIMIT 1 ON CONFLICT(company_id,period) DO UPDATE SET total_usd=EXCLUDED.total_usd`,[id(n+2),(cents[n]!/100).toFixed(2),now]);
  const data=await repository.read(finance,{period:"2026-06"});
  expect(Math.round(Number(data.totals.totalUsd)*100)).toBe(cents.reduce((a,b)=>a+b,0));expect(data.rows).toHaveLength(5);
 }),{seed:96,numRuns:12});
});

test("license evidence stays with its company, null legacy fields stay empty, and non-license lines cannot add seats",async()=>{
 const before=await repository.read(finance,{period:"2026-01"});
 const other=before.rows[1]!;
 await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,license_days,amount_usd) VALUES($1,'license',$2,5,0),($1,'usage',$2,999,0)`,[other.id,id(11)]);
 await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,person_id,assignment_id,period_from,period_to,license_days,amount_usd) VALUES($1,'license',$2,$3,$4,'2025-12-01','2026-01-09',0,0)`,[before.rows[0]!.id,id(11),id(13),id(14)]);
 const data=await repository.read(finance,{period:"2026-01"});
 expect(data.rows[0]?.joiners).toEqual([{assignmentId:id(15),personId:id(13),date:"2026-01-10"}]);
 expect(data.rows[0]?.seatDays).toBe(31);expect(data.rows[0]?.rates).toEqual(["62.00"]);
 expect(data.rows[1]).toMatchObject({seatDays:5,rates:[],joiners:[],leavers:[],totalUsd:"0.00"});
 // Duplicate historical line evidence still identifies one dated movement per assignment.
 await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,person_id,assignment_id,period_from,period_to,license_days,rate_usd,amount_usd) SELECT statement_id,kind,vendor_account_id,person_id,assignment_id,period_from,period_to,license_days,rate_usd,amount_usd FROM statement_line WHERE assignment_id=$1 AND period_from='2026-01-10'`,[id(15)]);
 expect((await repository.read(finance,{period:"2026-01"})).rows[0]?.joiners).toEqual([{assignmentId:id(15),personId:id(13),date:"2026-01-10"}]);
 await owner.query(`UPDATE license_assignment SET started_on='2026-01-11',ended_on='2026-01-20' WHERE id=$1`,[id(15)]);
 const stale=(await repository.read(finance,{period:"2026-01"})).rows[0]!;
 expect(stale.joiners).toEqual([]);expect(stale.leavers).toEqual([{assignmentId:id(14),personId:id(13),date:"2026-01-09"}]);
});

test("a draft replacement between line and total reads cannot mix financial snapshots",async()=>{
 await owner.query(`ALTER TABLE statement_line RENAME TO us096_statement_line;
 CREATE FUNCTION us096_pause_read() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(96096); RETURN true; END $$;
 CREATE VIEW statement_line AS SELECT * FROM us096_statement_line WHERE us096_pause_read();
 GRANT SELECT ON statement_line TO ledger_app`);
 await owner.query(`SELECT pg_advisory_lock(96096)`);
 const pid=(await owner.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
 let settled=false;
 const pending=repository.read(finance,{period:"2026-01"}).finally(()=>{settled=true;});
 void pending.catch(()=>undefined);
 try {
   let blocked=false;
   while(!settled&&!blocked)blocked=(await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS blocked`,[pid])).rows[0].blocked;
   expect(blocked).toBe(true);
   await owner.query(`UPDATE statement SET total_usd=82 WHERE company_id=$1 AND period='2026-01'`,[id(2)]);
   await owner.query(`SELECT pg_advisory_unlock(96096)`);
   const data=await pending;
   expect(data.rows[0]?.totalUsd).toBe("62.00");expect(data.totals.totalUsd).toBe("62.00");
 } finally {
   await owner.query(`SELECT pg_advisory_unlock_all()`);
   await pending.catch(()=>undefined);
   await owner.query(`DROP VIEW statement_line; DROP FUNCTION us096_pause_read(); ALTER TABLE us096_statement_line RENAME TO statement_line`);
 }
});

test.each(["finance","approver","viewer"] as const)("US-041 %s sees only granted company rows, totals and choices",async role=>{
 const scoped={...own,companyGrants:[{companyId:id(2),role}]};
 const result=await repository.read(scoped,{period:"2026-01"});
 expect(result.rows.map(row=>row.companyId)).toEqual([id(2)]);
 expect(result.companies.map(row=>row.id)).toEqual([id(2)]);
 expect(result.totals.generated).toBe(1);
 await expect(repository.read(scoped,{period:"2026-01",companyId:id(3)})).rejects.toThrow("STATEMENTS_ACCESS_FORBIDDEN");
});
