import { describe, expect, it } from "vitest";

import { dependencyNotDelivered, failedJob, successfulJob } from "./job-result.js";

describe("US-046 job outcomes", () => {
  it("makes an unavailable later-sprint handler visible as skipped rather than successful work", () => {
    expect(dependencyNotDelivered("US-026")).toEqual({
      processed: 0,
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-026",
    });
  });

  it("records meaningful processed work only as a success", () => {
    expect(successfulJob(3)).toEqual({ processed: 3, status: "succeeded" });
  });

  it("returns a structured alert-rule failure for the worker retry boundary", () => {
    expect(failedJob("rule-042", "SMTP_REJECTED", 2)).toEqual({
      alertRuleId: "rule-042",
      errorCode: "SMTP_REJECTED",
      processed: 2,
      status: "failed",
    });
  });
});
