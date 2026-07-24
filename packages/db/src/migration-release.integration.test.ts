import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const bootstrapPath = join(packageRoot, "scripts/ci-bootstrap.sql");

let container: StartedPostgreSqlContainer | undefined;
let clusterAdminUrl: string;
let ownerAdminUrl: string;
let appAdminUrl: string;
let databaseSequence = 0;
const testRunSuffix = randomUUID().replaceAll("-", "").slice(0, 8);

function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createDatabase(): Promise<{ name: string; ownerUrl: string; appUrl: string }> {
  databaseSequence += 1;
  const name = `ledger_test_${testRunSuffix}_${databaseSequence}`;
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
  const admin = new pg.Client({ connectionString: clusterAdminUrl });
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

async function dropDatabaseAsClusterAdmin(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: clusterAdminUrl });
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

async function migrate(databaseAdminUrl: string): Promise<void> {
  const result = await runNode(runnerPath, {
    DATABASE_ADMIN_URL: databaseAdminUrl,
  });
  expect(result.code, result.stderr).toBe(0);
}

async function applicationTableCount(connectionString: string): Promise<number> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
    `);
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
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

async function runCiBootstrap({
  ownerRole,
  ownerPassword,
  applicationRole,
  applicationPassword,
  databaseName,
}: {
  ownerRole: string;
  ownerPassword: string;
  applicationRole: string;
  applicationPassword: string;
  databaseName: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const adminUrl = new URL(clusterAdminUrl);
  try {
    const result = await execFileAsync(
      "psql",
      [
        `--host=${adminUrl.hostname}`,
        `--port=${adminUrl.port}`,
        `--username=${decodeURIComponent(adminUrl.username)}`,
        `--dbname=${adminUrl.pathname.slice(1)}`,
        "--set=ON_ERROR_STOP=1",
        `--set=owner_role=${ownerRole}`,
        `--set=owner_password=${ownerPassword}`,
        `--set=application_role=${applicationRole}`,
        `--set=application_password=${applicationPassword}`,
        `--set=database_name=${databaseName}`,
        `--file=${bootstrapPath}`,
      ],
      {
        env: {
          ...process.env,
          PGPASSWORD: decodeURIComponent(adminUrl.password),
        },
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? String(error),
    };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
  if (process.env.TEST_POSTGRES_URL) {
    clusterAdminUrl = process.env.TEST_POSTGRES_URL;
  } else {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withStartupTimeout(120_000)
      .start();
    clusterAdminUrl = container.getConnectionUri();
  }

  const admin = new pg.Client({ connectionString: clusterAdminUrl });
  await admin.connect();
  try {
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_owner') THEN
          CREATE ROLE ledger_owner LOGIN CREATEDB PASSWORD 'owner-secret';
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_app') THEN
          CREATE ROLE ledger_app LOGIN PASSWORD 'app-secret';
        END IF;
      END
      $$
    `);
    await admin.query(
      "ALTER ROLE ledger_owner NOSUPERUSER NOCREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS LOGIN PASSWORD 'owner-secret'",
    );
    await admin.query(
      "ALTER ROLE ledger_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS LOGIN PASSWORD 'app-secret'",
    );
    await admin.query("REVOKE ledger_owner FROM ledger_app");
  } finally {
    await admin.end();
  }

  const owner = new URL(clusterAdminUrl);
  owner.username = "ledger_owner";
  owner.password = "owner-secret";
  ownerAdminUrl = owner.toString();
  const application = new URL(clusterAdminUrl);
  application.username = "ledger_app";
  application.password = "app-secret";
  appAdminUrl = application.toString();
}, 150_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

