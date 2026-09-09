import { describe, expect, it } from "vitest";

import { failedInviteLabels, retryErrorMessageKey } from "./retry-labels";

describe("US-065 retry label composition", () => {
  it("maps only known retry feedback and every failed-invite label", () => {
    expect(retryErrorMessageKey("conflict")).toBe("retryConflict");
    expect(retryErrorMessageKey("invalid")).toBe("retryInvalid");
    expect(retryErrorMessageKey(undefined)).toBeNull();
    expect(retryErrorMessageKey("forged")).toBeNull();
    expect(failedInviteLabels((key) => `translated:${key}`)).toEqual({
      kindInvite: "translated:exceptionInvite",
      modeAutomated: "translated:exceptionAutomated",
      retryingProvisioning: "translated:retryingProvisioning",
    });
  });
});
