#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const path = `${root}/.nous-feedback.jsonl`;
function loadFeedbackSchema() {
  const schemaPath = new URL("../docs/dev-guide/FEEDBACK.md", import.meta.url);
  const source = readFileSync(schemaPath, "utf8");
  const canonical = source.slice(source.indexOf("## Canonical Event Vocabulary (authoritative)"));
  const categories = new Map();
  for (const match of canonical.matchAll(/^- \*\*([^*]+):\*\* (.+)$/gm)) {
    const events = [...match[2].matchAll(/`([^`]+)`/g)].map((event) => event[1]);
    if (events.length) categories.set(match[1], events);
  }
  const lifecycle = [...categories.entries()].find(([category]) => category.startsWith("Lifecycle"))?.[1];
  const deferrals = [...categories.entries()].find(([category]) => category.startsWith("Terminal-with-deferral"))?.[1];
  if (!lifecycle || !deferrals) throw new Error(`cannot load canonical feedback vocabulary from ${schemaPath.pathname}`);
  return {
    events: new Set([...categories.values()].flat()),
    terminalEvents: new Set([...lifecycle.filter((event) => event !== "started"), ...deferrals]),
  };
}
const { events, terminalEvents } = loadFeedbackSchema();
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
    records.push({ record, line: index + 1 });
  } catch (error) {
    fail(index + 1, error instanceof Error ? error.message : String(error));
  }
}

const targetEvents = new Set(["ac_verify", "build_pass", ...terminalEvents]);
const supersessions = new Map();
const supersededLines = new Set();
const projectedByLine = new Map();
const decisionLines = new Map();

function targetMatches(record, target) {
  if (record.story !== target.story || record.event !== target.event) return false;
  return target.event !== "ac_verify" || record.ac === target.ac;
}

for (const { record, line } of records) {
  if (record.event === "decision") {
    const lines = decisionLines.get(record.story) || [];
    lines.push(line);
    decisionLines.set(record.story, lines);
    continue;
  }
  if (record.event === "evidence_superseded") {
    const requestedTarget = record.target;
    const targetKeys = requestedTarget && typeof requestedTarget === "object" && !Array.isArray(requestedTarget)
      ? Object.keys(requestedTarget).sort()
      : [];
    const expectedKeys = requestedTarget?.event === "ac_verify"
      ? ["ac", "event", "story"]
      : ["event", "story"];
    const referenceTarget = targetKeys.join(",") === "ref"
      && typeof requestedTarget.ref === "string"
      && requestedTarget.ref;
    if (
      typeof record.ref !== "string" || !record.ref
      || typeof record.reason !== "string" || !record.reason
      || !requestedTarget || typeof requestedTarget !== "object" || Array.isArray(requestedTarget)
      || (
        !referenceTarget
        && (
          targetKeys.join(",") !== expectedKeys.join(",")
          || typeof requestedTarget.story !== "string" || !requestedTarget.story
          || typeof requestedTarget.event !== "string" || !targetEvents.has(requestedTarget.event)
          || (requestedTarget.event === "ac_verify" && !Number.isInteger(requestedTarget.ac))
        )
      )
    ) {
      fail(line, "evidence_superseded requires ref, reason, and one canonical target");
      continue;
    }
    if (supersessions.has(record.ref)) {
      fail(line, `supersession reference ${record.ref} is not unique`);
      continue;
    }
    let target;
    let targetRecord;
    let targetLine;
    if (referenceTarget) {
      const previous = supersessions.get(requestedTarget.ref);
      if (
        !previous
        || !previous.revalidated
        || !previous.revalidationLine
        || previous.revalidationLine >= line
      ) {
        fail(line, "supersession ref target must name one earlier revalidation");
        continue;
      }
      target = previous.target;
      targetRecord = projectedByLine.get(previous.revalidationLine);
      targetLine = previous.revalidationLine;
    } else {
      target = requestedTarget;
      const matches = records.filter(
        (entry) => entry.line < line && targetMatches(entry.record, target),
      );
      if (matches.length !== 1) {
        fail(line, `supersession target must match exactly one earlier event; found ${matches.length}`);
        continue;
      }
      targetRecord = matches[0].record;
      targetLine = matches[0].line;
    }
    if (record.story !== target.story) {
      fail(line, "supersession story must match its canonical target");
      continue;
    }
    if (supersededLines.has(targetLine)) {
      fail(line, "supersession target was already superseded");
      continue;
    }
    supersededLines.add(targetLine);
    supersessions.set(record.ref, {
      line,
      target,
      targetRecord,
      revalidated: false,
    });
    continue;
  }
  if (record.event === "revalidated") {
    if (
      typeof record.ref !== "string" || !record.ref
      || typeof record.change !== "string" || !record.change
      || typeof record.as_event !== "string"
    ) {
      fail(line, "revalidated requires ref, change, and as_event");
      continue;
    }
    const supersession = supersessions.get(record.ref);
    if (!supersession || supersession.line >= line) {
      fail(line, `revalidation reference ${record.ref} has no earlier unique supersession`);
      continue;
    }
    if (supersession.revalidated) {
      fail(line, `revalidation reference ${record.ref} is used more than once`);
      continue;
    }
    if (
      supersession.target.story !== record.story
      || supersession.target.event !== record.as_event
    ) {
      fail(line, "revalidation story and as_event must match the superseded target");
      continue;
    }
    const changeDecisions = decisionLines.get(record.change) || [];
    if (!changeDecisions.some((decisionLine) => decisionLine < supersession.line)) {
      fail(line, "revalidation requires a change decision before supersession");
      continue;
    }
    const projected = {
      ...supersession.targetRecord,
      story: record.story,
      event: record.as_event,
    };
    if (record.as_event === "ac_verify") {
      if (
        record.ac !== supersession.target.ac
        || typeof record.method !== "string"
        || typeof record.pass !== "boolean"
        || typeof record.notes !== "string"
      ) {
        fail(line, "AC revalidation requires matching ac, method, pass, and notes");
        continue;
      }
      Object.assign(projected, {
        ac: record.ac,
        method: record.method,
        pass: record.pass,
        notes: record.notes,
      });
    } else if (
      record.as_event === "build_pass"
      && typeof record.notes !== "string"
    ) {
      fail(line, "build_pass revalidation requires notes");
      continue;
    } else if (record.as_event === "build_pass") {
      projected.notes = record.notes;
    }
    supersession.revalidated = true;
    supersession.revalidationLine = line;
    projectedByLine.set(line, projected);
  }
}
for (const [ref, supersession] of supersessions) {
  if (!supersession.revalidated) {
    fail(supersession.line, `supersession reference ${ref} has no later revalidation`);
  }
}

const canonicalRecords = [];
for (const entry of records) {
  if (supersededLines.has(entry.line)) continue;
  if (!["evidence_superseded", "revalidated"].includes(entry.record.event)) {
    canonicalRecords.push(entry);
  }
  const projected = projectedByLine.get(entry.line);
  if (projected) canonicalRecords.push({ record: projected, line: entry.line });
}

const stories = new Map();
let previousTimestamp = -Infinity;
for (const { record, line } of canonicalRecords) {
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
  } else if (terminalEvents.has(record.event) && !state.buildPassed) {
    fail(line, `story ${record.story} ${record.event} occurs before build_pass`);
  }
  stories.set(record.story, state);
}

if (failed) process.exit(1);
console.log("[nous-feedback lifecycle] ok");
