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
}

function databaseUrl(baseUrl: string, username: string, password: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.username = username;
  url.password = password;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** A fresh PostgreSQL 16 cluster with the real owner/app role separation. */
export async function createPostgresFixture(
  {
    afterBootstrapSql,
    beforeCleanupSql,
    onContainerStarted,
  }: PostgresFixtureOptions = {},
): Promise<PostgresFixture> {
  const mutationAppUrl = process.env.US017_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US017_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("US-017 mutation harness requires both database URLs");
    }
    const templateDatabase = new URL(mutationOwnerUrl).pathname.slice(1);
    if (!/^[a-z0-9_]+$/.test(templateDatabase)) {
      throw new Error("US-017 mutation template database name is invalid");
    }
    const databaseName =
      `ledger_us017_${randomUUID().replaceAll("-", "")}`;
    const maintenanceUrl = new URL(mutationOwnerUrl);
    maintenanceUrl.pathname = "/postgres";
    const maintenance = new pg.Client({
      connectionString: maintenanceUrl.toString(),
    });
    await maintenance.connect();
    try {
      await maintenance.query(
        `CREATE DATABASE "${databaseName}"
         WITH TEMPLATE "${templateDatabase}" OWNER ledger_owner`,
      );
    } finally {
      await maintenance.end();
    }
    const appUrlValue = new URL(mutationAppUrl);
    appUrlValue.pathname = `/${databaseName}`;
    const appUrl = appUrlValue.toString();
    const ownerUrlValue = new URL(mutationOwnerUrl);
    ownerUrlValue.pathname = `/${databaseName}`;
    const ownerUrl = ownerUrlValue.toString();
    let stopped = false;
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
      async stop() {
        if (stopped) return;
        stopped = true;
        const client = new pg.Client({
          connectionString: maintenanceUrl.toString(),
        });
        await client.connect();
        try {
          await client.query(
            `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
             WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [databaseName],
          );
          await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        } finally {
          await client.end();
        }
      },
    };
  }

  const container = await new PostgreSqlContainer(POSTGRES_16_ALPINE_IMAGE)
    .withStartupTimeout(120_000)
    .start();
  onContainerStarted?.(container);
  const clusterUrl = container.getConnectionUri();
  const suffix = randomUUID().replaceAll("-", "");
  const databaseName = `ledger_integrity_${suffix}`;
  const ownerUrl = databaseUrl(clusterUrl, "ledger_owner", "owner-secret", databaseName);
  const appUrl = databaseUrl(clusterUrl, "ledger_app", "app-secret", databaseName);

  const admin = new pg.Client({ connectionString: clusterUrl });
  try {
    await admin.connect();
    await admin.query(`
      CREATE ROLE ledger_owner LOGIN CREATEDB NOSUPERUSER NOCREATEROLE
        NOREPLICATION NOBYPASSRLS PASSWORD 'owner-secret';
      CREATE ROLE ledger_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB
        NOREPLICATION NOBYPASSRLS PASSWORD 'app-secret';
    `);
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
          const cleanupStatements: Array<
            | { text: string }
            | { text: string; values: string[] }
          > = [
            ...(beforeCleanupSql ? [{ text: beforeCleanupSql }] : []),
            {
              text: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
              values: [databaseName],
            },
            { text: `DROP DATABASE IF EXISTS "${databaseName}"` },
            { text: "DROP ROLE IF EXISTS ledger_app" },
            { text: "DROP ROLE IF EXISTS ledger_owner" },
          ];

          for (const statement of cleanupStatements) {
            try {
              await cluster.query(statement.text, "values" in statement ? statement.values : undefined);
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
