import { describe, expect, it } from "vitest";

import { alertSubjectDestination, evaluateAlertRule } from "./evaluate.js";

const at = new Date("2026-07-27T15:00:00.000Z");
const poolSubject = { licenseTypeId: "lt-1", vendorAccountId: "va-1" };

describe("US-042 deterministic alert evaluation", () => {
  it.each([
    ["approval_aging", { requestId: "request 1" }, "/solicitudes/request%201"],
    ["provisioning_failure", { requestId: "request-2" }, "/solicitudes/request-2"],
    ["blocked_no_seat", { requestId: "request-3" }, "/solicitudes/request-3"],
    ["invite_unaccepted", { requestId: "request-4" }, "/solicitudes/request-4"],
    ["deprovision_overdue", { requestId: "request-5" }, "/solicitudes/request-5"],
    [
      "low_pool",
      { licenseTypeId: "type-1", vendorAccountId: "vendor-1" },
      "/cupos?vendorAccountId=vendor-1&licenseTypeId=type-1",
    ],
    ["sync_stale", { vendorAccountId: "vendor-2" }, "/credenciales"],
    ["credential_failure", { vendorAccountId: "vendor-3" }, "/credenciales"],
    ["register_drift", { reconciliationId: "recon-1" }, "/excepciones"],
    ["close_missed", { period: "2026-06" }, "/cierre?period=2026-06"],
  ] as const)("links %s to its exact Ledger destination", (type, subject, destination) => {
    expect(alertSubjectDestination(type, subject)).toBe(destination);
  });

  it("emits an exact low-pool event when the configured floor is breached", () => {
    expect(
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 2 }, type: "low_pool" },
        { free: 1, subject: poolSubject },
        at,
      ),
    ).toEqual({
      dedupeKey: "low_pool:lt-1:va-1:2026-07-27T15:00:00.000Z",
      subjectRef: poolSubject,
      type: "low_pool",
    });
  });

  it("does not emit at the boundary, above the boundary, or when disabled", () => {
    expect(
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 2 }, type: "low_pool" },
        { free: 2, subject: poolSubject },
        at,
      ),
    ).toBeNull();
    expect(
      evaluateAlertRule(
        { enabled: false, threshold: { floor: 2 }, type: "low_pool" },
        { free: 1, subject: poolSubject },
        at,
      ),
    ).toBeNull();
  });

  it("uses the per-organization floor before the rule default and stays strict at equality", () => {
    const rule = {
      enabled: true,
      threshold: { floor: 5 },
      type: "low_pool" as const,
    };
    expect(
      evaluateAlertRule(
        rule,
        { free: 8, lowPoolFloor: 9, subject: poolSubject },
        at,
      ),
    ).toMatchObject({ type: "low_pool" });
    expect(
      evaluateAlertRule(
        rule,
        { free: 9, lowPoolFloor: 9, subject: poolSubject },
        at,
      ),
    ).toBeNull();
  });

  it("is referentially deterministic for identical inputs", () => {
    const rule = {
      enabled: true,
      threshold: { floor: 2 },
      type: "low_pool" as const,
    };
    const facts = { free: 1, subject: poolSubject };

    expect(evaluateAlertRule(rule, facts, at)).toEqual(
      evaluateAlertRule(rule, facts, new Date(at)),
    );
  });

  it.each([
    ["approval_aging", { ageHours: 25 }, { hours: 24 }, { requestId: "approval_aging-subject" }],
    ["provisioning_failure", { failed: true }, { failures: 1 }, { requestId: "provisioning_failure-subject" }],
    ["blocked_no_seat", { businessDaysElapsed: 2 }, { businessDays: 1 }, { requestId: "blocked_no_seat-subject" }],
    ["invite_unaccepted", { ageHours: 169 }, { hours: 168 }, { requestId: "invite_unaccepted-subject" }],
    ["sync_stale", { ageHours: 49 }, { hours: 48 }, { vendorAccountId: "sync_stale-subject" }],
    ["credential_failure", { failed: true }, { failures: 1 }, { vendorAccountId: "credential_failure-subject" }],
    ["register_drift", { drifted: true }, { mismatches: 1 }, { reconciliationId: "register_drift-subject" }],
    ["deprovision_overdue", { deadlineExceeded: true }, { businessDays: 0 }, { requestId: "deprovision_overdue-subject" }],
    ["close_missed", { businessDaysElapsed: 4 }, { businessDays: 3 }, { period: "2026-06" }],
  ] as const)("evaluates %s with the canonical threshold measure", (type, measure, threshold, subject) => {
    expect(
      evaluateAlertRule(
        { enabled: true, threshold, type },
        { ...measure, subject },
        at,
      ),
    ).toEqual({
      dedupeKey: `${type}:${Object.values(subject)[0]}:2026-07-27T15:00:00.000Z`,
      subjectRef: subject,
      type,
    });
  });

  it.each([
    ["low_pool", { requestId: "wrong" }],
    ["approval_aging", { vendorAccountId: "wrong" }],
    ["credential_failure", { credentialId: "wrong" }],
    ["register_drift", { requestId: "wrong" }],
    ["close_missed", { closeRunId: "wrong" }],
  ] as const)("rejects a mismatched %s link identity", (type, subject) => {
    const cases = {
      approval_aging: [{ ageHours: 25 }, { hours: 24 }],
      close_missed: [{ businessDaysElapsed: 4 }, { businessDays: 3 }],
      credential_failure: [{ failed: true }, { failures: 1 }],
      low_pool: [{ free: 1 }, { floor: 5 }],
      register_drift: [{ drifted: true }, { mismatches: 1 }],
    } as const;
    const [measure, threshold] = cases[type];
    expect(() =>
      evaluateAlertRule(
        { enabled: true, threshold, type },
        { ...measure, subject } as never,
        at,
      ),
    ).toThrow(`subject does not match alert type ${type}`);
  });

  it("rejects invalid clocks and mismatched subject identities", () => {
    expect(() =>
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 2 }, type: "low_pool" },
        { free: 1, subject: {} } as never,
        at,
      ),
    ).toThrow("subject does not match alert type low_pool");
    expect(() =>
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 2 }, type: "low_pool" },
        { free: 1, subject: poolSubject },
        new Date(Number.NaN),
      ),
    ).toThrow("evaluatedAt must be a valid date");
  });

  it("rejects missing and non-finite canonical thresholds", () => {
    expect(() =>
      evaluateAlertRule(
        { enabled: true, threshold: {}, type: "low_pool" },
        { free: 1, subject: poolSubject },
        at,
      ),
    ).toThrow("low_pool threshold.floor must be finite");
    expect(() =>
      evaluateAlertRule(
        {
          enabled: true,
          threshold: { floor: Number.NaN },
          type: "low_pool",
        },
        { free: 1, subject: poolSubject },
        at,
      ),
    ).toThrow("low_pool threshold.floor must be finite");
    expect(() =>
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 5 }, type: "low_pool" },
        {
          free: 1,
          lowPoolFloor: Number.NaN,
          subject: poolSubject,
        },
        at,
      ),
    ).toThrow("low_pool lowPoolFloor must be finite");
    expect(() =>
      evaluateAlertRule(
        {
          enabled: true,
          threshold: {},
          type: "approval_aging",
        },
        {
          ageHours: 2,
          lowPoolFloor: 9,
          subject: { requestId: "request-1" },
        },
        at,
      ),
    ).toThrow("approval_aging threshold.hours must be finite");
  });

  it("does not turn invalid measures into low-pool or age breaches", () => {
    const vendorSubject = poolSubject;
    expect(
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 2 }, type: "low_pool" },
        { free: Number.NaN, subject: vendorSubject },
        at,
      ),
    ).toBeNull();
    expect(
      evaluateAlertRule(
        { enabled: true, threshold: { floor: 2 }, type: "low_pool" },
        { free: "1" as unknown as number, subject: vendorSubject },
        at,
      ),
    ).toBeNull();
    for (const ageHours of [24, 23, Number.NaN]) {
      expect(
        evaluateAlertRule(
          {
            enabled: true,
            threshold: { hours: 24 },
            type: "approval_aging",
          },
          { ageHours, subject: { requestId: "request-1" } },
          at,
        ),
      ).toBeNull();
    }
    expect(
      evaluateAlertRule(
        {
          enabled: true,
          threshold: { hours: 24 },
          type: "approval_aging",
        },
        { ageHours: "25" as unknown as number, subject: { requestId: "request-1" } },
        at,
      ),
    ).toBeNull();
  });

  it("requires both a true boolean measure and a firing threshold", () => {
    const subject = { requestId: "request-1" };
    expect(
      evaluateAlertRule(
        {
          enabled: true,
          threshold: { failures: 1 },
          type: "provisioning_failure",
        },
        { failed: false, subject },
        at,
      ),
    ).toBeNull();
    expect(
      evaluateAlertRule(
        {
          enabled: true,
          threshold: { failures: 2 },
          type: "provisioning_failure",
        },
        { failed: true, subject },
        at,
      ),
    ).toBeNull();
  });

  it("does not fire the same-business-day deprovision alert before its deadline", () => {
    expect(
      evaluateAlertRule(
        {
          enabled: true,
          threshold: { businessDays: 0 },
          type: "deprovision_overdue",
        },
        {
          deadlineExceeded: false,
          subject: { requestId: "request-1" },
        } as never,
        at,
      ),
    ).toBeNull();
    expect(
      evaluateAlertRule(
        {
          enabled: true,
          threshold: { businessDays: 1 },
          type: "deprovision_overdue",
        },
        {
          deadlineExceeded: true,
          subject: { requestId: "request-1" },
        } as never,
        at,
      ),
    ).toBeNull();
  });
});
