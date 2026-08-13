// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { CapabilityCard, type CapabilityCardLabels } from "./capability-card";
import { VendorAccountTabs, type VendorAccountTabsLabels } from "./vendor-account-tabs";

const capabilities = {
  canDeprovision: false,
  canProvision: true,
  hasCostData: false,
  hasUsageData: true,
  identityMatching: "email" as const,
  provisioningProtocol: "scim" as const,
};

const capabilityLabels: CapabilityCardLabels = {
  canDeprovision: "DEPROVISION",
  canProvision: "PROVISION",
  fallback: "UNSUPPORTED_TO_ORCHESTRATION",
  hasCostData: "COST_DATA",
  hasUsageData: "USAGE_DATA",
  identityMatching: "IDENTITY_MATCHING",
  identityValues: { email: "EMAIL", upn: "UPN", vendor_user_id: "VENDOR_ID" },
  notSupported: "NOT_SUPPORTED",
  protocol: "PROTOCOL",
  protocolValues: { none: "NO_PROTOCOL", rest: "REST", scim: "SCIM" },
  supported: "SUPPORTED",
  title: "CAPABILITIES",
};

const labels: VendorAccountTabsLabels = {
  capacity: { empty: "NO_CAPACITY", label: "CAPACITY" },
  licenses: {
    active: "ACTIVE",
    caption: "LICENSE_TABLE",
    effectiveFrom: "EFFECTIVE_FROM",
    effectiveTo: "EFFECTIVE_TO",
    inactive: "INACTIVE",
    label: "LICENSE_TYPES",
    monthlyRate: "MONTHLY_RATE",
    name: "LICENSE_NAME",
    noRate: "NO_RATE",
    openEnded: "OPEN_ENDED",
    status: "STATUS",
    unit: "UNIT",
    units: { license: "LICENSE", seat: "SEAT" },
  },
  settings: { label: "SETTINGS", saved: "SAVED" },
  tabsLabel: "ACCOUNT_SECTIONS",
};

afterEach(cleanup);

