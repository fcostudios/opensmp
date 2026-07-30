import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import { createAuthorizationRepository } from "../identity-access/authorization";
import { submitRequestPolicy } from "./actions/submit-request-policy";
import {
  RequestIntakeError,
  createRequestRepository,
} from "./repository";

const ids = {
  admin: "12000000-0000-0000-0000-000000000001",
  employee: "12000000-0000-0000-0000-000000000002",
  approver: "12000000-0000-0000-0000-000000000003",
  viewer: "12000000-0000-0000-0000-000000000004",
  companyA: "12000000-0000-0000-0000-000000000005",
  companyB: "12000000-0000-0000-0000-000000000006",
  inactiveCompany: "12000000-0000-0000-0000-000000000007",
  employeePerson: "12000000-0000-0000-0000-000000000008",
  assignedPerson: "12000000-0000-0000-0000-000000000009",
  vendor: "12000000-0000-0000-0000-000000000010",
  vendorAccount: "12000000-0000-0000-0000-000000000011",
  inactiveVendorAccount: "12000000-0000-0000-0000-000000000012",
  licenseType: "12000000-0000-0000-0000-000000000013",
  noRateLicenseType: "12000000-0000-0000-0000-000000000014",
  inactiveLicenseType: "12000000-0000-0000-0000-000000000015",
  assignment: "12000000-0000-0000-0000-000000000016",
  sourceRequest: "12000000-0000-0000-0000-000000000017",
  crossTenantRequest: "12000000-0000-0000-0000-000000000018",
  crossTenantPerson: "12000000-0000-0000-0000-000000000019",
  importedAssignment: "12000000-0000-0000-0000-000000000020",
  crossTenantAssignment: "12000000-0000-0000-0000-000000000021",
  viewerPerson: "12000000-0000-0000-0000-000000000022",
} as const;

const now = new Date("2026-07-28T15:00:00.000Z");
let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createRequestRepository>;
let loadAuthorization: ReturnType<typeof createAuthorizationRepository>["load"];
let clientRequestSequence = 100;

function nextClientRequestId(): string {
  const suffix = String(clientRequestSequence++).padStart(12, "0");
  return `12000000-0000-4000-8000-${suffix}`;
}

beforeAll(async () => {
  const mutationAppUrl =
    process.env.US012_MUTATION_DATABASE_URL ??
    process.env.US016_MUTATION_DATABASE_URL;
  const mutationOwnerUrl =
    process.env.US012_MUTATION_DATABASE_ADMIN_URL ??
    process.env.US016_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("request mutation harness requires both database URLs");
    }
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
    pool = new pg.Pool({ connectionString: mutationAppUrl });
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    owner = await fixture.connectAsOwner();
    pool = new pg.Pool({ connectionString: fixture.appUrl });
  }
  database = drizzle(pool, { schema });
  repository = createRequestRepository(database);
  loadAuthorization = createAuthorizationRepository(database).load;
});

afterAll(async () => {
  await pool.end();
  await owner.end();
  if (fixture) await fixture.stop();
});

