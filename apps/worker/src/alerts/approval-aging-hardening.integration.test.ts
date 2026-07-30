import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  breachWindowStart,
  createAlertEvaluationJob,
  type ApprovalRecipientDeliveryContext,
} from "./evaluate-alerts.js";
import { createMailpitTestJournal } from "./mailpit-test-journal.js";

const smtpUrl = process.env.MAILPIT_TEST_SMTP_URL;
const apiOrigin = process.env.MAILPIT_TEST_API_ORIGIN;
let fixture: PostgresFixture;
const recipients = {
  approverA: `a.hardening+${process.pid}@example.test`,
  approverB: `b.hardening+${process.pid}@example.test`,
};
const mailpit = apiOrigin
  ? createMailpitTestJournal(apiOrigin, Object.values(recipients))
  : undefined;

const ids = {
  approverA: "17100000-0000-4000-8000-000000000001",
  approverB: "17100000-0000-4000-8000-000000000002",
  company: "17100000-0000-4000-8000-000000000003",
  grantA: "17100000-0000-4000-8000-000000000004",
  grantB: "17100000-0000-4000-8000-000000000005",
  licenseType: "17100000-0000-4000-8000-000000000006",
  malformedRule: "17100000-0000-4000-8000-000000000007",
  personA: "17100000-0000-4000-8000-000000000008",
  personB: "17100000-0000-4000-8000-000000000009",
  requester: "17100000-0000-4000-8000-000000000010",
  rule: "17100000-0000-4000-8000-000000000011",
  vendor: "17100000-0000-4000-8000-000000000012",
  vendorAccount: "17100000-0000-4000-8000-000000000013",
};

async function ownerQuery(
  text: string,
  values: unknown[] = [],
): Promise<void> {
  const owner = await fixture.connectAsOwner();
  try {
    await owner.query(text, values);
  } finally {
    await owner.end();
  }
}

async function createPendingRequest(
  suffix: number,
  pendingSince: string,
): Promise<string> {
  const requestId =
    `17100000-0000-4000-8000-${String(100 + suffix).padStart(12, "0")}`;
  await ownerQuery(
    `INSERT INTO license_request
       (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, created_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending_approval',
             'approval hardening evidence', $7,
             '00000000-0000-0000-0000-000000000001')`,
    [
      requestId,
      `REQ-HARDEN-${suffix}`,
      ids.requester,
      ids.company,
      ids.vendorAccount,
      ids.licenseType,
      pendingSince,
    ],
  );
  await ownerQuery(
    `INSERT INTO request_transition
       (request_id, from_state, to_state, occurred_at)
     VALUES ($1, 'submitted', 'pending_approval', $2)`,
    [requestId, pendingSince],
  );
  return requestId;
}

async function messageCount(): Promise<number> {
  return (await mailpit!.messages()).length;
}

async function messageRecipients(): Promise<string[]> {
  return (await mailpit!.messages())
    .flatMap(({ To }) => To.map(({ Address }) => Address))
    .sort();
}

function appUrlWithTimezone(timezone: string): string {
  const url = new URL(fixture.appUrl);
  url.searchParams.set("options", `-c timezone=${timezone}`);
  return url.toString();
}

async function suppressionEvidence(
  requestId: string,
): Promise<Array<{ accepted: unknown; providerMessageId: string }>> {
  const owner = await fixture.connectAsOwner();
  try {
    const result = await owner.query<{
      accepted: unknown;
      provider_message_id: string;
    }>(
      `SELECT delivery.accepted, delivery.provider_message_id
       FROM alert_notification_delivery delivery
       JOIN alert_event event ON event.id = delivery.alert_event_id
       WHERE event.subject_ref->>'requestId' = $1
         AND delivery.phase = 'succeeded'
       ORDER BY delivery.recipient_key`,
      [requestId],
    );
    return result.rows.map(({ accepted, provider_message_id }) => ({
      accepted,
      providerMessageId: provider_message_id,
    }));
  } finally {
    await owner.end();
  }
}