describe("US-025 vendor account detail", () => {
  it("renders all six localized capability facts with non-color-only support markers and fallback", () => {
    render(<CapabilityCard capabilities={capabilities} labels={capabilityLabels} />);
    const card = screen.getByRole("region", { name: "CAPABILITIES" });
    for (const fact of ["PROVISION", "DEPROVISION", "USAGE_DATA", "COST_DATA", "PROTOCOL", "IDENTITY_MATCHING"]) {
      expect(within(card).getByText(fact)).toBeTruthy();
    }
    expect(within(card).getAllByText("SUPPORTED")).toHaveLength(2);
    expect(within(card).getAllByText("NOT_SUPPORTED")).toHaveLength(2);
    expect(within(card).getByText("SCIM")).toBeTruthy();
    expect(within(card).getByText("EMAIL")).toBeTruthy();
    expect(within(card).getByText("UNSUPPORTED_TO_ORCHESTRATION")).toBeTruthy();
    expect(card.textContent).toContain("✓");
    expect(card.textContent).toContain("—");
  });

  it("always explains the orchestration fallback when every connector capability is supported", () => {
    render(<CapabilityCard capabilities={{ ...capabilities, canDeprovision: true, hasCostData: true }} labels={capabilityLabels} />);
    expect(screen.getByText("UNSUPPORTED_TO_ORCHESTRATION")).toBeTruthy();
  });

  it("implements one-panel tabs with Arrow, Home, and End keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <VendorAccountTabs
        action={async () => ({ status: "success", vendorAccountId: "25200000-0000-4000-8000-000000000001" })}
        account={{ contractRenewalOn: null, id: "25200000-0000-4000-8000-000000000001", lowPoolFloor: 3, mode: "automated", name: "Primary", status: "active", vendorId: "25200000-0000-4000-8000-000000000002", vendorName: "Anthropic", vendorOrgRef: "org_1" }}
        capacity={<p>{labels.capacity.label}</p>}
        formLabels={formLabels}
        labels={labels}
        licenseTypes={[]}
        locale="en-US"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    expect(panels).toHaveLength(3);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    for (const [index, tab] of tabs.entries()) {
      expect(tab.getAttribute("aria-controls")).toBe(panels[index]!.id);
      expect(panels[index]!.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    const expectTabState = (activeIndex: number) => {
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(
        tabs.map((_, index) => String(index === activeIndex)),
      );
      expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(
        tabs.map((_, index) => index === activeIndex ? "0" : "-1"),
      );
      expect(panels.map((panel) => panel.hidden)).toEqual(
        panels.map((_, index) => index !== activeIndex),
      );
      expect(panels.map((panel) => panel.getAttribute("tabindex"))).toEqual(
        panels.map((_, index) => index === activeIndex ? "0" : "-1"),
      );
    };
    expectTabState(0);
    tabs[0]!.focus();
    await user.keyboard("x");
    expect(document.activeElement).toBe(tabs[0]);
    expectTabState(0);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[1]);
    expectTabState(1);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tabs[2]);
    expectTabState(2);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tabs[0]);
    expectTabState(0);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tabs[2]);
    expectTabState(2);
  });

  it("renders localized read-only licenses, current USD rates, dates, and a missing-rate placeholder", async () => {
    const user = userEvent.setup();
    render(
      <VendorAccountTabs
        action={async () => ({ status: "idle" })}
        account={{ contractRenewalOn: null, id: "25200000-0000-4000-8000-000000000001", lowPoolFloor: 3, mode: "automated", name: "Primary", status: "active", vendorId: "25200000-0000-4000-8000-000000000002", vendorName: "Anthropic", vendorOrgRef: null }}
        capacity={<p>{labels.capacity.label}</p>}
        formLabels={formLabels}
        labels={labels}
        licenseTypes={[
          { id: "1", monthlyRateUsd: "30.00", name: "Team", rateEffectiveFrom: "2026-01-01", rateEffectiveTo: null, status: "active", unit: "seat" },
          { id: "2", monthlyRateUsd: null, name: "Legacy", rateEffectiveFrom: null, rateEffectiveTo: null, status: "inactive", unit: "license" },
        ]}
        locale="en-US"
      />,
    );
    await user.click(screen.getByRole("tab", { name: "LICENSE_TYPES" }));
    const table = screen.getByRole("table", { name: "LICENSE_TABLE" });
    const teamCells = within(table).getByRole("row", { name: /Team/ }).querySelectorAll("th,td");
    expect(Array.from(teamCells, (cell) => cell.textContent)).toEqual([
      "Team", "SEAT", "ACTIVE", "$30.00", "Jan 1, 2026", "OPEN_ENDED",
    ]);
    const legacyCells = within(table).getByRole("row", { name: /Legacy/ }).querySelectorAll("th,td");
    expect(Array.from(legacyCells, (cell) => cell.textContent)).toEqual([
      "Legacy", "LICENSE", "INACTIVE", "NO_RATE", "NO_RATE", "NO_RATE",
    ]);
    expect(within(table).getAllByText("OPEN_ENDED")).toHaveLength(1);
    expect(within(table).queryByRole("button")).toBeNull();
    expect(within(table).queryByRole("link")).toBeNull();
    expect(within(table).queryByRole("textbox")).toBeNull();
  });

  it("keeps pristine settings disabled and clears stale validation when values return to the baseline", async () => {
    const user = userEvent.setup();
    render(
      <VendorAccountTabs
        action={async () => { throw new Error("inert action must never be invoked"); }}
        account={{ contractRenewalOn: null, id: "25200000-0000-4000-8000-000000000001", lowPoolFloor: 3, mode: "automated", name: "Primary", status: "active", vendorId: "25200000-0000-4000-8000-000000000002", vendorName: "Anthropic", vendorOrgRef: null }}
        capacity={<p>{labels.capacity.label}</p>}
        formLabels={formLabels}
        labels={labels}
        licenseTypes={[]}
        locale="en-US"
      />,
    );
    await user.click(screen.getByRole("tab", { name: "SETTINGS" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "CANCEL" })).toBeNull();
    const save = screen.getByRole("button", { name: "SAVE" }) as HTMLButtonElement;
    const name = screen.getByLabelText("NAME") as HTMLInputElement;
    expect(save.disabled).toBe(true);
    await user.click(save);

    await user.clear(name);
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(screen.getByText("BAD_NAME").getAttribute("role")).toBe("alert");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    await user.type(name, "Primary");
    expect(screen.queryByText("BAD_NAME")).toBeNull();
    expect(name.hasAttribute("aria-invalid")).toBe(false);
    expect(save.disabled).toBe(true);
  });
});

const formLabels = {
  cancel: "CANCEL",
  description: "DESCRIPTION",
  errors: { contractRenewalOn: "BAD_DATE", duplicate: "DUPLICATE", generic: "ERROR", lowPoolFloor: "BAD_FLOOR", mode: "BAD_MODE", name: "BAD_NAME", status: "BAD_STATUS", vendorId: "BAD_VENDOR", vendorOrgRef: "BAD_REF" },
  fields: { contractRenewalOn: "RENEWAL", lowPoolFloor: "FLOOR", mode: "MODE", name: "NAME", status: "ACCOUNT_STATUS", vendorId: "VENDOR", vendorOrgRef: "VENDOR_REF" },
  help: { lowPoolFloor: "FLOOR_HELP", vendor: "VENDOR_HELP", vendorOrgRef: "REF_HELP" },
  modes: { automated: "AUTOMATED", orchestration: "ORCHESTRATION" },
  statuses: { active: "ACTIVE", inactive: "INACTIVE" },
  submit: "SAVE",
  submitting: "SAVING",
  success: "SAVED",
  title: "FORM",
  trigger: "TRIGGER",
};
