import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../identity-access/authorization";
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
let repository: ReturnType<typeof createVendorAccountRepository>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
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
}, 120_000);

afterAll(async () => {
  await Promise.all([repository?.close(), owner?.end()]);
  await fixture?.stop();
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
