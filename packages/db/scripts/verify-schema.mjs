import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { committedMigrations } from "./apply-migrations.mjs";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const expectedAppendOnlyTriggers = [
  ["audit_log", "audit_log_no_mutate"],
  ["request_transition", "request_transition_no_mutate"],
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
      SELECT event_object_table AS table_name, trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      GROUP BY event_object_table, trigger_name
      ORDER BY event_object_table, trigger_name
    `);
    const appendOnlyTriggers = triggers.rows
      .map(({ table_name, trigger_name }) => [table_name, trigger_name])
      .filter(([tableName, triggerName]) =>
        expectedAppendOnlyTriggers.some(
          ([expectedTable, expectedTrigger]) =>
            tableName === expectedTable && triggerName === expectedTrigger,
        ),
      );
    if (
      JSON.stringify(appendOnlyTriggers) !==
      JSON.stringify(expectedAppendOnlyTriggers)
    ) {
      throw new Error(
        `append-only trigger integrity mismatch: ${JSON.stringify(appendOnlyTriggers)}`,
      );
    }
  } finally {
    await owner.end();
  }

  let applicationIntegrity = null;
  if (applicationUrl) {
    const application = new pg.Client({
      connectionString: applicationUrl,
      application_name: "ledger-runtime-grant-verifier",
    });
    await application.connect();
    try {
      const result = await application.query(`
        SELECT
          current_user,
          count(*) FILTER (
            WHERE has_table_privilege(
              current_user,
              quote_ident(namespace.nspname) || '.' || quote_ident(relation.relname),
              'SELECT,INSERT,UPDATE,DELETE'
            )
          )::int AS granted_tables,
          count(*)::int AS total_tables
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname <> 'ledger_schema_migrations'
        GROUP BY current_user
      `);
      const row = result.rows[0];
      applicationIntegrity = {
        role: row?.current_user,
        grantedTables: Number(row?.granted_tables ?? 0),
        totalTables: Number(row?.total_tables ?? 0),
      };
      if (applicationIntegrity.role !== "ledger_app") {
        throw new Error(
          `DATABASE_URL must connect as ledger_app, connected as ${applicationIntegrity.role}`,
        );
      }
    } finally {
      await application.end();
    }
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
    if (result.applicationIntegrity.grantedTables === 0) {
      console.log(
        "ℹ ledger_app has no table grants in the committed migrations " +
          "(truthful current integrity state)",
      );
    } else {
      console.log(
        `✓ ledger_app has DML grants on ` +
          `${result.applicationIntegrity.grantedTables}/${result.applicationIntegrity.totalTables} table(s)`,
      );
    }
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
