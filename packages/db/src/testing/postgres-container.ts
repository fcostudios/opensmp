import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";

import { withContainerStartLock } from "./container-start-lock";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationRunner = resolve(packageRoot, "scripts/apply-migrations.mjs");
export const POSTGRES_16_ALPINE_IMAGE =
  "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";

export interface PostgresFixture {
  readonly appUrl: string;
  readonly databaseName: string;
  readonly ownerUrl: string;
  connectAsApp(): Promise<pg.Client>;
  connectAsOwner(): Promise<pg.Client>;
  migrate(): Promise<void>;
  stop(): Promise<void>;
}

export interface PostgresFixtureOptions {
  /** Test-only deterministic fault point after the real role bootstrap. */
  afterBootstrapSql?: string;
  /** Test-only deterministic fault point before fixture cleanup. */
  beforeCleanupSql?: string;
  onContainerStarted?: (container: StartedPostgreSqlContainer) => void;
  /** Own a private container even when a shared test cluster is available. */
  isolatedContainer?: boolean;
}

/**
 * CHG-067 — set by a package's vitest globalSetup to one shared test cluster
 * whose ledger_owner/ledger_app roles are already bootstrapped. Fixtures then
 * create and drop only their own database on it, instead of one container per
 * test file: thirteen concurrently running containers were the Docker load the
 * full gate failed under.
 */
export const SHARED_POSTGRES_CLUSTER_ENV = "SMP_TEST_POSTGRES_CLUSTER_URL";

const ROLE_BOOTSTRAP_SQL = `
  CREATE ROLE ledger_owner LOGIN CREATEDB NOSUPERUSER NOCREATEROLE
    NOREPLICATION NOBYPASSRLS PASSWORD 'owner-secret';
  CREATE ROLE ledger_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB
    NOREPLICATION NOBYPASSRLS PASSWORD 'app-secret';
`;

function startPostgres16Container(): Promise<StartedPostgreSqlContainer> {
  return withContainerStartLock(() =>
    new PostgreSqlContainer(POSTGRES_16_ALPINE_IMAGE)
      // A shared cluster serves every parallel test file's pools at once.
      .withCommand(["postgres", "-c", "max_connections=400"])
      .withStartupTimeout(120_000)
      .start());
}

/** One pinned PostgreSQL 16 cluster with the owner/app roles, for many fixtures. */
export async function startSharedPostgresCluster(): Promise<{ url: string; stop(): Promise<void> }> {
  const container = await startPostgres16Container();
  const url = container.getConnectionUri();
  const admin = new pg.Client({ connectionString: url });
  try {
    await admin.connect();
    await admin.query(ROLE_BOOTSTRAP_SQL);
    await admin.end();
  } catch (error) {
    await admin.end().catch(() => undefined);
    await container.stop().catch(() => undefined);
    throw error;
  }
  return { url, stop: async () => { await container.stop(); } };
}

function connectors(appUrl: string, ownerUrl: string) {
  return {
    async connectAsApp() {
      const client = new pg.Client({ connectionString: appUrl });
      await client.connect();
      return client;
    },
    async connectAsOwner() {
      const client = new pg.Client({ connectionString: ownerUrl });
      await client.connect();
      return client;
    },
    async migrate() {
      await execFileAsync(process.execPath, [migrationRunner], {
        cwd: packageRoot,
        env: {
          ...process.env,
          DATABASE_ADMIN_URL: ownerUrl,
          DATABASE_URL: appUrl,
        },
      });
    },
  };
}

function throwCleanupErrors(cleanupErrors: unknown[]): void {
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, "PostgreSQL fixture cleanup failed");
  }
}

