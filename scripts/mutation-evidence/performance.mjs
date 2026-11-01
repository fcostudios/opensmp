import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";

import { CACHE_SCHEMA_VERSION } from "./cache.mjs";

export const PERFORMANCE_SCHEMA_VERSION = 1;

const state = new WeakMap();
const decisions = new Set(["executed", "reused", "rejected"]);
const finalClassifications = new Set(["scored", "verification-only"]);
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

const INVALID_PROVENANCE = "Invalid performance provenance";
const INVALID_CACHE_MODE = "Invalid cache mode";
const INVALID_MACHINE = "Invalid machine profile";
const INVALID_SHARD_COMPLETION = "Invalid shard completion";

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

function safeAdd(left, right) {
  const sum = left + right;
  if (!Number.isFinite(sum) || sum > Number.MAX_VALUE) {
    throw new Error("Invalid performance aggregate");
  }
  return sum;
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
  try {
    requiredString(normalized.os, "machine.os");
    requiredString(normalized.arch, "machine.arch");
    if (!Number.isInteger(normalized.logicalCpuCount) || normalized.logicalCpuCount <= 0) {
      throw new TypeError();
    }
    finiteNonnegative(normalized.memoryBytes, "machine.memoryBytes");
    normalized.toolVersions = sanitizeStringMap(normalized.toolVersions, "machine.toolVersions");
    if (Object.keys(normalized.toolVersions).length === 0) throw new TypeError();
    return normalized;
  } catch {
    throw new TypeError(INVALID_MACHINE);
  }
}

function normalizeProvenance(provenance) {
  try {
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) throw new TypeError();
    return {
      campaignKey: requiredString(provenance.campaignKey, "provenance.campaignKey"),
      head: requiredString(provenance.head, "provenance.head"),
      base: requiredString(provenance.base, "provenance.base"),
      baseRef: requiredString(provenance.baseRef, "provenance.baseRef"),
    };
  } catch {
    throw new TypeError(INVALID_PROVENANCE);
  }
}

function normalizeCacheMode(cacheMode) {
  if (cacheMode !== "enabled" && cacheMode !== "bypass") throw new TypeError(INVALID_CACHE_MODE);
  return cacheMode;
}

function wallLabel(wallNow) {
  const supplied = wallNow();
  const label = supplied instanceof Date ? supplied.toISOString() : supplied;
  if (typeof label !== "string" || !label.endsWith("Z")) {
    throw new TypeError("Wall clock must return a UTC timestamp");
  }
  const parsed = new Date(label);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== label) {
    throw new TypeError("Wall clock must return a UTC timestamp");
  }
  return label;
}

function normalizeCompletion(decision, details) {
  try {
    if (!decisions.has(decision) || !details || typeof details !== "object" || Array.isArray(details)) {
      throw new TypeError();
    }
    const allowedFields = decision === "executed"
      ? new Set(["classification", "result"])
      : decision === "reused"
        ? new Set(["classification", "result", "priorDurationMs"])
        : new Set(["classification", "result", "priorDurationMs", "rejectionReason"]);
    if (Object.keys(details).some((key) => !allowedFields.has(key))) throw new TypeError();
    const result = requiredString(details.result, "details.result");
    const hasRejection = details.rejectionReason !== undefined;
    if (decision === "executed" && (hasRejection || details.priorDurationMs !== undefined)) {
      throw new TypeError();
    }
    if (decision === "reused") {
      if (result !== "passed" || hasRejection || details.priorDurationMs === undefined) throw new TypeError();
      finiteNonnegative(details.priorDurationMs, "details.priorDurationMs");
    }
    if (decision === "rejected") {
      requiredString(details.rejectionReason, "details.rejectionReason");
      if (details.priorDurationMs !== undefined) {
        finiteNonnegative(details.priorDurationMs, "details.priorDurationMs");
      }
    }
    const classification = details.classification === undefined
      ? undefined
      : requiredString(details.classification, "details.classification");
    if (classification !== undefined && !finalClassifications.has(classification)) throw new TypeError();
    return { classification, result };
  } catch {
    throw new TypeError(INVALID_SHARD_COMPLETION);
  }
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
      result.estimatedMsSaved = safeAdd(result.estimatedMsSaved, shard.priorDurationMs ?? 0);
    }
    if (shard.decision === "rejected") result.rejectedCount += 1;
  }
  result.hitRatio = result.shardCount === 0 ? 0 : result.reusedCount / result.shardCount;
  return result;
}

