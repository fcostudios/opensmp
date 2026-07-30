import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { createAlertNotificationOutbox } from "@smp/notifications";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAlertEvaluationJob,
  resolveNotificationLocale,
} from "./evaluate-alerts.js";
import { createMailpitTestJournal } from "./mailpit-test-journal.js";

const smtpUrl = process.env.MAILPIT_TEST_SMTP_URL;
const apiOrigin = process.env.MAILPIT_TEST_API_ORIGIN;
let fixture: PostgresFixture;
const recipients = {
  approverA: `ana.approver+${process.pid}@andes.test`,
  approverSpanish: `sofia.approver+${process.pid}@andes.test`,
  escalation: `group-admin+${process.pid}@ledger.test`,
};
const mailpit = apiOrigin
  ? createMailpitTestJournal(apiOrigin, Object.values(recipients))
  : undefined;

describe.runIf(smtpUrl && apiOrigin)("US-017 approval aging worker", () => {
  it("maps English explicitly and every missing or unsupported locale to Spanish", () => {
    expect(resolveNotificationLocale("en")).toEqual({
      database: "en",
      notification: "en-US",
    });
    expect(resolveNotificationLocale(null)).toEqual({
      database: "es",
      notification: "es-EC",
    });
    expect(resolveNotificationLocale("unsupported")).toEqual({
      database: "es",
      notification: "es-EC",
    });
  });

  beforeAll(async () => {
    fixture = await createPostgresFixture();
    await fixture.migrate();
  }, 120_000);

  afterAll(async () => {
    await fixture.stop();
  });

  beforeEach(async () => {
    await mailpit!.clear();
  });

  it("converges two workers on one tenant-safe reminder and escalation delivery", async () => {
    const ids = {
      approverA: "17000000-0000-4000-8000-000000000001",
      approverAPerson: "17000000-0000-4000-8000-000000000002",
      approverB: "17000000-0000-4000-8000-000000000003",
      approverBPerson: "17000000-0000-4000-8000-000000000004",
      approverSpanish: "17000000-0000-4000-8000-000000000027",
      approverSpanishPerson: "17000000-0000-4000-8000-000000000028",
      companyA: "17000000-0000-4000-8000-000000000005",
      companyB: "17000000-0000-4000-8000-000000000006",
      grantA: "17000000-0000-4000-8000-000000000007",
      grantB: "17000000-0000-4000-8000-000000000008",
      grantSpanish: "17000000-0000-4000-8000-000000000029",
      licenseType: "17000000-0000-4000-8000-000000000009",
      requesterA: "17000000-0000-4000-8000-000000000010",
      requesterB: "17000000-0000-4000-8000-000000000011",
      requestA: "17000000-0000-4000-8000-000000000012",
      requestB: "17000000-0000-4000-8000-000000000013",
      requestUnassigned: "17000000-0000-4000-8000-000000000019",
      requestDefaultCalendar: "17000000-0000-4000-8000-000000000021",
      requestFailedDelivery: "17000000-0000-4000-8000-000000000023",
      requestBusy: "17000000-0000-4000-8000-000000000025",
      rule: "17000000-0000-4000-8000-000000000014",
      transitionA: "17000000-0000-4000-8000-000000000015",
      transitionB: "17000000-0000-4000-8000-000000000016",
      transitionUnassigned: "17000000-0000-4000-8000-000000000020",
      transitionDefaultCalendar: "17000000-0000-4000-8000-000000000022",
      transitionFailedDelivery: "17000000-0000-4000-8000-000000000024",
      transitionBusy: "17000000-0000-4000-8000-000000000026",
      transitionReentryApproved: "17000000-0000-4000-8000-000000000030",
      transitionReentryPending: "17000000-0000-4000-8000-000000000031",
      vendor: "17000000-0000-4000-8000-000000000017",
      vendorAccount: "17000000-0000-4000-8000-000000000018",
    };
    const owner = await fixture.connectAsOwner();
    try {
      await owner.query("UPDATE alert_rule SET enabled = false");
      await owner.query(
        `INSERT INTO company
           (id, name, code, type, status, created_at, created_by)
         VALUES
           ($1, 'Andes Holdings', 'ANDES-US017', 'internal', 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($2, 'Pacific Holdings', 'PACIFIC-US017', 'external', 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001')`,
        [ids.companyA, ids.companyB],
      );
      await owner.query(
        `INSERT INTO person
           (id, email, full_name, company_id, status, created_at, created_by)
         VALUES
           ($1, 'ana.approver@andes.test', 'Ana Approver', $5, 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($2, 'ben.approver@pacific.test', 'Ben Approver', $6, 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($3, 'requester@andes.test', 'Andes Requester', $5, 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($4, 'requester@pacific.test', 'Pacific Requester', $6, 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($7, 'sofia.approver@andes.test', 'Sofía Approver', $5, 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001')`,
        [
          ids.approverAPerson,
          ids.approverBPerson,
          ids.requesterA,
          ids.requesterB,
          ids.companyA,
          ids.companyB,
          ids.approverSpanishPerson,
        ],
      );
      await owner.query(
        `INSERT INTO user_account
           (id, email, idp_subject, person_id, ui_language, status, created_at,
            created_by)
         VALUES
           ($1, 'ana.approver@andes.test', 'us017-approver-a', $3, 'en',
            'active', '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001'),
           ($2, 'ben.approver@pacific.test', 'us017-approver-b', $4, 'en',
            'active', '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001'),
           ($5, 'sofia.approver@andes.test', 'us017-approver-es', $6, NULL,
            'active', '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001')`,
        [
          ids.approverA,
          ids.approverB,
          ids.approverAPerson,
          ids.approverBPerson,
          ids.approverSpanish,
          ids.approverSpanishPerson,
        ],
      );
      await owner.query(
        `UPDATE person
         SET email = CASE id
           WHEN $1 THEN $3
           WHEN $2 THEN $4
         END
         WHERE id = ANY($5::uuid[])`,
        [
          ids.approverAPerson,
          ids.approverSpanishPerson,
          recipients.approverA,
          recipients.approverSpanish,
          [ids.approverAPerson, ids.approverSpanishPerson],
        ],
      );
      await owner.query(
        `UPDATE user_account
         SET email = CASE id
           WHEN $1 THEN $3
           WHEN $2 THEN $4
         END
         WHERE id = ANY($5::uuid[])`,
        [
          ids.approverA,
          ids.approverSpanish,
          recipients.approverA,
          recipients.approverSpanish,
          [ids.approverA, ids.approverSpanish],
        ],
      );
      await owner.query(
        `INSERT INTO company_role_assignment
           (id, user_account_id, company_id, role, unique_grant, created_at,
            created_by)
         VALUES
           ($1, $3, $5, 'approver', 'us017-andes-approver',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($2, $4, $6, 'approver', 'us017-pacific-approver',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001'),
           ($7, $8, $5, 'approver', 'us017-andes-approver-es',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001')`,
        [
          ids.grantA,
          ids.grantB,
          ids.approverA,
          ids.approverB,
          ids.companyA,
          ids.companyB,
          ids.grantSpanish,
          ids.approverSpanish,
        ],
      );
      await owner.query(
        `INSERT INTO vendor
           (id, name, connector_type, provisioning_protocol, can_provision,
            can_deprovision, has_usage_data, has_cost_data, identity_matching,
            status, created_at, created_by)
         VALUES
           ($1, 'US-017 Vendor', 'orchestration', 'none', false, false, false,
            false, 'email', 'active', '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001')`,
        [ids.vendor],
      );
      await owner.query(
        `INSERT INTO vendor_account
           (id, vendor_id, name, mode, low_pool_floor, status, created_at,
            created_by)
         VALUES
           ($1, $2, 'US-017 Account', 'orchestration', 2, 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001')`,
        [ids.vendorAccount, ids.vendor],
      );
      await owner.query(
        `INSERT INTO license_type
           (id, vendor_id, name, unit, status, created_at, created_by)
         VALUES
           ($1, $2, 'US-017 Seat', 'seat', 'active',
            '2026-08-07T15:00:00Z', '00000000-0000-0000-0000-000000000001')`,
        [ids.licenseType, ids.vendor],
      );
      await owner.query(
        `INSERT INTO license_request
           (id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, created_at, created_by)
         VALUES
           ($1, 'REQ-US017-ANDES', $3, $5, $7, $8, 'pending_approval',
            'tenant A reminder', '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001'),
           ($2, 'REQ-US017-PACIFIC', $4, $6, $7, $8, 'pending_approval',
            'tenant B must stay isolated', '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001')`,
        [
          ids.requestA,
          ids.requestB,
          ids.requesterA,
          ids.requesterB,
          ids.companyA,
          ids.companyB,
          ids.vendorAccount,
          ids.licenseType,
        ],
      );
      await owner.query(
        `INSERT INTO request_transition
           (id, request_id, from_state, to_state, occurred_at)
         VALUES
           ($1, $3, 'submitted', 'pending_approval',
            '2026-08-07T15:00:00Z'),
           ($2, $4, 'submitted', 'pending_approval',
            '2026-08-07T15:00:00Z')`,
        [ids.transitionA, ids.transitionB, ids.requestA, ids.requestB],
      );
      await owner.query(
        `INSERT INTO alert_rule
           (id, type, scope_kind, company_id, threshold, channel, enabled,
            created_at, created_by)
         VALUES
           ($1, 'approval_aging', 'company', $2,
            '{"hours":24,"escalationHours":48}', 'email', true,
            '2026-08-07T15:00:00Z',
            '00000000-0000-0000-0000-000000000001')`,
        [ids.rule, ids.companyA],
      );
      await owner.query(
        `UPDATE system_setting
         SET value = to_jsonb($1::text)
         WHERE key = 'notif_escalation_email'`,
        [recipients.escalation],
      );
      await owner.query(
        `UPDATE system_setting
         SET value = '"en"'::jsonb
         WHERE key = 'default_language'`,
      );
    } finally {
      await owner.end();
    }

    const workers = ["us017-a", "us017-b"].map((workerId) =>
      createAlertEvaluationJob({
        calendar: { holidays: new Set(["2026-08-10"]) },
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId,
      }),
    );
    try {
      const reminderResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-11T15:00:00.000Z")),
        ),
      );
      expect(
        reminderResults.reduce((sum, result) => sum + result.processed, 0),
      ).toBe(1);

      const escalationResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-12T15:00:00.000Z")),
        ),
      );
      expect(
        escalationResults.reduce((sum, result) => sum + result.processed, 0),
      ).toBe(1);

      const db = await fixture.connectAsOwner();
      try {
        const events = await db.query<{
          dedupe_key: string;
          subject_ref: { requestId: string };
        }>(
          `SELECT dedupe_key, subject_ref
           FROM alert_event
           WHERE alert_rule_id = $1
           ORDER BY dedupe_key`,
          [ids.rule],
        );
        expect(events.rows).toEqual([
          {
            dedupe_key:
              `${ids.rule}:approval-aging:${ids.requestA}:` +
              "2026-08-07T15:00:00.000Z:escalation",
            subject_ref: {
              breachStartedAt: "2026-08-07T15:00:00.000Z",
              requestId: ids.requestA,
              stage: "escalation",
            },
          },
          {
            dedupe_key:
              `${ids.rule}:approval-aging:${ids.requestA}:` +
              "2026-08-07T15:00:00.000Z:reminder",
            subject_ref: {
              breachStartedAt: "2026-08-07T15:00:00.000Z",
              requestId: ids.requestA,
              stage: "reminder",
            },
          },
        ]);
        expect(
          events.rows.some(({ subject_ref }) =>
            subject_ref.requestId === ids.requestB
          ),
        ).toBe(false);
      } finally {
        await db.end();
      }

      const listing = { messages: await mailpit!.messages() };
      expect(listing.messages).toHaveLength(3);
      expect(
        listing.messages.map(({ To }) => To.map(({ Address }) => Address)),
      ).toEqual(expect.arrayContaining([
        [recipients.approverA],
        [recipients.approverSpanish],
        [recipients.escalation],
      ]));
      expect(
        listing.messages.flatMap(({ To }) =>
          To.map(({ Address }) => Address)
        ),
      ).not.toContain("ben.approver@pacific.test");

      const escalationSummary = listing.messages.find(({ To }) =>
        To.some(({ Address }) => Address === recipients.escalation)
      );
      expect(escalationSummary).toBeDefined();
      const detailResponse = await fetch(
        `${apiOrigin}/api/v1/message/${escalationSummary!.ID}`,
      );
      expect(detailResponse.ok).toBe(true);
      const detail = (await detailResponse.json()) as { Text: string };
      expect(detail.Text).toContain("REQ-US017-ANDES");
      expect(detail.Text).toContain("Andes Holdings");
      expect(detail.Text).toContain("Ana Approver");
      expect(detail.Text).toContain("Sofía Approver");
      expect(detail.Text).toContain("48 business hours");

      const reminderDetails = await Promise.all(
        listing.messages
          .filter(({ To }) =>
            To.some(({ Address }) => Address.endsWith("@andes.test"))
          )
          .map(async ({ ID, To }) => {
            const response = await fetch(`${apiOrigin}/api/v1/message/${ID}`);
            expect(response.ok).toBe(true);
            return {
              address: To[0]!.Address,
              detail: (await response.json()) as { Text: string },
            };
          }),
      );
      expect(
        reminderDetails.find(({ address }) =>
          address === recipients.approverA
        )!.detail.Text,
      ).toContain("24 business hours");
      expect(
        reminderDetails.find(({ address }) =>
          address === recipients.approverSpanish
        )!.detail.Text,
      ).toContain("24 horas hábiles");
      const ownerForDefaultLanguage = await fixture.connectAsOwner();
      try {
        await ownerForDefaultLanguage.query(
          `UPDATE system_setting
           SET value = '"es"'::jsonb
           WHERE key = 'default_language'`,
        );
      } finally {
        await ownerForDefaultLanguage.end();
      }

      const deliveryEvidence = await fixture.connectAsOwner();
      try {
        await expect(
          deliveryEvidence.query(
            `SELECT delivery.recipient_key,
                    array_agg(delivery.phase::text ORDER BY delivery.attempt,
                      delivery.phase) AS phases
             FROM alert_notification_delivery delivery
             JOIN alert_event event ON event.id = delivery.alert_event_id
             WHERE event.dedupe_key =
               $1 || ':approval-aging:' || $2 || ':' || $3 || ':reminder'
             GROUP BY delivery.recipient_key
             ORDER BY delivery.recipient_key`,
            [ids.rule, ids.requestA, "2026-08-07T15:00:00.000Z"],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              phases: ["pending", "claimed", "succeeded"],
              recipient_key: `user:${ids.approverA}`,
            },
            {
              phases: ["pending", "claimed", "succeeded"],
              recipient_key: `user:${ids.approverSpanish}`,
            },
          ],
        });
      } finally {
        await deliveryEvidence.end();
      }

      const ownerForReentry = await fixture.connectAsOwner();
      try {
        await ownerForReentry.query(
          "UPDATE license_request SET state = 'approved' WHERE id = $1",
          [ids.requestA],
        );
        await ownerForReentry.query(
          `INSERT INTO request_transition
             (id, request_id, from_state, to_state, occurred_at)
           VALUES ($2, $1, 'pending_approval', 'approved',
                   '2026-08-12T16:00:00Z')`,
          [ids.requestA, ids.transitionReentryApproved],
        );
        await ownerForReentry.query(
          "UPDATE license_request SET state = 'pending_approval' WHERE id = $1",
          [ids.requestA],
        );
        await ownerForReentry.query(
          `INSERT INTO request_transition
             (id, request_id, from_state, to_state, occurred_at)
           VALUES ($2, $1, 'approved', 'pending_approval',
                   '2026-08-13T15:00:00Z')`,
          [ids.requestA, ids.transitionReentryPending],
        );
      } finally {
        await ownerForReentry.end();
      }
      const reentryResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-14T15:00:00.000Z")),
        ),
      );
      expect(
        reentryResults.reduce((sum, result) => sum + result.processed, 0),
      ).toBe(1);
      const reentryEvidence = await fixture.connectAsOwner();
      try {
        await expect(
          reentryEvidence.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM alert_event
             WHERE alert_rule_id = $1
               AND subject_ref->>'requestId' = $2
               AND subject_ref->>'stage' = 'reminder'`,
            [ids.rule, ids.requestA],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 2 }] });
      } finally {
        await reentryEvidence.end();
      }
      const ownerForMappedEscalation = await fixture.connectAsOwner();
      try {
        await ownerForMappedEscalation.query(
          `UPDATE system_setting
           SET value = to_jsonb($1::text)
           WHERE key = 'notif_escalation_email'`,
          [recipients.approverA],
        );
      } finally {
        await ownerForMappedEscalation.end();
      }
      const reentryEscalationResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-17T15:00:00.000Z")),
        ),
      );
      expect(
        reentryEscalationResults.reduce(
          (sum, result) => sum + result.processed,
          0,
        ),
      ).toBe(1);
      const reentryReplayResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-17T15:01:00.000Z")),
        ),
      );
      expect(
        reentryReplayResults.reduce(
          (sum, result) => sum + result.processed,
          0,
        ),
      ).toBe(0);
      const reentryEscalationEvidence = await fixture.connectAsOwner();
      try {
        await expect(
          reentryEscalationEvidence.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM alert_event
             WHERE alert_rule_id = $1
               AND subject_ref->>'requestId' = $2
               AND subject_ref->>'breachStartedAt' =
                   '2026-08-13T15:00:00.000Z'`,
            [ids.rule, ids.requestA],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 2 }] });
        await expect(
          reentryEscalationEvidence.query(
            `SELECT delivery.recipient_key
             FROM alert_notification_delivery delivery
             JOIN alert_event event ON event.id = delivery.alert_event_id
             WHERE event.dedupe_key =
               $1 || ':approval-aging:' || $2 || ':' || $3 || ':escalation'
               AND delivery.phase = 'pending'`,
            [ids.rule, ids.requestA, "2026-08-13T15:00:00.000Z"],
          ),
        ).resolves.toMatchObject({
          rows: [{ recipient_key: `user:${ids.approverA}` }],
        });
        await reentryEscalationEvidence.query(
          "UPDATE license_request SET state = 'approved' WHERE id = $1",
          [ids.requestA],
        );
        await reentryEscalationEvidence.query(
          `UPDATE system_setting
           SET value = to_jsonb($1::text)
           WHERE key = 'notif_escalation_email'`,
          [recipients.escalation],
        );
      } finally {
        await reentryEscalationEvidence.end();
      }
      const mappedListing = { messages: await mailpit!.messages() };
      const mappedEscalation = mappedListing.messages.find(
        ({ Subject, To }) =>
          Subject.includes("Approval escalation") &&
          To.some(({ Address }) => Address === recipients.approverA),
      );
      expect(mappedEscalation).toBeDefined();

      const ownerWithoutApprover = await fixture.connectAsOwner();
      try {
        await ownerWithoutApprover.query(
          `UPDATE company_role_assignment
           SET valid_to = '2026-08-11'
           WHERE id = ANY($1::uuid[])`,
          [[ids.grantA, ids.grantSpanish]],
        );
        await ownerWithoutApprover.query(
          `INSERT INTO license_request
             (id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, created_at, created_by)
           VALUES
             ($1, 'REQ-US017-UNASSIGNED', $2, $3, $4, $5,
              'pending_approval', 'escalate without stale identity',
              '2026-08-12T15:00:00Z',
              '00000000-0000-0000-0000-000000000001')`,
          [
            ids.requestUnassigned,
            ids.requesterA,
            ids.companyA,
            ids.vendorAccount,
            ids.licenseType,
          ],
        );
        await ownerWithoutApprover.query(
          `INSERT INTO request_transition
             (id, request_id, from_state, to_state, occurred_at)
           VALUES
             ($1, $2, 'submitted', 'pending_approval',
              '2026-08-12T15:00:00Z')`,
          [ids.transitionUnassigned, ids.requestUnassigned],
        );
      } finally {
        await ownerWithoutApprover.end();
      }

      const unassignedResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-14T15:00:00.000Z")),
        ),
      );
      expect(
        unassignedResults.reduce((sum, result) => sum + result.processed, 0),
      ).toBe(2);
      const unassignedDb = await fixture.connectAsOwner();
      try {
        await expect(
          unassignedDb.query<{ dedupe_key: string; notified: unknown }>(
            `SELECT dedupe_key, notified
             FROM alert_event
             WHERE alert_rule_id = $1
               AND subject_ref->>'requestId' = $2
             ORDER BY dedupe_key`,
            [
              ids.rule,
              ids.requestUnassigned,
            ],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              dedupe_key:
                `${ids.rule}:approval-aging:${ids.requestUnassigned}:` +
                "2026-08-12T15:00:00.000Z:escalation",
            },
            {
              dedupe_key:
                `${ids.rule}:approval-aging:${ids.requestUnassigned}:` +
                "2026-08-12T15:00:00.000Z:reminder",
              notified: {
                breachStartedAt: "2026-08-12T15:00:00.000Z",
                reason: "NO_CURRENT_APPROVERS",
                stage: "reminder",
                status: "suppressed",
              },
            },
          ],
        });
      } finally {
        await unassignedDb.end();
      }

      const unassignedListing = { messages: await mailpit!.messages() };
      expect(unassignedListing.messages).toHaveLength(7);
      const unassignedSummary = unassignedListing.messages.find(
        ({ Subject }) => Subject.includes("REQ-US017-UNASSIGNED"),
      );
      expect(unassignedSummary).toBeDefined();
      const unassignedDetailResponse = await fetch(
        `${apiOrigin}/api/v1/message/${unassignedSummary!.ID}`,
      );
      const unassignedDetail =
        (await unassignedDetailResponse.json()) as { Text: string };
      expect(unassignedDetail.Text).toContain(
        "sin aprobador actual de la compañía",
      );
      expect(unassignedDetail.Text).not.toContain("Ana Approver");

      const ownerForLateApprover = await fixture.connectAsOwner();
      try {
        await ownerForLateApprover.query(
          `UPDATE company_role_assignment
           SET valid_to = NULL
           WHERE id = $1`,
          [ids.grantA],
        );
      } finally {
        await ownerForLateApprover.end();
      }
      const lateApproverResults = await Promise.all(
        workers.map((worker) =>
          worker.run(new Date("2026-08-14T15:00:00.000Z")),
        ),
      );
      expect(
        lateApproverResults.reduce(
          (sum, result) => sum + result.processed,
          0,
        ),
      ).toBe(0);
      const lateListing = { messages: await mailpit!.messages() };
      expect(lateListing.messages).toHaveLength(7);

      const ownerForDefault = await fixture.connectAsOwner();
      try {
        await ownerForDefault.query(
          `UPDATE alert_rule
           SET threshold = '{"hours":12,"escalationHours":30}'::jsonb
           WHERE id = $1`,
          [ids.rule],
        );
        await ownerForDefault.query(
          `UPDATE company_role_assignment
           SET valid_to = NULL
           WHERE id = $1`,
          [ids.grantA],
        );
        await ownerForDefault.query(
          `UPDATE license_request
           SET state = 'approved'
           WHERE id = $1`,
          [ids.requestUnassigned],
        );
        await ownerForDefault.query(
          `INSERT INTO license_request
             (id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, created_at, created_by)
           VALUES
             ($1, 'REQ-US017-DEFAULT-CALENDAR', $2, $3, $4, $5,
              'pending_approval', 'default injected calendar branch',
              '2026-08-17T15:00:00Z',
              '00000000-0000-0000-0000-000000000001')`,
          [
            ids.requestDefaultCalendar,
            ids.requesterA,
            ids.companyA,
            ids.vendorAccount,
            ids.licenseType,
          ],
        );
        await ownerForDefault.query(
          `INSERT INTO request_transition
             (id, request_id, from_state, to_state, occurred_at)
           VALUES
             ($1, $2, 'submitted', 'pending_approval',
              '2026-08-17T15:00:00Z')`,
          [ids.transitionDefaultCalendar, ids.requestDefaultCalendar],
        );
      } finally {
        await ownerForDefault.end();
      }
      const defaultCalendarJob = createAlertEvaluationJob({
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId: "us017-default-calendar",
      });
      try {
        await expect(
          defaultCalendarJob.run(new Date("2026-08-18T03:00:00.000Z")),
        ).resolves.toEqual({ processed: 1, status: "succeeded" });
      } finally {
        await defaultCalendarJob.close();
      }

      const ownerForFailure = await fixture.connectAsOwner();
      try {
        await ownerForFailure.query(
          `UPDATE license_request
           SET state = 'approved'
           WHERE id = $1`,
          [ids.requestDefaultCalendar],
        );
        await ownerForFailure.query(
          `INSERT INTO license_request
             (id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, created_at, created_by)
           VALUES
             ($1, 'REQ-US017-SMTP-FAILURE', $2, $3, $4, $5,
              'pending_approval', 'journal delivery failure',
              '2026-08-19T15:00:00Z',
              '00000000-0000-0000-0000-000000000001')`,
          [
            ids.requestFailedDelivery,
            ids.requesterA,
            ids.companyA,
            ids.vendorAccount,
            ids.licenseType,
          ],
        );
        await ownerForFailure.query(
          `INSERT INTO request_transition
             (id, request_id, from_state, to_state, occurred_at)
           VALUES
             ($1, $2, 'submitted', 'pending_approval',
              '2026-08-19T15:00:00Z')`,
          [ids.transitionFailedDelivery, ids.requestFailedDelivery],
        );
      } finally {
        await ownerForFailure.end();
      }
      const failingJob = createAlertEvaluationJob({
        connectionString: fixture.appUrl,
        smtpUrl: "smtp://127.0.0.1:1",
        workerId: "us017-smtp-failure",
      });
      try {
        await expect(
          failingJob.run(new Date("2026-08-20T15:00:00.000Z")),
        ).resolves.toMatchObject({ processed: 0, status: "failed" });
      } finally {
        await failingJob.close();
      }
      const failureEvidence = await fixture.connectAsOwner();
      try {
        const journal = await failureEvidence.query<{ phase: string }>(
          `SELECT delivery.phase::text AS phase
           FROM alert_notification_delivery delivery
           JOIN alert_event event ON event.id = delivery.alert_event_id
           WHERE event.dedupe_key = $1
           ORDER BY CASE delivery.phase
             WHEN 'pending' THEN 1
             WHEN 'claimed' THEN 2
             WHEN 'failed' THEN 3
             ELSE 4
           END`,
          [
            `${ids.rule}:approval-aging:${ids.requestFailedDelivery}:` +
              "2026-08-19T15:00:00.000Z:reminder",
          ],
        );
        expect(journal.rows).toEqual([
          { phase: "pending" },
          { phase: "claimed" },
          { phase: "failed" },
        ]);
      } finally {
        await failureEvidence.end();
      }

      const ownerForBusy = await fixture.connectAsOwner();
      try {
        await ownerForBusy.query(
          `UPDATE license_request
           SET state = 'approved'
           WHERE id = $1`,
          [ids.requestFailedDelivery],
        );
        await ownerForBusy.query(
          `INSERT INTO license_request
             (id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, created_at, created_by)
           VALUES
             ($1, 'REQ-US017-BUSY', $2, $3, $4, $5, 'pending_approval',
              'preclaimed approval event', '2026-08-21T15:00:00Z',
              '00000000-0000-0000-0000-000000000001')`,
          [
            ids.requestBusy,
            ids.requesterA,
            ids.companyA,
            ids.vendorAccount,
            ids.licenseType,
          ],
        );
        await ownerForBusy.query(
          `INSERT INTO request_transition
             (id, request_id, from_state, to_state, occurred_at)
           VALUES
             ($1, $2, 'submitted', 'pending_approval',
              '2026-08-21T15:00:00Z')`,
          [ids.transitionBusy, ids.requestBusy],
        );
      } finally {
        await ownerForBusy.end();
      }
      const busyAt = new Date("2026-08-24T15:00:00.000Z");
      const busyOutbox = createAlertNotificationOutbox(fixture.appUrl);
      const busyEvent = await busyOutbox.enqueue({
        alertRuleId: ids.rule,
        deliveries: [{
          email: recipients.approverA,
          key: `user:${ids.approverA}`,
          locale: "en",
          userAccountId: ids.approverA,
        }],
        dedupeKey:
          `${ids.rule}:approval-aging:${ids.requestBusy}:` +
          "2026-08-21T15:00:00.000Z:reminder",
        firedAt: busyAt,
        subjectRef: {
          breachStartedAt: "2026-08-21T15:00:00.000Z",
          requestId: ids.requestBusy,
          stage: "reminder",
        },
      });
      await busyOutbox.claim({
        alertEventId: busyEvent.id,
        at: busyAt,
        leaseMs: 5 * 60_000,
        recipientKey: `user:${ids.approverA}`,
        workerId: "us017-other-worker",
      });
      const busyJob = createAlertEvaluationJob({
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId: "us017-busy-worker",
      });
      try {
        await expect(busyJob.run(busyAt)).resolves.toEqual({
          alertRuleId: ids.rule,
          errorCode: "ALERT_DELIVERY_BUSY",
          processed: 0,
          status: "failed",
        });
      } finally {
        await Promise.all([busyJob.close(), busyOutbox.close()]);
      }

      const ownerForRevokedRecipient = await fixture.connectAsOwner();
      try {
        await ownerForRevokedRecipient.query(
          `UPDATE company_role_assignment
           SET valid_to = '2026-08-23'
           WHERE id = $1`,
          [ids.grantA],
        );
      } finally {
        await ownerForRevokedRecipient.end();
      }
      const revokedRecipientJob = createAlertEvaluationJob({
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId: "us017-revoked-recipient",
      });
      try {
        await expect(
          revokedRecipientJob.run(
            new Date(busyAt.getTime() + 5 * 60_000),
          ),
        ).resolves.toMatchObject({ status: "succeeded" });
      } finally {
        await revokedRecipientJob.close();
      }
      const revokedRecipientEvidence = await fixture.connectAsOwner();
      try {
        await expect(
          revokedRecipientEvidence.query(
            `SELECT delivery.accepted, delivery.provider_message_id
             FROM alert_notification_delivery delivery
             JOIN alert_event event ON event.id = delivery.alert_event_id
             WHERE event.dedupe_key =
                 $1 || ':approval-aging:' || $2 || ':' || $3 || ':reminder'
               AND delivery.recipient_key = $4
               AND delivery.phase = 'succeeded'`,
            [
              ids.rule,
              ids.requestBusy,
              "2026-08-21T15:00:00.000Z",
              `user:${ids.approverA}`,
            ],
          ),
        ).resolves.toMatchObject({
          rows: [{
            accepted: [],
            provider_message_id: "suppressed:recipient-not-authorized",
          }],
        });
      } finally {
        await revokedRecipientEvidence.end();
      }

      const ownerForInvalidSettings = await fixture.connectAsOwner();
      try {
        await ownerForInvalidSettings.query(
          `UPDATE system_setting
           SET value = '42'::jsonb
           WHERE key = 'notif_escalation_email'`,
        );
      } finally {
        await ownerForInvalidSettings.end();
      }
      const invalidSettingsJob = createAlertEvaluationJob({
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId: "us017-invalid-settings",
      });
      try {
        await expect(
          invalidSettingsJob.run(new Date("2026-08-24T16:00:00.000Z")),
        ).resolves.toMatchObject({
          alertRuleId: ids.rule,
          errorCode: "NOTIFICATION_SETTINGS_INVALID",
          status: "failed",
        });
      } finally {
        await invalidSettingsJob.close();
      }
    } finally {
      await Promise.all(workers.map((worker) => worker.close()));
    }
  }, 120_000);
});
