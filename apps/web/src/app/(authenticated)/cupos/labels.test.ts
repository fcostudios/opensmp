import { describe, expect, it } from "vitest";

import { createPoolCardsLabels } from "./labels";

describe("US-023 pools label composition", () => {
  it("passes every localized label without changing its key", () => {
    const labels = createPoolCardsLabels((key) => `translated:${key}`);

    expect(labels).toEqual({
      addCapacity: "translated:addCapacity",
      assigned: "translated:assigned",
      attention: "translated:attention",
      automated: "translated:automated",
      available: "translated:available",
      candidateTitle: "translated:candidateTitle",
      discrepancy: "translated:discrepancy",
      effectiveFrom: "translated:effectiveFrom",
      effectiveFromField: "translated:effectiveFromField",
      emptyDescription: "translated:emptyDescription",
      emptyTitle: "translated:emptyTitle",
      escalated: "translated:escalated",
      floor: "translated:floor",
      lastActive: "translated:lastActive",
      mode: "translated:mode",
      monthlyCost: "translated:monthlyCost",
      note: "translated:note",
      noUsageData: "translated:noUsageData",
      orchestration: "translated:orchestration",
      pending: "translated:pending",
      prorationNote: "translated:prorationNote",
      purchased: "translated:purchased",
      purchasedQty: "translated:purchasedQty",
      renewal: "translated:renewal",
      saveCapacity: "translated:saveCapacity",
    });
  });
});
