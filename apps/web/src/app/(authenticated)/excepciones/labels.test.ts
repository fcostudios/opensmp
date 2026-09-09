import { describe, expect, it } from "vitest";

import {
  createBlockedRequestsLabels,
  toBlockedRequestItem,
} from "./labels";

describe("US-023 blocked-request composition", () => {
  it("passes every localized label without changing its key", () => {
    const labels = createBlockedRequestsLabels((key) => `translated:${key}`);

    expect(labels).toEqual({
      addCapacity: "translated:blocked.addCapacity",
      company: "translated:blocked.company",
      daysBlocked: "translated:blocked.daysBlocked",
      effectiveFrom: "translated:blocked.effectiveFrom",
      empty: "translated:blocked.empty",
      escalated: "translated:blocked.escalated",
      lastActive: "translated:blocked.lastActive",
      monthlyCost: "translated:blocked.monthlyCost",
      neededBy: "translated:blocked.neededBy",
      noDate: "translated:blocked.noDate",
      noUsageData: "translated:blocked.noUsageData",
      organization: "translated:blocked.organization",
      prorationNote: "translated:blocked.prorationNote",
      purchasedQty: "translated:blocked.purchasedQty",
      reclaimCandidates: "translated:blocked.reclaimCandidates",
      request: "translated:blocked.request",
      saveCapacity: "translated:blocked.saveCapacity",
      status: "translated:blocked.status",
      statusBlocked: "translated:blocked.statusBlocked",
      viewPools: "translated:blocked.viewPools",
    });
  });

  it("adapts the complete blocked-request projection for the table", () => {
    expect(toBlockedRequestItem({
      blockedAt: "2026-08-01T00:00:00.000Z",
      companyName: "Company A",
      daysBlocked: 3,
      decisionEvidence: { type: "no_data" },
      escalated: true,
      id: "00000000-0000-4000-8000-000000000001",
      licenseTypeId: "00000000-0000-4000-8000-000000000002",
      licenseTypeName: "Enterprise",
      neededBy: "2026-08-08",
      personName: "Ana",
      requestNo: "REQ-1",
      status: "blocked_no_seat",
      vendorAccountId: "00000000-0000-4000-8000-000000000003",
      vendorAccountName: "Vendor A",
    })).toEqual({
      companyName: "Company A",
      daysBlocked: 3,
      decisionEvidence: { type: "no_data" },
      escalated: true,
      id: "00000000-0000-4000-8000-000000000001",
      licenseTypeId: "00000000-0000-4000-8000-000000000002",
      licenseTypeName: "Enterprise",
      neededBy: "2026-08-08",
      personName: "Ana",
      requestNo: "REQ-1",
      vendorAccountId: "00000000-0000-4000-8000-000000000003",
      vendorAccountName: "Vendor A",
    });
  });
});
