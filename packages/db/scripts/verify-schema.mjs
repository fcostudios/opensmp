import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { committedMigrations } from "./apply-migrations.mjs";

const explicitEnvironment = {
  DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  MIGRATIONS_DIR: process.env.MIGRATIONS_DIR,
};
config({ path: ".env" });
config({ path: ".env.local", override: true });
for (const [key, value] of Object.entries(explicitEnvironment)) {
  if (value !== undefined) process.env[key] = value;
}

const expectedAppendOnlyTriggers = [
  {
    tableName: "audit_log",
    triggerName: "audit_log_no_mutate",
    functionName: "audit_log_append_only",
    functionSource:
      "BEGIN RAISE EXCEPTION 'append_only: % is forbidden on audit_log', TG_OP; END;",
  },
  {
    tableName: "request_transition",
    triggerName: "request_transition_no_mutate",
    functionName: "request_transition_append_only",
    functionSource:
      "BEGIN RAISE EXCEPTION 'append_only: % is forbidden on request_transition', TG_OP; END;",
  },
];

export async function verifyMigratedSchema({
  databaseAdminUrl = process.env.DATABASE_ADMIN_URL,
  applicationUrl = process.env.DATABASE_URL,
  migrationsDirectory = process.env.MIGRATIONS_DIR,
} = {}) {
  if (!databaseAdminUrl) {
    throw new Error(
      "DATABASE_ADMIN_URL is required to verify committed migrations as ledger_owner",
    );
  }
  if (!applicationUrl) {
    throw new Error(
      "DATABASE_URL is required to verify ledger_app runtime grants",
    );
  }

  const owner = new pg.Client({
    connectionString: databaseAdminUrl,
    application_name: "ledger-schema-verifier",
  });
  await owner.connect();
  let ownerName;
  let tableCount;
  let migrationCount;
  try {
    const identity = await owner.query("SELECT current_user");
    ownerName = identity.rows[0]?.current_user;
    if (ownerName !== "ledger_owner") {
      throw new Error(
        `DATABASE_ADMIN_URL must connect as ledger_owner, connected as ${ownerName}`,
      );
    }
    const tables = await owner.query(`
      SELECT count(*)::int AS count
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
    `);
    tableCount = Number(tables.rows[0]?.count ?? 0);
    if (tableCount === 0) {
      throw new Error("0 migrated application tables found in public");
    }

    const committed = await committedMigrations(migrationsDirectory);
    const applied = await owner.query(
      "SELECT filename, sha256 FROM ledger_schema_migrations ORDER BY filename",
    );
    const expected = committed.map(({ filename, sha256 }) => ({
      filename,
      sha256,
    }));
    if (JSON.stringify(applied.rows) !== JSON.stringify(expected)) {
      throw new Error(
        `committed migration ledger mismatch: expected ${JSON.stringify(expected)}, ` +
          `received ${JSON.stringify(applied.rows)}`,
      );
    }
    migrationCount = expected.length;

    const triggers = await owner.query(`
      SELECT
        relation.relname AS table_name,
        trigger_row.tgname AS trigger_name,
        trigger_row.tgenabled AS enabled,
        trigger_row.tgtype::int AS trigger_type,
        function_namespace.nspname AS function_schema,
        function_row.proname AS function_name,
        language_row.lanname AS function_language,
        function_row.prorettype = 'trigger'::regtype AS returns_trigger,
        function_row.prosrc AS function_source
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
      JOIN pg_namespace AS function_namespace
        ON function_namespace.oid = function_row.pronamespace
      JOIN pg_language AS language_row ON language_row.oid = function_row.prolang
      WHERE namespace.nspname = 'public'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = ANY($1::text[])
      ORDER BY relation.relname, trigger_row.tgname
    `, [expectedAppendOnlyTriggers.map(({ triggerName }) => triggerName)]);
    const appendOnlyTriggers = triggers.rows.map((row) => ({
      tableName: row.table_name,
      triggerName: row.trigger_name,
      enabled: row.enabled,
      triggerType: row.trigger_type,
      functionSchema: row.function_schema,
      functionName: row.function_name,
      functionLanguage: row.function_language,
      returnsTrigger: row.returns_trigger,
      functionSource: row.function_source.replace(/\s+/g, " ").trim(),
    }));
    const expectedTriggerState = expectedAppendOnlyTriggers.map((expected) => ({
      tableName: expected.tableName,
      triggerName: expected.triggerName,
      enabled: "O",
      triggerType: 27,
      functionSchema: "public",
      functionName: expected.functionName,
      functionLanguage: "plpgsql",
      returnsTrigger: true,
      functionSource: expected.functionSource,
    }));
    if (
      JSON.stringify(appendOnlyTriggers) !==
      JSON.stringify(expectedTriggerState)
    ) {
      throw new Error(
        `append-only trigger integrity mismatch: ${JSON.stringify(appendOnlyTriggers)}`,
      );
    }
  } finally {
    await owner.end();
  }

  const application = new pg.Client({
    connectionString: applicationUrl,
    application_name: "ledger-runtime-grant-verifier",
  });
  await application.connect();
  let applicationIntegrity;
  try {
    const identity = await application.query("SELECT current_user");
    const role = identity.rows[0]?.current_user;
    if (role !== "ledger_app") {
      throw new Error(
        `DATABASE_URL must connect as ledger_app, connected as ${role}`,
      );
    }
    const grants = await application.query(`
      WITH application_tables AS (
        SELECT relation.relname AS table_name
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname <> 'ledger_schema_migrations'
      ),
      dml_privileges(privilege) AS (
        VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
      )
      SELECT table_name, privilege
      FROM application_tables
      CROSS JOIN dml_privileges
      WHERE has_table_privilege(
        current_user,
        quote_ident('public') || '.' || quote_ident(table_name),
        privilege
      )
      ORDER BY table_name, privilege
    `);
    if (grants.rows.length > 0) {
      throw new Error(
        "unexpected ledger_app DML grants: " +
          grants.rows
            .map(({ table_name, privilege }) => `${table_name}:${privilege}`)
            .join(", "),
      );
    }
    applicationIntegrity = {
      role,
      unexpectedGrants: [],
      totalTables: tableCount,
    };
  } finally {
    await application.end();
  }

  return {
    ownerRole: ownerName,
    tableCount,
    migrationCount,
    appendOnlyTriggerCount: expectedAppendOnlyTriggers.length,
    applicationIntegrity,
  };
}

async function main() {
  const result = await verifyMigratedSchema();
  console.log(
    `✓ ${result.migrationCount} committed migration checksum(s) verified across ` +
      `${result.tableCount} application table(s)`,
  );
  console.log(`✓ ${result.appendOnlyTriggerCount} append-only trigger(s) verified`);
  if (result.applicationIntegrity) {
    console.log(
      "✓ ledger_app has no table grants in the committed migrations " +
        "(truthful current integrity state)",
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`✗ committed migration verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
