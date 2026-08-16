import { randomUUID } from "node:crypto";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { createAlertNotificationOutbox } from "@smp/notifications";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ackAlertPolicy } from "./ack-alert-policy";
import { createAlertRepository } from "./repository";
import {
  listAuthorizedAlertEvents,
  parseAlertCursor,
  serializeAlertCursor,
} from "../operational-alert-read";
import type { LedgerAuthorization } from "../identity-access/authorization";

let fixture: PostgresFixture;
let readPool: pg.Pool;

const ids = {
  companyA: "00000000-0000-4000-8000-000000004201",
  companyB: "00000000-0000-4000-8000-000000004202",
  ruleA: "00000000-0000-4000-8000-000000004211",
  ruleB: "00000000-0000-4000-8000-000000004212",
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
    idpSubject: "alert-reader",
    roles: globalRole === "group_admin" ? ["group_admin"] : ["viewer"],
    userAccountId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000001",
  };
}

async function seedAlertEvent(ruleId: string, companyId: string): Promise<string> {
  const id = randomUUID();
  await readPool.query(
    `INSERT INTO alert_event (id, alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
     VALUES ($1, $2, now(), $3::jsonb, '{"status":"pending"}'::jsonb, $4)`,
    [id, ruleId, JSON.stringify({ requestId: companyId }), `ack-test-${id}`],
  );
  return id;
}

async function companyEvents(
  repository: ReturnType<typeof createAlertRepository>,
  companyId: string,
) {
  return (
    await repository.listAuthorizedEvents(authorization([companyId]), {
      filter: "all",
      limit: 100,
    })
  ).items;
}

