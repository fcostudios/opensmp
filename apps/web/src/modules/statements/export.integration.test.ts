import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createStatementExportService, createStatementExportResponse, createStatementCsvDownload } from "./export-transaction";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyA = id(2), companyB = id(3), statementA = id(10), statementB = id(11);
const authorization: LedgerAuthorization = {
  userId: id(1), userAccountId: id(1), idpSubject: "finance-a", globalRole: null,
  roles: ["company_finance"], companyIds: [companyA, companyB], employeeCompanyId: null,
  companyGrants: [{ companyId: companyA, role: "finance" }, { companyId: companyB, role: "viewer" }],
};
let fixture: PostgresFixture;
let pool: pg.Pool;
let repository: ReturnType<typeof createStatementExportService>;
beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  const owner = await fixture.connectAsOwner();
  await owner.query(`
    INSERT INTO user_account (id,email,idp_subject,status,created_at) VALUES ('${id(1)}','a@test.invalid','finance-a','active','2026-08-01');
    INSERT INTO company (id,name,code,type,status,created_at,created_by) VALUES
      ('${companyA}','Alpha','ALP','internal','active','2026-08-01','${id(1)}'),
      ('${companyB}','Bravo','BRV','internal','active','2026-08-01','${id(1)}');
    INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
      VALUES ('${id(4)}','Vendor','orchestration','none',false,false,false,false,'email','active','2026-08-01','${id(1)}');
    INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
      VALUES ('${id(5)}','${id(4)}','Organization','orchestration',1,'active','2026-08-01','${id(1)}');
    INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
      VALUES ('${id(6)}','${id(4)}','Enterprise','seat','active','2026-08-01','${id(1)}');
    INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by) VALUES
      ('${id(7)}','alpha@test.invalid','Alice','${companyA}','active','2026-08-01','${id(1)}'),
      ('${id(8)}','bravo@test.invalid','Bob secret','${companyB}','active','2026-08-01','${id(1)}');
    INSERT INTO license_assignment (id,person_id,company_id,vendor_account_id,license_type_id,started_on,ended_on,source_kind,note,created_at,created_by) VALUES
      ('${id(9)}','${id(7)}','${companyA}','${id(5)}','${id(6)}','2026-07-10','2026-07-20','manual','Register evidence','2026-08-01','${id(1)}'),
      ('${id(21)}','${id(7)}','${companyA}','${id(5)}','${id(6)}','2026-08-01',NULL,'manual','Unrelated assignment','2026-08-01','${id(1)}'),
      ('${id(19)}','${id(8)}','${companyB}','${id(5)}','${id(6)}','2026-07-01',NULL,'manual','Secret evidence','2026-08-01','${id(1)}');
    INSERT INTO statement (id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES
      ('${statementA}','${companyA}','2026-07','draft',0,17.29,'2026-08-01','2026-08-01'),
      ('${statementB}','${companyB}','2026-07','draft',1,60.00,'2026-08-01','2026-08-01'),
      ('${id(20)}','${companyA}','2026-08','draft',0,0,'2026-09-01','2026-09-01');
    INSERT INTO statement_line (id,statement_id,kind,person_id,vendor_account_id,license_type_id,assignment_id,license_days,rate_usd,amount_usd,period_from,period_to,note) VALUES
      ('${id(12)}','${statementA}','license','${id(7)}','${id(5)}','${id(6)}','${id(9)}',11,60.00,21.29,'2026-07-10','2026-07-20','Prorated'),
      ('${id(13)}','${statementA}','adjustment',NULL,'${id(5)}',NULL,'${id(21)}',NULL,NULL,-4.00,'2026-07-01','2026-07-31','Correction required note'),
      ('${id(14)}','${statementB}','license','${id(8)}','${id(5)}','${id(6)}','${id(19)}',31,60.00,60.00,'2026-07-01','2026-07-31','Secret line'),
      ('${id(15)}','${statementA}','usage',NULL,'${id(5)}',NULL,NULL,NULL,NULL,0,'2026-07-01','2026-07-31','R2 hidden');
    UPDATE statement SET status='final' WHERE id='${statementB}';
  `);
  await owner.end();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  repository = createStatementExportService(drizzle(pool, { schema }), () => new Date("2026-11-02T12:00:00Z"));
});
afterAll(async () => { await pool?.end(); await fixture?.stop(); });

