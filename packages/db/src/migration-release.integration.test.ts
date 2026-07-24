import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = join(packageRoot, "scripts/apply-migrations.mjs");
const parityPath = join(packageRoot, "scripts/check-migration-parity.mjs");
const verifyPath = join(packageRoot, "scripts/verify-schema.mjs");

let container: StartedPostgreSqlContainer;
let clusterAdminUrl: string;
let ownerAdminUrl: string;
let databaseSequence = 0;

function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createDatabase(): Promise<{ name: string; ownerUrl: string; appUrl: string }> {
  databaseSequence += 1;
  const name = `ledger_test_${databaseSequence}`;
  const admin = new pg.Client({ connectionString: ownerAdminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" OWNER ledger_owner`);
  } finally {
    await admin.end();
  }
  return {
    name,
    ownerUrl: databaseUrl(ownerAdminUrl, name),
    appUrl: databaseUrl(
      ownerAdminUrl.replace("ledger_owner:owner-secret", "ledger_app:app-secret"),
      name,
    ),
  };
}

async function dropDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: ownerAdminUrl });
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}

async function runNode(
  script: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolveResult) => {
    execFile(
      process.execPath,
      [script],
      {
        cwd: packageRoot,
        env: { ...process.env, ...environment },
      },
      (error, stdout, stderr) => {
        resolveResult({
          code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

async function waitForConcurrentAdvisoryLocks(databaseName: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: ownerAdminUrl });
  await client.connect();
  try {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const result = await client.query<{ granted: string; waiting: string }>(
        `
          SELECT
            count(*) FILTER (WHERE locks.granted)::text AS granted,
            count(*) FILTER (WHERE NOT locks.granted)::text AS waiting
          FROM pg_locks AS locks
          JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
          WHERE locks.locktype = 'advisory'
            AND activity.application_name = 'ledger-migration-runner'
            AND activity.datname = $1
        `,
        [databaseName],
      );
      if (Number(result.rows[0]?.granted) === 1 && Number(result.rows[0]?.waiting) === 1) {
        return true;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    }
    return false;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withStartupTimeout(120_000)
    .start();
  clusterAdminUrl = container.getConnectionUri();

  const admin = new pg.Client({ connectionString: clusterAdminUrl });
  await admin.connect();
  try {
    await admin.query("CREATE ROLE ledger_owner LOGIN CREATEDB PASSWORD 'owner-secret'");
    await admin.query("CREATE ROLE ledger_app LOGIN PASSWORD 'app-secret'");
  } finally {
    await admin.end();
  }

  const owner = new URL(clusterAdminUrl);
  owner.username = "ledger_owner";
  owner.password = "owner-secret";
  ownerAdminUrl = owner.toString();
}, 150_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

describe("committed migration release path", () => {
  test("rejects checksum tampering without changing the applied record", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const filename = "V20260724000100__checksum_probe.sql";
    const migration = join(migrations, filename);
    try {
      await writeFile(migration, "CREATE TABLE checksum_probe (id integer PRIMARY KEY);\n");
      const first = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });
      expect(first.code, first.stderr).toBe(0);

      const client = new pg.Client({ connectionString: database.ownerUrl });
      await client.connect();
      const before = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM ledger_schema_migrations WHERE filename = $1",
        [filename],
      );
      await client.end();

      await writeFile(
        migration,
        "CREATE TABLE checksum_probe (id integer PRIMARY KEY, changed text);\n",
      );
      const second = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });

      expect(second.code).not.toBe(0);
      expect(second.stderr).toContain(`checksum mismatch for applied migration ${filename}`);

      const verification = new pg.Client({ connectionString: database.ownerUrl });
      await verification.connect();
      const after = await verification.query<{ sha256: string }>(
        "SELECT sha256 FROM ledger_schema_migrations WHERE filename = $1",
        [filename],
      );
      await verification.end();
      expect(after.rows).toEqual(before.rows);
    } finally {
      await rm(migrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("rolls back migration SQL and its ledger record together", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const filename = "V20260724000200__rollback_probe.sql";
    try {
      await writeFile(
        join(migrations, filename),
        "CREATE TABLE rollback_probe (id integer PRIMARY KEY);\nSELECT missing_release_function();\n",
      );

      const result = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });
      expect(result.code).not.toBe(0);

      const client = new pg.Client({ connectionString: database.ownerUrl });
      await client.connect();
      const state = await client.query<{
          relation: string | null;
          migration_count: string;
        }>(
          `
            SELECT
              to_regclass('public.rollback_probe')::text AS relation,
              (SELECT count(*)::text FROM ledger_schema_migrations WHERE filename = $1)
                AS migration_count
          `,
          [filename],
        )
        .finally(() => client.end());
      expect(state.rows).toEqual([{ relation: null, migration_count: "0" }]);
    } finally {
      await rm(migrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("serializes concurrent runners with the named session advisory lock", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const filename = "V20260724000300__concurrency_probe.sql";
    try {
      await writeFile(
        join(migrations, filename),
        "SELECT pg_sleep(2);\nCREATE TABLE concurrency_probe (id integer PRIMARY KEY);\n",
      );
      const environment = {
        ...process.env,
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      };
      const first = spawn(process.execPath, [runnerPath], {
        cwd: packageRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const second = spawn(process.execPath, [runnerPath], {
        cwd: packageRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exitPromises = [
        new Promise<number | null>((resolveExit) => first.once("exit", resolveExit)),
        new Promise<number | null>((resolveExit) => second.once("exit", resolveExit)),
      ];
      const observedSerializedLock = await waitForConcurrentAdvisoryLocks(database.name);
      const exits = await Promise.all(exitPromises);

      expect(observedSerializedLock).toBe(true);
      expect(exits).toEqual([0, 0]);

      const client = new pg.Client({ connectionString: database.ownerUrl });
      await client.connect();
      const records = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM ledger_schema_migrations WHERE filename = $1",
        [filename],
      );
      await client.end();
      expect(records.rows).toEqual([{ count: "1" }]);
    } finally {
      await rm(migrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("verifies the committed migration ledger and truthful integrity state", async () => {
    const database = await createDatabase();
    try {
      const migrated = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(migrated.code, migrated.stderr).toBe(0);

      const verified = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(verified.code, verified.stderr).toBe(0);
      expect(verified.stdout).toContain("committed migration checksum(s) verified");
      expect(verified.stdout).toContain("append-only trigger(s) verified");
      expect(verified.stdout).toContain("ledger_app has no table grants in the committed migrations");
    } finally {
      await dropDatabase(database.name);
    }
  }, 30_000);
});

describe("migration parity", () => {
  test("matches a fresh drizzle-kit push exactly", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const structure = await imported.checkMigrationParity({
      databaseAdminUrl: ownerAdminUrl,
    });
    expect(structure.tables).toHaveLength(26);
    expect(structure.foreignKeys).toHaveLength(70);
  }, 120_000);

  test("rejects exact structural drift and cleans both disposable databases", async () => {
    const imported = await import(pathToFileURL(parityPath).href).catch(
      (error: unknown) => error,
    );
    expect(imported).not.toBeInstanceOf(Error);
    if (imported instanceof Error) return;

    const admin = new pg.Client({ connectionString: ownerAdminUrl });
    await admin.connect();
    const before = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'ledger_parity_%' ORDER BY datname",
    );
    await admin.end();

    await expect(
      imported.checkMigrationParity({
        databaseAdminUrl: ownerAdminUrl,
        beforeCompare: async ({ migrationUrl }: { migrationUrl: string }) => {
          const client = new pg.Client({ connectionString: migrationUrl });
          await client.connect();
          try {
            await client.query("ALTER TABLE company ADD COLUMN parity_drift text");
          } finally {
            await client.end();
          }
        },
      }),
    ).rejects.toThrow("database schema parity mismatch");

    const verification = new pg.Client({ connectionString: ownerAdminUrl });
    await verification.connect();
    const after = await verification.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'ledger_parity_%' ORDER BY datname",
    );
    await verification.end();
    expect(after.rows).toEqual(before.rows);
  }, 120_000);
});

describe("release configuration", () => {
  test("declares the exact database package commands", async () => {
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts).toMatchObject({
      "db:migrate": "node scripts/apply-migrations.mjs",
      "db:push": "drizzle-kit push",
      "db:verify": "node scripts/verify-schema.mjs",
      "db:parity": "node scripts/check-migration-parity.mjs",
    });
    expect(packageJson.scripts).not.toHaveProperty("verify");
  });
});
