// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "@/modules/identity-access/authorization";
import { createVendorAccountServerActions } from "@/modules/vendor-catalog/actions/manage-vendor-accounts-server-actions-factory";

import { VendorAccountDialog } from "./vendor-account-dialog";
import type { VendorAccountFormLabels } from "./vendor-account-form";
import { VendorAccountTabs, type VendorAccountTabsLabels } from "./vendor-account-tabs";

const id = (suffix: string) =>
  `25200000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = { admin: id("1"), vendor: id("2"), account: id("3") };
const now = new Date("2026-08-13T19:00:00.000Z");
const authorization: LedgerAuthorization = {
  companyGrants: [],
  companyIds: [],
  employeeCompanyId: null,
  globalRole: "group_admin",
  idpSubject: "vendor-account-ui-integration",
  roles: ["group_admin"],
  userAccountId: ids.admin,
  userId: ids.admin,
};

const labels: VendorAccountFormLabels = {
  cancel: "CANCEL_FORM",
  description: "FORM_DESCRIPTION",
  errors: {
    contractRenewalOn: "ERROR_RENEWAL",
    duplicate: "ERROR_DUPLICATE",
    generic: "ERROR_GENERIC",
    lowPoolFloor: "ERROR_FLOOR",
    mode: "ERROR_MODE",
    name: "ERROR_NAME",
    vendorId: "ERROR_VENDOR",
    vendorOrgRef: "ERROR_VENDOR_REF",
  },
  fields: {
    contractRenewalOn: "FIELD_RENEWAL",
    lowPoolFloor: "FIELD_FLOOR",
    mode: "FIELD_MODE",
    name: "FIELD_NAME",
    status: "FIELD_STATUS",
    vendorId: "FIELD_VENDOR",
    vendorOrgRef: "FIELD_VENDOR_REF",
  },
  help: {
    lowPoolFloor: "HELP_FLOOR",
    vendor: "HELP_VENDOR",
    vendorOrgRef: "HELP_VENDOR_REF",
  },
  modes: {
    automated: "FORM_MODE_AUTOMATED",
    orchestration: "FORM_MODE_ORCHESTRATION",
  },
  statuses: { active: "STATUS_ACTIVE", inactive: "STATUS_INACTIVE" },
  submit: "SUBMIT_FORM",
  submitting: "SUBMITTING_FORM",
  success: "CREATE_SUCCESS",
  title: "FORM_TITLE",
  trigger: "OPEN_FORM",
};

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;

interface AuthorizationLoader {
  (): Promise<LedgerAuthorization | null>;
}

function realAction({
  loadAuthorization = async () => authorization,
  revalidate = () => undefined,
}: {
  readonly loadAuthorization?: AuthorizationLoader;
  readonly revalidate?: (path: string) => void;
} = {}) {
  return createVendorAccountServerActions({
    database: drizzle(pool, { schema }),
    loadAuthorization,
    now: () => now,
    revalidate,
  }).createVendorAccount;
}

function renderDialog(action: ReturnType<typeof realAction>) {
  return render(
    <VendorAccountDialog
      action={action}
      labels={labels}
      vendors={[{ id: ids.vendor, name: "Anthropic" }]}
    />,
  );
}

async function submitNamedAccount(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("btn_new_vendor_account"));
  await user.type(screen.getByLabelText("FIELD_NAME"), name);
  await user.click(screen.getByRole("button", { name: "SUBMIT_FORM" }));
  return user;
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    "TRUNCATE TABLE vendor_account, vendor, user_account RESTART IDENTITY CASCADE",
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'ui-integration@vendor.test','vendor-account-ui-integration',
       'group_admin','en','active',$2)`,
    [ids.admin, now],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$3,$2)`,
    [ids.vendor, ids.admin, now],
  );
}, 120_000);

beforeEach(async () => {
  await owner.query("TRUNCATE audit_log");
  await owner.query("DELETE FROM vendor_account");
});

afterEach(cleanup);

afterAll(async () => {
  await Promise.all([pool?.end(), owner?.end()]);
  await fixture?.stop();
});

describe("US-025 real vendor-account dialog journey", () => {
  it("persists and audits one create, then localizes a duplicate without a second write", async () => {
    const revalidated: string[] = [];
    renderDialog(realAction({ revalidate: (path) => revalidated.push(path) }));
    const user = await submitNamedAccount("Integrated Account");

    expect((await screen.findByText("CREATE_SUCCESS")).getAttribute("role")).toBe("status");
    expect(screen.getByRole("dialog", { hidden: true }).hasAttribute("open")).toBe(false);
    const created = await owner.query<{ id: string }>(
      "SELECT id::text FROM vendor_account WHERE name='Integrated Account'",
    );
    expect(created.rows).toHaveLength(1);
    const audit = await owner.query(
      "SELECT action FROM audit_log WHERE entity_id=$1",
      [created.rows[0]!.id],
    );
    expect(audit.rows).toEqual([{ action: "vendor_account.created" }]);
    expect(revalidated).toEqual(["/organizaciones"]);

    await user.click(screen.getByTestId("btn_new_vendor_account"));
    await user.type(screen.getByLabelText("FIELD_NAME"), "Integrated Account");
    await user.click(screen.getByRole("button", { name: "SUBMIT_FORM" }));
    expect((await screen.findByText("ERROR_DUPLICATE")).getAttribute("role")).toBe("alert");
    const counts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM vendor_account WHERE name='Integrated Account') AS accounts,
         (SELECT count(*)::int FROM audit_log WHERE action='vendor_account.created') AS audits`,
    );
    expect(counts.rows).toEqual([{ accounts: 1, audits: 1 }]);
  });

  it("surfaces a rejected post-commit revalidation while preserving the row and audit", async () => {
    renderDialog(realAction({
      revalidate: () => {
        throw new Error("cache unavailable");
      },
    }));
    await submitNamedAccount("Committed Before Revalidation");

    expect((await screen.findByText("ERROR_GENERIC")).getAttribute("role")).toBe("alert");
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    expect((screen.getByRole("button", { name: "SUBMIT_FORM" }) as HTMLButtonElement).disabled).toBe(false);
    const counts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM vendor_account WHERE name='Committed Before Revalidation') AS accounts,
         (SELECT count(*)::int FROM audit_log WHERE action='vendor_account.created') AS audits`,
    );
    expect(counts.rows).toEqual([{ accounts: 1, audits: 1 }]);
  });

  it("keeps one real action session pending and ignores close, reopen, and resubmit attempts", async () => {
    let resolveAuthorization!: (value: LedgerAuthorization) => void;
    const authorizationReady: Promise<LedgerAuthorization> = new Promise((resolve) => {
      resolveAuthorization = resolve;
    });
    let authorizationLoads = 0;
    renderDialog(realAction({
      loadAuthorization: async () => {
        authorizationLoads += 1;
        return authorizationReady;
      },
    }));
    const user = await submitNamedAccount("Single Pending Account");
    const dialog = screen.getByRole("dialog");
    const trigger = screen.getByTestId("btn_new_vendor_account") as HTMLButtonElement;
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(trigger.disabled).toBe(true);
    await user.click(trigger);
    const submit = screen.getByRole("button", { name: "SUBMITTING_FORM" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(submit);
    expect(authorizationLoads).toBe(1);

    resolveAuthorization(authorization);
    expect((await screen.findByText("CREATE_SUCCESS")).getAttribute("role")).toBe("status");
    expect(dialog.hasAttribute("open")).toBe(false);
    const counts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM vendor_account WHERE name='Single Pending Account') AS accounts,
         (SELECT count(*)::int FROM audit_log WHERE action='vendor_account.created') AS audits`,
    );
    expect(counts.rows).toEqual([{ accounts: 1, audits: 1 }]);
  });
});

