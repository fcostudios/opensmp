#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const node = process.execPath;
const failures = [];

function run(name, records, expectedExit) {
  const root = mkdtempSync(join(tmpdir(), "smp-feedback-order-"));
  try {
    writeFileSync(join(root, ".nous-feedback.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    const result = spawnSync(node, [join(repo, "scripts", "check-nous-feedback-order.mjs"), root], { encoding: "utf8" });
    if (result.status !== expectedExit) failures.push(`${name}: expected exit ${expectedExit}, got ${result.status}: ${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

run("later valid story", [
  { story: "US-001", event: "started", agent: "test", ts: "2026-07-24T08:00:00.000Z" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "test", pass: true, notes: "ok", ts: "2026-07-24T08:01:00.000Z" },
  { story: "US-001", event: "build_pass", notes: "ok", ts: "2026-07-24T08:02:00.000Z" },
  { story: "US-001", event: "done", ts: "2026-07-24T08:03:00.000Z" },
  { story: "US-002", event: "started", agent: "test", ts: "2026-07-24T08:04:00.000Z" },
], 0);
// CHG-029: a signed approval is required BEFORE work begins, so `decision`
// necessarily precedes `started`; a partition record is never started at all.
run("decision before started is allowed", [
  { story: "CHG-100", event: "decision", id: "CHG100-READY", text: `Decision ready for readiness payload SHA-256 ${"a".repeat(64)}.`, reason: "Approved assessment", ts: "2026-07-24T08:00:00.000Z" },
  { story: "CHG-100", event: "started", agent: "test", ts: "2026-07-24T08:01:00.000Z" },
  { story: "CHG-100", event: "build_pass", notes: "ok", ts: "2026-07-24T08:02:00.000Z" },
  { story: "CHG-100", event: "done", ts: "2026-07-24T08:03:00.000Z" },
], 0);
run("decision with no started at all is allowed (partition record)", [
  { story: "CHG-101", event: "decision", id: "CHG101-PARTITION", text: `Decision partition_required for readiness payload SHA-256 ${"b".repeat(64)}.`, reason: "Approved assessment", ts: "2026-07-24T08:00:00.000Z" },
], 0);
// RED fixture: the exemption must stay narrow. A real progress event before
// `started` must still fail; if this ever exits 0 the guard has been lost.
run("non-decision event before started still fails", [
  { story: "US-900", event: "ac_pass", ac: 1, notes: "ok", ts: "2026-07-24T08:00:00.000Z" },
  { story: "US-900", event: "started", agent: "test", ts: "2026-07-24T08:01:00.000Z" },
], 1);
run("out of order timestamps", [
  { story: "US-001", event: "started", agent: "test", ts: "2026-07-24T08:01:00.000Z" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "test", pass: true, notes: "ok", ts: "2026-07-24T08:00:00.000Z" },
], 1);
run("invalid lifecycle", [
  { story: "US-001", event: "done", ts: "2026-07-24T08:00:00.000Z" },
], 1);

run("all canonical feedback categories", [
  { story: "US-001", event: "started", agent: "test" },
  { story: "US-001", event: "ac_pass", ac: 1, notes: "ok" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "test", pass: true, notes: "ok" },
  { story: "US-001", event: "blocked", reason: "dependency", needs: "decision" },
  { story: "US-001", event: "blocker", reason: "dependency" },
  { story: "US-001", event: "deviation", notes: "ok" },
  { story: "US-001", event: "ac_fail", notes: "ok" },
  { story: "US-001", event: "ac_unverifiable", notes: "ok" },
  { story: "US-001", event: "test_report" },
  { story: "US-001", event: "feedback", title: "title", description: "description", images: [] },
  { story: "US-001", event: "nav_gap", route: "/missing" },
  { story: "US-001", event: "decision", id: "DEC-001", text: "text", reason: "reason" },
  { story: "US-001", event: "closed_with_deferrals" },
  { story: "US-001", event: "adversarial_review" },
  { story: "US-001", event: "deferred_memory_saved" },
  { story: "US-001", event: "closure_hygiene" },
  { story: "US-001", event: "implemented_with_external_verification" },
  { story: "US-001", event: "build_pass", notes: "ok" },
  { story: "US-001", event: "done" },
], 0);

for (const terminal of ["done", "verified", "done_with_deferral", "done_with_external_deferral"]) {
  run(`${terminal} requires build_pass`, [
    { story: "US-001", event: "started", agent: "test" },
    { story: "US-001", event: terminal },
  ], 1);
  run(`${terminal} accepts prior build_pass`, [
    { story: "US-001", event: "started", agent: "test" },
    { story: "US-001", event: "build_pass", notes: "ok" },
    { story: "US-001", event: terminal },
  ], 0);
}

const priorEvidence = [
  { story: "US-001", event: "started", agent: "test" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "old", pass: true, notes: "old" },
  { story: "US-001", event: "build_pass", notes: "old build" },
  { story: "US-001", event: "done" },
  { story: "CHG-007", event: "started", agent: "test" },
  { story: "CHG-007", event: "decision", id: "CHG007-TEST", text: "repair", reason: "review" },
];
const supersededBuild = {
  story: "US-001",
  event: "evidence_superseded",
  ref: "US001-BUILD-1",
  target: { story: "US-001", event: "build_pass" },
  reason: "post-change gates required",
};
const supersededDone = {
  story: "US-001",
  event: "evidence_superseded",
  ref: "US001-DONE-1",
  target: { story: "US-001", event: "done" },
  reason: "post-change terminal evidence required",
};
run("append-only supersession projects one post-change evidence chain", [
  ...priorEvidence,
  supersededBuild,
  supersededDone,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-DONE-1",
    change: "CHG-007",
    as_event: "done",
  },
], 0);
run("a later change can supersede prior projected revalidation evidence", [
  ...priorEvidence,
  supersededBuild,
  supersededDone,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "first repaired head",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-DONE-1",
    change: "CHG-007",
    as_event: "done",
  },
  { story: "CHG-008", event: "started", agent: "test" },
  { story: "CHG-008", event: "decision", id: "CHG008-TEST", text: "repair again", reason: "review" },
  {
    story: "US-001",
    event: "evidence_superseded",
    ref: "US001-BUILD-2",
    target: { ref: "US001-BUILD-1" },
    reason: "new head gates required",
  },
  {
    story: "US-001",
    event: "evidence_superseded",
    ref: "US001-DONE-2",
    target: { ref: "US001-DONE-1" },
    reason: "new terminal evidence required",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-2",
    change: "CHG-008",
    as_event: "build_pass",
    notes: "second repaired head",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-DONE-2",
    change: "CHG-008",
    as_event: "done",
  },
], 0);
run("supersession rejects a missing target", [
  ...priorEvidence,
  {
    ...supersededBuild,
    target: { story: "US-999", event: "build_pass" },
  },
], 1);
run("supersession rejects an ambiguous target", [
  ...priorEvidence.slice(0, 3),
  { story: "US-001", event: "build_pass", notes: "second build" },
  ...priorEvidence.slice(3),
  supersededBuild,
], 1);
run("supersession requires a later revalidation", [
  ...priorEvidence,
  supersededBuild,
], 1);
run("revalidation requires a prior unique supersession reference", [
  ...priorEvidence,
  {
    story: "US-001",
    event: "revalidated",
    ref: "MISSING",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
], 1);
run("revalidation rejects a duplicate reference", [
  ...priorEvidence,
  supersededBuild,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "duplicate",
  },
], 1);
run("revalidation requires an earlier change decision", [
  ...priorEvidence.slice(0, 4),
  supersededBuild,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
  ...priorEvidence.slice(4),
], 1);

if (failures.length) {
  for (const failure of failures) console.error(`[feedback-order test] ${failure}`);
  process.exit(1);
}
console.log("[feedback-order test] ok");
