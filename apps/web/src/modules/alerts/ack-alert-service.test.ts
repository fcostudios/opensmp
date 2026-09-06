import { randomUUID } from "node:crypto";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LedgerAuthorization } from "../identity-access/authorization";
import {
  ackAlertWithAuthorization,
  createAckAlertAction,
} from "./ack-alert-service";

let fixture: PostgresFixture;
let readPool: pg.Pool;

const ids = {
  actor: "00000000-0000-4000-8000-000000004401",
  companyA: "00000000-0000-4000-8000-000000004402",
  ruleA: "00000000-0000-4000-8000-000000004403",
};

function authorization(
  companyIds: readonly string[],
  globalRole: LedgerAuthorization["globalRole"] = null,
): LedgerAuthorization {
  return {
    companyGrants: companyIds.map((companyId) => ({
      companyId,
      role: "viewer" as const,
    })),
    companyIds,
    employeeCompanyId: null,
    globalRole,
    idpSubject: "alert-actions-reader",
    roles: globalRole === "group_admin" ? ["group_admin"] : ["viewer"],
    userAccountId: ids.actor,
    userId: ids.actor,
  };
}

async function seedAlertEvent(): Promise<string> {
  const id = randomUUID();
  await readPool.query(
    `INSERT INTO alert_event (id, alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
     VALUES ($1, $2, now(), $3::jsonb, '{"status":"pending"}'::jsonb, $4)`,
    [id, ids.ruleA, JSON.stringify({ requestId: ids.companyA }), `actions-test-${id}`],
  );
  return id;
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();

  const owner = await fixture.connectAsOwner();
  try {
    await owner.query(
      `INSERT INTO company (id, name, code, type, status, created_at, created_by)
       VALUES ($1, 'Actions Test Co', 'ACT-043', 'internal', 'active', now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.companyA],
    );
    await owner.query(
      `INSERT INTO alert_rule
         (id, type, scope_kind, company_id, threshold, channel, enabled, created_at, created_by)
       VALUES ($2, 'low_pool', 'company', $1, '{"floor":2}', 'email', true, now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.companyA, ids.ruleA],
    );
    // alert_event.acknowledged_by and audit_log.actor_user_id both carry a
    // FOREIGN KEY REFERENCES user_account(id), so the acknowledging actor
    // must already exist (same requirement as repository.integration.test.ts).
    await owner.query(
      `INSERT INTO user_account
         (id, email, idp_subject, status, created_at, created_by)
       VALUES ($1, 'actions-actor@account.example', 'actions-actor', 'active', now(), '00000000-0000-0000-0000-000000000001')
       ON CONFLICT (id) DO NOTHING`,
      [ids.actor],
    );
  } finally {
    await owner.end();
  }

  readPool = new pg.Pool({ connectionString: fixture.appUrl });
}, 120_000);

afterAll(async () => {
  await readPool?.end();
  await fixture?.stop();
});

describe("ackAlertWithAuthorization", () => {
  it("threads a real group_admin authorization into a real repository call and acknowledges the row", async () => {
    const event = await seedAlertEvent();

    const result = await ackAlertWithAuthorization(
      { alertEventId: event },
      {
        authorization: authorization([ids.companyA], "group_admin"),
        databaseUrl: fixture.appUrl,
        now: () => new Date("2026-09-06T18:00:00.000Z"),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ackAlert to succeed");
    expect(result.acknowledgedBy).toBe(ids.actor);
    expect(typeof result.acknowledgedAt).toBe("string");

    const row = await readPool.query<{
      acknowledged_by: string;
      acknowledged_at: Date;
    }>(
      "SELECT acknowledged_by::text, acknowledged_at FROM alert_event WHERE id = $1",
      [event],
    );
    expect(row.rows[0]!.acknowledged_by).toBe(ids.actor);
    expect(row.rows[0]!.acknowledged_at.toISOString()).toBe(result.acknowledgedAt);
  });

  it("returns forbidden for a non-admin authorization and never reaches the repository", async () => {
    const event = await seedAlertEvent();

    const result = await ackAlertWithAuthorization(
      { alertEventId: event },
      {
        authorization: authorization([ids.companyA], "central_finance"),
        databaseUrl: fixture.appUrl,
        now: () => new Date("2026-09-06T18:00:00.000Z"),
      },
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    const row = await readPool.query<{ acknowledged_at: Date | null }>(
      "SELECT acknowledged_at FROM alert_event WHERE id = $1",
      [event],
    );
    expect(row.rows[0]!.acknowledged_at).toBeNull();
  });

  it("rejects an empty database URL before persistence", async () => {
    await expect(
      ackAlertWithAuthorization(
        { alertEventId: randomUUID() },
        {
          authorization: authorization([ids.companyA], "group_admin"),
          databaseUrl: "",
        },
      ),
    ).rejects.toThrow("DATABASE_URL is required");
  });

  it("uses the current time when no clock override is supplied", async () => {
    const event = await seedAlertEvent();
    const before = Date.now();

    const result = await ackAlertWithAuthorization(
      { alertEventId: event },
      {
        authorization: authorization([ids.companyA], "group_admin"),
        databaseUrl: fixture.appUrl,
      },
    );
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ackAlert to succeed");
    const acknowledgedAt = Date.parse(result.acknowledgedAt);
    expect(acknowledgedAt).toBeGreaterThanOrEqual(before);
    expect(acknowledgedAt).toBeLessThanOrEqual(after);
  });
});

describe("createAckAlertAction", () => {
  it("rejects a missing database URL before loading authorization", async () => {
    let loaderCalls = 0;
    const action = createAckAlertAction({
      databaseUrl: () => undefined,
      loadAuthorization: async () => {
        loaderCalls += 1;
        return authorization([ids.companyA], "group_admin");
      },
    });

    await expect(action({ alertEventId: randomUUID() })).rejects.toThrow(
      "DATABASE_URL is required",
    );
    expect(loaderCalls).toBe(0);
  });

  it("returns the exact forbidden result for an unauthenticated caller", async () => {
    const action = createAckAlertAction({
      databaseUrl: () => fixture.appUrl,
      loadAuthorization: async () => null,
    });

    await expect(action({ alertEventId: randomUUID() })).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("forwards authorization, database URL, and the fixed clock to the real service", async () => {
    const event = await seedAlertEvent();
    const action = createAckAlertAction({
      databaseUrl: () => fixture.appUrl,
      loadAuthorization: async () => authorization([ids.companyA], "group_admin"),
      now: () => new Date("2026-09-06T19:00:00.000Z"),
    });

    const result = await action({ alertEventId: event });

    expect(result).toEqual({
      ok: true,
      acknowledgedBy: ids.actor,
      acknowledgedAt: "2026-09-06T19:00:00.000Z",
    });
  });

  it("propagates an authorization-loader failure without touching persistence", async () => {
    const failure = new Error("authorization unavailable");
    const action = createAckAlertAction({
      databaseUrl: () => fixture.appUrl,
      loadAuthorization: async () => {
        throw failure;
      },
    });

    await expect(action({ alertEventId: randomUUID() })).rejects.toBe(failure);
  });
});
