import { once } from "node:events";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../../packages/db/src/testing/postgres-container.js";
import {
  createAlertNotificationOutbox,
  createSmtpMailer,
} from "@smp/notifications";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAlertEvaluationJob } from "./evaluate-alerts.js";

let fixture: PostgresFixture;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
}, 120_000);

afterAll(async () => {
  await fixture.stop();
});

async function ownerQuery(text: string, values: unknown[] = []): Promise<void> {
  const client = await fixture.connectAsOwner();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

describe("US-042 alert evaluation worker", () => {
  it("evaluates a real pool breach, sends SMTP once, and persists append-only delivery evidence", async () => {
    const messages: string[] = [];
    const smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ["AUTH", "STARTTLS"],
      onData(stream, _session, callback) {
        let message = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          message += chunk;
        });
        stream.on("end", () => {
          messages.push(message);
          callback();
        });
      },
    });
    smtp.listen(0, "127.0.0.1");
    await once(smtp.server, "listening");
    const address = smtp.server.address();
    if (!address || typeof address === "string") {
      throw new Error("SMTP test server did not expose a TCP port");
    }

    const ids = {
      capacity: "00000000-0000-4000-8000-000000004254",
      licenseType: "00000000-0000-4000-8000-000000004253",
      vendor: "00000000-0000-4000-8000-000000004251",
      vendorAccount: "00000000-0000-4000-8000-000000004252",
    };
    await ownerQuery(
      `INSERT INTO vendor
         (id, name, connector_type, provisioning_protocol, can_provision,
          can_deprovision, has_usage_data, has_cost_data, identity_matching,
          status, created_at, created_by)
       VALUES
         ($1, 'US-042 Vendor', 'orchestration', 'none', false, false, false,
          false, 'email', 'active', now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.vendor],
    );
    await ownerQuery(
      `INSERT INTO vendor_account
       (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
       VALUES
         ($1, $2, 'US-042 Account', 'orchestration', 9, 'active', now(),
          '00000000-0000-0000-0000-000000000001')`,
      [ids.vendorAccount, ids.vendor],
    );
    await ownerQuery(
      `INSERT INTO license_type
         (id, vendor_id, name, unit, status, created_at, created_by)
       VALUES
         ($1, $2, 'US-042 Seat', 'seat', 'active', now(),
          '00000000-0000-0000-0000-000000000001')`,
      [ids.licenseType, ids.vendor],
    );
    await ownerQuery(
      `INSERT INTO vendor_account_capacity
       (id, vendor_account_id, license_type_id, purchased_qty, effective_from,
          created_at, created_by)
       VALUES
         ($1, $2, $3, 8, '2026-07-01', '2026-07-01T00:00:00Z',
          '00000000-0000-0000-0000-000000000001')`,
      [ids.capacity, ids.vendorAccount, ids.licenseType],
    );
    await ownerQuery(
      `INSERT INTO close_run (period, status, started_at, finished_at, created_at)
       VALUES ('2026-06', 'succeeded', '2026-07-03T15:00:00Z',
               '2026-07-03T15:01:00Z', '2026-07-03T15:00:00Z')`,
    );

    const job = createAlertEvaluationJob({
      connectionString: fixture.appUrl,
      mailer: createSmtpMailer(`smtp://127.0.0.1:${address.port}`),
      workerId: "worker-us-042",
    });
    const at = new Date("2026-07-27T15:07:00.000Z");
    try {
      const firstRun = await job.run(at);
      expect(firstRun).toEqual({
        processed: 1,
        status: "succeeded",
      });
      await expect(job.run(new Date("2026-07-27T15:14:59.000Z"))).resolves.toEqual({
        processed: 0,
        status: "succeeded",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("Subject: Alerta de Ledger: low_pool");
      expect(messages[0]).toContain("Abre Ledger para revisarla.");

      const owner = await fixture.connectAsOwner();
      try {
        const evidence = await owner.query<{
          dedupe_key: string;
          phases: string[];
          stored_notified: unknown;
        }>(
          `SELECT event.dedupe_key, event.notified AS stored_notified,
                  array_agg(delivery.phase::text ORDER BY delivery.attempt, delivery.phase) AS phases
           FROM alert_event event
           JOIN alert_rule rule ON rule.id = event.alert_rule_id
           JOIN alert_notification_delivery delivery ON delivery.alert_event_id = event.id
           WHERE rule.type = 'low_pool'
             AND event.subject_ref = $1::jsonb
           GROUP BY event.id`,
          [JSON.stringify({
            licenseTypeId: ids.licenseType,
            vendorAccountId: ids.vendorAccount,
          })],
        );
        expect(evidence.rows).toEqual([
          {
            dedupe_key:
              `00000000-0000-4000-8000-000000004204:breach:low_pool:${ids.licenseType}:${ids.vendorAccount}:2026-07-27T15:00:00.000Z`,
            phases: ["pending", "claimed", "succeeded"],
            stored_notified: { status: "pending" },
          },
        ]);
      } finally {
        await owner.end();
      }
    } finally {
      await job.close();
      await new Promise<void>((resolve, reject) => {
        smtp.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 30_000);

  it("fires close_missed only after business day three when the prior period has no CloseRun", async () => {
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
    if (!address || typeof address === "string") {
      throw new Error("SMTP test server did not expose a TCP port");
    }
    const job = createAlertEvaluationJob({
      calendar: { holidays: new Set(["2026-08-03"]) },
      connectionString: fixture.appUrl,
      mailer: createSmtpMailer(`smtp://127.0.0.1:${address.port}`),
      workerId: "worker-close-042",
    });
    try {
      await job.run(new Date("2026-08-06T15:07:00.000Z"));
      await job.run(new Date("2026-08-07T15:07:00.000Z"));
      await ownerQuery(
        `INSERT INTO close_run (period, status, started_at, finished_at, created_at)
         VALUES ('2026-08', 'succeeded', '2026-09-03T15:00:00Z',
                 '2026-09-03T15:01:00Z', '2026-09-03T15:00:00Z')`,
      );
      await job.run(new Date("2026-09-04T15:07:00.000Z"));

      const owner = await fixture.connectAsOwner();
      try {
        const closeEvents = await owner.query<{ subject_ref: unknown }>(
          `SELECT event.subject_ref
           FROM alert_event event
           JOIN alert_rule rule ON rule.id = event.alert_rule_id
           WHERE rule.type = 'close_missed'
           ORDER BY event.fired_at`,
        );
        expect(closeEvents.rows).toEqual([
          { subject_ref: { period: "2026-07" } },
        ]);
      } finally {
        await owner.end();
      }
    } finally {
      await job.close();
      await new Promise<void>((resolve, reject) => {
        smtp.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 30_000);

  it("returns structured failure for a busy lease and journals every post-claim settings error", async () => {
    await ownerQuery(
      `UPDATE alert_rule SET enabled = (id = '00000000-0000-4000-8000-000000004204')`,
    );
    const outbox = createAlertNotificationOutbox(fixture.appUrl);
    const subject = {
      licenseTypeId: "00000000-0000-4000-8000-000000004253",
      vendorAccountId: "00000000-0000-4000-8000-000000004252",
    };
    const busyAt = new Date("2026-10-20T15:07:00.000Z");
    const busyDedupe =
      `00000000-0000-4000-8000-000000004204:breach:low_pool:${subject.licenseTypeId}:${subject.vendorAccountId}:2026-10-20T15:00:00.000Z`;
    const busyEvent = await outbox.enqueue({
      alertRuleId: "00000000-0000-4000-8000-000000004204",
      dedupeKey: busyDedupe,
      firedAt: new Date("2026-10-20T15:00:00.000Z"),
      subjectRef: subject,
    });
    await outbox.claim({
      alertEventId: busyEvent.id,
      at: busyAt,
      leaseMs: 300_000,
      workerId: "other-worker",
    });
    const job = createAlertEvaluationJob({
      connectionString: fixture.appUrl,
      mailer: { send: async () => ({ accepted: [], providerMessageId: "unused" }) },
      workerId: "worker-guard-042",
    });
    try {
      await expect(job.run(busyAt)).resolves.toEqual({
        alertRuleId: "00000000-0000-4000-8000-000000004204",
        errorCode: "ALERT_DELIVERY_BUSY",
        processed: 0,
        status: "failed",
      });

      await ownerQuery(
        `UPDATE system_setting SET value = '42'::jsonb
         WHERE key = 'notif_sender_email'`,
      );
      const failedAt = new Date("2026-10-20T15:22:00.000Z");
      await expect(job.run(failedAt)).resolves.toEqual({
        alertRuleId: "00000000-0000-4000-8000-000000004204",
        errorCode: "NOTIFICATION_SETTINGS_INVALID",
        processed: 0,
        status: "failed",
      });

      const owner = await fixture.connectAsOwner();
      try {
        const journal = await owner.query<{ phase: string }>(
          `SELECT delivery.phase::text AS phase
           FROM alert_notification_delivery delivery
           JOIN alert_event event ON event.id = delivery.alert_event_id
           WHERE event.dedupe_key =
             '00000000-0000-4000-8000-000000004204:breach:low_pool:00000000-0000-4000-8000-000000004253:00000000-0000-4000-8000-000000004252:2026-10-20T15:15:00.000Z'
           ORDER BY delivery.attempt,
             CASE delivery.phase
               WHEN 'pending' THEN 0
               WHEN 'claimed' THEN 1
               WHEN 'failed' THEN 2
               ELSE 3
             END`,
        );
        expect(journal.rows).toEqual([
          { phase: "pending" },
          { phase: "claimed" },
          { phase: "failed" },
        ]);
      } finally {
        await owner.end();
      }
    } finally {
      await ownerQuery(
        `UPDATE system_setting SET value = '"ledger@corporativo.ec"'::jsonb
         WHERE key = 'notif_sender_email'`,
      );
      await Promise.all([job.close(), outbox.close()]);
    }
  }, 30_000);

  it("ages from the latest transition and rejects company low-pool rules on shared demand", async () => {
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
    const ids = {
      approvalRule: "00000000-0000-4000-8000-000000004272",
      assignment: "00000000-0000-4000-8000-000000004273",
      blockedRequest: "00000000-0000-4000-8000-000000004284",
      blockedRule: "00000000-0000-4000-8000-000000004285",
      closeRule: "00000000-0000-4000-8000-000000004288",
      companyA: "00000000-0000-4000-8000-000000004274",
      companyB: "00000000-0000-4000-8000-000000004275",
      personA: "00000000-0000-4000-8000-000000004276",
      personB: "00000000-0000-4000-8000-000000004277",
      poolRule: "00000000-0000-4000-8000-000000004278",
      provisioningAction: "00000000-0000-4000-8000-000000004289",
      request: "00000000-0000-4000-8000-000000004279",
      vendorPoolRule: "00000000-0000-4000-8000-000000004290",
    };
    await ownerQuery(
      `INSERT INTO company (id, name, code, type, status, created_at, created_by)
       VALUES
         ($1, 'Scope A', 'SCOPE-A-042', 'internal', 'active', now(), '00000000-0000-0000-0000-000000000001'),
         ($2, 'Scope B', 'SCOPE-B-042', 'external', 'active', now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.companyA, ids.companyB],
    );
    await ownerQuery(
      `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
       VALUES
         ($1, 'scope-a-042@example.com', 'Scope A', $3, 'active', now(), '00000000-0000-0000-0000-000000000001'),
         ($2, 'scope-b-042@example.com', 'Scope B', $4, 'active', now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.personA, ids.personB, ids.companyA, ids.companyB],
    );
    await ownerQuery(
      `INSERT INTO license_assignment
         (id, person_id, company_id, vendor_account_id, license_type_id,
          started_on, source_kind, created_at, created_by)
       VALUES ($1, $2, $3, '00000000-0000-4000-8000-000000004252',
               '00000000-0000-4000-8000-000000004253', '2026-07-01',
               'import', '2026-07-01T00:00:00Z',
               '00000000-0000-0000-0000-000000000001')`,
      [ids.assignment, ids.personB, ids.companyB],
    );
    await ownerQuery(
      `INSERT INTO alert_rule
         (id, type, scope_kind, company_id, threshold, channel, enabled, created_at, created_by)
       VALUES
         ($1, 'low_pool', 'company', $3, '{"floor":1}', 'email', true, now(), '00000000-0000-0000-0000-000000000001'),
         ($2, 'approval_aging', 'company', $3, '{"hours":24,"escalationHours":48}', 'email', true, now(), '00000000-0000-0000-0000-000000000001'),
         ($4, 'blocked_no_seat', 'company', $3, '{"businessDays":1}', 'email', true, now(), '00000000-0000-0000-0000-000000000001'),
         ($5, 'close_missed', 'company', $3, '{"businessDays":3}', 'email', true, now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.poolRule, ids.approvalRule, ids.companyA, ids.blockedRule, ids.closeRule],
    );
    await ownerQuery(
      `INSERT INTO alert_rule
         (id, type, scope_kind, vendor_account_id, threshold, channel, enabled,
          created_at, created_by)
       VALUES
         ($1, 'low_pool', 'vendor_account',
          '00000000-0000-4000-8000-000000004252', '{"floor":1}', 'email',
          true, now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.vendorPoolRule],
    );
    await ownerQuery(
      `INSERT INTO license_request
         (id, request_no, person_id, company_id, vendor_account_id, license_type_id,
          state, justification, created_at, created_by)
       VALUES
         ($1, 'REQ-AGE-042', $2, $3,
          '00000000-0000-4000-8000-000000004252',
          '00000000-0000-4000-8000-000000004253',
          'pending_approval', 'age evidence', '2026-01-01T00:00:00Z',
          '00000000-0000-0000-0000-000000000001'),
         ($4, 'REQ-BLOCKED-042', $2, $3,
          '00000000-0000-4000-8000-000000004252',
          '00000000-0000-4000-8000-000000004253',
          'blocked_no_seat', 'business-day age evidence', '2026-01-01T00:00:00Z',
          '00000000-0000-0000-0000-000000000001')`,
      [ids.request, ids.personA, ids.companyA, ids.blockedRequest],
    );
    await ownerQuery(
      `INSERT INTO request_transition (id, request_id, from_state, to_state, occurred_at)
       VALUES
         ('00000000-0000-4000-8000-000000004281', $1, 'submitted', 'pending_approval', '2026-07-01T00:00:00Z'),
         ('00000000-0000-4000-8000-000000004282', $1, 'submitted', 'pending_approval', '2026-07-27T14:30:00Z'),
         ('00000000-0000-4000-8000-000000004283', $1, 'submitted', 'pending_approval', '2026-07-27T14:30:00Z'),
         ('00000000-0000-4000-8000-000000004286', $2, 'submitted', 'blocked_no_seat', '2026-07-01T00:00:00Z'),
         ('00000000-0000-4000-8000-000000004287', $2, 'submitted', 'blocked_no_seat', '2026-07-27T14:30:00Z')`,
      [ids.request, ids.blockedRequest],
    );
    await ownerQuery(
      `UPDATE vendor_account_capacity
       SET purchased_qty = 2
       WHERE id = '00000000-0000-4000-8000-000000004254'`,
    );
    await ownerQuery(
      `INSERT INTO provisioning_action
         (id, request_id, vendor_account_id, kind, mode, status, created_at)
       VALUES ($1, $2, '00000000-0000-4000-8000-000000004252',
               'invite', 'automated', 'pending', now())`,
      [ids.provisioningAction, ids.request],
    );
    const job = createAlertEvaluationJob({
      connectionString: fixture.appUrl,
      mailer: createSmtpMailer(`smtp://127.0.0.1:${address.port}`),
      workerId: "worker-facts-042",
    });
    try {
      await job.run(new Date("2026-07-27T15:07:00Z"));
      const ownerAfterAging = await fixture.connectAsOwner();
      try {
        await expect(
          ownerAfterAging.query(
            "SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id = $1",
            [ids.approvalRule],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
        await expect(
          ownerAfterAging.query(
            "SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id = $1",
            [ids.blockedRule],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
        await expect(
          ownerAfterAging.query(
            "SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id = $1",
            [ids.closeRule],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
        await expect(
          ownerAfterAging.query(
            `SELECT subject_ref FROM alert_event WHERE alert_rule_id = $1`,
            [ids.poolRule],
          ),
        ).resolves.toMatchObject({ rows: [] });
        await expect(
          ownerAfterAging.query(
            `SELECT subject_ref FROM alert_event WHERE alert_rule_id = $1`,
            [ids.vendorPoolRule],
          ),
        ).resolves.toMatchObject({
          rows: [{
            subject_ref: {
              licenseTypeId: "00000000-0000-4000-8000-000000004253",
              vendorAccountId: "00000000-0000-4000-8000-000000004252",
            },
          }],
        });
      } finally {
        await ownerAfterAging.end();
      }

      await expect(job.run(new Date("2026-08-07T15:07:00Z"))).resolves.toMatchObject({
        status: "succeeded",
      });
      const owner = await fixture.connectAsOwner();
      try {
        await expect(
          owner.query(
            "SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id = $1",
            [ids.approvalRule],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 2 }] });
        await expect(
          owner.query(
            "SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id = $1",
            [ids.blockedRule],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 1 }] });
        await expect(
          owner.query(
            "SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id = $1",
            [ids.closeRule],
          ),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      } finally {
        await owner.end();
      }
    } finally {
      await job.close();
      await new Promise<void>((resolve, reject) => {
        smtp.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 30_000);

  it("counts only automated pending and sent invites in each account-license pool", async () => {
    const ids = {
      company: "00000000-0000-4000-8000-000000004401",
      vendor: "00000000-0000-4000-8000-000000004402",
      vendorAccount: "00000000-0000-4000-8000-000000004403",
      rule: "00000000-0000-4000-8000-000000004404",
      pendingType: "00000000-0000-4000-8000-000000004405",
      sentType: "00000000-0000-4000-8000-000000004406",
      orchestrationType: "00000000-0000-4000-8000-000000004407",
      failedType: "00000000-0000-4000-8000-000000004408",
    };
    const personIds = [
      "00000000-0000-4000-8000-000000004409",
      "00000000-0000-4000-8000-000000004410",
      "00000000-0000-4000-8000-000000004411",
      "00000000-0000-4000-8000-000000004412",
    ];
    const requestIds = [
      "00000000-0000-4000-8000-000000004413",
      "00000000-0000-4000-8000-000000004414",
      "00000000-0000-4000-8000-000000004415",
      "00000000-0000-4000-8000-000000004416",
    ];
    const licenseTypeIds = [
      ids.pendingType,
      ids.sentType,
      ids.orchestrationType,
      ids.failedType,
    ];
    await ownerQuery("UPDATE alert_rule SET enabled = false");
    await ownerQuery(
      `INSERT INTO company (id, name, code, type, status, created_at, created_by)
       VALUES ($1, 'Pending-seat scope', 'PENDING-SEAT-042', 'internal',
               'active', now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.company],
    );
    await ownerQuery(
      `INSERT INTO vendor
         (id, name, connector_type, provisioning_protocol, can_provision,
          can_deprovision, has_usage_data, has_cost_data, identity_matching,
          status, created_at, created_by)
       VALUES ($1, 'Pending-seat vendor', 'api', 'rest', true, true, false,
               false, 'email', 'active', now(),
               '00000000-0000-0000-0000-000000000001')`,
      [ids.vendor],
    );
    await ownerQuery(
      `INSERT INTO vendor_account
         (id, vendor_id, name, mode, low_pool_floor, status, created_at,
          created_by)
       VALUES ($1, $2, 'Pending-seat account', 'automated', 1, 'active',
               now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.vendorAccount, ids.vendor],
    );
    for (const [index, licenseTypeId] of licenseTypeIds.entries()) {
      await ownerQuery(
        `INSERT INTO license_type
           (id, vendor_id, name, unit, status, created_at, created_by)
         VALUES ($1, $2, $3, 'seat', 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [licenseTypeId, ids.vendor, `Pending seat ${index}`],
      );
      await ownerQuery(
        `INSERT INTO vendor_account_capacity
           (id, vendor_account_id, license_type_id, purchased_qty,
            effective_from, created_at, created_by)
         VALUES (gen_random_uuid(), $1, $2, 1, '2026-07-01',
                 '2026-07-01T00:00:00Z',
                 '00000000-0000-0000-0000-000000000001')`,
        [ids.vendorAccount, licenseTypeId],
      );
      await ownerQuery(
        `INSERT INTO person
           (id, email, full_name, company_id, status, created_at, created_by)
         VALUES ($1, $2, $3, $4, 'active', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [
          personIds[index],
          `pending-seat-${index}@example.com`,
          `Pending seat ${index}`,
          ids.company,
        ],
      );
      await ownerQuery(
        `INSERT INTO license_request
           (id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'active',
                 'pending-seat evidence', '2026-07-01T00:00:00Z',
                 '00000000-0000-0000-0000-000000000001')`,
        [
          requestIds[index],
          `REQ-PENDING-SEAT-${index}`,
          personIds[index],
          ids.company,
          ids.vendorAccount,
          licenseTypeId,
        ],
      );
    }
    const actions = [
      [requestIds[0], "automated", "pending"],
      [requestIds[1], "automated", "sent"],
      [requestIds[2], "orchestration", "pending"],
      [requestIds[3], "automated", "failed"],
    ];
    for (const [requestId, mode, status] of actions) {
      await ownerQuery(
        `INSERT INTO provisioning_action
         (id, request_id, vendor_account_id, kind, mode, status, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'invite',
                 $3::provisioning_action_mode_enum,
                 $4::provisioning_action_status_enum, '2026-07-01T00:00:00Z')`,
        [requestId, ids.vendorAccount, mode, status],
      );
    }
    await ownerQuery(
      `INSERT INTO alert_rule
         (id, type, scope_kind, vendor_account_id, threshold, channel, enabled,
          created_at, created_by)
       VALUES ($1, 'low_pool', 'vendor_account', $2, '{"floor":1}', 'email',
               true, now(), '00000000-0000-0000-0000-000000000001')`,
      [ids.rule, ids.vendorAccount],
    );

    const job = createAlertEvaluationJob({
      connectionString: fixture.appUrl,
      mailer: {
        send: async () => ({
          accepted: ["admin@corporativo.ec"],
          providerMessageId: "pending-seat-alert-042",
        }),
      },
      workerId: "worker-pending-seat-042",
    });
    try {
      await expect(
        job.run(new Date("2026-07-27T15:07:00Z")),
      ).resolves.toMatchObject({ processed: 2, status: "succeeded" });
      const owner = await fixture.connectAsOwner();
      try {
        const events = await owner.query<{ subject_ref: unknown }>(
          `SELECT subject_ref
           FROM alert_event
           WHERE alert_rule_id = $1
           ORDER BY subject_ref->>'licenseTypeId'`,
          [ids.rule],
        );
        expect(events.rows).toEqual([
          {
            subject_ref: {
              licenseTypeId: ids.pendingType,
              vendorAccountId: ids.vendorAccount,
            },
          },
          {
            subject_ref: {
              licenseTypeId: ids.sentType,
              vendorAccountId: ids.vendorAccount,
            },
          },
        ]);
      } finally {
        await owner.end();
      }
    } finally {
      await job.close();
    }
  }, 30_000);

  it("alerts only pending left-company removal actions at the Ecuador business-date deadline", async () => {
    const ids = {
      company: "00000000-0000-4000-8000-000000004291",
      otherCompany: "00000000-0000-4000-8000-000000004292",
      vendor: "00000000-0000-4000-8000-000000004293",
      vendorAccount: "00000000-0000-4000-8000-000000004294",
      licenseType: "00000000-0000-4000-8000-000000004295",
      rule: "00000000-0000-4000-8000-000000004296",
      fridayRequest: "00000000-0000-4000-8000-000000004297",
      weekendRequest: "00000000-0000-4000-8000-000000004298",
      inactiveRequest: "00000000-0000-4000-8000-000000004299",
      reallocatedRequest: "00000000-0000-4000-8000-000000004300",
      otherCompanyRequest: "00000000-0000-4000-8000-000000004301",
      completedRequest: "00000000-0000-4000-8000-000000004307",
      failedRequest: "00000000-0000-4000-8000-000000004308",
      supersededRequest: "00000000-0000-4000-8000-000000004309",
    };
    const personIds = [
      "00000000-0000-4000-8000-000000004302",
      "00000000-0000-4000-8000-000000004303",
      "00000000-0000-4000-8000-000000004304",
      "00000000-0000-4000-8000-000000004305",
      "00000000-0000-4000-8000-000000004306",
    ];
    const terminalPersonIds = [
      "00000000-0000-4000-8000-000000004310",
      "00000000-0000-4000-8000-000000004311",
      "00000000-0000-4000-8000-000000004312",
    ];
    await ownerQuery("UPDATE alert_rule SET enabled = false");
    await ownerQuery(
      `INSERT INTO company (id, name, code, type, status, created_at, created_by)
       VALUES
         ($1, 'Offboarding scope', 'OFFBOARD-042', 'internal', 'active', now(),
          '00000000-0000-0000-0000-000000000001'),
         ($2, 'Other offboarding scope', 'OFFBOARD-OTHER-042', 'external', 'active', now(),
          '00000000-0000-0000-0000-000000000001')`,
      [ids.company, ids.otherCompany],
    );
    await ownerQuery(
      `INSERT INTO vendor
         (id, name, connector_type, provisioning_protocol, can_provision,
          can_deprovision, has_usage_data, has_cost_data, identity_matching,
          status, created_at, created_by)
       VALUES ($1, 'Offboarding vendor', 'api', 'rest', true, true, false, false,
               'email', 'active', now(),
               '00000000-0000-0000-0000-000000000001')`,
      [ids.vendor],
    );
    await ownerQuery(
      `INSERT INTO vendor_account
         (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
       VALUES ($2, $1, 'Offboarding account', 'automated', 0, 'active', now(),
               '00000000-0000-0000-0000-000000000001')`,
      [ids.vendor, ids.vendorAccount],
    );
    await ownerQuery(
      `INSERT INTO license_type
         (id, vendor_id, name, unit, status, created_at, created_by)
       VALUES ($2, $1, 'Offboarding seat', 'seat', 'active', now(),
               '00000000-0000-0000-0000-000000000001')`,
      [ids.vendor, ids.licenseType],
    );
    await ownerQuery(
      `INSERT INTO person
         (id, email, full_name, company_id, status, created_at, created_by)
       VALUES
         ($1, 'friday-offboarding@example.com', 'Friday departure', $6, 'departed', now(),
          '00000000-0000-0000-0000-000000000001'),
         ($2, 'weekend-offboarding@example.com', 'Weekend departure', $6, 'departed', now(),
          '00000000-0000-0000-0000-000000000001'),
         ($3, 'inactive-offboarding@example.com', 'Inactive offboarding', $6, 'active', now(),
          '00000000-0000-0000-0000-000000000001'),
         ($4, 'reallocated-offboarding@example.com', 'Reallocated offboarding', $6, 'active', now(),
          '00000000-0000-0000-0000-000000000001'),
         ($5, 'other-company-offboarding@example.com', 'Other company departure', $7, 'departed', now(),
          '00000000-0000-0000-0000-000000000001')`,
      [...personIds, ids.company, ids.otherCompany],
    );
    await ownerQuery(
      `INSERT INTO person
         (id, email, full_name, company_id, status, created_at, created_by)
       VALUES
         ($1, 'completed-offboarding@example.com', 'Completed removal', $4,
          'departed', now(), '00000000-0000-0000-0000-000000000001'),
         ($2, 'failed-offboarding@example.com', 'Failed removal', $4,
          'departed', now(), '00000000-0000-0000-0000-000000000001'),
         ($3, 'superseded-offboarding@example.com', 'Superseded removal', $4,
          'departed', now(), '00000000-0000-0000-0000-000000000001')`,
      [...terminalPersonIds, ids.company],
    );
    const requestRows = [
      [ids.fridayRequest, "REQ-OFF-FRIDAY", personIds[0], ids.company],
      [ids.weekendRequest, "REQ-OFF-WEEKEND", personIds[1], ids.company],
      [ids.inactiveRequest, "REQ-OFF-INACTIVE", personIds[2], ids.company],
      [ids.reallocatedRequest, "REQ-OFF-REALLOCATED", personIds[3], ids.company],
      [ids.otherCompanyRequest, "REQ-OFF-OTHER", personIds[4], ids.otherCompany],
      [ids.completedRequest, "REQ-OFF-COMPLETED", terminalPersonIds[0], ids.company],
      [ids.failedRequest, "REQ-OFF-FAILED", terminalPersonIds[1], ids.company],
      [ids.supersededRequest, "REQ-OFF-SUPERSEDED", terminalPersonIds[2], ids.company],
    ];
    for (const [requestId, requestNo, personId, companyId] of requestRows) {
      await ownerQuery(
        `INSERT INTO license_request
           (id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'offboarding',
                 'offboarding deadline evidence', '2026-08-01T00:00:00Z',
                 '00000000-0000-0000-0000-000000000001')`,
        [
          requestId,
          requestNo,
          personId,
          companyId,
          ids.vendorAccount,
          ids.licenseType,
        ],
      );
    }
    const assignmentRows = [
      [ids.fridayRequest, personIds[0], ids.company],
      [ids.weekendRequest, personIds[1], ids.company],
      [ids.inactiveRequest, personIds[2], ids.company],
      [ids.reallocatedRequest, personIds[3], ids.company],
      [ids.otherCompanyRequest, personIds[4], ids.otherCompany],
      [ids.completedRequest, terminalPersonIds[0], ids.company],
      [ids.failedRequest, terminalPersonIds[1], ids.company],
      [ids.supersededRequest, terminalPersonIds[2], ids.company],
    ];
    for (const [requestId, personId, companyId] of assignmentRows) {
      await ownerQuery(
        `INSERT INTO license_assignment
           (id, person_id, company_id, vendor_account_id, license_type_id,
            started_on, source_request_id, source_kind, created_at, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, '2026-01-01', $5,
                 'request', now(),
                 '00000000-0000-0000-0000-000000000001')`,
        [
          personId,
          companyId,
          ids.vendorAccount,
          ids.licenseType,
          requestId,
        ],
      );
    }
    const transitionRows = [
      [ids.fridayRequest, "2026-08-07T20:00:00Z"],
      [ids.weekendRequest, "2026-08-08T15:00:00Z"],
      [ids.inactiveRequest, "2026-08-07T20:00:00Z"],
      [ids.reallocatedRequest, "2026-08-07T20:00:00Z"],
      [ids.otherCompanyRequest, "2026-08-07T20:00:00Z"],
      [ids.completedRequest, "2026-08-07T20:00:00Z"],
      [ids.failedRequest, "2026-08-07T20:00:00Z"],
      [ids.supersededRequest, "2026-08-07T20:00:00Z"],
    ];
    for (const [requestId, occurredAt] of transitionRows) {
      await ownerQuery(
        `INSERT INTO request_transition
           (request_id, from_state, to_state, occurred_at)
         VALUES ($1, 'active', 'offboarding', $2)`,
        [requestId, occurredAt],
      );
    }
    const actionRows = [
      [ids.fridayRequest, "left_company", "pending", "checklist"],
      [ids.weekendRequest, "left_company", "pending", "remove"],
      [ids.inactiveRequest, "inactive", "pending", "remove"],
      [ids.reallocatedRequest, "reallocated", "pending", "remove"],
      [ids.otherCompanyRequest, "left_company", "pending", "remove"],
      [ids.completedRequest, "left_company", "confirmed", "remove"],
      [ids.failedRequest, "left_company", "failed", "remove"],
      [ids.supersededRequest, "left_company", "pending", "remove"],
    ];
    for (const [requestId, endReason, status, kind] of actionRows) {
      await ownerQuery(
        `INSERT INTO provisioning_action
           (id, request_id, vendor_account_id, kind, mode, status, raw_request,
            created_at)
         SELECT gen_random_uuid(), request.id, request.vendor_account_id,
                $4::provisioning_action_kind_enum, 'orchestration',
                $2::provisioning_action_status_enum,
                jsonb_build_object(
                  'operation', 'deprovision',
                  'context', jsonb_build_object(
                    'assignmentIds', jsonb_build_array(assignment.id::text),
                    'endReason', $3::text,
                    'requestId', request.id::text
                  )
                ),
                state_entry.occurred_at
         FROM license_request request
         JOIN license_assignment assignment
           ON assignment.source_request_id = request.id
         JOIN LATERAL (
           SELECT transition.occurred_at
           FROM request_transition transition
           WHERE transition.request_id = request.id
             AND transition.to_state = 'offboarding'
           ORDER BY transition.occurred_at DESC, transition.id DESC
           LIMIT 1
         ) state_entry ON true
         WHERE request.id = $1`,
        [requestId, status, endReason, kind],
      );
    }
    await ownerQuery(
      `INSERT INTO provisioning_action
         (id, request_id, vendor_account_id, kind, mode, status, raw_request,
          created_at)
       SELECT gen_random_uuid(), request.id, request.vendor_account_id,
              'remove', 'orchestration', 'withdrawn',
              jsonb_build_object(
                'context', jsonb_build_object(
                  'assignmentIds', jsonb_build_array(assignment.id::text),
                  'endReason', 'left_company',
                  'requestId', request.id::text
                )
              ),
              '2026-08-07T20:00:01Z'
       FROM license_request request
       JOIN license_assignment assignment
         ON assignment.source_request_id = request.id
       WHERE request.id = $1`,
      [ids.supersededRequest],
    );
    await ownerQuery(
      `INSERT INTO alert_rule
         (id, type, scope_kind, company_id, threshold, channel, enabled,
          created_at, created_by)
       VALUES ($1, 'deprovision_overdue', 'company', $2,
               '{"businessDays":0}', 'email', true, now(),
               '00000000-0000-0000-0000-000000000001')`,
      [ids.rule, ids.company],
    );

    const job = createAlertEvaluationJob({
      calendar: { holidays: new Set() },
      connectionString: fixture.appUrl,
      mailer: {
        send: async () => ({
          accepted: ["admin@corporativo.ec"],
          providerMessageId: "offboarding-alert-042",
        }),
      },
      workerId: "worker-offboarding-042",
    });
    try {
      await expect(
        job.run(new Date("2026-08-08T04:52:00Z")),
      ).resolves.toMatchObject({ status: "succeeded" });
      const beforeDeadline = await fixture.connectAsOwner();
      try {
        await expect(
          beforeDeadline.query(
          "SELECT 1 FROM alert_event WHERE alert_rule_id = $1",
          [ids.rule],
          ),
        ).resolves.toMatchObject({ rows: [] });
      } finally {
        await beforeDeadline.end();
      }

      await job.run(new Date("2026-08-08T05:07:00Z"));
      const afterFridayDeadline = await fixture.connectAsOwner();
      try {
        await expect(
          afterFridayDeadline.query(
            `SELECT subject_ref
             FROM alert_event
             WHERE alert_rule_id = $1
             ORDER BY fired_at, id`,
            [ids.rule],
          ),
        ).resolves.toMatchObject({
          rows: [{ subject_ref: { requestId: ids.fridayRequest } }],
        });
      } finally {
        await afterFridayDeadline.end();
      }

      await job.run(new Date("2026-08-11T04:52:00Z"));
      await job.run(new Date("2026-08-11T05:07:00Z"));
      const afterWeekendDeadline = await fixture.connectAsOwner();
      try {
        await expect(
          afterWeekendDeadline.query(
            `SELECT DISTINCT subject_ref
             FROM alert_event
             WHERE alert_rule_id = $1
             ORDER BY subject_ref`,
            [ids.rule],
          ),
        ).resolves.toMatchObject({
          rows: [
            { subject_ref: { requestId: ids.fridayRequest } },
            { subject_ref: { requestId: ids.weekendRequest } },
          ],
        });
      } finally {
        await afterWeekendDeadline.end();
      }
    } finally {
      await job.close();
    }
  }, 30_000);
});
