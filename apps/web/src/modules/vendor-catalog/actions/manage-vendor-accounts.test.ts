import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import { createVendorAccountServerActions } from "./manage-vendor-accounts-server-actions-factory";
import type { VendorAccountActionState } from "./manage-vendor-accounts-operations";

const execFileAsync = promisify(execFile);
const id = (suffix: string) =>
  `25100000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  account: id("3"),
  admin: id("1"),
  vendor: id("2"),
};
const now = new Date("2026-08-13T18:00:00.000Z");
const idle: VendorAccountActionState = { status: "idle" };
const authorization: LedgerAuthorization = {
  companyGrants: [],
  companyIds: [],
  employeeCompanyId: null,
  globalRole: "group_admin",
  idpSubject: "vendor-account-actions",
  roles: ["group_admin"],
  userAccountId: ids.admin,
  userId: ids.admin,
};

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;

function createForm(name = "Claude Team") {
  const form = new FormData();
  form.set("vendorId", ids.vendor);
  form.set("name", name);
  form.set("mode", "automated");
  form.set("vendorOrgRef", "");
  form.set("contractRenewalOn", "   ");
  form.set("lowPoolFloor", "12");
  return form;
}

function updateForm() {
  const form = new FormData();
  form.set("name", "Claude Enterprise Retired");
  form.set("mode", "orchestration");
  form.set("vendorOrgRef", "org-retired");
  form.set("contractRenewalOn", "2027-08-31");
  form.set("lowPoolFloor", "4");
  form.set("status", "inactive");
  return form;
}

function actions({
  loadAuthorization = async () => authorization,
  revalidate,
  revalidated = [],
}: {
  readonly loadAuthorization?: () => Promise<LedgerAuthorization | null>;
  readonly revalidate?: (path: string) => void;
  readonly revalidated?: string[];
} = {}) {
  return createVendorAccountServerActions({
    database: drizzle(pool, { schema }),
    loadAuthorization,
    now: () => now,
    revalidate: revalidate ?? ((path) => { revalidated.push(path); }),
  });
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `TRUNCATE TABLE vendor_account, vendor, user_account RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'actions@vendor.test','vendor-account-actions','group_admin','en','active',$2)`,
    [ids.admin, now],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$3,$2)`,
    [ids.vendor, ids.admin, now],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,vendor_org_ref,contract_renewal_on,low_pool_floor,
        status,created_at,created_by)
     VALUES ($1,$2,'Claude Enterprise','automated','org-live','2027-01-31',8,
       'active',$4,$3)`,
    [ids.account, ids.vendor, ids.admin, now],
  );
}, 120_000);

beforeEach(async () => {
  await owner.query("TRUNCATE audit_log");
  await owner.query("DELETE FROM vendor_account WHERE id <> $1", [ids.account]);
  await owner.query(
    `UPDATE vendor_account
     SET name='Claude Enterprise', mode='automated', vendor_org_ref='org-live',
         contract_renewal_on='2027-01-31', low_pool_floor=8, status='active',
         updated_at=NULL, updated_by=NULL
     WHERE id=$1`,
    [ids.account],
  );
});

afterAll(async () => {
  await Promise.all([pool?.end(), owner?.end()]);
  await fixture?.stop();
});

describe("US-025 vendor-account server actions", () => {
  it("fails unauthenticated requests before parsing or calling the service", async () => {
    const revalidated: string[] = [];
    const result = await actions({
      loadAuthorization: async () => null,
      revalidated,
    }).createVendorAccount(idle, new FormData());

    expect(result).toEqual({ status: "error", code: "forbidden" });
    expect(revalidated).toEqual([]);
    const rows = await owner.query("SELECT count(*)::int AS count FROM vendor_account");
    expect(rows.rows).toEqual([{ count: 1 }]);
  });

  it("normalizes an authorization dependency failure before service access", async () => {
    const revalidated: string[] = [];
    const result = await actions({
      loadAuthorization: async () => { throw new Error("identity database unavailable"); },
      revalidated,
    }).createVendorAccount(idle, createForm());

    expect(result).toEqual({ status: "error", code: "unexpected" });
    expect(revalidated).toEqual([]);
    const rows = await owner.query("SELECT count(*)::int AS count FROM vendor_account");
    expect(rows.rows).toEqual([{ count: 1 }]);
    expect(JSON.stringify(result)).not.toContain("identity database unavailable");
  });

  it("creates through the real audited service, parsing numbers and blanks as explicit null", async () => {
    const revalidated: string[] = [];
    const result = await actions({ revalidated }).createVendorAccount(idle, createForm());

    expect(result).toMatchObject({ status: "success" });
    if (result.status !== "success") throw new Error("expected successful create action");
    expect(revalidated).toEqual(["/organizaciones"]);
    const row = await owner.query(
      `SELECT vendor_org_ref, contract_renewal_on::text, low_pool_floor
       FROM vendor_account WHERE id=$1`,
      [result.vendorAccountId],
    );
    expect(row.rows).toEqual([{
      contract_renewal_on: null,
      low_pool_floor: 12,
      vendor_org_ref: null,
    }]);
    const audit = await owner.query(
      "SELECT action, entity_id FROM audit_log WHERE entity_id=$1",
      [result.vendorAccountId],
    );
    expect(audit.rows).toEqual([{
      action: "vendor_account.created",
      entity_id: result.vendorAccountId,
    }]);
  });

  it("updates with the bound route ID and form status, then revalidates list and detail", async () => {
    const revalidated: string[] = [];
    const result = await actions({ revalidated }).updateVendorAccount(
      ids.account,
      idle,
      updateForm(),
    );

    expect(result).toEqual({
      status: "success",
      vendorAccountId: ids.account,
    });
    expect(revalidated).toEqual([
      "/organizaciones",
      `/organizaciones/${encodeURIComponent(ids.account)}`,
    ]);
    const row = await owner.query(
      "SELECT name, status, low_pool_floor FROM vendor_account WHERE id=$1",
      [ids.account],
    );
    expect(row.rows).toEqual([{
      low_pool_floor: 4,
      name: "Claude Enterprise Retired",
      status: "inactive",
    }]);
  });

  it("returns serializable validation details and never revalidates a failed request", async () => {
    const revalidated: string[] = [];
    const invalid = createForm();
    invalid.set("lowPoolFloor", "   ");

    await expect(actions({ revalidated }).createVendorAccount(idle, invalid)).resolves.toEqual({
      status: "error",
      code: "invalid_input",
      fieldErrors: { lowPoolFloor: expect.any(Array) },
    });
    expect(revalidated).toEqual([]);
  });

  it("maps stable service failures without exposing persistence details or revalidating", async () => {
    const revalidated: string[] = [];
    const result = await actions({ revalidated }).createVendorAccount(
      idle,
      createForm("Claude Enterprise"),
    );

    expect(result).toEqual({ status: "error", code: "duplicate" });
    expect(revalidated).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/sql|constraint|stack|audit/i);
  });

  it("rejects cache invalidation failure after committing one real row and audit", async () => {
    const form = createForm("Cache Failure Account");
    const action = actions({
      revalidate: () => { throw new Error("cache unavailable"); },
    });

    await expect(action.createVendorAccount(idle, form)).rejects.toThrow("cache unavailable");
    const rows = await owner.query(
      "SELECT id FROM vendor_account WHERE name='Cache Failure Account'",
    );
    expect(rows.rows).toHaveLength(1);
    const audit = await owner.query(
      `SELECT count(*)::int AS count FROM audit_log
       WHERE action='vendor_account.created' AND entity_id=$1`,
      [rows.rows[0]!.id],
    );
    expect(audit.rows).toEqual([{ count: 1 }]);
  });

  it("exports only the two React actions and passes audited-action enforcement", async () => {
    const production = await import("./manage-vendor-accounts");
    expect(Object.keys(production).sort()).toEqual([
      "createVendorAccount",
      "updateVendorAccount",
    ]);
    expect(production.createVendorAccount).toHaveLength(2);
    expect(production.updateVendorAccount).toHaveLength(3);

    const source = await readFile(new URL("./manage-vendor-accounts.ts", import.meta.url), "utf8");
    expect(source).not.toContain("@read-only-action");

    const appRoot = new URL("../../../..", import.meta.url).pathname;
    const checker = new URL("../../../../../../scripts/check-audited-actions.mjs", import.meta.url);
    await expect(execFileAsync(process.execPath, [checker.pathname, appRoot])).resolves.toMatchObject({
      stdout: expect.stringContaining("Audited server action enforcement passed"),
    });
  });
});
