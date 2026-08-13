import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";

import { CACHE_SCHEMA_VERSION } from "./cache.mjs";

export const PERFORMANCE_SCHEMA_VERSION = 1;

const state = new WeakMap();
const decisions = new Set(["executed", "reused", "rejected"]);
const unsafeKeyPattern = /(?:^environment$|database.?url|password|token|authorization|credential|secret|api.?key|^__proto__$|^prototype$|^constructor$)/i;
const unsafeValuePattern = /(?:\b[a-z][a-z\d+.-]*:\/\/|\b(?:basic|bearer)\s+)/i;

function monotonicNow(clock) {
  const value = clock();
  if (!Number.isFinite(value)) throw new TypeError("Monotonic clock must return a finite number");
  return value;
}

function utcLabel() {
  return new Date().toISOString();
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value, name) {
  return value === undefined ? undefined : requiredString(value, name);
}

function finiteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function sanitizeStringMap(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [requiredString(key, `${name} key`), requiredString(entry, `${name}.${key}`)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeMachine(machine = {}) {
  const cpuCount = os.cpus().length;
  const normalized = {
    os: machine.os ?? `${os.type()} ${os.release()}`,
    arch: machine.arch ?? os.arch(),
    logicalCpuCount: machine.logicalCpuCount ?? cpuCount,
    memoryBytes: machine.memoryBytes ?? os.totalmem(),
    toolVersions: machine.toolVersions ?? { node: process.versions.node },
  };
  requiredString(normalized.os, "machine.os");
  requiredString(normalized.arch, "machine.arch");
  if (!Number.isInteger(normalized.logicalCpuCount) || normalized.logicalCpuCount <= 0) {
    throw new TypeError("machine.logicalCpuCount must be a positive integer");
  }
  finiteNonnegative(normalized.memoryBytes, "machine.memoryBytes");
  normalized.toolVersions = sanitizeStringMap(normalized.toolVersions, "machine.toolVersions");
  return normalized;
}

function normalizeProvenance(provenance) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new TypeError("provenance must be an object");
  }
  const normalized = {
    campaignKey: requiredString(provenance.campaignKey, "provenance.campaignKey"),
  };
  for (const key of ["head", "base", "baseRef"]) {
    const value = optionalString(provenance[key], `provenance.${key}`);
    if (value !== undefined) normalized[key] = value;
  }
  return normalized;
}

function runState(run) {
  const current = state.get(run);
  if (!current) throw new TypeError("Unknown performance run");
  return current;
}

function assertSafeRecord(value) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Unsafe performance record");
    return;
  }
  if (typeof value === "string") {
    if (unsafeValuePattern.test(value)) throw new Error("Unsafe performance record");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeRecord(item);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Unsafe performance record");
  }
  for (const [key, nested] of Object.entries(value)) {
    if (unsafeKeyPattern.test(key)) throw new Error("Unsafe performance record");
    assertSafeRecord(nested);
  }
}

function totals(shards) {
  const result = {
    shardCount: shards.length,
    executedCount: 0,
    reusedCount: 0,
    rejectedCount: 0,
    hitRatio: 0,
    estimatedMsSaved: 0,
  };
  for (const shard of shards) {
    if (shard.decision === "executed") result.executedCount += 1;
    if (shard.decision === "reused") {
      result.reusedCount += 1;
      result.estimatedMsSaved += shard.priorDurationMs ?? 0;
    }
    if (shard.decision === "rejected") result.rejectedCount += 1;
  }
  result.hitRatio = result.shardCount === 0 ? 0 : result.reusedCount / result.shardCount;
  return result;
}

export function createPerformanceRun({ provenance, cacheMode, machine, now = performance.now.bind(performance) }) {
  const started = monotonicNow(now);
  const run = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    runId: randomUUID(),
    startedAt: utcLabel(),
    provenance: normalizeProvenance(provenance),
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    cacheMode: requiredString(cacheMode, "cacheMode"),
    machine: normalizeMachine(machine),
    shards: [],
    totals: totals([]),
    outcome: "incomplete",
  };
  state.set(run, { now, started, active: new Map(), finished: false });
  return run;
}

export function startShard(run, shard, now) {
  const current = runState(run);
  if (current.finished) throw new Error("Performance run is already finished");
  const clock = now ?? current.now;
  const token = randomUUID();
  const record = {
    id: requiredString(shard?.id, "shard.id"),
    evidenceKey: requiredString(shard?.evidenceKey, "shard.evidenceKey"),
    classification: requiredString(shard?.classification, "shard.classification"),
    status: "started",
  };
  run.shards.push(record);
  current.active.set(token, { record, started: monotonicNow(clock) });
  run.totals = totals(run.shards);
  return token;
}

