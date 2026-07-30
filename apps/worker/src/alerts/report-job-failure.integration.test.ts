import { once } from "node:events";

import { createSmtpMailer } from "@smp/notifications";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import type pg from "pg";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "../../../../packages/db/src/testing/postgres-container.js";
import { createJobFailureAlertReporter } from "./report-job-failure.js";

const fixtures: PostgresFixture[] = [];
const companyId = "00000000-0000-0000-0000-000000000601";
const systemUserId = "00000000-0000-0000-0000-000000000001";
const vendorAccountId = "00000000-0000-0000-0000-000000000606";
const vendorId = "00000000-0000-0000-0000-000000000607";

async function createSmtpHarness(): Promise<{
  close(): Promise<void>;
  mailer: ReturnType<typeof createSmtpMailer>;
  messages: string[];
}> {
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
  if (!address || typeof address === "string") throw new Error("SMTP port unavailable");
  return {
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        smtp.close((error) => (error ? reject(error) : resolve()));
      }),
    mailer: createSmtpMailer(`smtp://127.0.0.1:${address.port}`),
    messages,
  };
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

async function seedCompany(owner: pg.Client): Promise<void> {
  await owner.query(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES ($1, 'Alert fixture company', 'ALERT-FIXTURE', 'internal', 'active', now(), $2)`,
    [companyId, systemUserId],
  );
}

async function seedVendorAccount(owner: pg.Client): Promise<void> {
  await owner.query(
    `INSERT INTO vendor (
       id, name, connector_type, provisioning_protocol, can_provision, can_deprovision,
       has_usage_data, has_cost_data, identity_matching, status, created_at, created_by
     ) VALUES ($1, 'Alert fixture vendor', 'api', 'rest', true, true, true, true, 'email', 'active', now(), $2)`,
    [vendorId, systemUserId],
  );
  await owner.query(
    `INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
     VALUES ($1, $2, 'Alert fixture account', 'automated', 0, 'active', now(), $3)`,
    [vendorAccountId, vendorId, systemUserId],
  );
}

async function seedRule(
  owner: pg.Client,
  values: {
    enabled: boolean;
    id: string;
    scopeKind: "company" | "global" | "vendor_account";
    type: "credential_failure" | "sync_stale";
  },
): Promise<void> {
  await owner.query(
    `INSERT INTO alert_rule (id, type, scope_kind, company_id, vendor_account_id, channel, enabled, created_at, created_by)
     VALUES (
       $1,
       $2::alert_rule_type_enum,
       $3::alert_rule_scope_kind_enum,
       CASE WHEN $3::alert_rule_scope_kind_enum = 'company'::alert_rule_scope_kind_enum THEN $4::uuid ELSE NULL END,
       CASE WHEN $3::alert_rule_scope_kind_enum = 'vendor_account'::alert_rule_scope_kind_enum THEN $5::uuid ELSE NULL END,
       'email',
       $6,
       now(),
       $7
     )`,
    [values.id, values.type, values.scopeKind, companyId, vendorAccountId, values.enabled, systemUserId],
  );
}

describe("US-046 operational job failure reporting", () => {
  it("uses the enabled exact type/scope rule and deduplicates concurrent failures only within the same bucket", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const smtp = await createSmtpHarness();
    const reporter = createJobFailureAlertReporter({
      connectionString: fixture.appUrl,
      mailer: smtp.mailer,
      workerId: "failure-reporter-1",
    });
    try {
      await seedCompany(owner);
      await seedVendorAccount(owner);
      await seedRule(owner, {
        enabled: true,
        id: "00000000-0000-0000-0000-000000000602",
        scopeKind: "company",
        type: "credential_failure",
      });
      const input = {
        companyId,
        failureType: "credential_failure" as const,
        jobName: "analyticsSync" as const,
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
        vendorAccountId,
      };
      const results = await Promise.all(Array.from({ length: 12 }, () => reporter.report(input)));

      expect(results.filter((result) => result.status === "created")).toHaveLength(1);
      expect(results.filter((result) => result.status === "deduplicated")).toHaveLength(11);
      await expect(reporter.report(input)).resolves.toEqual({ status: "deduplicated" });
      expect(await owner.query(
        `SELECT event.alert_rule_id, event.notified, event.subject_ref,
                array_agg(delivery.phase::text ORDER BY delivery.attempt, delivery.phase) AS phases
         FROM alert_event event
         JOIN alert_notification_delivery delivery ON delivery.alert_event_id = event.id
         GROUP BY event.id
         ORDER BY fired_at`,
      )).toMatchObject({
        rows: [
          {
            alert_rule_id: "00000000-0000-0000-0000-000000000602",
            notified: { status: "pending" },
            phases: ["pending", "claimed", "succeeded"],
            subject_ref: {
              vendorAccountId,
            },
          },
        ],
      });

      await expect(reporter.report({ ...input, occurredAt: new Date("2026-07-25T14:15:00.000Z") })).resolves.toMatchObject({
        status: "created",
      });
      await expect(owner.query("SELECT count(*)::int AS count FROM alert_event")).resolves.toMatchObject({
        rows: [{ count: 2 }],
      });
      expect(smtp.messages).toHaveLength(2);
      expect(smtp.messages[0]).toContain("Message-ID:");
    } finally {
      await Promise.all([reporter.close(), owner.end(), smtp.close()]);
    }
  }, 150_000);

  it("falls back to global rules and prefers an exact vendor rule over that fallback", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const smtp = await createSmtpHarness();
    const reporter = createJobFailureAlertReporter({
      connectionString: fixture.appUrl,
      mailer: smtp.mailer,
      workerId: "failure-reporter-2",
    });
    try {
      await seedVendorAccount(owner);
      const input = {
        failureType: "sync_stale" as const,
        jobName: "memberSync" as const,
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
        vendorAccountId,
      };
      await expect(reporter.report(input)).resolves.toEqual({ status: "created" });

      await seedRule(owner, {
        enabled: true,
        id: "00000000-0000-0000-0000-000000000609",
        scopeKind: "vendor_account",
        type: "sync_stale",
      });
      await expect(reporter.report({ ...input, occurredAt: new Date("2026-07-25T14:15:00.000Z") })).resolves.toEqual({
        status: "created",
      });

      await expect(owner.query("SELECT alert_rule_id FROM alert_event ORDER BY fired_at")).resolves.toMatchObject({
        rows: [
          { alert_rule_id: "00000000-0000-4000-8000-000000004206" },
          { alert_rule_id: "00000000-0000-0000-0000-000000000609" },
        ],
      });
    } finally {
      await Promise.all([reporter.close(), owner.end(), smtp.close()]);
    }
  }, 150_000);

  it("returns a visible no_matching_rule result without inserting an event for disabled or absent rules", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const smtp = await createSmtpHarness();
    const reporter = createJobFailureAlertReporter({
      connectionString: fixture.appUrl,
      mailer: smtp.mailer,
      workerId: "failure-reporter-3",
    });
    try {
      await seedVendorAccount(owner);
      await owner.query(
        `UPDATE alert_rule SET enabled = false
         WHERE id = '00000000-0000-4000-8000-000000004206'`,
      );

      await expect(reporter.report({
        failureType: "sync_stale",
        jobName: "memberSync",
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
      })).resolves.toEqual({ status: "invalid_scope" });
      await expect(reporter.report({
        failureType: "sync_stale",
        jobName: "memberSync",
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
        vendorAccountId: "   ",
      })).resolves.toEqual({ status: "invalid_scope" });
      await expect(reporter.report({
        failureType: "sync_stale",
        jobName: "memberSync",
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
        vendorAccountId,
      })).resolves.toEqual({ status: "no_matching_rule" });
      await expect(owner.query("SELECT count(*)::int AS count FROM alert_event")).resolves.toMatchObject({
        rows: [{ count: 0 }],
      });
    } finally {
      await Promise.all([reporter.close(), owner.end(), smtp.close()]);
    }
  }, 150_000);

  it("journals SMTP failure and lets the same dedupe event retry with a fenced claim", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    let attempts = 0;
    const reporter = createJobFailureAlertReporter({
      connectionString: fixture.appUrl,
      mailer: {
        async send() {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("SMTP unavailable"), { code: "SMTP_DOWN" });
          }
          return {
            accepted: ["admin@corporativo.ec"],
            providerMessageId: "smtp-retry-042",
          };
        },
      },
      workerId: "failure-reporter-retry",
    });
    const input = {
      failureType: "sync_stale" as const,
      jobName: "memberSync" as const,
      occurredAt: new Date("2026-07-25T14:08:00.000Z"),
      vendorAccountId,
    };
    try {
      await seedVendorAccount(owner);
      await expect(reporter.report(input)).rejects.toMatchObject({ code: "SMTP_DOWN" });
      await expect(
        reporter.report({ ...input, occurredAt: new Date("2026-07-25T14:09:00.000Z") }),
      ).resolves.toEqual({ status: "deduplicated" });
      await expect(
        owner.query(
          `SELECT phase::text AS phase, attempt, error_code
           FROM alert_notification_delivery
           ORDER BY attempt,
             CASE phase
               WHEN 'pending' THEN 0
               WHEN 'claimed' THEN 1
               WHEN 'failed' THEN 2
               WHEN 'succeeded' THEN 3
             END`,
        ),
      ).resolves.toMatchObject({
        rows: [
          { attempt: 0, error_code: null, phase: "pending" },
          { attempt: 1, error_code: null, phase: "claimed" },
          { attempt: 1, error_code: "SMTP_DOWN", phase: "failed" },
          { attempt: 2, error_code: null, phase: "claimed" },
          { attempt: 2, error_code: null, phase: "succeeded" },
        ],
      });
    } finally {
      await Promise.all([reporter.close(), owner.end()]);
    }
  }, 150_000);
});
