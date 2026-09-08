import pg from "pg";
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

test("selects the complete US-065 mutation database pair", () => {
  expect(
    selectMutationDatabasePair({
      US065_MUTATION_DATABASE_URL: "postgres://app:secret@database.internal/ledger",
      US065_MUTATION_DATABASE_ADMIN_URL:
        "postgres://owner:secret@database.internal/ledger",
    }),
  ).toEqual({
    prefix: "US065",
    appUrl: "postgres://app:secret@database.internal/ledger",
    ownerUrl: "postgres://owner:secret@database.internal/ledger",
  });
});

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

test("stops a real pinned PostgreSQL container after bootstrap failure", async () => {
  let startedContainerUrl: string | undefined;

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
}, 150_000);

test("stops a real fixture idempotently when called repeatedly", async () => {
  const fixture = await createPostgresFixture();

  await expect(Promise.all([fixture.stop(), fixture.stop()])).resolves.toEqual([
    undefined,
    undefined,
  ]);
  await expect(fixture.stop()).resolves.toBeUndefined();
}, 150_000);

test("reports an unexpected cleanup failure after attempting to stop the real container", async () => {
  let startedContainerUrl: string | undefined;
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
}, 150_000);
