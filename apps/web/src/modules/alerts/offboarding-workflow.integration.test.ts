import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import { createAlertEvaluationJob } from "../../../../worker/src/alerts/evaluate-alerts.js";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createPeopleRepository } from "../org-registry/repository";

let fixture: PostgresFixture;
let appPool: pg.Pool;

const ids = {
  admin: "00000000-0000-4000-8000-000000004321",
  company: "00000000-0000-4000-8000-000000004322",
  vendor: "00000000-0000-4000-8000-000000004323",
  vendorAccount: "00000000-0000-4000-8000-000000004324",
  licenseType: "00000000-0000-4000-8000-000000004325",
  person: "00000000-0000-4000-8000-000000004326",
  request: "00000000-0000-4000-8000-000000004327",
  assignment: "00000000-0000-4000-8000-000000004328",
  rule: "00000000-0000-4000-8000-000000004209",
};

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  const owner = await fixture.connectAsOwner();
  try {
    await owner.query("UPDATE alert_rule SET enabled = (id = $1)", [ids.rule]);
    await owner.query(
      `INSERT INTO user_account
         (id, email, global_role, status, idp_subject, ui_language,
          created_at, created_by)
       VALUES ($1, 'workflow-admin@example.com', 'group_admin', 'active',
               'workflow-admin', 'es', now(),
               '00000000-0000-0000-0000-000000000001')`,
      [ids.admin],
    );
    await owner.query(
      `INSERT INTO company (id, name, code, type, status, created_at, created_by)
       VALUES ($1, 'Workflow scope', 'WORKFLOW-ALERT-042', 'internal',
               'active', now(), $2)`,
      [ids.company, ids.admin],
    );
    await owner.query(
      `INSERT INTO vendor
         (id, name, connector_type, provisioning_protocol, can_provision,
          can_deprovision, has_usage_data, has_cost_data, identity_matching,
          status, created_at, created_by)
       VALUES ($1, 'Workflow vendor', 'orchestration', 'none', false, false,
               false, false, 'email', 'active', now(), $2)`,
      [ids.vendor, ids.admin],
    );
    await owner.query(
      `INSERT INTO vendor_account
         (id, vendor_id, name, mode, low_pool_floor, status, created_at,
          created_by)
       VALUES ($1, $2, 'Workflow account', 'orchestration', 0, 'active',
               now(), $3)`,
      [ids.vendorAccount, ids.vendor, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_type
         (id, vendor_id, name, unit, status, created_at, created_by)
       VALUES ($1, $2, 'Workflow seat', 'seat', 'active', now(), $3)`,
      [ids.licenseType, ids.vendor, ids.admin],
    );
    await owner.query(
      `INSERT INTO person
         (id, email, full_name, company_id, status, created_at, created_by)
       VALUES ($1, 'departing-workflow@example.com', 'Departing Workflow',
               $2, 'active', now(), $3)`,
      [ids.person, ids.company, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_request
         (id, request_no, person_id, company_id, vendor_account_id,
          license_type_id, state, justification, created_at, created_by)
       VALUES ($1, 'REQ-WORKFLOW-ALERT', $2, $3, $4, $5, 'active',
               'real offboarding workflow', '2026-01-01T00:00:00Z', $6)`,
      [
        ids.request,
        ids.person,
        ids.company,
        ids.vendorAccount,
        ids.licenseType,
        ids.admin,
      ],
    );
    await owner.query(
      `INSERT INTO license_assignment
         (id, person_id, company_id, vendor_account_id, license_type_id,
          started_on, source_request_id, source_kind, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, '2026-01-01', $6, 'request', now(), $7)`,
      [
        ids.assignment,
        ids.person,
        ids.company,
        ids.vendorAccount,
        ids.licenseType,
        ids.request,
        ids.admin,
      ],
    );
  } finally {
    await owner.end();
  }
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await fixture?.stop();
});

describe("US-024 real offboarding workflow alert integration", () => {
  it("alerts only after the Ecuador deadline from persisted left-company removal context", async () => {
    const authorization: LedgerAuthorization = {
      companyGrants: [],
      companyIds: [],
      employeeCompanyId: null,
      globalRole: "group_admin",
      idpSubject: "workflow-admin",
      roles: ["group_admin"],
      userAccountId: ids.admin,
      userId: ids.admin,
    };
    const occurredAt = new Date("2026-08-07T20:00:00.000Z");
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    await expect(
      repository.startOffboarding(
        authorization,
        {
          endReason: "left_company",
          note: "real persisted workflow",
          personId: ids.person,
        },
        occurredAt,
      ),
    ).resolves.toMatchObject({
      affectedRequestIds: [ids.request],
      status: "offboarding",
    });

    const owner = await fixture.connectAsOwner();
    try {
      const persisted = await owner.query(
        `SELECT action.kind, action.mode, action.status, action.raw_request,
                assignment.ended_on, assignment.end_reason
         FROM provisioning_action action
         JOIN license_assignment assignment
           ON assignment.source_request_id = action.request_id
         WHERE action.request_id = $1
           AND (
             action.kind = 'remove'
             OR (
               action.kind = 'checklist'
               AND action.raw_request->>'operation' = 'deprovision'
             )
           )`,
        [ids.request],
      );
      expect(persisted.rows).toMatchObject([{
        end_reason: null,
        ended_on: null,
        kind: "checklist",
        mode: "orchestration",
        raw_request: {
          context: {
            assignmentIds: [ids.assignment],
            endReason: "left_company",
            requestId: ids.request,
          },
        },
        status: "pending",
      }]);
    } finally {
      await owner.end();
    }

    const job = createAlertEvaluationJob({
      calendar: { holidays: new Set() },
      connectionString: fixture.appUrl,
      mailer: {
        send: async () => ({
          accepted: ["admin@corporativo.ec"],
          providerMessageId: "real-workflow-alert-042",
        }),
      },
      workerId: "real-workflow-alert-042",
    });
    try {
      await job.run(new Date("2026-08-08T04:59:59.999Z"));
      const before = await fixture.connectAsOwner();
      try {
        await expect(
          before.query(
            "SELECT 1 FROM alert_event WHERE alert_rule_id = $1",
            [ids.rule],
          ),
        ).resolves.toMatchObject({ rows: [] });
      } finally {
        await before.end();
      }

      await job.run(new Date("2026-08-08T05:00:00.000Z"));
      const after = await fixture.connectAsOwner();
      try {
        await expect(
          after.query(
            `SELECT subject_ref
             FROM alert_event
             WHERE alert_rule_id = $1`,
            [ids.rule],
          ),
        ).resolves.toMatchObject({
          rows: [{ subject_ref: { requestId: ids.request } }],
        });
      } finally {
        await after.end();
      }
    } finally {
      await job.close();
    }
  }, 30_000);
});
