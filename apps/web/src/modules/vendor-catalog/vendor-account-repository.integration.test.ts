import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../identity-access/authorization";
import * as schema from "@smp/db/schema";
import {
  createVendorAccountService,
  VendorAccountError,
} from "./vendor-account-service";
import {
  createVendorAccountRepository,
  type VendorAccountListItem,
} from "./vendor-account-repository";

const id = (suffix: string) =>
  `25000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const ids = {
  admin: id("1"),
  finance: id("2"),
  company: id("3"),
  personA: id("4"),
  personB: id("5"),
  personC: id("6"),
  vendorAnthropic: id("10"),
  vendorInactiveAnthropic: id("11"),
  vendorOther: id("12"),
  accountMain: id("20"),
  accountZero: id("21"),
  accountOther: id("22"),
  accountInactive: id("23"),
  accountCaseTie: id("24"),
  licenseApi: id("30"),
  licenseStandard: id("31"),
  licenseOther: id("32"),
  licenseLegacy: id("33"),
  capacityStandard: id("40"),
  capacityApi: id("41"),
  assignmentStandardA: id("50"),
  assignmentStandardB: id("51"),
  assignmentApi: id("52"),
  assignmentExpired: id("53"),
  requestA: id("60"),
  requestB: id("61"),
  rateExpired: id("70"),
  rateCurrentLowId: id("71"),
  rateCurrentHighId: id("72"),
  rateFuture: id("73"),
  rateApiExpired: id("74"),
  rateApiFuture: id("75"),
  credentialOk: id("80"),
  credentialUnverified: id("81"),
  credentialAuthFailed: id("82"),
  credentialRetired: id("83"),
  credentialOtherOk: id("84"),
  credentialOtherRetired: id("85"),
  credentialInactiveUnverified: id("86"),
  priorAudit: id("90"),
  nonexistentAccount: id("999"),
};

const evaluatedAt = new Date("2026-08-13T15:00:00.000Z");

const authorization = (
  globalRole: "group_admin" | "central_finance",
): LedgerAuthorization => ({
  companyGrants: [],
  companyIds: [ids.company],
  employeeCompanyId: null,
  globalRole,
  idpSubject: `vendor-catalog-${globalRole}`,
  roles: [globalRole],
  userAccountId: globalRole === "group_admin" ? ids.admin : ids.finance,
  userId: globalRole === "group_admin" ? ids.admin : ids.finance,
});

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;
let repository: ReturnType<typeof createVendorAccountRepository>;
let service: ReturnType<typeof createVendorAccountService>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `TRUNCATE TABLE integration_credential, rate_card, provisioning_action,
       license_request, vendor_account_capacity, license_assignment, license_type,
       vendor_account, vendor, person, company, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'admin@vendor-catalog.test','vendor-catalog-group_admin','group_admin','es','active',$3),
       ($2,'finance@vendor-catalog.test','vendor-catalog-central_finance','central_finance','es','active',$3)`,
    [ids.admin, ids.finance, evaluatedAt],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'Vendor Catalog Company','VCC','internal','active','es',$2,$3)`,
    [ids.company, evaluatedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES
       ($1,'a@vendor-catalog.test','Catalog A',$4,'active',$5,$6),
       ($2,'b@vendor-catalog.test','Catalog B',$4,'active',$5,$6),
       ($3,'c@vendor-catalog.test','Catalog C',$4,'active',$5,$6)`,
    [ids.personA, ids.personB, ids.personC, ids.company, evaluatedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES
       ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$4,$5),
       ($2,'anthropic','manual','none',false,false,false,false,'upn','inactive',$4,$5),
       ($3,'OpenAI','orchestration','scim',false,true,true,false,'vendor_user_id','active',$4,$5)`,
    [
      ids.vendorAnthropic,
      ids.vendorInactiveAnthropic,
      ids.vendorOther,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,vendor_org_ref,contract_renewal_on,low_pool_floor,
        status,created_at,created_by)
     VALUES
       ($1,$6,'alpha enterprise','automated','org-alpha','2027-02-01',5,'active',$9,$10),
       ($2,$6,'same','orchestration',NULL,NULL,0,'active',$9,$10),
       ($3,$7,'Beta Provider','orchestration','other-org','2027-05-05',2,'active',$9,$10),
       ($4,$8,'Archived Anthropic','orchestration','archived-org',NULL,1,'inactive',$9,$10),
       ($5,$6,'SAME','orchestration',NULL,NULL,0,'active',$9,$10)`,
    [
      ids.accountMain,
      ids.accountZero,
      ids.accountOther,
      ids.accountInactive,
      ids.accountCaseTie,
      ids.vendorAnthropic,
      ids.vendorOther,
      ids.vendorInactiveAnthropic,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES
       ($1,$5,'API','license','active',$7,$8),
       ($2,$5,'Standard','seat','active',$7,$8),
       ($3,$6,'Other Seat','seat','inactive',$7,$8),
       ($4,$5,'Legacy','seat','inactive',$7,$8)`,
    [
      ids.licenseApi,
      ids.licenseStandard,
      ids.licenseOther,
      ids.licenseLegacy,
      ids.vendorAnthropic,
      ids.vendorOther,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO vendor_account_capacity
       (id,vendor_account_id,license_type_id,purchased_qty,effective_from,note,
        created_at,created_by)
     VALUES
       ($1,$3,$4,10,'2026-08-01','standard',$6,$7),
       ($2,$3,$5,3,'2026-08-01','api',$6,$7)`,
    [
      ids.capacityStandard,
      ids.capacityApi,
      ids.accountMain,
      ids.licenseStandard,
      ids.licenseApi,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,ended_on,
        source_kind,created_at,created_by)
     VALUES
       ($1,$5,$8,$9,$10,'2026-01-01',NULL,'import',$12,$13),
       ($2,$6,$8,$9,$10,'2026-01-01',NULL,'import',$12,$13),
       ($3,$7,$8,$9,$11,'2026-01-01',NULL,'import',$12,$13),
       ($4,$7,$8,$9,$10,'2025-01-01','2025-12-31','import',$12,$13)`,
    [
      ids.assignmentStandardA,
      ids.assignmentStandardB,
      ids.assignmentApi,
      ids.assignmentExpired,
      ids.personA,
      ids.personB,
      ids.personC,
      ids.company,
      ids.accountMain,
      ids.licenseStandard,
      ids.licenseApi,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,
        justification,created_at,created_by)
     VALUES
       ($1,'VA-1',$3,$5,$6,$7,'provisioning','pending invite',$8,$9),
       ($2,'VA-2',$4,$5,$6,$7,'provisioning','sent invite',$8,$9)`,
    [
      ids.requestA,
      ids.requestB,
      ids.personA,
      ids.personB,
      ids.company,
      ids.accountMain,
      ids.licenseStandard,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (request_id,vendor_account_id,kind,mode,status,created_at)
     VALUES
       ($1,$3,'invite','automated','pending',$4),
       ($2,$3,'invite','automated','sent',$4)`,
    [ids.requestA, ids.requestB, ids.accountMain, evaluatedAt],
  );
  await owner.query(
    `INSERT INTO rate_card
       (id,vendor_account_id,license_type_id,monthly_rate_usd,effective_from,
        effective_to,created_at,created_by)
     VALUES
       ($1,$7,$8,50.00,'2026-01-01','2026-06-30',$10,$11),
       ($2,$7,$8,62.00,'2026-07-01',NULL,$10,$11),
       ($3,$7,$8,64.25,'2026-07-15',NULL,$10,$11),
       ($4,$7,$8,70.00,'2026-09-01',NULL,$10,$11),
       ($5,$7,$9,80.00,'2026-01-01','2026-08-12',$10,$11),
       ($6,$7,$9,90.00,'2026-08-14',NULL,$10,$11)`,
    [
      ids.rateExpired,
      ids.rateCurrentLowId,
      ids.rateCurrentHighId,
      ids.rateFuture,
      ids.rateApiExpired,
      ids.rateApiFuture,
      ids.accountMain,
      ids.licenseStandard,
      ids.licenseApi,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO integration_credential
       (id,vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by)
     VALUES
       ($1,$8,'admin_scoped','secret','ok','active',$11,$12),
       ($2,$8,'analytics','secret','unverified','active',$11,$12),
       ($3,$8,'graph_app','secret','auth_failed','active',$11,$12),
       ($4,$8,'scim_bearer','secret','auth_failed','retired',$11,$12),
       ($5,$9,'admin_scoped','secret','ok','active',$11,$12),
       ($6,$9,'analytics','secret','auth_failed','retired',$11,$12),
       ($7,$10,'admin_scoped','secret','unverified','active',$11,$12)`,
    [
      ids.credentialOk,
      ids.credentialUnverified,
      ids.credentialAuthFailed,
      ids.credentialRetired,
      ids.credentialOtherOk,
      ids.credentialOtherRetired,
      ids.credentialInactiveUnverified,
      ids.accountMain,
      ids.accountOther,
      ids.accountInactive,
      evaluatedAt,
      ids.admin,
    ],
  );

  repository = createVendorAccountRepository(fixture.appUrl);
  service = createVendorAccountService(drizzle(appPool, { schema }), {
    now: () => new Date("2026-08-14T10:30:00.000Z"),
  });
}, 120_000);

afterAll(async () => {
  await Promise.all([repository?.close(), appPool?.end(), owner?.end()]);
  await fixture?.stop();
});

describe("US-025 audited vendor-account lifecycle commands", () => {
  const changedAt = new Date("2026-08-14T10:30:00.000Z");
  const createInput = {
    vendorId: ids.vendorAnthropic,
    name: "  Claude Enterprise  ",
    mode: "automated" as const,
    vendorOrgRef: "  org-claude-enterprise  ",
    contractRenewalOn: "2028-01-31",
    lowPoolFloor: 7,
  };

  async function catalogState() {
    const accounts = await owner.query(
      `SELECT id, vendor_id, name, mode, vendor_org_ref,
              contract_renewal_on::text, low_pool_floor, status,
              created_at, created_by, updated_at, updated_by
       FROM vendor_account ORDER BY id`,
    );
    const audits = await owner.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, company_id,
              note, before, after, occurred_at
       FROM audit_log ORDER BY id`,
    );
    return { accounts: accounts.rows, audits: audits.rows };
  }

  async function accountState(accountId: string) {
    const account = await owner.query(
      `SELECT id, vendor_id, name, mode, vendor_org_ref,
              contract_renewal_on::text, low_pool_floor, status,
              created_at, created_by, updated_at, updated_by
       FROM vendor_account WHERE id=$1`,
      [accountId],
    );
    const audits = await owner.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, company_id,
              note, before, after, occurred_at
       FROM audit_log WHERE entity_id=$1 ORDER BY id`,
      [accountId],
    );
    return { account: account.rows, audits: audits.rows };
  }

  async function rejectedUpdateState(accountId: string) {
    return {
      catalog: await catalogState(),
      target: await accountState(accountId),
    };
  }

  async function dependentState(accountId: string) {
    const capacities = await owner.query(
      `SELECT id, vendor_account_id, license_type_id, purchased_qty,
              effective_from::text, note, created_at, created_by
       FROM vendor_account_capacity WHERE vendor_account_id=$1 ORDER BY id`,
      [accountId],
    );
    const assignments = await owner.query(
      `SELECT id, person_id, company_id, vendor_account_id, license_type_id,
              started_on::text, ended_on::text, source_kind, created_at, created_by
       FROM license_assignment WHERE vendor_account_id=$1 ORDER BY id`,
      [accountId],
    );
    const requests = await owner.query(
      `SELECT id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, created_at, created_by
       FROM license_request WHERE vendor_account_id=$1 ORDER BY id`,
      [accountId],
    );
    const priorAudits = await owner.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, company_id,
              note, before, after, occurred_at
       FROM audit_log WHERE entity_id=$1 AND action='fixture.prior' ORDER BY id`,
      [accountId],
    );
    return {
      assignments: assignments.rows,
      capacities: capacities.rows,
      priorAudits: priorAudits.rows,
      requests: requests.rows,
    };
  }

  async function expectVendorAccountError(
    promise: Promise<unknown>,
    code: InstanceType<typeof VendorAccountError>["code"],
  ) {
    let captured: unknown;
    try {
      await promise;
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(VendorAccountError);
    const error = captured as VendorAccountError & Record<string, unknown>;
    expect({ code: error.code, message: error.message, name: error.name }).toEqual({
      code,
      message: code,
      name: "VendorAccountError",
    });
    expect({
      cause: error.cause,
      constraint: error.constraint,
      detail: error.detail,
      query: error.query,
      schema: error.schema,
      table: error.table,
    }).toEqual({
      cause: undefined,
      constraint: undefined,
      detail: undefined,
      query: undefined,
      schema: undefined,
      table: undefined,
    });
  }

  async function databasePid(pool: pg.Pool) {
    const result = await pool.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid");
    return result.rows[0]!.pid;
  }

  async function waitForDatabaseLock(pid: number) {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const activity = await owner.query(
        `SELECT cardinality(pg_blocking_pids($1))::int AS blockers`,
        [pid],
      );
      if (activity.rows[0]?.blockers > 0) {
        return;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`TEST_DATABASE_LOCK_NOT_OBSERVED:${pid}`);
  }

  function isolatedService(applicationName: string, occurredAt: Date) {
    const pool = new pg.Pool({
      application_name: applicationName,
      connectionString: fixture.appUrl,
      max: 1,
    });
    return {
      pool,
      service: createVendorAccountService(drizzle(pool, { schema }), {
        now: () => occurredAt,
      }),
    };
  }

  async function resetCommandFixture() {
    await owner.query("TRUNCATE audit_log");
    await owner.query(
      `DELETE FROM vendor_account
       WHERE id NOT IN ($1,$2,$3,$4,$5)`,
      [ids.accountMain, ids.accountZero, ids.accountOther, ids.accountInactive, ids.accountCaseTie],
    );
    await owner.query(
      `UPDATE vendor_account
       SET name='alpha enterprise', mode='automated', vendor_org_ref='org-alpha',
           contract_renewal_on='2027-02-01', low_pool_floor=5, status='active',
           updated_at=NULL, updated_by=NULL
       WHERE id=$1`,
      [ids.accountMain],
    );
    await owner.query(
      `UPDATE vendor_account
       SET name=CASE id WHEN $1 THEN 'same' ELSE 'SAME' END,
           mode='orchestration', vendor_org_ref=NULL, contract_renewal_on=NULL,
           low_pool_floor=0, status='active', updated_at=NULL, updated_by=NULL
       WHERE id IN ($1,$2)`,
      [ids.accountZero, ids.accountCaseTie],
    );
  }

  beforeEach(resetCommandFixture);
  afterAll(resetCommandFixture);

  it("creates normalized active state with trusted metadata and one exact audit", async () => {
    const rejectedState = await catalogState();
    await expectVendorAccountError(service.createVendorAccount(
      authorization("group_admin"),
      { ...createInput, status: "inactive", createdBy: ids.finance },
    ), "VENDOR_ACCOUNT_INPUT_INVALID");
    expect(await catalogState()).toEqual(rejectedState);
    const result = await service.createVendorAccount(authorization("group_admin"), createInput);
    const row = await owner.query(
      `SELECT vendor_id, name, mode, vendor_org_ref, contract_renewal_on::text,
              low_pool_floor, status, created_at, created_by, updated_at, updated_by
       FROM vendor_account WHERE id=$1`,
      [result.id],
    );
    expect(row.rows).toEqual([{
      vendor_id: ids.vendorAnthropic,
      name: "Claude Enterprise",
      mode: "automated",
      vendor_org_ref: "org-claude-enterprise",
      contract_renewal_on: "2028-01-31",
      low_pool_floor: 7,
      status: "active",
      created_at: changedAt,
      created_by: ids.admin,
      updated_at: null,
      updated_by: null,
    }]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id, note,
              before, after, occurred_at
       FROM audit_log WHERE entity_id=$1 ORDER BY occurred_at`,
      [result.id],
    );
    expect(audit.rows).toEqual([{
      actor_user_id: ids.admin,
      action: "vendor_account.created",
      entity_type: "VendorAccount",
      entity_id: result.id,
      company_id: null,
      note: null,
      before: null,
      after: {
        vendorId: ids.vendorAnthropic,
        name: "Claude Enterprise",
        mode: "automated",
        vendorOrgRef: "org-claude-enterprise",
        contractRenewalOn: "2028-01-31",
        lowPoolFloor: 7,
        status: "active",
      },
      occurred_at: changedAt,
    }]);
  });

  it("updates only allowed fields with trusted metadata and exact before/after audit", async () => {
    const result = await service.updateVendorAccount(authorization("group_admin"), {
      id: ids.accountMain,
      name: "  Alpha Prime  ",
      mode: "orchestration",
      vendorOrgRef: "  org-alpha-prime  ",
      contractRenewalOn: "2028-06-30",
      lowPoolFloor: 9,
      status: "active",
    });
    expect(result).toEqual({ id: ids.accountMain, status: "active" });
    const row = await owner.query(
      `SELECT vendor_id, name, mode, vendor_org_ref, contract_renewal_on::text,
              low_pool_floor, status, created_at, created_by, updated_at, updated_by
       FROM vendor_account WHERE id=$1`, [ids.accountMain],
    );
    expect(row.rows).toEqual([{
      vendor_id: ids.vendorAnthropic,
      name: "Alpha Prime",
      mode: "orchestration",
      vendor_org_ref: "org-alpha-prime",
      contract_renewal_on: "2028-06-30",
      low_pool_floor: 9,
      status: "active",
      created_at: evaluatedAt,
      created_by: ids.admin,
      updated_at: changedAt,
      updated_by: ids.admin,
    }]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id, note, before, after, occurred_at
       FROM audit_log WHERE entity_id=$1`, [ids.accountMain],
    );
    expect(audit.rows).toEqual([{
      actor_user_id: ids.admin,
      action: "vendor_account.updated",
      entity_type: "VendorAccount",
      entity_id: ids.accountMain,
      company_id: null,
      note: null,
      before: {
        name: "alpha enterprise", mode: "automated", vendorOrgRef: "org-alpha",
        contractRenewalOn: "2027-02-01", lowPoolFloor: 5, status: "active",
      },
      after: {
        name: "Alpha Prime", mode: "orchestration", vendorOrgRef: "org-alpha-prime",
        contractRenewalOn: "2028-06-30", lowPoolFloor: 9, status: "active",
      },
      occurred_at: changedAt,
    }]);
  });

  it("audits retirement/reactivation and preserves dependent and historical rows", async () => {
    await owner.query(
      `INSERT INTO audit_log
        (id, actor_user_id, action, entity_type, entity_id, company_id,
         note, before, after, occurred_at)
       VALUES ($1,$2,'fixture.prior','VendorAccount',$3,NULL,'prior history',
               '{"status":"seeded"}', '{"status":"preserved"}', $4)`,
      [ids.priorAudit, ids.admin, ids.accountMain, evaluatedAt],
    );
    const before = await dependentState(ids.accountMain);
    expect(before).toEqual({
      assignments: [
        { id: ids.assignmentStandardA, person_id: ids.personA, company_id: ids.company,
          vendor_account_id: ids.accountMain, license_type_id: ids.licenseStandard,
          started_on: "2026-01-01", ended_on: null, source_kind: "import",
          created_at: evaluatedAt, created_by: ids.admin },
        { id: ids.assignmentStandardB, person_id: ids.personB, company_id: ids.company,
          vendor_account_id: ids.accountMain, license_type_id: ids.licenseStandard,
          started_on: "2026-01-01", ended_on: null, source_kind: "import",
          created_at: evaluatedAt, created_by: ids.admin },
        { id: ids.assignmentApi, person_id: ids.personC, company_id: ids.company,
          vendor_account_id: ids.accountMain, license_type_id: ids.licenseApi,
          started_on: "2026-01-01", ended_on: null, source_kind: "import",
          created_at: evaluatedAt, created_by: ids.admin },
        { id: ids.assignmentExpired, person_id: ids.personC, company_id: ids.company,
          vendor_account_id: ids.accountMain, license_type_id: ids.licenseStandard,
          started_on: "2025-01-01", ended_on: "2025-12-31", source_kind: "import",
          created_at: evaluatedAt, created_by: ids.admin },
      ],
      capacities: [
        { id: ids.capacityStandard, vendor_account_id: ids.accountMain,
          license_type_id: ids.licenseStandard, purchased_qty: 10,
          effective_from: "2026-08-01", note: "standard",
          created_at: evaluatedAt, created_by: ids.admin },
        { id: ids.capacityApi, vendor_account_id: ids.accountMain,
          license_type_id: ids.licenseApi, purchased_qty: 3,
          effective_from: "2026-08-01", note: "api",
          created_at: evaluatedAt, created_by: ids.admin },
      ],
      priorAudits: [{
        id: ids.priorAudit, actor_user_id: ids.admin, action: "fixture.prior",
        entity_type: "VendorAccount", entity_id: ids.accountMain, company_id: null,
        note: "prior history", before: { status: "seeded" },
        after: { status: "preserved" }, occurred_at: evaluatedAt,
      }],
      requests: [
        { id: ids.requestA, request_no: "VA-1", person_id: ids.personA,
          company_id: ids.company, vendor_account_id: ids.accountMain,
          license_type_id: ids.licenseStandard, state: "provisioning",
          justification: "pending invite", created_at: evaluatedAt, created_by: ids.admin },
        { id: ids.requestB, request_no: "VA-2", person_id: ids.personB,
          company_id: ids.company, vendor_account_id: ids.accountMain,
          license_type_id: ids.licenseStandard, state: "provisioning",
          justification: "sent invite", created_at: evaluatedAt, created_by: ids.admin },
      ],
    });
    const base = { id: ids.accountMain, name: "Alpha Prime", mode: "orchestration" as const,
      vendorOrgRef: "org-alpha-prime", contractRenewalOn: "2028-06-30", lowPoolFloor: 9 };
    const snapshot = { name: base.name, mode: base.mode, vendorOrgRef: base.vendorOrgRef,
      contractRenewalOn: base.contractRenewalOn, lowPoolFloor: base.lowPoolFloor };
    await expect(service.updateVendorAccount(authorization("group_admin"), {
      ...base, status: "inactive",
    })).resolves.toEqual({ id: ids.accountMain, status: "inactive" });
    await expect(service.updateVendorAccount(authorization("group_admin"), {
      ...base, status: "active",
    })).resolves.toEqual({ id: ids.accountMain, status: "active" });
    expect(await dependentState(ids.accountMain)).toEqual(before);
    const actions = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id, note,
              before, after, occurred_at
       FROM audit_log
       WHERE entity_id=$1 AND action IN ('vendor_account.retired', 'vendor_account.reactivated')
       ORDER BY action`, [ids.accountMain],
    );
    expect(actions.rows).toEqual([
      {
        actor_user_id: ids.admin,
        action: "vendor_account.reactivated",
        entity_type: "VendorAccount",
        entity_id: ids.accountMain,
        company_id: null,
        note: null,
        before: { ...snapshot, status: "inactive" },
        after: { ...snapshot, status: "active" },
        occurred_at: changedAt,
      },
      {
        actor_user_id: ids.admin,
        action: "vendor_account.retired",
        entity_type: "VendorAccount",
        entity_id: ids.accountMain,
        company_id: null,
        note: null,
        before: {
          name: "alpha enterprise", mode: "automated", vendorOrgRef: "org-alpha",
          contractRenewalOn: "2027-02-01", lowPoolFloor: 5, status: "active",
        },
        after: { ...snapshot, status: "inactive" },
        occurred_at: changedAt,
      },
    ]);
  });

  it("rejects a same-value update without audit noise", async () => {
    const stateBefore = await rejectedUpdateState(ids.accountZero);
    await expectVendorAccountError(service.updateVendorAccount(authorization("group_admin"), {
      id: ids.accountZero, name: "same", mode: "orchestration", vendorOrgRef: null,
      contractRenewalOn: null, lowPoolFloor: 0, status: "active",
    }), "VENDOR_ACCOUNT_NO_CHANGES");
    expect(await rejectedUpdateState(ids.accountZero)).toEqual(stateBefore);
  });

  it.each([
    ["forbidden", authorization("central_finance"), createInput, "VENDOR_ACCOUNT_ACCESS_FORBIDDEN"],
    ["invalid", authorization("group_admin"), { ...createInput, lowPoolFloor: -1 }, "VENDOR_ACCOUNT_INPUT_INVALID"],
    ["inactive vendor", authorization("group_admin"), { ...createInput, vendorId: ids.vendorInactiveAnthropic, name: "Inactive Vendor" }, "VENDOR_ACCOUNT_VENDOR_UNAVAILABLE"],
    ["non-Anthropic vendor", authorization("group_admin"), { ...createInput, vendorId: ids.vendorOther, name: "Other Vendor" }, "VENDOR_ACCOUNT_VENDOR_UNAVAILABLE"],
    ["duplicate name", authorization("group_admin"), { ...createInput, name: "same", vendorOrgRef: "unique-ref" }, "VENDOR_ACCOUNT_NAME_CONFLICT"],
    ["duplicate org ref", authorization("group_admin"), { ...createInput, name: "Unique Name", vendorOrgRef: null }, "VENDOR_ACCOUNT_ORG_REF_CONFLICT"],
  ] as const)("rejects %s create without domain or audit changes", async (_case, auth, input, code) => {
    const actualInput = _case === "duplicate org ref" ? { ...input, vendorOrgRef: "org-alpha" } : input;
    const stateBefore = await catalogState();
    await expectVendorAccountError(service.createVendorAccount(auth, actualInput), code);
    expect(await catalogState()).toEqual(stateBefore);
  });

  it("rejects unknown update without domain or audit changes", async () => {
    const stateBefore = await rejectedUpdateState(ids.nonexistentAccount);
    await expectVendorAccountError(service.updateVendorAccount(authorization("group_admin"), {
      id: ids.nonexistentAccount, name: "Unknown", mode: "automated", vendorOrgRef: null,
      contractRenewalOn: null, lowPoolFloor: 0, status: "active",
    }), "VENDOR_ACCOUNT_NOT_FOUND");
    expect(stateBefore.target).toEqual({ account: [], audits: [] });
    expect(await rejectedUpdateState(ids.nonexistentAccount)).toEqual(stateBefore);
  });

  it.each([
    [authorization("central_finance"), {
      id: ids.accountZero, name: "Unauthorized", mode: "orchestration",
      vendorOrgRef: null, contractRenewalOn: null, lowPoolFloor: 0, status: "active",
    }, "VENDOR_ACCOUNT_ACCESS_FORBIDDEN"],
    [authorization("group_admin"), {
      id: ids.accountZero, name: "Invalid", mode: "orchestration",
      vendorOrgRef: null, contractRenewalOn: null, lowPoolFloor: -1, status: "active",
    }, "VENDOR_ACCOUNT_INPUT_INVALID"],
  ] as const)("rejects unauthorized or invalid update without domain or audit changes", async (auth, input, code) => {
    const stateBefore = await rejectedUpdateState(ids.accountZero);
    await expectVendorAccountError(service.updateVendorAccount(auth, input), code);
    expect(await rejectedUpdateState(ids.accountZero)).toEqual(stateBefore);
  });

  it.each([
    ["name", { name: "alpha enterprise", vendorOrgRef: null }, "VENDOR_ACCOUNT_NAME_CONFLICT"],
    ["organization reference", { name: "same", vendorOrgRef: "org-alpha" }, "VENDOR_ACCOUNT_ORG_REF_CONFLICT"],
  ] as const)("maps update duplicate %s to an exact safe error without changing row or audit", async (_case, duplicate, code) => {
    const stateBefore = await rejectedUpdateState(ids.accountZero);
    await expectVendorAccountError(service.updateVendorAccount(authorization("group_admin"), {
      id: ids.accountZero,
      name: duplicate.name,
      mode: "orchestration",
      vendorOrgRef: duplicate.vendorOrgRef,
      contractRenewalOn: null,
      lowPoolFloor: 0,
      status: "active",
    }), code);
    expect(await rejectedUpdateState(ids.accountZero)).toEqual(stateBefore);
  });

  it("rolls the domain update back when the real audit insert trigger fails", async () => {
    await owner.query(`CREATE FUNCTION reject_vendor_account_audit() RETURNS trigger AS $$
      BEGIN IF NEW.entity_id='${ids.accountZero}'::uuid THEN RAISE EXCEPTION 'forced vendor audit failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_vendor_account_audit BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION reject_vendor_account_audit();`);
    try {
      await expect(service.updateVendorAccount(authorization("group_admin"), {
        id: ids.accountZero, name: "Changed but rolled back", mode: "orchestration",
        vendorOrgRef: null, contractRenewalOn: null, lowPoolFloor: 0, status: "active",
      })).rejects.toThrow("forced vendor audit failure");
      const row = await owner.query(`SELECT name, updated_at, updated_by FROM vendor_account WHERE id=$1`, [ids.accountZero]);
      expect(row.rows).toEqual([{ name: "same", updated_at: null, updated_by: null }]);
      const audit = await owner.query(`SELECT action FROM audit_log WHERE entity_id=$1`, [ids.accountZero]);
      expect(audit.rows).toEqual([]);
    } finally {
      await owner.query(`DROP TRIGGER reject_vendor_account_audit ON audit_log; DROP FUNCTION reject_vendor_account_audit();`);
    }
  });

  it("serializes concurrent updates into an exact, lossless audit chain", async () => {
    const firstAt = new Date("2026-08-14T11:00:00.000Z");
    const secondAt = new Date("2026-08-14T11:01:00.000Z");
    const first = isolatedService("us025_same_account_first", firstAt);
    const second = isolatedService("us025_same_account_second", secondAt);
    const firstPid = await databasePid(first.pool);
    const secondPid = await databasePid(second.pool);
    const locker = await fixture.connectAsOwner();
    let lockOpen = false;
    let firstUpdate: ReturnType<typeof first.service.updateVendorAccount> | undefined;
    let secondUpdate: ReturnType<typeof second.service.updateVendorAccount> | undefined;
    const baseline = {
      contractRenewalOn: null,
      lowPoolFloor: 0,
      mode: "orchestration" as const,
      name: "same",
      status: "active" as const,
      vendorOrgRef: null,
    };
    const firstAfter = { ...baseline, lowPoolFloor: 3, name: "Concurrent First" };
    const secondAfter = { ...baseline, lowPoolFloor: 4, name: "Concurrent Second" };
    try {
      await locker.query("BEGIN");
      lockOpen = true;
      await locker.query("SELECT id FROM vendor_account WHERE id=$1 FOR UPDATE", [ids.accountZero]);
      firstUpdate = first.service.updateVendorAccount(authorization("group_admin"), {
        id: ids.accountZero, ...firstAfter,
      });
      await waitForDatabaseLock(firstPid);
      secondUpdate = second.service.updateVendorAccount(authorization("group_admin"), {
        id: ids.accountZero, ...secondAfter,
      });
      await waitForDatabaseLock(secondPid);
      await locker.query("COMMIT");
      lockOpen = false;

      await expect(firstUpdate).resolves.toEqual({ id: ids.accountZero, status: "active" });
      await expect(secondUpdate).resolves.toEqual({ id: ids.accountZero, status: "active" });
      const final = await owner.query(
        `SELECT id, vendor_id, name, mode, vendor_org_ref, contract_renewal_on::text,
                low_pool_floor, status, created_at, created_by, updated_at, updated_by
         FROM vendor_account WHERE id=$1`,
        [ids.accountZero],
      );
      expect(final.rows).toEqual([{
        id: ids.accountZero,
        vendor_id: ids.vendorAnthropic,
        name: secondAfter.name,
        mode: secondAfter.mode,
        vendor_org_ref: null,
        contract_renewal_on: null,
        low_pool_floor: secondAfter.lowPoolFloor,
        status: "active",
        created_at: evaluatedAt,
        created_by: ids.admin,
        updated_at: secondAt,
        updated_by: ids.admin,
      }]);
      const audits = await owner.query(
        `SELECT actor_user_id, action, entity_type, entity_id, company_id, note,
                before, after, occurred_at
         FROM audit_log WHERE entity_id=$1 ORDER BY occurred_at`,
        [ids.accountZero],
      );
      expect(audits.rows).toEqual([
        {
          actor_user_id: ids.admin, action: "vendor_account.updated",
          entity_type: "VendorAccount", entity_id: ids.accountZero,
          company_id: null, note: null, before: baseline, after: firstAfter,
          occurred_at: firstAt,
        },
        {
          actor_user_id: ids.admin, action: "vendor_account.updated",
          entity_type: "VendorAccount", entity_id: ids.accountZero,
          company_id: null, note: null, before: firstAfter, after: secondAfter,
          occurred_at: secondAt,
        },
      ]);
    } finally {
      if (lockOpen) await locker.query("ROLLBACK");
      await Promise.allSettled([firstUpdate, secondUpdate].filter((value) => value !== undefined));
      await Promise.all([first.pool.end(), second.pool.end(), locker.end()]);
    }
  });

  it("commits exactly one concurrent unique-name update and safely rejects the loser", async () => {
    const occurredAt = new Date("2026-08-14T11:15:00.000Z");
    const left = isolatedService("us025_unique_left", occurredAt);
    const right = isolatedService("us025_unique_right", occurredAt);
    const leftPid = await databasePid(left.pool);
    const rightPid = await databasePid(right.pool);
    const leftLocker = await fixture.connectAsOwner();
    const rightLocker = await fixture.connectAsOwner();
    let locksOpen = false;
    let leftUpdate: ReturnType<typeof left.service.updateVendorAccount> | undefined;
    let rightUpdate: ReturnType<typeof right.service.updateVendorAccount> | undefined;
    const stateBefore = await catalogState();
    const command = {
      name: "Concurrent Unique Winner",
      mode: "automated" as const,
      vendorOrgRef: null,
      contractRenewalOn: null,
      lowPoolFloor: 2,
      status: "active" as const,
    };
    try {
      await leftLocker.query("BEGIN");
      await rightLocker.query("BEGIN");
      locksOpen = true;
      await leftLocker.query("SELECT id FROM vendor_account WHERE id=$1 FOR UPDATE", [ids.accountZero]);
      await rightLocker.query("SELECT id FROM vendor_account WHERE id=$1 FOR UPDATE", [ids.accountCaseTie]);
      leftUpdate = left.service.updateVendorAccount(authorization("group_admin"), {
        id: ids.accountZero, ...command,
      });
      rightUpdate = right.service.updateVendorAccount(authorization("group_admin"), {
        id: ids.accountCaseTie, ...command,
      });
      await waitForDatabaseLock(leftPid);
      await waitForDatabaseLock(rightPid);
      await Promise.all([leftLocker.query("COMMIT"), rightLocker.query("COMMIT")]);
      locksOpen = false;

      const results = await Promise.allSettled([leftUpdate, rightUpdate]);
      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      const winnerIndex = results.findIndex(({ status }) => status === "fulfilled");
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      const winnerId = winnerIndex === 0 ? ids.accountZero : ids.accountCaseTie;
      const loserId = loserIndex === 0 ? ids.accountZero : ids.accountCaseTie;
      const winner = results[winnerIndex]!;
      const loser = results[loserIndex]!;
      expect(winner).toEqual({ status: "fulfilled", value: { id: winnerId, status: "active" } });
      expect(loser.status).toBe("rejected");
      if (loser.status === "rejected") {
        await expectVendorAccountError(Promise.reject(loser.reason), "VENDOR_ACCOUNT_NAME_CONFLICT");
      }

      const stateAfter = await catalogState();
      expect(stateAfter.accounts).toEqual(stateBefore.accounts.map((row) =>
        row.id === winnerId
          ? { ...row, name: command.name, mode: command.mode,
              vendor_org_ref: command.vendorOrgRef,
              contract_renewal_on: command.contractRenewalOn,
              low_pool_floor: command.lowPoolFloor,
              updated_at: occurredAt, updated_by: ids.admin }
          : row,
      ));
      expect(stateAfter.audits).toHaveLength(1);
      expect(stateAfter.audits[0]).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        actor_user_id: ids.admin,
        action: "vendor_account.updated",
        entity_type: "VendorAccount",
        entity_id: winnerId,
        company_id: null,
        note: null,
        before: {
          name: winnerId === ids.accountZero ? "same" : "SAME",
          mode: "orchestration",
          vendorOrgRef: null,
          contractRenewalOn: null,
          lowPoolFloor: 0,
          status: "active",
        },
        after: command,
        occurred_at: occurredAt,
      });
      expect((await accountState(loserId)).account).toEqual(
        stateBefore.accounts.filter(({ id: accountId }) => accountId === loserId),
      );
    } finally {
      if (locksOpen) {
        await Promise.allSettled([leftLocker.query("ROLLBACK"), rightLocker.query("ROLLBACK")]);
      }
      await Promise.allSettled([leftUpdate, rightUpdate].filter((value) => value !== undefined));
      await Promise.all([left.pool.end(), right.pool.end(), leftLocker.end(), rightLocker.end()]);
    }
  });

  it("re-evaluates a blocked vendor lock and rejects create after the vendor becomes inactive", async () => {
    const blocked = isolatedService("us025_vendor_recheck", changedAt);
    const blockedPid = await databasePid(blocked.pool);
    const locker = await fixture.connectAsOwner();
    let lockOpen = false;
    let creation: ReturnType<typeof blocked.service.createVendorAccount> | undefined;
    const stateBefore = await catalogState();
    try {
      await locker.query("BEGIN");
      lockOpen = true;
      await locker.query("SELECT id FROM vendor WHERE id=$1 FOR UPDATE", [ids.vendorAnthropic]);
      creation = blocked.service.createVendorAccount(authorization("group_admin"), {
        ...createInput,
        name: "Blocked Vendor Recheck",
        vendorOrgRef: "blocked-vendor-recheck",
      });
      await waitForDatabaseLock(blockedPid);
      await locker.query("UPDATE vendor SET status='inactive' WHERE id=$1", [ids.vendorAnthropic]);
      await locker.query("COMMIT");
      lockOpen = false;
      await expectVendorAccountError(creation, "VENDOR_ACCOUNT_VENDOR_UNAVAILABLE");
      expect(await catalogState()).toEqual(stateBefore);
      const vendorState = await owner.query("SELECT id, name, status FROM vendor WHERE id=$1", [ids.vendorAnthropic]);
      expect(vendorState.rows).toEqual([{ id: ids.vendorAnthropic, name: "Anthropic", status: "inactive" }]);
    } finally {
      if (lockOpen) await locker.query("ROLLBACK");
      await Promise.allSettled([creation].filter((value) => value !== undefined));
      await owner.query("UPDATE vendor SET status='active' WHERE id=$1", [ids.vendorAnthropic]);
      await Promise.all([blocked.pool.end(), locker.end()]);
    }
  });
});

