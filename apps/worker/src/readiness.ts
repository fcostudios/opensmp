import { pathToFileURL } from "node:url";

import pg from "pg";

import { WORKER_QUEUES } from "./runtime.js";
import { workerInstanceIdFromEnvironment } from "./runtime-health.js";

export const PG_BOSS_READINESS_MAX_AGE_MS = 120_000;

export async function checkPgBossReadiness(
  connectionString: string,
  instanceId: string,
  now = new Date(),
  maxAgeMs = PG_BOSS_READINESS_MAX_AGE_MS,
): Promise<boolean> {
  const client = new pg.Client({
    application_name: "ledger-worker-healthcheck",
    connectionString,
  });
  try {
    await client.connect();
    const result = await client.query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pgboss.worker_runtime_health
         WHERE instance_id = $1
           AND status = 'healthy'
           AND scheduler_ready
           AND worker_count = $2
           AND heartbeat_at >= $3::timestamptz
           AND heartbeat_at <= $4::timestamptz
       ) AS ready`,
      [
        instanceId,
        WORKER_QUEUES.length,
        new Date(now.getTime() - maxAgeMs),
        new Date(now.getTime() + 5_000),
      ],
    );
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function connectionStringFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;
  const url = new URL("postgresql://localhost");
  url.hostname = environment.PGHOST ?? "localhost";
  url.port = environment.PGPORT ?? "5432";
  url.username = environment.PGUSER ?? "postgres";
  url.password = environment.PGPASSWORD ?? "";
  url.pathname = `/${environment.PGDATABASE ?? "postgres"}`;
  return url.toString();
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  void checkPgBossReadiness(
    connectionStringFromEnvironment(),
    workerInstanceIdFromEnvironment(),
  ).then(
    (ready) => {
      process.exitCode = ready ? 0 : 1;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
