// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { capabilityLabels, detailFormLabels, detailTabLabels, registryFormLabels, registryTableLabels, renderVendorAccountDetailPage, renderVendorAccountsRegistryPage } from "./vendor-account-page-presenters";

const t = (key: string, values?: Record<string, string>) => values ? `${key}:${JSON.stringify(values)}` : key;
const account = { connectorType: "api" as const, contractRenewalOn: "2027-02-01", credentialHealth: "ok" as const, free: 6, id: "25000000-0000-4000-8000-000000000020", lowPoolFloor: 2, mode: "automated" as const, name: "Claude Enterprise", provisioningProtocol: "rest" as const, purchased: 10, status: "active" as const, vendorName: "Anthropic" };
const detail = { ...account, capabilities: { canDeprovision: true, canProvision: true, hasCostData: true, hasUsageData: true, identityMatching: "email" as const, provisioningProtocol: "rest" as const }, licenseTypes: [], vendorId: "25000000-0000-4000-8000-000000000010", vendorOrgRef: "org-claude" };
const action = async () => ({ status: "idle" as const });
afterEach(cleanup);

test("maps every registry and detail form label to its exact translation contract", () => {
  expect(registryFormLabels(t)).toEqual({
    cancel: "form.cancel", description: "form.description",
    errors: { contractRenewalOn: "form.errors.contractRenewalOn", duplicate: "form.errors.duplicate", generic: "form.errors.generic", lowPoolFloor: "form.errors.lowPoolFloor", mode: "form.errors.mode", name: "form.errors.name", vendorId: "form.errors.vendorId", vendorOrgRef: "form.errors.vendorOrgRef" },
    fields: { contractRenewalOn: "form.fields.contractRenewalOn", lowPoolFloor: "form.fields.lowPoolFloor", mode: "form.fields.mode", name: "form.fields.name", vendorId: "form.fields.vendorId", vendorOrgRef: "form.fields.vendorOrgRef" },
    help: { lowPoolFloor: "form.help.lowPoolFloor", vendor: "form.help.vendor", vendorOrgRef: "form.help.vendorOrgRef" },
    modes: { automated: "form.modes.automated", orchestration: "form.modes.orchestration" },
    submit: "form.submit", submitting: "form.submitting", success: "form.success", title: "form.title", trigger: "form.trigger",
  });
  expect(detailFormLabels(t)).toMatchObject({
    errors: { generic: "detail.settings.genericError", status: "form.errors.mode" },
    fields: { status: "detail.settings.status" }, statuses: { active: "status.active", inactive: "status.inactive" },
    submit: "detail.settings.submit", submitting: "detail.settings.submitting", success: "detail.settings.saved", title: "detail.settings.title", trigger: "detail.tabs.settings",
  });
  expect(registryTableLabels(t)).toEqual({
    columns: Object.fromEntries(["connector","credential","floor","mode","name","renewal","seats","status","vendor"].map((key) => [key, `columns.${key}`])),
    connector: { api: "connector.api", manual: "connector.manual", orchestration: "connector.orchestration" }, credential: { auth_failed: "credential.auth_failed", none: "credential.none", ok: "credential.ok", unverified: "credential.unverified" }, empty: "empty", modes: { automated: "modes.automated", orchestration: "modes.orchestration" }, noRenewal: "noRenewal", protocol: { none: "protocol.none", rest: "protocol.rest", scim: "protocol.scim" }, seatsPattern: 'seatsPattern:{"free":"{free}","purchased":"{purchased}"}', status: { active: "status.active", inactive: "status.inactive" }, tableCaption: "tableCaption", viewAccount: "viewAccount",
  });
  expect(capabilityLabels(t)).toEqual({ canDeprovision: "detail.capabilities.canDeprovision", canProvision: "detail.capabilities.canProvision", fallback: "detail.capabilities.fallback", hasCostData: "detail.capabilities.hasCostData", hasUsageData: "detail.capabilities.hasUsageData", identityMatching: "detail.capabilities.identityMatching", identityValues: { email: "detail.capabilities.identity.email", upn: "detail.capabilities.identity.upn", vendor_user_id: "detail.capabilities.identity.vendor_user_id" }, notSupported: "detail.capabilities.notSupported", protocol: "detail.capabilities.protocol", protocolValues: { none: "protocol.none", rest: "protocol.rest", scim: "protocol.scim" }, supported: "detail.capabilities.supported", title: "detail.capabilities.title" });
  expect(detailTabLabels(t, t)).toEqual({ capacity: { empty: "emptyDescription", label: "detail.tabs.capacity" }, licenses: { active: "status.active", caption: "detail.licenses.caption", effectiveFrom: "detail.licenses.effectiveFrom", effectiveTo: "detail.licenses.effectiveTo", inactive: "status.inactive", label: "detail.tabs.licenseTypes", monthlyRate: "detail.licenses.monthlyRate", name: "detail.licenses.name", noRate: "detail.licenses.noRate", openEnded: "detail.licenses.openEnded", status: "detail.licenses.status", unit: "detail.licenses.unit", units: { license: "detail.licenses.license", seat: "detail.licenses.seat" } }, settings: { label: "detail.tabs.settings", saved: "detail.settings.saved" }, tabsLabel: "detail.tabsLabel" });
});

