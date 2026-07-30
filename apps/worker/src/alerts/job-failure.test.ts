import { describe, expect, it } from "vitest";

import {
  classifyJobFailure,
  createFailureTimeBucket,
  operationalAlertErrorCode,
} from "./report-job-failure.js";

describe("US-046 job failure classification", () => {
  it("routes credential failures to the credential_failure alert path", () => {
    for (const code of [
      "AUTH_FAILED",
      "CREDENTIAL_FAILURE",
      "INVALID_CREDENTIALS",
      "UNAUTHORIZED",
    ]) {
      expect(classifyJobFailure({ code })).toBe("credential_failure");
    }
  });

  it("routes a timed-out sync to the sync_stale alert path", () => {
    for (const code of ["ETIMEDOUT", "SYNC_STALE", "TIMEOUT"]) {
      expect(classifyJobFailure({ code })).toBe("sync_stale");
    }
  });

  it("does not misclassify an arbitrary implementation error as an operational alert", () => {
    expect(classifyJobFailure(new Error("programmer fault"))).toBeNull();
    expect(classifyJobFailure({ code: 401 })).toBeNull();
    expect(classifyJobFailure(null)).toBeNull();
  });

  it("makes invalid operational alert scope visible in the runtime error code", () => {
    expect(operationalAlertErrorCode("AUTH_FAILED", { status: "invalid_scope" })).toBe(
      "AUTH_FAILED_alert_invalid_scope",
    );
    expect(operationalAlertErrorCode("AUTH_FAILED", { status: "no_matching_rule" })).toBe(
      "AUTH_FAILED_alert_rule_not_found",
    );
    expect(operationalAlertErrorCode("AUTH_FAILED", { status: "created" })).toBe(
      "AUTH_FAILED",
    );
    expect(operationalAlertErrorCode("AUTH_FAILED", { status: "deduplicated" })).toBe(
      "AUTH_FAILED",
    );
  });

  it("rejects invalid occurrence dates when constructing the dedupe bucket", () => {
    expect(() => createFailureTimeBucket(new Date(Number.NaN))).toThrow(
      "occurredAt must be a valid date",
    );
    expect(createFailureTimeBucket(new Date("2026-07-25T14:14:59.999Z"))).toBe(
      "2026-07-25T14:00:00.000Z",
    );
  });
});