describe("committed migration release path", () => {
  test("executes the production CI bootstrap through psql without exposing passwords", async () => {
    databaseSequence += 1;
    const ownerRole = `bootstrap_owner_${testRunSuffix}_${databaseSequence}`;
    const applicationRole = `bootstrap_app_${testRunSuffix}_${databaseSequence}`;
    const databaseName = `bootstrap_database_${testRunSuffix}_${databaseSequence}`;
    const ownerPassword = `owner-password-${databaseSequence}`;
    const applicationPassword = `application-password-${databaseSequence}`;
    try {
      const result = await runCiBootstrap({
        ownerRole,
        ownerPassword,
        applicationRole,
        applicationPassword,
        databaseName,
      });
      expect(result.code, result.stderr).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(ownerPassword);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(applicationPassword);

      const owner = new URL(clusterAdminUrl);
      owner.username = ownerRole;
      owner.password = ownerPassword;
      owner.pathname = `/${databaseName}`;
      const application = new URL(owner);
      application.username = applicationRole;
      application.password = applicationPassword;

      const ownerClient = new pg.Client({ connectionString: owner.toString() });
      const applicationClient = new pg.Client({
        connectionString: application.toString(),
      });
      const admin = new pg.Client({ connectionString: clusterAdminUrl });
      await Promise.all([
        ownerClient.connect(),
        applicationClient.connect(),
        admin.connect(),
      ]);
      try {
        const [ownerIdentity, applicationIdentity, databaseState] =
          await Promise.all([
            ownerClient.query<{ current_user: string }>(
              "SELECT current_user",
            ),
            applicationClient.query<{ current_user: string }>(
              "SELECT current_user",
            ),
            admin.query<{
              database_owner: string;
              owner_createdb: boolean;
              application_createdb: boolean;
              application_superuser: boolean;
            }>(
              `
                SELECT
                  pg_get_userbyid(database.datdba) AS database_owner,
                  owner_role.rolcreatedb AS owner_createdb,
                  application_role.rolcreatedb AS application_createdb,
                  application_role.rolsuper AS application_superuser
                FROM pg_database AS database
                JOIN pg_roles AS owner_role ON owner_role.rolname = $2
                JOIN pg_roles AS application_role ON application_role.rolname = $3
                WHERE database.datname = $1
              `,
              [databaseName, ownerRole, applicationRole],
            ),
          ]);
        expect(ownerIdentity.rows).toEqual([{ current_user: ownerRole }]);
        expect(applicationIdentity.rows).toEqual([
          { current_user: applicationRole },
        ]);
        expect(databaseState.rows).toEqual([
          {
            database_owner: ownerRole,
            owner_createdb: true,
            application_createdb: false,
            application_superuser: false,
          },
        ]);
      } finally {
        await Promise.all([
          ownerClient.end(),
          applicationClient.end(),
          admin.end(),
        ]);
      }
    } finally {
      const admin = new pg.Client({ connectionString: clusterAdminUrl });
      await admin.connect();
      try {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName],
        );
        await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        await admin.query(`DROP ROLE IF EXISTS "${applicationRole}"`);
        await admin.query(`DROP ROLE IF EXISTS "${ownerRole}"`);
      } finally {
        await admin.end();
      }
    }
  }, 30_000);

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

  test("rejects an applied migration that is missing from the committed directory", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const filename = "V20260724000110__deleted_probe.sql";
    const migration = join(migrations, filename);
    try {
      await writeFile(
        migration,
        "CREATE TABLE deleted_probe (id integer PRIMARY KEY);\n",
      );
      expect(
        (
          await runNode(runnerPath, {
            DATABASE_ADMIN_URL: database.ownerUrl,
            MIGRATIONS_DIR: migrations,
          })
        ).code,
      ).toBe(0);
      await rm(migration);

      const result = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "applied migration history is not an exact prefix",
      );
    } finally {
      await rm(migrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("rejects an applied migration gap before executing committed SQL", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const firstFilename = "V20260724000120__gap_first.sql";
    const secondFilename = "V20260724000130__gap_second.sql";
    const firstSql = "CREATE TABLE gap_first (id integer PRIMARY KEY);\n";
    const secondSql = "CREATE TABLE gap_second (id integer PRIMARY KEY);\n";
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await Promise.all([
        writeFile(join(migrations, firstFilename), firstSql),
        writeFile(join(migrations, secondFilename), secondSql),
      ]);
      await client.connect();
      await client.query(`
        CREATE TABLE ledger_schema_migrations (
          filename text PRIMARY KEY,
          sha256 text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(
        "INSERT INTO ledger_schema_migrations (filename, sha256) VALUES ($1, $2)",
        [secondFilename, sha256(secondSql)],
      );

      const result = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "applied migration history is not an exact prefix",
      );
      const state = await client.query<{
        first_relation: string | null;
        second_relation: string | null;
      }>(
        `
          SELECT
            to_regclass('public.gap_first')::text AS first_relation,
            to_regclass('public.gap_second')::text AS second_relation
        `,
      );
      expect(state.rows).toEqual([
        { first_relation: null, second_relation: null },
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await rm(migrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("rejects a committed migration inserted before the applied prefix", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const appliedFilename = "V20260724000150__already_applied.sql";
    const backfillFilename = "V20260724000140__backfill.sql";
    try {
      await writeFile(
        join(migrations, appliedFilename),
        "CREATE TABLE already_applied (id integer PRIMARY KEY);\n",
      );
      expect(
        (
          await runNode(runnerPath, {
            DATABASE_ADMIN_URL: database.ownerUrl,
            MIGRATIONS_DIR: migrations,
          })
        ).code,
      ).toBe(0);
      await writeFile(
        join(migrations, backfillFilename),
        "CREATE TABLE backfill_probe (id integer PRIMARY KEY);\n",
      );

      const result = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "applied migration history is not an exact prefix",
      );
      const client = new pg.Client({ connectionString: database.ownerUrl });
      await client.connect();
      const state = await client
        .query<{ backfill_relation: string | null }>(
          "SELECT to_regclass('public.backfill_probe')::text AS backfill_relation",
        )
        .finally(() => client.end());
      expect(state.rows).toEqual([{ backfill_relation: null }]);
    } finally {
      await rm(migrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("applies a new committed suffix after the exact applied prefix", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    const firstFilename = "V20260724000160__suffix_first.sql";
    const secondFilename = "V20260724000170__suffix_second.sql";
    try {
      await writeFile(
        join(migrations, firstFilename),
        "CREATE TABLE suffix_first (id integer PRIMARY KEY);\n",
      );
      expect(
        (
          await runNode(runnerPath, {
            DATABASE_ADMIN_URL: database.ownerUrl,
            MIGRATIONS_DIR: migrations,
          })
        ).code,
      ).toBe(0);
      await writeFile(
        join(migrations, secondFilename),
        "CREATE TABLE suffix_second (id integer PRIMARY KEY);\n",
      );
      const result = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: migrations,
      });
      expect(result.code, result.stderr).toBe(0);

      const client = new pg.Client({ connectionString: database.ownerUrl });
      await client.connect();
      const state = await client
        .query<{ filename: string }>(
          "SELECT filename FROM ledger_schema_migrations ORDER BY filename",
        )
        .finally(() => client.end());
      expect(state.rows).toEqual([
        { filename: firstFilename },
        { filename: secondFilename },
      ]);
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

  test("preserves the migration failure together with rollback and unlock failures", async () => {
    const database = await createDatabase();
    const migrations = await mkdtemp(join(tmpdir(), "ledger-migrations-"));
    try {
      await writeFile(
        join(migrations, "V20260724000210__terminate_runner.sql"),
        `
          CREATE TABLE terminate_runner_probe (id integer PRIMARY KEY);
          SELECT pg_terminate_backend(pg_backend_pid());
        `,
      );
      const imported = await import(pathToFileURL(runnerPath).href);
      await expect(
        imported.applyMigrations({
          databaseAdminUrl: database.ownerUrl,
          migrationsDirectory: migrations,
        }),
      ).rejects.toSatisfy((error: unknown) => {
        if (!(error instanceof AggregateError)) return false;
        const messages = error.errors.map((entry: unknown) =>
          entry instanceof Error ? entry.message : String(entry),
        );
        return (
          messages.some((message: string) =>
            /terminat|connection/i.test(message),
          ) &&
          messages.some((message: string) => /rollback/i.test(message)) &&
          messages.some((message: string) => /unlock/i.test(message))
        );
      });

      const client = new pg.Client({ connectionString: database.ownerUrl });
      await client.connect();
      const state = await client
        .query<{ relation: string | null }>(
          "SELECT to_regclass('public.terminate_runner_probe')::text AS relation",
        )
        .finally(() => client.end());
      expect(state.rows).toEqual([{ relation: null }]);
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

  test("requires ledger_owner and ledger_app identities and both URLs", async () => {
    const database = await createDatabase();
    try {
      await migrate(database.ownerUrl);
      const wrongOwner = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: databaseUrl(clusterAdminUrl, database.name),
        DATABASE_URL: database.appUrl,
      });
      expect(wrongOwner.code).not.toBe(0);
      expect(wrongOwner.stderr).toContain(
        "DATABASE_ADMIN_URL must connect as ledger_owner",
      );

      const wrongApplication = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.ownerUrl,
      });
      expect(wrongApplication.code).not.toBe(0);
      expect(wrongApplication.stderr).toContain(
        "DATABASE_URL must connect as ledger_app",
      );

      const missingApplication = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: "",
      });
      expect(missingApplication.code).not.toBe(0);
      expect(missingApplication.stderr).toContain(
        "DATABASE_URL is required to verify ledger_app runtime grants",
      );
    } finally {
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    ["SELECT", "company"],
    ["INSERT", "person"],
    ["UPDATE", "vendor"],
    ["DELETE", "license_type"],
  ])("rejects any stray ledger_app %s privilege", async (privilege, tableName) => {
    const database = await createDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await owner.connect();
      await owner.query(`GRANT ${privilege} ON TABLE "${tableName}" TO ledger_app`);

      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        `unexpected ledger_app DML grants: ${tableName}:${privilege}`,
      );
    } finally {
      await owner.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    [
      "disabled",
      "ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutate",
    ],
    [
      "wrong-event",
      `
        DROP TRIGGER audit_log_no_mutate ON audit_log;
        CREATE TRIGGER audit_log_no_mutate
          BEFORE UPDATE ON audit_log
          FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()
      `,
    ],
    [
      "wrong-function",
      `
        CREATE FUNCTION audit_log_wrong_append_only() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'wrong function'; END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER audit_log_no_mutate ON audit_log;
        CREATE TRIGGER audit_log_no_mutate
          BEFORE UPDATE OR DELETE ON audit_log
          FOR EACH ROW EXECUTE FUNCTION audit_log_wrong_append_only()
      `,
    ],
    [
      "no-op",
      `
        CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
        BEGIN RETURN OLD; END;
        $$ LANGUAGE plpgsql
      `,
    ],
  ])("rejects %s append-only trigger drift", async (_kind, mutationSql) => {
    const database = await createDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await owner.connect();
      await owner.query(mutationSql);

      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("append-only trigger integrity mismatch");
    } finally {
      await owner.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    [
      "application table ownership",
      `ALTER TABLE company OWNER TO "${"postgres"}"`,
      "application table ownership mismatch",
    ],
    [
      "integrity function ownership",
      `ALTER FUNCTION audit_log_append_only() OWNER TO "${"postgres"}"`,
      "integrity function security mismatch",
    ],
    [
      "SECURITY DEFINER integrity function",
      "ALTER FUNCTION audit_log_append_only() SECURITY DEFINER",
      "integrity function security mismatch",
    ],
    [
      "configured integrity function search_path",
      "ALTER FUNCTION audit_log_append_only() SET search_path = public",
      "integrity function security mismatch",
    ],
  ])("rejects %s drift", async (_kind, mutationSql, expectedMessage) => {
    const database = await createDatabase();
    const admin = new pg.Client({
      connectionString: databaseUrl(clusterAdminUrl, database.name),
    });
    try {
      await migrate(database.ownerUrl);
      await admin.connect();
      const clusterAdminRole = decodeURIComponent(
        new URL(clusterAdminUrl).username,
      );
      await admin.query(
        mutationSql.replaceAll('"postgres"', `"${clusterAdminRole}"`),
      );

      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(expectedMessage);
    } finally {
      await admin.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("rejects direct and indirect SET ROLE paths to ledger_owner", async () => {
    const database = await createDatabase();
    databaseSequence += 1;
    const bridgeRole = `ledger_bridge_${testRunSuffix}_${databaseSequence}`;
    const admin = new pg.Client({ connectionString: clusterAdminUrl });
    let adminConnected = false;
    try {
      await migrate(database.ownerUrl);
      await admin.connect();
      adminConnected = true;
      await admin.query("GRANT ledger_owner TO ledger_app");
      let result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("ledger_app privilege escalation path");
      await admin.query("REVOKE ledger_owner FROM ledger_app");

      await admin.query(`CREATE ROLE "${bridgeRole}"`);
      await admin.query(`GRANT ledger_owner TO "${bridgeRole}"`);
      await admin.query(`GRANT "${bridgeRole}" TO ledger_app`);
      result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("ledger_app privilege escalation path");
    } finally {
      if (adminConnected) {
        await admin
          .query(`REVOKE "${bridgeRole}" FROM ledger_app`)
          .catch(() => undefined);
        await admin
          .query(`REVOKE ledger_owner FROM "${bridgeRole}"`)
          .catch(() => undefined);
        await admin.query(`DROP ROLE IF EXISTS "${bridgeRole}"`).catch(() => undefined);
        await admin.query("REVOKE ledger_owner FROM ledger_app").catch(() => undefined);
      }
      await admin.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("rejects unsafe ledger_app role attributes", async () => {
    const database = await createDatabase();
    const admin = new pg.Client({ connectionString: clusterAdminUrl });
    try {
      await migrate(database.ownerUrl);
      await admin.connect();
      await admin.query("ALTER ROLE ledger_app BYPASSRLS");
      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("ledger_app role attributes are unsafe");
    } finally {
      await admin.query("ALTER ROLE ledger_app NOBYPASSRLS").catch(() => undefined);
      await admin.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);
});

describe("migration parity", () => {
  test("matches a fresh drizzle-kit push exactly", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const structure = await imported.checkMigrationParity({
      databaseAdminUrl: ownerAdminUrl,
      applicationUrl: appAdminUrl,
    });
    expect(structure.tables).toHaveLength(26);
    expect(structure.foreignKeys).toHaveLength(70);
  }, 120_000);

  test("disposable push URL wins over a conflicting local env file", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const conflicting = await createDatabase();
    const dotenvDirectory = await mkdtemp(join(tmpdir(), "ledger-dotenv-"));
    try {
      await writeFile(
        join(dotenvDirectory, ".env.local"),
        `DATABASE_URL=${conflicting.ownerUrl}\nDB_DRIVER=pg\n`,
      );
      await imported.checkMigrationParity({
        databaseAdminUrl: ownerAdminUrl,
        applicationUrl: appAdminUrl,
        dotenvDirectory,
        beforeCompare: async ({
          pushUrl,
        }: {
          pushUrl: string;
        }) => {
          expect(await applicationTableCount(pushUrl)).toBe(26);
          expect(await applicationTableCount(conflicting.ownerUrl)).toBe(0);
        },
      });
    } finally {
      await rm(dotenvDirectory, { recursive: true, force: true });
      await dropDatabase(conflicting.name);
    }
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
        applicationUrl: appAdminUrl,
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

  test("surfaces cleanup failures with the primary error and still drops the other database", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    let migrationDatabase = "";
    let pushDatabase = "";
    try {
      await expect(
        imported.checkMigrationParity({
          databaseAdminUrl: ownerAdminUrl,
          applicationUrl: appAdminUrl,
          beforeCompare: async ({
            migrationUrl,
            pushUrl,
          }: {
            migrationUrl: string;
            pushUrl: string;
          }) => {
            migrationDatabase = new URL(migrationUrl).pathname.slice(1);
            pushDatabase = new URL(pushUrl).pathname.slice(1);
            const clusterAdmin = new pg.Client({
              connectionString: clusterAdminUrl,
            });
            await clusterAdmin.connect();
            try {
              await clusterAdmin.query(
                `ALTER DATABASE "${migrationDatabase}" OWNER TO "${decodeURIComponent(new URL(clusterAdminUrl).username)}"`,
              );
            } finally {
              await clusterAdmin.end();
            }
            throw new Error("controlled primary parity failure");
          },
        }),
      ).rejects.toSatisfy((error: unknown) => {
        if (!(error instanceof AggregateError)) return false;
        const messages = error.errors.map((entry: unknown) =>
          entry instanceof Error ? entry.message : String(entry),
        );
        return (
          messages.some((message: string) =>
            message.includes("controlled primary parity failure"),
          ) &&
          messages.some((message: string) =>
            message.includes("must be owner of database"),
          )
        );
      });

      const clusterAdmin = new pg.Client({ connectionString: clusterAdminUrl });
      await clusterAdmin.connect();
      try {
        const remaining = await clusterAdmin.query<{ datname: string }>(
          "SELECT datname FROM pg_database WHERE datname = ANY($1::text[]) ORDER BY datname",
          [[migrationDatabase, pushDatabase]],
        );
        expect(remaining.rows).toEqual([{ datname: migrationDatabase }]);
      } finally {
        await clusterAdmin.end();
      }
    } finally {
      if (migrationDatabase) {
        await dropDatabaseAsClusterAdmin(migrationDatabase);
      }
      if (pushDatabase) {
        await dropDatabaseAsClusterAdmin(pushDatabase);
      }
    }
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
