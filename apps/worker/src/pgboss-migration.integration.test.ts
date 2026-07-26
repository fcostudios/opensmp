import { afterEach, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../packages/db/src/testing/postgres-container.js";

const fixtures: PostgresFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

describe("US-046 owner-applied pg-boss schema", () => {
  it("installs schema 37 with the exact ledger_app least-privilege boundary", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    try {
      await expect(owner.query("SELECT version FROM pgboss.version")).resolves.toMatchObject({
        rows: [{ version: 37 }],
      });
      await expect(owner.query(
        `SELECT
           pg_get_userbyid(namespace.nspowner) AS owner,
           has_schema_privilege('ledger_app', namespace.oid, 'USAGE') AS app_usage,
           has_schema_privilege('ledger_app', namespace.oid, 'CREATE') AS app_create
         FROM pg_namespace AS namespace
         WHERE namespace.nspname = 'pgboss'`,
      )).resolves.toMatchObject({
        rows: [{ app_create: false, app_usage: true, owner: "ledger_owner" }],
      });
      await expect(owner.query(
        `SELECT has_type_privilege('ledger_app', type.oid, 'USAGE') AS app_usage
         FROM pg_type AS type
         JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
         WHERE namespace.nspname = 'pgboss' AND type.typname = 'job_state'`,
      )).resolves.toMatchObject({ rows: [{ app_usage: true }] });
      await expect(owner.query(
        `SELECT
           (SELECT count(*)::int
            FROM pg_class AS class
            JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
            WHERE namespace.nspname = 'pgboss'
              AND pg_get_userbyid(class.relowner) = 'ledger_app') AS owned_relations,
           (SELECT count(*)::int
            FROM pg_proc AS procedure
            JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = 'pgboss'
              AND pg_get_userbyid(procedure.proowner) = 'ledger_app') AS owned_functions,
           (SELECT count(*)::int
            FROM pg_type AS type
            JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
            WHERE namespace.nspname = 'pgboss'
              AND pg_get_userbyid(type.typowner) = 'ledger_app') AS owned_types`,
      )).resolves.toMatchObject({
        rows: [{ owned_functions: 0, owned_relations: 0, owned_types: 0 }],
      });

      const tablePrivileges = await owner.query<{
        table_name: string;
        can_delete: boolean;
        can_insert: boolean;
        can_references: boolean;
        can_select: boolean;
        can_trigger: boolean;
        can_truncate: boolean;
        can_update: boolean;
      }>(
        `SELECT
           class.relname AS table_name,
           has_table_privilege('ledger_app', class.oid, 'SELECT') AS can_select,
           has_table_privilege('ledger_app', class.oid, 'INSERT') AS can_insert,
           has_table_privilege('ledger_app', class.oid, 'UPDATE') AS can_update,
           has_table_privilege('ledger_app', class.oid, 'DELETE') AS can_delete,
           has_table_privilege('ledger_app', class.oid, 'TRUNCATE') AS can_truncate,
           has_table_privilege('ledger_app', class.oid, 'REFERENCES') AS can_references,
           has_table_privilege('ledger_app', class.oid, 'TRIGGER') AS can_trigger
         FROM pg_class AS class
         JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
         WHERE namespace.nspname = 'pgboss' AND class.relkind IN ('r', 'p')
         ORDER BY class.relname`,
      );
      expect(tablePrivileges.rows.map(({ table_name: tableName }) => tableName)).toEqual(
        expect.arrayContaining([
          "bam",
          "job",
          "job_common",
          "job_dependency",
          "queue",
          "queue_stats",
          "schedule",
          "subscription",
          "version",
          "warning",
        ]),
      );
      const expectedDml: Record<string, {
        can_delete: boolean;
        can_insert: boolean;
        can_select: boolean;
        can_update: boolean;
      }> = {
        job: { can_delete: true, can_insert: true, can_select: true, can_update: true },
        job_common: { can_delete: true, can_insert: true, can_select: true, can_update: true },
        job_dependency: { can_delete: true, can_insert: false, can_select: true, can_update: false },
        queue: { can_delete: false, can_insert: true, can_select: true, can_update: false },
        schedule: { can_delete: false, can_insert: true, can_select: true, can_update: false },
        version: { can_delete: false, can_insert: false, can_select: true, can_update: false },
        worker_job_execution: { can_delete: false, can_insert: true, can_select: true, can_update: true },
        worker_runtime_health: { can_delete: false, can_insert: true, can_select: true, can_update: true },
      };
      for (const row of tablePrivileges.rows) {
        expect(row).toEqual({
          ...(expectedDml[row.table_name] ?? {
            can_delete: false,
            can_insert: false,
            can_select: false,
            can_update: false,
          }),
          can_references: false,
          table_name: row.table_name,
          can_trigger: false,
          can_truncate: false,
        });
      }
      expect(Object.keys(expectedDml).every((table) =>
        tablePrivileges.rows.some(({ table_name: tableName }) => tableName === table),
      )).toBe(true);
      await expect(owner.query(
        `SELECT
           has_column_privilege('ledger_app', 'pgboss.version', 'version', 'UPDATE') AS version_metadata,
           has_column_privilege('ledger_app', 'pgboss.version', 'cron_on', 'UPDATE') AS cron_gate,
           has_column_privilege('ledger_app', 'pgboss.version', 'flow_on', 'UPDATE') AS flow_gate,
           has_column_privilege('ledger_app', 'pgboss.version', 'bam_on', 'UPDATE') AS bam_gate`,
      )).resolves.toMatchObject({
        rows: [{ bam_gate: false, cron_gate: true, flow_gate: true, version_metadata: false }],
      });
      await expect(owner.query<{ column_name: string; table_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.column_privileges
         WHERE grantee = 'ledger_app'
           AND table_schema = 'pgboss'
           AND privilege_type = 'UPDATE'
           AND table_name IN ('queue', 'schedule', 'version')
         ORDER BY table_name, column_name`,
      )).resolves.toMatchObject({
        rows: [
          "active_count",
          "dead_letter",
          "deferred_count",
          "deletion_seconds",
          "expire_seconds",
          "failed_count",
          "heartbeat_seconds",
          "maintain_on",
          "monitor_on",
          "notify",
          "queued_count",
          "ready_count",
          "ready_history",
          "retention_seconds",
          "retry_backoff",
          "retry_delay",
          "retry_delay_max",
          "retry_limit",
          "singletons_active",
          "total_count",
          "updated_on",
          "warning_queued",
        ].map((column_name) => ({ column_name, table_name: "queue" })).concat([
          { column_name: "cron", table_name: "schedule" },
          { column_name: "data", table_name: "schedule" },
          { column_name: "options", table_name: "schedule" },
          { column_name: "timezone", table_name: "schedule" },
          { column_name: "updated_on", table_name: "schedule" },
          { column_name: "cron_on", table_name: "version" },
          { column_name: "flow_on", table_name: "version" },
        ]),
      });

      await expect(owner.query(
        `SELECT class.relname
         FROM pg_class AS class
         JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
         WHERE namespace.nspname = 'pgboss' AND class.relkind = 'S'`,
      )).resolves.toMatchObject({ rows: [] });
      await expect(owner.query(
        `SELECT
           procedure.proname,
           pg_get_function_identity_arguments(procedure.oid) AS arguments,
           has_function_privilege('ledger_app', procedure.oid, 'EXECUTE') AS app_execute
         FROM pg_proc AS procedure
         JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
         WHERE namespace.nspname = 'pgboss'
         ORDER BY procedure.proname`,
      )).resolves.toMatchObject({
        rows: [
          { app_execute: true, arguments: "queue_name text, options jsonb", proname: "create_queue" },
          { app_execute: false, arguments: "queue_name text", proname: "delete_queue" },
          { app_execute: false, arguments: "command text, table_name text", proname: "job_table_format" },
          {
            app_execute: false,
            arguments: "command text, tbl_name text, queue_name text",
            proname: "job_table_run",
          },
          {
            app_execute: false,
            arguments: "command_name text, version integer, command text, tbl_name text, queue_name text",
            proname: "job_table_run_async",
          },
        ],
      });

      await expect(app.query("CREATE TABLE pgboss.application_owned (id integer)")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("SELECT pgboss.delete_queue('not-authorized')")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("INSERT INTO pgboss.version(version) VALUES (38)")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("UPDATE pgboss.version SET version = 38")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("DELETE FROM pgboss.version")).rejects.toMatchObject({ code: "42501" });
      for (const [table, timestampColumn] of [["bam", "created_on"], ["warning", "created_on"], ["queue_stats", "captured_on"]]) {
        await expect(app.query(`INSERT INTO pgboss.${table} DEFAULT VALUES`)).rejects.toMatchObject({ code: "42501" });
        await expect(app.query(`UPDATE pgboss.${table} SET ${timestampColumn} = ${timestampColumn}`)).rejects.toMatchObject({ code: "42501" });
        await expect(app.query(`DELETE FROM pgboss.${table}`)).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);
});
