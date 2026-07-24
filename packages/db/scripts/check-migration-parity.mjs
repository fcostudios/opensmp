import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { applyMigrations } from "./apply-migrations.mjs";
import { verifyMigratedSchema } from "./verify-schema.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrl(adminUrl, databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function runDrizzlePush(pushUrl) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      "pnpm",
      ["exec", "drizzle-kit", "push", "--force"],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          DATABASE_URL: pushUrl,
          DB_DRIVER: "pg",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(
          new Error(
            `drizzle-kit push failed with exit ${code}: ${(stderr || stdout).trim()}`,
          ),
        );
      }
    });
  });
}

async function describeStructure(connectionString) {
  const client = new pg.Client({
    connectionString,
    application_name: "ledger-parity-inspector",
  });
  await client.connect();
  try {
    const tables = await client.query(`
      SELECT relation.relname AS table_name
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
      ORDER BY relation.relname
    `);
    const columns = await client.query(`
      SELECT
        relation.relname AS table_name,
        attribute.attname AS column_name,
        format_type(attribute.atttypid, attribute.atttypmod) AS normalized_type,
        NOT attribute.attnotnull AS nullable
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum
    `);
    const foreignKeys = await client.query(`
      SELECT
        source.relname AS table_name,
        ARRAY(
          SELECT source_attribute.attname
          FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS source_attribute
            ON source_attribute.attrelid = constraint_row.conrelid
           AND source_attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS columns,
        target.relname AS referenced_table,
        ARRAY(
          SELECT target_attribute.attname
          FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS target_attribute
            ON target_attribute.attrelid = constraint_row.confrelid
           AND target_attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS referenced_columns,
        constraint_row.confupdtype AS update_action,
        constraint_row.confdeltype AS delete_action
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source ON source.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = source.relnamespace
      JOIN pg_class AS target ON target.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND namespace.nspname = 'public'
      ORDER BY source.relname, columns, target.relname, referenced_columns
    `);
    return {
      tables: tables.rows,
      columns: columns.rows,
      foreignKeys: foreignKeys.rows,
    };
  } finally {
    await client.end();
  }
}

export async function compareDatabaseStructures(migrationUrl, pushUrl) {
  const migrationStructure = await describeStructure(migrationUrl);
  const pushStructure = await describeStructure(pushUrl);
  const expected = JSON.stringify(pushStructure);
  const actual = JSON.stringify(migrationStructure);
  if (actual !== expected) {
    throw new Error(
      "database schema parity mismatch\n" +
        `migration structure: ${JSON.stringify(migrationStructure, null, 2)}\n` +
        `drizzle push structure: ${JSON.stringify(pushStructure, null, 2)}`,
    );
  }
  return migrationStructure;
}

async function dropDisposableDatabase(admin, databaseName) {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
}

export async function checkMigrationParity({
  databaseAdminUrl = process.env.DATABASE_ADMIN_URL,
  beforeCompare,
} = {}) {
  if (!databaseAdminUrl) {
    throw new Error(
      "DATABASE_ADMIN_URL is required to provision parity databases",
    );
  }

  const suffix = randomUUID().replaceAll("-", "");
  const migrationDatabase = `ledger_parity_migration_${suffix}`;
  const pushDatabase = `ledger_parity_push_${suffix}`;
  const migrationUrl = databaseUrl(databaseAdminUrl, migrationDatabase);
  const pushUrl = databaseUrl(databaseAdminUrl, pushDatabase);
  const admin = new pg.Client({
    connectionString: databaseAdminUrl,
    application_name: "ledger-parity-provisioner",
  });
  await admin.connect();
  let primaryError;
  try {
    await admin.query(`CREATE DATABASE ${quotedIdentifier(migrationDatabase)}`);
    await admin.query(`CREATE DATABASE ${quotedIdentifier(pushDatabase)}`);
    await applyMigrations({ databaseAdminUrl: migrationUrl });
    await runDrizzlePush(pushUrl);
    await verifyMigratedSchema({ databaseAdminUrl: migrationUrl });
    if (beforeCompare) {
      await beforeCompare({ migrationUrl, pushUrl });
    }
    return await compareDatabaseStructures(migrationUrl, pushUrl);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const databaseName of [migrationDatabase, pushDatabase]) {
      try {
        await dropDisposableDatabase(admin, databaseName);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    await admin.end().catch((error) => cleanupErrors.push(error));
    if (!primaryError && cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "failed to clean parity databases exactly",
      );
    }
  }
}

async function main() {
  const structure = await checkMigrationParity();
  console.log(
    `✓ committed migrations match drizzle-kit push: ` +
      `${structure.tables.length} table(s), ${structure.columns.length} column(s), ` +
      `${structure.foreignKeys.length} foreign key(s)`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`✗ committed migration parity failed: ${error.message}`);
    process.exitCode = 1;
  });
}
