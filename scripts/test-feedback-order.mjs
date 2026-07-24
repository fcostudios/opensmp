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

if (failures.length) {
  for (const failure of failures) console.error(`[feedback-order test] ${failure}`);
  process.exit(1);
}
console.log("[feedback-order test] ok");