const tabLabels: VendorAccountTabsLabels = {
  capacity: { empty: "NO_CAPACITY", label: "CAPACITY" },
  licenses: { active: "ACTIVE", caption: "LICENSES", effectiveFrom: "FROM", effectiveTo: "TO", inactive: "INACTIVE", label: "LICENSE_TYPES", monthlyRate: "RATE", name: "NAME", noRate: "NO_RATE", openEnded: "OPEN", status: "STATUS", unit: "UNIT", units: { license: "LICENSE", seat: "SEAT" } },
  settings: { label: "SETTINGS", saved: "SETTINGS_SAVED" },
  tabsLabel: "SECTIONS",
};

describe("US-025 real vendor-account settings journey", () => {
  it("persists only dirty settings, advances the baseline, and never labels pending edits as saved", async () => {
    await owner.query(
      `INSERT INTO vendor_account
         (id,vendor_id,name,mode,vendor_org_ref,contract_renewal_on,low_pool_floor,status,created_at,created_by,updated_at,updated_by)
       VALUES ($1,$2,'Original account','automated','org-original','2027-01-15',3,'active',$3,$4,$3,$4)`,
      [ids.account, ids.vendor, now, ids.admin],
    );
    let signalRevalidation!: () => void;
    const revalidationStarted = new Promise<void>((resolve) => { signalRevalidation = resolve; });
    let releaseRevalidation!: () => void;
    const revalidationGate = new Promise<void>((resolve) => { releaseRevalidation = resolve; });
    let revalidationCalls = 0;
    const updateAction = createVendorAccountServerActions({
      database: drizzle(pool, { schema }),
      loadAuthorization: async () => authorization,
      now: () => now,
      revalidate: async () => {
        revalidationCalls += 1;
        if (revalidationCalls !== 1) return;
        signalRevalidation();
        await revalidationGate;
      },
    }).updateVendorAccount.bind(null, ids.account);
    render(<VendorAccountTabs
      account={{ contractRenewalOn: "2027-01-15", id: ids.account, lowPoolFloor: 3, mode: "automated", name: "Original account", status: "active", vendorId: ids.vendor, vendorName: "Anthropic", vendorOrgRef: "org-original" }}
      action={updateAction}
      capacity={<p>{tabLabels.capacity.label}</p>}
      formLabels={{ ...labels, submit: "SAVE", submitting: "SAVING", success: "SETTINGS_SAVED", title: "SETTINGS_FORM" }}
      labels={tabLabels}
      licenseTypes={[]}
      locale="en-US"
    />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "SETTINGS" }));
    expect((screen.getByLabelText("FIELD_VENDOR") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("FIELD_NAME") as HTMLInputElement).value).toBe("Original account");
    const saveButton = screen.getByRole("button", { name: "SAVE" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "SETTINGS_FORM" }));
    expect(revalidationCalls).toBe(0);
    expect((await owner.query("SELECT action FROM audit_log WHERE entity_id=$1", [ids.account])).rows).toEqual([]);
    await user.clear(screen.getByLabelText("FIELD_NAME"));
    await user.type(screen.getByLabelText("FIELD_NAME"), "Updated account");
    await user.selectOptions(screen.getByLabelText("FIELD_MODE"), "orchestration");
    await user.clear(screen.getByLabelText("FIELD_FLOOR"));
    await user.type(screen.getByLabelText("FIELD_FLOOR"), "7");
    await user.selectOptions(screen.getByLabelText("FIELD_STATUS"), "inactive");
    await user.click(saveButton);
    await revalidationStarted;
    expect((screen.getByRole("button", { name: "SAVING" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText("FIELD_NAME"));
    await user.type(screen.getByLabelText("FIELD_NAME"), "Unsaved after commit");
    expect((screen.getByRole("button", { name: "SAVING" }) as HTMLButtonElement).disabled).toBe(true);
    releaseRevalidation();
    await screen.findByRole("button", { name: "SAVE" });
    expect(screen.queryByText("SETTINGS_SAVED")).toBeNull();
    expect((screen.getByLabelText("FIELD_NAME") as HTMLInputElement).value).toBe("Unsaved after commit");
    expect(saveButton.disabled).toBe(false);
    const saved = await owner.query(
      `SELECT vendor_id::text AS "vendorId", name, mode, low_pool_floor::int AS floor, status
       FROM vendor_account WHERE id=$1`,
      [ids.account],
    );
    expect(saved.rows).toEqual([{ vendorId: ids.vendor, name: "Updated account", mode: "orchestration", floor: 7, status: "inactive" }]);

    await user.click(saveButton);
    expect((await screen.findByText("SETTINGS_SAVED")).getAttribute("role")).toBe("status");
    expect(saveButton.disabled).toBe(true);
    await user.type(screen.getByLabelText("FIELD_NAME"), " ");
    expect(screen.queryByText("SETTINGS_SAVED")).toBeNull();
    expect(saveButton.disabled).toBe(true);
    await user.type(screen.getByLabelText("FIELD_NAME"), "again");
    expect(saveButton.disabled).toBe(false);
    const savedAgain = await owner.query("SELECT name FROM vendor_account WHERE id=$1", [ids.account]);
    expect(savedAgain.rows).toEqual([{ name: "Unsaved after commit" }]);
    const audit = await owner.query("SELECT action FROM audit_log WHERE entity_id=$1", [ids.account]);
    expect(audit.rows.map((row) => row.action).sort()).toEqual(["vendor_account.retired", "vendor_account.updated"]);
  });
});
