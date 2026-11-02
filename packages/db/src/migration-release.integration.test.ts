import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POSTGRES_16_ALPINE_IMAGE, SHARED_POSTGRES_CLUSTER_ENV } from "./testing/postgres-container";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = join(packageRoot, "scripts/apply-migrations.mjs");
const parityPath = join(packageRoot, "scripts/check-migration-parity.mjs");
const verifyPath = join(packageRoot, "scripts/verify-schema.mjs");
const bootstrapPath = join(packageRoot, "scripts/ci-bootstrap.sql");
const committedMigrationsPath = join(packageRoot, "src/migrations");
const pendingRemoveVerifierFilename =
  "V20260727095000__verify_pending_remove_idempotency.sql";
const pendingRemoveVerifierError =
  "Pending remove idempotency verifier failed: uq_provisioning_action_pending_remove_request exact index";
const crossOrgPrivilegeVerifierFilename =
  "V20260728125700__verify_cross_org_move_runtime_privileges.sql";

async function readLatestIdentityProviderVerifier(): Promise<string> {
  const filenames = (await readdir(committedMigrationsPath))
    .filter((filename) => filename.includes("__verify_identity_provider_operation"))
    .sort();
  const filename = filenames.at(-1);
  if (!filename) {
    throw new Error("identity-provider operation verifier migration is missing");
  }
  return await readFile(join(committedMigrationsPath, filename), "utf8");
}

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

const predicate = { template: "account-reference-exists-v1", columnName: "vendor_account_id", referencedTable: "vendor_account", referencedColumn: "id" };
const extension = {
  tableName: "drift_episode", profile: "drift-episode-v1", mutable: true,
  rls: { enabled: true, forced: false },
  policies: [
    { name: "drift_episode_select", command: "SELECT", role: "ledger_app", using: predicate, withCheck: null },
    { name: "drift_episode_insert", command: "INSERT", role: "ledger_app", using: null, withCheck: predicate },
    { name: "drift_episode_update", command: "UPDATE", role: "ledger_app", using: predicate, withCheck: predicate },
  ],
  constraints: [
    { name: "drift_episode_pkey", kind: "PRIMARY_KEY", columns: ["id"] },
    { name: "drift_episode_vendor_account_id_fkey", kind: "FOREIGN_KEY", columns: ["vendor_account_id"], referencedTable: "vendor_account", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_license_type_id_fkey", kind: "FOREIGN_KEY", columns: ["license_type_id"], referencedTable: "license_type", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_person_id_fkey", kind: "FOREIGN_KEY", columns: ["person_id"], referencedTable: "person", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_resolved_by_assignment_id_fkey", kind: "FOREIGN_KEY", columns: ["resolved_by_assignment_id"], referencedTable: "license_assignment", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_resolved_by_assignment_id_key", kind: "UNIQUE", columns: ["resolved_by_assignment_id"] },
    { name: "drift_episode_open", kind: "UNIQUE_OPEN", columns: ["vendor_account_id", "member_identity", "license_type_id"], nullColumn: "resolved_at" },
  ],
};

