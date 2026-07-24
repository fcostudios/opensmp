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

if (failures.length) {
  for (const failure of failures) console.error(`[feedback-order test] ${failure}`);
  process.exit(1);
}
console.log("[feedback-order test] ok");