// These oracles kill removed company predicates, language fallback changes,
// missing audit writes, numeric conversion, and unsafe text escaping.
test("exports draft/final snapshots with company-language labels and exact USD, and commits audit metadata", async () => {
  const spanish = await repository.exportCsv(authorization, statementA);
  expect(spanish.filename).toBe(`statement-${statementA}-2026-07.csv`);
  expect(spanish.csv.split("\r\n")[0]).toBe("Compañía,Período,Estado,Licencias al inicio,Total (USD),Generado,Identificador del estado de cuenta,Corrida de cierre,Tipo,Persona,Organización,Tipo de licencia,Período desde,Período hasta,Licencias-día,Tarifa mensual (USD),Importe (USD),Nota");
  expect(spanish.csv).toContain(`ALP · Alpha,2026-07,Borrador,0,17.29,2026-08-01T00:00:00.000Z,${statementA},,Licencia,Alice,Organization,Enterprise,2026-07-10,2026-07-20,11,60.00,21.29,Prorated\r\n`);
  expect(spanish.csv).toContain(",Ajuste,,Organization,,2026-07-01,2026-07-31,,,-4.00,Correction required note\r\n");
  expect(spanish.csv).not.toContain("Secret");
  expect(spanish.csv).not.toContain("R2 hidden");
  const owner = await fixture.connectAsOwner();
  try {
    await owner.query(`UPDATE company SET statement_language='en' WHERE id='${companyB}'`);
    const english = await repository.exportCsv({...authorization,globalRole:"central_finance"}, statementB);
    expect(english.csv.split("\r\n")[0]).toBe("Company,Period,Status,Opening seats,Total (USD),Generated,Statement identifier,Close run,Kind,Person,Organization,License type,Period from,Period to,Seat-days,Monthly rate (USD),Amount (USD),Note");
    expect(english.csv).toContain(",2026-07,Final,1,60.00,");
    expect(english.csv).toContain(",License,Bob secret,");
    expect(english.csv).not.toContain("Correction required note");
    const audits = await owner.query("SELECT * FROM audit_log WHERE action='statement.export_csv' ORDER BY occurred_at,id");
    expect(audits.rows).toHaveLength(2);
    for (const row of audits.rows) {
      const isSpanish=row.after.language === "es";
      expect([row.company_id,row.entity_type,row.entity_id,row.actor_user_id,row.occurred_at.toISOString()]).toEqual([isSpanish?companyA:companyB,"Statement",isSpanish?statementA:statementB,id(1),"2026-11-02T12:00:00.000Z"]);
      expect(row.before).toBeNull(); expect(row.note).toBeNull();
      expect(row.after).toEqual({format:"csv",period:"2026-07",status:isSpanish ? "draft" : "final",language:row.after.language,totalUsd:isSpanish?"17.29":"60.00",lineCount:isSpanish?2:1});
    }
    expect(audits.rows.map(row=>row.after.language).sort()).toEqual(["en","es"]);
  } finally {
    await owner.query(`UPDATE company SET statement_language=NULL WHERE id='${companyB}'`);
    await owner.end();
  }
});

test("empty statements retain metadata; quotes, multiline text and formula cells remain safe", async () => {
 const owner = await fixture.connectAsOwner();
 try {
   await owner.query("UPDATE company SET name=$1 WHERE id=$2", [' +SUM(1,2)',companyA]);
   await owner.query("UPDATE statement_line SET note=$1 WHERE id=$2", ['A, \"quoted\"\nline',id(12)]);
   const csv=(await repository.exportCsv(authorization,statementA)).csv;
   expect(csv).toContain('"ALP ·  +SUM(1,2)"');
   expect(csv).toContain('"A, \"\"quoted\"\"\nline"\r\n');
   await owner.query("UPDATE statement_line SET note=$1 WHERE id=$2", ['\t=HYPERLINK("evil")',id(12)]);
   expect((await repository.exportCsv(authorization,statementA)).csv).toContain('"\'\t=HYPERLINK(""evil"")"');
   const empty=(await repository.exportCsv(authorization,id(20))).csv;
   expect(empty.split("\r\n")).toHaveLength(3);
   expect(empty).toContain(",2026-08,Borrador,0,0.00,");
 } finally {
   await owner.query("UPDATE company SET name='Alpha' WHERE id=$1",[companyA]);
   await owner.query("UPDATE statement_line SET note='Prorated' WHERE id=$1",[id(12)]);
   await owner.end();
 }
});

