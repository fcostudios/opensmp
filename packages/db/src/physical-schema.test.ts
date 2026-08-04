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
  "identity_provider_operation",
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
        { table_name: "identity_provider_operation", is_nullable: "YES" },
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

  test("materializes the exact durable identity-provider operation lease and catalog contract", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    try {
      const columns = await owner.query(`
        SELECT
          attribute.attname AS name,
          format_type(attribute.atttypid, attribute.atttypmod) AS type,
          attribute.attnotnull AS not_null,
          pg_get_expr(default_value.adbin, default_value.adrelid) AS default_value
        FROM pg_attribute AS attribute
        LEFT JOIN pg_attrdef AS default_value
          ON default_value.adrelid = attribute.attrelid
          AND default_value.adnum = attribute.attnum
        WHERE attribute.attrelid = 'public.identity_provider_operation'::regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY attribute.attnum
      `);
      expect(columns.rows).toEqual([
        { name: "id", type: "uuid", not_null: true, default_value: "gen_random_uuid()" },
        { name: "idempotency_key", type: "text", not_null: true, default_value: null },
        { name: "kind", type: "text", not_null: true, default_value: null },
        { name: "status", type: "text", not_null: true, default_value: null },
        { name: "actor_user_id", type: "uuid", not_null: true, default_value: null },
        { name: "target_user_account_id", type: "uuid", not_null: false, default_value: null },
        { name: "company_id", type: "uuid", not_null: false, default_value: null },
        { name: "provider_subject", type: "text", not_null: false, default_value: null },
        { name: "payload", type: "jsonb", not_null: true, default_value: null },
        { name: "attempt_count", type: "integer", not_null: true, default_value: "0" },
        { name: "last_attempted_at", type: "timestamp with time zone", not_null: false, default_value: null },
        { name: "next_retry_at", type: "timestamp with time zone", not_null: false, default_value: null },
        { name: "original_failure", type: "text", not_null: false, default_value: null },
        { name: "cleanup_failure", type: "text", not_null: false, default_value: null },
        { name: "created_at", type: "timestamp with time zone", not_null: true, default_value: null },
        { name: "completed_at", type: "timestamp with time zone", not_null: false, default_value: null },
        { name: "lease_token", type: "uuid", not_null: false, default_value: null },
        { name: "lease_expires_at", type: "timestamp with time zone", not_null: false, default_value: null },
      ]);

      const checks = await owner.query(`
        SELECT conname AS name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.identity_provider_operation'::regclass
          AND contype = 'c'
        ORDER BY conname
      `);
      expect(checks.rows).toEqual([
        { name: "identity_provider_operation_attempt_count_check", definition: "CHECK ((attempt_count >= 0))" },
        { name: "identity_provider_operation_kind_check", definition: "CHECK ((kind = ANY (ARRAY['create_user'::text, 'disable_user'::text, 'reset_two_factor'::text])))" },
        { name: "identity_provider_operation_lease_pair_check", definition: "CHECK ((((lease_token IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL))))" },
        { name: "identity_provider_operation_status_check", definition: "CHECK ((status = ANY (ARRAY['pending'::text, 'provider_applied'::text, 'cleanup_pending'::text, 'compensated'::text, 'completed'::text, 'failed'::text])))" },
      ]);

      const foreignKeys = await owner.query(`
        SELECT conname AS name, confrelid::regclass::text AS target, confupdtype AS on_update, confdeltype AS on_delete
        FROM pg_constraint
        WHERE conrelid = 'public.identity_provider_operation'::regclass
          AND contype = 'f'
        ORDER BY conname
      `);
      expect(foreignKeys.rows).toEqual([
        { name: "identity_provider_operation_actor_user_id_fkey", target: "user_account", on_update: "a", on_delete: "a" },
        { name: "identity_provider_operation_company_id_fkey", target: "company", on_update: "a", on_delete: "a" },
        { name: "identity_provider_operation_target_user_account_id_fkey", target: "user_account", on_update: "a", on_delete: "a" },
      ]);

      const relation = await owner.query(`
        SELECT pg_get_userbyid(relowner) AS owner
        FROM pg_class
        WHERE oid = 'public.identity_provider_operation'::regclass
      `);
      expect(relation.rows).toEqual([{ owner: "ledger_owner" }]);
      const grants = await owner.query(`
        SELECT privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'identity_provider_operation'
          AND grantee = 'ledger_app'
        ORDER BY privilege_type
      `);
      expect(grants.rows).toEqual([
        { privilege_type: "INSERT" },
        { privilege_type: "SELECT" },
        { privilege_type: "UPDATE" },
      ]);

      const retryIndex = await owner.query(`
        SELECT
          index_state.indisready AS ready,
          index_state.indisvalid AS valid,
          ARRAY(
            SELECT attribute.attname
            FROM unnest(index_state.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
            JOIN pg_attribute AS attribute
              ON attribute.attrelid = index_state.indrelid
              AND attribute.attnum = key.attnum
            ORDER BY key.position
          )::text[] AS columns,
          pg_get_expr(index_state.indpred, index_state.indrelid) AS predicate
        FROM pg_index AS index_state
        JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
        WHERE index_state.indrelid = 'public.identity_provider_operation'::regclass
          AND index_relation.relname = 'idx_identity_provider_operation_retry'
      `);
      expect(retryIndex.rows).toEqual([{
        ready: true,
        valid: true,
        columns: ["next_retry_at", "created_at"],
        predicate: "(status = ANY (ARRAY['pending'::text, 'provider_applied'::text, 'cleanup_pending'::text]))",
      }]);
    } finally {
      await owner.end();
    }
  }, 150_000);
});
