import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../packages/db/src/testing/postgres-container.js";
import {
  createWorkerRuntime,
  PG_BOSS_RUNTIME_SECURITY,
  type WorkerRuntime,
} from "./runtime.js";

let fixture: PostgresFixture;
let appConnectionString: string;

async function queryAsOwner<T extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<T>> {
  const client = await fixture.connectAsOwner();
  try {
    return await client.query<T>(text, values);
  } finally {
    await client.end();
  }
}

async function waitFor(assertion: () => Promise<void>, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError;
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  appConnectionString = fixture.appUrl;
}, 120_000);

afterAll(async () => {
  await fixture.stop();
});

describe("US-046 worker runtime with real PostgreSQL", () => {
  it("starts migration-disabled under ledger_app, reconciles every queue and schedule, and cannot create schema objects", async () => {
    expect(PG_BOSS_RUNTIME_SECURITY).toEqual({
      createSchema: false,
      migrate: false,
      persistQueueStats: false,
      persistWarnings: false,
    });
    const logs: Array<{ errorCode?: string | null; status?: string }> = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      logger: { write: (entry) => logs.push(entry) },
    });
    try {
      await runtime.start();

      const queues = await queryAsOwner<{ name: string; partition: boolean }>(
        "SELECT name, partition FROM pgboss.queue WHERE name = ANY($1) ORDER BY name",
        [["analytics-sync", "member-sync", "invite-poll", "alert-evaluation", "close-precheck"]],
      );
      expect(queues.rows).toEqual([
        { name: "alert-evaluation", partition: false },
        { name: "analytics-sync", partition: false },
        { name: "close-precheck", partition: false },
        { name: "invite-poll", partition: false },
        { name: "member-sync", partition: false },
      ]);

      const schedules = await queryAsOwner<{ cron: string; name: string; timezone: string }>(
        "SELECT name, cron, timezone FROM pgboss.schedule ORDER BY name",
      );
      expect(schedules.rows).toEqual([
        { cron: "7,22,37,52 * * * *", name: "alert-evaluation", timezone: "UTC" },
        { cron: "15 10 * * *", name: "analytics-sync", timezone: "UTC" },
        { cron: "30 10 * * 1-5", name: "close-precheck", timezone: "UTC" },
        { cron: "*/15 * * * *", name: "invite-poll", timezone: "UTC" },
        { cron: "5 * * * *", name: "member-sync", timezone: "UTC" },
      ]);

      const appClient = new pg.Client({ connectionString: appConnectionString });
      await appClient.connect();
      try {
        await expect(appClient.query(`CREATE TABLE pgboss.denied_${randomUUID().replaceAll("-", "_")} (id int)`)).rejects.toThrow(
          "permission denied",
        );
      } finally {
        await appClient.end();
      }
      expect(logs.filter((entry) => entry.status === "failed")).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  it("runs exactly one deferred job for a repeated idempotency key and logs the skipped dependency", async () => {
    const logs: object[] = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      logger: { write: (entry) => logs.push(entry) },
    });
    try {
      await runtime.start();
      const at = new Date("2026-07-25T14:15:00.000Z");

      const first = await runtime.enqueue("alertEvaluation", at);
      const duplicate = await runtime.enqueue("alertEvaluation", at);

      expect(first).toMatch(/[0-9a-f-]{36}/);
      expect(duplicate).toBeNull();
      await waitFor(async () => {
        expect(logs).toContainEqual(
          expect.objectContaining({
            errorCode: null,
            jobName: "alert-evaluation",
            processed: 0,
            reason: "dependency_not_delivered",
            status: "skipped",
            story: "US-042",
          }),
        );
      });
      expect(logs.filter((entry) => (entry as { jobName?: string }).jobName === "alert-evaluation")).toHaveLength(1);
    } finally {
      await runtime.stop();
    }
  });

  it("deduplicates every manual handler when the same execution key is rerun", async () => {
    const logs: Array<{ jobName?: string; status?: string }> = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      logger: { write: (entry) => logs.push(entry) },
    });
    const at = new Date("2026-09-17T16:45:00.000Z");
    const vendor = { vendorAccountId: "00000000-0000-0000-0000-000000000719" };
    const executions = [
      ["analyticsSync", vendor],
      ["memberSync", vendor],
      ["invitePoll", vendor],
      ["alertEvaluation", {}],
      ["closePrecheck", {}],
    ] as const;
    try {
      await runtime.start();
      for (const [jobName, execution] of executions) {
        const first = await runtime.enqueue(jobName, at, execution);
        const duplicate = await runtime.enqueue(jobName, at, execution);
        expect(first, jobName).toMatch(/[0-9a-f-]{36}/);
        expect(duplicate, jobName).toBeNull();
      }
      await waitFor(async () => {
        expect(
          new Set(logs.map(({ jobName }) => jobName)),
        ).toEqual(
          new Set([
            "analytics-sync",
            "member-sync",
            "invite-poll",
            "alert-evaluation",
            "close-precheck",
          ]),
        );
        expect(logs).toHaveLength(5);
      });
    } finally {
      await runtime.stop();
    }
  }, 15_000);

  it("uses one durable idempotency boundary across two runtimes and after singleton expiry", async () => {
    let releaseFirst: (() => void) | undefined;
    let signalEntered: (() => void) | undefined;
    const firstEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const executions = { first: 0, second: 0 };
    const firstRuntime = createWorkerRuntime({
      connectionString: appConnectionString,
      instanceId: `worker-a-${randomUUID()}`,
      handlers: {
        alertEvaluation: async () => {
          executions.first += 1;
          signalEntered?.();
          await firstMayFinish;
          return { processed: 1, status: "succeeded" };
        },
      },
    });
    const secondRuntime = createWorkerRuntime({
      connectionString: appConnectionString,
      instanceId: `worker-b-${randomUUID()}`,
      handlers: {
        alertEvaluation: async () => {
          executions.second += 1;
          return { processed: 1, status: "succeeded" };
        },
      },
    });
    try {
      await firstRuntime.start();
      const at = "2026-10-20T11:07:00.000Z";
      const scheduled = await queryAsOwner<{ id: string }>(
        `INSERT INTO pgboss.job (name, data)
         VALUES ('alert-evaluation', jsonb_build_object('at', $1::text, 'source', 'schedule'))
         RETURNING id`,
        [at],
      );
      await firstEntered;
      await secondRuntime.start();
      const manualId = await secondRuntime.enqueue("alertEvaluation", new Date(at));
      expect(manualId).toMatch(/[0-9a-f-]{36}/);
      await waitFor(async () => {
        const active = await queryAsOwner<{ state: string }>(
          "SELECT state FROM pgboss.job WHERE id = $1",
          [manualId],
        );
        expect(active.rows[0]?.state).toBe("active");
      });
      releaseFirst?.();

      await waitFor(async () => {
        const jobs = await queryAsOwner<{ state: string }>(
          "SELECT state FROM pgboss.job WHERE id = ANY($1::uuid[]) ORDER BY id",
          [[scheduled.rows[0]?.id, manualId]],
        );
        expect(jobs.rows).toHaveLength(2);
        expect(jobs.rows.every(({ state }) => state === "completed")).toBe(true);
      });
      expect(executions).toEqual({ first: 1, second: 0 });

      const replay = await queryAsOwner<{ id: string }>(
        `INSERT INTO pgboss.job (name, data)
         VALUES ('alert-evaluation', jsonb_build_object('at', $1::text, 'source', 'manual-after-singleton-expiry'))
         RETURNING id`,
        [at],
      );
      await waitFor(async () => {
        const job = await queryAsOwner<{ state: string }>(
          "SELECT state FROM pgboss.job WHERE id = $1",
          [replay.rows[0]?.id],
        );
        expect(job.rows[0]?.state).toBe("completed");
      });
      expect(executions).toEqual({ first: 1, second: 0 });
      await expect(queryAsOwner(
        `SELECT job_name, status, result
         FROM pgboss.worker_job_execution
         WHERE idempotency_key = 'alert-evaluation:2026-10-20T11:00'`,
      )).resolves.toMatchObject({
        rows: [{
          job_name: "alertEvaluation",
          result: { processed: 1, status: "succeeded" },
          status: "succeeded",
        }],
      });
    } finally {
      releaseFirst?.();
      await Promise.all([firstRuntime.stop(), secondRuntime.stop()]);
    }
  }, 30_000);

  it("logs a corrupt scheduled payload as a failed run before pg-boss retries it", async () => {
    const logs: object[] = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      logger: { write: (entry) => logs.push(entry) },
    });
    try {
      await runtime.start();
      const inserted = await queryAsOwner<{ id: string }>(
        `INSERT INTO pgboss.job (name, data, retry_limit)
         VALUES ('alert-evaluation', '{"at":"not-a-date"}'::jsonb, 0)
         RETURNING id`,
      );
      const jobId = inserted.rows[0]?.id;

      await waitFor(async () => {
        expect(logs).toContainEqual(
          expect.objectContaining({
            errorCode: "job_failed",
            jobId,
            jobName: "alert-evaluation",
            status: "failed",
          }),
        );
      });
    } finally {
      await runtime.stop();
    }
  }, 15_000);

  it("delivers each cron-shaped payload to its deferred handler with a scheduled coordinator key", async () => {
    const logs: Array<{ id?: string; jobId?: string; jobName?: string; status?: string }> = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      logger: { write: (entry) => logs.push(entry) },
    });
    try {
      await runtime.start();
      const scheduledAt = "2026-08-05T10:30:00.000Z";
      const inserted = await Promise.all(
        [
          "analytics-sync",
          "member-sync",
          "invite-poll",
          "alert-evaluation",
          "close-precheck",
        ].map(async (queue) =>
          await queryAsOwner<{ id: string }>(
            `INSERT INTO pgboss.job (name, data)
             VALUES ($1, jsonb_build_object('at', $2::text, 'source', 'schedule'))
             RETURNING id`,
            [queue, scheduledAt],
          ),
        ),
      );
      const jobIds = inserted.map((result) => result.rows[0]?.id).filter((id): id is string => Boolean(id));

      await waitFor(async () => {
        for (const jobId of jobIds) {
          expect(logs.filter((entry) => entry.jobId === jobId)).toHaveLength(1);
          expect(logs).toContainEqual(expect.objectContaining({ jobId, processed: 0, status: "skipped" }));
        }
      });
    } finally {
      await runtime.stop();
    }
  });

  it("rejects a vendor job without an account and deduplicates a real vendor execution key", async () => {
    const logs: object[] = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      logger: { write: (entry) => logs.push(entry) },
    });
    try {
      await runtime.start();
      const at = new Date("2026-07-25T14:15:00.000Z");

      await expect(runtime.enqueue("analyticsSync", at)).rejects.toThrow("vendorAccountId is required");
      const execution = { vendorAccountId: "00000000-0000-0000-0000-000000000710" };
      const first = await runtime.enqueue("analyticsSync", at, execution);
      const duplicate = await runtime.enqueue("analyticsSync", at, execution);

      expect(first).toMatch(/[0-9a-f-]{36}/);
      expect(duplicate).toBeNull();
      await waitFor(async () => {
        expect(logs).toContainEqual(
          expect.objectContaining({
            jobName: "analytics-sync",
            processed: 0,
            status: "skipped",
          }),
        );
      });
    } finally {
      await runtime.stop();
    }
  }, 15_000);

  it("gracefully closes its pg-boss connections on stop", async () => {
    let runtime: WorkerRuntime | undefined;
    try {
      runtime = createWorkerRuntime({ connectionString: appConnectionString });
      await runtime.start();
      await runtime.stop();

      await waitFor(async () => {
        const sessions = await queryAsOwner<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE usename = 'ledger_app' AND application_name = 'ledger-worker'",
        );
        expect(sessions.rows[0]?.count).toBe("0");
      });
    } finally {
      await runtime?.stop();
    }
  });

  it("closes pg-boss after a partial startup failure before rethrowing", async () => {
    await queryAsOwner("REVOKE EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) FROM ledger_app");
    const runtime = createWorkerRuntime({ connectionString: appConnectionString });
    try {
      await expect(runtime.start()).rejects.toThrow("permission denied");
      await runtime.stop();

      await waitFor(async () => {
        const sessions = await queryAsOwner<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE usename = 'ledger_app' AND application_name = 'ledger-worker'",
        );
        expect(sessions.rows[0]?.count).toBe("0");
      });
    } finally {
      await queryAsOwner("GRANT EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) TO ledger_app");
      await runtime.stop();
    }
  }, 12_000);
});
