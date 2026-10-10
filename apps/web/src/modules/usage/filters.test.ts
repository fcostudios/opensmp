import { expect, test } from "vitest";
import { parseUsageFilters, serializeUsageFilters } from "./filters";

const companyId = "00000000-0000-4000-8000-000000007201";
test("preserves company and selected window while omitting absent filters", () => {
  expect(parseUsageFilters({})).toEqual({ window: 30 });
  expect(parseUsageFilters({ companyId: "", window: "60" })).toEqual({ window: 60 });
  expect(parseUsageFilters({ companyId, window: "90", cursor: "opaque" })).toEqual({ companyId, window: 90, cursor: "opaque" });
  expect(serializeUsageFilters({ window: 60 })).toEqual({ window: "60" });
  const selected = { companyId, window: 90 as const, cursor: "opaque" };
  expect(parseUsageFilters(serializeUsageFilters(selected))).toEqual(selected);
});
test("rejects malformed or duplicated filters instead of broadening selection", () => {
  for (const input of [{ window: "31" }, { window: "" }, { window: "030" }, { window: ["30", "60"] }, { window: ["30"] }, { companyId: "not-a-uuid" }, { companyId: [companyId] }, { cursor: ["a", "b"] }, { cursor: "" }]) {
    expect(() => parseUsageFilters(input)).toThrowError(expect.objectContaining({ code: "invalid_filter" }));
  }
});

test("limits opaque cursor size without rejecting a complete bounded cursor", () => {
  expect(parseUsageFilters({ cursor: "a".repeat(2048) }).cursor).toHaveLength(2048);
  expect(() => parseUsageFilters({ cursor: "a".repeat(2049) })).toThrowError(expect.objectContaining({ code: "invalid_filter" }));
});
