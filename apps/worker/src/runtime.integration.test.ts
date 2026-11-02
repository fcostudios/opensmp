import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import * as schema from "@smp/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../packages/db/src/testing/postgres-container.js";
import { encryptCredential } from "@smp/db/credential-crypto";
import { serializeCredentialEnvelope } from "@smp/domain";
import type { WorkerRuntime } from "./runtime.js";

type RuntimeModule = typeof import("./runtime.js");

let createWorkerRuntime: RuntimeModule["createWorkerRuntime"];
let resolveCredentialKekFile: RuntimeModule["resolveCredentialKekFile"];
let resolveWorkerSleep: RuntimeModule["resolveWorkerSleep"];
let PG_BOSS_RUNTIME_SECURITY: RuntimeModule["PG_BOSS_RUNTIME_SECURITY"];

let fixture: PostgresFixture;
let appConnectionString: string;
let privateRoot: string;
let credentialKekFile: string;

beforeEach(async () => {
  // Runtime schedules are initialized at module load, so load them after
  // Stryker activates the current static mutant.
  vi.resetModules();
  ({
    createWorkerRuntime,
    resolveCredentialKekFile,
    resolveWorkerSleep,
    PG_BOSS_RUNTIME_SECURITY,
  } = await import("./runtime.js"));
});

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