async function createSharedClusterFixture(
  clusterUrl: string,
  beforeCleanupSql: string | undefined,
): Promise<PostgresFixture> {
  const databaseName = `ledger_integrity_${randomUUID().replaceAll("-", "")}`;
  const ownerUrl = databaseUrl(clusterUrl, "ledger_owner", "owner-secret", databaseName);
  const appUrl = databaseUrl(clusterUrl, "ledger_app", "app-secret", databaseName);
  const admin = new pg.Client({ connectionString: clusterUrl });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}" OWNER ledger_owner`);
  } finally {
    await admin.end().catch(() => undefined);
  }

  let stopPromise: Promise<void> | undefined;
  return {
    appUrl,
    databaseName,
    ownerUrl,
    ...connectors(appUrl, ownerUrl),
    stop() {
      stopPromise ??= (async () => {
        const cluster = new pg.Client({ connectionString: clusterUrl });
        const cleanupErrors: unknown[] = [];
        try {
          await cluster.connect();
        } catch (error) {
          throwCleanupErrors([error]);
        }
        // The roles and the cluster belong to every fixture: drop only this
        // fixture's database, after the same drain the private path uses.
        const cleanupSteps: Array<() => Promise<unknown>> = [
          () => drainClientBackends(cluster, databaseName),
          ...(beforeCleanupSql ? [() => cluster.query(beforeCleanupSql)] : []),
          () => cluster.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [databaseName],
          ),
          () => cluster.query(`DROP DATABASE IF EXISTS "${databaseName}"`),
        ];
        for (const step of cleanupSteps) {
          try {
            await step();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await cluster.end();
        } catch (error) {
          cleanupErrors.push(error);
        }
        throwCleanupErrors(cleanupErrors);
      })();
      return stopPromise;
    },
  };
}

export interface MutationDatabasePair {
  readonly prefix: string;
  readonly appUrl: string;
  readonly ownerUrl: string;
}

const mutationDatabaseUrlKey = /^(US\d+)_MUTATION_DATABASE_(ADMIN_)?URL$/;

export function selectMutationDatabasePair(
  environment: Record<string, string | undefined>,
): MutationDatabasePair | null {
  const pairs = new Map<string, { appUrl?: string; ownerUrl?: string }>();

  for (const [key, value] of Object.entries(environment)) {
    const match = mutationDatabaseUrlKey.exec(key);
    if (!match) continue;

    const pair = pairs.get(match[1]) ?? {};
    if (match[2]) {
      pair.ownerUrl = value;
    } else {
      pair.appUrl = value;
    }
    pairs.set(match[1], pair);
  }

  if (pairs.size === 0) return null;

  const sortedPairs = [...pairs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [prefix, pair] of sortedPairs) {
    if (!pair.appUrl || !pair.ownerUrl) {
      throw new Error(`${prefix} mutation harness requires both database URLs`);
    }
  }

  if (sortedPairs.length > 1) {
    throw new Error("mutation harness database pairs are ambiguous");
  }

  const [prefix, pair] = sortedPairs[0];
  return { prefix, appUrl: pair.appUrl!, ownerUrl: pair.ownerUrl! };
}

