import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../../identity-access/authorization";

import {
  createRetryProvisioningActionService,
  retryProvisioningFailureDestination,
} from "./retry-provisioning-action";

const id = (suffix: string) =>
  `36510000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  action: id("9"),
  admin: id("1"),
  company: id("2"),
  license: id("6"),
  person: id("3"),
  request: id("8"),
  user: id("7"),
  vendor: id("4"),
  vendorAccount: id("5"),
} as const;
const failedAt = new Date("2026-09-09T01:00:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

const authorization: LedgerAuthorization = {
  companyGrants: [{ companyId: ids.company, role: "approver" }],
  companyIds: [ids.company],
  employeeCompanyId: null,
  globalRole: null,
  idpSubject: "retry-action-user",
  roles: ["approver"],
  userAccountId: ids.user,
  userId: ids.user,
};

async function seed() {
  await owner.query(
    `TRUNCATE TABLE audit_log,connector_call_observation,request_transition,
       provisioning_action,license_request,integration_credential,license_type,
       vendor_account,vendor,company_role_assignment,person,company,user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@retry-action.test','retry-action-admin','group_admin','en','active',$3),
            ($2,'user@retry-action.test','retry-action-user',NULL,'en','active',$3)`,
    [ids.admin, ids.user, failedAt],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'Retry action','RACT','internal','active','en',$2,$3)`,
    [ids.company, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES ($1,$2,'approver','retry-action-grant',$3,$4)`,
    [ids.user, ids.company, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'person@retry-action.test','Retry Person',$2,'active',$3,$4)`,
    [ids.person, ids.company, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Retry Vendor','api','rest',true,true,true,true,'email','active',$2,$3)`,
    [ids.vendor, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Retry Account','automated',1,'active',$3,$4)`,
    [ids.vendorAccount, ids.vendor, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Retry Seat','seat','active',$3,$4)`,
    [ids.license, ids.vendor, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,created_at,created_by,updated_at)
     VALUES ($1,'RACT-1',$2,$3,$4,$5,'failed','Retry',$6,$7,$6)`,
    [
      ids.request,
      ids.person,
      ids.company,
      ids.vendorAccount,
      ids.license,
      failedAt,
      ids.user,
    ],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (id,request_id,vendor_account_id,kind,mode,status,failure_reason,
        raw_request,raw_response,created_at,resolved_at)
     VALUES ($1,$2,$3,'invite','automated','failed','provider_invitation_failed',
             '{"operation":"provision"}'::jsonb,
             '{"failure_code":"provider_invitation_failed"}'::jsonb,$4,$4)`,
    [ids.action, ids.request, ids.vendorAccount, failedAt],
  );
  await owner.query(
    `INSERT INTO connector_call_observation
       (vendor_account_id,provisioning_action_id,correlation_id,operation,
        attempt,phase,classification,summary,occurred_at)
     VALUES ($1,$2,$3,'provision',1,'requested',NULL,
             '{"endpoint_class":"invitations","method":"POST"}'::jsonb,$4),
            ($1,$2,$3,'provision',1,'failed','client_error',
             '{"endpoint_class":"invitations","method":"POST","http_status":400,"status_class":"client_error"}'::jsonb,$4)`,
    [ids.vendorAccount, ids.action, id("10"), failedAt],
  );
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  database = drizzle(pool, { schema });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await owner?.end();
  await fixture?.stop();
});

beforeEach(seed);

it("maps retry failures to localized destinations and a real Next 403 interrupt", () => {
  expect(retryProvisioningFailureDestination("conflict"))
    .toBe("/excepciones?tab=failed&retryError=conflict");
  expect(retryProvisioningFailureDestination("invalid"))
    .toBe("/excepciones?tab=failed&retryError=invalid");
  const priorAuthInterrupts = process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS;
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
  let forbiddenError: unknown;
  try {
    retryProvisioningFailureDestination("forbidden");
  } catch (error) {
    forbiddenError = error;
  } finally {
    if (priorAuthInterrupts === undefined) {
      delete process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS;
    } else {
      process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = priorAuthInterrupts;
    }
  }
  expect(forbiddenError).toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    message: "NEXT_HTTP_ERROR_FALLBACK;403",
  });
});

it("parses FormData, loads authorization, and retries through the audited real service", async () => {
  const actions = createRetryProvisioningActionService({
    database,
    loadAuthorization: async () => authorization,
  });
  const input = new FormData();
  input.set("actionId", ids.action);

  const result = await actions.retryProvisioning(input);

  expect(result).toEqual({ ok: true, requestId: ids.request });
  const pending = await owner.query(
    `SELECT count(*)::int AS count FROM provisioning_action
     WHERE request_id=$1 AND status='pending'`,
    [ids.request],
  );
  expect(pending.rows).toEqual([{ count: 1 }]);
});

it("returns conflicts and preserves forbidden as HTTP 403", async () => {
  const conflict = createRetryProvisioningActionService({
    database,
    loadAuthorization: async () => authorization,
  });
  await owner.query(
    `INSERT INTO provisioning_action
       (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
     VALUES ($1,$2,$3,'invite','automated','pending','{}'::jsonb,$4)`,
    [id("11"), ids.request, ids.vendorAccount, failedAt],
  );

  const conflictResult = await conflict.retryProvisioning({ actionId: ids.action });

  expect(conflictResult).toEqual({ ok: false, error: "conflict" });

  const forbidden = createRetryProvisioningActionService({
    database,
    loadAuthorization: async () => null,
  });
  const priorAuthInterrupts = process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS;
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
  try {
    const forbiddenResult = await forbidden.retryProvisioning({ actionId: ids.action });
    expect(() => retryProvisioningFailureDestination(forbiddenResult.ok
      ? "invalid"
      : forbiddenResult.error)).toThrowError(expect.objectContaining({
      digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    }));
  } finally {
    if (priorAuthInterrupts === undefined) {
      delete process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS;
    } else {
      process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = priorAuthInterrupts;
    }
  }
});
