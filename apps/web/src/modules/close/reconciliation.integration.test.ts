import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createReconciliationService } from "./reconciliation-transaction";
const id=(n:number)=>`38000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=new Date("2026-11-01T00:00:00Z");
const finance:LedgerAuthorization={userId:id(1),userAccountId:id(1),idpSubject:"finance",globalRole:"central_finance",roles:["central_finance"],companyIds:[id(5)],companyGrants:[],employeeCompanyId:null};
const key={period:"2026-01",vendorAccountId:id(3)};
let fixture:PostgresFixture,owner:pg.Client,pool:pg.Pool,service:ReturnType<typeof createReconciliationService>;
beforeAll(async()=>{fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();pool=new pg.Pool({connectionString:fixture.appUrl});service=createReconciliationService(drizzle(pool,{schema}),{now:()=>now});});
afterAll(async()=>{await pool?.end();await owner?.end();await fixture?.stop();});
beforeEach(async()=>{
 await owner.query(`TRUNCATE audit_log,reconciliation_variance_line,reconciliation,statement_line,statement,company,vendor_account,vendor,user_account CASCADE`);
 await owner.query(`INSERT INTO user_account(id,email,global_role,status,created_at) VALUES($1,'finance@test.invalid','central_finance','active',$2)`,[id(1),now]);
 await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Manual','manual','none',false,false,false,false,'email','active',$2,$3)`,[id(2),now,id(1)]);
 await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Org A','orchestration',0,'active',$3,$4),($5,$2,'Org B','orchestration',0,'active',$3,$4)`,[id(3),id(2),now,id(1),id(4)]);
 await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'A','A','internal','active',$2,$3),($4,'B','B','internal','active',$2,$3)`,[id(5),now,id(1),id(6)]);
 await owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'2026-01','draft',0,10050,$3,$3),($4,$5,'2026-01','draft',0,99,$3,$3)`,[id(7),id(5),now,id(8),id(6)]);
 await owner.query(`INSERT INTO statement_line(id,statement_id,kind,vendor_account_id,amount_usd) VALUES($1,$2,'adjustment',$3,10049),($4,$2,'adjustment',$5,1),($6,$7,'adjustment',$5,99)`,[id(9),id(7),id(3),id(10),id(4),id(11),id(8)]);
 await owner.query(`UPDATE statement SET status='final'`);
});
// Each assertion targets a missing scope, finalization, threshold, or persistence guard.
test("uses finalized account contributions once, scopes cards and rejects partial orgs",async()=>{
 const cards=await service.cards(finance,"2026-01");
 expect(cards.map(c=>[c.vendorAccountId,c.rollupAmountUsd,c.status,c.invoiceAmountUsd])).toEqual([[id(3),"10049.00","open",null]]);
 expect(await service.cards({...finance,companyIds:[]},"2026-01")).toEqual([]);
 await expect(service.saveInvoiceAmount(finance,{...key,vendorAccountId:id(4),invoiceAmountUsd:"100.00"})).rejects.toThrow("RECONCILIATION_SCOPE");
 await expect(service.saveInvoiceAmount(finance,{...key,period:"2026-02",invoiceAmountUsd:"1.00"})).rejects.toThrow();
 const result=await service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"10000.00"});
 expect(result).toMatchObject({rollupAmountUsd:"10049.00",varianceUsd:"49.00",status:"reconciled",updatedAt:now});
 expect((await owner.query(`SELECT action,actor_user_id,occurred_at FROM audit_log`)).rows).toEqual([{action:"reconciliation.invoice_saved",actor_user_id:id(1),occurred_at:now}]);
});
test.each([["10050.00","reconciled"],["10051.00","open"],["9950.00","reconciled"],["9949.00","open"]])("BR-20 finalized rollup %s is %s against invoice 10000",async(total,status)=>{
 // A fresh period is finalized with the hand-checked total; never edit a final.
 await owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'2026-02','draft',0,$3,$4,$4)`,[id(20),id(5),total,now]);
 await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES($1,'adjustment',$2,$3)`,[id(20),id(3),total]);
 await owner.query(`UPDATE statement SET status='final' WHERE id=$1`,[id(20)]);
 expect((await service.saveInvoiceAmount(finance,{...key,period:"2026-02",invoiceAmountUsd:"10000.00"})).status).toBe(status);
});
test("out-of-tolerance remains open; only a noted finance/admin override closes it with immutable evidence",async()=>{
 const row=await service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"100.00"});expect(row.status).toBe("open");
 const input={...key,cause:"timing",detail:"Invoice timing",registerAmountUsd:"10.00",invoiceAmountUsd:"11.25",evidenceUrl:"https://example.test/invoice"};
 const line=await service.saveVarianceLine(finance,input);
 expect(line).toMatchObject({differenceUsd:"-1.25",createdBy:id(1),createdAt:now,evidenceUrl:input.evidenceUrl});
 const updated=await service.saveVarianceLine(finance,{...input,lineId:line.id,detail:"Explained"});expect(updated.detail).toBe("Explained");
 expect((await service.cards(finance,key.period))[0]?.lines[0]?.id).toBe(line.id);
 await service.deleteVarianceLine(finance,{...key,lineId:line.id});
 expect((await service.cards(finance,key.period))[0]?.lines).toEqual([]);
 const kept=await service.saveVarianceLine(finance,input);
 for(const note of ["","   "]) await expect(service.overrideReconciliation(finance,{...key,note})).rejects.toThrow();
 for(const auth of [null,{...finance,globalRole:null} as LedgerAuthorization]) {
  await expect(service.overrideReconciliation(auth,{...key,note:"approved"})).rejects.toThrow("RECONCILIATION_FORBIDDEN");
  await expect(service.saveInvoiceAmount(auth,{...key,invoiceAmountUsd:"1.00"})).rejects.toThrow("RECONCILIATION_FORBIDDEN");
  await expect(service.saveVarianceLine(auth,input)).rejects.toThrow("RECONCILIATION_FORBIDDEN");
  await expect(service.deleteVarianceLine(auth,{...key,lineId:kept.id})).rejects.toThrow("RECONCILIATION_FORBIDDEN");
  await expect(service.cards(auth,key.period)).rejects.toThrow("RECONCILIATION_FORBIDDEN");
 }
 await expect(service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"100.00",status:"reconciled"})).rejects.toThrow();
 const result=await service.overrideReconciliation({...finance,globalRole:"group_admin"},{...key,note:"  Approved timing  "});
 expect(result).toMatchObject({status:"overridden",overriddenBy:id(1),overrideNote:"Approved timing"});
 await expect(service.saveVarianceLine(finance,{...input,lineId:kept.id})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
 await expect(service.deleteVarianceLine(finance,{...key,lineId:kept.id})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
 await expect(service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"10049.00"})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
 await expect(service.overrideReconciliation(finance,{...key,note:"again"})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
 expect((await owner.query(`SELECT count(*)::int AS n FROM reconciliation_variance_line`)).rows[0].n).toBe(1);
});
test("rejects unsaved override, invalid evidence and unrelated line IDs; scope applies to every mutation",async()=>{
 await expect(service.overrideReconciliation(finance,{...key,note:"no invoice"})).rejects.toThrow("INVOICE_REQUIRED");
 const input={...key,cause:"other",detail:"Explained",registerAmountUsd:"1.00",invoiceAmountUsd:"2.00",evidenceUrl:null};
 const line=await service.saveVarianceLine(finance,input);
 for(const auth of [{...finance,companyIds:[]},{...finance,companyIds:[id(6)]}]) {
  await expect(service.saveVarianceLine(auth,{...input,lineId:line.id})).rejects.toThrow("RECONCILIATION_SCOPE");
  await expect(service.deleteVarianceLine(auth,{...key,lineId:line.id})).rejects.toThrow("RECONCILIATION_SCOPE");
  await expect(service.overrideReconciliation(auth,{...key,note:"approved"})).rejects.toThrow("RECONCILIATION_SCOPE");
 }
 await expect(service.saveVarianceLine(finance,{...input,evidenceUrl:"javascript:alert(1)"})).rejects.toThrow();
 await expect(service.saveVarianceLine(finance,{...input,lineId:id(99)})).rejects.toThrow("VARIANCE_NOT_FOUND");
 await expect(service.deleteVarianceLine(finance,{...key,lineId:id(99)})).rejects.toThrow("VARIANCE_NOT_FOUND");
});
test("automatic reconciliation freezes lines and audit failure rolls back the invoice",async()=>{
 const input={...key,cause:"other",detail:"Explained",registerAmountUsd:"1.00",invoiceAmountUsd:"2.00",evidenceUrl:null};
 const line=await service.saveVarianceLine(finance,input);
 await owner.query(`CREATE FUNCTION reject_us038_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='reconciliation.invoice_saved' THEN RAISE EXCEPTION 'audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_us038_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_us038_audit()`);
 try {await expect(service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"10049.00"})).rejects.toThrow("audit fault");
 expect((await owner.query(`SELECT status,invoice_amount_usd FROM reconciliation`)).rows).toEqual([{status:"open",invoice_amount_usd:null}]);}
 finally {await owner.query(`DROP TRIGGER reject_us038_audit ON audit_log; DROP FUNCTION reject_us038_audit()`);}
 await service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"10049.00"});
 await expect(service.saveVarianceLine(finance,{...input,lineId:line.id})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
 await expect(service.deleteVarianceLine(finance,{...key,lineId:line.id})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
});

