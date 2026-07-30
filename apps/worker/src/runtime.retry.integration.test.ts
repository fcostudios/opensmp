import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { successfulJob } from "@smp/domain";
import pg from "pg";

import { once } from "node:events";

import { createSmtpMailer } from "@smp/notifications";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../packages/db/src/testing/postgres-container.js";
import { SMTPServer } from "smtp-server";
import { createWorkerRuntime, type WorkerRuntime } from "./runtime.js";

let fixture: PostgresFixture;

async function queryAsOwner<T extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<T>> {
  const owner = await fixture.connectAsOwner();
  try {
    return await owner.query<T>(text, values);
  } finally {
    await owner.end();
  }
}

async function waitFor(assertion: () => Promise<void>, timeoutMs = 18_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError;
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
}, 120_000);

afterAll(async () => {
  await fixture.stop();
});

describe("US-046 pg-boss retry behavior", () => {
  it("records the operational alert once and reaches completed state after a real retry", async () => {
    const smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ["AUTH", "STARTTLS"],
      onData(stream, _session, callback) {
        stream.on("data", () => undefined);
        stream.on("end", callback);
      },
    });
    smtp.listen(0, "127.0.0.1");
    await once(smtp.server, "listening");
    const address = smtp.server.address();
    if (!address || typeof address === "string") throw new Error("SMTP port unavailable");
    const logs: object[] = [];
    let attempts = 0;
    let runtime: WorkerRuntime | undefined;
    try {
      runtime = createWorkerRuntime({
        connectionString: fixture.appUrl,
        handlers: {
          analyticsSync: async () => {
            attempts += 1;
            if (attempts === 1) throw Object.assign(new Error("vendor credentials rejected"), { code: "AUTH_FAILED" });
            return successfulJob(1);
          },
        },
        logger: { write: (entry) => logs.push(entry) },
        notificationMailer: createSmtpMailer(`smtp://127.0.0.1:${address.port}`),
      });
      await runtime.start();
      const jobId = await runtime.enqueue("analyticsSync", new Date("2026-07-25T14:00:00.000Z"), {
        vendorAccountId: "00000000-0000-0000-0000-000000000710",
      });

      expect(jobId).toMatch(/[0-9a-f-]{36}/);
      await waitFor(async () => {
        const state = await queryAsOwner<{ retry_count: number; retry_limit: number; state: string }>(
          "SELECT state::text, retry_count, retry_limit FROM pgboss.job WHERE id = $1",
          [jobId],
        );
        expect(state.rows).toEqual([{ retry_count: 1, retry_limit: 3, state: "completed" }]);
      });

      expect(attempts).toBe(2);
      await expect(queryAsOwner("SELECT count(*)::int AS count FROM alert_event")).resolves.toMatchObject({
        rows: [{ count: 1 }],
      });
      expect(logs).toContainEqual(expect.objectContaining({ attempt: 1, errorCode: "AUTH_FAILED", status: "failed" }));
      expect(logs).toContainEqual(expect.objectContaining({ attempt: 2, processed: 1, status: "succeeded" }));
    } finally {
      await runtime?.stop();
      await new Promise<void>((resolve, reject) => {
        smtp.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 45_000);
});