async function seedLifecycleNotification(): Promise<string> {
  await queryAsOwner(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ('46000000-0000-4000-8000-000000000001','runtime-admin@ledger.test',
        'runtime-admin','group_admin','en','active','2026-07-29T12:00:00Z'),
       ('46000000-0000-4000-8000-000000000002','runtime-requester@ledger.test',
        'runtime-requester',NULL,'en','active','2026-07-29T12:00:00Z');
     INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ('46000000-0000-4000-8000-000000000003','Runtime Company','RUN',
             'internal','active','en','2026-07-29T12:00:00Z',
             '46000000-0000-4000-8000-000000000001');
     INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ('46000000-0000-4000-8000-000000000004',
             'runtime-requester@ledger.test','Runtime Requester',
             '46000000-0000-4000-8000-000000000003','active',
             '2026-07-29T12:00:00Z','46000000-0000-4000-8000-000000000001');
     UPDATE user_account
     SET person_id='46000000-0000-4000-8000-000000000004'
     WHERE id='46000000-0000-4000-8000-000000000002';
     INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,
        can_deprovision,has_usage_data,has_cost_data,identity_matching,status,
        created_at,created_by)
     VALUES ('46000000-0000-4000-8000-000000000005','Runtime Vendor',
             'orchestration','none',false,false,false,false,'email','active',
             '2026-07-29T12:00:00Z','46000000-0000-4000-8000-000000000001');
     INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ('46000000-0000-4000-8000-000000000006',
             '46000000-0000-4000-8000-000000000005','Runtime Account',
             'orchestration',1,'active','2026-07-29T12:00:00Z',
             '46000000-0000-4000-8000-000000000001');
     INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ('46000000-0000-4000-8000-000000000007',
             '46000000-0000-4000-8000-000000000005','Runtime Seat','seat',
             'active','2026-07-29T12:00:00Z',
             '46000000-0000-4000-8000-000000000001');
     INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,requested_by,created_at,created_by,updated_at)
     VALUES ('46000000-0000-4000-8000-000000000008','SOL-RUNTIME',
             '46000000-0000-4000-8000-000000000004',
             '46000000-0000-4000-8000-000000000003',
             '46000000-0000-4000-8000-000000000006',
             '46000000-0000-4000-8000-000000000007','pending_approval',
             'Runtime assurance','46000000-0000-4000-8000-000000000002',
             '2026-07-29T12:00:00Z','46000000-0000-4000-8000-000000000001',
             '2026-07-29T12:00:00Z');
     INSERT INTO system_setting (key,value,updated_at,updated_by)
     VALUES ('notif_sender_email','"notifications@ledger.test"'::jsonb,
             '2026-07-29T12:00:00Z','46000000-0000-4000-8000-000000000001')
     ON CONFLICT (key) DO NOTHING;
     INSERT INTO lifecycle_notification
       (id,request_id,company_id,kind,recipient_user_account_id,recipient_email,
        recipient_locale,request_state,dedupe_key,created_at)
     VALUES ('46000000-0000-4000-8000-000000000009',
             '46000000-0000-4000-8000-000000000008',
             '46000000-0000-4000-8000-000000000003','submission',
             '46000000-0000-4000-8000-000000000002',
             'runtime-requester@ledger.test','en','pending_approval',
             'runtime:submission','2026-07-29T12:00:00Z')`,
  );
  return "46000000-0000-4000-8000-000000000009";
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  appConnectionString = fixture.appUrl;
  privateRoot = await mkdtemp(join(tmpdir(), "ledger-runtime-"));
  credentialKekFile = join(privateRoot, "credential-kek");
  await writeFile(credentialKekFile, `${Buffer.alloc(32).toString("base64")}\n`, "utf8");
  await chmod(credentialKekFile, 0o400);
  await queryAsOwner(
    `INSERT INTO close_run (period, status, started_at, finished_at, created_at)
     VALUES
       ('2026-06', 'succeeded', '2026-07-03T15:00:00Z', '2026-07-03T15:01:00Z', '2026-07-03T15:00:00Z'),
       ('2026-08', 'succeeded', '2026-09-03T15:00:00Z', '2026-09-03T15:01:00Z', '2026-09-03T15:00:00Z'),
       ('2026-09', 'succeeded', '2026-10-05T15:00:00Z', '2026-10-05T15:01:00Z', '2026-10-05T15:00:00Z')`,
  );
}, 120_000);

afterAll(async () => {
  await fixture.stop();
  if (privateRoot) await rm(privateRoot, { recursive: true });
});

describe("US-046 worker runtime with real PostgreSQL", () => {
  it("resolves the injected or environmental KEK path and rejects blank configuration", () => {
    expect(resolveCredentialKekFile(undefined, {})).toBeUndefined();
    expect(resolveCredentialKekFile("/run/ledger-secrets/credential-kek", {}))
      .toBe("/run/ledger-secrets/credential-kek");
    expect(resolveCredentialKekFile(undefined, {
      LEDGER_CREDENTIAL_KEK_FILE: "  /run/ledger-secrets/from-env  ",
    })).toBe("/run/ledger-secrets/from-env");
    expect(() => resolveCredentialKekFile("   ", {})).toThrow("must not be blank");
  });

  it("preserves an injected rate-limit sleeper instead of substituting the production delay", async () => {
    const sleeper = async () => undefined;

    expect(resolveWorkerSleep(sleeper)).toBe(sleeper);
    expect(resolveWorkerSleep(undefined)).toEqual(expect.any(Function));
  });

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
      credentialKekAllowedRoot: privateRoot,
      credentialKekFile,
      logger: { write: (entry) => logs.push(entry) },
    });
    try {
      await runtime.start();

      const queues = await queryAsOwner<{ name: string; partition: boolean }>(
        "SELECT name, partition FROM pgboss.queue WHERE name = ANY($1) ORDER BY name",
        [["analytics-sync", "inactivity-flagging", "member-sync", "invite-poll", "alert-evaluation", "close-precheck", "capacity-recovery"]],
      );
      expect(queues.rows).toEqual([
        { name: "alert-evaluation", partition: false },
        { name: "analytics-sync", partition: false },
        { name: "capacity-recovery", partition: false },
        { name: "close-precheck", partition: false },
        { name: "inactivity-flagging", partition: false },
        { name: "invite-poll", partition: false },
        { name: "member-sync", partition: false },
      ]);

      const schedules = await queryAsOwner<{ cron: string; name: string; timezone: string }>(
        "SELECT name, cron, timezone FROM pgboss.schedule ORDER BY name",
      );
      expect(schedules.rows).toEqual([
        { cron: "7,22,37,52 * * * *", name: "alert-evaluation", timezone: "UTC" },
        { cron: "15 10 * * *", name: "analytics-sync", timezone: "UTC" },
        { cron: "* * * * *", name: "capacity-recovery", timezone: "UTC" },
        { cron: "30 10 * * 1-5", name: "close-precheck", timezone: "UTC" },
        { cron: "45 10 * * *", name: "inactivity-flagging", timezone: "UTC" },
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

  it("dispatches daily inactivity flagging through pg-boss and replays the same key without duplicate evidence", async () => {
    const dailyFixture = await createPostgresFixture();
    let runtime: WorkerRuntime | undefined;
    let owner: pg.Client | undefined;
    const at = new Date("2026-10-10T10:45:00Z");
    const flagId = (n: number) => `00000000-0000-4000-8000-${String(741000 + n).padStart(12, "0")}`;
    const logs: Array<{ jobId?: string; processed?: number; status?: string }> = [];
    try {
      await dailyFixture.migrate();
      owner = await dailyFixture.connectAsOwner();
      const db = drizzle(owner, { schema });
      const authored = { createdAt: at, createdBy: flagId(1) };
      await db.insert(schema.userAccount).values({ id: flagId(1), email: "daily@test.invalid", idpSubject: "daily", status: "active", createdAt: at });
      await db.insert(schema.company).values([2,3].map(n => ({ id: flagId(n), name: `Daily${n}`, code: `D${n}`, type: "internal" as const, status: "active" as const, ...authored })));
      await db.insert(schema.vendor).values({ id: flagId(4), name: "Daily Vendor", connectorType: "orchestration", provisioningProtocol: "none", canProvision: false, canDeprovision: false, hasUsageData: true, hasCostData: false, identityMatching: "email", status: "active", ...authored });
      await db.insert(schema.vendorAccount).values({ id: flagId(5), vendorId: flagId(4), name: "Daily Account", mode: "orchestration", lowPoolFloor: 1, status: "active", ...authored });
      await db.insert(schema.licenseType).values({ id: flagId(6), vendorId: flagId(4), name: "Seat", unit: "seat", status: "active", ...authored });
      for (const n of [1,2,3]) {
        const companyId = flagId(n === 3 ? 3 : 2);
        await db.insert(schema.person).values({ id: flagId(10+n), companyId, email: `daily${n}@test.invalid`, fullName: `Daily${n}`, status: "active", ...authored });
        await db.insert(schema.licenseRequest).values({ id: flagId(20+n), requestNo: `DAILY${n}`, personId: flagId(10+n), companyId, vendorAccountId: flagId(5), licenseTypeId: flagId(6), state: "active", justification: "fixture", ...authored });
        await db.insert(schema.licenseAssignment).values({ id: flagId(30+n), personId: flagId(10+n), companyId, vendorAccountId: flagId(5), licenseTypeId: flagId(6), sourceRequestId: flagId(20+n), startedOn: "2026-08-01", sourceKind: "import", ...authored });
      }
      await db.insert(schema.activityRecord).values([
        { personId: flagId(11), vendorAccountId: flagId(5), activityDate: "2026-09-06", counters: { chat_metrics: { message_count: 1 } }, syncedAt: at, source: "manual" },
        { personId: flagId(12), vendorAccountId: flagId(5), activityDate: "2026-09-08", counters: { chat_metrics: { message_count: 1 } }, syncedAt: at, source: "manual" },
        { personId: flagId(12), vendorAccountId: flagId(5), activityDate: "2026-10-07", counters: {}, syncedAt: at, source: "manual" },
      ]);
      runtime = createWorkerRuntime({ connectionString: dailyFixture.appUrl, logger: { write: entry => logs.push(entry) } });
      await runtime.start();
      expect((await owner.query("SELECT cron,timezone FROM pgboss.schedule WHERE name='inactivity-flagging'")).rows).toEqual([{ cron: "45 10 * * *", timezone: "UTC" }]);
      const first = (await owner.query("INSERT INTO pgboss.job(name,data) VALUES('inactivity-flagging',jsonb_build_object('at',$1::text,'source','schedule')) RETURNING id", [at.toISOString()])).rows[0].id;
      const assertComplete = async (jobId: string, processed: number) => {
        await waitFor(async () => {
          expect((await owner!.query("SELECT state FROM pgboss.job WHERE id=$1", [jobId])).rows).toEqual([{ state: "completed" }]);
          expect(logs).toContainEqual(expect.objectContaining({ jobId, processed, status: "succeeded" }));
        });
      };
      await assertComplete(first, 1);
      expect((await owner.query("SELECT state FROM license_request WHERE company_id=$1 ORDER BY id", [flagId(2)])).rows).toEqual([{ state: "flagged_inactive" }, { state: "active" }]);
      expect((await owner.query("SELECT state FROM license_request WHERE company_id=$1", [flagId(3)])).rows).toEqual([{ state: "active" }]);
      expect((await owner.query("SELECT from_state,to_state,actor_user_id,occurred_at FROM request_transition WHERE request_id=$1", [flagId(21)])).rows).toEqual([{ from_state: "active", to_state: "flagged_inactive", actor_user_id: null, occurred_at: at }]);
      const audit = (await owner.query("SELECT action,actor_user_id,before,after,occurred_at FROM audit_log WHERE company_id=$1 AND entity_id=$2", [flagId(2),flagId(21)])).rows;
      expect(audit).toEqual([{ action: "request.flagged_inactive", actor_user_id: null, before: { state: "active" }, after: { state: "flagged_inactive" }, occurred_at: at }]);
      const replay = await runtime.enqueue("inactivityFlagging", new Date("2026-10-10T23:00:00Z"));
      expect(replay).toEqual(expect.any(String));
      // Assert the persisted queue throttling period independently of our
      // runtime's constant, against the timestamp of this actual DB insertion.
      const bucket = (await owner.query("SELECT extract(epoch FROM singleton_on)::bigint AS singleton_epoch,floor(extract(epoch FROM created_on))::bigint AS created_epoch FROM pgboss.job WHERE id=$1", [replay])).rows[0];
      expect(Number(bucket.singleton_epoch)).toBe(Math.floor(Number(bucket.created_epoch) / 172800) * 172800);
      await assertComplete(replay!, 0);
      expect((await owner.query("SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1", [flagId(21)])).rows[0].count).toBe(1);
      expect((await owner.query("SELECT action,actor_user_id,before,after,occurred_at FROM audit_log WHERE company_id=$1 AND entity_id=$2", [flagId(2),flagId(21)])).rows).toEqual(audit);
      expect((await owner.query("SELECT job_name,status,result FROM pgboss.worker_job_execution WHERE idempotency_key='inactivity-flagging:2026-10-10'")).rows).toEqual([{ job_name: "inactivityFlagging", status: "succeeded", result: { processed: 1, status: "succeeded" } }]);
      expect((await owner.query("SELECT (SELECT count(*)::int FROM reclamation_proposal) AS proposals,(SELECT count(*)::int FROM provisioning_action) AS actions")).rows[0]).toEqual({ proposals: 0, actions: 0 });
      expect((await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE company_id=$1", [flagId(3)])).rows[0].count).toBe(0);
    } finally {
      await runtime?.stop(); await owner?.end(); await dailyFixture.stop();
    }
  }, 120_000);

  it("runs exactly one implemented alert job for a repeated idempotency key", async () => {
    const logs: object[] = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      credentialKekAllowedRoot: privateRoot,
      credentialKekFile,
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
            status: "succeeded",
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
      ["capacityRecovery", {}],
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
            "capacity-recovery",
          ]),
        );
        expect(logs).toHaveLength(6);
      });
    } finally {
      await runtime.stop();
    }
  }, 15_000);

  it("persists capacity-recovery singleton slots on exact five-minute boundaries", async () => {
    const runtime = createWorkerRuntime({ connectionString: appConnectionString });
    try {
      await runtime.start();
      const jobId = await runtime.enqueue(
        "capacityRecovery",
        new Date("2026-09-17T16:47:00.000Z"),
      );
      expect(jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      await expect(
        queryAsOwner<{ slot_remainder: number }>(
          `SELECT mod(extract(epoch FROM singleton_on)::bigint, 300)::int AS slot_remainder
           FROM pgboss.job WHERE id=$1`,
          [jobId],
        ),
      ).resolves.toEqual(expect.objectContaining({
        rows: [{ slot_remainder: 0 }],
      }));
    } finally {
      await runtime.stop();
    }
  });

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

  it("delivers each cron-shaped payload to its handler with a scheduled coordinator key", async () => {
    const logs: Array<{ id?: string; jobId?: string; jobName?: string; status?: string }> = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      calendar: { holidays: new Set(["2026-08-03"]) },
      credentialKekAllowedRoot: privateRoot,
      credentialKekFile,
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
          "capacity-recovery",
          "inactivity-flagging",
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
      expect(jobIds).toHaveLength(7);

      await waitFor(async () => {
        const jobs = await queryAsOwner<{ state: string }>(
          "SELECT state FROM pgboss.job WHERE id = ANY($1::uuid[])",
          [jobIds],
        );
        expect(jobs.rows).toHaveLength(7);
        expect(jobs.rows.every(({ state }) => state === "completed")).toBe(true);
        for (const jobId of jobIds) {
          expect(logs.filter((entry) => entry.jobId === jobId)).toHaveLength(1);
        }
        expect(logs).toContainEqual(expect.objectContaining({
          jobId: jobIds[0],
          jobName: "analytics-sync",
          processed: 0,
          status: "succeeded",
        }));
        expect(logs).toContainEqual(expect.objectContaining({
          jobId: jobIds[3],
          processed: 0,
          status: "succeeded",
        }));
        expect(logs).toContainEqual(expect.objectContaining({
          jobId: jobIds[2],
          processed: 0,
          status: "succeeded",
        }));
        expect(logs).toContainEqual(expect.objectContaining({jobId:jobIds[4],jobName:"close-precheck",processed:0,status:"succeeded"}));
        expect(logs.filter(({jobId,status})=>jobId===jobIds[1]&&status==="skipped")).toHaveLength(1);
      });
      expect((await queryAsOwner(`SELECT job_name,status,result FROM pgboss.worker_job_execution WHERE idempotency_key='close-precheck:2026-08-05'`)).rows).toEqual([{job_name:"closePrecheck",status:"succeeded",result:{processed:0,status:"succeeded"}}]);
      const analyticsExecution = await queryAsOwner(
        `SELECT job_name, status, result FROM pgboss.worker_job_execution
         WHERE idempotency_key = 'analytics-sync:scheduled:2026-08-05'`,
      );
      expect(analyticsExecution.rows).toEqual([{
        job_name: "analyticsSync",
        status: "succeeded",
        result: { processed: 0, status: "succeeded" },
      }]);
    } finally {
      await runtime.stop();
    }
  });

  it("runs the quarter-hour invite poll through pg-boss with the supplied runtime dependencies", async () => {
    const at = new Date("2026-09-09T04:30:00.000Z");
    const id = (suffix: string) => `46700000-0000-4000-8000-${suffix.padStart(12, "0")}`;
    const ids = {
      account: id("7"), action: id("12"), admin: id("1"), company: id("2"),
      license: id("9"), person: id("4"), request: id("10"), vendor: id("6"),
    };
    const kek = new Uint8Array(32);
    const owner = await fixture.connectAsOwner();
    try {
      const adminCredential = serializeCredentialEnvelope(await encryptCredential("runtime-admin-secret", kek));
      const analyticsCredential = serializeCredentialEnvelope(await encryptCredential("runtime-analytics-secret", kek));
      await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,ui_language,status,created_at)
        VALUES ($1,'runtime-poll-admin@ledger.test','runtime-poll-admin','group_admin','en','active',$2)`, [ids.admin, at]);
      await owner.query(`INSERT INTO company (id,name,code,type,status,statement_language,created_at,created_by)
        VALUES ($1,'Runtime poll','RTPL','internal','active','en',$2,$3)`, [ids.company, at, ids.admin]);
      await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
        VALUES ($1,'accepted@runtime-poll.test','Accepted',$2,'active',$3,$4)`, [ids.person, ids.company, at, ids.admin]);
      await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
        VALUES ($1,'Runtime poll vendor','api','rest',true,true,true,true,'email','active',$2,$3)`, [ids.vendor, at, ids.admin]);
      await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
        VALUES ($1,$2,'Runtime poll account','automated',1,'active',$3,$4)`, [ids.account, ids.vendor, at, ids.admin]);
      await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
        VALUES ($1,$2,'Runtime poll seat','seat','active',$3,$4)`, [ids.license, ids.vendor, at, ids.admin]);
      await owner.query(`INSERT INTO license_request (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,created_at,created_by,updated_at)
        VALUES ($1,'RTPL-1',$2,$3,$4,$5,'provisioning','Runtime composition',$6,$7,$6)`,
      [ids.request, ids.person, ids.company, ids.account, ids.license, at, ids.admin]);
      await owner.query(`INSERT INTO provisioning_action (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
        VALUES ($1,$2,$3,'invite','automated','pending',$4::jsonb,$5)`, [
        ids.action, ids.request, ids.account,
        JSON.stringify({
          checklistSteps: [],
          context: { companyId: ids.company, requestId: ids.request },
          instruction: { licenseTypeName: "Runtime poll seat", personEmail: "accepted@runtime-poll.test", requestId: ids.request, vendorAccountId: ids.account },
          operation: "provision", protocol: "rest", version: 1,
        }),
        at,
      ]);
      await owner.query(`INSERT INTO integration_credential (vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by)
        VALUES ($1,'admin_scoped',$2,'ok','active',$4,$5),($1,'analytics',$3,'ok','active',$4,$5)`,
      [ids.account, adminCredential, analyticsCredential, at, ids.admin]);
    } finally {
      await owner.end();
    }

    const calls: string[] = [];
    const logs: Array<{ jobId?: string; processed?: number; status?: string }> = [];
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      credentialKekAllowedRoot: privateRoot,
      credentialKekFile,
      logger: { write: (entry) => logs.push(entry) },
      now: () => at,
      sleep: async () => undefined,
      transport: async (request) => {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname.endsWith("/invites")) {
          calls.push("invite");
          return new Response(JSON.stringify({ type: "invite", id: "runtime-invite", email: "accepted@runtime-poll.test", status: "pending" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (request.method === "GET" && url.pathname.endsWith("/users")) {
          calls.push("members");
          return new Response(JSON.stringify({ data: [{ type: "user", id: "runtime-user", name: "Accepted", email: "accepted@runtime-poll.test" }], has_more: false, first_id: "runtime-user", last_id: "runtime-user" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected provider request: ${request.method} ${url.pathname}`);
      },
    });
    try {
      await runtime.start();
      const jobId = await runtime.enqueue("invitePoll", at, { vendorAccountId: ids.account });
      expect(jobId).toMatch(/[0-9a-f-]{36}/);
      await waitFor(async () => {
        expect(logs).toContainEqual(expect.objectContaining({ jobId, processed: 2, status: "succeeded" }));
      }, 15_000);
    } finally {
      await runtime.stop();
    }
    expect(calls).toEqual(["invite", "members"]);
    await expect(queryAsOwner(`SELECT request.state,action.status,action.sent_at,transition.occurred_at,
      (SELECT count(*)::int FROM license_assignment assignment WHERE assignment.source_request_id=request.id) AS assignments
      FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
      JOIN request_transition transition ON transition.request_id=request.id AND transition.to_state='active'
      WHERE request.id=$1`, [ids.request])).resolves.toMatchObject({
      rows: [{ state: "active", status: "confirmed", sent_at: at, occurred_at: at, assignments: 1 }],
    });
    await waitFor(async () => {
      const sessions = await queryAsOwner<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE usename='ledger_app' AND application_name='ledger-worker'",
      );
      expect(sessions.rows).toEqual([{ count: "0" }]);
    });
  }, 30_000);

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
      const idempotencyKey = `analytics-sync:${execution.vendorAccountId}:2026-07-25`;
      await waitFor(async () => {
        const jobs = await queryAsOwner<{ id: string; state: string; vendor_account_id: string }>(
          `SELECT id, state, data->>'vendorAccountId' AS vendor_account_id
           FROM pgboss.job WHERE name = 'analytics-sync' AND singleton_key = $1`,
          [idempotencyKey],
        );
        expect(jobs.rows).toEqual([{
          id: first,
          state: "completed",
          vendor_account_id: execution.vendorAccountId,
        }]);
        expect(logs).toContainEqual(
          expect.objectContaining({
            jobId: first,
            jobName: "analytics-sync",
            processed: 0,
            status: "succeeded",
          }),
        );
      });
      const storedExecution = await queryAsOwner(
        `SELECT job_name, status, result FROM pgboss.worker_job_execution
         WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      expect(storedExecution.rows).toEqual([{
        job_name: "analyticsSync",
        status: "succeeded",
        result: { processed: 0, status: "succeeded" },
      }]);
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

  it("constructs one production lifecycle drain and closes its real PostgreSQL pool on normal shutdown", async () => {
    const notificationId = await seedLifecycleNotification();
    const lifecyclePool = new pg.Pool({ connectionString: appConnectionString });
    const send = vi.fn(async () => ({
      accepted: ["runtime-requester@ledger.test"],
      providerMessageId: "runtime-message",
    }));
    let clearCount = 0;
    let scheduleCount = 0;
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      lifecycleNotificationPool: lifecyclePool,
      lifecycleNotificationDrain: {
        clearIntervalFn: (() => {
          clearCount += 1;
        }) as typeof clearInterval,
        setIntervalFn: (() => {
          scheduleCount += 1;
          return 1 as unknown as ReturnType<typeof setInterval>;
        }) as typeof setInterval,
      },
      notificationMailer: { send },
      publicOrigin: "https://ledger.test",
    });

    try {
      await runtime.start();
      await runtime.start();
      await waitFor(async () => {
        const deliveries = await queryAsOwner<{ phase: string }>(
          `SELECT phase::text
           FROM lifecycle_notification_delivery
           WHERE notification_id=$1 AND phase='succeeded'`,
          [notificationId],
        );
        expect(deliveries.rows).toEqual([{ phase: "succeeded" }]);
      });
      expect(scheduleCount).toBe(1);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      await runtime.stop();
    }

    await expect(lifecyclePool.query("SELECT 1")).rejects.toThrow(
      "Cannot use a pool after calling end on the pool",
    );
    expect(clearCount).toBe(1);
  });

  it("closes pg-boss after a partial startup failure before rethrowing", async () => {
    await queryAsOwner("REVOKE EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) FROM ledger_app");
    const lifecyclePool = new pg.Pool({ connectionString: appConnectionString });
    const runtime = createWorkerRuntime({
      connectionString: appConnectionString,
      lifecycleNotificationPool: lifecyclePool,
    });
    try {
      await expect(runtime.start()).rejects.toThrow("permission denied");
      await runtime.stop();
      await expect(lifecyclePool.query("SELECT 1")).rejects.toThrow(
        "Cannot use a pool after calling end on the pool",
      );

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
