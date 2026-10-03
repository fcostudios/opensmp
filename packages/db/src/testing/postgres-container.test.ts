import pg from "pg";
import { inspect } from "node:util";
import { expect, test } from "vitest";
import {
  createPostgresFixture,
  selectMutationDatabasePair,
} from "./postgres-container";

const mutationDatabaseKey = /^US\d+_MUTATION_DATABASE_(?:ADMIN_)?URL$/;

function isolateMutationDatabaseEnvironment(): () => void {
  const originalEntries = Object.entries(process.env).filter(([key]) =>
    mutationDatabaseKey.test(key),
  );

  for (const key of Object.keys(process.env)) {
    if (mutationDatabaseKey.test(key)) delete process.env[key];
  }

  return () => {
    for (const key of Object.keys(process.env)) {
      if (mutationDatabaseKey.test(key)) delete process.env[key];
    }
    Object.assign(process.env, Object.fromEntries(originalEntries));
  };
}

test("returns null when no story-scoped mutation URLs exist", () => {
  expect(
    selectMutationDatabasePair({
      DATABASE_URL: "postgres://app:secret@database.internal/ledger",
    }),
  ).toBeNull();
});

test.each(["US017", "US065"])("selects the complete %s mutation database pair", (prefix) => {
  expect(
    selectMutationDatabasePair({
      [`${prefix}_MUTATION_DATABASE_URL`]: "postgres://app:secret@database.internal/ledger",
      [`${prefix}_MUTATION_DATABASE_ADMIN_URL`]:
        "postgres://owner:secret@database.internal/ledger",
    }),
  ).toEqual({
    prefix,
    appUrl: "postgres://app:secret@database.internal/ledger",
    ownerUrl: "postgres://owner:secret@database.internal/ledger",
  });
});

// Break caught: URL parse/driver errors retain credential-bearing input or a
// bad app URL reaches a network connection before the complete pair is valid.
test.each([
  ["owner", "postgres://owner:credential-marker@[invalid/ledger"],
  ["app", "postgres://app:credential-marker@[invalid/ledger"],
  ["owner", "https://owner:credential-marker@127.0.0.1:1/ledger"],
  ["app", "postgres://app:credential-marker%ZZ@127.0.0.1/ledger"],
  ["owner", "postgres://owner:credential-marker@127.0.0.1/invalid-name"],
])("rejects invalid %s URL before connecting with a secret-free error (%s)", async (kind, invalidUrl) => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  try {
    process.env.US065_MUTATION_DATABASE_URL = "postgres://app:secret@127.0.0.1:1/ledger";
    process.env.US065_MUTATION_DATABASE_ADMIN_URL = "postgres://owner:secret@127.0.0.1:1/ledger";
    process.env[`US065_MUTATION_DATABASE_${kind === "owner" ? "ADMIN_" : ""}URL`] = invalidUrl;
    const error = await createPostgresFixture().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(inspect(error, { showHidden: true, depth: null })).not.toContain("credential-marker");
    expect(JSON.stringify(error)).not.toContain("credential-marker");
    expect(error).toMatchObject({ message: expect.stringMatching(/^US065 mutation .*invalid/) });
    expect(Reflect.ownKeys(error as Error).sort()).toEqual(["message", "stack"]);
  } finally {
    restoreEnvironment();
  }
});

