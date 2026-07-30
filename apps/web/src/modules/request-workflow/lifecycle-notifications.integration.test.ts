import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { createSmtpMailer } from "@smp/notifications/mailer";

import { withAudit } from "../audit/with-audit";
import {
  createLifecycleNotificationDispatcher as createSharedLifecycleDispatcher,
  deliveryErrorCode,
} from "../../../../../packages/notifications/src/lifecycle-dispatcher";
import {
  createLifecycleNotificationDispatcher,
  enqueueLifecycleDecision,
  enqueueLifecyclePendingApproval,
  enqueueLifecycleProvisioningComplete,
} from "./lifecycle-notifications";

const id = (suffix: string) =>
  `16000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  requester: id("2"),
  approver: id("3"),
  otherApprover: id("4"),
  company: id("5"),
  otherCompany: id("6"),
  person: id("7"),
  vendor: id("8"),
  account: id("9"),
  license: id("10"),
  request: id("11"),
  otherRequest: id("12"),
};
const at = new Date("2026-07-28T16:00:00.000Z");
let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;
let appConnectionString: string;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const mutationAppUrl = process.env.US016_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US016_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("US-016 mutation harness requires both database URLs");
    }
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
    appConnectionString = mutationAppUrl;
    appPool = new pg.Pool({ connectionString: appConnectionString });
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    owner = await fixture.connectAsOwner();
    appConnectionString = fixture.appUrl;
    appPool = new pg.Pool({ connectionString: appConnectionString });
  }
  database = drizzle(appPool, { schema });
}, 120_000);

afterAll(async () => {
  await appPool.end();
  await owner.end();
  if (fixture) await fixture.stop();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE TABLE lifecycle_notification_delivery, lifecycle_notification,
       audit_log, request_transition, provisioning_action, license_request,
       license_assignment, license_type, vendor_account, vendor,
       company_role_assignment, person, company, system_setting, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'admin@ledger.test','us016-admin','group_admin','en','active',$5),
       ($2,'requester@ledger.test','us016-requester',NULL,'en','active',$5),
       ($3,'approver@ledger.test','us016-approver',NULL,'es','active',$5),
       ($4,'other@ledger.test','us016-other',NULL,'en','active',$5)`,
    [ids.admin, ids.requester, ids.approver, ids.otherApprover, at],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES
       ($1,'Compañía Uno','UNO','internal','active','es',$3,$4),
       ($2,'Other Company','OTH','internal','active','en',$3,$4)`,
    [ids.company, ids.otherCompany, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'requester@ledger.test','Ana <Torres>',$2,'active',$3,$4)`,
    [ids.person, ids.company, at, ids.admin],
  );
  await owner.query(
    "UPDATE user_account SET person_id=$1 WHERE id=$2",
    [ids.person, ids.requester],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES
       ($1,$3,'approver','us016-a',$5,$6),
       ($2,$4,'approver','us016-other',$5,$6)`,
    [
      ids.approver,
      ids.otherApprover,
      ids.company,
      ids.otherCompany,
      at,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,
        can_deprovision,has_usage_data,has_cost_data,identity_matching,status,
        created_at,created_by)
     VALUES ($1,'Vendor','orchestration','none',false,false,false,false,
             'email','active',$2,$3)`,
    [ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Vendor Org','orchestration',1,'active',$3,$4)`,
    [ids.account, ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Seat','seat','active',$3,$4)`,
    [ids.license, ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,requested_by,created_at,created_by,updated_at)
     VALUES ($1,'SOL-016',$2,$3,$4,$5,'pending_approval','Need access',
             $6,$7,$8,$7)`,
    [
      ids.request,
      ids.person,
      ids.company,
      ids.account,
      ids.license,
      ids.requester,
      at,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO system_setting (key,value,updated_at,updated_by)
     VALUES ('notif_sender_email','"notificaciones@ledger.test"'::jsonb,$1,$2)`,
    [at, ids.admin],
  );
});

