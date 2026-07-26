import { hostname } from "node:os";

import pg from "pg";

export const WORKER_HEALTH_HEARTBEAT_INTERVAL_MS = 30_000;

export function workerInstanceIdFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment.WORKER_INSTANCE_ID?.trim() || hostname();
}

export type WorkerRuntimeHealth = {
  close(): Promise<void>;
  markHealthy(at: Date, workerCount: number): Promise<void>;
  markStopped(at: Date): Promise<void>;
  markUnhealthy(at: Date, errorCode: string): Promise<void>;
  touch(at: Date): Promise<void>;
};

export function createWorkerRuntimeHealth(
  connectionString: string,
  instanceId: string,
): WorkerRuntimeHealth {
  const pool = new pg.Pool({
    application_name: "ledger-worker-runtime-health",
    connectionTimeoutMillis: 5_000,
    connectionString,
    query_timeout: 5_000,
  });

  async function upsert(
    status: "healthy" | "stopped" | "unhealthy",
    at: Date,
    workerCount: number,
    errorCode: string | null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO pgboss.worker_runtime_health (
         instance_id, status, scheduler_ready, worker_count, started_at,
         heartbeat_at, last_error_code, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $5, $6, $5)
       ON CONFLICT (instance_id) DO UPDATE SET
         status = EXCLUDED.status,
         scheduler_ready = EXCLUDED.scheduler_ready,
         worker_count = EXCLUDED.worker_count,
         heartbeat_at = EXCLUDED.heartbeat_at,
         last_error_code = EXCLUDED.last_error_code,
         updated_at = EXCLUDED.updated_at`,
      [instanceId, status, status === "healthy", workerCount, at, errorCode],
    );
  }

  return {
    async close(): Promise<void> {
      await pool.end();
    },
    async markHealthy(at, workerCount): Promise<void> {
      await upsert("healthy", at, workerCount, null);
    },
    async markStopped(at): Promise<void> {
      await upsert("stopped", at, 0, null);
    },
    async markUnhealthy(at, errorCode): Promise<void> {
      await upsert("unhealthy", at, 0, errorCode);
    },
    async touch(at): Promise<void> {
      await pool.query(
        `UPDATE pgboss.worker_runtime_health
         SET heartbeat_at = $2, updated_at = $2
         WHERE instance_id = $1 AND status = 'healthy'`,
        [instanceId, at],
      );
    },
  };
}
