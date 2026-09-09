#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WorkReadinessError,
  actualsCorrectionSchemaErrors,
  computeReadinessPayloadSha256,
  validateCompletionActuals,
} from "./work-readiness/model.mjs";

const root = resolve(process.argv[2] || ".");
const path = `${root}/.nous-feedback.jsonl`;
function loadFeedbackSchema() {
  const schemaPath = new URL("../docs/dev-guide/feedback-vocabulary.json", import.meta.url);
  const emitted = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (!emitted.canonical || !emitted.event_schemas?.actuals_corrected) {
    throw new Error(`cannot load emitted canonical feedback vocabulary from ${schemaPath.pathname}`);
  }
  const terminal = Object.entries(emitted.canonical)
    .filter(([event, category]) => event !== "started" && ["lifecycle", "terminal_alias"].includes(category))
    .map(([event]) => event);
  return {
    events: new Set([...Object.keys(emitted.canonical), ...(emitted.deprecated ?? [])]),
    terminalEvents: new Set(terminal),
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
    if (record.event === "checkpoint" && (!Number.isInteger(record.elapsed_minutes) || typeof record.status !== "string" || typeof record.implementation_complete !== "boolean" || typeof record.evidence !== "string")) throw new Error("checkpoint requires elapsed_minutes, status, implementation_complete, and evidence");
    if (record.event === "decision" && (typeof record.id !== "string" || typeof record.text !== "string" || typeof record.reason !== "string")) throw new Error("decision requires id, text, and reason");
    if (record.event === "feedback" && (typeof record.title !== "string" || typeof record.description !== "string" || !Array.isArray(record.images))) throw new Error("feedback requires title, description, and images");
    if (record.event === "nav_gap" && typeof record.route !== "string") throw new Error("nav_gap requires route");
    if (record.event === "actuals_corrected") {
      const schemaErrors = actualsCorrectionSchemaErrors(record, `.nous-feedback.jsonl:${index + 1}`);
      if (schemaErrors.length > 0) throw new Error(schemaErrors.join("; "));
    }
    records.push({ record, line: index + 1 });
  } catch (error) {
    fail(index + 1, error instanceof Error ? error.message : String(error));
  }
}

const correctionEntries = records.filter(({ record }) => record.event === "actuals_corrected");
const approvedReadinessAuthorities = new Map();
for (const changeId of new Set(correctionEntries.map(({ record }) => record.change))) {
  const readinessPath = `${root}/docs/readiness/${changeId}.json`;
  if (!existsSync(readinessPath)) continue;
  try {
    const authority = JSON.parse(readFileSync(readinessPath, "utf8"));
    if (authority.work_id === changeId
      && authority.approval?.status === "approved"
      && authority.approval.payload_sha256 === authority.readiness_payload_sha256
      && computeReadinessPayloadSha256(authority) === authority.readiness_payload_sha256) {
      approvedReadinessAuthorities.set(changeId, {
        digest: authority.readiness_payload_sha256,
        evidence: authority.approval.evidence,
        approvedBy: authority.approval.approved_by,
      });
    }
  } catch {
    // The target correction validation below reports the missing authority.
  }
}
const correctionRefCounts = new Map();
for (const { record } of correctionEntries) {
  correctionRefCounts.set(record.ref, (correctionRefCounts.get(record.ref) ?? 0) + 1);
}
for (const { record, line } of correctionEntries) {
  if (correctionRefCounts.get(record.ref) !== 1) {
    fail(line, `actuals correction ref ${record.ref} is not globally unique`);
  }
}

for (const story of new Set(correctionEntries.map(({ record }) => record.story))) {
  const firstLine = correctionEntries.find(({ record }) => record.story === story).line;
  const readinessPath = `${root}/docs/readiness/${story}.json`;
  if (!existsSync(readinessPath)) {
    fail(firstLine, `actuals correction requires docs/readiness/${story}.json`);
    continue;
  }
  try {
    const assessment = JSON.parse(readFileSync(readinessPath, "utf8"));
    validateCompletionActuals(assessment, records.map(({ record }) => record), { approvedReadinessAuthorities });
  } catch (error) {
    const message = error instanceof WorkReadinessError
      ? `${error.code}: ${error.message}`
      : error instanceof Error ? error.message : String(error);
    fail(firstLine, `actuals correction rejected: ${message}`);
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
  } else if (record.event === "decision") {
    // FEEDBACK.md's canonical vocabulary lists "Decision (registered)" as its
    // own category, separate from "Lifecycle (flip story status)". A signed
    // approval is required BEFORE work begins (WORK_READINESS.md:112-114), so
    // it necessarily precedes `started` -- and a partition record like
    // CHG-023 is never started at all. Ordering it after `started` would make
    // the readiness gate and this checker mutually unsatisfiable.
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