function databaseUrl(baseUrl: string, username: string, password: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.username = username;
  url.password = password;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

// pg-pool's end() resolves once its client list is empty, without awaiting
// each idle client's end(): a backend can still be reading or acting on that
// client's Terminate when cleanup runs. Terminating it then sends FATAL 57P01
// to a client that still carries the pool's idle error listener, which
// re-emits it on a pool nobody listens to — an uncaught error in whichever
// suite tears down last. So wait for those backends to exit first. A backend
// that is exiting has left ClientRead; only one that keeps waiting for a
// client command, unchanged, is a genuine leak and left to pg_terminate_backend.
const LEAKED_BACKEND_SETTLE_MS = 1_000;

async function drainClientBackends(client: pg.Client, databaseName: string): Promise<void> {
  let waitingPids = "";
  let waitingSince = 0;
  for (;;) {
    const { rows } = await client.query<{ pid: number; waiting: boolean }>(
      // A NULL state is a row the viewer may not inspect (the mutation-clone
      // owner lacks pg_read_all_stats): treat it as waiting so it still
      // settles. An exiting backend stays 'idle' but has a NULL wait_event,
      // so it is never mistaken for a leak.
      `SELECT pid,
              (state IS NULL OR (state = 'idle' AND wait_event IS NOT DISTINCT FROM 'ClientRead')) AS waiting
       FROM pg_stat_activity
       WHERE datname = $1 AND backend_type = 'client backend' AND pid <> pg_backend_pid()
       ORDER BY pid`,
      [databaseName],
    );
    if (rows.length === 0) return;
    if (rows.every((row) => row.waiting)) {
      const pids = rows.map((row) => row.pid).join(",");
      if (pids !== waitingPids) {
        waitingPids = pids;
        waitingSince = Date.now();
      } else if (Date.now() - waitingSince >= LEAKED_BACKEND_SETTLE_MS) {
        return;
      }
    } else {
      waitingPids = "";
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function parseMutationDatabaseUrl(value: string, prefix: string): URL {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      throw new Error("invalid PostgreSQL URL");
    }
    // pg decodes credentials when constructing its client. Validate that step
    // here too, before either URL can cause a connection or clone allocation.
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    return url;
  } catch {
    // Node's URL error retains the supplied secret in `input`. Never retain it
    // as a cause, enumerable field, or nested error on this public diagnostic.
    throw new Error(`${prefix} mutation database URL is invalid`);
  }
}

/** A fresh PostgreSQL 16 cluster with the real owner/app role separation. */
export async function createPostgresFixture(
  {
    afterBootstrapSql,
    beforeCleanupSql,
    onContainerStarted,
    isolatedContainer = false,
  }: PostgresFixtureOptions = {},
): Promise<PostgresFixture> {
  const mutationPair = selectMutationDatabasePair(process.env);
  if (mutationPair) {
    const { appUrl: mutationAppUrl, ownerUrl: mutationOwnerUrl, prefix } = mutationPair;
    const ownerUrlValue = parseMutationDatabaseUrl(mutationOwnerUrl, prefix);
    const appUrlValue = parseMutationDatabaseUrl(mutationAppUrl, prefix);
    const templateDatabase = ownerUrlValue.pathname.slice(1);
    if (!/^[a-z0-9_]+$/.test(templateDatabase)) {
      throw new Error(`${prefix} mutation template database name is invalid`);
    }
    const databaseName =
      `ledger_mutation_${randomUUID().replaceAll("-", "")}`;
    const maintenanceUrl = new URL(ownerUrlValue);
    maintenanceUrl.pathname = "/postgres";
    appUrlValue.pathname = `/${databaseName}`;
    const appUrl = appUrlValue.toString();
    ownerUrlValue.pathname = `/${databaseName}`;
    const ownerUrl = ownerUrlValue.toString();
    const cleanupClone = async (faultSql?: string): Promise<void> => {
      const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
      try {
        await client.connect();
        try {
          await drainClientBackends(client, databaseName);
          if (faultSql) await client.query(faultSql);
        } finally {
          // Even the deterministic cleanup fault must not skip the real drop.
          await client.query(
            `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
             WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [databaseName],
          );
          await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        }
      } finally {
        await client.end();
      }
    };
    const maintenance = new pg.Client({
      connectionString: maintenanceUrl.toString(),
    });
    let allocated = false;
    try {
      await maintenance.connect();
      await maintenance.query(
        `CREATE DATABASE "${databaseName}"
         WITH TEMPLATE "${templateDatabase}" OWNER ledger_owner`,
      );
      allocated = true;
      if (afterBootstrapSql) await maintenance.query(afterBootstrapSql);
      await maintenance.end();
    } catch (error) {
      await maintenance.end().catch(() => undefined);
      if (allocated) {
        try {
          await cleanupClone();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `${prefix} mutation clone bootstrap cleanup failed`);
        }
      }
      throw error;
    }
    let stopPromise: Promise<void> | undefined;
    return {
      appUrl,
      databaseName,
      ownerUrl,
      async connectAsApp() {
        const client = new pg.Client({ connectionString: appUrl });
        await client.connect();
        return client;
      },
      async connectAsOwner() {
        const client = new pg.Client({ connectionString: ownerUrl });
        await client.connect();
        return client;
      },
      async migrate() {},
      stop() {
        stopPromise ??= cleanupClone(beforeCleanupSql);
        return stopPromise;
      },
    };
  }

  const sharedClusterUrl = process.env[SHARED_POSTGRES_CLUSTER_ENV];
  // Bootstrap faults and container hooks act on a whole cluster: those fixtures
  // keep a private container.
  if (sharedClusterUrl && !isolatedContainer && !afterBootstrapSql && !onContainerStarted) {
    return createSharedClusterFixture(sharedClusterUrl, beforeCleanupSql);
  }

  const container = await startPostgres16Container();
  onContainerStarted?.(container);
  const clusterUrl = container.getConnectionUri();
  const suffix = randomUUID().replaceAll("-", "");
  const databaseName = `ledger_integrity_${suffix}`;
  const ownerUrl = databaseUrl(clusterUrl, "ledger_owner", "owner-secret", databaseName);
  const appUrl = databaseUrl(clusterUrl, "ledger_app", "app-secret", databaseName);

  const admin = new pg.Client({ connectionString: clusterUrl });
  try {
    await admin.connect();
    await admin.query(ROLE_BOOTSTRAP_SQL);
    if (afterBootstrapSql) await admin.query(afterBootstrapSql);
    await admin.query(`CREATE DATABASE "${databaseName}" OWNER ledger_owner`);
    await admin.end();
  } catch (error) {
    await admin.end().catch(() => undefined);
    await container.stop().catch(() => undefined);
    throw error;
  }

  let stopPromise: Promise<void> | undefined;

  return {
    appUrl,
    databaseName,
    ownerUrl,
    async connectAsApp() {
      const client = new pg.Client({ connectionString: appUrl });
      await client.connect();
      return client;
    },
    async connectAsOwner() {
      const client = new pg.Client({ connectionString: ownerUrl });
      await client.connect();
      return client;
    },
    async migrate() {
      await execFileAsync(process.execPath, [migrationRunner], {
        cwd: packageRoot,
        env: {
          ...process.env,
          DATABASE_ADMIN_URL: ownerUrl,
          DATABASE_URL: appUrl,
        },
      });
    },
    stop() {
      stopPromise ??= (async () => {
        const cluster = new pg.Client({ connectionString: clusterUrl });
        const cleanupErrors: unknown[] = [];
        let connected = false;

        try {
          await cluster.connect();
          connected = true;
        } catch (error) {
          cleanupErrors.push(error);
        }

        if (connected) {
          const cleanupSteps: Array<() => Promise<unknown>> = [
            () => drainClientBackends(cluster, databaseName),
            ...(beforeCleanupSql ? [() => cluster.query(beforeCleanupSql)] : []),
            () => cluster.query(
              "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
              [databaseName],
            ),
            () => cluster.query(`DROP DATABASE IF EXISTS "${databaseName}"`),
            () => cluster.query("DROP ROLE IF EXISTS ledger_app"),
            () => cluster.query("DROP ROLE IF EXISTS ledger_owner"),
          ];

          for (const step of cleanupSteps) {
            try {
              await step();
            } catch (error) {
              cleanupErrors.push(error);
            }
          }
        }

        try {
          await cluster.end();
        } catch (error) {
          cleanupErrors.push(error);
        }

        try {
          await container.stop();
        } catch (error) {
          cleanupErrors.push(error);
        }

        if (cleanupErrors.length === 1) {
          throw cleanupErrors[0];
        }
        if (cleanupErrors.length > 1) {
          throw new AggregateError(
            cleanupErrors,
            "PostgreSQL fixture cleanup failed",
          );
        }
      })();
      return stopPromise;
    },
  };
}
