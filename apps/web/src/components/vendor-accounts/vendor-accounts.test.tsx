// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type VendorAccountFormAction,
  type VendorAccountFormLabels,
} from "./vendor-account-form";
import { VendorAccountDialog } from "./vendor-account-dialog";
import {
  type VendorAccountsTableLabels,
  VendorAccountsTable,
} from "./vendor-accounts-table";

const accountId = "account /? value";

const tableLabels: VendorAccountsTableLabels = {
  columns: {
    connector: "COL_CONNECTOR",
    credential: "COL_CREDENTIAL",
    floor: "COL_FLOOR",
    mode: "COL_MODE",
    name: "COL_NAME",
    renewal: "COL_RENEWAL",
    seats: "COL_SEATS",
    status: "COL_STATUS",
    vendor: "COL_VENDOR",
  },
  connector: { api: "CONNECTOR_API", manual: "CONNECTOR_MANUAL", orchestration: "CONNECTOR_ORCHESTRATION" },
  credential: { auth_failed: "CREDENTIAL_FAILED", none: "CREDENTIAL_NONE", ok: "CREDENTIAL_OK", unverified: "CREDENTIAL_UNVERIFIED" },
  empty: "EMPTY_ACCOUNTS",
  modes: { automated: "MODE_AUTOMATED", orchestration: "MODE_ORCHESTRATION" },
  noRenewal: "NO_RENEWAL",
  protocol: { none: "PROTOCOL_NONE", rest: "PROTOCOL_REST", scim: "PROTOCOL_SCIM" },
  seatsPattern: "{purchased} PURCHASED / {free} FREE",
  status: { active: "STATUS_ACTIVE", inactive: "STATUS_INACTIVE" },
  tableCaption: "TABLE_CAPTION",
  viewAccount: "VIEW_ACCOUNT",
};

const formLabels: VendorAccountFormLabels = {
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
    vendorId: "FIELD_VENDOR",
    vendorOrgRef: "FIELD_VENDOR_REF",
  },
  help: {
    lowPoolFloor: "HELP_FLOOR",
    vendor: "HELP_VENDOR",
    vendorOrgRef: "HELP_VENDOR_REF",
  },
  modes: { automated: "FORM_MODE_AUTOMATED", orchestration: "FORM_MODE_ORCHESTRATION" },
  submit: "SUBMIT_FORM",
  submitting: "SUBMITTING_FORM",
  success: "CREATE_SUCCESS",
  title: "FORM_TITLE",
  trigger: "OPEN_FORM",
};