describe("US-025 authorized vendor-account query model", () => {
  it("returns every account in deterministic status/name/id order, including zero capacity", async () => {
    const rows: readonly VendorAccountListItem[] = await repository.list(
      authorization("group_admin"),
      evaluatedAt,
    );

    expect(rows).toEqual([
      {
        connectorType: "api",
        contractRenewalOn: "2027-02-01",
        credentialHealth: "auth_failed",
        free: 8,
        id: ids.accountMain,
        lowPoolFloor: 5,
        mode: "automated",
        name: "alpha enterprise",
        provisioningProtocol: "rest",
        purchased: 13,
        status: "active",
        vendorName: "Anthropic",
      },
      {
        connectorType: "orchestration",
        contractRenewalOn: "2027-05-05",
        credentialHealth: "ok",
        free: 0,
        id: ids.accountOther,
        lowPoolFloor: 2,
        mode: "orchestration",
        name: "Beta Provider",
        provisioningProtocol: "scim",
        purchased: 0,
        status: "active",
        vendorName: "OpenAI",
      },
      {
        connectorType: "api",
        contractRenewalOn: null,
        credentialHealth: null,
        free: 0,
        id: ids.accountZero,
        lowPoolFloor: 0,
        mode: "orchestration",
        name: "same",
        provisioningProtocol: "rest",
        purchased: 0,
        status: "active",
        vendorName: "Anthropic",
      },
      {
        connectorType: "api",
        contractRenewalOn: null,
        credentialHealth: null,
        free: 0,
        id: ids.accountCaseTie,
        lowPoolFloor: 0,
        mode: "orchestration",
        name: "SAME",
        provisioningProtocol: "rest",
        purchased: 0,
        status: "active",
        vendorName: "Anthropic",
      },
      {
        connectorType: "manual",
        contractRenewalOn: null,
        credentialHealth: "unverified",
        free: 0,
        id: ids.accountInactive,
        lowPoolFloor: 1,
        mode: "orchestration",
        name: "Archived Anthropic",
        provisioningProtocol: "none",
        purchased: 0,
        status: "inactive",
        vendorName: "anthropic",
      },
    ]);
  });

  it("orders by status, case-folded name, and ID as independent keys", async () => {
    const rows = await repository.list(
      authorization("group_admin"),
      evaluatedAt,
    );

    expect(
      rows.map(({ id: accountId, name, status }) => ({
        accountId,
        name,
        status,
      })),
    ).toEqual([
      {
        accountId: ids.accountMain,
        name: "alpha enterprise",
        status: "active",
      },
      {
        accountId: ids.accountOther,
        name: "Beta Provider",
        status: "active",
      },
      { accountId: ids.accountZero, name: "same", status: "active" },
      { accountId: ids.accountCaseTie, name: "SAME", status: "active" },
      {
        accountId: ids.accountInactive,
        name: "Archived Anthropic",
        status: "inactive",
      },
    ]);
  });

  it("returns capabilities and latest currently effective license rates without cross joins", async () => {
    const detail = await repository.detail(
      authorization("group_admin"),
      ids.accountMain,
      evaluatedAt,
    );

    expect(detail).toEqual({
      capabilities: {
        canDeprovision: true,
        canProvision: true,
        hasCostData: true,
        hasUsageData: true,
        identityMatching: "email",
        provisioningProtocol: "rest",
      },
      connectorType: "api",
      contractRenewalOn: "2027-02-01",
      credentialHealth: "auth_failed",
      free: 8,
      id: ids.accountMain,
      licenseTypes: [
        {
          id: ids.licenseApi,
          monthlyRateUsd: null,
          name: "API",
          rateEffectiveFrom: null,
          rateEffectiveTo: null,
          status: "active",
          unit: "license",
        },
        {
          id: ids.licenseLegacy,
          monthlyRateUsd: null,
          name: "Legacy",
          rateEffectiveFrom: null,
          rateEffectiveTo: null,
          status: "inactive",
          unit: "seat",
        },
        {
          id: ids.licenseStandard,
          monthlyRateUsd: "64.25",
          name: "Standard",
          rateEffectiveFrom: "2026-07-15",
          rateEffectiveTo: null,
          status: "active",
          unit: "seat",
        },
      ],
      lowPoolFloor: 5,
      mode: "automated",
      name: "alpha enterprise",
      provisioningProtocol: "rest",
      purchased: 13,
      status: "active",
      vendorId: ids.vendorAnthropic,
      vendorName: "Anthropic",
      vendorOrgRef: "org-alpha",
    });
  });

  it("offers only active Anthropic vendors", async () => {
    await expect(
      repository.activeAnthropicOptions(authorization("group_admin")),
    ).resolves.toEqual([{ id: ids.vendorAnthropic, name: "Anthropic" }]);
  });

  it.each(["list", "detail", "activeAnthropicOptions"] as const)(
    "rejects a non-group-admin before %s attempts the real database boundary",
    async (entryPoint) => {
      const inaccessible = createVendorAccountRepository(
        "postgres://ledger_app:wrong@127.0.0.1:1/unreachable?connect_timeout=1",
      );
      try {
        const attempt =
          entryPoint === "list"
            ? inaccessible.list(authorization("central_finance"), evaluatedAt)
            : entryPoint === "detail"
              ? inaccessible.detail(
                  authorization("central_finance"),
                  ids.accountMain,
                  evaluatedAt,
                )
              : inaccessible.activeAnthropicOptions(
                  authorization("central_finance"),
                );
        await expect(attempt).rejects.toThrow(
          "VENDOR_ACCOUNT_ACCESS_FORBIDDEN",
        );
      } finally {
        await inaccessible.close();
      }
    },
  );

  it("returns null for invalid and absent detail IDs without leaking another account", async () => {
    await expect(
      repository.detail(authorization("group_admin"), "not-a-uuid", evaluatedAt),
    ).resolves.toBeNull();
    await expect(
      repository.detail(
        authorization("group_admin"),
        ids.nonexistentAccount,
        evaluatedAt,
      ),
    ).resolves.toBeNull();
    expect(
      (
        await repository.detail(
          authorization("group_admin"),
          ids.accountZero,
          evaluatedAt,
        )
      )?.id,
    ).toBe(ids.accountZero);
  });
});
