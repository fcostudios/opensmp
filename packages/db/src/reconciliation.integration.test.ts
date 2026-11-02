import { afterAll,beforeAll,expect,test } from "vitest";
import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { reconciliationVarianceLine } from "./schema";
import { createPostgresFixture,type PostgresFixture } from "./testing/postgres-container";
const id=(n:number)=>`38000000-0000-4000-8001-${String(n).padStart(12,"0")}`;
let fixture:PostgresFixture,owner:pg.Client,app:pg.Client;
beforeAll(async()=>{fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();app=await fixture.connectAsApp();
 await owner.query(`INSERT INTO user_account(id,email,global_role,status,created_at) VALUES($1,'recon@test.invalid','central_finance','active',now())`,[id(1)]);
 await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Manual','manual','none',false,false,false,false,'email','active',now(),$2)`,[id(2),id(1)]);
 await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Org','orchestration',0,'active',now(),$3)`,[id(3),id(2),id(1)]);
});
afterAll(async()=>{await app?.end();await owner?.end();await fixture?.stop();});
test("committed BR-20 migration rejects illegal flips and protects terminal header/line evidence under app grants",async()=>{
 for(const [index,terminal] of ["reconciled","overridden"].entries()) {
  const r=id(10+index),l=id(20+index);
  await app.query(`INSERT INTO reconciliation(id,period,vendor_account_id,rollup_amount_usd,invoice_amount_usd,variance_usd,status,created_at) VALUES($1,$2,$3,10051,10000,51,'open',now())`,[r,`2026-0${index+1}`,id(3)]);
  await expect(app.query(`UPDATE reconciliation SET status='reconciled' WHERE id=$1`,[r])).rejects.toMatchObject({code:"23514"});
  await expect(app.query(`UPDATE reconciliation SET status='overridden',overridden_by=$2,override_note=' ' WHERE id=$1`,[r,id(1)])).rejects.toMatchObject({code:"23514"});
  await app.query(`INSERT INTO reconciliation_variance_line(id,reconciliation_id,cause,detail,register_amount_usd,invoice_amount_usd,difference_usd,evidence_url,created_at,created_by) VALUES($1,$2,'timing','Original',1,2,-1,'https://example.test/evidence',now(),$3)`,[l,r,id(1)]);
  await app.query(`UPDATE reconciliation_variance_line SET detail='Explained' WHERE id=$1`,[l]);
  if(terminal==='reconciled') await app.query(`UPDATE reconciliation SET rollup_amount_usd=10050,variance_usd=50,status='reconciled' WHERE id=$1`,[r]);
  else await app.query(`UPDATE reconciliation SET status='overridden',overridden_by=$2,override_note='Approved' WHERE id=$1`,[r,id(1)]);
  for(const query of [`UPDATE reconciliation SET status='open' WHERE id=$1`,`UPDATE reconciliation SET notes='rewrite' WHERE id=$1`,`DELETE FROM reconciliation WHERE id=$1`]) await expect(owner.query(query,[r])).rejects.toMatchObject({code:"23514"});
  for(const query of [`UPDATE reconciliation_variance_line SET detail='rewrite' WHERE id=$1`,`DELETE FROM reconciliation_variance_line WHERE id=$1`]) await expect(app.query(query,[l])).rejects.toMatchObject({code:"23514"});
  await expect(app.query(`INSERT INTO reconciliation_variance_line(reconciliation_id,cause,detail,difference_usd,created_at,created_by) VALUES($1,'other','late',0,now(),$2)`,[r,id(1)])).rejects.toMatchObject({code:"23514"});
  expect(await drizzle(app).select({detail:reconciliationVarianceLine.detail,evidenceUrl:reconciliationVarianceLine.evidenceUrl}).from(reconciliationVarianceLine).where(eq(reconciliationVarianceLine.id,l))).toEqual([{detail:"Explained",evidenceUrl:"https://example.test/evidence"}]);
 }
});

test("legacy invoice-minus-rollup evidence remains readable and editable while open",async()=>{
 const r=id(40);
 await app.query(`INSERT INTO reconciliation(id,period,vendor_account_id,rollup_amount_usd,invoice_amount_usd,variance_usd,status,created_at) VALUES($1,'2026-04',$2,100,117.25,17.25,'open',now())`,[r,id(3)]);
 await app.query(`UPDATE reconciliation SET notes='Legacy evidence retained' WHERE id=$1`,[r]);
 expect((await app.query(`SELECT variance_usd,notes,status FROM reconciliation WHERE id=$1`,[r])).rows).toEqual([{variance_usd:"17.25",notes:"Legacy evidence retained",status:"open"}]);
 await expect(app.query(`UPDATE reconciliation SET status='reconciled' WHERE id=$1`,[r])).rejects.toMatchObject({code:"23514"});
 await expect(app.query(`UPDATE reconciliation SET variance_usd=1 WHERE id=$1`,[r])).rejects.toMatchObject({code:"23514"});
});
