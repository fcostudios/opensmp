import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { loadVendorAccountDetailPage, loadVendorAccountsRegistryPage } from "./vendor-account-page-loaders";
import { createPoolRepository } from "./pool-repository";
import { createVendorAccountRepository } from "./vendor-account-repository";

const ids = {
  account: "25000000-0000-4000-8000-000000000020",
  capacity: "25000000-0000-4000-8000-000000000040",
  license: "25000000-0000-4000-8000-000000000030",
  user: "25000000-0000-4000-8000-000000000001",
  vendor: "25000000-0000-4000-8000-000000000010",
};
const at = new Date("2026-08-13T15:00:00.000Z");
const authorization: LedgerAuthorization = {
  companyGrants: [], companyIds: [], employeeCompanyId: null, globalRole: "group_admin",
  idpSubject: "vendor-page-admin", roles: ["group_admin"], userAccountId: ids.user, userId: ids.user,
};

let fixture: PostgresFixture;
let owner: pg.Client;
let vendorRepository: ReturnType<typeof createVendorAccountRepository>;
let poolRepository: ReturnType<typeof createPoolRepository>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,ui_language,status,created_at)
    VALUES ($1,'page@ledger.test','vendor-page-admin','group_admin','en','active',$2)`, [ids.user, at]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
    VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`, [ids.vendor, at, ids.user]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,vendor_org_ref,contract_renewal_on,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$2,'Claude Enterprise','automated','org-claude','2027-02-01',2,'active',$3,$4)`, [ids.account, ids.vendor, at, ids.user]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
    VALUES ($1,$2,'Standard','seat','active',$3,$4)`, [ids.license, ids.vendor, at, ids.user]);
  await owner.query(`INSERT INTO vendor_account_capacity (id,vendor_account_id,license_type_id,purchased_qty,effective_from,note,created_at,created_by)
    VALUES ($1,$2,$3,13,'2026-08-01','page fixture',$4,$5)`, [ids.capacity, ids.account, ids.license, at, ids.user]);
  vendorRepository = createVendorAccountRepository(fixture.appUrl);
  poolRepository = createPoolRepository(fixture.appUrl);
}, 120_000);

afterAll(async () => {
  await Promise.all([vendorRepository?.close(), poolRepository?.close(), owner?.end()]);
  await fixture?.stop();
});

test("loads registry and detail page models through real PostgreSQL repository ports", async () => {
  const registry = await loadVendorAccountsRegistryPage({ at, authorization, repository: vendorRepository });
  expect(registry).toEqual({
    accounts: [expect.objectContaining({ free: 13, id: ids.account, purchased: 13 })],
    vendors: [{ id: ids.vendor, name: "Anthropic" }],
  });
  const detail = await loadVendorAccountDetailPage({ at, authorization, poolRepository, rawVendorAccountId: ids.account, vendorAccountRepository: vendorRepository });
  expect(detail?.detail.id).toBe(ids.account);
  expect(detail?.snapshots).toEqual([expect.objectContaining({ free: 13, purchased: 13, vendorAccountId: ids.account })]);
});

test("rejects an invalid identifier before real unreachable repositories perform I/O", async () => {
  const unreachable = "postgres://ledger_app:wrong@127.0.0.1:1/unreachable?connect_timeout=1";
  const unreachableVendor = createVendorAccountRepository(unreachable);
  const unreachablePool = createPoolRepository(unreachable);
  try {
    await expect(loadVendorAccountDetailPage({ at, authorization, poolRepository: unreachablePool, rawVendorAccountId: "not-a-uuid", vendorAccountRepository: unreachableVendor })).resolves.toBeNull();
  } finally {
    await Promise.all([unreachableVendor.close(), unreachablePool.close()]);
  }
});
