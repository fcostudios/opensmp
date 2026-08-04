// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PoolCards } from "./pool-cards";

afterEach(cleanup);

const labels = {
  addCapacity: "Add capacity",
  assigned: "Assigned",
  attention: "Below minimum floor",
  available: "Available",
  automated: "Automated",
  candidateTitle: "Reclaim candidates",
  discrepancy: "Oversubscribed by",
  emptyDescription: "Capacity appears after the first effective record.",
  emptyTitle: "No pool capacity",
  effectiveFrom: "Effective from",
  effectiveFromField: "Effective date",
  escalated: "Escalated",
  floor: "Minimum floor",
  lastActive: "Last active",
  monthlyCost: "Monthly cost",
  noUsageData: "No usage data",
  note: "Note",
  mode: "Mode",
  orchestration: "Orchestration",
  pending: "Pending invites",
  purchased: "Purchased",
  purchasedQty: "Purchased total",
  prorationNote: "Purchase is prorated by actual days in the billing cycle.",
  renewal: "Renewal",
  saveCapacity: "Save capacity",
};

describe("SCR-pools cards", () => {
  it("matches the PoolGauge card state, mode, renewal, and organization link", () => {
    render(
      <PoolCards
        items={[
          {
            assigned: 7,
            contractRenewalOn: "2027-03-01",
            decisionEvidence: { type: "no_data" as const },
            effectiveFrom: "2026-08-01",
            free: 1,
            isLow: true,
            licenseTypeId: "license-1",
            licenseTypeName: "Enterprise",
            lowPoolFloor: 2,
            mode: "automated",
            pendingInvites: 2,
            purchased: 10,
            vendorAccountId: "account-1",
            vendorAccountName: "Central org",
            blockedRequests: [
              {
                businessDaysBlocked: 2,
                escalated: true,
                id: "request-1",
                requestNo: "REQ-1",
              },
            ],
          },
        ]}
        labels={labels}
        locale="en-US"
      />,
    );

    const card = screen.getByTestId("pool_card_account-1_license-1");
    expect(card.getAttribute("data-pool-state")).toBe("attention");
    expect(card.getAttribute("data-snapshot-key")).toBe("account-1:license-1");
    expect(card.getAttribute("class")).toContain("border-primary");
    expect(card.getAttribute("class")).not.toContain("border-border");
    expect(screen.getByText("Automated")).toBeTruthy();
    expect(screen.getByText("March 1, 2027")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Central org" }).getAttribute("href")).toBe(
      "/organizaciones/account-1",
    );
    expect(screen.getByText("Below minimum floor")).toBeTruthy();
    expect(screen.getByText("August 1, 2026")).toBeTruthy();
    expect(screen.getByText("REQ-1")).toBeTruthy();
    expect(screen.getByText("Escalated")).toBeTruthy();
    expect(screen.getByText("No usage data")).toBeTruthy();
    expect(screen.getByText(/prorated by actual days/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add capacity" })).toBeTruthy();
    expect(screen.getByLabelText("Purchased total")).toBeTruthy();
  });

  it("renders the specified empty state", () => {
    render(<PoolCards items={[]} labels={labels} locale="en-US" />);
    expect(screen.getByRole("status").textContent).toContain("No pool capacity");
    expect(screen.getByRole("status").textContent).toContain(
      "Capacity appears after the first effective record.",
    );
  });

  it("renders real reclaim evidence when the projection has usage and cost", () => {
    render(
      <PoolCards
        items={[{
          assigned: 1,
          blockedRequests: [{ businessDaysBlocked: 1, escalated: false, id: "request-2", requestNo: "REQ-2" }],
          contractRenewalOn: null,
          decisionEvidence: { type: "candidates", items: [{ assignmentId: "assignment-1", lastActiveOn: "2026-06-01", monthlyCostUsd: 42.5 }] },
          effectiveFrom: "2026-08-01",
          free: 0,
          isLow: true,
          licenseTypeId: "license-1",
          licenseTypeName: "Enterprise",
          lowPoolFloor: 1,
          mode: "automated",
          pendingInvites: 0,
          purchased: 1,
          vendorAccountId: "account-1",
          vendorAccountName: "Central org",
        }]}
        labels={labels}
        locale="en-US"
      />,
    );
    expect(screen.getByText("Reclaim candidates")).toBeTruthy();
    expect(screen.getByTestId("reclaim_candidates").textContent).toContain("June 1, 2026");
    expect(screen.getByTestId("reclaim_candidates").textContent).toContain("$42.50");
    expect(screen.queryByText("No usage data")).toBeNull();
  });

  it("renders healthy and oversubscribed boundaries distinctly", () => {
    const common = {
      assigned: 0,
      contractRenewalOn: null,
      blockedRequests: [],
      decisionEvidence: { type: "no_data" as const },
      effectiveFrom: "2026-08-01",
      licenseTypeName: "Enterprise",
      lowPoolFloor: 0,
      mode: "orchestration" as const,
      pendingInvites: 0,
      purchased: 0,
      vendorAccountName: "Boundary org",
    };
    render(
      <PoolCards
        items={[
          {
            ...common,
            free: 0,
            isLow: false,
            licenseTypeId: "healthy",
            vendorAccountId: "healthy-account",
          },
          {
            ...common,
            assigned: 1,
            free: -1,
            isLow: true,
            licenseTypeId: "negative",
            vendorAccountId: "negative-account",
          },
        ]}
        labels={labels}
        locale="en-US"
      />,
    );

    const healthy = screen.getByTestId("pool_card_healthy-account_healthy");
    const negative = screen.getByTestId("pool_card_negative-account_negative");
    expect(healthy.getAttribute("data-pool-state")).toBe("ok");
    expect(healthy.getAttribute("class")).toContain("border-border");
    expect(negative.getAttribute("data-pool-state")).toBe("discrepancy");
    expect(screen.getAllByText("Orchestration")).toHaveLength(2);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