// Break caught: malformed app input allocates an orphan, or a failure after
// allocation returns no handle without compensating the real CREATE DATABASE.
test.each(["malformed app", "post-allocation failure"])(
  "leaves no clone after %s on a real PostgreSQL template",
  async (failureMode) => {
    const restoreEnvironment = isolateMutationDatabaseEnvironment();
    let template: Awaited<ReturnType<typeof createPostgresFixture>> | undefined;
    let unexpectedFixture: Awaited<ReturnType<typeof createPostgresFixture>> | undefined;
    let maintenance: pg.Client | undefined;
    try {
      template = await createPostgresFixture();
      const maintenanceUrl = new URL(template.ownerUrl);
      maintenanceUrl.pathname = "/postgres";
      maintenance = new pg.Client({ connectionString: maintenanceUrl.toString() });
      await maintenance.connect();
      const clones = () => maintenance!.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'ledger_mutation_%' ORDER BY datname",
      );
      expect((await clones()).rows).toEqual([]);
      process.env.US065_MUTATION_DATABASE_URL = failureMode === "malformed app"
        ? "postgres://app:credential-marker@[invalid/ledger"
        : template.appUrl;
      process.env.US065_MUTATION_DATABASE_ADMIN_URL = template.ownerUrl;
      let error: unknown;
      try {
        unexpectedFixture = await createPostgresFixture(failureMode === "post-allocation failure"
          ? { afterBootstrapSql: `DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_database WHERE datname LIKE 'ledger_mutation_%') THEN
                RAISE EXCEPTION 'clone allocated' USING ERRCODE = 'P0065';
              END IF;
            END $$` }
          : {});
      } catch (failure) {
        error = failure;
      }
      // Assert before error shape so RED directly identifies an orphaned clone.
      expect((await clones()).rows).toEqual([]);
      if (failureMode === "malformed app") {
        expect(error).toMatchObject({ message: expect.stringMatching(/^US065 mutation .*invalid/) });
        expect(inspect(error, { showHidden: true, depth: null })).not.toContain("credential-marker");
        expect(JSON.stringify(error)).not.toContain("credential-marker");
      } else {
        expect(error).toMatchObject({ code: "P0065" });
      }
    } finally {
      await unexpectedFixture?.stop();
      if (maintenance) {
        const remaining = await maintenance.query<{ datname: string }>(
          "SELECT datname FROM pg_database WHERE datname LIKE 'ledger_mutation_%'",
        );
        for (const { datname } of remaining.rows) {
          await maintenance.query(`DROP DATABASE "${datname.replaceAll('"', '""')}" WITH (FORCE)`);
        }
      }
      await maintenance?.end();
      restoreEnvironment();
      // The disposable cluster owns even an orphan created by the RED version.
      await template?.stop();
    }
  },
  150_000,
);

test("selects the complete US-066 mutation database pair", () => {
  expect(
    selectMutationDatabasePair({
      US066_MUTATION_DATABASE_URL: "postgres://app:secret@database.internal/ledger",
      US066_MUTATION_DATABASE_ADMIN_URL:
        "postgres://owner:secret@database.internal/ledger",
    }),
  ).toEqual({
    prefix: "US066",
    appUrl: "postgres://app:secret@database.internal/ledger",
    ownerUrl: "postgres://owner:secret@database.internal/ledger",
  });
});

test.each([
  ["app", { US065_MUTATION_DATABASE_URL: "postgres://app:secret@database.internal/ledger" }],
  ["owner", { US065_MUTATION_DATABASE_ADMIN_URL: "postgres://owner:secret@database.internal/ledger" }],
])("rejects an incomplete US-065 mutation pair with only its safe prefix (%s URL)", (_kind, environment) => {
  expect(() => selectMutationDatabasePair(environment)).toThrow(
    "US065 mutation harness requires both database URLs",
  );
});

test("rejects ambiguous complete story-scoped mutation pairs", () => {
  expect(() =>
    selectMutationDatabasePair({
      US065_MUTATION_DATABASE_URL: "postgres://app:secret@database.internal/ledger065",
      US065_MUTATION_DATABASE_ADMIN_URL:
        "postgres://owner:secret@database.internal/ledger065",
      US066_MUTATION_DATABASE_URL: "postgres://app:secret@database.internal/ledger066",
      US066_MUTATION_DATABASE_ADMIN_URL:
        "postgres://owner:secret@database.internal/ledger066",
    }),
  ).toThrow("mutation harness database pairs are ambiguous");
});