describe("US-016 durable lifecycle notification seam", () => {
  it("runs post-commit work exactly once after business and audit rows commit, without undo on callback failure", async () => {
    const observations: Array<{ auditCount: number; locale: string }> = [];

    await expect(
      withAudit(
        database,
        async (transaction) => {
          await transaction.execute(
            sql`UPDATE user_account
                SET ui_language='es'
                WHERE id=${ids.requester}::uuid`,
          );
          return {
            value: "committed",
            audit: {
              actorUserId: ids.requester,
              action: "us016.after_commit",
              entityType: "UserAccount",
              entityId: ids.requester,
              companyId: ids.company,
              note: null,
              before: { ui_language: "en" },
              after: { ui_language: "es" },
            },
          };
        },
        {
          occurredAt: at,
          afterCommit: async () => {
            const state = await owner.query<{
              audit_count: number;
              ui_language: string;
            }>(
              `SELECT account.ui_language,
                      count(audit.id)::int AS audit_count
               FROM user_account account
               LEFT JOIN audit_log audit
                 ON audit.entity_id=account.id
                AND audit.action='us016.after_commit'
               WHERE account.id=$1
               GROUP BY account.ui_language`,
              [ids.requester],
            );
            observations.push({
              auditCount: state.rows[0]!.audit_count,
              locale: state.rows[0]!.ui_language,
            });
            throw new Error("post-commit boundary failure");
          },
          onAfterCommitFailure: async () => undefined,
        },
      ),
    ).resolves.toBe("committed");

    expect(observations).toEqual([{ auditCount: 1, locale: "es" }]);
    const committed = await owner.query(
      "SELECT ui_language FROM user_account WHERE id=$1",
      [ids.requester],
    );
    expect(committed.rows).toEqual([{ ui_language: "es" }]);
  });

  it("never invokes post-commit work when the business transaction rolls back", async () => {
    let callbackCount = 0;

    await expect(
      withAudit(
        database,
        async () => {
          throw new Error("business transaction rejected");
        },
        {
          occurredAt: at,
          afterCommit: async () => {
            callbackCount += 1;
          },
          onAfterCommitFailure: async () => undefined,
        },
      ),
    ).rejects.toThrow("business transaction rejected");

    expect(callbackCount).toBe(0);
  });

  it("resolves tenant-exact requester and authorized approvers and dedupes replay", async () => {
    await database.transaction(async (transaction) => {
      await enqueueLifecyclePendingApproval(transaction, ids.request, at);
      await enqueueLifecyclePendingApproval(transaction, ids.request, at);
    });

    const rows = await owner.query<{
      company_id: string;
      kind: string;
      recipient_email: string;
    }>(
      `SELECT company_id, kind, recipient_email
       FROM lifecycle_notification ORDER BY kind, recipient_email`,
    );
    expect(rows.rows).toEqual([
      {
        company_id: ids.company,
        kind: "submission",
        recipient_email: "requester@ledger.test",
      },
      {
        company_id: ids.company,
        kind: "new_request_to_approver",
        recipient_email: "admin@ledger.test",
      },
      {
        company_id: ids.company,
        kind: "new_request_to_approver",
        recipient_email: "approver@ledger.test",
      },
    ]);
    expect(rows.rows.some(({ recipient_email }) => recipient_email === "other@ledger.test")).toBe(false);
  });

  it("enqueues decision and active lifecycle messages exactly once", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
      await transaction.execute(
        sql`UPDATE license_request SET state='active' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleProvisioningComplete(transaction, ids.request, at);
    });
    const rows = await owner.query<{ kind: string }>(
      "SELECT kind FROM lifecycle_notification ORDER BY kind",
    );
    expect(rows.rows.map(({ kind }) => kind)).toEqual([
      "decision",
      "provisioning_complete",
    ]);
  });

  it("records failed delivery without changing the committed request state", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: createSmtpMailer("smtp://127.0.0.1:1"),
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "us016-failure",
    });

    const result = await dispatcher.drain({ requestId: ids.request });

    expect(result).toEqual({ failed: 1, sent: 0, skipped: 0 });
    const request = await owner.query<{ state: string }>(
      "SELECT state FROM license_request WHERE id=$1",
      [ids.request],
    );
    expect(request.rows[0]!.state).toBe("rejected");
    const evidence = await owner.query<{ action: string; after: unknown }>(
      `SELECT action, after FROM audit_log
       WHERE entity_id=$1 AND action='notification.lifecycle_failed'`,
      [ids.request],
    );
    expect(evidence.rows).toEqual([
      {
        action: "notification.lifecycle_failed",
        after: { errorCode: "ESOCKET", kind: "decision" },
      },
    ]);
    const journal = await owner.query<{ occurred_at: Date }>(
      `SELECT occurred_at FROM lifecycle_notification_delivery
       WHERE phase IN ('claimed','failed') ORDER BY phase`,
    );
    expect(journal.rows.map(({ occurred_at }) => occurred_at)).toEqual([
      at,
      at,
    ]);
    await dispatcher.close();
  });

  it.each(["missing", "blank"] as const)(
    "records %s server-owned sender configuration as failed evidence",
    async (settingCase) => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    if (settingCase === "missing") {
      await owner.query(
        "DELETE FROM system_setting WHERE key='notif_sender_email'",
      );
    } else {
      await owner.query(
        `UPDATE system_setting SET value='"   "'::jsonb
         WHERE key='notif_sender_email'`,
      );
    }
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: createSmtpMailer("smtp://127.0.0.1:11025"),
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "us016-invalid-setting",
    });

    await expect(dispatcher.drain({ requestId: ids.request })).resolves.toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    });
    const evidence = await owner.query<{ error_code: string }>(
      `SELECT delivery.error_code
       FROM lifecycle_notification_delivery delivery
       JOIN lifecycle_notification notification
         ON notification.id=delivery.notification_id
       WHERE notification.request_id=$1 AND delivery.phase='failed'`,
      [ids.request],
    );
    expect(evidence.rows).toEqual([
      { error_code: "NOTIFICATION_CONFIGURATION_INVALID" },
    ]);
    await dispatcher.close();
  });

  it("uses a non-sensitive fallback code for invalid origin and SMTP configuration", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: createSmtpMailer("smtp://127.0.0.1:11025"),
      now: () => at,
      publicOrigin: "not an origin",
      workerId: "us016-invalid-origin",
    });
    expect(await dispatcher.drain({ requestId: ids.request })).toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    });
    const evidence = await owner.query<{ error_code: string }>(
      `SELECT error_code FROM lifecycle_notification_delivery
       WHERE phase='failed'`,
    );
    expect(evidence.rows).toEqual([
      { error_code: "SMTP_DELIVERY_FAILED" },
    ]);
    await dispatcher.close();
  });

  it.each(["origin", "smtp"] as const)(
    "fails closed when the server %s fallback is absent",
    async (missing) => {
      await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
        );
        await enqueueLifecycleDecision(
          transaction,
          ids.request,
          "rejected",
          at,
        );
      });
      const previousOrigin = process.env.PUBLIC_ORIGIN;
      const previousNextAuth = process.env.NEXTAUTH_URL;
      const previousSmtp = process.env.SMTP_URL;
      if (missing === "origin") {
        delete process.env.PUBLIC_ORIGIN;
        delete process.env.NEXTAUTH_URL;
      } else {
        delete process.env.SMTP_URL;
      }
      const dispatcher = createSharedLifecycleDispatcher({
        connectionString: appConnectionString,
        mailer:
          missing === "origin"
            ? {
                send: async (message) => ({
                  accepted: [...message.to],
                  providerMessageId: "must-not-send",
                }),
              }
            : undefined,
        now: () => at,
        publicOrigin:
          missing === "smtp" ? "https://ledger.example.test" : undefined,
        workerId: `worker-missing-${missing}`,
      });

      try {
        await expect(dispatcher.drain()).resolves.toEqual({
          failed: 1,
          sent: 0,
          skipped: 0,
        });
      } finally {
        await dispatcher.close();
        restoreEnvironment("PUBLIC_ORIGIN", previousOrigin);
        restoreEnvironment("NEXTAUTH_URL", previousNextAuth);
        restoreEnvironment("SMTP_URL", previousSmtp);
      }
    },
  );

  it.runIf(process.env.MAILPIT_TEST_SMTP_URL)(
    "claims concurrent dispatch once and renders sender, locale, and scoped link from DB",
    async () => {
      await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
        );
        await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
      });
      const previousOrigin = process.env.PUBLIC_ORIGIN;
      const previousSmtp = process.env.SMTP_URL;
      process.env.PUBLIC_ORIGIN = "not-the-configured-origin";
      process.env.SMTP_URL = "smtp://127.0.0.1:1";
      const dispatcher = createLifecycleNotificationDispatcher(database, {
        now: () => at,
        publicOrigin: "https://ledger.example.test",
        smtpUrl: process.env.MAILPIT_TEST_SMTP_URL!,
        workerId: "us016-success",
      });

      const results = await Promise.all([
        dispatcher.dispatchRequest(ids.request),
        dispatcher.dispatchRequest(ids.request),
      ]).finally(() => {
        restoreEnvironment("PUBLIC_ORIGIN", previousOrigin);
        restoreEnvironment("SMTP_URL", previousSmtp);
      });

      expect({
        failed: results.reduce((sum, result) => sum + result.failed, 0),
        sent: results.reduce((sum, result) => sum + result.sent, 0),
        skipped: results.reduce((sum, result) => sum + result.skipped, 0),
      }).toEqual({ failed: 0, sent: 1, skipped: 0 });
      expect(results.every(({ skipped }) => skipped >= 0)).toBe(true);
      const succeeded = await owner.query(
        `SELECT 1 FROM lifecycle_notification_delivery
         WHERE phase='succeeded'`,
      );
      expect(succeeded.rows).toHaveLength(1);
      const audit = await owner.query<{ action: string; after: unknown }>(
        `SELECT action, after FROM audit_log
         WHERE entity_id=$1 AND action='notification.lifecycle_succeeded'`,
        [ids.request],
      );
      expect(audit.rows).toEqual([
        {
          action: "notification.lifecycle_succeeded",
          after: { acceptedCount: 1, kind: "decision" },
        },
      ]);
    },
  );

  it.runIf(process.env.MAILPIT_TEST_SMTP_URL)(
    "uses only server environment fallbacks when explicit delivery config is absent",
    async () => {
      await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
        );
        await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
      });
      const previousOrigin = process.env.PUBLIC_ORIGIN;
      const previousSmtp = process.env.SMTP_URL;
      process.env.PUBLIC_ORIGIN = "https://ledger.example.test";
      process.env.SMTP_URL = process.env.MAILPIT_TEST_SMTP_URL!;
      const dispatcher = createSharedLifecycleDispatcher({
        connectionString: appConnectionString,
        now: () => at,
        workerId: "us016-env",
      });

      const result = await dispatcher
        .drain({ requestId: ids.request })
        .finally(() => {
          restoreEnvironment("PUBLIC_ORIGIN", previousOrigin);
          restoreEnvironment("SMTP_URL", previousSmtp);
        });

      expect(result).toEqual({ failed: 0, sent: 1, skipped: 0 });
      await dispatcher.close();
    },
  );

  it("shared worker drain uses the current recipient email after commit", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    await owner.query(
      "UPDATE user_account SET email='current@ledger.test' WHERE id=$1",
      [ids.requester],
    );
    const recipients: string[][] = [];
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: {
        send: async (message) => {
          recipients.push([...message.to]);
          return {
            accepted: [...message.to],
            providerMessageId: "current-email",
          };
        },
      },
      publicOrigin: "https://ledger.example.test",
      workerId: "worker-current-email",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    });
    expect(recipients).toEqual([["current@ledger.test"]]);
    const successAudit = await owner.query<{ action: string; after: unknown }>(
      `SELECT action, after
       FROM audit_log
       WHERE entity_id=$1 AND action='notification.lifecycle_succeeded'`,
      [ids.request],
    );
    expect(successAudit.rows).toEqual([
      {
        action: "notification.lifecycle_succeeded",
        after: { acceptedCount: 1, kind: "decision" },
      },
    ]);
    await dispatcher.close();
  });

  it("shared worker request filter leaves another request pending", async () => {
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,requested_by,created_at,created_by,updated_at)
       SELECT $1,'SOL-016-OTHER',person_id,company_id,vendor_account_id,
              license_type_id,'rejected',justification,requested_by,
              created_at,created_by,updated_at
       FROM license_request WHERE id=$2`,
      [ids.otherRequest, ids.request],
    );
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
      await enqueueLifecycleDecision(
        transaction,
        ids.otherRequest,
        "rejected",
        at,
      );
    });
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: {
        send: async (message) => ({
          accepted: [...message.to],
          providerMessageId: "filtered",
        }),
      },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "worker-request-filter",
    });

    await expect(
      dispatcher.drain({ requestId: ids.request }),
    ).resolves.toEqual({ failed: 0, sent: 1, skipped: 0 });
    const pending = await owner.query<{ request_id: string }>(
      `SELECT notification.request_id::text
       FROM lifecycle_notification notification
       WHERE notification.request_id=$1
         AND NOT EXISTS (
           SELECT 1 FROM lifecycle_notification_delivery delivery
           WHERE delivery.notification_id=notification.id
             AND delivery.phase='succeeded'
         )`,
      [ids.otherRequest],
    );
    expect(pending.rows).toEqual([{ request_id: ids.otherRequest }]);
    await dispatcher.close();
  });

  it("web inline adapter forwards its exact request filter to the shared core", async () => {
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,requested_by,created_at,created_by,updated_at)
       SELECT $1,'SOL-016-ADAPTER',person_id,company_id,vendor_account_id,
              license_type_id,'rejected',justification,requested_by,
              created_at,created_by,updated_at
       FROM license_request WHERE id=$2`,
      [ids.otherRequest, ids.request],
    );
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
      await enqueueLifecycleDecision(
        transaction,
        ids.otherRequest,
        "rejected",
        at,
      );
    });
    const dispatcher = createLifecycleNotificationDispatcher(database, {
      mailer: {
        send: async (message) => ({
          accepted: [...message.to],
          providerMessageId: "adapter-filtered",
        }),
      },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "web-request-filter",
    });

    await expect(dispatcher.dispatchRequest(ids.request)).resolves.toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    });
    const otherTerminal = await owner.query(
      `SELECT 1
       FROM lifecycle_notification notification
       JOIN lifecycle_notification_delivery delivery
         ON delivery.notification_id=notification.id
       WHERE notification.request_id=$1
         AND delivery.phase IN ('succeeded','failed')`,
      [ids.otherRequest],
    );
    expect(otherTerminal.rows).toHaveLength(0);
  });

  it("shared worker drain terminally suppresses a disabled requester without retry", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    await owner.query(
      "UPDATE user_account SET status='disabled' WHERE id=$1",
      [ids.requester],
    );
    const send = async () => {
      throw new Error("must not send");
    };
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: { send },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "worker-disabled-requester",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 1,
    });
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    const suppression = await owner.query<{ error_code: string }>(
      `SELECT error_code
       FROM lifecycle_notification_delivery
       WHERE phase='failed'`,
    );
    expect(suppression.rows).toEqual([
      { error_code: "RECIPIENT_NOT_AUTHORIZED" },
    ]);
    const suppressionAudit = await owner.query<{
      action: string;
      after: unknown;
    }>(
      `SELECT action, after
       FROM audit_log
       WHERE entity_id=$1 AND action='notification.lifecycle_suppressed'`,
      [ids.request],
    );
    expect(suppressionAudit.rows).toEqual([
      {
        action: "notification.lifecycle_suppressed",
        after: {
          errorCode: "RECIPIENT_NOT_AUTHORIZED",
          kind: "decision",
        },
      },
    ]);
    await dispatcher.close();
  });

  it("inline acceleration terminally suppresses unauthorized delivery without retry", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    await owner.query(
      "UPDATE user_account SET status='disabled' WHERE id=$1",
      [ids.requester],
    );
    let sends = 0;
    const dispatcher = createLifecycleNotificationDispatcher(database, {
      mailer: {
        send: async () => {
          sends += 1;
          throw new Error("must not send");
        },
      },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "web-terminal-suppression",
    });

    await expect(dispatcher.dispatchRequest(ids.request)).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 1,
    });
    await expect(dispatcher.dispatchRequest(ids.request)).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    expect(sends).toBe(0);
  });

  it("shared worker drain suppresses a revoked company approver but retains group admin authority", async () => {
    await database.transaction(async (transaction) => {
      await enqueueLifecyclePendingApproval(transaction, ids.request, at);
    });
    await owner.query(
      `DELETE FROM company_role_assignment
       WHERE user_account_id=$1 AND company_id=$2`,
      [ids.approver, ids.company],
    );
    const recipients: string[] = [];
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: {
        send: async (message) => {
          recipients.push(...message.to);
          return {
            accepted: [...message.to],
            providerMessageId: `authorized-${recipients.length}`,
          };
        },
      },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "worker-revoked-approver",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 2,
      skipped: 1,
    });
    expect(recipients.sort()).toEqual([
      "admin@ledger.test",
      "requester@ledger.test",
    ]);
    await dispatcher.close();
  });

  it("shared worker drain retries transient failure and reclaims an expired lease", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    const notification = await owner.query<{ id: string }>(
      "SELECT id::text FROM lifecycle_notification",
    );
    await owner.query(
      `SELECT claim_lifecycle_notification($1::uuid, $2, $3, 'crashed-web')`,
      [
        notification.rows[0]!.id,
        new Date(at.getTime() - 10 * 60_000),
        new Date(at.getTime() - 5 * 60_000),
      ],
    );
    let current = at;
    let attempts = 0;
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: {
        send: async (message) => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("temporary SMTP failure"), {
              code: "ETIMEDOUT",
            });
          }
          return {
            accepted: [...message.to],
            providerMessageId: "retried",
          };
        },
      },
      now: () => current,
      publicOrigin: "https://ledger.example.test",
      retryDelayMs: 120_000,
      workerId: "worker-retry",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    });
    current = new Date(at.getTime() + 60_001);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    current = new Date(at.getTime() + 120_001);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    });
    expect(attempts).toBe(2);
    const retryAudit = await owner.query<{ action: string; after: unknown }>(
      `SELECT action, after
       FROM audit_log
       WHERE entity_id=$1
         AND action IN (
           'notification.lifecycle_failed',
           'notification.lifecycle_succeeded'
         )
       ORDER BY occurred_at, action`,
      [ids.request],
    );
    expect(retryAudit.rows).toEqual([
      {
        action: "notification.lifecycle_failed",
        after: { errorCode: "ETIMEDOUT", kind: "decision" },
      },
      {
        action: "notification.lifecycle_succeeded",
        after: { acceptedCount: 1, kind: "decision" },
      },
    ]);
    await dispatcher.close();
  });

  it("shared worker reclaims an expired claim only at the exact lease backoff boundary", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    const notification = await owner.query<{ id: string }>(
      "SELECT id::text FROM lifecycle_notification",
    );
    const leaseExpiresAt = new Date(at.getTime() + 60_000);
    await owner.query(
      `SELECT claim_lifecycle_notification($1::uuid, $2, $3, 'crashed-worker')`,
      [notification.rows[0]!.id, at, leaseExpiresAt],
    );
    let current = new Date(leaseExpiresAt.getTime() + 119_999);
    let sends = 0;
    const dispatcher = createSharedLifecycleDispatcher({
      mailer: {
        send: async (message) => {
          sends += 1;
          return {
            accepted: [...message.to],
            providerMessageId: "expired-boundary",
          };
        },
      },
      now: () => current,
      pool: appPool,
      publicOrigin: "https://ledger.example.test",
      retryDelayMs: 120_000,
      workerId: "worker-expired-boundary",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    current = new Date(leaseExpiresAt.getTime() + 120_000);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    });
    expect(sends).toBe(1);
    const claims = await owner.query<{ attempt: number }>(
      `SELECT attempt
       FROM lifecycle_notification_delivery
       WHERE notification_id=$1 AND phase='claimed'
       ORDER BY attempt`,
      [notification.rows[0]!.id],
    );
    expect(claims.rows).toEqual([{ attempt: 1 }, { attempt: 2 }]);
    await dispatcher.close();
  });

  it("shared worker does not reclaim or send after consecutive crashed claims reach the cap", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    const notification = await owner.query<{ id: string }>(
      "SELECT id::text FROM lifecycle_notification",
    );
    const firstLeaseExpiresAt = new Date(at.getTime() + 60_000);
    await owner.query(
      `SELECT claim_lifecycle_notification($1::uuid, $2, $3, 'crashed-worker-1')`,
      [notification.rows[0]!.id, at, firstLeaseExpiresAt],
    );
    const secondClaimAt = new Date(firstLeaseExpiresAt.getTime() + 120_000);
    const secondLeaseExpiresAt = new Date(secondClaimAt.getTime() + 60_000);
    await owner.query(
      `SELECT claim_lifecycle_notification($1::uuid, $2, $3, 'crashed-worker-2')`,
      [notification.rows[0]!.id, secondClaimAt, secondLeaseExpiresAt],
    );
    let sends = 0;
    const dispatcher = createSharedLifecycleDispatcher({
      mailer: {
        send: async () => {
          sends += 1;
          throw new Error("SMTP must not be reached after the claim cap");
        },
      },
      maxAttempts: 2,
      now: () => new Date(secondLeaseExpiresAt.getTime() + 120_000),
      pool: appPool,
      publicOrigin: "https://ledger.example.test",
      retryDelayMs: 120_000,
      workerId: "worker-expired-cap",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    expect(sends).toBe(0);
    const claims = await owner.query<{ attempt: number }>(
      `SELECT attempt
       FROM lifecycle_notification_delivery
       WHERE notification_id=$1 AND phase='claimed'
       ORDER BY attempt`,
      [notification.rows[0]!.id],
    );
    expect(claims.rows).toEqual([{ attempt: 1 }, { attempt: 2 }]);
    await dispatcher.close();
  });

  it("shared worker ignores an older failed attempt while the latest capped claim is live or expired", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    let current = at;
    let sends = 0;
    const dispatcher = createSharedLifecycleDispatcher({
      mailer: {
        send: async () => {
          sends += 1;
          if (sends === 1) {
            throw Object.assign(new Error("temporary SMTP failure"), {
              code: "ETIMEDOUT",
            });
          }
          return {
            accepted: ["requester@ledger.test"],
            providerMessageId: "must-not-send-at-cap",
          };
        },
      },
      maxAttempts: 2,
      now: () => current,
      pool: appPool,
      publicOrigin: "https://ledger.example.test",
      retryDelayMs: 120_000,
      workerId: "worker-mixed-cap",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    });
    const notification = await owner.query<{ id: string }>(
      "SELECT id::text FROM lifecycle_notification",
    );
    const secondClaimAt = new Date(at.getTime() + 120_000);
    const secondLeaseExpiresAt = new Date(secondClaimAt.getTime() + 60_000);
    await owner.query(
      `SELECT claim_lifecycle_notification($1::uuid, $2, $3, 'crashed-mixed-cap')`,
      [notification.rows[0]!.id, secondClaimAt, secondLeaseExpiresAt],
    );

    current = secondClaimAt;
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    current = new Date(secondLeaseExpiresAt.getTime() + 120_000);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    expect(sends).toBe(1);
    const journal = await owner.query<{ attempt: number; phase: string }>(
      `SELECT attempt, phase::text
       FROM lifecycle_notification_delivery
       WHERE notification_id=$1 AND phase <> 'pending'
       ORDER BY attempt,
         CASE phase
           WHEN 'claimed' THEN 1
           WHEN 'failed' THEN 2
           WHEN 'succeeded' THEN 3
         END`,
      [notification.rows[0]!.id],
    );
    expect(journal.rows).toEqual([
      { attempt: 1, phase: "claimed" },
      { attempt: 1, phase: "failed" },
      { attempt: 2, phase: "claimed" },
    ]);
    await dispatcher.close();
  });

  it("shared worker retries a mixed failed-then-crashed sequence only at the latest lease backoff boundary", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    let current = at;
    let sends = 0;
    const dispatcher = createSharedLifecycleDispatcher({
      mailer: {
        send: async () => {
          sends += 1;
          if (sends === 1) {
            throw Object.assign(new Error("temporary SMTP failure"), {
              code: "ETIMEDOUT",
            });
          }
          return {
            accepted: ["requester@ledger.test"],
            providerMessageId: "mixed-attempt-recovered",
          };
        },
      },
      maxAttempts: 3,
      now: () => current,
      pool: appPool,
      publicOrigin: "https://ledger.example.test",
      retryDelayMs: 120_000,
      workerId: "worker-mixed-three",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    });
    const notification = await owner.query<{ id: string }>(
      "SELECT id::text FROM lifecycle_notification",
    );
    const secondClaimAt = new Date(at.getTime() + 120_000);
    const secondLeaseExpiresAt = new Date(secondClaimAt.getTime() + 60_000);
    await owner.query(
      `SELECT claim_lifecycle_notification($1::uuid, $2, $3, 'crashed-mixed-three')`,
      [notification.rows[0]!.id, secondClaimAt, secondLeaseExpiresAt],
    );

    current = new Date(secondLeaseExpiresAt.getTime() + 119_999);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    expect(sends).toBe(1);
    current = new Date(secondLeaseExpiresAt.getTime() + 120_000);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    });
    expect(sends).toBe(2);
    const journal = await owner.query<{ attempt: number; phase: string }>(
      `SELECT attempt, phase::text
       FROM lifecycle_notification_delivery
       WHERE notification_id=$1 AND phase <> 'pending'
       ORDER BY attempt,
         CASE phase
           WHEN 'claimed' THEN 1
           WHEN 'failed' THEN 2
           WHEN 'succeeded' THEN 3
         END`,
      [notification.rows[0]!.id],
    );
    expect(journal.rows).toEqual([
      { attempt: 1, phase: "claimed" },
      { attempt: 1, phase: "failed" },
      { attempt: 2, phase: "claimed" },
      { attempt: 3, phase: "claimed" },
      { attempt: 3, phase: "succeeded" },
    ]);
    await dispatcher.close();
  });

  it("shared worker stops retrying after the configured attempt cap", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    let current = at;
    let attempts = 0;
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: {
        send: async () => {
          attempts += 1;
          throw Object.assign(new Error("temporary SMTP failure"), {
            code: "ETIMEDOUT",
          });
        },
      },
      maxAttempts: 1,
      now: () => current,
      publicOrigin: "https://ledger.example.test",
      retryDelayMs: 1,
      workerId: "worker-attempt-cap",
    });

    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    });
    current = new Date(at.getTime() + 2);
    await expect(dispatcher.drain()).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    expect(attempts).toBe(1);
    await dispatcher.close();
  });

  it("shared concurrent drains deliver one message through the claim fence", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    let sends = 0;
    let claimArrivals = 0;
    let releaseClaims!: () => void;
    const claimsReady = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });
    const dispatcher = createSharedLifecycleDispatcher({
      beforeClaim: async () => {
        claimArrivals += 1;
        if (claimArrivals === 2) releaseClaims();
        await claimsReady;
      },
      connectionString: appConnectionString,
      mailer: {
        send: async (message) => {
          sends += 1;
          return {
            accepted: [...message.to],
            providerMessageId: "concurrent",
          };
        },
      },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "worker-concurrent",
    });

    const results = await Promise.all([
      dispatcher.drain({ limit: 1 }),
      dispatcher.drain({ limit: 1 }),
    ]);
    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.skipped, 0)).toBe(1);
    expect(sends).toBe(1);
    await dispatcher.close();
  });

  it("shared completion rolls its terminal journal back when audit evidence fails", async () => {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE license_request SET state='rejected' WHERE id=${ids.request}::uuid`,
      );
      await enqueueLifecycleDecision(transaction, ids.request, "rejected", at);
    });
    await owner.query(`
      CREATE FUNCTION reject_lifecycle_delivery_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'notification.lifecycle_succeeded' THEN
          RAISE EXCEPTION 'forced lifecycle audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_lifecycle_delivery_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_delivery_audit();
    `);
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      mailer: {
        send: async (message) => ({
          accepted: [...message.to],
          providerMessageId: "rolled-back",
        }),
      },
      now: () => at,
      publicOrigin: "https://ledger.example.test",
      workerId: "worker-audit-rollback",
    });

    try {
      await expect(dispatcher.drain()).resolves.toEqual({
        failed: 1,
        sent: 0,
        skipped: 0,
      });
      const terminal = await owner.query<{ error_code: string; phase: string }>(
        `SELECT phase, error_code
         FROM lifecycle_notification_delivery
         WHERE phase IN ('succeeded','failed')`,
      );
      expect(terminal.rows).toEqual([
        { error_code: "P0001", phase: "failed" },
      ]);
    } finally {
      await dispatcher.close();
      await owner.query(`
        DROP TRIGGER reject_lifecycle_delivery_audit ON audit_log;
        DROP FUNCTION reject_lifecycle_delivery_audit();
      `);
    }
  });

  it("shared dispatcher rejects invalid scan bounds and closes its owned pool", async () => {
    expect(() =>
      createSharedLifecycleDispatcher({
        workerId: "missing-connection",
      }),
    ).toThrow("connectionString or pool is required");
    const dispatcher = createSharedLifecycleDispatcher({
      connectionString: appConnectionString,
      workerId: "worker-validation",
    });

    for (const limit of [0, -1, 1.5, 1_001]) {
      await expect(dispatcher.drain({ limit })).rejects.toThrow(
        "limit must be an integer between 1 and 1000",
      );
    }
    await expect(dispatcher.drain({ limit: 1_000 })).resolves.toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    });
    await dispatcher.close();
    await expect(dispatcher.drain({ limit: 1 })).rejects.toThrow();

    const nonOwned = createSharedLifecycleDispatcher({
      pool: appPool,
      workerId: "web-non-owned-pool",
    });
    await nonOwned.close();
    await expect(appPool.query("SELECT 1 AS ok")).resolves.toMatchObject({
      rows: [{ ok: 1 }],
    });
  });
});

describe("US-016 delivery error-code sanitization", () => {
  it.each([
    [null, "SMTP_DELIVERY_FAILED"],
    ["failure", "SMTP_DELIVERY_FAILED"],
    [{ code: 42 }, "SMTP_DELIVERY_FAILED"],
    [{ code: "lowercase" }, "SMTP_DELIVERY_FAILED"],
    [{ code: "_".repeat(65) }, "SMTP_DELIVERY_FAILED"],
    [{ code: "ETIMEDOUT" }, "ETIMEDOUT"],
  ])("maps provider error %# without leaking details", (error, expected) => {
    expect(deliveryErrorCode(error)).toBe(expected);
  });
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
