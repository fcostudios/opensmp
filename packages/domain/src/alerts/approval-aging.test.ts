import { describe, expect, it } from "vitest";

import {
  APPROVAL_AGING_THRESHOLD,
  evaluateApprovalAging,
  type ApprovalAgingStage,
} from "./approval-aging.js";

const calendar = {
  holidays: new Set(["2026-08-10"]),
};
const pendingSince = new Date("2026-08-07T15:00:00.000Z");

function evaluateAt(
  at: string,
  emittedStages: readonly ApprovalAgingStage[] = [],
  threshold = {
    escalationBusinessHours: 48,
    reminderBusinessHours: 24,
  },
) {
  return evaluateApprovalAging({
    calendar,
    clock: { now: () => new Date(at) },
    emittedStages: new Set(emittedStages),
    pendingSince,
    threshold,
  });
}

describe("US-017 approval aging thresholds", () => {
  it("emits the reminder on the first run at 24 Ecuador business hours", () => {
    expect(APPROVAL_AGING_THRESHOLD).toEqual({
      escalationBusinessHours: 48,
      reminderBusinessHours: 24,
    });
    expect(evaluateAt("2026-08-11T14:59:59.999Z")).toEqual([]);
    expect(evaluateAt("2026-08-11T15:00:00.000Z")).toEqual(["reminder"]);
  });

  it("emits the escalation on the first run at 48 business hours", () => {
    expect(
      evaluateAt("2026-08-12T14:59:59.999Z", ["reminder"]),
    ).toEqual([]);
    expect(
      evaluateAt("2026-08-12T15:00:00.000Z", ["reminder"]),
    ).toEqual(["escalation"]);
  });

  it("uses the runtime rule threshold instead of the default literal", () => {
    const threshold = {
      escalationBusinessHours: 30,
      reminderBusinessHours: 12,
    };
    expect(evaluateAt("2026-08-08T03:00:00.000Z", [], threshold)).toEqual([
      "reminder",
    ]);
    expect(evaluateAt("2026-08-11T21:00:00.000Z", [], threshold)).toEqual([
      "reminder",
      "escalation",
    ]);
  });

  it("emits neither stage again after both persisted breaches exist", () => {
    expect(
      evaluateAt("2026-08-13T15:00:00.000Z", [
        "reminder",
        "escalation",
      ]),
    ).toEqual([]);
  });

  it("emits both overdue stages when the first evaluation happens after 48 hours", () => {
    expect(evaluateAt("2026-08-12T15:00:00.000Z")).toEqual([
      "reminder",
      "escalation",
    ]);
  });

  it.each([
    {
      clock: { now: () => new Date("invalid") },
      pendingSince,
    },
    {
      clock: { now: () => new Date("2026-08-11T15:00:00.000Z") },
      pendingSince: new Date("invalid"),
    },
  ])("rejects each invalid approval-aging date", (input) => {
    expect(() =>
      evaluateApprovalAging({
        calendar,
        emittedStages: new Set(),
        threshold: APPROVAL_AGING_THRESHOLD,
        ...input,
      }),
    ).toThrow("approval aging dates must be valid");
  });
});