function assertExactFields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Invalid performance record");
}

function validateUtcLabel(label) {
  if (typeof label !== "string" || !label.endsWith("Z")) throw new Error("Invalid performance record");
  const parsed = new Date(label);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== label) {
    throw new Error("Invalid performance record");
  }
}

function validateRecord(record, { allowIncomplete = false } = {}) {
  try {
    assertSafeRecord(record);
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error();
    const finished = record.outcome !== "incomplete";
    assertExactFields(record, new Set([
      "schemaVersion", "runId", "startedAt", "provenance", "cacheSchemaVersion", "cacheMode",
      "machine", "shards", "totals", "outcome",
      ...(finished ? ["wallClockDurationMs", "orchestrationDurationMs", "finishedAt"] : []),
    ]));
    if (record.schemaVersion !== PERFORMANCE_SCHEMA_VERSION
        || record.cacheSchemaVersion !== CACHE_SCHEMA_VERSION
        || !/^[A-Za-z0-9_-]+$/.test(record.runId)) throw new Error();
    validateUtcLabel(record.startedAt);
    if (!isDeepStrictEqual(normalizeProvenance(record.provenance), record.provenance)) throw new Error();
    normalizeCacheMode(record.cacheMode);
    if (!isDeepStrictEqual(normalizeMachine(record.machine), record.machine)) throw new Error();
    if (!Array.isArray(record.shards)) throw new Error();
    const shardIds = new Set();
    for (const shard of record.shards) {
      if (!shard || typeof shard !== "object" || Array.isArray(shard)) throw new Error();
      requiredString(shard.id, "shard.id");
      requiredString(shard.evidenceKey, "shard.evidenceKey");
      requiredString(shard.classification, "shard.classification");
      if (shardIds.has(shard.id)) throw new Error();
      shardIds.add(shard.id);
      if (shard.status === "started") {
        if (!["pending", ...finalClassifications].includes(shard.classification)) throw new Error();
        assertExactFields(shard, new Set(["id", "evidenceKey", "classification", "status"]));
      } else {
        if (!finalClassifications.has(shard.classification)) throw new Error();
        const completion = {};
        for (const key of ["result", "priorDurationMs", "rejectionReason"]) {
          if (shard[key] !== undefined) completion[key] = shard[key];
        }
        normalizeCompletion(shard.decision, completion);
        finiteNonnegative(shard.durationMs, "shard.durationMs");
        assertExactFields(shard, new Set([
          "id", "evidenceKey", "classification", "decision", "durationMs", ...Object.keys(completion),
        ]));
      }
    }
    const derivedTotals = totals(record.shards);
    if (!isDeepStrictEqual(record.totals, derivedTotals)) throw new Error();
    if (!finished) {
      if (!allowIncomplete) throw new Error();
    } else {
      if (!["passed", "failed", "interrupted"].includes(record.outcome)) throw new Error();
      finiteNonnegative(record.wallClockDurationMs, "record.wallClockDurationMs");
      finiteNonnegative(record.orchestrationDurationMs, "record.orchestrationDurationMs");
      validateUtcLabel(record.finishedAt);
      if (record.outcome === "passed"
          && record.shards.some((shard) => shard.status === "started" || shard.result !== "passed")) {
        throw new Error();
      }
    }
    return derivedTotals;
  } catch (error) {
    if (error?.message === "Invalid performance aggregate") throw error;
    throw new Error("Invalid performance record");
  }
}