const inertAction: VendorAccountFormAction = async () => {
  throw new Error("inert component action must not be invoked");
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

describe("US-025 vendor-account registry", () => {
  it("renders an explicit empty state", () => {
    render(<VendorAccountsTable accounts={[]} labels={tableLabels} locale="en-US" />);
    expect(screen.getByText("EMPTY_ACCOUNTS")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders every account as a semantic row with the complete read-model state", () => {
    render(
      <VendorAccountsTable
        accounts={[
          {
            connectorType: "api",
            contractRenewalOn: "2027-02-01",
            credentialHealth: "ok",
            free: 5,
            id: "first-account",
            lowPoolFloor: 5,
            mode: "automated",
            name: "Central account",
            provisioningProtocol: "rest",
            purchased: 40,
            status: "active",
            vendorName: "Anthropic",
          },
          {
            connectorType: "orchestration",
            contractRenewalOn: null,
            credentialHealth: "auth_failed",
            free: 0,
            id: accountId,
            lowPoolFloor: 3,
            mode: "orchestration",
            name: "Zero capacity account",
            provisioningProtocol: "none",
            purchased: 0,
            status: "inactive",
            vendorName: "Anthropic",
          },
        ]}
        labels={tableLabels}
        locale="en-US"
      />,
    );

    const table = screen.getByRole("table", { name: "TABLE_CAPTION" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    const row = screen.getByRole("link", { name: "Zero capacity account" }).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("0 PURCHASED / 0 FREE")).toBeTruthy();
    expect(within(row!).getByText("NO_RENEWAL")).toBeTruthy();
    expect(within(row!).getByText("CONNECTOR_ORCHESTRATION · PROTOCOL_NONE")).toBeTruthy();
    expect(within(row!).getByText("MODE_ORCHESTRATION")).toBeTruthy();
    expect(within(row!).getByText("CREDENTIAL_FAILED")).toBeTruthy();
    expect(within(row!).getByText("3")).toBeTruthy();
    expect(within(row!).getByText("STATUS_INACTIVE")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zero capacity account" }).getAttribute("href")).toBe(
      `/organizaciones/${encodeURIComponent(accountId)}`,
    );
    expect(screen.getByRole("link", { name: "Zero capacity account" }).className).toContain("min-h-11");
    expect(screen.getByText("40 PURCHASED / 5 FREE")).toBeTruthy();
    expect(screen.getByText("CONNECTOR_API · PROTOCOL_REST")).toBeTruthy();
    expect(screen.getByText("MODE_AUTOMATED")).toBeTruthy();
    expect(screen.getByText("CREDENTIAL_OK")).toBeTruthy();
    expect(screen.getByText("STATUS_ACTIVE")).toBeTruthy();
    expect(screen.getByText("Feb 1, 2027")).toBeTruthy();
  });

  it("moves focus into the dialog, traps Tab in both directions, and restores focus on Escape and cancel", async () => {
    const user = userEvent.setup();
    render(
      <VendorAccountDialog
        action={inertAction}
        labels={formLabels}
        vendors={[{ id: "00000000-0000-4000-8000-000000000001", name: "Anthropic" }]}
      />,
    );
    const trigger = screen.getByTestId("btn_new_vendor_account");
    expect(document.activeElement).not.toBe(trigger);
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("FIELD_VENDOR"));

    const submit = screen.getByRole("button", { name: "SUBMIT_FORM" });
    submit.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("FIELD_VENDOR"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(submit);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "CANCEL_FORM" }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    const cancelEvent = new Event("cancel", { bubbles: true, cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(dialog.hasAttribute("open")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("shows linked accessible errors for invalid data without calling the action", async () => {
    const user = userEvent.setup();
    render(
      <VendorAccountDialog
        action={inertAction}
        labels={formLabels}
        vendors={[{ id: "00000000-0000-4000-8000-000000000001", name: "Anthropic" }]}
      />,
    );
    await user.click(screen.getByTestId("btn_new_vendor_account"));
    const name = screen.getByLabelText("FIELD_NAME");
    const floor = screen.getByLabelText("FIELD_FLOOR");
    await user.clear(floor);
    await user.type(floor, "-1");
    await user.click(screen.getByRole("button", { name: "SUBMIT_FORM" }));

    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toContain("name-error");
    expect(floor.getAttribute("aria-invalid")).toBe("true");
    expect(floor.getAttribute("aria-describedby")).toContain("lowPoolFloor-error");
    expect(screen.getByText("ERROR_NAME").getAttribute("role")).toBe("alert");
    expect(screen.getByText("ERROR_FLOOR").getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(name);
  });

  it("rejects a cleared required floor through canonical client validation", async () => {
    const user = userEvent.setup();
    render(
      <VendorAccountDialog
        action={inertAction}
        labels={formLabels}
        vendors={[{ id: "00000000-0000-4000-8000-000000000001", name: "Anthropic" }]}
      />,
    );
    await user.click(screen.getByTestId("btn_new_vendor_account"));
    await user.type(screen.getByLabelText("FIELD_NAME"), "Valid account");
    const floor = screen.getByLabelText("FIELD_FLOOR");
    await user.clear(floor);
    await user.click(screen.getByRole("button", { name: "SUBMIT_FORM" }));

    expect(floor.getAttribute("aria-invalid")).toBe("true");
    expect(floor.getAttribute("aria-describedby")).toContain("lowPoolFloor-error");
    expect(screen.getByText("ERROR_FLOOR").getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(floor);
  });

});
