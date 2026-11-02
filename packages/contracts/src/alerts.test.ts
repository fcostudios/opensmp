import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertRuleContractSchema,
  alertSubjectForTypeSchema,
  approvalAgingThresholdSchema,
  inviteUnacceptedThresholdSchema,
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


describe("US-069 invitation expiry contract", () => {
  it("normalizes legacy and null expiry to disabled and rejects invalid windows", () => {
    for (const threshold of [{ hours: 24 }, { hours: 24, auto_withdraw_after_hours: null }]) {
      expect(inviteUnacceptedThresholdSchema.parse(threshold)).toEqual({ hours: 24, auto_withdraw_after_hours: null });
      expect(alertRuleContractSchema.parse({ enabled: true, type: "invite_unaccepted", threshold }).threshold).toEqual({ hours: 24, auto_withdraw_after_hours: null });
    }
    expect(inviteUnacceptedThresholdSchema.parse({ hours: 24.5, auto_withdraw_after_hours: 25 }).auto_withdraw_after_hours).toBe(25);
    for (const threshold of [
      { hours: -1 }, { hours: Infinity }, {},
      ...[0, -1, 24, 23, 24.5, Infinity, NaN, "48"].map(value => ({ hours: 24, auto_withdraw_after_hours: value })),
      { hours: 24, auto_withdraw_after_hours: 48, extra: 1 },
    ]) {
      expect(inviteUnacceptedThresholdSchema.safeParse(threshold).success).toBe(false);
      expect(alertRuleContractSchema.safeParse({ enabled: true, type: "invite_unaccepted", threshold }).success).toBe(false);
    }
    expect(alertRuleContractSchema.safeParse({ enabled: true, type: "low_pool", threshold: { floor: null } }).success).toBe(false);
    expect(alertRuleContractSchema.parse({ enabled: true, type: "low_pool", threshold: { floor: 2 } }).threshold).toEqual({ floor: 2 });
  });
});


describe("US-069 public validation issues", () => {
  it("reports invitation window errors and targets the editable rule threshold", () => {
    const threshold = { hours: 24, auto_withdraw_after_hours: 24 };
    const window = inviteUnacceptedThresholdSchema.safeParse(threshold);
    expect(window.success).toBe(false);
    if (window.success) throw new Error("expected window rejection");
    expect(window.error.issues).toEqual([{ code: "custom", message: "invite_unaccepted requires finite hours and a null or integer expiry greater than hours", path: [] }]);
    const rule = alertRuleContractSchema.safeParse({ enabled: true, type: "invite_unaccepted", threshold });
    expect(rule.success).toBe(false);
    if (rule.success) throw new Error("expected rule rejection");
    expect(rule.error.issues).toEqual([{ code: "custom", message: "invite_unaccepted requires valid invitation expiry threshold", path: ["threshold"] }]);
    const numeric = alertRuleContractSchema.safeParse({ enabled: true, type: "low_pool", threshold: { floor: null } });
    expect(numeric.success).toBe(false);
    if (numeric.success) throw new Error("expected numeric threshold rejection");
    expect(numeric.error.issues).toEqual([{ code: "custom", message: "alert threshold values must be nonnegative finite numbers", path: ["threshold"] }]);
  });
});


describe("US-092 new drift subjects and historical reads", () => {
  let schemas: typeof import("./alerts.js");
  beforeEach(async () => {
    vi.resetModules();
    schemas = await import("./alerts.js");
  });
  const canonical = { drift_episode_id: "episode-1", vendor_account_id: "account-1" };

  it("accepts only canonical new drift identity through both event boundaries", () => {
    expect(schemas.alertSubjectForTypeSchema.parse({ type: "register_drift", subject: canonical }))
      .toEqual({ type: "register_drift", subject: canonical });
    expect(schemas.alertEvaluationSchema.parse({ type: "register_drift", subjectRef: canonical, dedupeKey: "drift-1" }))
      .toEqual({ type: "register_drift", subjectRef: canonical, dedupeKey: "drift-1" });
  });

  it.each([
    { reconciliationId: "recon-1" },
    { drift_episode_id: "episode-1", vendor_account_id: "account-1", reconciliationId: "recon-1" },
    { drift_episode_id: "episode-1" },
    { vendor_account_id: "account-1" },
    { drift_episode_id: "", vendor_account_id: "account-1" },
    { drift_episode_id: "episode-1", vendor_account_id: "" },
    { drift_episode_id: 1, vendor_account_id: "account-1" },
    { drift_episode_id: "episode-1", vendor_account_id: null },
    { drift_episode_id: "episode-1", vendor_account_id: "account-1", extra: "unexpected" },
    { requestId: "request-1" },
  ])("refuses a noncanonical new drift subject %j", (subject) => {
    expect(schemas.alertSubjectForTypeSchema.safeParse({ type: "register_drift", subject }).success).toBe(false);
    expect(schemas.alertEvaluationSchema.safeParse({ type: "register_drift", subjectRef: subject, dedupeKey: "drift-1" }).success).toBe(false);
  });

  it.each(["approval_aging", "low_pool", "credential_failure", "close_missed"])(
    "refuses canonical drift identity paired with %s", (type) => {
      expect(schemas.alertSubjectForTypeSchema.safeParse({ type, subject: canonical }).success).toBe(false);
      expect(schemas.alertEvaluationSchema.safeParse({ type, subjectRef: canonical, dedupeKey: "wrong-type" }).success).toBe(false);
      expect(schemas.alertSubjectForReadTypeSchema.safeParse({ type, subject: canonical }).success).toBe(false);
    },
  );

  it("reports rejected new-event identity at the exact public issue path", () => {
    const result = schemas.alertEvaluationSchema.safeParse({
      dedupeKey: "historical-is-not-new",
      type: "register_drift",
      subjectRef: { reconciliationId: "recon-1" },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected new-event identity rejection");
    expect(result.error.issues).toEqual([{
      code: "custom",
      message: "subject does not match alert type",
      path: ["subjectRef"],
    }]);
  });

  it("preserves strict historical read parsing without opening the write boundary", () => {
    const historical = { reconciliationId: "recon-1" };
    expect(schemas.alertSubjectRefSchema.parse(historical)).toEqual(historical);
    expect(schemas.alertSubjectRefSchema.parse(canonical)).toEqual(canonical);
    for (const subject of [historical, canonical]) {
      expect(schemas.alertSubjectForReadTypeSchema.parse({ type: "register_drift", subject }))
        .toEqual({ type: "register_drift", subject });
    }
    for (const subject of [
      { reconciliationId: "" },
      { reconciliationId: 1 },
      { reconciliationId: "recon-1", extra: "unexpected" },
      { ...canonical, reconciliationId: "recon-1" },
      { requestId: "request-1" },
      null,
    ]) {
      expect(schemas.alertSubjectForReadTypeSchema.safeParse({ type: "register_drift", subject }).success).toBe(false);
    }
  });
});

it("accepts scheduled-close period failures without weakening request failures or cross-type identities",()=>{
  for(const subject of [{period:"2026-12"},{requestId:"request-051"}]) {
    expect(alertSubjectForTypeSchema.parse({type:"provisioning_failure",subject})).toEqual({type:"provisioning_failure",subject});
  }
  for(const subject of [{period:"2026-13"},{period:"2026-12",requestId:"request-051"},{vendorAccountId:"wrong"}]) {
    expect(alertSubjectForTypeSchema.safeParse({type:"provisioning_failure",subject}).success).toBe(false);
  }
});
