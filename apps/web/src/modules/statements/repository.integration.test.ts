import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createRegisterRepository } from "../register/repository";
import { createStatementDetailRepository } from "./repository";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyA = id(2), companyB = id(3), statementA = id(10), statementB = id(11);
const authorization: LedgerAuthorization = {
  userId: id(1), userAccountId: id(1), idpSubject: "finance-a", globalRole: null,
  roles: ["company_finance"], companyIds: [companyA, companyB], employeeCompanyId: null,
  companyGrants: [{ companyId: companyA, role: "finance" }],
};
let fixture: PostgresFixture;
let pool: pg.Pool;
let repository: ReturnType<typeof createStatementDetailRepository>;
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
  `);
  await owner.end();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  repository = createStatementDetailRepository(drizzle(pool, { schema }));
});
afterAll(async () => { await pool?.end(); await fixture?.stop(); });

test("reads only license and adjustment lines and reuses exact register evidence", async () => {
  const result = await repository.find(authorization, statementA);
  expect(result?.statement.id).toBe(statementA);
  expect(result?.companyName).toBe("Alpha");
  expect(result?.lines.map(line => line.id)).toEqual([id(12), id(13)]);
  const line = result!.lines[0];
  expect([line.periodFrom, line.periodTo, line.licenseDays, line.rateUsd, line.amountUsd, line.note]).toEqual(["2026-07-10", "2026-07-20", 11, "60.00", "21.29", "Prorated"]);
  expect([line.personName, line.vendorAccountName, line.licenseTypeName]).toEqual(["Alice", "Organization", "Enterprise"]);
  expect(result!.lines[1].note).toBe("Correction required note");
  expect(result!.lines[1].amountUsd).toBe("-4.00");
  expect(result!.lines[1].assignment).toBeNull();
  const register = createRegisterRepository(drizzle(pool, { schema }));
  const evidence = await register.assignmentsById(authorization, [id(9), id(19)]);
  expect(evidence.map(row => row.id)).toEqual([id(9)]);
  expect(line.assignment).toEqual(evidence[0]);
  expect(line.assignment?.statementLines.map(row => row.id)).toEqual([id(12)]);
  expect([line.assignment?.startedOn, line.assignment?.endedOn, line.assignment?.note]).toEqual(["2026-07-10", "2026-07-20", "Register evidence"]);
  expect(await register.assignmentsById(authorization, [])).toEqual([]);
});

test("rejects foreign company, wrong role, missing and malformed statement IDs", async () => {
  expect(await repository.find(authorization, statementB)).toBeNull();
  expect(await repository.find(authorization, id(999))).toBeNull();
  expect(await repository.find(authorization, "bad-id")).toBeNull();
  expect(await repository.find({ ...authorization, companyGrants: [] }, statementA)).toBeNull();
  for (const role of ["finance", "approver", "viewer"] as const) {
    const scoped = { ...authorization, companyGrants: [{companyId: companyA, role}] };
    expect((await repository.find(scoped, statementA))?.lines[0].assignment?.id).toBe(id(9));
    expect(await repository.find(scoped, statementB)).toBeNull();
  }
  for (const globalRole of ["central_finance", "group_admin"] as const) {
    const result = await repository.find({ ...authorization, globalRole }, statementB);
    expect(result?.lines[0].personName).toBe("Bob secret");
    expect(result?.lines[0].assignment?.companyId).toBe(companyB);
  }
  expect((await repository.find(authorization, id(20)))?.lines).toEqual([]);
});


test("a concurrent draft rerun cannot mix the header snapshot with replacement lines", async () => {
  const owner = await fixture.connectAsOwner();
  await owner.query(`ALTER TABLE company RENAME TO us036_company;
    CREATE FUNCTION us036_read_gate(input_name text) RETURNS text LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(360036); RETURN input_name; END $$;
    CREATE VIEW company AS SELECT id, code, us036_read_gate(name) AS name FROM us036_company;
    GRANT SELECT ON company TO ledger_app;
    SELECT pg_advisory_lock(360036);`);
  let reading: ReturnType<typeof repository.find> | undefined;
  try {
    reading = repository.find(authorization, statementA);
    // The header's MVCC snapshot exists before its selected company name blocks.
    const deadline = performance.now() + 10_000;
    while (true) {
      const waiting = await owner.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=360036");
      if (waiting.rowCount) break;
      if (performance.now() > deadline) throw new Error("Statement read did not reach the lock barrier");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await owner.query(`BEGIN;
      UPDATE statement SET total_usd=27.29 WHERE id='${statementA}';
      UPDATE statement_line SET amount_usd=31.29 WHERE id='${id(12)}';
      COMMIT; SELECT pg_advisory_unlock(360036);`);
    const result = await reading;
    expect(result?.statement.totalUsd).toBe("17.29");
    expect(result?.lines[0].amountUsd).toBe("21.29");
    expect(result?.lines[0].assignment?.statementLines[0].amountUsd).toBe("21.29");
  } finally {
    await owner.query("SELECT pg_advisory_unlock_all()");
    await reading?.catch(() => undefined);
    await owner.query(`DROP VIEW company; DROP FUNCTION us036_read_gate(text); ALTER TABLE us036_company RENAME TO company;
      UPDATE statement SET total_usd=17.29 WHERE id='${statementA}';
      UPDATE statement_line SET amount_usd=21.29 WHERE id='${id(12)}';`);
    await owner.end();
  }
});


test("a legacy foreign assignment reference never becomes evidence for this statement company", async () => {
 const owner = await fixture.connectAsOwner();
 try {
  await owner.query(`INSERT INTO statement_line (id,statement_id,kind,person_id,vendor_account_id,license_type_id,assignment_id,license_days,rate_usd,amount_usd,period_from,period_to)
   VALUES ('${id(22)}','${statementA}','license','${id(7)}','${id(5)}','${id(6)}','${id(19)}',31,60,60,'2026-07-01','2026-07-31')`);
  for(const auth of [authorization,{...authorization,globalRole:"central_finance" as const}]) {
   const detail = await repository.find(auth,statementA);
   expect(detail?.lines.find(line=>line.id===id(22))?.assignment).toBeNull();
   expect(detail?.lines.flatMap(line=>line.assignment?[line.assignment.companyId]:[])).not.toContain(companyB);
  }
 } finally {await owner.query("DELETE FROM statement_line WHERE id=$1",[id(22)]);await owner.end();}
});