test("download boundary denies unauthenticated, viewers, employees, malformed, absent and foreign identifiers without an audit", async () => {
 const owner=await fixture.connectAsOwner();
 try {
 const before=(await owner.query("SELECT count(*) FROM audit_log")).rows[0].count;
 for(const [auth,statementId,status,expectedCode] of [
   [null,statementA,401,"UNAUTHORIZED"],
   [{...authorization,companyGrants:[{companyId:companyA,role:"viewer"}]},statementA,403,"STATEMENTS_ACCESS_FORBIDDEN"],
   [{...authorization,globalRole:null,companyGrants:[],roles:["employee"]},statementA,403,"STATEMENTS_ACCESS_FORBIDDEN"],
   [authorization,"invalid",400,"INVALID_STATEMENT_ID"],
   [authorization,id(999),404,"STATEMENT_NOT_FOUND"],
   [authorization,statementB,404,"STATEMENT_NOT_FOUND"],
 ] as const) {
   const response=await createStatementExportResponse(repository,auth as LedgerAuthorization|null,statementId);
   expect(response.status).toBe(status);
   expect(response.headers.get("cache-control")).toBe("private, no-store");
   expect(await response.json()).toEqual({error:expectedCode});
 }
 expect((await owner.query("SELECT count(*) FROM audit_log")).rows[0].count).toBe(before);
 expect(createStatementCsvDownload(authorization,statementA)).toEqual({downloadUrl:`/api/v1/statements/${statementA}/export/csv`});
 expect(()=>createStatementCsvDownload(null,statementA)).toThrow("UNAUTHORIZED");
 expect(()=>createStatementCsvDownload(authorization,"bad")).toThrow("INVALID_STATEMENT_ID");
 for (const globalRole of ["central_finance","group_admin"] as const) {
   const response=await createStatementExportResponse(repository,{...authorization,globalRole},statementB);
   expect(response.status).toBe(200);
   expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
   expect(response.headers.get("content-disposition")).toBe(`attachment; filename="statement-${statementB}-2026-07.csv"`);
   expect(await response.text()).toContain("Bob secret");
 }
 } finally {await owner.end();}
});

test("an audit insert failure prevents any successful download", async () => {
 const owner=await fixture.connectAsOwner();
 try {
 await owner.query("CREATE FUNCTION us037_reject_export() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'export audit unavailable'; END $$; CREATE TRIGGER us037_reject_export BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION us037_reject_export()");
 await expect(repository.exportCsv(authorization,statementA)).rejects.toThrow("export audit unavailable");
 await expect(createStatementExportResponse(repository,authorization,statementA)).rejects.toThrow("export audit unavailable");
 } finally {
 await owner.query("DROP TRIGGER us037_reject_export ON audit_log; DROP FUNCTION us037_reject_export()");await owner.end();
 }
});


test("a draft rerun cannot mix CSV header totals, line amounts and audit snapshot", async () => {
 const owner=await fixture.connectAsOwner();
 await owner.query(`ALTER TABLE company RENAME TO us037_company;
 CREATE FUNCTION us037_read_gate(input_name text) RETURNS text LANGUAGE plpgsql AS $$
 BEGIN PERFORM pg_advisory_xact_lock(370037); RETURN input_name; END $$;
 CREATE VIEW company AS SELECT id,code,statement_language,us037_read_gate(name) AS name FROM us037_company;
 GRANT SELECT ON company TO ledger_app; SELECT pg_advisory_lock(370037)`);
 let reading: ReturnType<typeof repository.exportCsv>|undefined;
 try {
  reading=repository.exportCsv(authorization,statementA);
  const deadline=performance.now()+10_000;
  while(true) {
   if((await owner.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=370037")).rowCount) break;
   if(performance.now()>deadline) throw new Error("CSV read did not reach snapshot barrier");
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  await owner.query(`BEGIN; UPDATE statement SET total_usd=27.29 WHERE id='${statementA}'; UPDATE statement_line SET amount_usd=31.29 WHERE id='${id(12)}'; COMMIT; SELECT pg_advisory_unlock(370037)`);
  const result=await reading;
  expect(result.csv).toContain(",0,17.29,");expect(result.csv).toContain(",60.00,21.29,");expect(result.csv).not.toContain("31.29");
  const audit=await owner.query("SELECT after FROM audit_log WHERE action='statement.export_csv' AND entity_id=$1 ORDER BY id",[statementA]);
  expect(audit.rows.every(row=>row.after.totalUsd === "17.29")).toBe(true);
 } finally {
  await owner.query("SELECT pg_advisory_unlock_all()");await reading?.catch(()=>undefined);
  await owner.query(`DROP VIEW company; DROP FUNCTION us037_read_gate(text); ALTER TABLE us037_company RENAME TO company;
   UPDATE statement SET total_usd=17.29 WHERE id='${statementA}'; UPDATE statement_line SET amount_usd=21.29 WHERE id='${id(12)}'`);
  await owner.end();
 }
});


test("negative draft totals remain signed numeric CSV metadata and exact audit values", async () => {
 const owner=await fixture.connectAsOwner();
 try {
  await owner.query("UPDATE statement SET total_usd=$1 WHERE id=$2",["-4.00",statementA]);
  const {csv}=await repository.exportCsv(authorization,statementA);
  const records=csv.trimEnd().split("\r\n").slice(1);
  expect(records.map(row=>row.split(",")[4])).toEqual(["-4.00","-4.00"]);
  expect(csv).not.toContain("Secret");
  const audit=await owner.query("SELECT company_id,after FROM audit_log WHERE action='statement.export_csv' AND entity_id=$1 AND after->>'totalUsd'=$2",[statementA,"-4.00"]);
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0].company_id).toBe(companyA);
  expect(audit.rows[0].after.totalUsd).toBe("-4.00");
 } finally {
  await owner.query("UPDATE statement SET total_usd=$1 WHERE id=$2",["17.29",statementA]);
  await owner.end();
 }
});
