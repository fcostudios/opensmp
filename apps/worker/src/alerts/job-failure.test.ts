import { describe, expect, it } from "vitest";

import { classifyJobFailure } from "./report-job-failure.js";

describe("US-046 job failure classification", () => {
  it("routes credential failures to the credential_failure alert path", () => {
    expect(classifyJobFailure(Object.assign(new Error("401 from vendor"), { code: "AUTH_FAILED" }))).toBe(
      "credential_failure",
    );
  });

  it("routes a timed-out sync to the sync_stale alert path", () => {
    expect(classifyJobFailure(Object.assign(new Error("connector timeout"), { code: "ETIMEDOUT" }))).toBe("sync_stale");
  });

  it("does not misclassify an arbitrary implementation error as an operational alert", () => {
    expect(classifyJobFailure(new Error("programmer fault"))).toBeNull();
  });
});
