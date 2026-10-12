import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { readFile, readdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { vendor, vendorAccount, licenseType, memberObservation } from "./schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtures: PostgresFixture[] = [];

const expectedTables = [
  "activity_record",
  "alert_event",
  "alert_notification_delivery",
  "alert_rule",
  "audit_log",
  "capacity_recovery_work",
  "close_run",
  "company",
  "company_role_assignment",
  "connector_call_observation",
  "cost_record",
  "identity_provider_operation",
  "integration_credential",
  "license_assignment",
  "license_request",
  "license_type",
  "lifecycle_notification",
  "lifecycle_notification_delivery",
  "member_observation",
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
  test("US-057 release and central verification reject newline-commented validation", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const accountId = "00000000-0000-0000-0000-000000000457";
    const verify = () => promisify(execFile)(process.execPath, ["scripts/verify-schema.mjs"], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_ADMIN_URL: fixture.ownerUrl, DATABASE_URL: fixture.appUrl },
    });
    try {
      expect((await verify()).stdout).toContain("✓ ledger_app has the exact least-privilege runtime grant matrix");
      await owner.query(`INSERT INTO vendor (id, name, connector_type, provisioning_protocol, can_provision,
        can_deprovision, has_usage_data, has_cost_data, identity_matching, status, created_at, created_by)
        VALUES ($1, 'Whitespace fixture', 'api', 'rest', true, true, true, true, 'email', 'active',
          '2026-09-06', '00000000-0000-0000-0000-000000000001')`, [accountId]);
      await owner.query(`INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
        VALUES ($1, $1, 'Whitespace fixture', 'automated', 0, 'active', '2026-09-06',
          '00000000-0000-0000-0000-000000000001')`, [accountId]);
      const insertNonsequential = () => app.query(`INSERT INTO connector_call_observation
        (vendor_account_id, correlation_id, operation, attempt, phase, summary, occurred_at)
        VALUES ($1, $1, 'sync_members', 2, 'requested', '{}', '2026-09-06') RETURNING attempt`, [accountId]);
      await expect(insertNonsequential()).rejects.toMatchObject({ code: "23514" });
      const sourceRows = await owner.query<{ prosrc: string }>(
        "SELECT prosrc FROM pg_proc WHERE oid = 'public.validate_connector_call_observation()'::regprocedure",
      );
      const permissiveSource = sourceRows.rows[0]!.prosrc.replace(/(--[^\n]*\n[\s\S]*?)(?=\n  RETURN NEW;)/,
        (validation) => validation.replaceAll("\n", " "));
      await owner.query(`CREATE OR REPLACE FUNCTION public.validate_connector_call_observation()
        RETURNS trigger LANGUAGE plpgsql AS $tampered$${permissiveSource}$tampered$`);
      expect((await insertNonsequential()).rows).toEqual([{ attempt: 2 }]);
      const directory = new URL("./migrations/", import.meta.url);
      const assertions = await Promise.all((await readdir(directory))
        .filter((filename) => filename.includes("__verify_connector_call_observation"))
        .sort().map((filename) => readFile(new URL(filename, directory), "utf8")));
      await expect.soft(owner.query(assertions.join("\n"))).rejects.toMatchObject({
        code: "P0001", message: "connector call validator source mismatch",
      });
      await expect.soft(verify()).rejects.toMatchObject({
        code: 1, stderr: expect.stringContaining("connector call validator source mismatch"),
      });
    } finally {
      await Promise.all([owner.end(), app.end()]);
    }
  }, 150_000);

  test("US-057 release verification rejects journal catalog and enforcement drift", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    try {
      const columns = await owner.query(`SELECT column_name, udt_name, is_nullable
        FROM information_schema.columns WHERE table_name = 'connector_call_observation' ORDER BY ordinal_position`);
      expect(columns.rows.map(({ column_name, udt_name, is_nullable }) => [column_name, udt_name, is_nullable])).toEqual([
        ["id", "uuid", "NO"], ["vendor_account_id", "uuid", "NO"], ["provisioning_action_id", "uuid", "YES"],
        ["correlation_id", "uuid", "NO"], ["operation", "connector_call_operation_enum", "NO"], ["attempt", "int4", "NO"],
        ["phase", "connector_call_phase_enum", "NO"], ["classification", "text", "YES"], ["summary", "jsonb", "NO"], ["occurred_at", "timestamptz", "NO"],
      ]);
      const enums = await owner.query(`SELECT typname, array_agg(enumlabel ORDER BY enumsortorder)::text[] AS values
        FROM pg_type JOIN pg_enum ON enumtypid = pg_type.oid
        WHERE typname IN ('connector_call_operation_enum', 'connector_call_phase_enum') GROUP BY typname ORDER BY typname`);
      expect(enums.rows).toEqual([
        { typname: "connector_call_operation_enum", values: ["provision", "deprovision", "sync_members", "sync_activity", "sync_cost"] },
        { typname: "connector_call_phase_enum", values: ["requested", "succeeded", "failed"] },
      ]);
      const release = await owner.query(`SELECT filename FROM ledger_schema_migrations WHERE filename LIKE 'V20260804120%' ORDER BY filename`);
      expect(release.rows.slice(-3)).toEqual([
        { filename: "V20260804120200__connector_call_observation.sql" },
        { filename: "V20260804120300__verify_connector_call_observation.sql" },
        { filename: "V20260804120400__verify_connector_call_observation_source.sql" },
      ]);
      const verifier = await readFile(new URL("./migrations/V20260804120300__verify_connector_call_observation.sql", import.meta.url), "utf8");
      const mutations = [
        "DROP TABLE connector_call_observation",
        "ALTER TABLE connector_call_observation ALTER COLUMN summary DROP NOT NULL",
        "ALTER TYPE connector_call_phase_enum RENAME VALUE 'failed' TO 'failure'",
        "ALTER TABLE connector_call_observation DROP CONSTRAINT connector_call_attempt_check",
        "ALTER TABLE connector_call_observation DROP CONSTRAINT connector_call_observation_vendor_account_id_fkey",
        "ALTER TABLE connector_call_observation DROP CONSTRAINT uq_connector_call_phase",
        "DROP INDEX uq_connector_call_terminal",
        "DROP INDEX idx_connector_call_operation",
        "ALTER TABLE connector_call_observation DISABLE TRIGGER trg_connector_call_validate",
        "ALTER TABLE connector_call_observation DISABLE TRIGGER trg_connector_call_append_only",
        "CREATE OR REPLACE FUNCTION validate_connector_call_observation() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'",
        "GRANT UPDATE ON connector_call_observation TO ledger_app",
        "GRANT SELECT ON connector_call_observation TO PUBLIC",
        "ALTER FUNCTION validate_connector_call_observation() STABLE",
        "GRANT EXECUTE ON FUNCTION validate_connector_call_observation() TO PUBLIC",
      ];
      for (const mutation of mutations) {
        await owner.query("BEGIN");
        try {
          await owner.query(mutation);
          await expect(owner.query(verifier)).rejects.toMatchObject({ code: "P0001" });
        } finally {
          await owner.query("ROLLBACK");
        }
      }
      const verify = () => promisify(execFile)(process.execPath, ["scripts/verify-schema.mjs"], {
      cwd: packageRoot,
        env: { ...process.env, DATABASE_ADMIN_URL: fixture.ownerUrl, DATABASE_URL: fixture.appUrl },
      });
      expect((await verify()).stdout).toContain("✓");
      await owner.query("ALTER TABLE connector_call_observation DISABLE TRIGGER trg_connector_call_validate");
      await expect(verify()).rejects.toMatchObject({ code: 1 });
    } finally {
      await owner.end();
    }
  }, 150_000);

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


