import { describe, expect, test } from "vitest";

import {
  decisionSucceeded,
  retryTargetAfterDecision,
  settleDecision,
} from "./decision-settlement";

describe("approval decision settlement", () => {
  test("keeps the item retryable when the server rejects the decision", async () => {
    const result = await settleDecision(
      Promise.resolve({ ok: false, error: "forbidden" }),
    );

    expect(decisionSucceeded(result)).toBe(false);
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(retryTargetAfterDecision(result, "approved")).toBe("approved");
  });

  test("normalizes a thrown transport failure without leaking it", async () => {
    const result = await settleDecision(
      Promise.reject(new Error("private network detail")),
    );

    expect(decisionSucceeded(result)).toBe(false);
    expect(result).toEqual({ ok: false, error: "decision_failed" });
    expect(retryTargetAfterDecision(result, "rejected")).toBe("rejected");
  });

  test("removes the item only after a confirmed success", async () => {
    const result = await settleDecision(Promise.resolve({ ok: true }));

    expect(decisionSucceeded(result)).toBe(true);
    expect(retryTargetAfterDecision(result, "approved")).toBeNull();
  });
});
