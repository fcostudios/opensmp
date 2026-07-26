import {
  createJobIdempotencyKey,
  createScheduledJobIdempotencyKey,
  JOB_SCHEDULES,
  type EcuadorBusinessCalendar,
  type JobName,
  type JobResult,
} from "@smp/domain";
import { PgBoss, type JobWithMetadata, type WorkOptions } from "pg-boss";

import {
  classifyJobFailure,
  createJobFailureAlertReporter,
  type JobFailureAlertReporter,
} from "./alerts/report-job-failure.js";
import { createDeferredJobHandlers } from "./jobs/deferred.js";
import { createJobIdempotencyBoundary } from "./idempotency.js";
import { createJobLogger, type JobLogger } from "./logger.js";
import {
  createWorkerRuntimeHealth,
  WORKER_HEALTH_HEARTBEAT_INTERVAL_MS,
  workerInstanceIdFromEnvironment,
} from "./runtime-health.js";

export const WORKER_QUEUES = Object.values(JOB_SCHEDULES).map(({ queue }) => queue);

export const PG_BOSS_RUNTIME_SECURITY = Object.freeze({
  createSchema: false,
  migrate: false,
  persistQueueStats: false,
  persistWarnings: false,
});

const QUEUE_OPTIONS = {
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  partition: false,
  retryBackoff: true,
  retryDelay: 5,
  retryLimit: 3,
} as const;

const IDEMPOTENCY_WINDOW_SECONDS: Record<JobName, number> = {
  alertEvaluation: 30 * 60,
  analyticsSync: 2 * 24 * 60 * 60,
  closePrecheck: 35 * 24 * 60 * 60,
  invitePoll: 30 * 60,
  memberSync: 2 * 60 * 60,
};

const WORK_OPTIONS = {
  batchSize: 1,
  includeMetadata: true,
  pollingIntervalSeconds: 0.5,
} as const satisfies WorkOptions;

export const FATAL_HEALTH_WRITE_TIMEOUT_MS = 5_000;

type WorkerJobData = {
  at?: string;
  idempotencyKey?: string;
  vendorAccountId?: string;
};

type WorkerJobContext = {
  at: Date;
  idempotencyKey: string;
  jobId: string;
  jobName: JobName;
  vendorAccountId?: string;
};

type WorkerJobHandler = (context: WorkerJobContext) => Promise<JobResult>;