test.each(["US065", "US066"]) (
  "clones and removes a real PostgreSQL mutation database for %s",
  async (prefix) => {
    const restoreEnvironment = isolateMutationDatabaseEnvironment();
    let template: Awaited<ReturnType<typeof createPostgresFixture>> | undefined;
    let sandbox: Awaited<ReturnType<typeof createPostgresFixture>> | undefined;

    try {
      template = await createPostgresFixture();
      process.env[`${prefix}_MUTATION_DATABASE_URL`] = template.appUrl;
      process.env[`${prefix}_MUTATION_DATABASE_ADMIN_URL`] = template.ownerUrl;

      sandbox = await createPostgresFixture();
      expect(sandbox.databaseName).not.toBe(template.databaseName);

      const app = await sandbox.connectAsApp();
      await expect(app.query("SELECT current_user")).resolves.toMatchObject({
        rows: [{ current_user: "ledger_app" }],
      });
      await app.end();

      const owner = await sandbox.connectAsOwner();
      await expect(owner.query("SELECT current_user")).resolves.toMatchObject({
        rows: [{ current_user: "ledger_owner" }],
      });
      await owner.end();

      await expect(Promise.all([sandbox.stop(), sandbox.stop()])).resolves.toEqual([
        undefined,
        undefined,
      ]);

      const templateOwner = await template.connectAsOwner();
      await expect(
        templateOwner.query(
          "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
          [sandbox.databaseName],
        ),
      ).resolves.toMatchObject({ rows: [{ exists: false }] });
      await templateOwner.end();
      sandbox = undefined;
    } finally {
      await sandbox?.stop();
      restoreEnvironment();
      await template?.stop();
    }
  },
  150_000,
);

test("shares a real mutation-template cleanup failure with concurrent callers", async () => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  let template: Awaited<ReturnType<typeof createPostgresFixture>> | undefined;
  let sandbox: Awaited<ReturnType<typeof createPostgresFixture>> | undefined;
  let cleanupCalls: Promise<void>[] = [];

  try {
    template = await createPostgresFixture();
    process.env.US065_MUTATION_DATABASE_URL = template.appUrl;
    process.env.US065_MUTATION_DATABASE_ADMIN_URL = template.ownerUrl;
    sandbox = await createPostgresFixture({
      beforeCleanupSql: "SELECT missing_mutation_fixture_cleanup_function()",
    });

    const firstStop = sandbox.stop();
    const secondStop = sandbox.stop();
    cleanupCalls = [firstStop, secondStop];

    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "42883" });
    await expect(secondStop).rejects.toMatchObject({ code: "42883" });
    const templateOwner = await template.connectAsOwner();
    try {
      expect((await templateOwner.query(
        "SELECT datname FROM pg_database WHERE datname = $1", [sandbox.databaseName],
      )).rows).toEqual([]);
    } finally {
      await templateOwner.end();
    }
  } finally {
    await Promise.allSettled(cleanupCalls);
    if (sandbox && template) {
      const templateOwner = await template.connectAsOwner();
      try {
        await templateOwner.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [sandbox.databaseName],
        );
        await templateOwner.query(`DROP DATABASE IF EXISTS "${sandbox.databaseName}"`);
      } finally {
        await templateOwner.end();
      }
    }
    restoreEnvironment();
    await template?.stop();
  }
}, 150_000);

test("stops a real pinned PostgreSQL container after bootstrap failure", async () => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  let startedContainerUrl: string | undefined;

  try {
    await expect(
      createPostgresFixture({
        afterBootstrapSql: "SELECT missing_fixture_bootstrap_function()",
        onContainerStarted: (container) => {
          startedContainerUrl = container.getConnectionUri();
        },
      }),
    ).rejects.toMatchObject({ code: "42883" });

    expect(startedContainerUrl).toBeDefined();
    const client = new pg.Client({
      connectionString: startedContainerUrl,
      connectionTimeoutMillis: 1_000,
    });
    await expect(client.connect()).rejects.toBeDefined();
    await client.end().catch(() => undefined);
  } finally {
    restoreEnvironment();
  }
}, 150_000);

