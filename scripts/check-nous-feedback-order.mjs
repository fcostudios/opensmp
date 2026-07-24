#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const path = `${root}/.nous-feedback.jsonl`;
const events = new Set(["started", "done", "verified", "done_with_deferral", "done_with_external_deferral", "ac_pass", "ac_verify", "blocked", "blocker", "deviation", "ac_fail", "ac_unverifiable", "test_report", "feedback", "nav_gap", "decision", "build_pass"]);
const records = [];
let failed = false;

function fail(line, message) {
  console.error(`[nous-feedback lifecycle] line ${line}: ${message}`);
  failed = true;
}

for (const [index, line] of readFileSync(path, "utf8").trimEnd().split("\n").entries()) {
  try {
    const record = JSON.parse(line);
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("must be a JSON object");
    if (typeof record.story !== "string" || !record.story) throw new Error("requires a non-empty story");
    if (typeof record.event !== "string" || !events.has(record.event)) throw new Error("requires a known event");
    if (record.ts !== undefined && (typeof record.ts !== "string" || Number.isNaN(Date.parse(record.ts)))) throw new Error("ts must be an ISO timestamp when supplied");
    if (record.event === "started" && (typeof record.agent !== "string" || !record.agent)) throw new Error("started requires agent");
    if (record.event === "ac_pass" && (!Number.isInteger(record.ac) || typeof record.notes !== "string")) throw new Error("ac_pass requires ac and notes");
    if (record.event === "ac_verify" && (!Number.isInteger(record.ac) || typeof record.method !== "string" || typeof record.pass !== "boolean" || typeof record.notes !== "string")) throw new Error("ac_verify requires ac, method, pass, and notes");
    if (record.event === "build_pass" && typeof record.notes !== "string") throw new Error("build_pass requires notes");
    if (["deviation", "ac_fail", "ac_unverifiable"].includes(record.event) && typeof record.notes !== "string") throw new Error(`${record.event} requires notes`);
    if (["blocked", "blocker"].includes(record.event) && typeof record.reason !== "string") throw new Error(`${record.event} requires reason`);
    if (record.event === "decision" && (typeof record.id !== "string" || typeof record.text !== "string" || typeof record.reason !== "string")) throw new Error("decision requires id, text, and reason");
    if (record.event === "feedback" && (typeof record.title !== "string" || typeof record.description !== "string" || !Array.isArray(record.images))) throw new Error("feedback requires title, description, and images");
    if (record.event === "nav_gap" && typeof record.route !== "string") throw new Error("nav_gap requires route");
    records.push(record);
  } catch (error) {
    fail(index + 1, error instanceof Error ? error.message : String(error));
  }
}

const stories = new Map();
let previousTimestamp = -Infinity;
for (const [index, record] of records.entries()) {
  const line = index + 1;
  if (record.ts !== undefined) {
    const timestamp = Date.parse(record.ts);
    if (timestamp < previousTimestamp) fail(line, "timestamp is earlier than a prior record");
    previousTimestamp = Math.max(previousTimestamp, timestamp);
  }
  const state = stories.get(record.story) || { started: false, buildPassed: false };
  if (record.event === "started") {
    if (state.started) fail(line, `story ${record.story} started more than once`);
    state.started = true;
  } else if (!state.started) {
    fail(line, `story ${record.story} event ${record.event} occurs before started`);
  } else if (record.event === "build_pass") {
    state.buildPassed = true;
  } else if (record.event === "done" && !state.buildPassed) {
    fail(line, `story ${record.story} done occurs before build_pass`);
  }
  stories.set(record.story, state);
}

if (failed) process.exit(1);
console.log("[nous-feedback lifecycle] ok");