const releaseSource = "15a037ed65551e09b7d196967f0413790819a293";
const repositoryRoot = resolve(packageRoot, "../..");
const ownedReleaseMigration = "src/migrations/V20990101000000__owned_drift_episode.sql";
const ownedReleaseSchema = `
export const driftEpisode = pgTable("drift_episode", {
  id: uuid("id").primaryKey(),
  vendorAccountId: uuid("vendor_account_id").references(() => vendorAccount.id),
  licenseTypeId: uuid("license_type_id").references(() => licenseType.id),
  personId: uuid("person_id").references(() => person.id),
  resolvedByAssignmentId: uuid("resolved_by_assignment_id").references(() => licenseAssignment.id).unique(),
  memberIdentity: text("member_identity").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => ({ open: uniqueIndex("drift_episode_open").on(table.vendorAccountId, table.memberIdentity, table.licenseTypeId).where(sql\`\${table.resolvedAt} IS NULL\`) }));
`;
const ownedReleaseSql = `
CREATE TABLE drift_episode (
 id uuid PRIMARY KEY, vendor_account_id uuid REFERENCES vendor_account(id),
 license_type_id uuid REFERENCES license_type(id), person_id uuid REFERENCES person(id),
 resolved_by_assignment_id uuid UNIQUE REFERENCES license_assignment(id),
 member_identity text NOT NULL, resolved_at timestamptz
);
CREATE UNIQUE INDEX drift_episode_open ON drift_episode(vendor_account_id,member_identity,license_type_id) WHERE resolved_at IS NULL;
ALTER TABLE drift_episode ENABLE ROW LEVEL SECURITY;
CREATE POLICY drift_episode_select ON drift_episode FOR SELECT TO ledger_app USING (EXISTS (SELECT 1 FROM public.vendor_account WHERE vendor_account.id=drift_episode.vendor_account_id));
CREATE POLICY drift_episode_insert ON drift_episode FOR INSERT TO ledger_app WITH CHECK (EXISTS (SELECT 1 FROM public.vendor_account WHERE vendor_account.id=drift_episode.vendor_account_id));
CREATE POLICY drift_episode_update ON drift_episode FOR UPDATE TO ledger_app USING (EXISTS (SELECT 1 FROM public.vendor_account WHERE vendor_account.id=drift_episode.vendor_account_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.vendor_account WHERE vendor_account.id=drift_episode.vendor_account_id));
GRANT SELECT,INSERT,UPDATE ON drift_episode TO ledger_app;
`;
type ReleaseFixture = { root: string; parent: string; head: string };
type ReleaseInput = { path: string; blob: string; sha256: string };
async function releaseGit(root: string, args: string[]): Promise<Buffer> {
  const result = await execFileAsync("git", args, { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  return result.stdout;
}
async function releaseWrite(root: string, path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes);
}
async function releaseCommit(root: string, message: string): Promise<string> {
  await releaseGit(root, ["add", "."]); await releaseGit(root, ["commit", "-m", message]);
  return (await releaseGit(root, ["rev-parse", "HEAD"])).toString().trim();
}
async function createOwnedReleaseFixture(variant: "valid" | "wrong-table" | "no-table"): Promise<ReleaseFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "chg105-owned-release-git-")));
  try {
    await releaseGit(root, ["init", "--initial-branch=main"]);
    await releaseGit(root, ["config", "user.name", "CHG105 release fixture"]);
    await releaseGit(root, ["config", "user.email", "chg105-release@example.test"]);
    const paths = (await releaseGit(repositoryRoot, ["ls-tree", "-r", "--name-only", releaseSource, "--", "packages/db/src/schema.ts", "packages/db/src/migrations", "packages/db/schema-contract.json", "packages/db/scripts", "packages/db/package.json", "packages/db/drizzle.config.ts"])).toString().trim().split("\n");
    for (const path of paths) await releaseWrite(root, path, await releaseGit(repositoryRoot, ["show", `${releaseSource}:${path}`]));
    await releaseWrite(root, "scripts/mutation-routes.json", "{}\n");
    const parent = await releaseCommit(root, "chore(CHG-900): exact production release baseline");
    const schema = await readFile(join(root, "packages/db/src/schema.ts"));
    await releaseWrite(root, "packages/db/src/schema.ts", Buffer.concat([schema, Buffer.from(ownedReleaseSchema)]));
    const sql = variant === "wrong-table" ? ownedReleaseSql.replaceAll("drift_episode", "wrong_episode") : variant === "no-table" ? "SELECT 1;\n" : ownedReleaseSql;
    await releaseWrite(root, `packages/db/${ownedReleaseMigration}`, sql);
    const baseline = JSON.parse(await readFile(join(root, "packages/db/schema-contract.json"), "utf8"));
    const row = structuredClone(extension);
    await releaseWrite(root, "packages/db/schema-contract.json", JSON.stringify({ ...baseline, schema_version: 2, newTables: [row] }, null, 2) + "\n");
    const head = await releaseCommit(root, "feat(US-987): owned exact release source");
    return { root, parent, head };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
async function assertReleaseInputs(bundle: string, inputs: ReleaseInput[]): Promise<void> {
  for (const input of inputs) {
    const bytes = await readFile(join(bundle, input.path));
    if (createHash("sha256").update(bytes).digest("hex") !== input.sha256
      || createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex") !== input.blob) {
      throw new Error(`Extracted Git object binding mismatch: ${input.path}`);
    }
  }
}
async function extractOwnedRelease(fixture: ReleaseFixture, revision: string): Promise<{ bundle: string; inputs: ReleaseInput[] }> {
  const bundle = await realpath(await mkdtemp(join(tmpdir(), "chg105-release-")));
  const inputs: ReleaseInput[] = [];
  try {
    const paths = (await releaseGit(fixture.root, ["ls-tree", "-r", "--name-only", revision, "--", "packages/db"])).toString().trim().split("\n");
    for (const path of paths) {
      const bytes = await releaseGit(fixture.root, ["show", `${revision}:${path}`]);
      const relative = path.slice("packages/db/".length);
      const blob = (await releaseGit(fixture.root, ["rev-parse", `${revision}:${path}`])).toString().trim();
      expect(createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex"), path).toBe(blob);
      await releaseWrite(bundle, relative, bytes); inputs.push({ path: relative, blob, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    await symlink(join(packageRoot, "node_modules"), join(bundle, "node_modules"), "dir");
    await assertReleaseInputs(bundle, inputs);
    return { bundle, inputs };
  } catch (error) { await rm(bundle, { recursive: true, force: true }); throw error; }
}

async function createVerifierBundle(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ledger-release-contract-")));
  try {
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, "src"));
    for (const filename of ["apply-migrations.mjs", "verify-schema.mjs", "schema-contract-policy.mjs", "schema-catalog-verifier.mjs"]) {
      await copyFile(join(packageRoot, "scripts", filename), join(directory, "scripts", filename));
    }
    await copyFile(join(packageRoot, "schema-contract.json"), join(directory, "schema-contract.json"));
    await symlink(committedMigrationsPath, join(directory, "src/migrations"), "dir");
    await symlink(join(packageRoot, "node_modules"), join(directory, "node_modules"), "dir");
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
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

async function copyCommittedMigrationPrefix(
  destination: string,
  lastFilename: string,
): Promise<void> {
  const filenames = (await readdir(committedMigrationsPath))
    .filter(
      (filename) =>
        filename.startsWith("V") &&
        filename.endsWith(".sql") &&
        filename.localeCompare(lastFilename) <= 0,
    )
    .sort((left, right) => left.localeCompare(right));
  await Promise.all(
    filenames.map((filename) =>
      copyFile(
        join(committedMigrationsPath, filename),
        join(destination, filename),
      ),
    ),
  );
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
  const sharedClusterUrl = process.env[SHARED_POSTGRES_CLUSTER_ENV];
  if (sharedClusterUrl) {
    clusterAdminUrl = sharedClusterUrl;
  } else {
    container = await new PostgreSqlContainer(POSTGRES_16_ALPINE_IMAGE)
      .withStartupTimeout(120_000)
      .start();
    clusterAdminUrl = container.getConnectionUri();
  }

  if (!sharedClusterUrl) {
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

  test("enforces one pending remove per request without blocking other action states or kinds", async () => {
    const database = await createDatabase();
    const client = new pg.Client({ connectionString: database.ownerUrl });
    const systemUserId = "00000000-0000-0000-0000-000000000001";
    const companyId = "00000000-0000-0000-0000-000000000401";
    const personId = "00000000-0000-0000-0000-000000000402";
    const vendorId = "00000000-0000-0000-0000-000000000403";
    const vendorAccountId = "00000000-0000-0000-0000-000000000404";
    const licenseTypeId = "00000000-0000-0000-0000-000000000405";
    const requestId = "00000000-0000-0000-0000-000000000406";
    try {
      await migrate(database.ownerUrl);
      await client.connect();
      await client.query(
        `INSERT INTO company
           (id, name, code, type, status, created_at, created_by)
         VALUES ($1, 'Boundary Company', 'BOUNDARY', 'internal', 'active', now(), $2)`,
        [companyId, systemUserId],
      );
      await client.query(
        `INSERT INTO person
           (id, email, full_name, company_id, status, created_at, created_by)
         VALUES ($1, 'boundary@example.com', 'Boundary Person', $2, 'active', now(), $3)`,
        [personId, companyId, systemUserId],
      );
      await client.query(
        `INSERT INTO vendor
           (id, name, connector_type, provisioning_protocol,
            can_provision, can_deprovision, has_usage_data, has_cost_data,
            identity_matching, status, created_at, created_by)
         VALUES ($1, 'Boundary Vendor', 'orchestration', 'none',
                 false, true, false, false, 'email', 'active', now(), $2)`,
        [vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO vendor_account
           (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
         VALUES ($1, $2, 'Boundary Account', 'orchestration', 0, 'active', now(), $3)`,
        [vendorAccountId, vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO license_type
           (id, vendor_id, name, unit, status, created_at, created_by)
         VALUES ($1, $2, 'Boundary License', 'seat', 'active', now(), $3)`,
        [licenseTypeId, vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO license_request
           (id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, created_at, created_by)
         VALUES ($1, 'BOUNDARY-REMOVE-1', $2, $3, $4, $5,
                 'offboarding', 'boundary test', now(), $6)`,
        [
          requestId,
          personId,
          companyId,
          vendorAccountId,
          licenseTypeId,
          systemUserId,
        ],
      );

      const first = await client.query(
        `INSERT INTO provisioning_action
           (id, request_id, vendor_account_id, kind, mode, status, created_at)
         VALUES
           ('00000000-0000-0000-0000-000000000407', $1, $2,
            'remove', 'orchestration', 'pending', now())`,
        [requestId, vendorAccountId],
      );
      expect(first.rowCount).toBe(1);

      await expect(
        client.query(
          `INSERT INTO provisioning_action
             (id, request_id, vendor_account_id, kind, mode, status, created_at)
           VALUES
             ('00000000-0000-0000-0000-000000000408', $1, $2,
              'remove', 'orchestration', 'pending', now())`,
          [requestId, vendorAccountId],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_provisioning_action_pending_remove_request",
      });

      await client.query(
        `INSERT INTO provisioning_action
           (id, request_id, vendor_account_id, kind, mode, status, created_at)
         VALUES
           ('00000000-0000-0000-0000-000000000409', $1, $2,
            'remove', 'orchestration', 'sent', now()),
           ('00000000-0000-0000-0000-000000000410', $1, $2,
            'invite', 'orchestration', 'pending', now())`,
        [requestId, vendorAccountId],
      );
      const allowed = await client.query(
        `SELECT id::text, kind, status
           FROM provisioning_action
          WHERE request_id = $1
          ORDER BY id`,
        [requestId],
      );
      expect(allowed.rows).toEqual([
        {
          id: "00000000-0000-0000-0000-000000000407",
          kind: "remove",
          status: "pending",
        },
        {
          id: "00000000-0000-0000-0000-000000000409",
          kind: "remove",
          status: "sent",
        },
        {
          id: "00000000-0000-0000-0000-000000000410",
          kind: "invite",
          status: "pending",
        },
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("allows one provision and one deprovision checklist while rejecting same-operation duplicates", async () => {
    const database = await createDatabase();
    const client = new pg.Client({ connectionString: database.ownerUrl });
    const systemUserId = "00000000-0000-0000-0000-000000000001";
    const companyId = "00000000-0000-4000-8000-000000000801";
    const personId = "00000000-0000-4000-8000-000000000802";
    const vendorId = "00000000-0000-4000-8000-000000000803";
    const vendorAccountId = "00000000-0000-4000-8000-000000000804";
    const licenseTypeId = "00000000-0000-4000-8000-000000000805";
    const requestId = "00000000-0000-4000-8000-000000000806";
    try {
      await migrate(database.ownerUrl);
      await client.connect();
      await client.query(
        `INSERT INTO company
           (id,name,code,type,status,created_at,created_by)
         VALUES ($1,'Operation Company','OP-COMPANY','internal','active',now(),$2)`,
        [companyId, systemUserId],
      );
      await client.query(
        `INSERT INTO person
           (id,email,full_name,company_id,status,created_at,created_by)
         VALUES ($1,'operation@example.test','Operation Person',$2,'active',now(),$3)`,
        [personId, companyId, systemUserId],
      );
      await client.query(
        `INSERT INTO vendor
           (id,name,connector_type,provisioning_protocol,can_provision,
            can_deprovision,has_usage_data,has_cost_data,identity_matching,
            status,created_at,created_by)
         VALUES ($1,'Operation Vendor','orchestration','none',false,false,
                 false,false,'email','active',now(),$2)`,
        [vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO vendor_account
           (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
         VALUES ($1,$2,'Operation Account','orchestration',0,'active',now(),$3)`,
        [vendorAccountId, vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO license_type
           (id,vendor_id,name,unit,status,created_at,created_by)
         VALUES ($1,$2,'Operation License','seat','active',now(),$3)`,
        [licenseTypeId, vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO license_request
           (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
            state,justification,created_at,created_by)
         VALUES ($1,'OPERATION-1',$2,$3,$4,$5,'provisioning','operation test',
                 now(),$6)`,
        [
          requestId,
          personId,
          companyId,
          vendorAccountId,
          licenseTypeId,
          systemUserId,
        ],
      );
      await client.query(
        `INSERT INTO provisioning_action
           (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
         VALUES
           ('00000000-0000-4000-8000-000000000807',$1,$2,'checklist',
            'orchestration','pending','{"operation":"provision"}',now()),
           ('00000000-0000-4000-8000-000000000808',$1,$2,'checklist',
            'orchestration','pending','{"operation":"deprovision"}',now()),
           ('00000000-0000-4000-8000-000000000809',$1,$2,'remove',
            'orchestration','pending','{"operation":"deprovision"}',now())`,
        [requestId, vendorAccountId],
      );
      await expect(
        client.query(
          `INSERT INTO provisioning_action
             (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
           VALUES
             ('00000000-0000-4000-8000-000000000810',$1,$2,'checklist',
              'orchestration','pending','{"operation":"provision"}',now())`,
          [requestId, vendorAccountId],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint:
          "uq_provisioning_action_orchestration_checklist_operation",
      });
      await expect(
        client.query(
          `INSERT INTO provisioning_action
             (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
           VALUES
             ('00000000-0000-4000-8000-000000000811',$1,$2,'remove',
              'orchestration','pending','{"operation":"deprovision"}',now())`,
          [requestId, vendorAccountId],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_provisioning_action_pending_remove_request",
      });
    } finally {
      await client.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("deterministically backfills request idempotency keys before enforcing uniqueness", async () => {
    const database = await createDatabase();
    const prefixMigrations = await mkdtemp(
      join(tmpdir(), "ledger-request-idempotency-prefix-"),
    );
    const client = new pg.Client({ connectionString: database.ownerUrl });
    const systemUserId = "00000000-0000-0000-0000-000000000001";
    const companyId = "00000000-0000-4000-8000-000000000701";
    const personId = "00000000-0000-4000-8000-000000000702";
    const vendorId = "00000000-0000-4000-8000-000000000703";
    const vendorAccountId = "00000000-0000-4000-8000-000000000704";
    const licenseTypeId = "00000000-0000-4000-8000-000000000705";
    const requestId = "00000000-0000-4000-8000-000000000706";
    try {
      await copyCommittedMigrationPrefix(
        prefixMigrations,
        "V20260728125700__verify_cross_org_move_runtime_privileges.sql",
      );
      const prefixResult = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: prefixMigrations,
      });
      expect(prefixResult.code, prefixResult.stderr).toBe(0);

      await client.connect();
      await client.query(
        `INSERT INTO company
           (id, name, code, type, status, created_at, created_by)
         VALUES ($1, 'Idempotency Company', 'IDEMPOTENCY', 'internal',
                 'active', now(), $2)`,
        [companyId, systemUserId],
      );
      await client.query(
        `INSERT INTO person
           (id, email, full_name, company_id, status, created_at, created_by)
         VALUES ($1, 'idempotency@example.test', 'Idempotency Person', $2,
                 'active', now(), $3)`,
        [personId, companyId, systemUserId],
      );
      await client.query(
        `INSERT INTO vendor
           (id, name, connector_type, provisioning_protocol,
            can_provision, can_deprovision, has_usage_data, has_cost_data,
            identity_matching, status, created_at, created_by)
         VALUES ($1, 'Idempotency Vendor', 'orchestration', 'none',
                 false, false, false, false, 'email', 'active', now(), $2)`,
        [vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO vendor_account
           (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
         VALUES ($1, $2, 'Idempotency Account', 'orchestration', 0,
                 'active', now(), $3)`,
        [vendorAccountId, vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO license_type
           (id, vendor_id, name, unit, status, created_at, created_by)
         VALUES ($1, $2, 'Idempotency License', 'seat', 'active', now(), $3)`,
        [licenseTypeId, vendorId, systemUserId],
      );
      await client.query(
        `INSERT INTO license_request
           (id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, requested_by,
            created_at, created_by)
         VALUES ($1, 'IDEMPOTENCY-LEGACY-1', $2, $3, $4, $5, 'submitted',
                 'legacy request', $6, now(), $6)`,
        [
          requestId,
          personId,
          companyId,
          vendorAccountId,
          licenseTypeId,
          systemUserId,
        ],
      );

      const upgrade = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(upgrade.code, upgrade.stderr).toBe(0);

      const backfilled = await client.query<{
        client_request_id: string;
        is_nullable: string;
      }>(
        `SELECT request.client_request_id::text,
                column_state.is_nullable
           FROM license_request request
           JOIN information_schema.columns column_state
             ON column_state.table_schema = 'public'
            AND column_state.table_name = 'license_request'
            AND column_state.column_name = 'client_request_id'
          WHERE request.id = $1`,
        [requestId],
      );
      expect(backfilled.rows).toEqual([
        { client_request_id: requestId, is_nullable: "NO" },
      ]);

      await expect(
        client.query(
          `INSERT INTO license_request
             (id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, requested_by,
              client_request_id, created_at, created_by)
           VALUES (
             '00000000-0000-4000-8000-000000000707',
             'IDEMPOTENCY-DUPLICATE-1', $1, $2, $3, $4, 'submitted',
             'duplicate request', $5, $6, now(), $5
           )`,
          [
            personId,
            companyId,
            vendorAccountId,
            licenseTypeId,
            systemUserId,
            requestId,
          ],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_license_request_requester_client_request",
      });
    } finally {
      await client.end().catch(() => undefined);
      await rm(prefixMigrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    {
      name: "workflow enum values in a non-canonical order",
      injectedSql: `
        ALTER TYPE alert_rule_type_enum ADD VALUE 'close_missed';
        ALTER TYPE alert_rule_type_enum ADD VALUE 'deprovision_overdue';
      `,
      expectedError:
        "Sprint 2 workflow guard verification failed: alert_rule_type_enum labels/order",
      expectedPreviousVerificationCount: "0",
    },
    {
      name: "an incompatible dedupe column",
      injectedSql:
        "ALTER TABLE alert_event ADD COLUMN dedupe_key varchar(20) DEFAULT 'unexpected'",
      expectedError:
        "Sprint 2 workflow guard verification failed: alert_event.dedupe_key column",
      expectedPreviousVerificationCount: "0",
    },
    {
      name: "an incompatible alert dedupe index",
      injectedSql: `
        ALTER TABLE alert_event ADD COLUMN dedupe_key text;
        CREATE UNIQUE INDEX uq_alert_event_dedupe_key
          ON alert_event (id)
          WHERE id IS NOT NULL;
      `,
      expectedError:
        "Sprint 2 workflow guard verification failed: uq_alert_event_dedupe_key index",
      expectedPreviousVerificationCount: "0",
    },
    {
      name: "an incompatible person email index",
      injectedSql:
        "CREATE UNIQUE INDEX uq_person_lower_email ON person (email)",
      expectedError:
        "Sprint 2 workflow guard verification failed: uq_person_lower_email index",
      expectedPreviousVerificationCount: "0",
    },
    {
      name: "an incompatible request number unique object",
      injectedSql: `
        ALTER TABLE license_request
          DROP CONSTRAINT uq_license_request_request_no;
        CREATE UNIQUE INDEX uq_license_request_request_no
          ON license_request (id);
      `,
      expectedError:
        "Sprint 2 workflow guard verification failed: uq_license_request_request_no constraint",
      expectedPreviousVerificationCount: "0",
    },
    {
      name: "a deferrable initially-deferred request number constraint",
      injectedSql: `
        ALTER TABLE license_request
          DROP CONSTRAINT uq_license_request_request_no;
        ALTER TABLE license_request
          ADD CONSTRAINT uq_license_request_request_no
          UNIQUE (request_no)
          DEFERRABLE INITIALLY DEFERRED;
      `,
      expectedError:
        "Sprint 2 request number verification failed: uq_license_request_request_no must be immediate",
      expectedPreviousVerificationCount: "1",
    },
  ])(
    "fails closed after the original guard migration encounters $name",
    async ({
      injectedSql,
      expectedError,
      expectedPreviousVerificationCount,
    }) => {
      const database = await createDatabase();
      const prefixMigrations = await mkdtemp(
        join(tmpdir(), "ledger-sprint2-prefix-"),
      );
      const client = new pg.Client({ connectionString: database.ownerUrl });
      try {
        await copyCommittedMigrationPrefix(
          prefixMigrations,
          "V20260726002000__vendor_import_natural_keys.sql",
        );
        const prefixResult = await runNode(runnerPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
          MIGRATIONS_DIR: prefixMigrations,
        });
        expect(prefixResult.code, prefixResult.stderr).toBe(0);

        await client.connect();
        await client.query(injectedSql);

        const upgradeResult = await runNode(runnerPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
        });
        expect(upgradeResult.code).not.toBe(0);
        expect(upgradeResult.stderr).toContain(expectedError);

        const ledger = await client.query<{
          guard_count: string;
          previous_verification_count: string;
          immediate_verification_count: string;
        }>(
          `
            SELECT
              count(*) FILTER (
                WHERE filename = 'V20260727090000__sprint2_workflow_guards.sql'
              )::text AS guard_count,
              count(*) FILTER (
                WHERE filename = 'V20260727091000__verify_sprint2_workflow_guards.sql'
              )::text AS previous_verification_count,
              count(*) FILTER (
                WHERE filename = 'V20260727092000__verify_request_number_immediacy.sql'
              )::text AS immediate_verification_count
            FROM ledger_schema_migrations
          `,
        );
        expect(ledger.rows).toEqual([
          {
            guard_count: "1",
            previous_verification_count: expectedPreviousVerificationCount,
            immediate_verification_count: "0",
          },
        ]);
      } finally {
        await client.end().catch(() => undefined);
        await rm(prefixMigrations, { recursive: true, force: true });
        await dropDatabase(database.name);
      }
    },
    30_000,
  );

  test("rejects semantic global alert threshold drift without consulting rule IDs", async () => {
    const database = await createDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await owner.connect();
      await owner.query(
        `UPDATE alert_rule
         SET threshold = '{"floor":999}'::jsonb
         WHERE type = 'low_pool' AND scope_kind = 'global'`,
      );
      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("global alert semantic defaults mismatch");
    } finally {
      await owner.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    {
      name: "a missing pending-remove index",
      injectedSql:
        "DROP INDEX uq_provisioning_action_pending_remove_request",
    },
    {
      name: "a wrong pending-remove index key",
      injectedSql: `
        DROP INDEX uq_provisioning_action_pending_remove_request;
        CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
          ON provisioning_action (id)
          WHERE kind = 'remove' AND status = 'pending';
      `,
    },
    {
      name: "a wrong pending-remove predicate",
      injectedSql: `
        DROP INDEX uq_provisioning_action_pending_remove_request;
        CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
          ON provisioning_action (request_id)
          WHERE kind = 'remove';
      `,
    },
  ])(
    "fails closed and leaves the verifier unrecorded after $name",
    async ({ injectedSql }) => {
      const database = await createDatabase();
      const prefixMigrations = await mkdtemp(
        join(tmpdir(), "ledger-pending-remove-prefix-"),
      );
      const client = new pg.Client({ connectionString: database.ownerUrl });
      try {
        await copyCommittedMigrationPrefix(
          prefixMigrations,
          "V20260727094000__pending_remove_idempotency.sql",
        );
        const prefixResult = await runNode(runnerPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
          MIGRATIONS_DIR: prefixMigrations,
        });
        expect(prefixResult.code, prefixResult.stderr).toBe(0);

        await client.connect();
        await client.query(injectedSql);

        const upgradeResult = await runNode(runnerPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
        });
        expect(upgradeResult.code).not.toBe(0);
        expect(upgradeResult.stderr).toContain(pendingRemoveVerifierError);

        const verifierSql = await readFile(
          join(committedMigrationsPath, pendingRemoveVerifierFilename),
          "utf8",
        );
        await expect(client.query(verifierSql)).rejects.toMatchObject({
          code: "23514",
          constraint:
            "uq_provisioning_action_pending_remove_request",
          message: pendingRemoveVerifierError,
        });

        const ledger = await client.query<{ verifier_count: string }>(
          `
            SELECT count(*) FILTER (
              WHERE filename = $1
            )::text AS verifier_count
            FROM ledger_schema_migrations
          `,
          [pendingRemoveVerifierFilename],
        );
        expect(ledger.rows).toEqual([{ verifier_count: "0" }]);
      } finally {
        await client.end().catch(() => undefined);
        await rm(prefixMigrations, { recursive: true, force: true });
        await dropDatabase(database.name);
      }
    },
    30_000,
  );

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

  test("verifies the committed migration ledger and exact runtime integrity state", async () => {
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
      expect(verified.stdout).toContain(
        "ledger_app has the exact least-privilege runtime grant matrix",
      );
    } finally {
      await dropDatabase(database.name);
    }
  }, 30_000);

  // Immutable pre-CHG100 Gitblob4b189bb... literal/derivation fixture, not
  // candidate JSON. The complete reconstructed executable hash below is fixed.
  const originalPrivilegeDeclarations = `const coreTableNames = [
  "activity_record",
  "alert_event",
  "alert_notification_delivery",
  "alert_rule",
  "audit_log",
  "close_run",
  "capacity_recovery_work",
  "company",
  "company_role_assignment",
  "connector_call_observation",
  "cost_record",
  "integration_credential",
  "identity_provider_operation",
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

const normallyUpdateableTableNames = [
  "alert_rule",
  "capacity_recovery_work",
  "close_run",
  "company",
  "company_role_assignment",
  "integration_credential",
  "identity_provider_operation",
  "license_request",
  "license_type",
  "person",
  "reclamation_proposal",
  "reconciliation",
  "statement",
  "system_setting",
  "user_account",
  "vendor",
  "vendor_account",
];

const expectedRuntimeTableGrants = [
  ...coreTableNames.flatMap((tableName) => [
    ...(["alert_notification_delivery", "lifecycle_notification_delivery"].includes(tableName)
      ? []
      : [{ tableName, privilege: "INSERT" }]),
    { tableName, privilege: "SELECT" },
  ]),
  ...normallyUpdateableTableNames.map((tableName) => ({
    tableName,
    privilege: "UPDATE",
  })),
].sort((left, right) =>
  left.tableName.localeCompare(right.tableName) ||
  left.privilege.localeCompare(right.privilege),
);

const expectedAppendOnlyColumnUpdates = [
  { tableName: "activity_record", columnName: "counters" },
  { tableName: "activity_record", columnName: "raw_payload" },
  { tableName: "activity_record", columnName: "source" },
  { tableName: "activity_record", columnName: "synced_at" },
  { tableName: "cost_record", columnName: "amount_usd" },
  { tableName: "cost_record", columnName: "raw_payload" },
  { tableName: "cost_record", columnName: "source" },
  { tableName: "cost_record", columnName: "synced_at" },
  { tableName: "alert_event", columnName: "acknowledged_at" },
  { tableName: "alert_event", columnName: "acknowledged_by" },
  { tableName: "license_assignment", columnName: "end_reason" },
  { tableName: "license_assignment", columnName: "ended_on" },
  { tableName: "provisioning_action", columnName: "failure_reason" },
  { tableName: "provisioning_action", columnName: "raw_response" },
  { tableName: "provisioning_action", columnName: "resolved_at" },
  { tableName: "provisioning_action", columnName: "sent_at" },
  { tableName: "provisioning_action", columnName: "status" },
  { tableName: "provisioning_action", columnName: "vendor_ref" },
];

`;

  test("CHG-100 preserves the pinned old verifier results grants and diagnostics on one catalog", async () => {
    const database = await createDatabase();
    const bundle = await createVerifierBundle();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      const source = await readFile(join(bundle, "scripts/verify-schema.mjs"), "utf8");
      // Restore the independent historical declaration/derivation placement,
      // then pin the WHOLE old executable before executing the real oracle.
      const entryAttestation = /  const schemaContractPath = [\s\S]*?(?=  if \(!databaseAdminUrl\))/u;
      const oldSource = source
        .replace('import { createHash } from "node:crypto";\n', "")
        .replace('import { verifySchemaExtensionCatalog } from "./schema-catalog-verifier.mjs";\n', "")
        .replace(/^[ \t]*\/\/ CHG-104 begin[^\n]*\n[\s\S]*?^[ \t]*\/\/ CHG-104 end[^\n]*\n/gmu, "")
        .replace('import { fileURLToPath, pathToFileURL }', 'import { pathToFileURL }')
        .replace('import { parseSchemaContract, attestSchemaContract } from "./schema-contract-policy.mjs";\n', "")
        .replace(entryAttestation, "")
        .replace("const systemUserId =", originalPrivilegeDeclarations + "const systemUserId =");
      expect(sha256(oldSource)).toBe("d927f78f95e192e6c5e96344859449a99894d59c8917363c950ac4b6e65bc767");
      const oldPath = join(bundle, "scripts/old-verify-schema.mjs");
      const currentPath = join(bundle, "scripts/verify-schema.mjs");
      // US-038 extends the release grant profile after pinning the untouched
      // historical executable. Compare both verifiers under the same two
      // guarded variance CRUD grants; preserve the historical hash above.
      const releaseSource = oldSource
        .replace('  "reconciliation",\n  "statement",', '  "reconciliation",\n  "reconciliation_variance_line",\n  "statement",')
        .replace('const expectedRuntimeTableGrants = [\n', 'const expectedRuntimeTableGrants = [\n  { tableName: "reconciliation_variance_line", privilege: "DELETE" },\n');
      await writeFile(oldPath, releaseSource);
      const environment = { DATABASE_ADMIN_URL: database.ownerUrl, DATABASE_URL: database.appUrl };
      const oldCli = await runNode(oldPath, environment);
      const currentCli = await runNode(currentPath, environment);
      expect(oldCli.code, oldCli.stderr).toBe(0);
      expect(currentCli).toEqual(oldCli);
      const migrationCount = (await readdir(committedMigrationsPath)).filter((name) => /^V\d{14}__.+\.sql$/.test(name)).length;
      expect(currentCli.stdout).toBe(
        `✓ ${migrationCount} committed migration checksum(s) verified across 33 application table(s)\n` +
        "✓ 6 append-only trigger(s) verified\n" +
        "✓ ledger_app has the exact least-privilege runtime grant matrix\n",
      );
      for (const name of ["old-verify-schema", "verify-schema"]) {
        await writeFile(join(bundle, `scripts/inspect-${name}.mjs`),
          `import { verifyMigratedSchema } from "./${name}.mjs";\nprocess.stdout.write(JSON.stringify(await verifyMigratedSchema()));\n`);
      }
      const oldResult = await runNode(join(bundle, "scripts/inspect-old-verify-schema.mjs"), environment);
      const currentResult = await runNode(join(bundle, "scripts/inspect-verify-schema.mjs"), environment);
      expect(oldResult.code, oldResult.stderr).toBe(0);
      expect(currentResult).toEqual(oldResult);
      const result = JSON.parse(currentResult.stdout);
      expect(result).toMatchObject({ ownerRole: "ledger_owner", tableCount: 33, migrationCount, appendOnlyTriggerCount: 6,
        applicationIntegrity: { role: "ledger_app", totalTables: 33 } });
      expect(result.applicationIntegrity.tableGrants.length).toBeGreaterThan(33);
      expect(result.applicationIntegrity.columnPrivileges.length).toBeGreaterThan(33);

      // Deliberate returned-data fault in the real copied helper: the actual
      // catalog verifier must use attested declarations, not leftover literals.
      const policyPath = join(bundle, "scripts/schema-contract-policy.mjs");
      const policySource = await readFile(policyPath, "utf8");
      const returnedDataFault = policySource.replace(/  return candidate;\n\}\s*$/u,
        "  return { ...candidate, normallyUpdateableTableNames: [] };\n}\n");
      expect(returnedDataFault).not.toBe(policySource);
      try {
        await writeFile(policyPath, returnedDataFault);
        const consumed = await runNode(currentPath, environment);
        expect(consumed.code).toBe(1);
        expect(consumed.stdout).toBe("");
        expect(consumed.stderr).toContain("ledger_app runtime table-grant matrix mismatch");
      } finally {
        await writeFile(policyPath, policySource);
      }

      // The old executable also pins a real specialized failure diagnostic,
      // rather than comparing success status alone.
      await owner.connect();
      await owner.query("GRANT DELETE ON company TO ledger_app");
      const oldFailure = await runNode(oldPath, environment);
      const currentFailure = await runNode(currentPath, environment);
      expect(oldFailure.code).toBe(1);
      expect(oldFailure.stderr).toContain("ledger_app runtime table-grant matrix mismatch");
      expect(currentFailure).toEqual(oldFailure);
    } finally {
      await owner.end().catch(() => undefined);
      await rm(bundle, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("CHG-100 rejects missing unsafe duplicate reordered and changed declarations before real release success", async () => {
    const database = await createDatabase();
    const bundle = await createVerifierBundle();
    try {
      await migrate(database.ownerUrl);
      const declarationPath = join(bundle, "schema-contract.json");
      const canonical = await readFile(declarationPath, "utf8");
      const changed = JSON.parse(canonical);
      changed.expectedAppendOnlyColumnUpdates[0].columnName = "wrong_column";
      const reordered = JSON.parse(canonical);
      reordered.coreTableNames.reverse();
      const environment = { DATABASE_ADMIN_URL: database.ownerUrl, DATABASE_URL: database.appUrl };
      const executable = join(bundle, "scripts/verify-schema.mjs");
      const valid = await runNode(executable, environment);
      expect(valid.code, valid.stderr).toBe(0);
      expect(valid.stdout).toContain("33 application table(s)");
      const faults: Array<[string, string | null, string]> = [
        ["missing", null, "missing"],
        ["escaped duplicate", canonical.replace('"schema_version": 1,', '"schema_version": 1, "schema_\\u0076ersion": 1,'), "duplicate-key"],
        ["unsafe", canonical.replace('"activity_record"', '"public.activity_record"'), "invalid-identifier"],
        ["noncanonical", canonical.replaceAll("\n", "\r\n"), "noncanonical"],
        ["reordered", JSON.stringify(reordered, null, 2) + "\n", "baseline-mismatch"],
        ["changed value", JSON.stringify(changed, null, 2) + "\n", "baseline-mismatch"],
      ];
      for (const [name, bytes, category] of faults) {
        if (bytes === null) await rm(declarationPath);
        else await writeFile(declarationPath, bytes);
        const rejected = await runNode(executable, environment);
        expect(rejected.code, name).toBe(1);
        expect(rejected.stderr, name).toContain(`schema-contract/${category}`);
        expect(rejected.stderr, name).toContain(declarationPath);
        expect(rejected.stdout, name).toBe("");
        await writeFile(declarationPath, canonical);
        const restored = await runNode(executable, environment);
        expect(restored, name).toEqual(valid);
      }
    } finally {
      await rm(bundle, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("rejects identity-provider operation constraint drift in both schema verifiers", async () => {
    const database = await createDatabase();
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await client.connect();
      await client.query(
        "ALTER TABLE identity_provider_operation DROP CONSTRAINT identity_provider_operation_lease_pair_check",
      );

      const runtimeVerification = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(runtimeVerification.code).not.toBe(0);
      expect(runtimeVerification.stderr).toContain(
        "identity_provider_operation constraint contract mismatch",
      );

      const migrationVerification = await readLatestIdentityProviderVerifier();
      await expect(client.query(migrationVerification)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "identity provider operation constraint contract mismatch",
        ),
      });
    } finally {
      await client.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    {
      drift: "a missing primary-key constraint",
      tamper:
        "ALTER TABLE identity_provider_operation DROP CONSTRAINT identity_provider_operation_pkey",
      expectedContract: "constraint",
    },
    {
      drift: "a missing idempotency-key unique constraint",
      tamper:
        "ALTER TABLE identity_provider_operation DROP CONSTRAINT identity_provider_operation_idempotency_key_key",
      expectedContract: "constraint",
    },
    {
      drift: "an unexpected index",
      tamper:
        "CREATE INDEX idx_identity_provider_operation_unexpected ON identity_provider_operation (created_at)",
      expectedContract: "index",
    },
  ])(
    "rejects identity-provider operation drift from $drift in both schema verifiers",
    async ({ tamper, expectedContract }) => {
      const database = await createDatabase();
      const client = new pg.Client({ connectionString: database.ownerUrl });
      try {
        await migrate(database.ownerUrl);
        await client.connect();
        await client.query(tamper);

        const runtimeVerification = await runNode(verifyPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
          DATABASE_URL: database.appUrl,
        });
        const migrationVerification = await readLatestIdentityProviderVerifier();

        expect.soft(runtimeVerification.code).not.toBe(0);
        expect.soft(runtimeVerification.stderr).toContain(
          `identity_provider_operation ${expectedContract} contract mismatch`,
        );
        await expect.soft(client.query(migrationVerification)).rejects.toMatchObject({
          code: "P0001",
          message: expect.stringContaining(
            `identity provider operation ${expectedContract} contract mismatch`,
          ),
        });
      } finally {
        await client.end().catch(() => undefined);
        await dropDatabase(database.name);
      }
    },
    30_000,
  );

  test("rejects empty identity-provider constraint and index catalogs in both schema verifiers", async () => {
    const database = await createDatabase();
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await client.connect();
      await client.query(`
        ALTER TABLE identity_provider_operation
          DROP CONSTRAINT identity_provider_operation_actor_user_id_fkey,
          DROP CONSTRAINT identity_provider_operation_attempt_count_check,
          DROP CONSTRAINT identity_provider_operation_company_id_fkey,
          DROP CONSTRAINT identity_provider_operation_idempotency_key_key,
          DROP CONSTRAINT identity_provider_operation_kind_check,
          DROP CONSTRAINT identity_provider_operation_lease_pair_check,
          DROP CONSTRAINT identity_provider_operation_pkey,
          DROP CONSTRAINT identity_provider_operation_status_check,
          DROP CONSTRAINT identity_provider_operation_target_user_account_id_fkey;
        DROP INDEX idx_identity_provider_operation_retry;
      `);
      const emptyCatalogs = await client.query<{ constraints: number; indexes: number }>(`
        SELECT
          (SELECT count(*)::int
           FROM pg_constraint
           WHERE conrelid = 'public.identity_provider_operation'::regclass) AS constraints,
          (SELECT count(*)::int
           FROM pg_index
           WHERE indrelid = 'public.identity_provider_operation'::regclass) AS indexes
      `);
      expect(emptyCatalogs.rows).toEqual([{ constraints: 0, indexes: 0 }]);

      const runtimeVerification = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(runtimeVerification.code).not.toBe(0);
      expect(runtimeVerification.stderr).toContain(
        "identity_provider_operation constraint contract mismatch",
      );

      const migrationVerification = await readLatestIdentityProviderVerifier();
      await expect(client.query(migrationVerification)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringMatching(
          /identity provider operation constraint contract mismatch.*identity provider operation index contract mismatch/u,
        ),
      });
    } finally {
      await client.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("fails the cross-org verifier when any required runtime privilege is revoked", async () => {
    const database = await createDatabase();
    const client = new pg.Client({ connectionString: database.ownerUrl });
    const requiredPrivileges = [
      ["license_request", "SELECT"],
      ["license_request", "INSERT"],
      ["license_request", "UPDATE"],
      ["request_transition", "SELECT"],
      ["request_transition", "INSERT"],
      ["provisioning_action", "SELECT"],
      ["provisioning_action", "INSERT"],
      ["audit_log", "SELECT"],
      ["audit_log", "INSERT"],
      ["license_assignment", "SELECT"],
      ["person", "SELECT"],
      ["company", "SELECT"],
      ["vendor_account", "SELECT"],
      ["vendor", "SELECT"],
      ["license_type", "SELECT"],
    ] as const;
    try {
      const migrated = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(migrated.code, migrated.stderr).toBe(0);
      await client.connect();
      const verifierSql = await readFile(
        join(
          committedMigrationsPath,
          crossOrgPrivilegeVerifierFilename,
        ),
        "utf8",
      );

      for (const [tableName, privilege] of requiredPrivileges) {
        await client.query(
          `REVOKE ${privilege} ON TABLE "${tableName}" FROM ledger_app`,
        );
        try {
          await expect(client.query(verifierSql)).rejects.toMatchObject({
            code: "42501",
            message:
              `cross-org move runtime privilege verification failed: ${tableName} ${privilege}`,
          });
        } finally {
          await client.query(
            `GRANT ${privilege} ON TABLE "${tableName}" TO ledger_app`,
          );
        }
      }
      await expect(client.query(verifierSql)).resolves.toMatchObject({
        command: "DO",
      });
    } finally {
      await client.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("upgrades a pre-Sprint-2 semantic global alert row without losing its AlertEvent", async () => {
    const database = await createDatabase();
    const prefixMigrations = await mkdtemp(
      join(tmpdir(), "ledger-alert-seed-prefix-"),
    );
    const legacyRuleId = "00000000-0000-4000-8000-000000009999";
    const legacyEventId = "00000000-0000-4000-8000-000000009998";
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await copyCommittedMigrationPrefix(
        prefixMigrations,
        "V20260726002000__vendor_import_natural_keys.sql",
      );
      const prefixResult = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: prefixMigrations,
      });
      expect(prefixResult.code, prefixResult.stderr).toBe(0);

      await client.connect();
      await client.query(
        `INSERT INTO alert_rule
           (id, type, scope_kind, threshold, channel, enabled, created_at, created_by)
         VALUES
           ($1, 'low_pool', 'global', '{"floor":2}', 'email', false,
            '2025-01-01T00:00:00Z', '00000000-0000-0000-0000-000000000001')`,
        [legacyRuleId],
      );
      await client.query(
        `INSERT INTO alert_event
           (id, alert_rule_id, fired_at, subject_ref, notified)
         VALUES
           ($1, $2, '2025-01-02T00:00:00Z', '{"vendorAccountId":"legacy"}',
            '{"status":"pending"}')`,
        [legacyEventId, legacyRuleId],
      );

      const upgrade = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(upgrade.code, upgrade.stderr).toBe(0);
      const rerun = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(rerun.code, rerun.stderr).toBe(0);

      const state = await client.query<{
        global_count: number;
        threshold: unknown;
        enabled: boolean;
        event_count: number;
        event_rule_matches: boolean;
      }>(
        `SELECT
           (SELECT count(*)::int FROM alert_rule WHERE scope_kind = 'global')
             AS global_count,
           rule.threshold,
           rule.enabled,
           count(event.id)::int AS event_count,
           bool_and(event.alert_rule_id = rule.id) AS event_rule_matches
         FROM alert_rule rule
         JOIN alert_event event ON event.id = $1
         WHERE rule.type = 'low_pool' AND rule.scope_kind = 'global'
         GROUP BY rule.id, rule.threshold, rule.enabled`,
        [legacyEventId],
      );
      expect(state.rows).toEqual([
        {
          enabled: true,
          event_count: 1,
          event_rule_matches: true,
          global_count: 10,
          threshold: { floor: 5 },
        },
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await rm(prefixMigrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("upgrades legacy deprovision thresholds to the same-business-day shape", async () => {
    const database = await createDatabase();
    const prefixMigrations = await mkdtemp(
      join(tmpdir(), "ledger-deprovision-prefix-"),
    );
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await copyCommittedMigrationPrefix(
        prefixMigrations,
        "V20260727101003__verify_alert_delivery_journal_hardening.sql",
      );
      const prefixResult = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: prefixMigrations,
      });
      expect(prefixResult.code, prefixResult.stderr).toBe(0);

      await client.connect();
      await client.query(
        `INSERT INTO company
           (id, name, code, type, status, created_at, created_by)
         VALUES
           ('00000000-0000-4000-8000-000000008201', 'Legacy deadline',
            'LEGACY-DEADLINE', 'internal', 'active', now(),
            '00000000-0000-0000-0000-000000000001');
         INSERT INTO alert_rule
           (id, type, scope_kind, company_id, threshold, channel, enabled,
            created_at, created_by)
         VALUES
           ('00000000-0000-4000-8000-000000008202', 'deprovision_overdue',
            'company', '00000000-0000-4000-8000-000000008201',
            '{"hours":24}', 'email', true, now(),
            '00000000-0000-0000-0000-000000000001')`,
      );

      const upgrade = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(upgrade.code, upgrade.stderr).toBe(0);
      const thresholds = await client.query<{ threshold: unknown }>(
        `SELECT threshold
         FROM alert_rule
         WHERE type = 'deprovision_overdue'
         ORDER BY scope_kind, id`,
      );
      expect(thresholds.rows).toEqual([
        { threshold: { businessDays: 0 } },
        { threshold: { businessDays: 0 } },
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await rm(prefixMigrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("upgrades only canonical legacy approval-aging defaults", async () => {
    const database = await createDatabase();
    const prefixMigrations = await mkdtemp(
      join(tmpdir(), "ledger-approval-aging-prefix-"),
    );
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await copyCommittedMigrationPrefix(
        prefixMigrations,
        "V20260728140000__lifecycle_notification_outbox.sql",
      );
      const prefixResult = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        MIGRATIONS_DIR: prefixMigrations,
      });
      expect(prefixResult.code, prefixResult.stderr).toBe(0);

      await client.connect();
      await client.query(
        `INSERT INTO company
           (id, name, code, type, status, created_at, created_by)
         VALUES
           ('00000000-0000-4000-8000-000000008211', 'Legacy approval',
            'LEGACY-APPROVAL', 'internal', 'active', now(),
            '00000000-0000-0000-0000-000000000001');
         INSERT INTO alert_rule
           (id, type, scope_kind, company_id, threshold, channel, enabled,
            created_at, created_by)
         VALUES
           ('00000000-0000-4000-8000-000000008212', 'approval_aging',
            'company', '00000000-0000-4000-8000-000000008211',
            '{"hours":24}', 'email', true, now(),
           '00000000-0000-0000-0000-000000000001'),
           ('00000000-0000-4000-8000-000000008213', 'approval_aging',
            'company', '00000000-0000-4000-8000-000000008211',
            '{"hours":12}', 'email', true, now(),
            '00000000-0000-0000-0000-000000000001')`,
      );

      const upgrade = await runNode(runnerPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
      });
      expect(upgrade.code, upgrade.stderr).toBe(0);
      const thresholds = await client.query<{
        id: string;
        threshold: unknown;
      }>(
        `SELECT id::text, threshold
         FROM alert_rule
         WHERE id IN (
           '00000000-0000-4000-8000-000000004201',
           '00000000-0000-4000-8000-000000008212',
           '00000000-0000-4000-8000-000000008213'
         )
         ORDER BY id`,
      );
      expect(thresholds.rows).toEqual([
        {
          id: "00000000-0000-4000-8000-000000004201",
          threshold: { hours: 24, escalationHours: 48 },
        },
        {
          id: "00000000-0000-4000-8000-000000008212",
          threshold: { hours: 24, escalationHours: 48 },
        },
        {
          id: "00000000-0000-4000-8000-000000008213",
          threshold: { hours: 12 },
        },
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await rm(prefixMigrations, { recursive: true, force: true });
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("schema verification detects legacy deprovision threshold drift", async () => {
    const database = await createDatabase();
    const client = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await client.connect();
      await client.query(
        `UPDATE alert_rule
         SET threshold = '{"hours":24}'::jsonb
         WHERE type = 'deprovision_overdue' AND scope_kind = 'global'`,
      );
      const verified = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(verified.code).not.toBe(0);
      expect(verified.stderr).toContain(
        "global alert semantic defaults mismatch",
      );
    } finally {
      await client.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test("fences alert delivery journal transitions behind controlled functions", async () => {
    const database = await createDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    const application = new pg.Client({ connectionString: database.appUrl });
    const eventId = "00000000-0000-4000-8000-000000008001";
    try {
      await migrate(database.ownerUrl);
      await Promise.all([owner.connect(), application.connect()]);
      await owner.query(
        `INSERT INTO alert_event
           (id, alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
         SELECT $1, id, '2026-07-27T12:00:00Z',
                '{"requestId":"fenced"}', '{"status":"pending"}', 'fenced-event'
         FROM alert_rule
         WHERE type = 'approval_aging' AND scope_kind = 'global'`,
        [eventId],
      );

      await expect(
        application.query(
          `INSERT INTO alert_notification_delivery
             (alert_event_id, attempt, phase, occurred_at)
           VALUES ($1, 0, 'pending', '2026-07-27T12:00:00Z')`,
          [eventId],
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await application.query(
        "SELECT append_alert_delivery_pending($1, '2026-07-27T12:00:00Z')",
        [eventId],
      );
      await expect(
        application.query(
          `SELECT complete_alert_delivery(
             $1, 1, '00000000-0000-4000-8000-000000008098',
             '2026-07-27T12:00:01Z',
             'failed', NULL, NULL, 'forged')`,
          [eventId],
        ),
      ).rejects.toMatchObject({ code: "55000" });

      const claim = await application.query<{
        attempt: number;
        claim_token: string;
      }>(
        `SELECT * FROM claim_alert_delivery(
           $1, '2026-07-27T12:00:01Z', '2026-07-27T12:01:01Z', 'worker-a')`,
        [eventId],
      );
      expect(claim.rows).toEqual([
        { attempt: 1, claim_token: expect.any(String) },
      ]);
      const claimToken = claim.rows[0]!.claim_token;

      await expect(
        application.query(
          `SELECT complete_alert_delivery(
             $1, 1, $2, '2026-07-27T12:00:02Z',
             'failed', NULL, NULL, 'forged')`,
          [eventId, "00000000-0000-4000-8000-000000008099"],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        application.query(
          `SELECT claim_alert_delivery(
             $1, '2026-07-27T12:00:03Z', '2026-07-27T12:01:03Z', 'worker-b')`,
          [eventId],
        ),
      ).rejects.toMatchObject({ code: "55000" });

      await application.query(
        `SELECT complete_alert_delivery(
           $1, 1, $2, '2026-07-27T12:00:04Z',
           'succeeded', 'smtp-fenced', '["admin@corporativo.ec"]', NULL)`,
        [eventId, claimToken],
      );
      await expect(
        application.query(
          `SELECT complete_alert_delivery(
             $1, 1, $2, '2026-07-27T12:00:05Z',
             'failed', NULL, NULL, 'late-forgery')`,
          [eventId, claimToken],
        ),
      ).rejects.toMatchObject({ code: "55000" });

      const journal = await owner.query<{
        attempt: number;
        phase: string;
      }>(
        `SELECT attempt, phase::text
         FROM alert_notification_delivery
         WHERE alert_event_id = $1
         ORDER BY attempt, occurred_at`,
        [eventId],
      );
      expect(journal.rows).toEqual([
        { attempt: 0, phase: "pending" },
        { attempt: 1, phase: "claimed" },
        { attempt: 1, phase: "succeeded" },
      ]);
    } finally {
      await Promise.all([
        owner.end().catch(() => undefined),
        application.end().catch(() => undefined),
      ]);
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
    ["INSERT", "alert_notification_delivery"],
    ["DELETE", "company"],
    ["UPDATE", "audit_log"],
    ["UPDATE", "license_assignment"],
    ["DELETE", "license_type"],
    ["TRUNCATE", "company"],
    ["REFERENCES", "company"],
    ["TRIGGER", "company"],
  ])("rejects a forbidden ledger_app %s privilege", async (privilege, tableName) => {
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
        "ledger_app runtime table-grant matrix mismatch",
      );
    } finally {
      await owner.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    [
      "function security",
      "ALTER FUNCTION append_alert_delivery_pending(uuid, timestamptz) SET search_path = public",
      "alert delivery function integrity mismatch",
    ],
    [
      "function body",
      `CREATE OR REPLACE FUNCTION append_alert_delivery_pending(
         p_alert_event_id uuid, p_occurred_at timestamptz
       )
       RETURNS void LANGUAGE plpgsql SECURITY DEFINER
       SET search_path = pg_catalog, public
       AS $$ BEGIN RETURN; END; $$`,
      "alert delivery function integrity mismatch",
    ],
    [
      "function PUBLIC execute",
      "GRANT EXECUTE ON FUNCTION append_alert_delivery_pending(uuid, timestamptz) TO PUBLIC",
      "alert delivery function integrity mismatch",
    ],
    [
      "recipient function body",
      `CREATE OR REPLACE FUNCTION claim_alert_recipient_delivery(
         p_alert_event_id uuid,
         p_recipient_key text,
         p_occurred_at timestamptz,
         p_lease_expires_at timestamptz,
         p_worker_id text
       )
       RETURNS TABLE(attempt integer, claim_token uuid)
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path = pg_catalog, public
       AS $$ BEGIN RETURN; END; $$`,
      "recipient alert delivery function integrity mismatch",
    ],
    [
      "transition trigger",
      "ALTER TABLE alert_notification_delivery DISABLE TRIGGER trg_alert_notification_delivery_validate_insert",
      "alert delivery transition trigger mismatch",
    ],
    [
      "claim fence index",
      "DROP INDEX idx_alert_notification_delivery_claim_fence",
      "alert delivery/seed index integrity mismatch",
    ],
    [
      "claim fence constraint",
      "ALTER TABLE alert_notification_delivery DROP CONSTRAINT ck_alert_notification_delivery_claim_fence",
      "alert delivery claim-fence constraint mismatch",
    ],
    [
      "recipient constraint",
      "ALTER TABLE alert_notification_delivery DROP CONSTRAINT ck_alert_notification_delivery_recipient",
      "recipient alert delivery constraint integrity mismatch",
    ],
    [
      "recipient attempt-phase index",
      "DROP INDEX uq_alert_notification_delivery_attempt_phase",
      "alert delivery/seed index integrity mismatch",
    ],
    [
      "recipient succeeded index",
      "DROP INDEX uq_alert_notification_delivery_succeeded",
      "alert delivery/seed index integrity mismatch",
    ],
  ])(
    "rejects alert delivery $name drift",
    async (_name, mutationSql, expectedError) => {
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
        expect(result.stderr).toContain(expectedError);
      } finally {
        await owner.end().catch(() => undefined);
        await dropDatabase(database.name);
      }
    },
    30_000,
  );

  test("rejects a forbidden ledger_app column privilege", async () => {
    const database = await createDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await owner.connect();
      await owner.query("GRANT UPDATE (company_id) ON TABLE license_assignment TO ledger_app");

      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("ledger_app runtime column-grant matrix mismatch");
    } finally {
      await owner.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each(["UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "UPDATE (filename)", "REFERENCES (filename)"])(
    "rejects a ledger_app %s privilege on the migration ledger",
    async (privilege) => {
      const database = await createDatabase();
      const owner = new pg.Client({ connectionString: database.ownerUrl });
      try {
        await migrate(database.ownerUrl);
        await owner.connect();
        await owner.query(`GRANT ${privilege} ON TABLE ledger_schema_migrations TO ledger_app`);

        const result = await runNode(verifyPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
          DATABASE_URL: database.appUrl,
        });
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("ledger_app schema/migration privilege mismatch");
      } finally {
        await owner.end().catch(() => undefined);
        await dropDatabase(database.name);
      }
    },
    30_000,
  );

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
      "a legacy null-note overload",
      `
        CREATE FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid)
        RETURNS SETOF public.company_role_assignment
        LANGUAGE sql
        AS $$ SELECT * FROM public.company_role_assignment WHERE false $$
      `,
    ],
    [
      "an unsafe search path",
      "ALTER FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid, text) SET search_path = public",
    ],
    [
      "a rewritten function body",
      `
        CREATE OR REPLACE FUNCTION public.revoke_company_role_assignment(
          p_assignment_id uuid,
          p_company_id uuid,
          p_actor_user_id uuid,
          p_note text
        )
        RETURNS TABLE (id uuid, user_account_id uuid, company_id uuid,
          role company_role_assignment_role_enum, unique_grant text)
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$ BEGIN RETURN; END; $$;
      `,
    ],
    [
      "PUBLIC execute",
      "GRANT EXECUTE ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid, text) TO PUBLIC",
    ],
    [
      "ledger_app execute with grant option",
      "GRANT EXECUTE ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid, text) TO ledger_app WITH GRANT OPTION",
    ],
    [
      "an arbitrary login role execute",
      `GRANT EXECUTE ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid, text) TO "${"postgres"}"`,
    ],
  ])("rejects %s on the role-revocation function", async (_kind, mutationSql) => {
    const database = await createDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    try {
      await migrate(database.ownerUrl);
      await owner.connect();
      const clusterAdminRole = decodeURIComponent(
        new URL(clusterAdminUrl).username,
      );
      await owner.query(
        mutationSql.replaceAll('"postgres"', `"${clusterAdminRole}"`),
      );

      const result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("role-revocation function integrity mismatch");
    } finally {
      await owner.end().catch(() => undefined);
      await dropDatabase(database.name);
    }
  }, 30_000);

  test.each([
    [
      "the btree_gist extension",
      `
        ALTER TABLE license_assignment DROP CONSTRAINT license_assignment_no_overlap;
        ALTER TABLE rate_card DROP CONSTRAINT rate_card_no_overlap;
        DROP EXTENSION btree_gist;
      `,
      "register extension mismatch",
    ],
    [
      "the register exclusion constraint",
      "ALTER TABLE license_assignment DROP CONSTRAINT license_assignment_no_overlap",
      "register exclusion integrity mismatch",
    ],
    [
      "the source-request lookup index",
      "DROP INDEX idx_license_assignment_source_request_id",
      "source-request lookup index integrity mismatch",
    ],
    [
      "source-request lookup index uniqueness",
      `
        DROP INDEX idx_license_assignment_source_request_id;
        CREATE UNIQUE INDEX idx_license_assignment_source_request_id
          ON license_assignment (source_request_id);
      `,
      "source-request lookup index integrity mismatch",
    ],
    [
      "the register exclusion range boundary",
      `
        ALTER TABLE license_assignment DROP CONSTRAINT license_assignment_no_overlap;
        ALTER TABLE license_assignment
          ADD CONSTRAINT license_assignment_no_overlap
          EXCLUDE USING gist (
            person_id WITH =,
            vendor_account_id WITH =,
            license_type_id WITH =,
            daterange(started_on, COALESCE(ended_on + 1, 'infinity'::date), '[]') WITH &&
          );
      `,
      "register exclusion integrity mismatch",
    ],
    [
      "the pending-proposal partial predicate",
      `
        DROP INDEX reclamation_proposal_one_pending_per_assignment;
        CREATE UNIQUE INDEX reclamation_proposal_one_pending_per_assignment
          ON reclamation_proposal (assignment_id)
          WHERE status = 'pending' OR decided_at IS NULL;
      `,
      "reclamation pending-index integrity mismatch",
    ],
    [
      "the pending-proposal partial index key",
      `
        DROP INDEX reclamation_proposal_one_pending_per_assignment;
        CREATE UNIQUE INDEX reclamation_proposal_one_pending_per_assignment
          ON reclamation_proposal (id)
          WHERE status = 'pending';
      `,
      "reclamation pending-index integrity mismatch",
    ],
    [
      "the reallocation successor boundary",
      `
        CREATE OR REPLACE FUNCTION public.license_assignment_reallocation_contiguous()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.end_reason = 'reallocated' AND NEW.ended_on IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1
              FROM public.license_assignment AS successor
              WHERE successor.id <> NEW.id
                AND successor.person_id = NEW.person_id
                AND successor.vendor_account_id = NEW.vendor_account_id
                AND successor.license_type_id = NEW.license_type_id
                AND successor.started_on <= NEW.ended_on
            ) THEN
              RAISE EXCEPTION
                USING ERRCODE = '23514',
                  CONSTRAINT = 'license_assignment_reallocation_contiguous',
                  MESSAGE = 'reallocated license assignments require a contiguous successor';
            END IF;
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
      `,
      "reallocation trigger integrity mismatch",
    ],
    [
      "a removed reallocation person predicate",
      `
        CREATE OR REPLACE FUNCTION public.license_assignment_reallocation_contiguous()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.end_reason = 'reallocated' AND NEW.ended_on IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1
              FROM public.license_assignment AS successor
              WHERE successor.id <> NEW.id
                AND successor.vendor_account_id = NEW.vendor_account_id
                AND successor.license_type_id = NEW.license_type_id
                AND successor.started_on > NEW.started_on
                AND successor.started_on <= NEW.ended_on + 1
            ) THEN
              RAISE EXCEPTION
                USING ERRCODE = '23514',
                  CONSTRAINT = 'license_assignment_reallocation_contiguous',
                  MESSAGE = 'reallocated license assignments require a contiguous successor';
            END IF;
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        ALTER FUNCTION public.license_assignment_reallocation_contiguous()
          SET search_path = pg_catalog, public;
      `,
      "reallocation trigger integrity mismatch",
    ],
    [
      "a dead-code reallocation bypass",
      `
        CREATE OR REPLACE FUNCTION public.license_assignment_reallocation_contiguous()
        RETURNS trigger AS $$
        BEGIN
          IF FALSE THEN
            PERFORM 1
            FROM public.license_assignment AS successor
            WHERE successor.started_on > NEW.started_on
              AND successor.started_on <= NEW.ended_on + 1;
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        ALTER FUNCTION public.license_assignment_reallocation_contiguous()
          SET search_path = pg_catalog, public;
      `,
      "reallocation trigger integrity mismatch",
    ],
    [
      "the reallocation insert event",
      `
        DROP TRIGGER license_assignment_reallocation_contiguous ON public.license_assignment;
        CREATE CONSTRAINT TRIGGER license_assignment_reallocation_contiguous
          AFTER UPDATE OF ended_on, end_reason
          ON public.license_assignment
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW
          EXECUTE FUNCTION public.license_assignment_reallocation_contiguous();
      `,
      "reallocation trigger integrity mismatch",
    ],
    [
      "the reallocation update key columns",
      `
        DROP TRIGGER license_assignment_reallocation_contiguous ON public.license_assignment;
        CREATE CONSTRAINT TRIGGER license_assignment_reallocation_contiguous
          AFTER INSERT OR UPDATE OF started_on, end_reason
          ON public.license_assignment
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW
          EXECUTE FUNCTION public.license_assignment_reallocation_contiguous();
      `,
      "reallocation trigger integrity mismatch",
    ],
    [
      "the fixed system actor identity",
      `
        ALTER TABLE user_account DROP CONSTRAINT uq_user_account_email;
        INSERT INTO user_account (id, email, status, created_at)
        VALUES (
          '00000000-0000-0000-0000-000000000002',
          'system@ledger.invalid',
          'disabled',
          now()
        );
        UPDATE system_setting
          SET updated_by = '00000000-0000-0000-0000-000000000002';
      `,
      "system-default integrity mismatch",
    ],
    [
      "the deferred reallocation trigger",
      "ALTER TABLE license_assignment DISABLE TRIGGER license_assignment_reallocation_contiguous",
      "reallocation trigger integrity mismatch",
    ],
    [
      "the pending-proposal partial index",
      "DROP INDEX reclamation_proposal_one_pending_per_assignment",
      "reclamation pending-index integrity mismatch",
    ],
    [
      "the pending-remove partial index",
      "DROP INDEX uq_provisioning_action_pending_remove_request",
      "pending-remove index integrity mismatch",
    ],
    [
      "the pending-remove partial index key",
      `
        DROP INDEX uq_provisioning_action_pending_remove_request;
        CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
          ON provisioning_action (id)
          WHERE kind = 'remove' AND status = 'pending';
      `,
      "pending-remove index integrity mismatch",
    ],
    [
      "the pending-remove partial index predicate",
      `
        DROP INDEX uq_provisioning_action_pending_remove_request;
        CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
          ON provisioning_action (request_id)
          WHERE kind = 'remove';
      `,
      "pending-remove index integrity mismatch",
    ],
    [
      "the request idempotency column nullability",
      "ALTER TABLE license_request ALTER COLUMN client_request_id DROP NOT NULL",
      "request-idempotency integrity mismatch",
    ],
    [
      "the request idempotency compatibility default",
      "ALTER TABLE license_request ALTER COLUMN client_request_id DROP DEFAULT",
      "request-idempotency integrity mismatch",
    ],
    [
      "the request idempotency key order",
      `
        ALTER TABLE license_request
          DROP CONSTRAINT uq_license_request_requester_client_request;
        ALTER TABLE license_request
          ADD CONSTRAINT uq_license_request_requester_client_request
          UNIQUE (client_request_id, requested_by);
      `,
      "request-idempotency integrity mismatch",
    ],
    [
      "the seeded system defaults",
      "DELETE FROM system_setting WHERE key = 'default_language'",
      "system-default integrity mismatch",
    ],
  ])("rejects drift of %s", async (_kind, mutationSql, expectedMessage) => {
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
      expect(result.stderr).toContain(expectedMessage);
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
      expect(result.stderr).toContain(
        "ledger_app must not be a member of any role",
      );
      await admin.query("REVOKE ledger_owner FROM ledger_app");

      await admin.query(`CREATE ROLE "${bridgeRole}"`);
      await admin.query(`GRANT ledger_owner TO "${bridgeRole}"`);
      await admin.query(`GRANT "${bridgeRole}" TO ledger_app`);
      result = await runNode(verifyPath, {
        DATABASE_ADMIN_URL: database.ownerUrl,
        DATABASE_URL: database.appUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "ledger_app must not be a member of any role",
      );
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

  test.each([
    ["INHERIT FALSE, SET TRUE", "set-enabled"],
    ["INHERIT FALSE, SET FALSE", "set-disabled"],
  ])(
    "rejects every ledger_app membership even with %s",
    async (membershipOptions, label) => {
      const database = await createDatabase();
      databaseSequence += 1;
      const memberRole =
        `ledger_member_${label}_${testRunSuffix}_${databaseSequence}`.replaceAll(
          "-",
          "_",
        );
      const owner = new pg.Client({ connectionString: database.ownerUrl });
      const admin = new pg.Client({ connectionString: clusterAdminUrl });
      try {
        await migrate(database.ownerUrl);
        await Promise.all([owner.connect(), admin.connect()]);
        await admin.query(`CREATE ROLE "${memberRole}" NOLOGIN`);
        await owner.query(`GRANT SELECT ON company TO "${memberRole}"`);
        await admin.query(
          `GRANT "${memberRole}" TO ledger_app WITH ${membershipOptions}`,
        );

        const result = await runNode(verifyPath, {
          DATABASE_ADMIN_URL: database.ownerUrl,
          DATABASE_URL: database.appUrl,
        });
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain(
          "ledger_app must not be a member of any role",
        );
      } finally {
        await admin
          .query(`REVOKE "${memberRole}" FROM ledger_app`)
          .catch(() => undefined);
        await owner
          .query(`REVOKE ALL ON company FROM "${memberRole}"`)
          .catch(() => undefined);
        await Promise.all([
          owner.end().catch(() => undefined),
          admin.end().catch(() => undefined),
        ]);
        const roleAdmin = new pg.Client({ connectionString: clusterAdminUrl });
        await roleAdmin.connect();
        try {
          await roleAdmin.query(`DROP ROLE IF EXISTS "${memberRole}"`);
        } finally {
          await roleAdmin.end();
        }
        await dropDatabase(database.name);
      }
    },
    30_000,
  );

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
    expect(structure.tables).toHaveLength(33);
    expect(structure.foreignKeys).toHaveLength(87);
    expect(
      structure.enums.find(
        ({ enum_name }: { enum_name: string }) =>
          enum_name === "alert_rule_type_enum",
      ),
    ).toEqual({
      enum_name: "alert_rule_type_enum",
      labels: [
        "approval_aging",
        "provisioning_failure",
        "blocked_no_seat",
        "low_pool",
        "invite_unaccepted",
        "sync_stale",
        "credential_failure",
        "register_drift",
        "deprovision_overdue",
        "close_missed",
      ],
    });
    expect(structure.governedCheckConstraints).toEqual([
      {
        constraint_name: "ck_alert_notification_delivery_claim_fence",
        definition:
          "check(phase='pending'andclaim_tokenisnullor(phase=any(array['claimed','succeeded','failed']))andclaim_tokenisnotnull)",
        is_validated: true,
      },
      {
        constraint_name: "ck_alert_notification_delivery_recipient",
        definition:
          "check(btrim(recipient_key)<>''and(phase<>'pending'orrecipient_emailisnullorbtrim(recipient_email)<>''))",
        is_validated: true,
      },
    ]);
    expect(structure.governedUniqueObjects).toEqual([
      {
        index_name: "idx_alert_notification_delivery_claim_fence",
        table_name: "alert_notification_delivery",
        is_unique: false,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 4,
        attribute_count: 4,
        access_method: "btree",
        key_expressions: [
          "alert_event_id",
          "recipient_key",
          "attempt",
          "claim_token",
        ],
        predicate: null,
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name: "uq_alert_event_dedupe_key",
        table_name: "alert_event",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 1,
        attribute_count: 1,
        access_method: "btree",
        key_expressions: ["dedupe_key"],
        predicate: "dedupe_key IS NOT NULL",
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name: "uq_alert_notification_delivery_attempt_phase",
        table_name: "alert_notification_delivery",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 4,
        attribute_count: 4,
        access_method: "btree",
        key_expressions: [
          "alert_event_id",
          "recipient_key",
          "attempt",
          "phase",
        ],
        predicate: null,
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name: "uq_alert_notification_delivery_succeeded",
        table_name: "alert_notification_delivery",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 2,
        attribute_count: 2,
        access_method: "btree",
        key_expressions: ["alert_event_id", "recipient_key"],
        predicate:
          "phase = 'succeeded'::alert_notification_delivery_phase_enum",
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name: "uq_alert_rule_global_type",
        table_name: "alert_rule",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 1,
        attribute_count: 1,
        access_method: "btree",
        key_expressions: ["type"],
        predicate:
          "scope_kind = 'global'::alert_rule_scope_kind_enum",
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name: "uq_license_request_request_no",
        table_name: "license_request",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 1,
        attribute_count: 1,
        access_method: "btree",
        key_expressions: ["request_no"],
        predicate: null,
        constraint_type: "u",
        constraint_deferrable: false,
        constraint_initially_deferred: false,
      },
      {
        index_name: "uq_license_request_requester_client_request",
        table_name: "license_request",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 2,
        attribute_count: 2,
        access_method: "btree",
        key_expressions: ["requested_by", "client_request_id"],
        predicate: null,
        constraint_type: "u",
        constraint_deferrable: false,
        constraint_initially_deferred: false,
      },
      {
        index_name: "uq_person_lower_email",
        table_name: "person",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 1,
        attribute_count: 1,
        access_method: "btree",
        key_expressions: ["lower(email)"],
        predicate: null,
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name:
          "uq_provisioning_action_orchestration_checklist_operation",
        table_name: "provisioning_action",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 2,
        attribute_count: 2,
        access_method: "btree",
        key_expressions: [
          "request_id",
          "(raw_request ->> 'operation'::text)",
        ],
        predicate:
          "kind = 'checklist'::provisioning_action_kind_enum AND mode = 'orchestration'::provisioning_action_mode_enum AND ((raw_request ->> 'operation'::text) = ANY (ARRAY['provision'::text, 'deprovision'::text]))",
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
      {
        index_name: "uq_provisioning_action_pending_remove_request",
        table_name: "provisioning_action",
        is_unique: true,
        is_valid: true,
        is_ready: true,
        is_immediate: true,
        key_count: 1,
        attribute_count: 1,
        access_method: "btree",
        key_expressions: ["request_id"],
        predicate:
          "kind = 'remove'::provisioning_action_kind_enum AND status = 'pending'::provisioning_action_status_enum",
        constraint_type: null,
        constraint_deferrable: null,
        constraint_initially_deferred: null,
      },
    ]);
  }, 120_000);

  test.each([
    {
      name: "enum-label drift",
      driftSql:
        "ALTER TYPE alert_rule_type_enum ADD VALUE 'parity_extra_value'",
    },
    {
      name: "unique-index expression drift",
      driftSql: `
        DROP INDEX uq_person_lower_email;
        CREATE UNIQUE INDEX uq_person_lower_email ON person (email);
      `,
    },
    {
      name: "partial-index predicate drift",
      driftSql: `
        DROP INDEX uq_alert_event_dedupe_key;
        CREATE UNIQUE INDEX uq_alert_event_dedupe_key
          ON alert_event (dedupe_key)
          WHERE true;
      `,
    },
    {
      name: "deferrable request-number constraint drift",
      driftSql: `
        ALTER TABLE license_request
          DROP CONSTRAINT uq_license_request_request_no;
        ALTER TABLE license_request
          ADD CONSTRAINT uq_license_request_request_no
          UNIQUE (request_no)
          DEFERRABLE INITIALLY DEFERRED;
      `,
    },
    {
      name: "request-idempotency key-order drift",
      driftSql: `
        ALTER TABLE license_request
          DROP CONSTRAINT uq_license_request_requester_client_request;
        ALTER TABLE license_request
          ADD CONSTRAINT uq_license_request_requester_client_request
          UNIQUE (client_request_id, requested_by);
      `,
    },
    {
      name: "pending-remove key drift",
      driftSql: `
        DROP INDEX uq_provisioning_action_pending_remove_request;
        CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
          ON provisioning_action (id)
          WHERE kind = 'remove' AND status = 'pending';
      `,
    },
    {
      name: "pending-remove predicate drift",
      driftSql: `
        DROP INDEX uq_provisioning_action_pending_remove_request;
        CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
          ON provisioning_action (request_id)
          WHERE kind = 'remove';
      `,
    },
    {
      name: "missing pending-remove index",
      driftSql:
        "DROP INDEX uq_provisioning_action_pending_remove_request",
    },
  ])("rejects $name", async ({ driftSql }) => {
    const imported = await import(pathToFileURL(parityPath).href);
    await expect(
      imported.checkMigrationParity({
        databaseAdminUrl: ownerAdminUrl,
        applicationUrl: appAdminUrl,
        beforeCompare: async ({ migrationUrl }: { migrationUrl: string }) => {
          const client = new pg.Client({ connectionString: migrationUrl });
          await client.connect();
          try {
            await client.query(driftSql);
          } finally {
            await client.end();
          }
        },
      }),
    ).rejects.toThrow("database schema parity mismatch");
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
          expect(await applicationTableCount(pushUrl)).toBe(33);
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

  // CHG-064: DROP DATABASE ... WITH (FORCE) by the non-superuser owner fails
  // 42501 when autovacuum is working on the freshly migrated database, which
  // full-gate load makes likely. Hold a slow autovacuum worker there through
  // cleanup and require both disposable databases to be dropped anyway.
  test("drops both disposable databases while autovacuum works on one", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const clusterAdmin = new pg.Client({ connectionString: clusterAdminUrl });
    await clusterAdmin.connect();
    let migrationDatabase = "";
    let pushDatabase = "";
    try {
      await clusterAdmin.query("ALTER SYSTEM SET autovacuum_naptime = '1s'");
      await clusterAdmin.query("SELECT pg_reload_conf()");

      const outcome = await imported.checkMigrationParity({
        databaseAdminUrl: ownerAdminUrl,
        applicationUrl: appAdminUrl,
        beforeCompare: async ({ migrationUrl, pushUrl }: { migrationUrl: string; pushUrl: string }) => {
          migrationDatabase = new URL(migrationUrl).pathname.slice(1);
          pushDatabase = new URL(pushUrl).pathname.slice(1);
          const owner = new pg.Client({ connectionString: migrationUrl });
          await owner.connect();
          try {
            await owner.query(`CREATE TABLE autovacuum_hold (id int, pad text) WITH (
              autovacuum_vacuum_threshold = 0, autovacuum_vacuum_scale_factor = 0,
              autovacuum_analyze_threshold = 0, autovacuum_analyze_scale_factor = 0,
              autovacuum_vacuum_cost_delay = 100, autovacuum_vacuum_cost_limit = 1)`);
            await owner.query(
              "INSERT INTO autovacuum_hold SELECT g, repeat('x', 200) FROM generate_series(1, 300000) g",
            );
            await owner.query("DELETE FROM autovacuum_hold WHERE id % 2 = 0");
          } finally {
            await owner.end();
          }
          for (;;) {
            const workers = await clusterAdmin.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM pg_stat_activity
               WHERE datname = $1 AND backend_type = 'autovacuum worker'`,
              [migrationDatabase],
            );
            if (workers.rows[0].count > 0) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        },
      }).then(
        () => null,
        (error: unknown) => error,
      );

      // The held table is extra structure, so parity itself must still fail —
      // alone, not alongside a cleanup failure.
      expect(outcome).not.toBeInstanceOf(AggregateError);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain("database schema parity mismatch");
      const remaining = await clusterAdmin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
        [[migrationDatabase, pushDatabase]],
      );
      expect(remaining.rows).toEqual([]);
    } finally {
      await clusterAdmin.query("ALTER SYSTEM RESET autovacuum_naptime");
      await clusterAdmin.query("SELECT pg_reload_conf()");
      await clusterAdmin.end();
      for (const databaseName of [migrationDatabase, pushDatabase]) {
        if (databaseName) await dropDatabaseAsClusterAdmin(databaseName);
      }
    }
  }, 180_000);

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
  test("CHG-105 releases exact Git objects through production owner app and parity", async () => {
    const fixture = await createOwnedReleaseFixture("valid");
    const extracted: string[] = [];
    const receipts: unknown[] = [];
    try {
      const baseline = await extractOwnedRelease(fixture, fixture.parent); extracted.push(baseline.bundle);
      const candidate = await extractOwnedRelease(fixture, fixture.head); extracted.push(candidate.bundle);
      for (const input of baseline.inputs) {
        expect((await releaseGit(repositoryRoot, ["rev-parse", `${releaseSource}:packages/db/${input.path}`])).toString().trim(), input.path).toBe(input.blob);
        if (!["src/schema.ts", "schema-contract.json"].includes(input.path)) {
          expect(candidate.inputs.find(entry => entry.path === input.path)?.blob, input.path).toBe(input.blob);
        }
      }
      expect(candidate.inputs.length).toBe(baseline.inputs.length + 1);
      const baseDeclaration = JSON.parse(await readFile(join(baseline.bundle, "schema-contract.json"), "utf8"));
      for (const [label, release] of [["baseline", baseline], ["candidate", candidate]] as const) {
        const database = await createDatabase();
        const environment = { DATABASE_ADMIN_URL: database.ownerUrl, DATABASE_URL: database.appUrl };
        const owner = new pg.Client({ connectionString: database.ownerUrl });
        try {
          await assertReleaseInputs(release.bundle, release.inputs);
          const applied = await runNode(join(release.bundle, "scripts/apply-migrations.mjs"), environment);
          expect(applied.code, applied.stderr).toBe(0);
          const verified = await runNode(join(release.bundle, "scripts/verify-schema.mjs"), environment);
          expect(verified.code, verified.stderr).toBe(0);
          expect(await applicationTableCount(database.ownerUrl)).toBe(baseDeclaration.coreTableNames.length + Number(label === "candidate"));
          await owner.connect();
          const ledger = await owner.query("SELECT filename,sha256 FROM ledger_schema_migrations ORDER BY filename");
          expect(ledger.rows).toEqual(release.inputs.filter(input => /^src\/migrations\/V.*\.sql$/u.test(input.path)).map(input => ({ filename: input.path.slice("src/migrations/".length), sha256: input.sha256 })));
          const parity = await runNode(join(release.bundle, "scripts/check-migration-parity.mjs"), environment);
          expect(parity.code, parity.stderr).toBe(0);
          expect(parity.stdout).toContain(`${baseDeclaration.coreTableNames.length + Number(label === "candidate")} table(s)`);
          if (label === "candidate") {
            const declaration = await readFile(join(release.bundle, "schema-contract.json"), "utf8");
            const binding = JSON.parse(verified.stdout.trim().split("\n").at(-1)!);
            expect(binding.declarationSha256).toBe(sha256(declaration));
            expect(binding.baselineProjectionSha256).toBe("0b755c2c2b71cf8065093608ae01c9353232da7eb196ea9da78f5445e59b6e7b");
            expect(binding.extensionRowsSha256).toBe(sha256(JSON.stringify([extension])));
            expect(binding.migrationSetSha256).toBe(sha256(JSON.stringify(ledger.rows)));
            expect(binding.tableNames).toEqual(["drift_episode"]);
            expect(binding.catalogResultSha256).toBe(sha256(JSON.stringify([{ tableName: "drift_episode", rls: extension.rls, policies: extension.policies, constraints: extension.constraints }])));
            const app = new pg.Client({ connectionString: database.appUrl }); await app.connect();
            try {
              // Existing account-reference policies accept a real account, reject
              // missing/null accounts, and do not grant DELETE/TRUNCATE. They are
              // not a claim of company:write or GroupAdmin authorization.
              const account = "10000000-0000-4000-8000-000000000001";
              await owner.query("INSERT INTO user_account(id,email,status,created_at) VALUES ($1,'release@example.test','active','2026-01-01')", [account]);
              await owner.query("INSERT INTO drift_episode(id,member_identity) VALUES ('20000000-0000-4000-8000-000000000003','owner-only-null-account')");
              await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES ($1,'release','manual','none',false,false,false,false,'email','active','2026-01-01',$1)`, [account]);
              await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES ($1,$1,'release','orchestration',0,'active','2026-01-01',$1)`, [account]);
              const inserted = await app.query("INSERT INTO drift_episode(id,vendor_account_id,member_identity) VALUES ('20000000-0000-4000-8000-000000000001',$1,'member-a') RETURNING member_identity", [account]);
              expect(inserted.rows).toEqual([{ member_identity: "member-a" }]);
              expect((await app.query("SELECT member_identity FROM drift_episode ORDER BY member_identity")).rows).toEqual(inserted.rows);
              expect((await app.query("UPDATE drift_episode SET member_identity='member-b' RETURNING member_identity")).rows).toEqual([{ member_identity: "member-b" }]);
              await expect(app.query("INSERT INTO drift_episode(id,vendor_account_id,member_identity) VALUES ('20000000-0000-4000-8000-000000000002',NULL,'denied')")).rejects.toMatchObject({ code: "42501" });
              await expect(app.query("INSERT INTO drift_episode(id,vendor_account_id,member_identity) VALUES ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000099','missing-account')")).rejects.toMatchObject({ code: "42501" });
              await expect(app.query("UPDATE drift_episode SET vendor_account_id=NULL")).rejects.toMatchObject({ code: "42501" });
              await expect(app.query("DELETE FROM drift_episode")).rejects.toMatchObject({ code: "42501" });
              await expect(app.query("TRUNCATE drift_episode")).rejects.toMatchObject({ code: "42501" });
            } finally { await app.end(); }
            const faults = [
              ["RLS", "ALTER TABLE drift_episode DISABLE ROW LEVEL SECURITY", "rls"],
              ["grant", "GRANT DELETE ON drift_episode TO ledger_app", "runtime table-grant matrix mismatch"],
              ["constraint", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey", "constraints"],
              ["ledger", "DELETE FROM ledger_schema_migrations WHERE filename='V20990101000000__owned_drift_episode.sql'", "committed migration ledger mismatch"],
              ["checksum", "UPDATE ledger_schema_migrations SET sha256=repeat('0',64) WHERE filename='V20990101000000__owned_drift_episode.sql'", "committed migration ledger mismatch"],
            ];
            for (const [name, sql, diagnostic] of faults) {
              await owner.query(sql); const rejected = await runNode(join(release.bundle, "scripts/verify-schema.mjs"), environment);
              expect(rejected.code, name + rejected.stderr).toBe(1); expect(rejected.stderr, name).toContain(diagnostic); expect(rejected.stdout, name).toBe("");
              receipts.push({ fault: name, result: rejected });
              await owner.query("DROP TABLE drift_episode"); await owner.query(ownedReleaseSql);
              await owner.query("DELETE FROM ledger_schema_migrations WHERE filename='V20990101000000__owned_drift_episode.sql'");
              await owner.query("INSERT INTO ledger_schema_migrations(filename,sha256) VALUES ($1,$2)", ["V20990101000000__owned_drift_episode.sql", release.inputs.find(input => input.path === ownedReleaseMigration)!.sha256]);
            }
          }
          receipts.push({ label, database: database.name, inputs: release.inputs, applied, verified, ledger: ledger.rows, parity });
        } finally { await owner.end(); await dropDatabase(database.name); }
      }
      // An extracted byte fault must be caught before any production process.
      for (const path of ["src/schema.ts", "schema-contract.json", ownedReleaseMigration]) {
        const original = await readFile(join(candidate.bundle, path));
        await writeFile(join(candidate.bundle, path), Buffer.concat([original, Buffer.from("\n")]));
        await expect(assertReleaseInputs(candidate.bundle, candidate.inputs)).rejects.toThrow(`Extracted Git object binding mismatch: ${path}`);
        await writeFile(join(candidate.bundle, path), original);
      }
      for (const variant of ["wrong-table", "no-table"] as const) {
        const hostile = await createOwnedReleaseFixture(variant);
        try {
          const release = await extractOwnedRelease(hostile, hostile.head); extracted.push(release.bundle);
          const database = await createDatabase();
          const environment = { DATABASE_ADMIN_URL: database.ownerUrl, DATABASE_URL: database.appUrl };
          try {
            const applied = await runNode(join(release.bundle, "scripts/apply-migrations.mjs"), environment); expect(applied.code, applied.stderr).toBe(0);
            const rejected = await runNode(join(release.bundle, "scripts/verify-schema.mjs"), environment); expect(rejected.code).toBe(1); expect(rejected.stderr).toContain("table-set"); expect(rejected.stdout).toBe("");
            receipts.push({ variant, head: hostile.head, inputs: release.inputs, applied, rejected });
          } finally { await dropDatabase(database.name); }
        } finally { await rm(hostile.root, { recursive: true, force: true }); }
      }
      if (process.env.CHG105_EVIDENCE_DIR) {
        await mkdir(process.env.CHG105_EVIDENCE_DIR, { recursive: true });
        await writeFile(join(process.env.CHG105_EVIDENCE_DIR, "owned-release.json"), JSON.stringify({ reviewedSource: releaseSource, fixture: { parent: fixture.parent, head: fixture.head }, receipts }, null, 2) + "\n");
      }
    } finally {
      for (const bundle of extracted) await rm(bundle, { recursive: true, force: true });
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 180_000);

  test("CHG-104 production finite catalog binds real declarations migrations and rejects independent catalog drift", async () => {
    const database = await createDatabase();
    const bundle = await createVerifierBundle();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    const declarationPath = join(bundle, "schema-contract.json");
    const currentPath = join(bundle, "scripts/verify-schema.mjs");
    const environment = { DATABASE_ADMIN_URL: database.ownerUrl, DATABASE_URL: database.appUrl };
    const predicateSql = "EXISTS (SELECT 1 FROM public.vendor_account WHERE vendor_account.id = drift_episode.vendor_account_id)";
    const ddl = `
      CREATE TABLE drift_episode (
        id uuid PRIMARY KEY,
        vendor_account_id uuid REFERENCES vendor_account(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
        license_type_id uuid REFERENCES license_type(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
        person_id uuid REFERENCES person(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
        resolved_by_assignment_id uuid UNIQUE REFERENCES license_assignment(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
        member_identity text NOT NULL,
        resolved_at timestamptz
      );
      CREATE UNIQUE INDEX drift_episode_open ON drift_episode(vendor_account_id,member_identity,license_type_id) WHERE resolved_at IS NULL;
      ALTER TABLE drift_episode ENABLE ROW LEVEL SECURITY;
      CREATE POLICY drift_episode_select ON drift_episode FOR SELECT TO ledger_app USING (${predicateSql});
      CREATE POLICY drift_episode_insert ON drift_episode FOR INSERT TO ledger_app WITH CHECK (${predicateSql});
      CREATE POLICY drift_episode_update ON drift_episode FOR UPDATE TO ledger_app USING (${predicateSql}) WITH CHECK (${predicateSql});
      GRANT SELECT,INSERT,UPDATE ON drift_episode TO ledger_app;
    `;
    try {
      await owner.connect();
      await migrate(database.ownerUrl);
      const original = await readFile(declarationPath, "utf8");
      const raw = { ...JSON.parse(original), schema_version: 2, newTables: [extension] };
      const declaration = JSON.stringify(raw, null, 2) + "\n";
      await writeFile(declarationPath, declaration);
      await owner.query(ddl);
      const success = await runNode(currentPath, environment);
      expect(success.code, success.stderr).toBe(0);
      expect(success.stdout.trim().split("\n").at(-1), "production v2 must emit actual catalog binding").toMatch(/^\{/u);
      const binding = JSON.parse(success.stdout.trim().split("\n").at(-1)!);
      expect(Object.keys(binding)).toEqual(["declarationSha256", "baselineProjectionSha256", "extensionRowsSha256", "migrationSetSha256", "catalogResultSha256", "tableNames"]);
      expect(binding.declarationSha256).toBe(sha256(declaration));
      expect(binding.baselineProjectionSha256).toBe("0b755c2c2b71cf8065093608ae01c9353232da7eb196ea9da78f5445e59b6e7b");
      expect(binding.extensionRowsSha256).toBe(sha256(JSON.stringify([extension])));
      expect(binding.tableNames).toEqual(["drift_episode"]);
      const migrations = await owner.query("SELECT filename,sha256 FROM ledger_schema_migrations ORDER BY filename");
      expect(binding.migrationSetSha256).toBe(sha256(JSON.stringify(migrations.rows)));
      await writeFile(join(bundle, "scripts/inspect.mjs"), 'import { verifyMigratedSchema } from "./verify-schema.mjs"; process.stdout.write(JSON.stringify(await verifyMigratedSchema()));');
      const inspected = await runNode(join(bundle, "scripts/inspect.mjs"), environment);
      expect(inspected.code, inspected.stderr).toBe(0);
      const result = JSON.parse(inspected.stdout);
      expect(result.schemaExtension).toEqual(binding);
      expect(result.applicationIntegrity.tableGrants.filter((row: {tableName: string}) => row.tableName === "drift_episode")).toEqual([
        { tableName: "drift_episode", privilege: "INSERT" }, { tableName: "drift_episode", privilege: "SELECT" }, { tableName: "drift_episode", privilege: "UPDATE" },
      ]);
      // An independently assembled normalized catalog oracle, not a candidate PASS field.
      const expectedCatalog = [{ tableName: "drift_episode", rls: { enabled: true, forced: false }, policies: extension.policies, constraints: extension.constraints }];
      expect(binding.catalogResultSha256).toBe(sha256(JSON.stringify(expectedCatalog)));
      if (process.env.CHG104_EVIDENCE_DIR) {
        const directory = process.env.CHG104_EVIDENCE_DIR;
        await mkdir(directory, { recursive: true });
        const policies = await owner.query("SELECT policyname,cmd,roles::text[],qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='drift_episode' ORDER BY policyname");
        const constraints = await owner.query("SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.drift_episode'::regclass ORDER BY conname");
        const indexes = await owner.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='drift_episode' ORDER BY indexname");
        await writeFile(join(directory, "actual-v2-production.json"), JSON.stringify({ declaration, cli: success, result, independentExpectedCatalog: expectedCatalog, actualCatalog: { policies: policies.rows, constraints: constraints.rows, indexes: indexes.rows }, appliedMigrations: migrations.rows }, null, 2) + "\n");
      }
      // Rename a valid declared catalog identity: all three bound actual inputs
      // change together; unrelated baseline/migration identities remain stable.
      await owner.query("ALTER POLICY drift_episode_select ON drift_episode RENAME TO drift_episode_read");
      const renamed = structuredClone(raw); renamed.newTables[0].policies[0].name = "drift_episode_read";
      await writeFile(declarationPath, JSON.stringify(renamed, null, 2) + "\n");
      const changed = await runNode(currentPath, environment);
      expect(changed.code, changed.stderr).toBe(0);
      const renamedBinding = JSON.parse(changed.stdout.trim().split("\n").at(-1)!);
      for (const key of ["declarationSha256", "extensionRowsSha256", "catalogResultSha256"]) expect(renamedBinding[key]).not.toBe(binding[key]);
      for (const key of ["baselineProjectionSha256", "migrationSetSha256"]) expect(renamedBinding[key]).toBe(binding[key]);
      await owner.query("ALTER POLICY drift_episode_read ON drift_episode RENAME TO drift_episode_select");
      await writeFile(declarationPath, declaration);
      // Legal identifiers whose codepoint and locale collation orders differ.
      // Catalog comparison must be independent of PostgreSQL/JS locale order.
      await owner.query(`ALTER POLICY drift_episode_select ON drift_episode RENAME TO a1;
        ALTER POLICY drift_episode_insert ON drift_episode RENAME TO a_1;
        ALTER TABLE drift_episode RENAME CONSTRAINT drift_episode_pkey TO c1;
        ALTER TABLE drift_episode RENAME CONSTRAINT drift_episode_resolved_by_assignment_id_key TO c_1;
        ALTER TABLE drift_episode RENAME CONSTRAINT drift_episode_vendor_account_id_fkey TO b1;
        ALTER TABLE drift_episode RENAME CONSTRAINT drift_episode_license_type_id_fkey TO b_1`);
      const legalNames = structuredClone(raw);
      legalNames.newTables[0].policies[0].name = "a1";
      legalNames.newTables[0].policies[1].name = "a_1";
      legalNames.newTables[0].constraints[0].name = "c1";
      legalNames.newTables[0].constraints[1].name = "b1";
      legalNames.newTables[0].constraints[2].name = "b_1";
      legalNames.newTables[0].constraints[5].name = "c_1";
      await writeFile(declarationPath, JSON.stringify(legalNames, null, 2) + "\n");
      const legalPair = await runNode(currentPath, environment);
      expect(legalPair.code, "legal catalog names must not depend on collation: " + legalPair.stderr).toBe(0);
      expect(JSON.parse(legalPair.stdout.trim().split("\n").at(-1)!).tableNames).toEqual(["drift_episode"]);
      await owner.query("DROP TABLE drift_episode"); await owner.query(ddl);
      await writeFile(declarationPath, declaration);
      const faults = [
        ["force", "ALTER TABLE drift_episode FORCE ROW LEVEL SECURITY", "rls"],
        ["disabled", "ALTER TABLE drift_episode DISABLE ROW LEVEL SECURITY", "rls"],
        ["missing policy", "DROP POLICY drift_episode_insert ON drift_episode", "policies"],
        ["role", "ALTER POLICY drift_episode_select ON drift_episode TO PUBLIC", "policies"],
        ["using", "ALTER POLICY drift_episode_select ON drift_episode USING (true)", "policies"],
        ["with check", "ALTER POLICY drift_episode_insert ON drift_episode WITH CHECK (true)", "policies"],
        ["restrictive", `DROP POLICY drift_episode_select ON drift_episode; CREATE POLICY drift_episode_select ON drift_episode AS RESTRICTIVE FOR SELECT TO ledger_app USING (${predicateSql})`, "policies"],
        ["command", `DROP POLICY drift_episode_select ON drift_episode; CREATE POLICY drift_episode_select ON drift_episode FOR ALL TO ledger_app USING (${predicateSql}) WITH CHECK (${predicateSql})`, "policies"],
        ["extra policy", "CREATE POLICY extra ON drift_episode TO ledger_app USING (true)", "policies"],
        ["missing FK", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey", "constraints"],
        ["FK action", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey; ALTER TABLE drift_episode ADD CONSTRAINT drift_episode_person_id_fkey FOREIGN KEY(person_id) REFERENCES person(id) ON DELETE CASCADE", "constraints"],
        ["FK update action", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey; ALTER TABLE drift_episode ADD CONSTRAINT drift_episode_person_id_fkey FOREIGN KEY(person_id) REFERENCES person(id) ON UPDATE CASCADE", "constraints"],
        ["missing PK", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_pkey", "constraints"],
        ["missing unique", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_resolved_by_assignment_id_key", "constraints"],
        ["FK target", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey; ALTER TABLE drift_episode ADD CONSTRAINT drift_episode_person_id_fkey FOREIGN KEY(person_id) REFERENCES company(id)", "constraints"],
        ["unvalidated", "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey; ALTER TABLE drift_episode ADD CONSTRAINT drift_episode_person_id_fkey FOREIGN KEY(person_id) REFERENCES person(id) NOT VALID", "constraints"],
        ["deferrable", "ALTER TABLE drift_episode ALTER CONSTRAINT drift_episode_person_id_fkey DEFERRABLE INITIALLY DEFERRED", "constraints"],
        ["extra constraint", "ALTER TABLE drift_episode ADD CONSTRAINT extra CHECK(member_identity <> '')", "constraints"],
        ["missing open", "DROP INDEX drift_episode_open", "indexes"],
        ["wrong open", "DROP INDEX drift_episode_open; CREATE UNIQUE INDEX drift_episode_open ON drift_episode(vendor_account_id,member_identity,license_type_id) WHERE resolved_at IS NOT NULL", "indexes"],
        ["nonunique open", "DROP INDEX drift_episode_open; CREATE INDEX drift_episode_open ON drift_episode(vendor_account_id,member_identity,license_type_id) WHERE resolved_at IS NULL", "indexes"],
        ["wrong columns", "DROP INDEX drift_episode_open; CREATE UNIQUE INDEX drift_episode_open ON drift_episode(member_identity,vendor_account_id,license_type_id) WHERE resolved_at IS NULL", "indexes"],
        ["extra index", "CREATE INDEX extra ON drift_episode(member_identity)", "indexes"],
        ["nullable", "ALTER TABLE drift_episode ALTER COLUMN resolved_at SET NOT NULL", "nullable"],
        ["rights", "GRANT DELETE ON drift_episode TO ledger_app", "runtime table-grant matrix mismatch"],
        ["old rights", "GRANT DELETE ON company TO ledger_app", "runtime table-grant matrix mismatch"],
        ["checksum", "UPDATE ledger_schema_migrations SET sha256=repeat('0',64) WHERE filename=(SELECT min(filename) FROM ledger_schema_migrations)", "committed migration ledger mismatch"],
        ["extra table", "CREATE TABLE unlisted(id uuid)", "table-set"],
      ];
      for (const [label, sql, diagnostic] of faults) {
        // Committed changes must be visible to the real production process.
        const restore = await owner.query("SELECT filename,sha256 FROM ledger_schema_migrations ORDER BY filename");
        await owner.query(sql);
        const rejected = await runNode(currentPath, environment);
        expect(rejected.code, label + rejected.stderr).toBe(1);
        expect(rejected.stderr, label).toContain(diagnostic);
        expect(rejected.stdout, label).toBe("");
        await owner.query("DROP TABLE drift_episode; DROP TABLE IF EXISTS unlisted; REVOKE DELETE ON company FROM ledger_app");
        for (const row of restore.rows) await owner.query("UPDATE ledger_schema_migrations SET sha256=$2 WHERE filename=$1", [row.filename,row.sha256]);
        await owner.query(ddl);
      }
      // Fault controls execute changed real source in this technical bundle.
      // Each must fail the SAME code/category oracle used by hostile catalogs.
      const catalogPath = join(bundle, "scripts/schema-catalog-verifier.mjs");
      const catalogSource = await readFile(catalogPath, "utf8");
      const verifierSource = await readFile(currentPath, "utf8");
      const guardFaults = [
        ["omitted runtime call", currentPath, verifierSource.replace("catalogResult = await verifySchemaExtensionCatalog({ owner, newTables: declaration.newTables, baselineTableNames: declaration.coreTableNames });", "catalogResult = [];"), "ALTER TABLE drift_episode FORCE ROW LEVEL SECURITY", "rls"],
        ["table-set guard", catalogPath, catalogSource.replace('if (!same(tables.rows.map', 'if (false && !same(tables.rows.map'), "CREATE TABLE unlisted(id uuid)", "table-set"],
        ["rls guard", catalogPath, catalogSource.replace('if (relation.rows.length !== 1 ||', 'if (false && (relation.rows.length !== 1 ||').replace('table.rls)) mismatch("rls"', 'table.rls))) mismatch("rls"'), "ALTER TABLE drift_episode FORCE ROW LEVEL SECURITY", "rls"],
        ["policy guard", catalogPath, catalogSource.replace('if (!same(sorted(actualPolicies), expectedPolicies))', 'if (false && !same(sorted(actualPolicies), expectedPolicies))'), "ALTER POLICY drift_episode_select ON drift_episode USING (true)", "policies"],
        ["constraint guard", catalogPath, catalogSource.replace('if (!same(sorted(constraints.rows), expectedConstraints))', 'if (false && !same(sorted(constraints.rows), expectedConstraints))'), "ALTER TABLE drift_episode DROP CONSTRAINT drift_episode_person_id_fkey; ALTER TABLE drift_episode ADD CONSTRAINT drift_episode_person_id_fkey FOREIGN KEY(person_id) REFERENCES person(id) ON DELETE CASCADE", "constraints"],
        ["index guard", catalogPath, catalogSource.replace('if (!same(sorted(indexes.rows), expectedIndexes))', 'if (false && !same(sorted(indexes.rows), expectedIndexes))'), "DROP INDEX drift_episode_open; CREATE UNIQUE INDEX drift_episode_open ON drift_episode(vendor_account_id,member_identity,license_type_id) WHERE resolved_at IS NOT NULL", "indexes"],
        ["nullability guard", catalogPath, catalogSource.replace('if (nullable.rows.length !== 1 || nullable.rows[0].required !== false)', 'if (false)'), "ALTER TABLE drift_episode ALTER COLUMN resolved_at SET NOT NULL", "nullable"],
      ];
      for (const [label, path, faultySource, sql, diagnostic] of guardFaults) {
        expect(faultySource, label).not.toBe(path === currentPath ? verifierSource : catalogSource);
        await writeFile(path, faultySource);
        try {
          await owner.query(sql);
          const observed = await runNode(currentPath, environment);
          // Prove execution reaches the intended oracle, not a setup error.
          // The table-set control also retains a downstream independent refusal;
          // it must still fail the stronger early diagnostic contract.
          if (label === "table-set guard") {
            expect(observed.code, label + observed.stderr).toBe(1);
            expect(observed.stderr).toContain("runtime column-grant matrix mismatch");
          } else expect(observed.code, label + observed.stderr).toBe(0);
          expect(() => {
            expect(observed.code, label).toBe(1);
            expect(observed.stderr, label).toContain(diagnostic);
          }, label).toThrow(/expected .* (?:to be|to contain)/u);
        } finally {
          await writeFile(path, path === currentPath ? verifierSource : catalogSource);
          await owner.query("DROP TABLE drift_episode; DROP TABLE IF EXISTS unlisted"); await owner.query(ddl);
        }
      }

      // Actual missing-table SQL must reject at the owner-phase catalog boundary.
      await owner.query("DROP TABLE drift_episode");
      const missing = await runNode(currentPath, environment);
      expect(missing.code).toBe(1); expect(missing.stderr).toContain("table-set");
      await writeFile(declarationPath, JSON.stringify({ ...raw, newTables: [] }, null, 2) + "\n");
      const empty = await runNode(currentPath, environment);
      expect(empty.code, empty.stderr).toBe(0);
      expect(JSON.parse(empty.stdout.trim().split("\n").at(-1)!).tableNames).toEqual([]);
    } finally {
      await owner.end(); await rm(bundle, { recursive: true, force: true }); await dropDatabase(database.name);
    }
  }, 150_000);

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
