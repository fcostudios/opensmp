import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { evaluateInactivity, hasPositiveVendorActivity, type InactivityWindow } from "./inactivity";

const base = { evaluationDate: "2026-10-10", accountDataThrough: "2026-10-07", window: 30 as InactivityWindow };
const day = (age: number) => new Date(Date.parse("2026-10-07T00:00:00Z") - age * 86400000).toISOString().slice(0, 10);

describe("lag-aware inactivity", () => {
  test("a last-synced activity day has zero inactive days", () => {
    expect(evaluateInactivity({ ...base, lastActivityDate: "2026-10-07" })).toEqual({
      dataThrough: "2026-10-07", lastActivityDate: "2026-10-07", daysInactive: 0, classification: "active",
    });
  });
  test.each([30, 60, 90] as const)("qualifies strictly beyond %i days", window => {
    for (const [age, classification] of [[window - 1, "active"], [window, "active"], [window + 1, "inactive"]] as const) {
      expect(evaluateInactivity({ ...base, window, lastActivityDate: day(age) })).toMatchObject({ daysInactive: age, classification });
    }
  });
  test("uses three UTC days of fallback and never assigns an age to no data", () => {
    expect(evaluateInactivity({ ...base, accountDataThrough: null, lastActivityDate: null })).toEqual({
      dataThrough: "2026-10-07", lastActivityDate: null, daysInactive: null, classification: "no_data",
    });
    expect(evaluateInactivity({ ...base, evaluationDate: "2026-03-01", accountDataThrough: null, lastActivityDate: "2026-02-26" })).toMatchObject({ dataThrough: "2026-02-26", daysInactive: 0 });
    expect(evaluateInactivity({ ...base, lastActivityDate: null })).toMatchObject({ daysInactive: null, classification: "no_data" });
  });
  test.each(["2026-02-30", "2026-13-01", "2026-1-01", "garbage", "2026-10-10T00:00:00Z"])("rejects invalid date %s in every input", date => {
    expect(() => evaluateInactivity({ ...base, evaluationDate: date, lastActivityDate: null })).toThrow();
    expect(() => evaluateInactivity({ ...base, accountDataThrough: date, lastActivityDate: null })).toThrow();
    expect(() => evaluateInactivity({ ...base, lastActivityDate: date })).toThrow();
  });
  test("rejects unsupported windows and inconsistent positive history", () => {
    for (const window of [0, 29, 31, 120, NaN]) expect(() => evaluateInactivity({ ...base, window: window as InactivityWindow, lastActivityDate: null })).toThrow();
    expect(() => evaluateInactivity({ ...base, lastActivityDate: "2026-10-08" })).toThrow();
  });
  test("derives exact integer age for every generated UTC day", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 150 }), age => {
      const result = evaluateInactivity({ ...base, lastActivityDate: day(age) });
      expect(result.daysInactive).toBe(age);
      expect(result.classification).toBe(age > 30 ? "inactive" : "active");
    }), { seed: 72026 });
  });
  test("later evaluation does not age confirmed observations", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 150 }), fc.integer({ min: 0, max: 50 }), (age, lag) => {
      const evaluationDate = new Date(Date.parse("2026-10-10T00:00:00Z") + lag * 86400000).toISOString().slice(0, 10);
      expect(evaluateInactivity({ ...base, evaluationDate, lastActivityDate: day(age) })).toEqual(evaluateInactivity({ ...base, lastActivityDate: day(age) }));
    }), { seed: 72026 });
  });
  test("age is monotone and increasing the window cannot create inactivity", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 50 }), (age, added) => {
      const first = evaluateInactivity({ ...base, lastActivityDate: day(age) });
      const older = evaluateInactivity({ ...base, lastActivityDate: day(age + added) });
      expect(older.daysInactive).toBeGreaterThan(first.daysInactive!);
      if (first.classification === "inactive") expect(older.classification).toBe("inactive");
      const wider = evaluateInactivity({ ...base, window: 90, lastActivityDate: day(age) });
      if (first.classification === "active") expect(wider.classification).toBe("active");
    }), { seed: 72026 });
  });
});

const paths = [
  ["chat_metrics", "message_count"],
  ...["commit_count", "pull_request_count"].map(k => ["claude_code_metrics", "core_metrics", k]),
  ...["added_count", "removed_count"].map(k => ["claude_code_metrics", "core_metrics", "lines_of_code", k]),
  ...["edit_tool", "multi_edit_tool", "notebook_edit_tool", "write_tool"].flatMap(tool => ["accepted_count", "rejected_count"].map(k => ["claude_code_metrics", "tool_actions", tool, k])),
  ...["message_count", "action_count", "file_edit_count", "sessions_with_file_edits_count", "edit_tool_count", "multi_edit_tool_count", "notebook_edit_tool_count", "write_tool_count"].map(k => ["cowork_metrics", k]),
];
function countersAt(path: string[], value: unknown): unknown {
  return path.reduceRight<unknown>((nested, key) => ({ [key]: nested }), value);
}
describe("positive normalized vendor activity", () => {
  test.each(paths.map(path => [path.join("."), path] as const))("recognizes only positive integer %s", (_label, path) => {
    expect(hasPositiveVendorActivity(countersAt(path, 1))).toBe(true);
    for (const value of [0, null, undefined, -1, 0.5, Infinity, NaN, "1", true]) expect(hasPositiveVendorActivity(countersAt(path, value))).toBe(false);
  });
  test("session, artifact and arbitrary metadata do not invent activity", () => {
    for (const counters of [null, [], "bad", { message_count: 1 }, { chat_metrics: { distinct_conversation_count: 1 } }, { claude_code_metrics: { core_metrics: { distinct_session_count: 1, artifacts_created_count: 1 } } }, { cowork_metrics: { distinct_session_count: 1, artifacts_created_count: 1 } }, { unknown: { chat_metrics: { message_count: 1 } } }]) expect(hasPositiveVendorActivity(counters)).toBe(false);
  });
  test("ignores inherited or array-shaped metrics while retaining a known positive signal", () => {
    expect(hasPositiveVendorActivity(Object.create({ chat_metrics: { message_count: 1 } }))).toBe(false);
    expect(hasPositiveVendorActivity({ chat_metrics: Object.create({ message_count: 1 }) })).toBe(false);
    expect(hasPositiveVendorActivity({ chat_metrics: Object.assign([], { message_count: 1 }) })).toBe(false);
    expect(hasPositiveVendorActivity(Object.assign([], { chat_metrics: { message_count: 1 } }))).toBe(false);
    expect(hasPositiveVendorActivity({ chat_metrics: { message_count: 1 }, cowork_metrics: null })).toBe(true);
  });
});
