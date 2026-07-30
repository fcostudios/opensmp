import { describe, expect, test } from "vitest";

import { parseApprovalTimestamp } from "./timestamp";

describe("approval timestamp boundary", () => {
  test("normalizes the PostgreSQL wire timestamp to its exact instant", () => {
    const timestamp = parseApprovalTimestamp("2026-07-24 15:00:00+00");

    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.toISOString()).toBe("2026-07-24T15:00:00.000Z");
  });

  test.each([
    ["malformed timestamp", "not-a-timestamp"],
    ["empty timestamp", ""],
    ["invalid Date", new Date(Number.NaN)],
  ])("fails closed for a %s", (_case, value) => {
    expect(() => parseApprovalTimestamp(value)).toThrow(
      "APPROVAL_TIMESTAMP_INVALID",
    );
  });
});
