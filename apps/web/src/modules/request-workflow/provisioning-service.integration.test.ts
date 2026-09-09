import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { createProvisioningService } from "./provisioning-service";

const id = (suffix: string) => `36500000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  approver: id("2"),
  companyA: id("3"),
  companyB: id("4"),
  personA: id("5"),
  personB: id("6"),
  vendor: id("7"),
  accountA: id("8"),
  accountB: id("9"),
  license: id("10"),
  requestA: id("11"),
  requestB: id("12"),
  actionA: id("13"),
  actionB: id("14"),
  correlationA: id("15"),
  correlationB: id("16"),
} as const;
const failedAt = new Date("2026-09-09T01:00:00.000Z");
const retriedAt = new Date("2026-09-09T02:00:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

function authorization(companyIds: readonly string[]): LedgerAuthorization {
  return {
    companyGrants: companyIds.map((companyId) => ({ companyId, role: "approver" as const })),
    companyIds,
    employeeCompanyId: null,
    globalRole: null,
    idpSubject: "retry-approver",
    roles: ["approver"],
    userAccountId: ids.approver,
    userId: ids.approver,
  };
}

async function seed(): Promise<void> {
  await owner.query(
    `TRUNCATE TABLE audit_log,connector_call_observation,request_transition,
       provisioning_action,license_request,integration_credential,license_type,
       vendor_account,vendor,company_role_assignment,person,company,user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@retry.test','retry-admin','group_admin','en','active',$3),
            ($2,'approver@retry.test','retry-approver',NULL,'en','active',$3)`,
    [ids.admin, ids.approver, failedAt],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'A','RETA','internal','active','en',$3,$4),
            ($2,'B','RETB','internal','active','en',$3,$4)`,
    [ids.companyA, ids.companyB, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES ($1,$2,'approver','retry-a',$3,$4)`,
    [ids.approver, ids.companyA, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'a@retry.test','A',$3,'active',$5,$6),
            ($2,'b@retry.test','B',$4,'active',$5,$6)`,
    [ids.personA, ids.personB, ids.companyA, ids.companyB, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`,
    [ids.vendor, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$3,'A','automated',1,'active',$4,$5),
            ($2,$3,'B','automated',1,'active',$4,$5)`,
    [ids.accountA, ids.accountB, ids.vendor, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Claude seat','seat','active',$3,$4)`,
    [ids.license, ids.vendor, failedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,created_at,created_by,updated_at)
     VALUES ($1,'RET-A',$3,$5,$7,$9,'failed','A',$10,$11,$10),
            ($2,'RET-B',$4,$6,$8,$9,'failed','B',$10,$11,$10)`,
    [
      ids.requestA, ids.requestB, ids.personA, ids.personB, ids.companyA,
      ids.companyB, ids.accountA, ids.accountB, ids.license, failedAt, ids.approver,
    ],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (id,request_id,vendor_account_id,kind,mode,status,failure_reason,
        raw_request,raw_response,created_at,resolved_at)
     VALUES ($1,$3,$5,'invite','automated','failed','provider_invitation_failed',
             $7::jsonb,'{"failure_code":"provider_invitation_failed"}'::jsonb,$9,$9),
            ($2,$4,$6,'invite','automated','failed','provider_invitation_failed',
             $8::jsonb,'{"failure_code":"provider_invitation_failed"}'::jsonb,$9,$9)`,
    [
      ids.actionA, ids.actionB, ids.requestA, ids.requestB, ids.accountA, ids.accountB,
      JSON.stringify({ operation: "provision" }),
      JSON.stringify({ operation: "provision" }), failedAt,
    ],
  );
  await owner.query(
     `INSERT INTO connector_call_observation
       (vendor_account_id,provisioning_action_id,correlation_id,operation,
        attempt,phase,classification,summary,occurred_at)
     VALUES ($1,$3,$5,'provision',1,'requested',NULL,
             '{"endpoint_class":"invitations","method":"POST"}'::jsonb,$9),
            ($1,$3,$5,'provision',1,'failed','client_error',$7::jsonb,$9),
            ($2,$4,$6,'provision',1,'requested',NULL,
             '{"endpoint_class":"invitations","method":"POST"}'::jsonb,$9),
            ($2,$4,$6,'provision',1,'failed','client_error',$8::jsonb,$9)`,
    [
      ids.accountA, ids.accountB, ids.actionA, ids.actionB,
      ids.correlationA, ids.correlationB,
      JSON.stringify({ endpoint_class: "invitations", method: "POST", http_status: 400, status_class: "client_error" }),
      JSON.stringify({ endpoint_class: "invitations", method: "POST", http_status: 400, status_class: "client_error" }),
      failedAt,
    ],
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

describe("US-065 provisioning retry", () => {
  it("creates one new live action and preserves the failed attempt under concurrent retries", async () => {
    const service = createProvisioningService(database, { now: () => retriedAt });

    const results = await Promise.all([
      service.retryProvisioning(authorization([ids.companyA]), { actionId: ids.actionA }),
      service.retryProvisioning(authorization([ids.companyA]), { actionId: ids.actionA }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "conflict" }]);
    const rows = await owner.query(
      `SELECT id::text,status::text,failure_reason,created_at,resolved_at
       FROM provisioning_action WHERE request_id=$1 ORDER BY created_at,id`,
      [ids.requestA],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      id: ids.actionA,
      status: "failed",
      failure_reason: "provider_invitation_failed",
      resolved_at: failedAt,
    });
    expect(rows.rows[1]).toMatchObject({ status: "pending", failure_reason: null, resolved_at: null });
    expect(rows.rows[1]?.id).not.toBe(ids.actionA);
    await expect(owner.query(
      `SELECT from_state,to_state,actor_user_id,note
       FROM request_transition WHERE request_id=$1`,
      [ids.requestA],
    )).resolves.toMatchObject({ rows: [{
      from_state: "failed",
      to_state: "provisioning",
      actor_user_id: ids.approver,
      note: "Provisioning retry issued",
    }] });
  });

  it("rejects requested-only unresolved evidence without creating another action", async () => {
    await owner.query(
      `UPDATE provisioning_action SET status='pending',failure_reason=NULL,
         raw_response=NULL,resolved_at=NULL WHERE id=$1`,
      [ids.actionA],
    );
    await owner.query("TRUNCATE TABLE connector_call_observation");
    await owner.query(
      `INSERT INTO connector_call_observation
         (vendor_account_id,provisioning_action_id,correlation_id,operation,
          attempt,phase,classification,summary,occurred_at)
       VALUES ($1,$2,$3,'provision',1,'requested',NULL,
               '{"endpoint_class":"invitations","method":"POST"}'::jsonb,$4)`,
      [ids.accountA, ids.actionA, ids.correlationA, failedAt],
    );
    const service = createProvisioningService(database, { now: () => retriedAt });

    await expect(service.retryProvisioning(
      authorization([ids.companyA]),
      { actionId: ids.actionA },
    )).resolves.toEqual({ ok: false, error: "conflict" });
    await expect(owner.query(
      "SELECT count(*)::int AS count FROM provisioning_action WHERE request_id=$1",
      [ids.requestA],
    )).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("returns forbidden for another company and records only sanitized denial evidence", async () => {
    const service = createProvisioningService(database, { now: () => retriedAt });

    await expect(service.retryProvisioning(
      authorization([ids.companyA]),
      { actionId: ids.actionB },
    )).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(owner.query(
      `SELECT action,entity_type,entity_id,company_id,after
       FROM audit_log WHERE action='authorization.denied'`,
    )).resolves.toMatchObject({ rows: [{
      action: "authorization.denied",
      entity_type: "ProvisioningAction",
      entity_id: ids.actionB,
      company_id: ids.companyB,
      after: { capability: "request:approve", errorCode: "capability_forbidden" },
    }] });
    await expect(owner.query(
      `SELECT request.state,action.status
       FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionB],
    )).resolves.toMatchObject({ rows: [{ state: "failed", status: "failed" }] });
  });
});
