import { expect, test } from "vitest";
import { normalizeActivityCounters } from "./contracts.js";

// Faults: missing metric groups/tool families, dropped supported fields, invented
// zeros, copying provider-only secrets or mutating the caller's provider body.
test("activity counters retain supported paths and discard unknown provider fields", () => {
  const expected = {
    chat_metrics: {
      connectors_used_count: 0, distinct_artifacts_created_count: 1,
      distinct_connectors_used_count: 2, distinct_conversation_count: 3,
      distinct_files_uploaded_count: 4, distinct_projects_created_count: 5,
      distinct_projects_used_count: 6, distinct_shared_artifacts_viewed_count: 7,
      distinct_skills_used_count: 8, message_count: 9,
      shared_conversations_viewed_count: 10, thinking_message_count: 11,
    },
    claude_code_metrics: {
      core_metrics: { artifacts_created_count: 12, commit_count: 13,
        distinct_session_count: 14, pull_request_count: 15,
        lines_of_code: { added_count: 16, removed_count: 17 } },
      tool_actions: {
        edit_tool: { accepted_count: 18, rejected_count: 19 },
        multi_edit_tool: { accepted_count: 20, rejected_count: 21 },
        notebook_edit_tool: { accepted_count: 22, rejected_count: 23 },
        write_tool: { accepted_count: 24, rejected_count: 25 },
      },
    },
    cowork_metrics: {
      action_count: 26, artifacts_created_count: 27, connectors_used_count: 28,
      dispatch_turn_count: 29, distinct_connectors_used_count: 30,
      distinct_session_count: 31, distinct_skills_used_count: 32, message_count: 33,
      skills_used_count: 34, distinct_plugins_used_count: 35, edit_tool_count: 36,
      file_edit_count: 37, multi_edit_tool_count: 38, notebook_edit_tool_count: 39,
      plugins_used_count: 40, sessions_with_file_edits_count: 41, write_tool_count: 42,
    },
  };
  const input = structuredClone(expected);
  // Unknown data can itself be non-JSON, cyclic or a throwing getter: it must
  // not be visited by reconstruction, let alone persisted by the consumer.
  function injectUnknown(object: object) {
    for (const value of Object.values(object)) if (value && typeof value === "object") injectUnknown(value);
    Object.defineProperty(object, "provider_secret", { enumerable: true, get() { throw new Error("secret was inspected"); } });
  }
  injectUnknown(input);
  expect(normalizeActivityCounters(input)).toEqual(expected);
  expect(normalizeActivityCounters(expected)).toEqual(expected);
});

// Fault: nullable groups/counts become zero, missing paths appear, rejecting
// null-prototype JSON objects instead of accepting their own supported keys.
test("activity counters preserve unknown values without manufacturing absent metrics", () => {
  expect(normalizeActivityCounters({chat_metrics:null,claude_code_metrics:{core_metrics:{commit_count:null,lines_of_code:null},tool_actions:{edit_tool:null,write_tool:{accepted_count:null}}},cowork_metrics:{message_count:null}})).toEqual({chat_metrics:null,claude_code_metrics:{core_metrics:{commit_count:null,lines_of_code:null},tool_actions:{edit_tool:null,write_tool:{accepted_count:null}}},cowork_metrics:{message_count:null}});
  expect(normalizeActivityCounters({})).toEqual({});
  const input = Object.create(null);
  input.chat_metrics = Object.assign(Object.create(null), {message_count:0});
  expect(normalizeActivityCounters(input)).toEqual({chat_metrics:{message_count:0}});
});

// Fault: wrong structural guard or coercion permits nonobjects/arrays/class
// instances, nonfinite/fractional/negative counts, or unsupported value types.
test("activity counters reject malformed known paths without coercing counts", () => {
  const disguisedArray=Object.setPrototypeOf([],Object.prototype);
  const disguisedFunction=Object.setPrototypeOf(()=>undefined,Object.prototype);
  for (const input of [disguisedArray,disguisedFunction,null, undefined, "metrics", 4, true, [], new Date("2026-10-03T00:00:00Z"), {chat_metrics:[]}, {chat_metrics:"bad"}, {claude_code_metrics:{core_metrics:{lines_of_code:[]}}}, {claude_code_metrics:{tool_actions:{write_tool:4}}}]) {
    expect(()=>normalizeActivityCounters(input)).toThrow();
  }
  for (const count of [-1, 0.5, NaN, Infinity, -Infinity, "2", true, undefined, {}, []]) {
    expect(()=>normalizeActivityCounters({chat_metrics:{message_count:count}})).toThrow();
  }
});
