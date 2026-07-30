import { afterEach, describe, expect, test } from "vitest";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container";

const fixtures: PostgresFixture[] = [];

const expectedTables = [
  "activity_record",
  "alert_event",
  "alert_notification_delivery",
  "alert_rule",
  "audit_log",
  "close_run",
  "company",
  "company_role_assignment",
  "cost_record",
  "integration_credential",
  "license_assignment",
  "license_request",
  "license_type",
  "lifecycle_notification",
  "lifecycle_notification_delivery",
  "person",
  "provisioning_action",
  "rate_card",
  "reclamation_proposal",
  "reconciliation",
  "reconciliation_variance_line",
  "request_transition",
  "statement",
  "statement_line",
  "system_setting",
  "user_account",
  "vendor",
  "vendor_account",
  "vendor_account_capacity",
];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

describe("US-003 physical schema parity", () => {
  test("materializes the domain plus durable-notification tables and documented company scope", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    try {
      const tables = await owner.query<{ table_name: string }>(`
        SELECT relation.relname AS table_name
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname <> 'ledger_schema_migrations'
        ORDER BY relation.relname
      `);
      const companyColumns = await owner.query<{
        is_nullable: "YES" | "NO";
        table_name: string;
      }>(`
        SELECT table_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'company_id'
        ORDER BY table_name
      `);
      const inheritedScopes = await owner.query<{
        source_table: string;
        target_table: string;
      }>(`
        SELECT source_relation.relname AS source_table, target_relation.relname AS target_table
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS source_relation ON source_relation.oid = constraint_row.conrelid
        JOIN pg_class AS target_relation ON target_relation.oid = constraint_row.confrelid
        JOIN pg_namespace AS namespace ON namespace.oid = source_relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND constraint_row.contype = 'f'
          AND (
            (source_relation.relname = 'request_transition' AND target_relation.relname = 'license_request')
            OR (source_relation.relname = 'statement_line' AND target_relation.relname = 'statement')
          )
        ORDER BY source_relation.relname
      `);
      const directCompanyScopes = await owner.query<{
        source_table: string;
        target_table: string;
      }>(`
        SELECT source_relation.relname AS source_table, target_relation.relname AS target_table
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS source_relation ON source_relation.oid = constraint_row.conrelid
        JOIN pg_class AS target_relation ON target_relation.oid = constraint_row.confrelid
        JOIN pg_namespace AS namespace ON namespace.oid = source_relation.relnamespace
        JOIN LATERAL unnest(constraint_row.conkey) AS source_key(attnum) ON true
        JOIN pg_attribute AS source_column
          ON source_column.attrelid = constraint_row.conrelid
          AND source_column.attnum = source_key.attnum
        WHERE namespace.nspname = 'public'
          AND constraint_row.contype = 'f'
          AND target_relation.relname = 'company'
          AND source_column.attname = 'company_id'
          AND source_relation.relname IN (
            'company_role_assignment',
            'license_assignment',
            'license_request',
            'lifecycle_notification',
            'person',
            'statement'
          )
        ORDER BY source_relation.relname
      `);

      expect(tables.rows.map(({ table_name }) => table_name)).toEqual(expectedTables);
      expect(companyColumns.rows).toEqual([
        { table_name: "alert_rule", is_nullable: "YES" },
        { table_name: "audit_log", is_nullable: "YES" },
        { table_name: "company_role_assignment", is_nullable: "NO" },
        { table_name: "license_assignment", is_nullable: "NO" },
        { table_name: "license_request", is_nullable: "NO" },
        { table_name: "lifecycle_notification", is_nullable: "NO" },
        { table_name: "person", is_nullable: "NO" },
        { table_name: "statement", is_nullable: "NO" },
      ]);
      expect(inheritedScopes.rows).toEqual([
        { source_table: "request_transition", target_table: "license_request" },
        { source_table: "statement_line", target_table: "statement" },
      ]);
      expect(directCompanyScopes.rows).toEqual([
        { source_table: "company_role_assignment", target_table: "company" },
        { source_table: "license_assignment", target_table: "company" },
        { source_table: "license_request", target_table: "company" },
        { source_table: "lifecycle_notification", target_table: "company" },
        { source_table: "person", target_table: "company" },
        { source_table: "statement", target_table: "company" },
      ]);
    } finally {
      await owner.end();
    }
  }, 150_000);
});
