import { describe, expect, it } from "vitest";

import {
  alertRuleContractSchema,
  approvalAgingThresholdSchema,
} from "./alerts.js";

describe("US-024 deprovision alert contract", () => {
  it("requires the canonical zero-business-day deadline and rejects the legacy hours shape", () => {
    expect(
      alertRuleContractSchema.safeParse({
        enabled: true,
        threshold: { businessDays: 0 },
        type: "deprovision_overdue",
      }).success,
    ).toBe(true);
    expect(
      alertRuleContractSchema.safeParse({
        enabled: true,
        threshold: { hours: 24 },
        type: "deprovision_overdue",
      }).success,
    ).toBe(false);
    expect(
      alertRuleContractSchema.safeParse({
        enabled: true,
        threshold: { businessDays: 1 },
        type: "deprovision_overdue",
      }).success,
    ).toBe(false);
    expect(
      alertRuleContractSchema.safeParse({
        enabled: true,
        threshold: { businessDays: 0, hours: 24 },
        type: "deprovision_overdue",
      }).success,
    ).toBe(false);
    expect(
      alertRuleContractSchema.safeParse({
        enabled: true,
        threshold: { escalationHours: 48, hours: 24 },
        type: "approval_aging",
      }).success,
    ).toBe(true);
  });
});

describe("US-017 approval-aging alert contract", () => {
  it("accepts only an ordered hours and escalationHours threshold", () => {
    expect(
      approvalAgingThresholdSchema.parse({
        escalationHours: 36,
        hours: 12,
      }),
    ).toEqual({ escalationHours: 36, hours: 12 });
    const unordered = approvalAgingThresholdSchema.safeParse({
      escalationHours: 12,
      hours: 24,
    });
    expect(unordered.success).toBe(false);
    if (unordered.success) throw new Error("expected threshold rejection");
    expect(unordered.error.issues).toMatchObject([
      {
        message:
          "approval_aging escalationHours must be greater than hours",
        path: [],
      },
    ]);

    expect(
      alertRuleContractSchema.safeParse({
        enabled: true,
        threshold: { escalationHours: 36, hours: 12 },
        type: "approval_aging",
      }).success,
    ).toBe(true);

    for (const threshold of [
      { hours: 24 },
      { escalationHours: 48 },
      { escalationHours: 24, hours: 24 },
      { escalationHours: 12, hours: 24 },
      { escalationHours: 48, hours: 24, minutes: 5 },
    ]) {
      expect(
        alertRuleContractSchema.safeParse({
          enabled: true,
          threshold,
          type: "approval_aging",
        }).success,
      ).toBe(false);
    }

    const missingEscalation = alertRuleContractSchema.safeParse({
      enabled: true,
      threshold: { hours: 24 },
      type: "approval_aging",
    });
    expect(missingEscalation.success).toBe(false);
    if (missingEscalation.success) throw new Error("expected rule rejection");
    expect(missingEscalation.error.issues).toContainEqual({
      code: "custom",
      message:
        "approval_aging requires ordered threshold.hours and threshold.escalationHours",
      path: ["threshold"],
    });
    expect(
      alertRuleContractSchema.safeParse({
        threshold: { escalationHours: 48, hours: 24 },
        type: "approval_aging",
      }).success,
    ).toBe(false);
  });
});
