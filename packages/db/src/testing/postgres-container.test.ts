import pg from "pg";
import { expect, test } from "vitest";
import { createPostgresFixture } from "./postgres-container";

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
