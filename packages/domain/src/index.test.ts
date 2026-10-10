import { expect, test } from "vitest";
import { evaluateInactivity, hasPositiveVendorActivity } from "./index";

const base = { evaluationDate: "2026-10-10", accountDataThrough: "2026-10-07", window: 30 as const };
  test("a last-synced activity day has zero inactive days", () => {
    expect(evaluateInactivity({ ...base, lastActivityDate: "2026-10-07" })).toEqual({
      dataThrough: "2026-10-07", lastActivityDate: "2026-10-07", daysInactive: 0, classification: "active",
    });
  });
  test("session, artifact and arbitrary metadata do not invent activity", () => {
    for (const counters of [null, [], "bad", { message_count: 1 }, { chat_metrics: { distinct_conversation_count: 1 } }, { claude_code_metrics: { core_metrics: { distinct_session_count: 1, artifacts_created_count: 1 } } }, { cowork_metrics: { distinct_session_count: 1, artifacts_created_count: 1 } }, { unknown: { chat_metrics: { message_count: 1 } } }]) expect(hasPositiveVendorActivity(counters)).toBe(false);
  });
test("public rule preserves unknown inactivity", () => {
  expect(evaluateInactivity({ ...base, lastActivityDate: null })).toMatchObject({ daysInactive: null, classification: "no_data" });
  expect(hasPositiveVendorActivity({ cowork_metrics: { file_edit_count: 1 } })).toBe(true);
});
