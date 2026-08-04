import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { describe, expect, it } from "vitest";

import { createDeferredJobHandlers } from "./deferred.js";

describe("US-046 deferred job handlers", () => {
  it("reports each unavailable later-sprint dependency as skipped work", async () => {
    const handlers = createDeferredJobHandlers();
    const context = {
      at: new Date("2026-08-05T10:30:00.000Z"),
      idempotencyKey: "test-key",
      jobId: "test-job",
    };

    await expect(handlers.analyticsSync({ ...context, jobName: "analyticsSync" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-026",
    });
    await expect(handlers.memberSync({ ...context, jobName: "memberSync" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-018",
    });
    await expect(handlers.invitePoll({ ...context, jobName: "invitePoll" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-018",
    });
    await expect(handlers.alertEvaluation({ ...context, jobName: "alertEvaluation" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-042",
    });
    await expect(handlers.capacityRecovery({ ...context, jobName: "capacityRecovery" })).resolves.toEqual({
      processed: 0,
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-023",
    });
    await expect(handlers.closePrecheck({ ...context, jobName: "closePrecheck" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-034",
    });
  });

  it("invokes the third-business-day policy before deferring the unavailable close handler", async () => {
    const handlers = createDeferredJobHandlers({ holidays: new Set(["2026-08-03"]) });

    await expect(
      handlers.closePrecheck({
        at: new Date("2026-08-05T10:30:00.000Z"),
        idempotencyKey: "close-precheck:2026-08",
        jobId: "job-not-third-business-day",
        jobName: "closePrecheck",
      }),
    ).resolves.toEqual({ processed: 0, status: "succeeded" });
    await expect(
      handlers.closePrecheck({
        at: new Date("2026-08-06T10:30:00.000Z"),
        idempotencyKey: "close-precheck:2026-08",
        jobId: "job-third-business-day",
        jobName: "closePrecheck",
      }),
    ).resolves.toMatchObject({ reason: "dependency_not_delivered", status: "skipped", story: "US-034" });
  });

  it("runs capacity recovery and closes its real PostgreSQL pool", async () => {
    let fixture: PostgresFixture | undefined;
    try {
      fixture = await createPostgresFixture();
      await fixture.migrate();
      const handlers = createDeferredJobHandlers(
        { holidays: new Set() },
        {
          connectionString: fixture.appUrl,
          workerId: "deferred-capacity-recovery-test",
        },
      );

      await expect(handlers.capacityRecovery({
        at: new Date("2026-08-05T10:30:00.000Z"),
        idempotencyKey: "capacity-recovery:2026-08-05T10:30",
        jobId: "capacity-recovery-test-job",
        jobName: "capacityRecovery",
      })).resolves.toEqual({ processed: 0, status: "succeeded" });

      const owner = await fixture.connectAsOwner();
      try {
        await expect(owner.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=$1 AND usename='ledger_app'`,
          [fixture.databaseName],
        )).resolves.toMatchObject({ rows: [{ count: 0 }] });
      } finally {
        await owner.end();
      }
    } finally {
      await fixture?.stop();
    }
  }, 120_000);
});