test("renders the registry table and creation dialog from page data", () => {
  render(renderVendorAccountsRegistryPage({ createAction: action, data: { accounts: [account], vendors: [{ id: "vendor-1", name: "Anthropic" }] }, locale: "en-US", t }));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("title");
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("listTitle");
  expect(screen.getByRole("table").textContent).toContain("Claude Enterprise");
  expect(screen.getByRole("button", { name: "form.trigger" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Claude Enterprise" }).getAttribute("href")).toBe(`/organizaciones/${account.id}`);
  expect(screen.getByRole("row", { name: /Claude Enterprise/ }).textContent).toBe('Claude EnterpriseAnthropicconnector.api · protocol.restmodes.automatedseatsPattern:{"free":"6","purchased":"10"}Feb 1, 2027credential.ok2status.active');
});

test("renders exact detail metadata and empty capacity", () => {
  render(renderVendorAccountDetailPage({ data: { at: new Date("2026-08-13T15:00:00.000Z"), detail, snapshots: [] }, locale: "en-US", poolsT: t, t, updateAction: action }));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Claude Enterprise");
  expect(screen.getByText("Anthropic")).toBeTruthy();
  expect(screen.getByText("Feb 1, 2027")).toBeTruthy();
  expect(screen.getByText("emptyTitle")).toBeTruthy();
  expect(screen.getByText('freshness:{"date":"2026-08-13"}')).toBeTruthy();
  expect(screen.getByRole("region", { name: "detail.capabilities.title" }).textContent).toContain("protocol.rest");
  expect(screen.getByRole("tablist", { name: "detail.tabsLabel" }).textContent).toBe("detail.tabs.capacitydetail.tabs.licenseTypesdetail.tabs.settings");
});

test("renders non-empty capacity through the real pool tiles", () => {
  const snapshots = [{ assigned: 4, blockedRequests: [], contractRenewalOn: "2027-02-01", decisionEvidence: { type: "no_data" as const }, effectiveFrom: "2026-08-01", free: 8, isLow: false, licenseTypeId: "license-standard", licenseTypeName: "Standard", lowPoolFloor: 2, mode: "automated" as const, pendingInvites: 1, purchased: 13, vendorAccountId: account.id, vendorAccountName: account.name }];
  render(renderVendorAccountDetailPage({ data: { at: new Date("2026-08-13T15:00:00.000Z"), detail, snapshots }, locale: "en-US", poolsT: t, t, updateAction: action }));
  expect(screen.queryByText("emptyTitle")).toBeNull();
  expect(screen.getByTestId("tile_purchased").textContent).toBe("purchased13");
  expect(screen.getByTestId("tile_free").textContent).toBe("available8");
});