export function createPerformanceRun({
  provenance,
  cacheMode,
  machine,
  now = performance.now.bind(performance),
  wallNow = utcLabel,
  createRunId = randomUUID,
  createShardToken = randomUUID,
}) {
  const normalizedProvenance = normalizeProvenance(provenance);
  const normalizedCacheMode = normalizeCacheMode(cacheMode);
  const normalizedMachine = normalizeMachine(machine);
  const started = monotonicNow(now);
  const runId = requiredString(createRunId(), "runId");
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new TypeError("Invalid run identifier");
  const run = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    runId,
    startedAt: wallLabel(wallNow),
    provenance: normalizedProvenance,
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    cacheMode: normalizedCacheMode,
    machine: normalizedMachine,
    shards: [],
    totals: totals([]),
    outcome: "incomplete",
  };
  state.set(run, {
    now,
    wallNow,
    createRunId,
    createShardToken,
    started,
    active: new Map(),
    finished: false,
  });
  return run;
}

export function startShard(run, shard, now) {
  const current = runState(run);
  if (current.finished) throw new Error("Performance run is already finished");
  const clock = now ?? current.now;
  const token = requiredString(current.createShardToken(), "shard token");
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new TypeError("Invalid shard token");
  if (current.active.has(token)) throw new TypeError("Invalid shard token");
  const started = monotonicNow(clock);
  const record = {
    id: requiredString(shard?.id, "shard.id"),
    evidenceKey: requiredString(shard?.evidenceKey, "shard.evidenceKey"),
    classification: requiredString(shard?.classification, "shard.classification"),
    status: "started",
  };
  run.shards.push(record);
  current.active.set(token, { record, started });
  run.totals = totals(run.shards);
  return token;
}

export function finishShard(run, token, decision, details = {}, now) {
  const current = runState(run);
  if (current.finished) throw new Error("Performance run is already finished");
  const active = current.active.get(token);
  if (!active) throw new Error("Unknown or already finished shard token");
  const completion = normalizeCompletion(decision, details);
  const durationMs = monotonicNow(now ?? current.now) - active.started;
  finiteNonnegative(durationMs, "shard duration");
  const record = active.record;
  const completed = {
    id: record.id,
    evidenceKey: record.evidenceKey,
    classification: completion.classification ?? record.classification,
    decision,
    durationMs,
  };
  if (!finalClassifications.has(completed.classification)) {
    throw new TypeError(INVALID_SHARD_COMPLETION);
  }
  const priorDurationMs = details.priorDurationMs;
  if (priorDurationMs !== undefined) {
    completed.priorDurationMs = finiteNonnegative(priorDurationMs, "details.priorDurationMs");
  }
  for (const key of ["rejectionReason", "result"]) {
    const value = optionalString(details[key], `details.${key}`);
    if (value !== undefined) completed[key] = value;
  }
  const shardIndex = run.shards.indexOf(record);
  const candidateShards = run.shards.with(shardIndex, completed);
  const candidateTotals = totals(candidateShards);
  Object.keys(record).forEach((key) => delete record[key]);
  Object.assign(record, completed);
  current.active.delete(token);
  run.totals = candidateTotals;
  return record;
}

export function finishPerformanceRun(run, outcome, now) {
  const current = runState(run);
  if (current.finished) throw new Error("Performance run is already finished");
  if (outcome !== "passed" && outcome !== "failed" && outcome !== "interrupted") {
    throw new Error("Invalid campaign outcome");
  }
  if (current.active.size !== 0 && outcome === "passed") {
    throw new Error("Cannot finish a run with active shards");
  }
  if (outcome === "passed" && run.shards.some((shard) => shard.result !== "passed")) {
    throw new Error("Invalid campaign outcome");
  }
  const durationMs = monotonicNow(now ?? current.now) - current.started;
  finiteNonnegative(durationMs, "run duration");
  run.wallClockDurationMs = durationMs;
  run.orchestrationDurationMs = durationMs;
  run.totals = totals(run.shards);
  run.outcome = requiredString(outcome, "outcome");
  run.finishedAt = wallLabel(current.wallNow);
  current.finished = true;
  return run;
}

