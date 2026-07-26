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
    const reporter = createJobFailureAlertReporter(fixture.appUrl);
    try {
      await seedCompany(owner);
      await seedRule(owner, {
        enabled: true,
        id: "00000000-0000-0000-0000-000000000602",
        scopeKind: "company",
        type: "credential_failure",
      });
      await seedRule(owner, {
        enabled: false,
        id: "00000000-0000-0000-0000-000000000603",
        scopeKind: "global",
        type: "credential_failure",
      });
      await seedRule(owner, {
        enabled: true,
        id: "00000000-0000-0000-0000-000000000604",
        scopeKind: "global",
        type: "sync_stale",
      });

      const input = {
        companyId,
        failureType: "credential_failure" as const,
        jobName: "analyticsSync" as const,
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
      };
      const results = await Promise.all(Array.from({ length: 12 }, () => reporter.report(input)));

      expect(results.filter((result) => result.status === "created")).toHaveLength(1);
      expect(results.filter((result) => result.status === "deduplicated")).toHaveLength(11);
      expect(await owner.query(
        `SELECT alert_rule_id, notified, subject_ref
         FROM alert_event
         ORDER BY fired_at`,
      )).toMatchObject({
        rows: [
          {
            alert_rule_id: "00000000-0000-0000-0000-000000000602",
            notified: [],
            subject_ref: {
              bucket: "2026-07-25T14:00:00.000Z",
              companyId,
              failureType: "credential_failure",
              jobName: "analyticsSync",
              vendorAccountId: null,
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
    } finally {
      await Promise.all([reporter.close(), owner.end()]);
    }
  }, 150_000);

  it("falls back to global rules and prefers an exact vendor rule over that fallback", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const reporter = createJobFailureAlertReporter(fixture.appUrl);
    try {
      await seedVendorAccount(owner);
      await seedRule(owner, {
        enabled: true,
        id: "00000000-0000-0000-0000-000000000608",
        scopeKind: "global",
        type: "sync_stale",
      });

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
          { alert_rule_id: "00000000-0000-0000-0000-000000000608" },
          { alert_rule_id: "00000000-0000-0000-0000-000000000609" },
        ],
      });
    } finally {
      await Promise.all([reporter.close(), owner.end()]);
    }
  }, 150_000);

  it("returns a visible no_matching_rule result without inserting an event for disabled or absent rules", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const reporter = createJobFailureAlertReporter(fixture.appUrl);
    try {
      await seedRule(owner, {
        enabled: false,
        id: "00000000-0000-0000-0000-000000000605",
        scopeKind: "global",
        type: "sync_stale",
      });

      await expect(reporter.report({
        failureType: "sync_stale",
        jobName: "memberSync",
        occurredAt: new Date("2026-07-25T14:08:00.000Z"),
      })).resolves.toEqual({ status: "no_matching_rule" });
      await expect(owner.query("SELECT count(*)::int AS count FROM alert_event")).resolves.toMatchObject({
        rows: [{ count: 0 }],
      });
    } finally {
      await Promise.all([reporter.close(), owner.end()]);
    }
  }, 150_000);
});
