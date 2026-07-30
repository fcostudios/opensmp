import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAlertNotificationOutbox } from "./outbox.js";

let fixture: PostgresFixture;
const approvalRuleId = "00000000-0000-4000-8000-000000004201";

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
}, 120_000);

afterAll(async () => {
  await fixture.stop();
});

describe("US-017 recipient-scoped alert outbox", () => {
  it("closes its PostgreSQL pool", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    await outbox.close();
    await expect(
      outbox.listRecipients("00000000-0000-4000-8000-000000004299"),
    ).rejects.toThrow();
  });

  it("rejects a claim for an event without a pending recipient origin", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const owner = await fixture.connectAsOwner();
    try {
      const inserted = await owner.query<{ id: string }>(
        `INSERT INTO alert_event
           (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
         VALUES ($1, $2, '{"requestId":"missing-origin"}',
                 '{"status":"pending"}', $3)
         RETURNING id`,
        [
          approvalRuleId,
          new Date("2026-08-11T14:00:00.000Z"),
          `${approvalRuleId}:missing-origin`,
        ],
      );
      await expect(
        outbox.claim({
          alertEventId: inserted.rows[0]!.id,
          at: new Date("2026-08-11T14:00:00.000Z"),
          leaseMs: 60_000,
          recipientKey: "user:missing-origin",
          workerId: "worker-missing-origin",
        }),
      ).rejects.toThrow("alert delivery has no pending outbox record");
    } finally {
      await Promise.all([outbox.close(), owner.end()]);
    }
  });

  it("fences recipients independently and preserves replay and retry evidence", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const at = new Date("2026-08-11T15:00:00.000Z");
    const input = {
      alertRuleId: approvalRuleId,
      dedupeKey: `${approvalRuleId}:recipient-outbox`,
      deliveries: [
        {
          email: "ana@example.test",
          key: "user:ana",
          locale: "en" as const,
          userAccountId: null,
        },
        {
          email: "sofia@example.test",
          key: "user:sofia",
          locale: "es" as const,
          userAccountId: null,
        },
        {
          email: "fallback@example.test",
          key: "user:fallback",
          locale: null as never,
          userAccountId: null,
        },
      ],
      firedAt: at,
      notified: { recipientCount: 3, status: "pending" },
      subjectRef: { requestId: "recipient-outbox" },
    };
    try {
      const created = await outbox.enqueue(input);
      expect(created.status).toBe("created");
      await expect(outbox.enqueue(input)).resolves.toMatchObject({
        id: created.id,
        postgresCode: "23505",
        status: "replayed",
      });
      await expect(outbox.listRecipients(created.id)).resolves.toEqual([
        {
          email: "ana@example.test",
          key: "user:ana",
          locale: "en",
          userAccountId: null,
        },
        {
          email: "fallback@example.test",
          key: "user:fallback",
          locale: "es",
          userAccountId: null,
        },
        {
          email: "sofia@example.test",
          key: "user:sofia",
          locale: "es",
          userAccountId: null,
        },
      ]);

      const anaClaims = await Promise.all([
        outbox.claim({
          alertEventId: created.id,
          at,
          leaseMs: 60_000,
          recipientKey: "user:ana",
          workerId: "worker-a",
        }),
        outbox.claim({
          alertEventId: created.id,
          at,
          leaseMs: 60_000,
          recipientKey: "user:ana",
          workerId: "worker-b",
        }),
      ]);
      expect(anaClaims.map(({ status }) => status).sort()).toEqual([
        "busy",
        "claimed",
      ]);
      const anaClaim = anaClaims.find(
        (claim): claim is Extract<
          (typeof anaClaims)[number],
          { status: "claimed" }
        > => claim.status === "claimed",
      )!;
      await outbox.completeSuccess({
        accepted: ["ana@example.test"],
        alertEventId: created.id,
        at: new Date(at.getTime() + 1),
        attempt: anaClaim.attempt,
        claimToken: anaClaim.claimToken,
        providerMessageId: "smtp-ana",
        recipientKey: "user:ana",
        workerId: "worker-a",
      });
      await expect(
        outbox.claim({
          alertEventId: created.id,
          at: new Date(at.getTime() + 2),
          leaseMs: 60_000,
          recipientKey: "user:ana",
          workerId: "worker-c",
        }),
      ).resolves.toEqual({ status: "already_succeeded" });

      const sofiaClaim = await outbox.claim({
        alertEventId: created.id,
        at,
        leaseMs: 60_000,
        recipientKey: "user:sofia",
        workerId: "worker-s",
      });
      expect(sofiaClaim.status).toBe("claimed");
      if (sofiaClaim.status !== "claimed") throw new Error("expected claim");
      await outbox.completeFailure({
        alertEventId: created.id,
        at: new Date(at.getTime() + 1),
        attempt: sofiaClaim.attempt,
        claimToken: sofiaClaim.claimToken,
        errorCode: "SMTP_TEMPORARY",
        recipientKey: "user:sofia",
        workerId: "worker-s",
      });
      await expect(
        outbox.listReadyEventIds(new Date(at.getTime() + 2)),
      ).resolves.toContain(created.id);
    } finally {
      await outbox.close();
    }
  });

  it("keeps the legacy default stream and validates public inputs", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const at = new Date("2026-08-12T15:00:00.000Z");
    try {
      const event = await outbox.enqueue({
        alertRuleId: approvalRuleId,
        dedupeKey: `${approvalRuleId}:legacy-outbox`,
        firedAt: at,
        subjectRef: { requestId: "legacy-outbox" },
      });
      const owner = await fixture.connectAsOwner();
      try {
        await expect(
          owner.query(
            "SELECT notified FROM alert_event WHERE id = $1",
            [event.id],
          ),
        ).resolves.toMatchObject({
          rows: [{ notified: { status: "pending" } }],
        });
      } finally {
        await owner.end();
      }
      const claim = await outbox.claim({
        alertEventId: event.id,
        at,
        leaseMs: 1,
        workerId: "legacy-worker",
      });
      expect(claim.status).toBe("claimed");
      if (claim.status !== "claimed") throw new Error("expected claim");
      await outbox.completeSuccess({
        accepted: ["admin@example.test"],
        alertEventId: event.id,
        at,
        attempt: claim.attempt,
        claimToken: claim.claimToken,
        providerMessageId: "smtp-legacy",
        workerId: "legacy-worker",
      });
      await expect(
        outbox.completeSuccess({
          accepted: [],
          alertEventId: event.id,
          at,
          attempt: claim.attempt,
          claimToken: claim.claimToken,
          providerMessageId: " ",
          recipientKey: " ",
          workerId: "legacy-worker",
        }),
      ).rejects.toThrow("delivery identity is required");
      await expect(
        outbox.completeSuccess({
          accepted: [],
          alertEventId: event.id,
          at,
          attempt: claim.attempt,
          claimToken: claim.claimToken,
          providerMessageId: " ",
          workerId: "legacy-worker",
        }),
      ).rejects.toThrow("providerMessageId is required");

      for (const delivery of [
        {
          email: "valid@example.test",
          key: " ",
          locale: "es" as const,
          userAccountId: null,
        },
        {
          email: " ",
          key: "email:blank",
          locale: "es" as const,
          userAccountId: null,
        },
      ]) {
        await expect(outbox.enqueue({
          alertRuleId: approvalRuleId,
          dedupeKey: `invalid-recipient:${delivery.key}`,
          deliveries: [delivery],
          firedAt: at,
          subjectRef: { requestId: "invalid" },
        })).rejects.toThrow("recipient delivery identity is required");
      }
      await expect(
        outbox.enqueue({
          alertRuleId: "00000000-0000-4000-8000-000000009999",
          dedupeKey: "non-dedupe-error",
          firedAt: at,
          subjectRef: { requestId: "invalid-rule" },
        }),
      ).rejects.toMatchObject({ code: "23503" });

      const failed = await outbox.enqueue({
        alertRuleId: approvalRuleId,
        dedupeKey: `${approvalRuleId}:legacy-failure`,
        firedAt: at,
        subjectRef: { requestId: "legacy-failure" },
      });
      const failedClaim = await outbox.claim({
        alertEventId: failed.id,
        at,
        leaseMs: 1,
        workerId: "legacy-failure-worker",
      });
      expect(failedClaim.status).toBe("claimed");
      if (failedClaim.status !== "claimed") throw new Error("expected claim");
      await outbox.completeFailure({
        alertEventId: failed.id,
        at,
        attempt: failedClaim.attempt,
        claimToken: failedClaim.claimToken,
        errorCode: "SMTP_TEMPORARY",
        workerId: "legacy-failure-worker",
      });
      const failureOwner = await fixture.connectAsOwner();
      try {
        await expect(
          failureOwner.query(
            `SELECT count(*)::int AS count
             FROM alert_notification_delivery
             WHERE alert_event_id = $1
               AND recipient_key = 'default'
               AND phase = 'failed'
               AND error_code = 'SMTP_TEMPORARY'`,
            [failed.id],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      } finally {
        await failureOwner.end();
      }
      await expect(
        outbox.claim({
          alertEventId: failed.id,
          at: new Date(at.getTime() + 1),
          leaseMs: 1,
          workerId: "legacy-retry-worker",
        }),
      ).resolves.toMatchObject({ attempt: 2, status: "claimed" });
      await expect(
        outbox.claim({
          alertEventId: event.id,
          at: new Date("invalid"),
          leaseMs: 0,
          workerId: "",
        }),
      ).rejects.toThrow("at must be a valid date");
      await expect(
        outbox.claim({
          alertEventId: event.id,
          at,
          leaseMs: 0,
          workerId: "worker",
        }),
      ).rejects.toThrow("leaseMs must be a positive integer");
      await expect(
        outbox.enqueue({
          alertRuleId: approvalRuleId,
          dedupeKey: "invalid-fired-at",
          firedAt: new Date("invalid"),
          subjectRef: { requestId: "invalid" },
        }),
      ).rejects.toThrow("firedAt must be a valid date");
      await expect(
        outbox.listReadyEventIds(new Date("invalid")),
      ).rejects.toThrow("at must be a valid date");
    } finally {
      await outbox.close();
    }
  });

  it("matches terminal history to its attempt and expires leases at the exact boundary", async () => {
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const at = new Date("2026-08-13T15:00:00.000Z");
    try {
      const event = await outbox.enqueue({
        alertRuleId: approvalRuleId,
        dedupeKey: `${approvalRuleId}:mixed-attempt-history`,
        deliveries: [
          {
            email: "ana@example.test",
            key: "user:mixed-ana",
            locale: "en",
            userAccountId: null,
          },
          {
            email: "sofia@example.test",
            key: "user:mixed-sofia",
            locale: "es",
            userAccountId: null,
          },
        ],
        firedAt: at,
        subjectRef: { requestId: "mixed-attempt-history" },
      });
      const attemptOne = await outbox.claim({
        alertEventId: event.id,
        at,
        leaseMs: 10,
        recipientKey: "user:mixed-ana",
        workerId: "mixed-worker-1",
      });
      expect(attemptOne.status).toBe("claimed");
      if (attemptOne.status !== "claimed") throw new Error("expected claim");
      await outbox.completeFailure({
        alertEventId: event.id,
        at: new Date(at.getTime() + 1),
        attempt: attemptOne.attempt,
        claimToken: attemptOne.claimToken,
        errorCode: "SMTP_TEMPORARY",
        recipientKey: "user:mixed-ana",
        workerId: "mixed-worker-1",
      });
      const attemptTwoAt = new Date(at.getTime() + 2);
      const attemptTwo = await outbox.claim({
        alertEventId: event.id,
        at: attemptTwoAt,
        leaseMs: 10,
        recipientKey: "user:mixed-ana",
        workerId: "mixed-worker-2",
      });
      expect(attemptTwo).toMatchObject({ attempt: 2, status: "claimed" });
      await expect(
        outbox.claim({
          alertEventId: event.id,
          at: new Date(at.getTime() + 11),
          leaseMs: 10,
          recipientKey: "user:mixed-ana",
          workerId: "mixed-worker-old-failure",
        }),
      ).resolves.toEqual({ status: "busy" });

      const sofia = await outbox.claim({
        alertEventId: event.id,
        at: new Date(at.getTime() + 11),
        leaseMs: 10,
        recipientKey: "user:mixed-sofia",
        workerId: "mixed-worker-sofia",
      });
      expect(sofia.status).toBe("claimed");

      const attemptThree = await outbox.claim({
        alertEventId: event.id,
        at: new Date(at.getTime() + 12),
        leaseMs: 10,
        recipientKey: "user:mixed-ana",
        workerId: "mixed-worker-3",
      });
      expect(attemptThree).toMatchObject({ attempt: 3, status: "claimed" });
      if (attemptThree.status !== "claimed") throw new Error("expected claim");
      await outbox.completeSuccess({
        accepted: ["ana@example.test"],
        alertEventId: event.id,
        at: new Date(at.getTime() + 13),
        attempt: attemptThree.attempt,
        claimToken: attemptThree.claimToken,
        providerMessageId: "smtp-mixed-ana",
        recipientKey: "user:mixed-ana",
        workerId: "mixed-worker-3",
      });
      await expect(
        outbox.claim({
          alertEventId: event.id,
          at: new Date(at.getTime() + 23),
          leaseMs: 10,
          recipientKey: "user:mixed-ana",
          workerId: "mixed-worker-closed",
        }),
      ).resolves.toEqual({ status: "already_succeeded" });
    } finally {
      await outbox.close();
    }
  });
});