export function writePerformanceRecord(root, run) {
  requiredString(root, "root");
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new TypeError("run must be an object");
  const current = state.get(run);
  if (!current) throw new Error("Invalid performance record");
  const hasIncompleteOrFailedShard = !Array.isArray(run.shards)
    || run.shards.some((shard) => shard.status === "started" || shard.result !== "passed");
  if (run.outcome === "passed" && (current?.active.size > 0 || hasIncompleteOrFailedShard)) {
    throw new Error("Cannot persist a passed run with active shards");
  }
  validateRecord(run, { allowIncomplete: true });
  if (current.finished !== (run.outcome !== "incomplete")) throw new Error("Invalid performance record");
  if (current.active.size !== run.shards.filter((shard) => shard.status === "started").length) {
    throw new Error("Invalid performance record");
  }
  for (const active of current.active.values()) {
    if (!run.shards.includes(active.record) || active.record.status !== "started") {
      throw new Error("Invalid performance record");
    }
  }
  const resolvedRoot = realpathSync(root);
  let candidate = resolvedRoot;
  for (const component of ["reports", "mutation-performance"]) {
    candidate = path.join(candidate, component);
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error("Unsafe performance record path");
    }
    if (!existsSync(candidate)) mkdirSync(candidate);
    const resolved = realpathSync(candidate);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error("Unsafe performance record path");
    }
  }
  const directory = candidate;
  const runId = requiredString(run.runId, "run.runId");
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new TypeError("run.runId is unsafe");
  const destination = path.join(directory, `${runId}.json`);
  const temporaryId = current ? current.createRunId() : randomUUID();
  if (typeof temporaryId !== "string" || !/^[A-Za-z0-9_-]+$/.test(temporaryId)) {
    throw new TypeError("Invalid temporary identifier");
  }
  const temporary = path.join(directory, `.${runId}.${temporaryId}.temporary`);
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
  if (cold.provenance?.base !== warm.provenance?.base
      || cold.provenance?.baseRef !== warm.provenance?.baseRef) {
    reasons.push("different base provenance");
  }
  const workload = (record) => record.shards
    .map(({ id, evidenceKey, classification }) => JSON.stringify([id, evidenceKey, classification]))
    .sort();
  if (!isDeepStrictEqual(workload(cold), workload(warm))) reasons.push("different workloads");
  if (cold.outcome !== "passed" || warm.outcome !== "passed") {
    reasons.push("campaign outcomes are not both passed");
  }
  return reasons;
}

function display(value) {
  return String(value);
}

export function renderBenchmarkSummary(cold, warm, { allowIncomparable = false } = {}) {
  validateRecord(cold);
  validateRecord(warm);
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
    `| Wall-clock duration (ms) | ${display(cold.wallClockDurationMs)} | ${display(warm.wallClockDurationMs)} |`,
    `| Orchestration duration (ms) | ${display(cold.orchestrationDurationMs)} | ${display(warm.orchestrationDurationMs)} |`,
    `| Measured wall-clock savings (ms) | ${display(measuredSavings)} | — |`,
    `| Shard count | ${display(cold.totals.shardCount)} | ${display(warm.totals.shardCount)} |`,
    `| Executed shards | ${display(cold.totals.executedCount)} | ${display(warm.totals.executedCount)} |`,
    `| Reused shards | ${display(cold.totals.reusedCount)} | ${display(warm.totals.reusedCount)} |`,
    `| Rejected cache entries | ${display(cold.totals.rejectedCount)} | ${display(warm.totals.rejectedCount)} |`,
    `| Hit ratio | ${display(cold.totals.hitRatio)} | ${display(warm.totals.hitRatio)} |`,
    `| Estimated cache savings (ms) | ${display(cold.totals.estimatedMsSaved)} | ${display(warm.totals.estimatedMsSaved)} |`,
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
