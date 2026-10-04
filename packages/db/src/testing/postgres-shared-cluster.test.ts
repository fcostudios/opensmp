import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

import setup from "./postgres-cluster-global-setup";
import {
  SHARED_POSTGRES_CLUSTER_ENV,
  createPostgresFixture,
  startSharedPostgresCluster,
} from "./postgres-container";

let cluster: Awaited<ReturnType<typeof startSharedPostgresCluster>>;
let previous: string | undefined;

beforeAll(async () => {
  previous = process.env[SHARED_POSTGRES_CLUSTER_ENV];
  cluster = await startSharedPostgresCluster();
  process.env[SHARED_POSTGRES_CLUSTER_ENV] = cluster.url;
}, 150_000);

afterAll(async () => {
  if (previous === undefined) delete process.env[SHARED_POSTGRES_CLUSTER_ENV];
  else process.env[SHARED_POSTGRES_CLUSTER_ENV] = previous;
  await cluster?.stop();
});

async function databases(): Promise<string[]> {
  const admin = new pg.Client({ connectionString: cluster.url });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'ledger_integrity_%' ORDER BY datname",
    );
    return rows.map((row) => row.datname);
  } finally {
    await admin.end();
  }
}

test("fixtures on the shared cluster get separate databases and drop only their own", async () => {
  const first = await createPostgresFixture();
  const second = await createPostgresFixture();
  try {
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(new URL(first.appUrl).port).toBe(new URL(cluster.url).port);
    expect(await databases()).toEqual([first.databaseName, second.databaseName].sort());

    await first.migrate();
    await second.migrate();
    const firstOwner = await first.connectAsOwner();
    await firstOwner.query("CREATE TABLE chg067_probe (id int)");
    await firstOwner.end();
    const secondOwner = await second.connectAsOwner();
    expect((await secondOwner.query("SELECT to_regclass('chg067_probe') AS probe")).rows).toEqual([{ probe: null }]);
    await secondOwner.end();

    const idleApp = await first.connectAsApp();
    idleApp.on("error", () => undefined);
    expect((await idleApp.query("SELECT current_user AS role")).rows).toEqual([{ role: "ledger_app" }]);
    await first.stop();
    await first.stop();
    expect(await databases()).toEqual([second.databaseName]);

    const app = await second.connectAsApp();
    expect((await app.query("SELECT current_user AS role, current_database() AS db")).rows)
      .toEqual([{ role: "ledger_app", db: second.databaseName }]);
    await app.end();
  } finally {
    await first.stop().catch(() => undefined);
    await second.stop();
  }
  expect(await databases()).toEqual([]);
  const admin = new pg.Client({ connectionString: cluster.url });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT rolname, rolsuper, rolcreatedb FROM pg_roles WHERE rolname IN ('ledger_owner', 'ledger_app') ORDER BY rolname",
    );
    expect(rows).toEqual([
      { rolname: "ledger_app", rolsuper: false, rolcreatedb: false },
      { rolname: "ledger_owner", rolsuper: false, rolcreatedb: true },
    ]);
    expect((await admin.query("SHOW max_connections")).rows).toEqual([{ max_connections: "400" }]);
  } finally {
    await admin.end();
  }
}, 150_000);

test("isolated and bootstrap-hooked fixtures still own a private container", async () => {
  for (const options of [{ isolatedContainer: true }, { afterBootstrapSql: "SELECT 1" }]) {
    const fixture = await createPostgresFixture(options);
    try {
      expect(new URL(fixture.appUrl).port).not.toBe(new URL(cluster.url).port);
    } finally {
      await fixture.stop();
    }
  }
}, 300_000);

test("global setup reuses an existing cluster and skips mutation runs", async () => {
  expect(await setup()).toBeUndefined();
  const saved = process.env[SHARED_POSTGRES_CLUSTER_ENV];
  delete process.env[SHARED_POSTGRES_CLUSTER_ENV];
  process.env.US999_MUTATION_DATABASE_URL = "postgresql://app:secret@127.0.0.1:1/template";
  process.env.US999_MUTATION_DATABASE_ADMIN_URL = "postgresql://owner:secret@127.0.0.1:1/template";
  try {
    expect(await setup()).toBeUndefined();
    expect(process.env[SHARED_POSTGRES_CLUSTER_ENV]).toBeUndefined();
  } finally {
    delete process.env.US999_MUTATION_DATABASE_URL;
    delete process.env.US999_MUTATION_DATABASE_ADMIN_URL;
    process.env[SHARED_POSTGRES_CLUSTER_ENV] = saved;
  }
});
