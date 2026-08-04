import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlockedRequestsTable } from "./blocked-requests-table";

const labels = {
  addCapacity: "Add capacity",
  company: "Company",
  daysBlocked: "Days blocked",
  empty: "No blocked requests.",
  effectiveFrom: "Effective date",
  escalated: "Escalated",
  lastActive: "Last active",
  monthlyCost: "Monthly cost",
  neededBy: "Needed by",
  noDate: "Not available",
  noUsageData: "No usage data",
  organization: "Organization",
  purchasedQty: "Purchased total",
  prorationNote: "Purchase is prorated by actual days.",
  reclaimCandidates: "Reclaim candidates",
  request: "Request",
  status: "Status",
  statusBlocked: "Blocked without a seat",
  saveCapacity: "Save capacity",
  viewPools: "View pools",
};

describe("BlockedRequestsTable", () => {
  it("renders the complete TOON contract from real request projection fields", () => {
    const html = renderToStaticMarkup(
      <BlockedRequestsTable
        items={[
          {
            companyName: "Company A",
            daysBlocked: 4,
            decisionEvidence: { type: "no_data" },
            escalated: true,
            id: "00000000-0000-4000-8000-000000000001",
            licenseTypeId: "00000000-0000-4000-8000-000000000002",
            licenseTypeName: "Enterprise",
            neededBy: "2026-08-05",
            personName: "Ana",
            requestNo: "REQ-1",
            vendorAccountName: "Vendor A",
            vendorAccountId: "00000000-0000-4000-8000-000000000003",
          },
        ]}
        labels={labels}
        locale="en-US"
      />,
    );

    for (const id of [
      "table_blocked",
      "solicitud",
      "compania",
      "organizacion",
      "dias_bloqueada",
      "needed_by",
      "estado",
      "btn_ver_cupos",
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html).toContain('href="/cupos"');
    expect(html).toContain(">4<");
    expect(html).toContain("Aug 5, 2026");
    expect(html).toContain("Blocked without a seat");
    expect(html).toContain("Escalated");
    expect(html).toContain("No usage data");
    expect(html).toContain("prorated by actual days");
    expect(html).toContain("Add capacity");
    expect(html).toContain('action="');
  });

  it("uses the localized honest placeholder when needed-by is unavailable", () => {
    const html = renderToStaticMarkup(
      <BlockedRequestsTable
        items={[
          {
            companyName: "Company A",
            daysBlocked: 0,
            decisionEvidence: { type: "no_data" },
            escalated: false,
            id: "00000000-0000-4000-8000-000000000001",
            licenseTypeId: "00000000-0000-4000-8000-000000000002",
            licenseTypeName: "Enterprise",
            neededBy: null,
            personName: "Ana",
            requestNo: "REQ-1",
            vendorAccountName: "Vendor A",
            vendorAccountId: "00000000-0000-4000-8000-000000000003",
          },
        ]}
        labels={labels}
        locale="en-US"
      />,
    );

    expect(html).toContain("Not available");
  });

  it("renders every reclaim candidate with localized activity and USD cost evidence", () => {
    const html = renderToStaticMarkup(
      <BlockedRequestsTable
        items={[
          {
            companyName: "Company A",
            daysBlocked: 2,
            decisionEvidence: {
              items: [
                {
                  assignmentId: "00000000-0000-4000-8000-000000000011",
                  lastActiveOn: "2026-08-01",
                  monthlyCostUsd: 25.5,
                },
                {
                  assignmentId: "00000000-0000-4000-8000-000000000012",
                  lastActiveOn: "2026-07-15",
                  monthlyCostUsd: 10,
                },
              ],
              type: "candidates",
            },
            escalated: false,
            id: "00000000-0000-4000-8000-000000000001",
            licenseTypeId: "00000000-0000-4000-8000-000000000002",
            licenseTypeName: "Enterprise",
            neededBy: "2026-08-05",
            personName: "Ana",
            requestNo: "REQ-1",
            vendorAccountName: "Vendor A",
            vendorAccountId: "00000000-0000-4000-8000-000000000003",
          },
        ]}
        labels={labels}
        locale="en-US"
      />,
    );

    expect(html).toContain("Reclaim candidates");
    expect(html).toContain("Last active: Aug 1, 2026");
    expect(html).toContain("Last active: Jul 15, 2026");
    expect(html).toContain("Monthly cost: $25.50");
    expect(html).toContain("Monthly cost: $10.00");
    expect((html.match(/<li/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain("No usage data");
  });
});
