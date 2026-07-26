import type { JobName, JobResult } from "@smp/domain";
import pg from "pg";

type StoredExecution = {
  job_name: string;
  result: unknown;
  status: "failed" | "running" | "skipped" | "succeeded";
};

export type JobIdempotencyBoundary = {
  close(): Promise<void>;
  execute(input: {
    idempotencyKey: string;
    instanceId: string;
    jobName: JobName;
    now: () => Date;
    run: () => Promise<JobResult>;
  }): Promise<{ replayed: boolean; result: JobResult }>;
};

export function createJobIdempotencyBoundary(
  connectionString: string,
): JobIdempotencyBoundary {
  const pool = new pg.Pool({
    application_name: "ledger-worker-idempotency",
    connectionString,
  });

  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async execute(input): Promise<{ replayed: boolean; result: JobResult }> {
      const client = await pool.connect();
      let locked = false;
      try {
        await client.query(
          "SELECT pg_advisory_lock(hashtextextended($1, 0))",
          [`ledger-worker:${input.idempotencyKey}`],
        );
        locked = true;
        const existing = await client.query<StoredExecution>(
          `SELECT job_name, status, result
           FROM pgboss.worker_job_execution
           WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (row && row.job_name !== input.jobName) {
          throw new Error("idempotency key belongs to a different job");
        }
        if (row && (row.status === "succeeded" || row.status === "skipped")) {
          return { replayed: true, result: parseStoredResult(row.result) };
        }

        const claimedAt = input.now();
        await client.query(
          `INSERT INTO pgboss.worker_job_execution (
             idempotency_key, job_name, status, claimed_by, claimed_at, completed_at, result, updated_at
           )
           VALUES ($1, $2, 'running', $3, $4, NULL, NULL, $4)
           ON CONFLICT (idempotency_key) DO UPDATE SET
             status = 'running',
             claimed_by = EXCLUDED.claimed_by,
             claimed_at = EXCLUDED.claimed_at,
             completed_at = NULL,
             result = NULL,
             updated_at = EXCLUDED.updated_at`,
          [input.idempotencyKey, input.jobName, input.instanceId, claimedAt],
        );

        try {
          const result = await input.run();
          const completedAt = input.now();
          await client.query(
            `UPDATE pgboss.worker_job_execution
             SET status = $2, completed_at = $3, result = $4::jsonb, updated_at = $3
             WHERE idempotency_key = $1`,
            [input.idempotencyKey, result.status, completedAt, JSON.stringify(result)],
          );
          return { replayed: false, result };
        } catch (error) {
          const failedAt = input.now();
          await client.query(
            `UPDATE pgboss.worker_job_execution
             SET status = 'failed', completed_at = $2, result = NULL, updated_at = $2
             WHERE idempotency_key = $1`,
            [input.idempotencyKey, failedAt],
          );
          throw error;
        }
      } finally {
        if (locked) {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            [`ledger-worker:${input.idempotencyKey}`],
          ).catch(() => undefined);
        }
        client.release();
      }
    },
  };
}

function parseStoredResult(value: unknown): JobResult {
  if (!value || typeof value !== "object") {
    throw new TypeError("stored job result is invalid");
  }
  const result = value as Record<string, unknown>;
  if (
    (result.status !== "succeeded" && result.status !== "skipped") ||
    typeof result.processed !== "number"
  ) {
    throw new TypeError("stored job result is invalid");
  }
  return value as JobResult;
}