export function finishShard(run, token, decision, details = {}, now) {
  const current = runState(run);
  const active = current.active.get(token);
  if (!active) throw new Error("Unknown or already finished shard token");
  if (!decisions.has(decision)) throw new TypeError("Invalid shard decision");
  const durationMs = monotonicNow(now ?? current.now) - active.started;
  finiteNonnegative(durationMs, "shard duration");
  const record = active.record;
  delete record.status;
  record.decision = decision;
  record.durationMs = durationMs;
  const priorDurationMs = details.priorDurationMs;
  if (priorDurationMs !== undefined) {
    record.priorDurationMs = finiteNonnegative(priorDurationMs, "details.priorDurationMs");
  }
  for (const key of ["rejectionReason", "result"]) {
    const value = optionalString(details[key], `details.${key}`);
    if (value !== undefined) record[key] = value;
  }
  current.active.delete(token);
  run.totals = totals(run.shards);
  return record;
}

export function finishPerformanceRun(run, outcome, now) {
  const current = runState(run);
  if (current.finished) throw new Error("Performance run is already finished");
  if (current.active.size !== 0) throw new Error("Cannot finish a run with active shards");
  const durationMs = monotonicNow(now ?? current.now) - current.started;
  finiteNonnegative(durationMs, "run duration");
  run.wallClockDurationMs = durationMs;
  run.orchestrationDurationMs = durationMs;
  run.totals = totals(run.shards);
  run.outcome = requiredString(outcome, "outcome");
  run.finishedAt = utcLabel();
  current.finished = true;
  return run;
}

export function writePerformanceRecord(root, run) {
  requiredString(root, "root");
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new TypeError("run must be an object");
  assertSafeRecord(run);
  const directory = path.join(root, "reports", "mutation-performance");
  mkdirSync(directory, { recursive: true });
  const runId = requiredString(run.runId, "run.runId");
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new TypeError("run.runId is unsafe");
  const destination = path.join(directory, `${runId}.json`);
  const temporary = path.join(directory, `.${runId}.${randomUUID()}.temporary`);
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, destination);
  return destination;
}

function comparison(cold, warm) {
  const reasons = [];
  if (!isDeepStrictEqual(cold.machine, warm.machine)) reasons.push("different machine profiles");
  if (cold.provenance?.campaignKey !== warm.provenance?.campaignKey) {
    reasons.push("different campaign keys");
  }
  return reasons;
}

function display(value) {
  return String(value);
}

export function renderBenchmarkSummary(cold, warm, { allowIncomparable = false } = {}) {
  const reasons = comparison(cold, warm);
  if (reasons.length > 0 && !allowIncomparable) {
    throw new Error(`Benchmark records are incomparable: ${reasons.join(" and ")}`);
  }
  const comparable = reasons.length === 0;
  const measuredSavings = comparable
    ? finiteNonnegative(cold.wallClockDurationMs, "cold.wallClockDurationMs")
      - finiteNonnegative(warm.wallClockDurationMs, "warm.wallClockDurationMs")
    : "incomparable";
  return [
    "# Mutation cache benchmark",
    "",
    `Comparable: ${comparable ? "yes" : `no (${reasons.join("; ")})`}`,
    "",
    "| Metric | Cold | Warm |",
    "| --- | ---: | ---: |",
    `| Cold wall-clock (ms) | ${display(cold.wallClockDurationMs)} | — |`,
    `| Warm wall-clock (ms) | ${display(warm.wallClockDurationMs)} | — |`,
    `| Measured wall-clock savings (ms) | ${display(measuredSavings)} | — |`,
    `| Estimated cache savings (ms) | ${display(cold.totals.estimatedMsSaved)} | ${display(warm.totals.estimatedMsSaved)} |`,
    `| Executed shards | ${display(cold.totals.executedCount)} | ${display(warm.totals.executedCount)} |`,
    `| Reused shards | ${display(cold.totals.reusedCount)} | ${display(warm.totals.reusedCount)} |`,
    `| Rejected cache entries | ${display(cold.totals.rejectedCount)} | ${display(warm.totals.rejectedCount)} |`,
    `| Hit ratio | ${display(cold.totals.hitRatio)} | ${display(warm.totals.hitRatio)} |`,
    `| Campaign outcome | ${cold.outcome} | ${warm.outcome} |`,
    "",
    "> Measured wall-clock savings are the cold-minus-warm elapsed durations. Estimated cache savings sum prior recorded durations for reused shards and are not wall-clock measurements.",
    "",
  ].join("\n");
}

function runCli(argv) {
  const allowIncomparable = argv[0] === "--allow-incomparable";
  const paths = allowIncomparable ? argv.slice(1) : argv;
  if (paths.length !== 2) {
    process.stderr.write("Expected exactly two JSON record paths: cold and warm\n");
    process.exitCode = 2;
    return;
  }
  try {
    const [cold, warm] = paths.map((recordPath) => JSON.parse(readFileSync(recordPath, "utf8")));
    process.stdout.write(renderBenchmarkSummary(cold, warm, { allowIncomparable }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli(process.argv.slice(2));
}