async function ownerQuery(text: string, values: unknown[] = []): Promise<void> {
  const client = await fixture.connectAsOwner();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  const mutationAppUrl = process.env.US042_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US042_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("US-042 mutation harness requires both database URLs");
    }
    fixture = {
      appUrl: mutationAppUrl,
      databaseName: new URL(mutationOwnerUrl).pathname.slice(1),
      ownerUrl: mutationOwnerUrl,
      async connectAsApp() {
        const client = new pg.Client({ connectionString: mutationAppUrl });
        await client.connect();
        return client;
      },
      async connectAsOwner() {
        const client = new pg.Client({ connectionString: mutationOwnerUrl });
        await client.connect();
        return client;
      },
      async migrate() {},
      async stop() {},
    };
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
  }
  await ownerQuery(
    `TRUNCATE TABLE alert_notification_delivery, alert_event
      RESTART IDENTITY CASCADE`,
  );
  await ownerQuery(
    `DELETE FROM alert_rule WHERE company_id IN ($1, $2)`,
    [ids.companyA, ids.companyB],
  );
  await ownerQuery(
    `DELETE FROM company WHERE id IN ($1, $2)`,
    [ids.companyA, ids.companyB],
  );
  await ownerQuery(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES
       ($1, 'Company A', 'A-042', 'internal', 'active', now(), '00000000-0000-0000-0000-000000000001'),
       ($2, 'Company B', 'B-042', 'external', 'active', now(), '00000000-0000-0000-0000-000000000001')`,
    [ids.companyA, ids.companyB],
  );
  await ownerQuery(
    `INSERT INTO alert_rule
       (id, type, scope_kind, company_id, threshold, channel, enabled, created_at, created_by)
     VALUES
       ($3, 'low_pool', 'company', $1, '{"floor":2}', 'email', true, now(), '00000000-0000-0000-0000-000000000001'),
       ($4, 'low_pool', 'company', $2, '{"floor":2}', 'email', true, now(), '00000000-0000-0000-0000-000000000001')`,
    [ids.companyA, ids.companyB, ids.ruleA, ids.ruleB],
  );
  // Seed the two acknowledgeEvent test actors: alert_event.acknowledged_by
  // and audit_log.actor_user_id both carry a FOREIGN KEY REFERENCES
  // user_account(id), so the acknowledging actor must already exist.
  // ON CONFLICT DO NOTHING (rather than DELETE + INSERT) keeps this safe to
  // rerun against the persistent US042_MUTATION_DATABASE_URL fixture, where
  // audit_log rows from a prior run FK-reference these same actor ids and
  // are not covered by the TRUNCATE above.
  const ackActorA = "00000000-0000-4000-8000-000000004301";
  const ackActorB = "00000000-0000-4000-8000-000000004302";
  await ownerQuery(
    `INSERT INTO user_account
       (id, email, idp_subject, status, created_at, created_by)
     VALUES
       ($1, 'ack-actor-1@account.example', 'ack-actor-1', 'active', now(), '00000000-0000-0000-0000-000000000001'),
       ($2, 'ack-actor-2@account.example', 'ack-actor-2', 'active', now(), '00000000-0000-0000-0000-000000000001')
     ON CONFLICT (id) DO NOTHING`,
    [ackActorA, ackActorB],
  );
  readPool = new pg.Pool({ connectionString: fixture.appUrl });
}, 120_000);

afterAll(async () => {
  await readPool?.end();
  await fixture?.stop();
});

describe("US-042 alert repository with real PostgreSQL", () => {
  it("closes both repository pools and exposes the count through the repository boundary", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    const scopedAuthorization = authorization([ids.companyA]);
    expect(await repository.countAuthorizedEvents(scopedAuthorization)).toEqual({
      all: BigInt(0),
      unacknowledged: BigInt(0),
    });

    await repository.close();

    await expect(
      repository.createEvent({
        alertRuleId: ids.ruleA,
        dedupeKey: `closed:${randomUUID()}`,
        firedAt: new Date("2026-07-29T12:00:00.000Z"),
        subjectRef: {
          licenseTypeId: "closed-license",
          vendorAccountId: "closed-account",
        },
      }),
    ).rejects.toThrow("Cannot use a pool after calling end on the pool");
    await expect(
      repository.countAuthorizedEvents(scopedAuthorization),
    ).rejects.toThrow("Cannot use a pool after calling end on the pool");
  });

  it("round-trips only deterministic valid alert cursors", () => {
    const event = {
      firedAt: new Date("2026-07-29T12:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000042",
    };
    expect(parseAlertCursor(serializeAlertCursor(event))).toEqual(event);
    expect(parseAlertCursor("not-a-cursor")).toBeNull();
    expect(parseAlertCursor("2026-07-29T12:00:00.000Z|not-a-uuid")).toBeNull();
  });

  it("derives global and company scope only from trusted authorization in one bounded read", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const eventA = await repository.createEvent({
        alertRuleId: ids.ruleA,
        dedupeKey: `authorized-a:${randomUUID()}`,
        firedAt: new Date("2026-07-29T12:00:00.000Z"),
        subjectRef: {
          licenseTypeId: "authorized-license",
          vendorAccountId: "authorized-account",
        },
      });
      await repository.createEvent({
        alertRuleId: ids.ruleB,
        dedupeKey: `authorized-b:${randomUUID()}`,
        firedAt: new Date("2026-07-29T12:01:00.000Z"),
        subjectRef: {
          licenseTypeId: "authorized-license",
          vendorAccountId: "authorized-account",
        },
      });
      await ownerQuery(
        `INSERT INTO alert_event
           (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
         SELECT id, '2026-07-29T12:02:00.000Z',
                '{"licenseTypeId":"authorized-license","vendorAccountId":"authorized-account"}',
                '{"status":"pending"}', $1
         FROM alert_rule
         WHERE scope_kind = 'global' AND type = 'low_pool'`,
        [`authorized-global:${randomUUID()}`],
      );
      const companyA = await listAuthorizedAlertEvents(
        readPool,
        authorization([ids.companyA]),
        { filter: "all", limit: 50 },
      );
      expect(companyA.items.every(({ companyId, scopeKind }) =>
        scopeKind === "company" && companyId === ids.companyA
      )).toBe(true);
      expect(companyA.items.some(({ companyId }) => companyId === ids.companyB)).toBe(false);
      expect(companyA.items.some(({ scopeKind }) => scopeKind === "global")).toBe(false);
      await ownerQuery(
        `UPDATE alert_event
         SET acknowledged_by = '00000000-0000-0000-0000-000000000001',
             acknowledged_at = now()
         WHERE id = $1`,
        [eventA.id],
      );
      const unacknowledged = await listAuthorizedAlertEvents(
        readPool,
        authorization([ids.companyA]),
        { filter: "unacknowledged", limit: 50 },
      );
      expect(unacknowledged.items.some(({ id }) => id === eventA.id)).toBe(false);

      const admin = await listAuthorizedAlertEvents(
        readPool,
        authorization([ids.companyA, ids.companyB], "group_admin"),
        { filter: "all", limit: 50 },
      );
      expect(admin.items.some(({ scopeKind }) => scopeKind === "global")).toBe(true);
      expect(admin.items.some(({ companyId }) => companyId === ids.companyA)).toBe(true);
      expect(admin.items.some(({ companyId }) => companyId === ids.companyB)).toBe(true);
    } finally {
      await repository.close();
    }
  });

  it("paginates a bounded authorized stream without duplicates at equal timestamps", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    const createdIds: string[] = [];
    try {
      for (let index = 0; index < 5; index += 1) {
        const created = await repository.createEvent({
          alertRuleId: ids.ruleA,
          dedupeKey: `cursor:${index}:${randomUUID()}`,
          firedAt: new Date("2026-07-29T14:00:00.000Z"),
          subjectRef: {
            licenseTypeId: `cursor-license-${index}`,
            vendorAccountId: "cursor-account",
          },
        });
        createdIds.push(created.id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await listAuthorizedAlertEvents(
          readPool,
          authorization([ids.companyA]),
          { cursor, filter: "all", limit: 2 },
        );
        seen.push(
          ...page.items
            .filter(({ id }) => createdIds.includes(id))
            .map(({ id }) => id),
        );
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(seen).size).toBe(5);
      expect(seen).toHaveLength(5);
    } finally {
      await repository.close();
    }
  });
  it("migrates the exact idempotent 10-rule seed through the system actor", async () => {
    const client = await fixture.connectAsOwner();
    try {
      const rules = await client.query<{
        created_by: string;
        enabled: boolean;
        threshold: unknown;
        type: string;
      }>(
        `SELECT type::text, threshold, enabled, created_by
         FROM alert_rule
         WHERE scope_kind = 'global'
         ORDER BY type`,
      );
      expect(rules.rows).toEqual([
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { escalationHours: 48, hours: 24 }, type: "approval_aging" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { businessDays: 1 }, type: "blocked_no_seat" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { businessDays: 3 }, type: "close_missed" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { failures: 1 }, type: "credential_failure" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { businessDays: 0 }, type: "deprovision_overdue" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { hours: 168 }, type: "invite_unaccepted" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { floor: 5 }, type: "low_pool" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { failures: 1 }, type: "provisioning_failure" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { mismatches: 1 }, type: "register_drift" },
        { created_by: "00000000-0000-0000-0000-000000000001", enabled: true, threshold: { hours: 48 }, type: "sync_stale" },
      ]);
    } finally {
      await client.end();
    }
  });

  it("turns concurrent duplicate inserts into one event and one replay", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    const input = {
      alertRuleId: ids.ruleA,
      dedupeKey: `${ids.ruleA}:breach:vendor-account-1:2026-07-27T15:00:00.000Z`,
      firedAt: new Date("2026-07-27T15:00:00.000Z"),
      subjectRef: { vendorAccountId: "vendor-account-1" },
    };
    try {
      const outcomes = await Promise.all([
        repository.createEvent(input),
        repository.createEvent({ ...input, firedAt: new Date(input.firedAt) }),
      ]);

      expect(outcomes.map(({ status }) => status).sort()).toEqual([
        "created",
        "replayed",
      ]);
      expect(outcomes.find(({ status }) => status === "replayed")).toMatchObject({
        postgresCode: "23505",
      });
      const client = new pg.Client({ connectionString: fixture.ownerUrl });
      await client.connect();
      try {
        const count = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM alert_event WHERE dedupe_key = $1",
          [input.dedupeKey],
        );
        expect(count.rows).toEqual([{ count: 1 }]);
        const pending = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM alert_notification_delivery delivery
           JOIN alert_event event ON event.id = delivery.alert_event_id
           WHERE event.dedupe_key = $1 AND delivery.phase = 'pending'`,
          [input.dedupeKey],
        );
        expect(pending.rows).toEqual([{ count: 1 }]);
      } finally {
        await client.end();
      }
    } finally {
      await repository.close();
    }
  });

  it("does not mistake a non-dedupe database error for a replay", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      await expect(
        repository.createEvent({
          alertRuleId: "00000000-0000-4000-8000-000000004299",
          dedupeKey: `missing-rule:${randomUUID()}`,
          firedAt: new Date("2026-07-27T15:00:00.000Z"),
          subjectRef: { vendorAccountId: "vendor-account-1" },
        }),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await repository.close();
    }
  });

  it("rejects a delivery claim when no pending outbox journal exists", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const owner = await fixture.connectAsOwner();
    try {
      const inserted = await owner.query<{ id: string }>(
        `INSERT INTO alert_event
           (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
         VALUES ($1, $2, '{"requestId":"missing-pending"}'::jsonb,
                 '{"status":"pending"}'::jsonb, $3)
         RETURNING id`,
        [
          ids.ruleA,
          new Date("2026-07-27T15:45:00.000Z"),
          `${ids.ruleA}:missing-pending:${randomUUID()}`,
        ],
      );
      await expect(
        outbox.claim({
          alertEventId: inserted.rows[0]!.id,
          at: new Date("2026-07-27T15:45:00.000Z"),
          leaseMs: 60_000,
          workerId: "worker-no-pending",
        }),
      ).rejects.toThrow("alert delivery has no pending outbox record");
    } finally {
      await Promise.all([outbox.close(), owner.end()]);
    }
  });

  it("serializes claims, recovers an expired crash lease, and derives sent status without mutating AlertEvent", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const repository = createAlertRepository(fixture.appUrl);
    const at = new Date("2026-07-27T16:00:00.000Z");
    try {
      const event = await outbox.enqueue({
        alertRuleId: ids.ruleA,
        dedupeKey: `${ids.ruleA}:breach:crash-replay:${at.toISOString()}`,
        firedAt: at,
        subjectRef: { requestId: "crash-replay" },
      });
      const claims = await Promise.all([
        outbox.claim({ alertEventId: event.id, at, leaseMs: 60_000, workerId: "worker-a" }),
        outbox.claim({ alertEventId: event.id, at, leaseMs: 60_000, workerId: "worker-b" }),
      ]);
      expect(claims.map(({ status }) => status).sort()).toEqual(["busy", "claimed"]);
      const firstClaim = claims.find(
        (claim): claim is Extract<(typeof claims)[number], { status: "claimed" }> =>
          claim.status === "claimed",
      )!;

      const recovered = await outbox.claim({
        alertEventId: event.id,
        at: new Date(at.getTime() + 60_000),
        leaseMs: 60_000,
        workerId: "worker-b",
      });
      expect(recovered).toEqual({
        attempt: 2,
        claimToken: expect.any(String),
        status: "claimed",
      });
      if (recovered.status !== "claimed") throw new Error("expected reclaimed delivery");
      await expect(
        outbox.completeSuccess({
          accepted: ["stale@corporativo.ec"],
          alertEventId: event.id,
          at: new Date(at.getTime() + 60_001),
          attempt: firstClaim.attempt,
          claimToken: firstClaim.claimToken,
          providerMessageId: "stale-smtp-042",
          workerId: "worker-a",
        }),
      ).rejects.toMatchObject({ code: "55000" });
      await outbox.completeSuccess({
        accepted: ["admin@corporativo.ec"],
        alertEventId: event.id,
        at: new Date(at.getTime() + 60_001),
        attempt: 2,
        claimToken: recovered.claimToken,
        providerMessageId: "smtp-042",
        workerId: "worker-b",
      });
      await expect(
        outbox.claim({
          alertEventId: event.id,
          at: new Date(at.getTime() + 120_002),
          leaseMs: 60_000,
          workerId: "worker-c",
        }),
      ).resolves.toEqual({ status: "already_succeeded" });

      const events = await companyEvents(repository, ids.companyA);
      expect(events.find(({ id }) => id === event.id)?.notified).toEqual({
        accepted: ["admin@corporativo.ec"],
        providerMessageId: "smtp-042",
        status: "sent",
      });

      const app = await fixture.connectAsApp();
      try {
        await expect(
          app.query(
            "UPDATE alert_notification_delivery SET error_code = 'tampered' WHERE alert_event_id = $1",
            [event.id],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          app.query(
            "UPDATE alert_event SET notified = '{\"status\":\"sent\"}'::jsonb WHERE id = $1",
            [event.id],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await app.end();
      }
    } finally {
      await Promise.all([outbox.close(), repository.close()]);
    }
  });

  it("derives recipient-scoped sent evidence without a scalar-subquery failure", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const repository = createAlertRepository(fixture.appUrl);
    const at = new Date("2026-07-27T17:00:00.000Z");
    try {
      const event = await outbox.enqueue({
        alertRuleId: ids.ruleA,
        dedupeKey: `${ids.ruleA}:recipient-evidence:${randomUUID()}`,
        deliveries: [
          {
            email: "ana@example.test",
            key: "email:ana@example.test",
            locale: "en",
            userAccountId: null,
          },
          {
            email: "sofia@example.test",
            key: "email:sofia@example.test",
            locale: "es",
            userAccountId: null,
          },
        ],
        firedAt: at,
        subjectRef: { requestId: "recipient-evidence" },
      });
      for (const recipient of await outbox.listRecipients(event.id)) {
        const claim = await outbox.claim({
          alertEventId: event.id,
          at,
          leaseMs: 60_000,
          recipientKey: recipient.key,
          workerId: "recipient-evidence-worker",
        });
        expect(claim.status).toBe("claimed");
        if (claim.status !== "claimed") throw new Error("expected claim");
        await outbox.completeSuccess({
          accepted: [recipient.email],
          alertEventId: event.id,
          at: new Date(at.getTime() + 1),
          attempt: claim.attempt,
          claimToken: claim.claimToken,
          providerMessageId: `smtp:${recipient.key}`,
          recipientKey: recipient.key,
          workerId: "recipient-evidence-worker",
        });
      }
      const listed = await companyEvents(repository, ids.companyA);
      expect(listed.find(({ id }) => id === event.id)?.notified).toEqual({
        deliveries: [
          {
            accepted: ["ana@example.test"],
            providerMessageId: "smtp:email:ana@example.test",
            recipientKey: "email:ana@example.test",
          },
          {
            accepted: ["sofia@example.test"],
            providerMessageId: "smtp:email:sofia@example.test",
            recipientKey: "email:sofia@example.test",
          },
        ],
        status: "sent",
      });
    } finally {
      await Promise.all([outbox.close(), repository.close()]);
    }
  });

  it("joins through alert_rule.company_id so another company cannot read the event", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const dedupeKey = `${ids.ruleA}:breach:${randomUUID()}:2026-07-27T15:15:00.000Z`;
      await repository.createEvent({
        alertRuleId: ids.ruleA,
        dedupeKey,
        firedAt: new Date("2026-07-27T15:15:00.000Z"),
        subjectRef: { requestId: "request-a" },
      });

      await expect(companyEvents(repository, ids.companyA)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ alertRuleId: ids.ruleA, dedupeKey }),
        ]),
      );
      expect(
        (await companyEvents(repository, ids.companyB)).some(
          (event) => event.dedupeKey === dedupeKey,
        ),
      ).toBe(false);
    } finally {
      await repository.close();
    }
  });

  it("returns newest-first presentation metadata including acknowledgement identity", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    const older = await repository.createEvent({
      alertRuleId: ids.ruleA,
      dedupeKey: `${ids.ruleA}:surface-older:${randomUUID()}`,
      firedAt: new Date("2026-07-28T10:00:00.000Z"),
      subjectRef: {
        licenseTypeId: "license-surface",
        vendorAccountId: "account-surface",
      },
    });
    const newer = await repository.createEvent({
      alertRuleId: ids.ruleA,
      dedupeKey: `${ids.ruleA}:surface-newer:${randomUUID()}`,
      firedAt: new Date("2026-07-28T11:00:00.000Z"),
      subjectRef: {
        licenseTypeId: "license-surface",
        vendorAccountId: "account-surface",
      },
    });
    try {
      await ownerQuery(
        `UPDATE alert_event
         SET acknowledged_by = '00000000-0000-0000-0000-000000000001',
             acknowledged_at = '2026-07-28T12:00:00.000Z'
         WHERE id = $1`,
        [older.id],
      );

      const events = (await companyEvents(repository, ids.companyA)).filter(
        ({ id }) => id === older.id || id === newer.id,
      );
      expect(events.map(({ id }) => id)).toEqual([newer.id, older.id]);
      expect(events[0]).toMatchObject({
        acknowledgedAt: null,
        acknowledgedBy: null,
        alertType: "low_pool",
        companyId: ids.companyA,
        companyName: "Company A",
        scopeKind: "company",
      });
      expect(events[1]).toMatchObject({
        acknowledgedAt: new Date("2026-07-28T12:00:00.000Z"),
        acknowledgedBy: "system@ledger.invalid",
      });
    } finally {
      await repository.close();
    }
  });

  it("keeps global events out of company reads and returns every canonical type once from the global stream", async () => {
    const repositoryA = createAlertRepository(fixture.appUrl);
    const repositoryB = createAlertRepository(fixture.appUrl);
    const scoped = {
      licenseType: "00000000-0000-4000-8000-000000004231",
      personA: "00000000-0000-4000-8000-000000004232",
      personB: "00000000-0000-4000-8000-000000004233",
      requestA: "00000000-0000-4000-8000-000000004234",
      requestB: "00000000-0000-4000-8000-000000004235",
      vendor: "00000000-0000-4000-8000-000000004236",
      vendorAccount: "00000000-0000-4000-8000-000000004237",
    };
    try {
      await ownerQuery(
        `INSERT INTO vendor
           (id, name, connector_type, provisioning_protocol, can_provision,
            can_deprovision, has_usage_data, has_cost_data, identity_matching,
            status, created_at, created_by)
         VALUES ($1, 'Global projection vendor', 'orchestration', 'none',
                 false, false, false, false, 'email', 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [scoped.vendor],
      );
      await ownerQuery(
        `INSERT INTO vendor_account
           (id, vendor_id, name, mode, low_pool_floor, status, created_at,
            created_by)
         VALUES ($1, $2, 'Global projection account', 'orchestration', 0,
                 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [scoped.vendorAccount, scoped.vendor],
      );
      await ownerQuery(
        `INSERT INTO license_type
           (id, vendor_id, name, unit, status, created_at, created_by)
         VALUES ($1, $2, 'Global projection seat', 'seat', 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [scoped.licenseType, scoped.vendor],
      );
      await ownerQuery(
        `INSERT INTO person
           (id, email, full_name, company_id, status, created_at, created_by)
         VALUES
           ($1, 'global-a@example.test', 'Global A', $3, 'active', now(),
            '00000000-0000-0000-0000-000000000001'),
           ($2, 'global-b@example.test', 'Global B', $4, 'active', now(),
            '00000000-0000-0000-0000-000000000001')`,
        [scoped.personA, scoped.personB, ids.companyA, ids.companyB],
      );
      await ownerQuery(
        `INSERT INTO license_request
           (id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, created_at, created_by)
         VALUES
           ($1, 'REQ-GLOBAL-A', $3, $5, $7, $8, 'pending_approval',
            'global projection A', now(),
            '00000000-0000-0000-0000-000000000001'),
           ($2, 'REQ-GLOBAL-B', $4, $6, $7, $8, 'pending_approval',
            'global projection B', now(),
            '00000000-0000-0000-0000-000000000001')`,
        [
          scoped.requestA,
          scoped.requestB,
          scoped.personA,
          scoped.personB,
          ids.companyA,
          ids.companyB,
          scoped.vendorAccount,
          scoped.licenseType,
        ],
      );
      const owner = await fixture.connectAsOwner();
      try {
        const globalRules = await owner.query<{ id: string; type: string }>(
          `SELECT id, type::text
           FROM alert_rule
           WHERE scope_kind = 'global'`,
        );
        const ruleByType = new Map(
          globalRules.rows.map(({ id, type }) => [type, id]),
        );
        const approvalRule = ruleByType.get("approval_aging")!;
        const otherRule = ruleByType.get("blocked_no_seat")!;
        await owner.query(
          `INSERT INTO alert_event
             (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
           VALUES
             ($1, now(), jsonb_build_object('requestId', $3::text),
              '{"status":"pending"}', $5),
             ($1, now(), jsonb_build_object('requestId', $4::text),
              '{"status":"pending"}', $6),
             ($1, now(), '{"requestId":"not-a-uuid''::uuid"}',
              '{"status":"pending"}', $7),
             ($2, now(), jsonb_build_object('requestId', $3::text),
              '{"status":"pending"}', $8)`,
          [
            approvalRule,
            otherRule,
            scoped.requestA,
            scoped.requestB,
            `global-a:${randomUUID()}`,
            `global-b:${randomUUID()}`,
            `global-malformed:${randomUUID()}`,
            `global-other:${randomUUID()}`,
          ],
        );
        const subjectsByType: Record<string, object> = {
          approval_aging: { requestId: scoped.requestA },
          blocked_no_seat: { requestId: scoped.requestA },
          close_missed: { period: "2026-07" },
          credential_failure: { vendorAccountId: scoped.vendorAccount },
          deprovision_overdue: { requestId: scoped.requestA },
          invite_unaccepted: { requestId: scoped.requestA },
          low_pool: {
            licenseTypeId: scoped.licenseType,
            vendorAccountId: scoped.vendorAccount,
          },
          provisioning_failure: { requestId: scoped.requestA },
          register_drift: {
            reconciliationId: "00000000-0000-4000-8000-000000004238",
          },
          sync_stale: { vendorAccountId: scoped.vendorAccount },
        };
        for (const [type, ruleId] of ruleByType) {
          await owner.query(
            `INSERT INTO alert_event
               (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
             VALUES ($1, now(), $2::jsonb, '{"status":"pending"}', $3)`,
            [
              ruleId,
              JSON.stringify(subjectsByType[type]),
              `global-canonical:${type}:${randomUUID()}`,
            ],
          );
        }
      } finally {
        await owner.end();
      }

      const eventsA = await companyEvents(repositoryA, ids.companyA);
      const eventsB = await companyEvents(repositoryB, ids.companyB);
      expect(eventsA.some(({ scopeKind }) => scopeKind === "global")).toBe(false);
      expect(eventsB.some(({ scopeKind }) => scopeKind === "global")).toBe(false);

      const globalEvents = (
        await repositoryA.listAuthorizedEvents(
          authorization([], "group_admin"),
          { filter: "all", limit: 100 },
        )
      ).items;
      const canonical = globalEvents.filter(({ dedupeKey }) =>
        dedupeKey.startsWith("global-canonical:"),
      );
      expect(canonical.map(({ alertType }) => alertType).sort()).toEqual([
        "approval_aging",
        "blocked_no_seat",
        "close_missed",
        "credential_failure",
        "deprovision_overdue",
        "invite_unaccepted",
        "low_pool",
        "provisioning_failure",
        "register_drift",
        "sync_stale",
      ]);
      expect(
        canonical.filter(({ alertType }) => alertType === "approval_aging"),
      ).toHaveLength(1);
      expect(
        globalEvents.find(
          ({ subjectRef }) =>
            subjectRef.requestId === "not-a-uuid'::uuid",
        ),
      ).toMatchObject({ subjectLinkAllowed: false });
      expect(
        canonical.find(({ alertType }) => alertType === "blocked_no_seat"),
      ).toMatchObject({
        companyId: ids.companyA,
        companyName: "Company A",
        subjectLinkAllowed: true,
      });
    } finally {
      await Promise.all([repositoryA.close(), repositoryB.close()]);
    }
  });
});

describe("acknowledgeEvent", () => {
  const admin = authorization([ids.companyA], "group_admin");
  const actor = "00000000-0000-4000-8000-000000004301";
  const at = new Date("2026-08-15T12:00:00.000Z");

  it("records who acknowledged and when", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const event = await seedAlertEvent(ids.ruleA, ids.companyA);
      const result = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: actor,
        authorization: admin,
        occurredAt: at,
      });

      expect(result).toEqual({
        status: "acknowledged",
        acknowledgedBy: actor,
        acknowledgedAt: at,
      });
      const row = await readPool.query(
        "SELECT acknowledged_by::text, acknowledged_at FROM alert_event WHERE id = $1",
        [event],
      );
      expect(row.rows[0].acknowledged_by).toBe(actor);
      expect(row.rows[0].acknowledged_at).toEqual(at);
    } finally {
      await repository.close();
    }
  });

  it("keeps the first acknowledger when a second admin acknowledges", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    const second = "00000000-0000-4000-8000-000000004302";
    try {
      const event = await seedAlertEvent(ids.ruleA, ids.companyA);
      await repository.acknowledgeEvent({
        alertEventId: event, actorUserAccountId: actor,
        authorization: admin, occurredAt: at,
      });

      const result = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: second,
        authorization: admin,
        occurredAt: new Date("2026-08-15T13:00:00.000Z"),
      });

      expect(result).toEqual({
        status: "already_acknowledged",
        acknowledgedBy: actor,
        acknowledgedAt: at,
      });
    } finally {
      await repository.close();
    }
  });

  it("writes exactly one audit row for the first acknowledgment", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const event = await seedAlertEvent(ids.ruleA, ids.companyA);
      await repository.acknowledgeEvent({
        alertEventId: event, actorUserAccountId: actor,
        authorization: admin, occurredAt: at,
      });
      await repository.acknowledgeEvent({
        alertEventId: event, actorUserAccountId: actor,
        authorization: admin, occurredAt: at,
      });

      const audit = await readPool.query(
        `SELECT action, entity_type, actor_user_id::text
         FROM audit_log WHERE entity_id = $1`,
        [event],
      );
      expect(audit.rows).toEqual([
        { action: "alert.acknowledged", entity_type: "AlertEvent", actor_user_id: actor },
      ]);
    } finally {
      await repository.close();
    }
  });

  it("does not acknowledge an alert outside the actor's scope", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const event = await seedAlertEvent(ids.ruleB, ids.companyB);
      const result = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: actor,
        authorization: authorization([ids.companyA]),
        occurredAt: at,
      });

      expect(result).toEqual({ status: "not_found" });
      const row = await readPool.query(
        "SELECT acknowledged_at FROM alert_event WHERE id = $1",
        [event],
      );
      expect(row.rows[0].acknowledged_at).toBeNull();
    } finally {
      await repository.close();
    }
  });

  it("acknowledges a global-scope alert only for group_admin authorization", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const globalRule = await readPool.query<{ id: string }>(
        `SELECT id FROM alert_rule WHERE scope_kind = 'global' AND type = 'low_pool' LIMIT 1`,
      );
      const globalRuleId = globalRule.rows[0]!.id;
      const event = await seedAlertEvent(globalRuleId, ids.companyA);

      const nonAdmin = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: actor,
        authorization: authorization([ids.companyA]),
        occurredAt: at,
      });
      expect(nonAdmin).toEqual({ status: "not_found" });
      const unacknowledgedRow = await readPool.query(
        "SELECT acknowledged_at FROM alert_event WHERE id = $1",
        [event],
      );
      expect(unacknowledgedRow.rows[0].acknowledged_at).toBeNull();

      const adminResult = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: actor,
        authorization: admin,
        occurredAt: at,
      });
      expect(adminResult).toEqual({
        status: "acknowledged",
        acknowledgedBy: actor,
        acknowledgedAt: at,
      });
      const audit = await readPool.query(
        `SELECT action, entity_type, actor_user_id::text, company_id
         FROM audit_log WHERE entity_id = $1`,
        [event],
      );
      expect(audit.rows).toEqual([
        {
          action: "alert.acknowledged",
          entity_type: "AlertEvent",
          actor_user_id: actor,
          company_id: null,
        },
      ]);
    } finally {
      await repository.close();
    }
  });

  // Task 5's DoD (docs/superpowers/plans/2026-08-15-us-043-alert-acknowledgment.md,
  // commit d63b725) requires re-verifying tenant isolation end-to-end
  // through `ackAlert`/the UI, not just at the repository. This composes the
  // REAL policy (Task 3, `ackAlertPolicy`) with the REAL repository (Task 2,
  // `repository.acknowledgeEvent`) -- no mocks -- to prove the seam between
  // the policy's group_admin gate and the repository's scope gate actually
  // holds when wired together, the way `ackAlert` wires them in
  // `apps/web/src/modules/alerts/actions.ts`.
  //
  // NOTE on the DoD's exact wording: it predicted a non-group_admin
  // acknowledging a global-scope alert would get "not_found" end-to-end.
  // That's not what actually happens (verified below, case 2):
  // `ackAlertPolicy` returns `{ ok: false, error: "forbidden" }` for any
  // non-group_admin authorization *before* ever calling `acknowledge` -- the
  // repository's own scope gate (the thing that returns "not_found") is
  // never reached on that path. This is a *stronger* guarantee than the DoD
  // anticipated: the caller is rejected before touching the database at
  // all, not merely denied a specific row. Case 3 drives an authorization
  // that clears the policy's group_admin gate but still misses the
  // repository's own scope predicate -- the scenario that actually produces
  // "not_found" through the composed call -- proving the repository's scope
  // gate still binds even for a caller the policy lets through.
  it("composes the real ackAlertPolicy with the real repository.acknowledgeEvent across the group_admin/scope seam", async () => {
    const repository = createAlertRepository(fixture.appUrl);
    try {
      const globalRule = await readPool.query<{ id: string }>(
        `SELECT id FROM alert_rule WHERE scope_kind = 'global' AND type = 'low_pool' LIMIT 1`,
      );
      const globalRuleId = globalRule.rows[0]!.id;
      const globalEvent = await seedAlertEvent(globalRuleId, ids.companyA);

      // Case 2 (the DoD's discriminating check, corrected): a
      // non-group_admin authorization must not acknowledge a global-scope
      // alert, and must be denied before the repository is ever reached.
      const denied = await ackAlertPolicy(
        {
          authorization: authorization([ids.companyA]),
          acknowledge: repository.acknowledgeEvent,
          now: () => at,
        },
        { alertEventId: globalEvent },
      );
      expect(denied).toEqual({ ok: false, error: "forbidden" });
      const deniedRow = await readPool.query(
        "SELECT acknowledged_at FROM alert_event WHERE id = $1",
        [globalEvent],
      );
      expect(deniedRow.rows[0].acknowledged_at).toBeNull();

      // Case 1 (proves the wiring is real, not silently mocked): a
      // group_admin acknowledging the same global-scope alert through the
      // composed call must reach the real repository and actually write
      // the row.
      const admitted = await ackAlertPolicy(
        {
          authorization: admin,
          acknowledge: repository.acknowledgeEvent,
          now: () => at,
        },
        { alertEventId: globalEvent },
      );
      expect(admitted).toEqual({
        ok: true,
        acknowledgedBy: admin.userAccountId,
        acknowledgedAt: at.toISOString(),
      });
      const admittedRow = await readPool.query(
        "SELECT acknowledged_by::text, acknowledged_at FROM alert_event WHERE id = $1",
        [globalEvent],
      );
      expect(admittedRow.rows[0].acknowledged_by).toBe(admin.userAccountId);
      expect(admittedRow.rows[0].acknowledged_at).toEqual(at);

      // Case 3: an authorization that clears the policy's group_admin gate
      // but is (synthetically, though type-validly) scoped to no
      // companies -- the real `authorization.load()` always grants
      // group_admin every company id, so this shape only exists here to
      // drive the repository's own scope predicate through the policy. It
      // proves the repository's scope gate still binds after the policy
      // gate passes: a company-scoped alert outside `companyIds` is
      // "not_found" even for an authorization the policy itself accepts.
      const companyEvent = await seedAlertEvent(ids.ruleB, ids.companyB);
      const scopedOut = await ackAlertPolicy(
        {
          authorization: authorization([], "group_admin"),
          acknowledge: repository.acknowledgeEvent,
          now: () => at,
        },
        { alertEventId: companyEvent },
      );
      expect(scopedOut).toEqual({ ok: false, error: "not_found" });
      const scopedOutRow = await readPool.query(
        "SELECT acknowledged_at FROM alert_event WHERE id = $1",
        [companyEvent],
      );
      expect(scopedOutRow.rows[0].acknowledged_at).toBeNull();
    } finally {
      await repository.close();
    }
  });
});
