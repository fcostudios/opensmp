import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultMigrationsDirectory = join(packageRoot, "src/migrations");
const lockSql = "SELECT pg_advisory_lock(hashtext('ledger-schema-migrations'))";
const unlockSql = "SELECT pg_advisory_unlock(hashtext('ledger-schema-migrations'))";

export async function committedMigrations(
  migrationsDirectory = process.env.MIGRATIONS_DIR ?? defaultMigrationsDirectory,
) {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.startsWith("V") && filename.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return await Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(join(migrationsDirectory, filename), "utf8");
      return {
        filename,
        sha256: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    }),
  );
}

export async function applyMigrations({
  databaseAdminUrl = process.env.DATABASE_ADMIN_URL,
  migrationsDirectory = process.env.MIGRATIONS_DIR ?? defaultMigrationsDirectory,
} = {}) {
  if (!databaseAdminUrl) {
    throw new Error("DATABASE_ADMIN_URL is required for committed migrations");
  }

  const client = new pg.Client({
    connectionString: databaseAdminUrl,
    application_name: "ledger-migration-runner",
  });
  let connected = false;
  let locked = false;
  let result;
  let primaryError;
  const asynchronousErrors = [];
  client.on("error", (error) => {
    asynchronousErrors.push(
      new Error(`migration connection failed: ${error.message}`, {
        cause: error,
      }),
    );
  });
  try {
    await client.connect();
    connected = true;
    await client.query(lockSql);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger_schema_migrations (
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations = await committedMigrations(migrationsDirectory);
    const appliedResult = await client.query(
      "SELECT filename, sha256 FROM ledger_schema_migrations ORDER BY filename",
    );
    for (const [index, appliedMigration] of appliedResult.rows.entries()) {
      const committedMigration = migrations[index];
      if (
        !committedMigration ||
        committedMigration.filename !== appliedMigration.filename
      ) {
        throw new Error(
          "applied migration history is not an exact prefix of committed migrations: " +
            `position ${index + 1} recorded ${appliedMigration.filename}, ` +
            `committed ${committedMigration?.filename ?? "<missing>"}`,
        );
      }
      if (appliedMigration.sha256 !== committedMigration.sha256) {
        throw new Error(
          `checksum mismatch for applied migration ${committedMigration.filename}: ` +
            `recorded ${appliedMigration.sha256}, committed ${committedMigration.sha256}`,
        );
      }
    }

    const appliedNow = [];
    for (const migration of migrations.slice(appliedResult.rows.length)) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO ledger_schema_migrations (filename, sha256) VALUES ($1, $2)",
          [migration.filename, migration.sha256],
        );
        await client.query("COMMIT");
        appliedNow.push(migration.filename);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [
              error,
              new Error(`migration rollback failed: ${rollbackError.message}`, {
                cause: rollbackError,
              }),
            ],
            `migration ${migration.filename} and rollback both failed`,
          );
        }
        throw error;
      }
    }

    result = {
      total: migrations.length,
      applied: appliedNow,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    if (locked) {
      try {
        await client.query(unlockSql);
      } catch (error) {
        cleanupErrors.push(
          new Error(`migration advisory unlock failed: ${error.message}`, {
            cause: error,
          }),
        );
      }
    }
    if (connected) {
      try {
        await client.end();
      } catch (error) {
        cleanupErrors.push(
          new Error(`migration connection close failed: ${error.message}`, {
            cause: error,
          }),
        );
      }
    }
    const primaryErrors =
      primaryError instanceof AggregateError
        ? primaryError.errors
        : primaryError
          ? [primaryError]
          : [];
    const allErrors = [
      ...primaryErrors,
      ...asynchronousErrors,
      ...cleanupErrors,
    ];
    if (allErrors.length > 1) {
      throw new AggregateError(
        allErrors,
        primaryError
          ? "committed migration apply and cleanup both failed"
          : "committed migration cleanup failed",
      );
    }
    if (allErrors.length === 1) {
      throw allErrors[0];
    }
  }
  return result;
}

async function main() {
  const result = await applyMigrations();
  if (result.applied.length === 0) {
    console.log(`✓ committed migrations current (${result.total} verified)`);
  } else {
    console.log(
      `✓ applied ${result.applied.length} committed migration(s): ${result.applied.join(", ")}`,
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`✗ committed migration apply failed: ${error.message}`);
    process.exitCode = 1;
  });
}
