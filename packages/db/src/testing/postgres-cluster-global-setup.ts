import {
  SHARED_POSTGRES_CLUSTER_ENV,
  selectMutationDatabasePair,
  startSharedPostgresCluster,
} from "./postgres-container";

// CHG-067 — one shared PostgreSQL 16 cluster for a test run whose files run in
// parallel, so each fixture creates a database on it instead of starting its own
// container. Used by run-with-shared-postgres.ts (and usable as a vitest
// globalSetup); test workers inherit the URL from the environment. A mutation run
// brings its own database pair and needs no cluster.
export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (process.env[SHARED_POSTGRES_CLUSTER_ENV] || selectMutationDatabasePair(process.env)) return undefined;
  const cluster = await startSharedPostgresCluster();
  process.env[SHARED_POSTGRES_CLUSTER_ENV] = cluster.url;
  return async () => {
    delete process.env[SHARED_POSTGRES_CLUSTER_ENV];
    await cluster.stop();
  };
}
