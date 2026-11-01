import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { licenseAssignment, license_assignment_source_kind_enum } from "./schema";
import { createPostgresFixture, type PostgresFixture } from "./testing/postgres-container";

let fixture: PostgresFixture;
let owner: pg.Client;
beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
}, 150_000);
afterAll(async () => { await owner?.end(); await fixture?.stop(); });

test("US-095 preserves manual provenance in the committed enum and its Drizzle column", async () => {
  const labels = (await owner.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'license_assignment_source_kind_enum' ORDER BY e.enumsortorder`)).rows.map((row) => row.enumlabel);
  expect(labels).toEqual(["request", "import", "reconciliation", "manual"]);
  const column = (await owner.query("SELECT udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'license_assignment' AND column_name = 'source_kind'")).rows[0];
  expect(license_assignment_source_kind_enum.enumName).toBe(column.udt_name);
  expect(licenseAssignment.sourceKind.getSQLType()).toBe(column.udt_name);
  expect(license_assignment_source_kind_enum.enumValues).toEqual(labels);
  expect(licenseAssignment.sourceKind.enumValues).toEqual(labels);
  expect((await owner.query("SELECT 'manual'::license_assignment_source_kind_enum AS source")).rows[0].source).toBe("manual");
});