describe.runIf(smtpUrl && apiOrigin)(
  "US-017 approval aging delivery hardening",
  () => {
    it("rejects an invalid evaluation instant with its stable contract error", () => {
      expect(() => breachWindowStart(new Date(Number.NaN))).toThrow(
        "at must be a valid date",
      );
    });

    beforeAll(async () => {
      fixture = await createPostgresFixture();
      await fixture.migrate();
      await ownerQuery("UPDATE alert_rule SET enabled = false");
      await ownerQuery(
        `INSERT INTO company
           (id, name, code, type, status, created_at, created_by)
         VALUES ($1, 'Approval hardening', 'HARDEN-US017', 'internal',
                 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [ids.company],
      );
      await ownerQuery(
        `INSERT INTO vendor
           (id, name, connector_type, provisioning_protocol, can_provision,
            can_deprovision, has_usage_data, has_cost_data, identity_matching,
            status, created_at, created_by)
         VALUES ($1, 'Approval hardening vendor', 'orchestration', 'none',
                 false, false, false, false, 'email', 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [ids.vendor],
      );
      await ownerQuery(
        `INSERT INTO vendor_account
           (id, vendor_id, name, mode, low_pool_floor, status, created_at,
            created_by)
         VALUES ($1, $2, 'Approval hardening account', 'orchestration', 0,
                 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [ids.vendorAccount, ids.vendor],
      );
      await ownerQuery(
        `INSERT INTO license_type
           (id, vendor_id, name, unit, status, created_at, created_by)
         VALUES ($1, $2, 'Approval hardening seat', 'seat', 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [ids.licenseType, ids.vendor],
      );
      await ownerQuery(
        `INSERT INTO person
           (id, email, full_name, company_id, status, created_at, created_by)
         VALUES
           ($1, 'a.hardening@example.test', 'Approver A', $4, 'active',
            now(), '00000000-0000-0000-0000-000000000001'),
           ($2, 'b.hardening@example.test', 'Approver B', $4, 'active',
            now(), '00000000-0000-0000-0000-000000000001'),
           ($3, 'requester.hardening@example.test', 'Requester', $4, 'active',
            now(), '00000000-0000-0000-0000-000000000001')`,
        [ids.personA, ids.personB, ids.requester, ids.company],
      );
      await ownerQuery(
        `INSERT INTO user_account
           (id, email, idp_subject, person_id, ui_language, status, created_at,
            created_by)
         VALUES
           ($1, 'a.hardening@example.test', 'hardening-a', $3, 'en', 'active',
            now(), '00000000-0000-0000-0000-000000000001'),
           ($2, 'b.hardening@example.test', 'hardening-b', $4, 'es', 'active',
            now(), '00000000-0000-0000-0000-000000000001')`,
        [ids.approverA, ids.approverB, ids.personA, ids.personB],
      );
      await ownerQuery(
        `UPDATE person
         SET email = CASE id
           WHEN $1 THEN $3
           WHEN $2 THEN $4
         END
         WHERE id = ANY($5::uuid[])`,
        [
          ids.personA,
          ids.personB,
          recipients.approverA,
          recipients.approverB,
          [ids.personA, ids.personB],
        ],
      );
      await ownerQuery(
        `UPDATE user_account
         SET email = CASE id
           WHEN $1 THEN $3
           WHEN $2 THEN $4
         END
         WHERE id = ANY($5::uuid[])`,
        [
          ids.approverA,
          ids.approverB,
          recipients.approverA,
          recipients.approverB,
          [ids.approverA, ids.approverB],
        ],
      );
      await ownerQuery(
        `INSERT INTO company_role_assignment
           (id, user_account_id, company_id, role, unique_grant, created_at,
            created_by)
         VALUES
           ($1, $3, $5, 'approver', 'hardening-a', now(),
            '00000000-0000-0000-0000-000000000001'),
           ($2, $4, $5, 'approver', 'hardening-b', now(),
            '00000000-0000-0000-0000-000000000001')`,
        [
          ids.grantA,
          ids.grantB,
          ids.approverA,
          ids.approverB,
          ids.company,
        ],
      );
      await ownerQuery(
        `INSERT INTO alert_rule
           (id, type, scope_kind, company_id, threshold, channel, enabled,
            created_at, created_by)
         VALUES
           ($1, 'approval_aging', 'company', $3, '{"hours":1}', 'email', true,
            '2026-01-01T00:00:00Z',
            '00000000-0000-0000-0000-000000000001'),
           ($2, 'approval_aging', 'company', $3,
            '{"hours":1,"escalationHours":100}', 'email', true,
            '2026-01-02T00:00:00Z',
            '00000000-0000-0000-0000-000000000001')`,
        [ids.malformedRule, ids.rule, ids.company],
      );
    }, 120_000);

    afterAll(async () => {
      await fixture.stop();
    });

    beforeEach(async () => {
      await mailpit!.clear();
      await ownerQuery(
        `UPDATE license_request SET state = 'approved'
         WHERE company_id = $1`,
        [ids.company],
      );
      await ownerQuery(
        `UPDATE company_role_assignment
         SET valid_from = NULL, valid_to = NULL
         WHERE id = ANY($1::uuid[])`,
        [[ids.grantA, ids.grantB]],
      );
    });

    it("continues past a malformed early rule and reports its first failure after later work", async () => {
      const requestId = await createPendingRequest(
        1,
        "2026-08-10T14:00:00.000Z",
      );
      const job = createAlertEvaluationJob({
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId: "hardening-malformed",
      });
      try {
        await expect(
          job.run(new Date("2026-08-10T16:00:00.000Z")),
        ).resolves.toMatchObject({
          alertRuleId: ids.malformedRule,
          processed: 1,
          status: "failed",
        });
        expect(await messageCount()).toBe(2);
        const owner = await fixture.connectAsOwner();
        try {
          await expect(
            owner.query(
              `SELECT alert_rule_id
               FROM alert_event
               WHERE subject_ref->>'requestId' = $1
               ORDER BY alert_rule_id`,
              [requestId],
            ),
          ).resolves.toMatchObject({
            rows: [{ alert_rule_id: ids.rule }],
          });
        } finally {
          await owner.end();
        }
      } finally {
        await job.close();
      }
      await expect(
        job.run(new Date("2026-08-10T16:15:00.000Z")),
      ).rejects.toThrow("Cannot use a pool after calling end on the pool");
    });

    it.each([
      ["approved", 2],
      ["reentered", 3],
    ] as const)(
      "suppresses a claimed recipient when the request is %s before SMTP",
      async (change, suffix) => {
        const requestId = await createPendingRequest(
          suffix,
          "2026-08-10T14:00:00.000Z",
        );
        let changed = false;
        const job = createAlertEvaluationJob({
          beforeApprovalRecipientDelivery: async () => {
            if (changed) return;
            changed = true;
            await ownerQuery(
              "UPDATE license_request SET state = 'approved' WHERE id = $1",
              [requestId],
            );
            if (change === "reentered") {
              await ownerQuery(
                `INSERT INTO request_transition
                   (request_id, from_state, to_state, occurred_at)
                 VALUES ($1, 'approved', 'pending_approval',
                         '2026-08-10T15:30:00.000Z')`,
                [requestId],
              );
              await ownerQuery(
                `UPDATE license_request
                 SET state = 'pending_approval'
                 WHERE id = $1`,
                [requestId],
              );
            }
          },
          connectionString: fixture.appUrl,
          smtpUrl: smtpUrl!,
          workerId: `hardening-${change}`,
        });
        try {
          await job.run(new Date("2026-08-10T16:00:00.000Z"));
          expect(await messageCount()).toBe(0);
          expect(await suppressionEvidence(requestId)).toEqual([
            {
              accepted: [],
              providerMessageId:
                "suppressed:approval-breach-not-current",
            },
            {
              accepted: [],
              providerMessageId:
                "suppressed:approval-breach-not-current",
            },
          ]);
        } finally {
          await job.close();
        }
      },
    );

    it("revalidates each recipient so a state change after the first mail stops the second", async () => {
      const requestId = await createPendingRequest(
        4,
        "2026-08-10T14:00:00.000Z",
      );
      let delivery = 0;
      const job = createAlertEvaluationJob({
        beforeApprovalRecipientDelivery: async (
          _context: ApprovalRecipientDeliveryContext,
        ) => {
          delivery += 1;
          if (delivery === 2) {
            await ownerQuery(
              "UPDATE license_request SET state = 'approved' WHERE id = $1",
              [requestId],
            );
          }
        },
        connectionString: fixture.appUrl,
        smtpUrl: smtpUrl!,
        workerId: "hardening-per-recipient",
      });
      try {
        await job.run(new Date("2026-08-10T16:00:00.000Z"));
        expect(await messageCount()).toBe(1);
        expect(await suppressionEvidence(requestId)).toEqual([
          {
            accepted: [recipients.approverA],
            providerMessageId: expect.stringMatching(/.+/),
          },
          {
            accepted: [],
            providerMessageId:
              "suppressed:approval-breach-not-current",
          },
        ]);
      } finally {
        await job.close();
      }
    });

    it("uses the Ecuador operating date for snapshot and delivery grant validity", async () => {
      const beforeBoundary = await createPendingRequest(
        5,
        "2026-08-10T14:00:00.000Z",
      );
      await ownerQuery(
        "UPDATE company_role_assignment SET valid_to = '2026-08-11' WHERE id = $1",
        [ids.grantB],
      );
      let changed = false;
      const beforeJob = createAlertEvaluationJob({
        beforeApprovalRecipientDelivery: async ({ recipientKey }) => {
          if (changed || recipientKey !== `user:${ids.approverA}`) return;
          changed = true;
          await ownerQuery(
            "UPDATE company_role_assignment SET valid_from = '2026-08-12' WHERE id = $1",
            [ids.grantA],
          );
        },
        connectionString: appUrlWithTimezone("UTC"),
        smtpUrl: smtpUrl!,
        workerId: "hardening-date-before",
      });
      try {
        await beforeJob.run(new Date("2026-08-12T04:59:00.000Z"));
        expect(await messageRecipients()).toEqual([
          recipients.approverB,
        ]);
        expect(await suppressionEvidence(beforeBoundary)).toContainEqual({
          accepted: [],
          providerMessageId: "suppressed:recipient-not-authorized",
        });
      } finally {
        await beforeJob.close();
      }

      await ownerQuery(
        "UPDATE license_request SET state = 'approved' WHERE id = $1",
        [beforeBoundary],
      );
      await mailpit!.clear();
      await createPendingRequest(6, "2026-08-10T14:00:00.000Z");
      const boundaryJob = createAlertEvaluationJob({
        connectionString: appUrlWithTimezone("UTC"),
        smtpUrl: smtpUrl!,
        workerId: "hardening-date-at",
      });
      try {
        await boundaryJob.run(new Date("2026-08-12T05:00:00.000Z"));
        expect(await messageRecipients()).toEqual([
          recipients.approverA,
        ]);
      } finally {
        await boundaryJob.close();
      }
    });
  },
);