export type WorkerRuntime = {
  enqueue(jobName: JobName, at: Date, execution?: { vendorAccountId?: string }): Promise<string | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type WorkerRuntimeOptions = {
  backgroundIntervals?: {
    cronMonitorIntervalSeconds?: number;
    monitorIntervalSeconds?: number;
    superviseIntervalSeconds?: number;
  };
  calendar?: EcuadorBusinessCalendar;
  connectionString: string;
  failureReporter?: JobFailureAlertReporter;
  handlers?: Partial<Record<JobName, WorkerJobHandler>>;
  fatalHealthWriteTimeoutMs?: number;
  instanceId?: string;
  logger?: JobLogger;
  now?: () => Date;
  onFatalError?: (error: unknown) => Promise<void> | void;
};

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const logger = options.logger ?? createJobLogger();
  const now = options.now ?? (() => new Date());
  const failureReporter = options.failureReporter ?? createJobFailureAlertReporter(options.connectionString);
  const idempotency = createJobIdempotencyBoundary(options.connectionString);
  const instanceId = options.instanceId ?? workerInstanceIdFromEnvironment();
  const health = createWorkerRuntimeHealth(options.connectionString, instanceId);
  const handlers = {
    ...createDeferredJobHandlers(options.calendar),
    ...options.handlers,
  } as Record<JobName, WorkerJobHandler>;
  const boss = new PgBoss({
    ...PG_BOSS_RUNTIME_SECURITY,
    application_name: "ledger-worker",
    connectionString: options.connectionString,
    ...options.backgroundIntervals,
    schedule: true,
    schema: "pgboss",
    supervise: true,
  });
  let bossOpen = false;
  let running = false;
  let starting: Promise<void> | undefined;
  let fatal = false;
  let healthTimer: ReturnType<typeof setInterval> | undefined;

  boss.on("error", (error) => {
    void latchFatalError(error);
  });

  async function latchFatalError(error: unknown): Promise<void> {
    if (fatal) return;
    fatal = true;
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = undefined;
    }
    const occurredAt = now();
    logger.write({
      attempt: 0,
      durationMs: 0,
      errorCode: redactErrorCode(error),
      finishedAt: occurredAt.toISOString(),
      jobId: "pg-boss",
      jobName: "pg-boss",
      processed: 0,
      startedAt: occurredAt.toISOString(),
      status: "failed",
    });
    try {
      await settleWithin(
        health.markUnhealthy(occurredAt, redactErrorCode(error)),
        options.fatalHealthWriteTimeoutMs ?? FATAL_HEALTH_WRITE_TIMEOUT_MS,
      );
    } finally {
      await options.onFatalError?.(error);
    }
  }

  return {
    async enqueue(jobName, at, execution = {}): Promise<string | null> {
      const idempotencyKey = createJobIdempotencyKey(jobName, { at, ...execution });
      return await boss.send(
        JOB_SCHEDULES[jobName].queue,
        { at: at.toISOString(), idempotencyKey, ...execution },
        {
          ...QUEUE_OPTIONS,
          singletonKey: idempotencyKey,
          singletonSeconds: IDEMPOTENCY_WINDOW_SECONDS[jobName],
        },
      );
    },

    async start(): Promise<void> {
      if (running) return;
      if (starting) return await starting;

      starting = (async () => {
        bossOpen = true;
        try {
          await boss.start();
          await Promise.all(
            (Object.keys(JOB_SCHEDULES) as JobName[]).map(async (jobName) => {
              const schedule = JOB_SCHEDULES[jobName];
              await boss.createQueue(schedule.queue, QUEUE_OPTIONS);
              await boss.work<WorkerJobData, void, typeof WORK_OPTIONS>(
                schedule.queue,
                WORK_OPTIONS,
                async (jobs) => {
                  for (const job of jobs) {
                    await runJob({
                      handler: handlers[jobName],
                      idempotency,
                      instanceId,
                      job,
                      jobName,
                      logger,
                      now,
                      failureReporter,
                    });
                  }
                },
              );
              await boss.schedule(schedule.queue, schedule.cron, { source: "schedule" }, { key: jobName, tz: schedule.timeZone });
            }),
          );
          await boss.supervise();
          if (fatal) throw new Error("pg-boss emitted a fatal background error during startup");
          await health.markHealthy(now(), WORKER_QUEUES.length);
          healthTimer = setInterval(() => {
            void health.touch(now()).catch((error) => latchFatalError(error));
          }, WORKER_HEALTH_HEARTBEAT_INTERVAL_MS);
          running = true;
        } catch (error) {
          await Promise.all([
            closeAfterFailedStart(boss, logger, now),
            failureReporter.close(),
            idempotency.close(),
            health.close(),
          ]);
          bossOpen = false;
          throw error;
        }
      })();

      try {
        await starting;
      } finally {
        starting = undefined;
      }
    },

    async stop(): Promise<void> {
      if (starting) await starting.catch(() => undefined);
      if (!bossOpen) return;
      running = false;
      bossOpen = false;
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = undefined;
      }
      if (!fatal) await health.markStopped(now()).catch(() => undefined);
      await Promise.all([
        stopWithin(boss, 30_000),
        failureReporter.close(),
        idempotency.close(),
        health.close(),
      ]);
    },
  };
}