describe("US-083 observation catalog and immutable ledger", () => {
  test("bootstraps authoritative Anthropic capability and enforces the fresh account ledger", async () => {
    const fixture = await createPostgresFixture(); fixtures.push(fixture);
    const previousMigrations = await mkdtemp(join(tmpdir(), "us083-prior-migrations-"));
    const migrationDirectory = new URL("./migrations/", import.meta.url);
    try {
      for (const filename of await readdir(migrationDirectory)) {
        if (filename.endsWith(".sql") && !filename.endsWith("__member_observations.sql")) await copyFile(new URL(filename,migrationDirectory),join(previousMigrations,filename));
      }
      await promisify(execFile)(process.execPath,["scripts/apply-migrations.mjs"], { cwd: packageRoot, env: {
        ...process.env,DATABASE_ADMIN_URL:fixture.ownerUrl,DATABASE_URL:fixture.appUrl,MIGRATIONS_DIR:previousMigrations,
      }});
      const existing = await fixture.connectAsOwner();
      try { await existing.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,
        can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
        VALUES ('00000000-0000-0000-0000-000000000083','Anthropic','api','rest',true,true,true,true,'email','active','2026-10-11','00000000-0000-0000-0000-000000000001')`); }
      finally { await existing.end(); }
    } finally { await rm(previousMigrations,{recursive:true,force:true}); }
    await fixture.migrate();
    const owner = await fixture.connectAsOwner(); const app = await fixture.connectAsApp();
    const account = "00000000-0000-0000-0000-000000000083";
    const other = "00000000-0000-0000-0000-000000000084";
    const actor = "00000000-0000-0000-0000-000000000001";
    try {
      // Compare the application declarations with the independent committed PostgreSQL catalog.
      // This observes schema-static mutants; SQL-only enforcement checks below cannot do so.
      const dialect = new PgDialect();
      const targets = [
        { name: "vendor", table: vendor, columns: [vendor.memberSeatEvidence, vendor.memberLicenseIdentity] },
        { name: "vendor_account", table: vendorAccount, columns: [vendorAccount.defaultLicenseTypeId] },
        { name: "license_type", table: licenseType, columns: [licenseType.providerRef] },
        { name: "member_observation", table: memberObservation, columns: getTableConfig(memberObservation).columns },
      ];
      for (const { name, table, columns } of targets) {
        expect(getTableName(table)).toBe(name);
        const catalog = await app.query<{
          name: string; type: string; notNull: boolean; defaultExpression: string | null; enumValues: string[];
        }>(`SELECT attribute.attname AS name,
                  format_type(attribute.atttypid, attribute.atttypmod) AS type,
                  attribute.attnotnull AS "notNull",
                  pg_get_expr(column_default.adbin, column_default.adrelid) AS "defaultExpression",
                  ARRAY(SELECT enum_value.enumlabel::text FROM pg_enum enum_value
                        WHERE enum_value.enumtypid = attribute.atttypid
                        ORDER BY enum_value.enumsortorder) AS "enumValues"
           FROM pg_attribute attribute
           LEFT JOIN pg_attrdef column_default ON column_default.adrelid = attribute.attrelid
             AND column_default.adnum = attribute.attnum
           WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped
           ORDER BY attribute.attnum`, [`public.${name}`]);
        if (name === "member_observation") expect(columns.map(column => column.name)).toEqual(catalog.rows.map(column => column.name));
        for (const column of columns) {
          const actual = catalog.rows.find(row => row.name === column.name);
          expect(actual, `${name}.${column.name} exists`).toBeDefined();
          expect(column.getSQLType()).toBe(actual!.type);
          expect(column.notNull).toBe(actual!.notNull);
          expect(column.hasDefault).toBe(actual!.defaultExpression !== null);
          if ("enumValues" in column) expect(column.enumValues ?? []).toEqual(actual!.enumValues);
          if (actual!.defaultExpression !== null) {
            // Compare constant defaults by evaluated value; UUID expressions by function identity.
            if (column.default instanceof SQL) {
              expect(dialect.sqlToQuery(column.default).sql.replaceAll('"', "")).toBe(actual!.defaultExpression);
            } else {
              const databaseValue = await app.query<{ value: string }>(`SELECT (${actual!.defaultExpression})::text AS value`);
              const applicationValue = Array.isArray(column.default)
                ? await app.query<{ value: string }>("SELECT $1::jsonb::text AS value", [JSON.stringify(column.default)])
                : await app.query<{ value: string }>("SELECT $1::text AS value", [column.default]);
              expect(applicationValue.rows).toEqual(databaseValue.rows);
            }
          }
        }
      }
      for (const { name, table, columns } of targets.filter(target => target.name !== "vendor")) {
        const config = getTableConfig(table);
        const names = columns.map(column => column.name);
        const keys = await app.query<{ columns: string[]; foreignTable: string; foreignColumns: string[] }>(`
          SELECT ARRAY(SELECT attribute.attname::text FROM unnest(key.conkey) WITH ORDINALITY part(num, position)
                       JOIN pg_attribute attribute ON attribute.attrelid = key.conrelid AND attribute.attnum = part.num
                       ORDER BY part.position) AS columns,
                 relation.relname AS "foreignTable",
                 ARRAY(SELECT attribute.attname::text FROM unnest(key.confkey) WITH ORDINALITY part(num, position)
                       JOIN pg_attribute attribute ON attribute.attrelid = key.confrelid AND attribute.attnum = part.num
                       ORDER BY part.position) AS "foreignColumns"
          FROM pg_constraint key JOIN pg_class relation ON relation.oid = key.confrelid
          WHERE key.conrelid = $1::regclass AND key.contype = 'f'`, [`public.${name}`]);
        const relevant = (key: { columns: string[] }) => key.columns.some(column => names.includes(column));
        const sortKeys = <T extends { columns: string[] }>(keys: T[]) => keys.sort((left, right) => left.columns.join().localeCompare(right.columns.join()));
        expect(sortKeys(config.foreignKeys.map(key => ({
          columns: key.reference().columns.map(column => column.name),
          foreignTable: getTableName(key.reference().foreignTable),
          foreignColumns: key.reference().foreignColumns.map(column => column.name),
        })).filter(relevant))).toEqual(sortKeys(keys.rows.filter(relevant)));
        const unique = await app.query<{ name: string; columns: string[] }>(`
          SELECT key.conname AS name,
                 ARRAY(SELECT attribute.attname::text FROM unnest(key.conkey) WITH ORDINALITY part(num, position)
                       JOIN pg_attribute attribute ON attribute.attrelid = key.conrelid AND attribute.attnum = part.num
                       ORDER BY part.position) AS columns
          FROM pg_constraint key WHERE key.conrelid = $1::regclass AND key.contype = 'u'`, [`public.${name}`]);
        expect(sortKeys(config.uniqueConstraints.map(key => ({ name: key.name, columns: key.columns.map(column => column.name) })).filter(relevant)))
          .toEqual(sortKeys(unique.rows.filter(relevant)));
      }
      const observationConfig = getTableConfig(memberObservation);
      const primary = await app.query<{ columns: string[] }>(`SELECT ARRAY(
        SELECT attribute.attname::text FROM unnest(key.conkey) WITH ORDINALITY part(num, position)
        JOIN pg_attribute attribute ON attribute.attrelid = key.conrelid AND attribute.attnum = part.num
        ORDER BY part.position) AS columns FROM pg_constraint key
        WHERE key.conrelid = 'public.member_observation'::regclass AND key.contype = 'p'`);
      expect(observationConfig.columns.filter(column => column.primary).map(column => column.name)).toEqual(primary.rows[0].columns);
      const checks = await app.query<{ name: string; expression: string }>(`SELECT conname AS name,
        pg_get_expr(conbin, conrelid) AS expression FROM pg_constraint
        WHERE conrelid = 'public.member_observation'::regclass AND contype = 'c' ORDER BY conname`);
      const normalizeCheck = (value: string) => value.replaceAll('"member_observation".', "")
        .replace(/::text/g, "").replace(/[\s()"]/g, "");
      expect(observationConfig.checks.map(check => ({ name: check.name,
        expression: normalizeCheck(dialect.sqlToQuery(check.value).sql) })).sort((left, right) => (left.name ?? "").localeCompare(right.name ?? "")))
        .toEqual(checks.rows.map(check => ({ ...check, expression: normalizeCheck(check.expression) })));
      const indexes = await app.query<{ name: string; columns: string[]; unique: boolean }>(`
        SELECT relation.relname AS name, index.indisunique AS unique,
          ARRAY(SELECT attribute.attname::text FROM unnest(index.indkey) WITH ORDINALITY part(num, position)
                JOIN pg_attribute attribute ON attribute.attrelid = index.indrelid AND attribute.attnum = part.num
                ORDER BY part.position) AS columns
        FROM pg_index index JOIN pg_class relation ON relation.oid = index.indexrelid
        WHERE index.indrelid = 'public.member_observation'::regclass
          AND NOT EXISTS (SELECT 1 FROM pg_constraint key WHERE key.conindid = index.indexrelid)
        ORDER BY relation.relname`);
      expect(observationConfig.indexes.map(({ config }) => ({ name: config.name, unique: config.unique,
        columns: config.columns.map(column => "name" in column ? column.name : undefined) }))
        .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""))).toEqual(indexes.rows);
      for (const [id, name] of [["00000000-0000-0000-0000-000000000085", "ANTHROPIC"], [other, "Other provider"]]) {
        await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,
          can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
          VALUES ($1,$2,'api','rest',true,true,true,true,'email','active','2026-10-11',$3)`, [id,name,actor]);
      }
      expect((await app.query(`SELECT name,member_seat_evidence,member_license_identity FROM vendor ORDER BY name`)).rows).toEqual([
        { name: "ANTHROPIC", member_seat_evidence: "all_members_licensed", member_license_identity: "none" },
        { name: "Anthropic", member_seat_evidence: "all_members_licensed", member_license_identity: "none" },
        { name: "Other provider", member_seat_evidence: "none", member_license_identity: "none" },
      ]);
      await owner.query(`UPDATE vendor SET member_seat_evidence='none' WHERE id=$1`, [account]);
      expect((await app.query(`SELECT member_seat_evidence FROM vendor WHERE id=$1`, [account])).rows).toEqual([{ member_seat_evidence: "none" }]);
      const addLicense = (id: string,vendorId: string,reference: string|null) => owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by,provider_ref)
        VALUES ($1::uuid,$2,$1::text,'seat','active','2026-10-11',$3,$4) RETURNING provider_ref`,[id,vendorId,actor,reference]);
      const licA="00000000-0000-0000-0000-000000000086",licB="00000000-0000-0000-0000-000000000087";
      expect((await addLicense(licA,account,"provider-plan")).rows).toEqual([{provider_ref:"provider-plan"}]);
      await expect(addLicense(licB,account,"provider-plan")).rejects.toMatchObject({code:"23505"});
      expect((await addLicense(licB,other,"provider-plan")).rows).toEqual([{provider_ref:"provider-plan"}]);
      for (const id of ["00000000-0000-0000-0000-000000000088","00000000-0000-0000-0000-000000000089"]) {
        expect((await addLicense(id,account,null)).rows).toEqual([{provider_ref:null}]);
      }
      await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
        VALUES ($1,$1,'Observation fixture','automated',0,'active','2026-10-11',$2)`, [account,actor]);
      await expect(owner.query(`UPDATE vendor_account SET default_license_type_id=$2 WHERE id=$1`, [account,other])).rejects.toMatchObject({ code: "23503" });
      const insert = (time: string, count=0, hash="a".repeat(64), target=account) => app.query(`INSERT INTO member_observation
        (vendor_account_id,source,observed_at,content_hash,member_count,licensed_count,invited_count,warnings,accepted_at)
        VALUES ($1,'api',$2,$3,$4,0,0,'[]','2026-10-11') RETURNING vendor_account_id,member_count,warnings`, [target,time,hash,count]);
      expect((await insert("2026-10-11T00:00:00Z")).rows).toEqual([{ vendor_account_id: account, member_count: 0, warnings: [] }]);
      await expect(insert("2026-10-11T00:00:00Z")).rejects.toMatchObject({ code: "23505" });
      await expect(insert("2026-10-11T01:00:00Z",-1)).rejects.toMatchObject({ code: "23514" });
      await expect(insert("2026-10-11T01:00:00Z",0,"bad hash")).rejects.toMatchObject({ code: "23514" });
      await expect(insert("2026-10-11T01:00:00Z",0,"a".repeat(64),other)).rejects.toMatchObject({ code: "42501" });
      for (const sql of ["UPDATE member_observation SET warnings='[]'", "DELETE FROM member_observation", "TRUNCATE member_observation"]) {
        await expect(app.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
      for (const sql of ["UPDATE member_observation SET warnings='[]'", "DELETE FROM member_observation"]) {
        await expect(owner.query(sql)).rejects.toMatchObject({ code: "55000" });
      }
      expect((await owner.query(`SELECT relrowsecurity FROM pg_class WHERE oid='member_observation'::regclass`)).rows).toEqual([{ relrowsecurity: true }]);
      expect((await owner.query(`SELECT cmd,roles::text[] AS roles FROM pg_policies WHERE tablename='member_observation' ORDER BY cmd`)).rows).toEqual([
        { cmd: "INSERT", roles: ["ledger_app"] }, { cmd: "SELECT", roles: ["ledger_app"] },
      ]);
      const verified = await promisify(execFile)(process.execPath,["scripts/verify-schema.mjs"], {
      cwd: packageRoot,
        env: { ...process.env,DATABASE_ADMIN_URL:fixture.ownerUrl,DATABASE_URL:fixture.appUrl },
      });
      expect(verified.stdout).toContain("✓ ledger_app has the exact least-privilege runtime grant matrix");
      for (const [mutation,restore] of [
        ["ALTER TABLE member_observation DISABLE ROW LEVEL SECURITY","ALTER TABLE member_observation ENABLE ROW LEVEL SECURITY"],
        ["ALTER POLICY member_observation_catalog_select ON member_observation USING (EXISTS (SELECT 1 FROM vendor_account WHERE id=vendor_account_id) OR TRUE)","ALTER POLICY member_observation_catalog_select ON member_observation USING (EXISTS (SELECT 1 FROM vendor_account WHERE id=vendor_account_id))"],
        ["ALTER POLICY member_observation_catalog_insert ON member_observation WITH CHECK (EXISTS (SELECT 1 FROM vendor_account WHERE id=vendor_account_id) OR TRUE)","ALTER POLICY member_observation_catalog_insert ON member_observation WITH CHECK (EXISTS (SELECT 1 FROM vendor_account WHERE id=vendor_account_id))"],
        ["ALTER TABLE member_observation DISABLE TRIGGER trg_member_observation_append_only","ALTER TABLE member_observation ENABLE TRIGGER trg_member_observation_append_only"],
        ["ALTER TABLE vendor DISABLE TRIGGER trg_vendor_member_capability_bootstrap","ALTER TABLE vendor ENABLE TRIGGER trg_vendor_member_capability_bootstrap"],
        ["GRANT UPDATE ON member_observation TO ledger_app","REVOKE UPDATE ON member_observation FROM ledger_app"],
      ]) {
        await owner.query(mutation);
        try { await expect(promisify(execFile)(process.execPath,["scripts/verify-schema.mjs"],{
          cwd: packageRoot,
          env: {...process.env,DATABASE_ADMIN_URL:fixture.ownerUrl,DATABASE_URL:fixture.appUrl},
        })).rejects.toMatchObject({code:1}); }
        finally { await owner.query(restore); }
      }

    } finally { await Promise.all([owner.end(),app.end()]); }
  }, 150_000);
});