test("draft contributions block reconciliation and finalized header totals must agree",async()=>{
 await owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'2026-02','draft',0,1,$3,$3)`,[id(20),id(5),now]);
 await owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES($1,'adjustment',$2,1)`,[id(20),id(3)]);
 expect(await service.cards(finance,"2026-02")).toEqual([]);
 await expect(service.saveInvoiceAmount(finance,{...key,period:"2026-02",invoiceAmountUsd:"1.00"})).rejects.toThrow("RECONCILIATION_SCOPE");
 await owner.query(`UPDATE statement SET total_usd=2,status='final' WHERE id=$1`,[id(20)]);
 expect(await service.cards(finance,"2026-02")).toEqual([]);
});
test("same-period commands serialize: a line waiting behind the automatic flip cannot edit terminal evidence",async()=>{
 const input={...key,cause:"other",detail:"Before",registerAmountUsd:"1.00",invoiceAmountUsd:"2.00",evidenceUrl:null};
 const line=await service.saveVarianceLine(finance,input);
 const locker=await fixture.connectAsOwner(),writer=await fixture.connectAsApp();
 try {
  await locker.query("BEGIN");await locker.query(`SELECT pg_advisory_xact_lock(hashtextextended('license-close:2026-01',0))`);
  const lockerPid=(await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await writer.query("SET statement_timeout='10s'");
  let settled=false;
  const pending=createReconciliationService(drizzle(writer,{schema})).saveVarianceLine(finance,{...input,lineId:line.id,detail:"After"}).then(()=>"unexpected",error=>error.message).finally(()=>{settled=true;});
  let blocked=false;
  while(!settled&&!blocked)blocked=(await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`,[lockerPid,writerPid])).rows[0].blocked;
  expect(blocked).toBe(true);
  await locker.query(`UPDATE reconciliation SET invoice_amount_usd=10049,variance_usd=0,status='reconciled' WHERE vendor_account_id=$1`,[id(3)]);
  await locker.query("COMMIT");
  expect(await pending).toBe("RECONCILIATION_IMMUTABLE");
  expect((await owner.query(`SELECT detail FROM reconciliation_variance_line WHERE id=$1`,[line.id])).rows).toEqual([{detail:"Before"}]);
 } finally {await locker.query("ROLLBACK");await locker.end();await writer.end();}
});

test("audit trail ties invoice, explanation edits/deletion and noted override to immutable reconciliation evidence",async()=>{
 const invoice=await service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"100.00"});
 const input={...key,cause:"timing",detail:"Initial timing",registerAmountUsd:"10.00",invoiceAmountUsd:"11.00",evidenceUrl:"https://example.test/audit"};
 const line=await service.saveVarianceLine(finance,input);
 await service.saveVarianceLine(finance,{...input,lineId:line.id,detail:"Verified timing"});
 await service.deleteVarianceLine(finance,{...key,lineId:line.id});
 await service.overrideReconciliation(finance,{...key,note:"  Finance approved timing  "});
 const rows=(await owner.query(`SELECT actor_user_id,action,entity_type,entity_id,company_id,"before","after",note,occurred_at FROM audit_log`)).rows;
 expect(rows).toHaveLength(5);
 for(const row of rows)expect(row).toMatchObject({actor_user_id:finance.userAccountId,entity_type:"Reconciliation",entity_id:invoice.id,company_id:null,occurred_at:now});
 expect(rows.map(row=>row.action).sort()).toEqual(["reconciliation.invoice_saved","reconciliation.overridden","reconciliation.variance_deleted","reconciliation.variance_saved","reconciliation.variance_saved"]);
 const savedInvoice=rows.find(row=>row.action==="reconciliation.invoice_saved");
 expect(savedInvoice).toMatchObject({note:null,before:{id:invoice.id,invoiceAmountUsd:null,status:"open"},after:{id:invoice.id,invoiceAmountUsd:"100.00",varianceUsd:"9949.00",status:"open"}});
 const created=rows.find(row=>row.action==="reconciliation.variance_saved"&&row.before===null);
 expect(created).toMatchObject({note:null,before:null,after:{id:line.id,reconciliationId:invoice.id,detail:"Initial timing",evidenceUrl:input.evidenceUrl,differenceUsd:"-1.00"}});
 const changed=rows.find(row=>row.action==="reconciliation.variance_saved"&&row.before!==null);
 expect(changed).toMatchObject({note:null,before:{id:line.id,detail:"Initial timing"},after:{id:line.id,detail:"Verified timing"}});
 expect(rows.find(row=>row.action==="reconciliation.variance_deleted")).toMatchObject({note:null,before:{id:line.id,detail:"Verified timing"},after:null});
 expect(rows.find(row=>row.action==="reconciliation.overridden")).toMatchObject({note:"Finance approved timing",before:{id:invoice.id,status:"open",overrideNote:null},after:{id:invoice.id,status:"overridden",overriddenBy:finance.userAccountId,overrideNote:"Finance approved timing"}});
});

test("legacy open invoice within tolerance cannot use the outside-only override path",async()=>{
 await owner.query(`INSERT INTO reconciliation(id,period,vendor_account_id,rollup_amount_usd,invoice_amount_usd,variance_usd,status,created_at) VALUES($1,$2,$3,10049,10000,49,'open',$4)`,[id(90),key.period,key.vendorAccountId,now]);
 await expect(service.overrideReconciliation(finance,{...key,note:"Not a tolerance exception"})).rejects.toThrow("OVERRIDE_NOT_REQUIRED");
 expect((await owner.query(`SELECT status,override_note,overridden_by FROM reconciliation WHERE id=$1`,[id(90)])).rows).toEqual([{status:"open",override_note:null,overridden_by:null}]);
 expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log`)).rows).toEqual([{n:0}]);
});
test("terminal card displays its stored rollup snapshot rather than recomputing historical evidence",async()=>{
 // A legacy completed snapshot can precede an additional finalized contribution.
 await owner.query(`INSERT INTO reconciliation(id,period,vendor_account_id,rollup_amount_usd,invoice_amount_usd,variance_usd,status,created_at) VALUES($1,$2,$3,10040,10040,0,'reconciled',$4)`,[id(91),key.period,key.vendorAccountId,now]);
 expect((await service.cards(finance,key.period))[0]).toMatchObject({id:id(91),status:"reconciled",rollupAmountUsd:"10040.00",invoiceAmountUsd:"10040.00",varianceUsd:"0.00"});
});