test("stops a real fixture idempotently when called repeatedly", async () => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  try {
    const fixture = await createPostgresFixture();

    await expect(Promise.all([fixture.stop(), fixture.stop()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    await expect(fixture.stop()).resolves.toBeUndefined();
  } finally {
    restoreEnvironment();
  }
}, 150_000);

test("reports an unexpected cleanup failure after attempting to stop the real container", async () => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  let startedContainerUrl: string | undefined;
  try {
    const fixture = await createPostgresFixture({
      beforeCleanupSql: "SELECT missing_fixture_cleanup_function()",
      onContainerStarted: (container) => {
        startedContainerUrl = container.getConnectionUri();
      },
    });

    await expect(fixture.stop()).rejects.toMatchObject({ code: "42883" });
    await expect(fixture.stop()).rejects.toMatchObject({ code: "42883" });

    expect(startedContainerUrl).toBeDefined();
    const client = new pg.Client({
      connectionString: startedContainerUrl,
      connectionTimeoutMillis: 1_000,
    });
    await expect(client.connect()).rejects.toBeDefined();
    await client.end().catch(() => undefined);
  } finally {
    restoreEnvironment();
  }
}, 150_000);

// CHG-064: pg-pool's end() resolves before its idle clients' sockets close, so
// stopping the fixture straight after it must not terminate a backend that is
// still processing that client's Terminate (FATAL 57P01, re-emitted by the
// pool's idle listener as an uncaught error in the real suites).
// Runs on the cluster connection at the terminate point: any client backend
// still alive there would be terminated mid-Terminate and answer with 57P01.
const noClientBackendRemainsSql = `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname LIKE 'ledger_integrity_%' AND backend_type = 'client backend'
  ) THEN
    RAISE EXCEPTION 'an ending pool client backend is still alive at the terminate point';
  END IF;
END $$`;

test("stops right after a pool ends without terminating any of its ending clients", async () => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  const poolErrors: unknown[] = [];
  try {
    for (let round = 0; round < 5; round += 1) {
      const fixture = await createPostgresFixture({ beforeCleanupSql: noClientBackendRemainsSql });
      const pool = new pg.Pool({ connectionString: fixture.appUrl, max: 24 });
      pool.on("error", (error) => poolErrors.push(error));
      try {
        const clients = await Promise.all(Array.from({ length: 24 }, () => pool.connect()));
        // Temporary relations are dropped while each backend exits, which
        // stretches the exit the way full-gate CPU contention does.
        await Promise.all(clients.map((client) => client.query(`DO $$
          BEGIN
            FOR i IN 1..200 LOOP
              EXECUTE format('CREATE TEMP TABLE slow_exit_%s (id int)', i);
            END LOOP;
          END $$`)));
        for (const client of clients) client.release();
        await pool.end();
      } finally {
        await fixture.stop();
      }
    }

    expect(poolErrors).toEqual([]);
  } finally {
    restoreEnvironment();
  }
}, 300_000);

test("still terminates a genuinely leaked connection when it stops", async () => {
  const restoreEnvironment = isolateMutationDatabaseEnvironment();
  try {
    const fixture = await createPostgresFixture();
    const leaked = await fixture.connectAsApp();
    const leakedErrors: Array<{ code?: string }> = [];
    leaked.on("error", (error) => leakedErrors.push(error as { code?: string }));

    await expect(fixture.stop()).resolves.toBeUndefined();
    await leaked.end().catch(() => undefined);

    expect(leakedErrors.map((error) => error.code)).toContain("57P01");
  } finally {
    restoreEnvironment();
  }
}, 150_000);