async function settleWithin(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const guardedOperation = operation.catch(() => undefined);
  try {
    await Promise.race([
      guardedOperation,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function closeAfterFailedStart(
  boss: PgBoss,
  logger: JobLogger,
  now: () => Date,
): Promise<void> {
  try {
    await stopWithin(boss, 30_000);
  } catch (shutdownError) {
    const occurredAt = now();
    logger.write({
      attempt: 0,
      durationMs: 0,
      errorCode: redactErrorCode(shutdownError),
      finishedAt: occurredAt.toISOString(),
      jobId: "pg-boss",
      jobName: "pg-boss",
      processed: 0,
      startedAt: occurredAt.toISOString(),
      status: "failed",
    });
  }
}

async function runJob({
  handler,
  job,
  jobName,
  logger,
  now,
  failureReporter,
  idempotency,
  instanceId,
}: {
  failureReporter: JobFailureAlertReporter;
  handler: WorkerJobHandler;
  idempotency: ReturnType<typeof createJobIdempotencyBoundary>;
  instanceId: string;
  job: JobWithMetadata<WorkerJobData>;
  jobName: JobName;
  logger: JobLogger;
  now: () => Date;
}): Promise<void> {
  const startedAt = now();

  try {
    const at = parseJobTime(job.data.at, job.createdOn);
    const idempotencyKey =
      job.data.idempotencyKey ??
      createScheduledJobIdempotencyKey(jobName, { at });
    const execution = await idempotency.execute({
      idempotencyKey,
      instanceId,
      jobName,
      now,
      run: async () => await handler({
        at,
        idempotencyKey,
        jobId: job.id,
        jobName,
        ...(job.data.vendorAccountId ? { vendorAccountId: job.data.vendorAccountId } : {}),
      }),
    });
    const result: JobResult =
      execution.replayed && execution.result.status === "succeeded"
        ? { processed: 0, status: "succeeded" }
        : execution.result;
    writeResultLog({ job, jobName, logger, result, startedAt, now });
  } catch (error) {
    const finishedAt = now();
    const errorCode = await reportOperationalFailure({
      error,
      failureReporter,
      finishedAt,
      jobName,
      vendorAccountId: job.data.vendorAccountId,
    });
    logger.write({
      attempt: job.retryCount + 1,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorCode,
      finishedAt: finishedAt.toISOString(),
      jobId: job.id,
      jobName: JOB_SCHEDULES[jobName].queue,
      processed: 0,
      startedAt: startedAt.toISOString(),
      status: "failed",
    });
    throw error;
  }
}

async function reportOperationalFailure({
  error,
  failureReporter,
  finishedAt,
  jobName,
  vendorAccountId,
}: {
  error: unknown;
  failureReporter: JobFailureAlertReporter;
  finishedAt: Date;
  jobName: JobName;
  vendorAccountId?: string;
}): Promise<string> {
  const originalCode = redactErrorCode(error);
  const failureType = classifyJobFailure(error);
  if (!failureType) return originalCode;

  try {
    const outcome = await failureReporter.report({
      ...failureScope(error),
      ...(vendorAccountId ? { vendorAccountId } : {}),
      failureType,
      jobName,
      occurredAt: finishedAt,
    });
    return outcome.status === "no_matching_rule" ? `${originalCode}_alert_rule_not_found` : originalCode;
  } catch {
    return `${originalCode}_alert_report_failed`;
  }
}

function failureScope(error: unknown): { companyId?: string; vendorAccountId?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as { companyId?: unknown; vendorAccountId?: unknown };
  return {
    ...(typeof value.companyId === "string" ? { companyId: value.companyId } : {}),
    ...(typeof value.vendorAccountId === "string" ? { vendorAccountId: value.vendorAccountId } : {}),
  };
}

function writeResultLog({
  job,
  jobName,
  logger,
  result,
  startedAt,
  now,
}: {
  job: JobWithMetadata<WorkerJobData>;
  jobName: JobName;
  logger: JobLogger;
  result: JobResult;
  startedAt: Date;
  now: () => Date;
}): void {
  const finishedAt = now();
  logger.write({
    attempt: job.retryCount + 1,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    errorCode: null,
    finishedAt: finishedAt.toISOString(),
    jobId: job.id,
    jobName: JOB_SCHEDULES[jobName].queue,
    processed: result.processed,
    ...("reason" in result ? { reason: result.reason } : {}),
    startedAt: startedAt.toISOString(),
    status: result.status,
    ...("story" in result ? { story: result.story } : {}),
  });
}

function parseJobTime(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("job data contains an invalid at timestamp");
  return date;
}

function redactErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "job_failed";
  }
  return "job_failed";
}

async function stopWithin(boss: PgBoss, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      boss.stop({ close: true, graceful: true, timeout: timeoutMs }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("pg-boss graceful stop timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