test("cards partition each organization's evidence, including an unsaved card beside a saved organization",async()=>{
 const all={...finance,companyIds:[id(5),id(6)]};
 const common={period:key.period,cause:"timing",detail:"B only",registerAmountUsd:"1.00",invoiceAmountUsd:"2.00",evidenceUrl:null};
 const b=await service.saveVarianceLine(all,{...common,vendorAccountId:id(4)});
 let cards=await service.cards(all,key.period);
 expect(cards.map(card=>[card.vendorAccountId,card.lines.map(line=>line.id)])).toEqual([[id(3),[]],[id(4),[b.id]]]);
 expect(cards[0]?.id).toBeUndefined();expect(cards[1]?.id).toBe(b.reconciliationId);
 const a=await service.saveVarianceLine(all,{...common,vendorAccountId:id(3),detail:"A only"});
 cards=await service.cards(all,key.period);
 expect(cards.map(card=>[card.vendorAccountId,card.id,card.lines.map(line=>line.id)])).toEqual([[id(3),a.reconciliationId,[a.id]],[id(4),b.reconciliationId,[b.id]]]);
});
test("open cards recompute finalized contributions instead of showing a stale saved rollup",async()=>{
 await owner.query(`INSERT INTO reconciliation(id,period,vendor_account_id,rollup_amount_usd,status,created_at) VALUES($1,$2,$3,9999,'open',$4)`,[id(92),key.period,key.vendorAccountId,now]);
 expect((await service.cards(finance,key.period))[0]).toMatchObject({id:id(92),status:"open",rollupAmountUsd:"10049.00",invoiceAmountUsd:null});
});
test("a reconciled invoice rejects override as immutable before evaluating whether an exception is needed",async()=>{
 await service.saveInvoiceAmount(finance,{...key,invoiceAmountUsd:"10049.00"});
 await expect(service.overrideReconciliation(finance,{...key,note:"Already complete"})).rejects.toThrow("RECONCILIATION_IMMUTABLE");
 expect((await owner.query(`SELECT status,override_note,overridden_by FROM reconciliation`)).rows).toEqual([{status:"reconciled",override_note:null,overridden_by:null}]);
});
