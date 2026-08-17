import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AlertList,
  alertDestination,
  alertScopeText,
} from "./alert-list";

describe("alertDestination", () => {
  it.each([
    ["approval_aging", { requestId: "request-1" }, "/solicitudes/request-1"],
    ["provisioning_failure", { requestId: "request-2" }, "/solicitudes/request-2"],
    ["blocked_no_seat", { requestId: "request-3" }, "/solicitudes/request-3"],
    ["invite_unaccepted", { requestId: "request-4" }, "/solicitudes/request-4"],
    ["deprovision_overdue", { requestId: "request-5" }, "/solicitudes/request-5"],
    [
      "low_pool",
      { licenseTypeId: "license-1", vendorAccountId: "account-1" },
      "/cupos?vendorAccountId=account-1&licenseTypeId=license-1",
    ],
    ["sync_stale", { vendorAccountId: "account-2" }, "/credenciales"],
    ["credential_failure", { vendorAccountId: "account-3" }, "/credenciales"],
    ["register_drift", { reconciliationId: "reconciliation-1" }, "/excepciones"],
    ["close_missed", { period: "2026-07" }, "/cierre?period=2026-07"],
  ] as const)("dispatches %s with the canonical subject mapping", (type, subject, href) => {
    expect(alertDestination(type, subject)).toBe(href);
  });

  it("returns no destination for malformed or unsupported subjects", () => {
    expect(alertDestination("low_pool", { vendorAccountId: "account-1" })).toBeNull();
    expect(alertDestination("unknown", { requestId: "request-1" })).toBeNull();
    expect(alertDestination("approval_aging", null)).toBeNull();
  });

  it("attributes resolved global request alerts to their target company", () => {
    const labels = {
      company: (name: string) => `Company ${name}`,
      global: "Global",
    };
    expect(alertScopeText("global", "Company A", labels)).toBe(
      "Company Company A",
    );
    expect(alertScopeText("global", null, labels)).toBe("Global");
    expect(alertScopeText("company", "Company B", labels)).toBe(
      "Company Company B",
    );
  });

  it("maps raw subjects into organism destinations", () => {
    const html = renderToStaticMarkup(
      <AlertList
        activeFilter="unacknowledged"
        allCount="1"
        allHref="?filter=all"
        items={[{
          acknowledgedAt: null,
          acknowledgedBy: null,
          firedAt: "2026-07-29T12:00:00.000Z",
          id: "event-1",
          notified: "Pending",
          rawSubject: { requestId: "request-1" },
          rawType: "approval_aging",
          scope: "Company A",
          subject: "request-1",
          type: "Approval aging",
        }]}
        labels={{
          acknowledgedAt: "Acknowledged at",
          acknowledgedBy: "Acknowledged by",
          all: "All",
          emptyAll: "No alerts.",
          emptyUnacknowledged: "No active alerts.",
          firedAt: "Fired",
          notified: "Notification",
          scope: "Scope",
          subject: "Subject",
          type: "Type",
          unacknowledged: "Unacknowledged",
        }}
        locale="en-US"
        unacknowledgedCount="1"
        unacknowledgedHref="?filter=unacknowledged"
      />,
    );
    expect(html).toContain('href="/solicitudes/request-1"');
    expect(html).not.toContain("rawSubject");
  });

  it("AC2: dispatches each alert type to its own subject destination", () => {
    expect(alertDestination("low_pool", {
      licenseTypeId: "lt-1", vendorAccountId: "va-1",
    })).toBe("/cupos?vendorAccountId=va-1&licenseTypeId=lt-1");
    expect(alertDestination("approval_aging", { requestId: "req-1" }))
      .toBe("/solicitudes/req-1");
    expect(alertDestination("credential_failure", { vendorAccountId: "va-1" }))
      .toBe("/credenciales");
    expect(alertDestination("register_drift", { reconciliationId: "rec-1" }))
      .toBe("/excepciones");
    expect(alertDestination("nonsense", { requestId: "req-1" })).toBeNull();
  });

  it("AC3: labels company scope by name and falls back to global", () => {
    const labels = { company: (name: string) => `Compañía: ${name}`, global: "Global" };
    expect(alertScopeText("company", "Corporativo", labels)).toBe("Compañía: Corporativo");
    expect(alertScopeText("global", null, labels)).toBe("Global");
  });
});