beforeEach(async () => {
  clientRequestSequence = 100;
  await owner.query(
    `TRUNCATE TABLE audit_log, request_transition, license_request, rate_card,
      license_assignment, license_type, vendor_account, vendor,
      company_role_assignment, person, company, user_account
      RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'admin@ledger.test','intake-admin','group_admin','es','active',$5),
       ($2,'employee@acme.test','intake-employee',NULL,'es','active',$5),
       ($3,'approver@acme.test','intake-approver',NULL,'es','active',$5),
       ($4,'viewer@acme.test','intake-viewer',NULL,'es','active',$5)`,
    [ids.admin, ids.employee, ids.approver, ids.viewer, now],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,budget_monthly_usd,finance_contact_email,
        statement_language,created_at,created_by)
     VALUES
       ($1,'Acme','ACME','internal','active',100,'finance@acme.test','es',$4,$5),
       ($2,'Other','OTHER','internal','active',500,'finance@other.test','es',$4,$5),
       ($3,'Dormant','DORM','internal','inactive',500,'finance@dormant.test','es',$4,$5)`,
    [ids.companyA, ids.companyB, ids.inactiveCompany, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES
       ($1,'employee@acme.test','Employee',$3,'active',$4,$5),
       ($2,'assigned@acme.test','Assigned',$3,'active',$4,$5)`,
    [
      ids.employeePerson,
      ids.assignedPerson,
      ids.companyA,
      now,
      ids.admin,
    ],
  );
  await owner.query(
    `UPDATE user_account SET person_id=$1 WHERE id=$2`,
    [ids.employeePerson, ids.employee],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES
       ($1,$2,'approver','intake-approver-a',$4,$5),
       ($3,$2,'viewer','intake-viewer-a',$4,$5),
       ($1,$6,'viewer','intake-approver-b-view',$4,$5),
       ($7,$6,'approver','intake-employee-b-approve',$4,$5)`,
    [
      ids.approver,
      ids.companyA,
      ids.viewer,
      now,
      ids.admin,
      ids.companyB,
      ids.employee,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','orchestration','none',false,false,false,false,
       'email','active',$2,$3)`,
    [ids.vendor, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES
       ($1,$3,'Claude Org','orchestration',1,'active',$4,$5),
       ($2,$3,'Dormant Org','orchestration',1,'inactive',$4,$5)`,
    [
      ids.vendorAccount,
      ids.inactiveVendorAccount,
      ids.vendor,
      now,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES
       ($1,$4,'Claude Team','seat','active',$5,$6),
       ($2,$4,'Claude Max','seat','active',$5,$6),
       ($3,$4,'Dormant Seat','seat','inactive',$5,$6)`,
    [
      ids.licenseType,
      ids.noRateLicenseType,
      ids.inactiveLicenseType,
      ids.vendor,
      now,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO rate_card
       (vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by)
     VALUES ($1,$2,120,'2026-01-01',$3,$4)`,
    [ids.vendorAccount, ids.licenseType, now, ids.admin],
  );
});

async function authorization(subject: string) {
  const result = await loadAuthorization({ subject });
  expect(result).not.toBeNull();
  return result!;
}

describe("request intake repository", () => {
  test("loads only active, role-scoped form options", async () => {
    const options = await repository.formOptions(
      await authorization("intake-approver"),
    );
    expect(options).toEqual({
      allowOnBehalf: true,
      companies: [
        { id: ids.companyA, name: "Acme", domains: ["acme.test"] },
      ],
      vendorAccounts: [
        {
          id: ids.vendorAccount,
          name: "Claude Org",
          licenseTypes: [
            { id: ids.noRateLicenseType, name: "Claude Max" },
            { id: ids.licenseType, name: "Claude Team" },
          ],
        },
      ],
    });
    const adminOptions = await repository.formOptions(
      await authorization("intake-admin"),
    );
    expect(adminOptions.companies.map(({ id }) => id)).toEqual([
      ids.companyA,
      ids.companyB,
    ]);
    expect(adminOptions.allowOnBehalf).toBe(true);
    const employeeOptions = await repository.formOptions(
      await authorization("intake-employee"),
    );
    expect(employeeOptions.companies).toEqual([
      { id: ids.companyA, name: "Acme", domains: ["acme.test"] },
      { id: ids.companyB, name: "Other", domains: ["other.test"] },
    ]);
    expect(employeeOptions.allowOnBehalf).toBe(true);
    const viewerOptions = await repository.formOptions(
      await authorization("intake-viewer"),
    );
    expect(viewerOptions.companies).toEqual([]);
    expect(viewerOptions.allowOnBehalf).toBe(false);
  });

  test("derives self identity and atomically records submitted then pending approval", async () => {
    const clientRequestId = nextClientRequestId();
    const result = await repository.submit(
      await authorization("intake-employee"),
      {
        clientRequestId,
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Customer research",
      },
      now,
    );

    expect(result).toMatchObject({
      requestNo: "SOL-0001",
      redirectTo: `/solicitudes/${result.requestId}`,
    });
    await expect(
      repository.submit(
        await authorization("intake-employee"),
        {
          clientRequestId,
          requestFor: "self",
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.licenseType,
          justification: "Customer research",
        },
        now,
      ),
    ).resolves.toEqual(result);
    const saved = await owner.query(
      `SELECT person_id,company_id,state,requested_by,created_by
       FROM license_request WHERE id=$1`,
      [result.requestId],
    );
    expect(saved.rows).toEqual([
      {
        person_id: ids.employeePerson,
        company_id: ids.companyA,
        state: "pending_approval",
        requested_by: ids.employee,
        created_by: ids.employee,
      },
    ]);
    const transitions = await owner.query(
      `SELECT from_state,to_state FROM request_transition
       WHERE request_id=$1
       ORDER BY CASE WHEN from_state IS NULL THEN 0 ELSE 1 END`,
      [result.requestId],
    );
    expect(transitions.rows).toEqual([
      { from_state: null, to_state: "submitted" },
      { from_state: "submitted", to_state: "pending_approval" },
    ]);
    const audit = await owner.query(
      `SELECT action,before,after,company_id FROM audit_log
       WHERE entity_id=$1
       ORDER BY CASE action WHEN 'request.submitted' THEN 0 ELSE 1 END`,
      [result.requestId],
    );
    expect(audit.rows).toEqual([
      {
        action: "request.submitted",
        before: null,
        after: {
          state: "submitted",
          clientPayload: {
            requestFor: "self",
            vendorAccountId: ids.vendorAccount,
            licenseTypeId: ids.licenseType,
            justification: "Customer research",
            neededBy: null,
          },
          warnings: [
            {
              code: "budget_headroom",
              budgetMonthlyUsd: 100,
              committedRunRateUsd: 0,
              monthlyRateUsd: 120,
              projectedRunRateUsd: 120,
            },
          ],
        },
        company_id: ids.companyA,
      },
      {
        action: "request.pending_approval",
        before: { state: "submitted" },
        after: { state: "pending_approval" },
        company_id: ids.companyA,
      },
    ]);
    const notifications = await owner.query<{
      kind: string;
      recipient_email: string;
    }>(
      `SELECT kind, recipient_email
       FROM lifecycle_notification
       WHERE request_id=$1
       ORDER BY kind, recipient_email`,
      [result.requestId],
    );
    expect(notifications.rows).toEqual([
      { kind: "submission", recipient_email: "employee@acme.test" },
      { kind: "new_request_to_approver", recipient_email: "admin@ledger.test" },
      {
        kind: "new_request_to_approver",
        recipient_email: "approver@acme.test",
      },
    ]);
  });

  test("replays an exact actor-scoped key without duplicate writes and rejects changed semantics", async () => {
    const auth = await authorization("intake-approver");
    const input = {
      clientRequestId: "12000000-0000-4000-8000-000000000201",
      requestFor: "on_behalf" as const,
      personEmail: "retry@acme.test",
      personFullName: "Retry Person",
      personCompanyId: ids.companyA,
      vendorAccountId: ids.vendorAccount,
      licenseTypeId: ids.noRateLicenseType,
      justification: "Idempotent request",
    };
    const first = await repository.submit(auth, input, now);
    const beforeReplay = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM person) AS people,
         (SELECT count(*)::int FROM license_request) AS requests,
         (SELECT count(*)::int FROM request_transition) AS transitions,
         (SELECT count(*)::int FROM audit_log) AS audits`,
    );
    const replay = await repository.submit(auth, input, now);
    expect(replay).toEqual(first);
    await expect(
      repository.requestDetail(auth, first.requestId),
    ).resolves.toMatchObject({
      kind: "request",
      requestId: first.requestId,
      warnings: first.warnings,
    });
    expect(
      (
        await owner.query(
          `SELECT
             (SELECT count(*)::int FROM person) AS people,
             (SELECT count(*)::int FROM license_request) AS requests,
             (SELECT count(*)::int FROM request_transition) AS transitions,
             (SELECT count(*)::int FROM audit_log) AS audits`,
        )
      ).rows,
    ).toEqual(beforeReplay.rows);
    await expect(
      repository.submit(
        auth,
        { ...input, justification: "Changed semantic payload" },
        now,
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  test("serializes concurrent retries for one actor and client key", async () => {
    const auth = await authorization("intake-admin");
    const input = {
      clientRequestId: "12000000-0000-4000-8000-000000000202",
      requestFor: "on_behalf" as const,
      personEmail: "same-key@other.test",
      personFullName: "Same Key",
      personCompanyId: ids.companyB,
      vendorAccountId: ids.vendorAccount,
      licenseTypeId: ids.noRateLicenseType,
      justification: "Concurrent retry",
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => repository.submit(auth, input, now)),
    );
    expect(new Set(results.map(({ requestId }) => requestId)).size).toBe(1);
    expect(
      (
        await owner.query(
          `SELECT
             (SELECT count(*)::int FROM person
              WHERE lower(email)='same-key@other.test') AS people,
             (SELECT count(*)::int FROM license_request) AS requests,
             (SELECT count(*)::int FROM request_transition) AS transitions,
             (SELECT count(*)::int FROM audit_log
              WHERE action LIKE 'request.%') AS audits`,
        )
      ).rows,
    ).toEqual([{ people: 1, requests: 1, transitions: 2, audits: 2 }]);
  });

  test("permits scoped approver/admin on-behalf, warns on unknown domain, and reuses a lowercased person", async () => {
    const input = {
      clientRequestId: nextClientRequestId(),
      requestFor: "on_behalf" as const,
      personEmail: " NEW@UNKNOWN.TEST ",
      personFullName: " New Person ",
      personCompanyId: ids.companyA,
      vendorAccountId: ids.vendorAccount,
      licenseTypeId: ids.noRateLicenseType,
      justification: "Needs access",
    };
    const result = await repository.submit(
      await authorization("intake-approver"),
      input,
      now,
    );
    expect(result.warnings).toEqual([
      { code: "unknown_email_domain" },
      { code: "missing_rate" },
    ]);
    const people = await owner.query(
      `SELECT email,full_name,company_id FROM person WHERE lower(email)='new@unknown.test'`,
    );
    expect(people.rows).toEqual([
      {
        email: "new@unknown.test",
        full_name: "New Person",
        company_id: ids.companyA,
      },
    ]);

    const beforeCounts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM person) AS people,
         (SELECT count(*)::int FROM license_request) AS requests,
         (SELECT count(*)::int FROM request_transition) AS transitions,
         (SELECT count(*)::int FROM audit_log) AS audits`,
    );
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        { ...input, personCompanyId: ids.companyB },
        now,
      ),
    ).rejects.toMatchObject({ code: "person_email_conflict" });
    const afterCounts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM person) AS people,
         (SELECT count(*)::int FROM license_request) AS requests,
         (SELECT count(*)::int FROM request_transition) AS transitions,
         (SELECT count(*)::int FROM audit_log) AS audits`,
    );
    expect(afterCounts.rows).toEqual(beforeCounts.rows);

    await owner.query(
      `CREATE FUNCTION us012_reject_person_insert()
       RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'forced non-unique person failure';
       END
       $$`,
    );
    await owner.query(
      `CREATE TRIGGER us012_reject_person_insert
       BEFORE INSERT ON person
       FOR EACH ROW EXECUTE FUNCTION us012_reject_person_insert()`,
    );
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        {
          ...input,
          personEmail: "nonunique-failure@other.test",
          personCompanyId: ids.companyB,
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await owner.query(`DROP TRIGGER us012_reject_person_insert ON person`);
    await owner.query(`DROP FUNCTION us012_reject_person_insert()`);
  });

  test("rejects unauthorized on-behalf, inactive references, and cross-vendor license types", async () => {
    const base = {
      clientRequestId: nextClientRequestId(),
      requestFor: "on_behalf" as const,
      personEmail: "target@acme.test",
      personFullName: "Target",
      personCompanyId: ids.companyA,
      vendorAccountId: ids.vendorAccount,
      licenseTypeId: ids.licenseType,
      justification: "Needs access",
    };
    await expect(
      repository.submit(await authorization("intake-viewer"), base, now),
    ).rejects.toMatchObject({ code: "on_behalf_forbidden" });
    await expect(
      repository.submit(
        await authorization("intake-approver"),
        { ...base, personCompanyId: ids.companyB },
        now,
      ),
    ).rejects.toMatchObject({ code: "on_behalf_forbidden" });
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        { ...base, personCompanyId: ids.inactiveCompany },
        now,
      ),
    ).rejects.toMatchObject({ code: "company_inactive" });
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        { ...base, vendorAccountId: ids.inactiveVendorAccount },
        now,
      ),
    ).rejects.toMatchObject({ code: "vendor_account_inactive" });
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        { ...base, licenseTypeId: ids.inactiveLicenseType },
        now,
      ),
    ).rejects.toMatchObject({ code: "license_type_inactive" });

    await owner.query(`UPDATE vendor SET status='inactive' WHERE id=$1`, [
      ids.vendor,
    ]);
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        base,
        now,
      ),
    ).rejects.toMatchObject({ code: "vendor_account_inactive" });
    await owner.query(`UPDATE vendor SET status='active' WHERE id=$1`, [
      ids.vendor,
    ]);
    const otherVendor = "12000000-0000-0000-0000-000000000030";
    await owner.query(
      `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
       VALUES ($1,'Other Vendor','orchestration','none',false,false,false,false,
         'email','active',$2,$3)`,
      [otherVendor, now, ids.admin],
    );
    await owner.query(`UPDATE license_type SET vendor_id=$1 WHERE id=$2`, [
      otherVendor,
      ids.licenseType,
    ]);
    await expect(
      repository.submit(
        await authorization("intake-admin"),
        base,
        now,
      ),
    ).rejects.toMatchObject({ code: "vendor_license_mismatch" });
  });

  test("rejects missing self identity and an inactive existing on-behalf person", async () => {
    await owner.query(`UPDATE person SET status='departed' WHERE id=$1`, [
      ids.employeePerson,
    ]);
    await expect(
      repository.submit(
        await authorization("intake-employee"),
        {
          clientRequestId: nextClientRequestId(),
          requestFor: "self",
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.licenseType,
          justification: "Inactive self",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "person_inactive" });
    await owner.query(`UPDATE person SET status='active' WHERE id=$1`, [
      ids.employeePerson,
    ]);
    await expect(
      repository.submit(
        await authorization("intake-approver"),
        {
          clientRequestId: nextClientRequestId(),
          requestFor: "self",
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.licenseType,
          justification: "No linked person",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "self_identity_unavailable" });
    await owner.query(`UPDATE person SET status='departed' WHERE id=$1`, [
      ids.assignedPerson,
    ]);
    await expect(
      repository.submit(
        await authorization("intake-approver"),
        {
          clientRequestId: nextClientRequestId(),
          requestFor: "on_behalf",
          personEmail: "assigned@acme.test",
          personFullName: "Assigned",
          personCompanyId: ids.companyA,
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.licenseType,
          justification: "Inactive person",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "person_inactive" });
  });

  test("blocks an existing open assignment with only an authorized assignment URL", async () => {
    await owner.query(
      `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
       VALUES ($1,'cross@other.test','Cross Person',$2,'active',$3,$4)`,
      [ids.crossTenantPerson, ids.companyB, now, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,requested_by,created_at,created_by)
       VALUES ($1,'SOL-0990',$2,$3,$4,$5,'active','Backfilled assignment',
         $6,$7,$6)`,
      [
        ids.sourceRequest,
        ids.employeePerson,
        ids.companyA,
        ids.vendorAccount,
        ids.licenseType,
        ids.employee,
        now,
      ],
    );
    await owner.query(
      `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_request_id,source_kind,created_at,created_by)
       VALUES ($1,$2,$3,$4,$5,'2026-01-01',$6,'request',$7,$8)`,
      [
        ids.assignment,
        ids.employeePerson,
        ids.companyA,
        ids.vendorAccount,
        ids.licenseType,
        ids.sourceRequest,
        now,
        ids.admin,
      ],
    );
    await expect(
      repository.submit(
        await authorization("intake-employee"),
        {
          clientRequestId: nextClientRequestId(),
          requestFor: "self",
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.licenseType,
          justification: "Duplicate",
        },
        now,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RequestIntakeError>>({
        code: "active_assignment_exists",
        href: `/solicitudes/${ids.sourceRequest}`,
      }),
    );
    await expect(
      repository.requestDetail(
        await authorization("intake-employee"),
        ids.sourceRequest,
      ),
    ).resolves.toMatchObject({ requestId: ids.sourceRequest });
    await expect(
      repository.requestDetail(
        await authorization("intake-approver"),
        ids.sourceRequest,
      ),
    ).resolves.toMatchObject({ requestId: ids.sourceRequest });

    await owner.query(
      `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,requested_by,created_at,created_by)
       VALUES ($1,'SOL-0991',$2,$3,$4,$5,'pending_approval','Cross tenant',
         $6,$7,$6)`,
      [
        ids.crossTenantRequest,
        ids.crossTenantPerson,
        ids.companyB,
        ids.vendorAccount,
        ids.licenseType,
        ids.admin,
        now,
      ],
    );
    await expect(
      repository.requestDetail(
        await authorization("intake-approver"),
        ids.crossTenantRequest,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.requestDetail(
        await authorization("intake-admin"),
        ids.crossTenantRequest,
      ),
    ).resolves.toMatchObject({ requestId: ids.crossTenantRequest });
    await expect(
      repository.requestDetail(
        await authorization("intake-viewer"),
        ids.sourceRequest,
      ),
    ).resolves.toBeNull();

    await owner.query(
      `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
       VALUES ($1,$2,'approver','intake-approver-b',$3,$4)`,
      [ids.approver, ids.companyB, now, ids.admin],
    );
    await expect(
      repository.requestDetail(
        await authorization("intake-approver"),
        ids.crossTenantRequest,
      ),
    ).resolves.toMatchObject({ requestId: ids.crossTenantRequest });
  });

  test("resolves imported assignment fallback details with strict UUID and tenant authorization", async () => {
    await owner.query(
      `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
       VALUES ($1,'cross@other.test','Cross Person',$2,'active',$3,$4)`,
      [ids.crossTenantPerson, ids.companyB, now, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_request_id,source_kind,created_at,created_by)
       VALUES
         ($1,$2,$3,$4,$5,'2026-01-01',NULL,'import',$6,$7),
         ($8,$9,$10,$4,$5,'2026-01-01',NULL,'import',$6,$7)`,
      [
        ids.importedAssignment,
        ids.employeePerson,
        ids.companyA,
        ids.vendorAccount,
        ids.licenseType,
        now,
        ids.admin,
        ids.crossTenantAssignment,
        ids.crossTenantPerson,
        ids.companyB,
      ],
    );
    await expect(
      repository.submit(
        await authorization("intake-employee"),
        {
          clientRequestId: nextClientRequestId(),
          requestFor: "self",
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.licenseType,
          justification: "Imported duplicate",
        },
        now,
      ),
    ).rejects.toMatchObject({
      code: "active_assignment_exists",
      href: `/solicitudes/${ids.importedAssignment}`,
    });
    await expect(
      repository.requestDetail(
        await authorization("intake-employee"),
        ids.importedAssignment,
      ),
    ).resolves.toMatchObject({
      kind: "assignment",
      assignmentId: ids.importedAssignment,
    });
    await expect(
      repository.requestDetail(
        await authorization("intake-approver"),
        ids.importedAssignment,
      ),
    ).resolves.toMatchObject({
      kind: "assignment",
      assignmentId: ids.importedAssignment,
    });
    await expect(
      repository.requestDetail(
        await authorization("intake-viewer"),
        ids.importedAssignment,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.requestDetail(
        await authorization("intake-approver"),
        ids.crossTenantAssignment,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.requestDetail(
        await authorization("intake-admin"),
        ids.crossTenantAssignment,
      ),
    ).resolves.toMatchObject({
      kind: "assignment",
      assignmentId: ids.crossTenantAssignment,
    });
    await expect(
      repository.requestDetail(
        await authorization("intake-admin"),
        "not-a-uuid",
      ),
    ).resolves.toBeNull();
  });

  test("emits a budget warning only with a current rate and projected overspend", async () => {
    await owner.query(
      `UPDATE company SET budget_monthly_usd=200 WHERE id=$1`,
      [ids.companyA],
    );
    await owner.query(
      `INSERT INTO license_assignment
       (person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_kind,created_at,created_by)
       VALUES ($1,$2,$3,$4,'2026-01-01','import',$5,$6)`,
      [
        ids.assignedPerson,
        ids.companyA,
        ids.vendorAccount,
        ids.licenseType,
        now,
        ids.admin,
      ],
    );
    const result = await repository.submit(
      await authorization("intake-employee"),
      {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Budget check",
      },
      now,
    );
    expect(result.warnings).toEqual([
      {
        code: "budget_headroom",
        budgetMonthlyUsd: 200,
        committedRunRateUsd: 120,
        monthlyRateUsd: 120,
        projectedRunRateUsd: 240,
      },
    ]);
  });

  test("suppresses budget warnings without a budget, with unpriced commitments, and at the exact boundary", async () => {
    await owner.query(
      `UPDATE company SET budget_monthly_usd=NULL WHERE id=$1`,
      [ids.companyA],
    );
    const noBudget = await repository.submit(
      await authorization("intake-employee"),
      {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "No budget",
      },
      now,
    );
    expect(noBudget.warnings).toEqual([]);

    await owner.query(
      `UPDATE company SET budget_monthly_usd=120 WHERE id=$1`,
      [ids.companyA],
    );
    const exact = await repository.submit(
      await authorization("intake-employee"),
      {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Exact budget",
      },
      now,
    );
    expect(exact.warnings).toEqual([]);

    await owner.query(
      `UPDATE company SET budget_monthly_usd=100 WHERE id=$1`,
      [ids.companyA],
    );
    await owner.query(
      `INSERT INTO license_assignment
         (person_id,company_id,vendor_account_id,license_type_id,started_on,
          source_kind,created_at,created_by)
       VALUES ($1,$2,$3,$4,'2026-01-01','import',$5,$6)`,
      [
        ids.assignedPerson,
        ids.companyA,
        ids.vendorAccount,
        ids.noRateLicenseType,
        now,
        ids.admin,
      ],
    );
    const unpriced = await repository.submit(
      await authorization("intake-employee"),
      {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Unpriced commitment",
      },
      now,
    );
    expect(unpriced.warnings).toEqual([]);
  });

  test("serializes concurrent sequence allocation and person creation", async () => {
    const admin = await authorization("intake-admin");
    const submit = (email: string) =>
      repository.submit(
        admin,
        {
          clientRequestId: nextClientRequestId(),
          requestFor: "on_behalf",
          personEmail: email,
          personFullName: "Concurrent Person",
          personCompanyId: ids.companyB,
          vendorAccountId: ids.vendorAccount,
          licenseTypeId: ids.noRateLicenseType,
          justification: "Concurrent request",
        },
        now,
      );

    const results = await Promise.all([
      submit("CASE@OTHER.TEST"),
      submit("case@other.test"),
      ...Array.from({ length: 8 }, (_, index) =>
        submit(`parallel-${index}@other.test`),
      ),
    ]);
    expect(new Set(results.map(({ requestNo }) => requestNo))).toEqual(
      new Set(
        Array.from(
          { length: 10 },
          (_, index) => `SOL-${String(index + 1).padStart(4, "0")}`,
        ),
      ),
    );
    const count = await owner.query(
      `SELECT count(*)::int AS count FROM person
       WHERE lower(email) = 'case@other.test'`,
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  test("the action policy rejects malformed and unauthenticated submissions without writes", async () => {
    const authRepository = createAuthorizationRepository(database);
    const malformed = await submitRequestPolicy({
      input: { requestFor: "self" },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-employee",
    });
    const unauthenticated = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Should not persist",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: null,
    });
    const deniedViewer = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Viewer cannot submit",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-viewer",
    });
    const deniedAdminSelf = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Admin has no self identity",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-admin",
    });
    expect(malformed).toEqual({ ok: false, error: "invalid_request" });
    expect(unauthenticated).toEqual({ ok: false, error: "forbidden" });
    expect(deniedViewer).toEqual({ ok: false, error: "forbidden" });
    expect(deniedAdminSelf).toEqual({ ok: false, error: "forbidden" });
    expect(
      (await owner.query(`SELECT count(*)::int AS count FROM license_request`))
        .rows[0]?.count,
    ).toBe(0);
    expect(
      (
        await owner.query(
          `SELECT action,company_id,after
           FROM audit_log
           WHERE action='authorization.denied'`,
        )
      ).rows,
    ).toEqual([
      {
        action: "authorization.denied",
        company_id: null,
        after: {
          capability: "request:create",
          errorCode: "capability_forbidden",
        },
      },
      {
        action: "authorization.denied",
        company_id: null,
        after: {
          capability: "request:create",
          errorCode: "capability_forbidden",
        },
      },
    ]);
  });

  test("the action policy audits an employee forged on-behalf request before business writes", async () => {
    const authRepository = createAuthorizationRepository(database);
    const before = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM person) AS people,
         (SELECT count(*)::int FROM license_request) AS requests,
         (SELECT count(*)::int FROM request_transition) AS transitions,
         (SELECT count(*)::int FROM audit_log
          WHERE action LIKE 'request.%') AS business_audits`,
    );
    const denied = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "on_behalf",
        personEmail: "forged@acme.test",
        personFullName: "Forged Employee Target",
        personCompanyId: ids.companyA,
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Employee forged on-behalf request",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-employee",
    });
    expect(denied).toEqual({ ok: false, error: "forbidden" });
    expect(
      (
        await owner.query(
          `SELECT
             (SELECT count(*)::int FROM person) AS people,
             (SELECT count(*)::int FROM license_request) AS requests,
             (SELECT count(*)::int FROM request_transition) AS transitions,
             (SELECT count(*)::int FROM audit_log
              WHERE action LIKE 'request.%') AS business_audits`,
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await owner.query(
          `SELECT action,company_id,after
           FROM audit_log
           WHERE action='authorization.denied'`,
        )
      ).rows,
    ).toEqual([
      {
        action: "authorization.denied",
        company_id: ids.companyA,
        after: {
          capability: "request:create",
          errorCode: "capability_forbidden",
        },
      },
    ]);
  });

  test("the action policy rejects a same-company non-approver grant", async () => {
    await owner.query(
      `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
       VALUES ($1,'viewer-person@acme.test','Viewer Person',$2,'active',$3,$4)`,
      [ids.viewerPerson, ids.companyA, now, ids.admin],
    );
    await owner.query(
      `UPDATE user_account SET person_id=$1 WHERE id=$2`,
      [ids.viewerPerson, ids.viewer],
    );
    const authRepository = createAuthorizationRepository(database);
    const denied = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "on_behalf",
        personEmail: "viewer-forged@acme.test",
        personFullName: "Viewer Forged Target",
        personCompanyId: ids.companyA,
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Viewer grant is not approver authority",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-viewer",
    });
    expect(denied).toEqual({ ok: false, error: "forbidden" });
    expect(
      (
        await owner.query(
          `SELECT count(*)::int AS count
           FROM audit_log
           WHERE action='authorization.denied'
             AND company_id=$1`,
          [ids.companyA],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("the action policy returns the persisted request result and typed repository errors", async () => {
    const authRepository = createAuthorizationRepository(database);
    const adminOnBehalf = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "on_behalf",
        personEmail: "admin-policy-person@other.test",
        personFullName: "Admin Policy Person",
        personCompanyId: ids.companyB,
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.noRateLicenseType,
        justification: "Group admin on behalf",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-admin",
    });
    expect(adminOnBehalf).toMatchObject({ ok: true });
    const onBehalf = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "on_behalf",
        personEmail: "policy-person@acme.test",
        personFullName: "Policy Person",
        personCompanyId: ids.companyA,
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.noRateLicenseType,
        justification: "Policy on behalf",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-approver",
    });
    expect(onBehalf).toMatchObject({ ok: true });
    const success = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Policy success",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-employee",
    });
    expect(success).toEqual(
      expect.objectContaining({
        ok: true,
        redirectTo: expect.stringMatching(/^\/solicitudes\/[0-9a-f-]+$/),
        warnings: [
          {
            code: "budget_headroom",
            budgetMonthlyUsd: 100,
            committedRunRateUsd: 0,
            monthlyRateUsd: 120,
            projectedRunRateUsd: 120,
          },
        ],
      }),
    );
    await owner.query(
      `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_request_id,source_kind,created_at,created_by)
       VALUES ($1,$2,$3,$4,$5,'2026-01-01',$6,'request',$7,$8)`,
      [
        ids.assignment,
        ids.employeePerson,
        ids.companyA,
        ids.vendorAccount,
        ids.licenseType,
        success.ok ? success.requestId : ids.sourceRequest,
        now,
        ids.admin,
      ],
    );
    const duplicate = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Policy duplicate",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-employee",
    });
    expect(duplicate).toEqual({
      ok: false,
      error: "active_assignment_exists",
      href: success.ok ? success.redirectTo : undefined,
    });
  });

  test("the action policy audits on-behalf denial and maps a real database failure", async () => {
    const authRepository = createAuthorizationRepository(database);
    const denied = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "on_behalf",
        personEmail: "denied@other.test",
        personFullName: "Denied",
        personCompanyId: ids.companyB,
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Denied",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-approver",
    });
    expect(denied).toEqual({ ok: false, error: "forbidden" });
    expect(
      (
        await owner.query(
          `SELECT action,company_id,after FROM audit_log
           WHERE action='authorization.denied'`,
        )
      ).rows,
    ).toEqual([
      {
        action: "authorization.denied",
        company_id: ids.companyB,
        after: {
          capability: "request:create",
          errorCode: "capability_forbidden",
        },
      },
    ]);

    await owner.query(
      `CREATE OR REPLACE FUNCTION reject_intake_test() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intake test failure'; END $$;
       CREATE TRIGGER reject_intake_test
       BEFORE INSERT ON license_request
       FOR EACH ROW EXECUTE FUNCTION reject_intake_test()`,
    );
    const failed = await submitRequestPolicy({
      input: {
        clientRequestId: nextClientRequestId(),
        requestFor: "self",
        vendorAccountId: ids.vendorAccount,
        licenseTypeId: ids.licenseType,
        justification: "Database failure",
      },
      loadAuthorization,
      occurredAt: now,
      recordAuthorizationFailure: authRepository.recordAuthorizationFailure,
      repository,
      subject: "intake-employee",
    });
    await owner.query(
      `DROP TRIGGER reject_intake_test ON license_request;
       DROP FUNCTION reject_intake_test()`,
    );
    expect(failed).toEqual({ ok: false, error: "submission_failed" });
  });
});
