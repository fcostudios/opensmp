import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../packages/db/src/testing/postgres-container.js";
import { checkPgBossReadiness } from "./readiness.js";
import { createWorkerRuntime } from "./runtime.js";

const fixtures: PostgresFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

describe("US-046 pg-boss database readiness", () => {
  it("latches this runtime unhealthy when its scheduler fails while queue supervision remains fresh", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const instanceId = `readiness-${randomUUID()}`;
    let signalFatal: ((error: unknown) => void) | undefined;
    const fatal = new Promise<unknown>((resolve) => {
      signalFatal = resolve;
    });
    const runtime = createWorkerRuntime({
      backgroundIntervals: {
        cronMonitorIntervalSeconds: 1,
        monitorIntervalSeconds: 1,
        superviseIntervalSeconds: 1,
      },
      connectionString: fixture.appUrl,
      instanceId,
      onFatalError: (error) => signalFatal?.(error),
    });
    const owner = await fixture.connectAsOwner();
    try {
      await runtime.start();
      await expect(
        checkPgBossReadiness(fixture.appUrl, instanceId, new Date(), 120_000),
      ).resolves.toBe(true);

      const before = await owner.query<{ monitor_on: Date }>(
        "SELECT monitor_on FROM pgboss.queue WHERE name = 'member-sync'",
      );
      await owner.query("REVOKE SELECT ON TABLE pgboss.schedule FROM ledger_app");
      await expect(Promise.race([
        fatal,
        new Promise((_, reject) => setTimeout(() => reject(new Error("scheduler failure was not promoted")), 8_000)),
      ])).resolves.toBeInstanceOf(Error);

      await expect(
        checkPgBossReadiness(fixture.appUrl, instanceId, new Date(), 120_000),
      ).resolves.toBe(false);
      await expect(waitFor(async () => {
        const after = await owner.query<{ monitor_on: Date }>(
          "SELECT monitor_on FROM pgboss.queue WHERE name = 'member-sync'",
        );
        expect(after.rows[0]?.monitor_on.getTime()).toBeGreaterThan(
          before.rows[0]?.monitor_on.getTime() ?? 0,
        );
      })).resolves.toBeUndefined();
    } finally {
      await owner.query("GRANT SELECT ON TABLE pgboss.schedule TO ledger_app");
      await owner.end();
      await runtime.stop();
    }
  }, 150_000);

  it("promotes a fatal scheduler error even when persisting unhealthy state never settles", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    let signalFatal: ((error: unknown) => void) | undefined;
    const fatal = new Promise<unknown>((resolve) => {
      signalFatal = resolve;
    });
    let shutdown: Promise<void> | undefined;
    let runtime = createWorkerRuntime({
      backgroundIntervals: {
        cronMonitorIntervalSeconds: 1,
        monitorIntervalSeconds: 1,
        superviseIntervalSeconds: 1,
      },
      connectionString: fixture.appUrl,
      fatalHealthWriteTimeoutMs: 5,
      instanceId: `blocked-health-${randomUUID()}`,
      onFatalError: (error) => {
        signalFatal?.(error);
        shutdown = runtime.stop();
        return shutdown;
      },
    });
    const blocker = await fixture.connectAsOwner();
    const administrator = await fixture.connectAsOwner();
    let lockHeld = false;
    try {
      await runtime.start();
      await blocker.query("BEGIN");
      await blocker.query(
        "LOCK TABLE pgboss.worker_runtime_health IN ACCESS EXCLUSIVE MODE",
      );
      lockHeld = true;
      await administrator.query(
        "REVOKE SELECT ON TABLE pgboss.schedule FROM ledger_app",
      );

      await expect(Promise.race([
        fatal,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("blocked health write prevented fatal promotion")),
          8_000,
        )),
      ])).resolves.toBeInstanceOf(Error);
      expect(shutdown).toBeDefined();

      await blocker.query("ROLLBACK");
      lockHeld = false;
      await expect(shutdown).resolves.toBeUndefined();
    } finally {
      if (lockHeld) await blocker.query("ROLLBACK");
      await administrator.query(
        "GRANT SELECT ON TABLE pgboss.schedule TO ledger_app",
      );
      await Promise.all([blocker.end(), administrator.end()]);
      await runtime.stop();
    }
  }, 150_000);
});

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
