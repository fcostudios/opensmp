#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, constants as fsConstants, existsSync, fstatSync, fsyncSync as nodeFsyncSync, mkdtempSync, mkdirSync, openSync as nodeOpenSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync as nodeWriteSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  MAX_READINESS_MINUTES,
  WorkReadinessError,
  canonicalActualsSha256,
  canonicalReadinessPayload,
  classifyAssessment,
  computeReadinessPayloadSha256,
  validateApproval,
  validateLifecycleCorrections,
  validateAssessment,
  validateCompletionActuals,
  validatePartitionGraph,
  resolveEffectiveActuals,
  DELIVERED_CANONICAL_EVENTS,
  DELIVERED_LOCAL_EVENTS,
} from "./work-readiness/model.mjs";
import {
  validDone,
  classifyChangedPath,
  extractWorkIds,
  listChangedPaths,
  resolveDefaultBase,
  validateRangeOwnership,
  validateFunctionalDelivery,
} from "./work-readiness/git.mjs";
import { calibrateAssessment, createAssessmentFile, readCanonicalMessageFile } from "./work-readiness.mjs";
import * as readinessCli from "./work-readiness.mjs";
import * as readinessModel from "./work-readiness/model.mjs";
let ownedScopeModule;
try { ownedScopeModule = await import("./mutation-evidence/owned-scope.mjs"); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }


const bootstrap = JSON.parse(
  await readFile(new URL("../docs/readiness/CHG-022.json", import.meta.url), "utf8"),
);
const repositoryFeedback = await readFile(new URL("../.nous-feedback.jsonl", import.meta.url), "utf8");
const bootstrapDecision = {
  story: "CHG-022",
  event: "decision",
  id: "CHG022-READINESS-V2-APPROVAL",
  text: `Decision ready for readiness payload SHA-256 ${bootstrap.readiness_payload_sha256} as the one-time, immutable, non-repeatable CHG-022 policy bootstrap, based on design commit ${bootstrap.bootstrap_authorization.design_commit} and refreshed authority plan commit ${bootstrap.bootstrap_authorization.plan_commit}. Exact authorized paths, in order: ${bootstrap.bootstrap_authorization.allowed_paths.join("; ")}. This authorization interval begins at this matching decision and expires on CHG-022's first valid terminal done event; every later implementation commit must be rejected and cannot reuse this or any earlier bootstrap approval.`,
  reason: "Policy activation",
};
const cliPath = new URL("./work-readiness.mjs", import.meta.url).pathname;
const sourceRoot = new URL("../", import.meta.url);
const readinessSchema = JSON.parse(await readFile(new URL("../docs/dev-guide/work-readiness.schema.json", import.meta.url), "utf8"));
const workReadinessGuide = await readFile(new URL("../docs/dev-guide/WORK_READINESS.md", import.meta.url), "utf8");

const clone = (value) => structuredClone(value);

function bootstrapCheckpointDeviation(implementationMinutes) {
  return {
    story: "CHG-022",
    event: "deviation",
    control: "45/90-minute-checkpoints",
    observed_implementation_minutes: implementationMinutes,
    reason: "CHG-022 execution crossed both controls before the repository could enforce its own new policy.",
    corrective_action: "Record the missed controls truthfully and require Git-derived enforcement for every subsequent work item.",
    notes: "Bootstrap-only corrective evidence; no retroactive checkpoint is claimed.",
  };
}

function normal(overrides = {}) {
  const value = {
    schema_version: 1,
    readiness_payload_sha256: "0".repeat(64),
    work_id: "US-123",
    kind: "US",
    work_type: "functional",
    title: "Deliver one outcome",
    source: "docs/stories/US-123.md",
    outcomes: [{ id: "O1", statement: "A user completes the job", demo: "The job is visible", primary: true }],
    acceptance_criteria: [{ id: "AC1", outcome_ids: ["O1"] }],
    scopes: ["server", "ui"],
    signals: {
      routes_or_screens: 1,
      acceptance_flows: 1,
      expected_changed_files: 8,
      expected_mutation_shards: 1,
      lifecycle_or_concurrency_boundaries: 0,
      external_integrations: 0,
      schema_or_migration_changes: 0,
      authorization_or_audit_boundaries: 0,
      tooling_change: false,
    },
    estimate_minutes: {
      readiness: 10,
      implementation: 55,
      focused_verification: 20,
      review: 10,
      integration: 5,
      total: 100,
    },
    uncertainties: [],
    dependencies: [],
    decision: "ready",
    partitions: [],
    approval: { status: "approved", approved_by: "user", evidence: "US123-READY", payload_sha256: "0".repeat(64) },
    actuals: null,
    checkpoints: [],
    policy_bootstrap: false,
    bootstrap_exemption_rationale: null,
    bootstrap_authorization: null,
    controlling_change: null,
    ...overrides,
  };
  refreshDigest(value);
  return value;
}

function refreshDigest(value) {
  const digest = computeReadinessPayloadSha256(value);
  value.readiness_payload_sha256 = digest;
  value.approval.payload_sha256 = digest;
  return value;
}

// CHG-034 §1 — was `attestDecision`: built a record and Ed25519-signed it.
// Signing is retired, but this still emits the HISTORICAL 10-key shape on
// purpose: 20 of the ledger's 62 decision records look like this, and the
// optional-attestation-keys contract that keeps them readable needs an oracle.
// `legacyDecision()` below covers the 42 five-key records.
function attestDecision(record) {
  return {
    ...record,
    approved_by: record.approved_by ?? "user",
    subject_work_id: record.subject_work_id ?? record.story,
    relationship: record.relationship ?? "self",
    key_id: "nous-historical-ed25519",
    signature: "A".repeat(86) + "==",
  };
}

// The shape a NEW decision takes now that signing is gone: everything except
// `key_id` and `signature`.
//
// §1's prose said to cut "approved_by/key_id/relationship Ed25519 attestation",
// but three of those five fields are BINDING, not ceremony, and the approval
// path still requires them (model.mjs:782-789):
//   approved_by      → WR_APPROVER_MISMATCH        ("What stays" item 3: the
//                       recorded human decision binds to the artifact)
//   subject_work_id  → APPROVAL_STORY_MISMATCH     (which work item this approves)
//   relationship     → WR_APPROVAL_CONTROL_MISMATCH (self vs controlling-CHG —
//                       how a CHG approves a story, "What stays" item 4)
// Only `key_id` and `signature` are the ceremony, and only those two go.
function currentDecision(record) {
  const { key_id: _k, signature: _g, ...rest } = attestDecision(record);
  return rest;
}

function decisionFor(value, overrides = {}) {
  return attestDecision({
    story: value.work_id,
    event: "decision",
    id: value.approval.evidence,
    text: `Decision ${value.decision} for readiness payload SHA-256 ${value.readiness_payload_sha256}.`,
    reason: "Approved assessment",
    approved_by: value.approval.approved_by,
    subject_work_id: value.work_id,
    ...overrides,
  });
}

function expectError(code, path, action) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof WorkReadinessError, true);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    assert.equal(typeof error.message, "string");
    assert.ok(error.message.length > 0);
    return true;
  });
}

let assertions = 0;
function test(name, body) {
  if (process.env.READINESS_TEST_FILTER && !name.includes(process.env.READINESS_TEST_FILTER)) return;
  try {
    body();
    assertions += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

test("readiness guide defines the authoritative mutation workflow", () => {
  assert.match(workReadinessGuide, /pnpm mutation:cache:clear/u);
  assert.match(workReadinessGuide, /^MUTATION_BASE=<approved-authority-base> pnpm test:mutation$/mu);
  assert.doesNotMatch(workReadinessGuide, /MUTATION_BASE_REF/u);
  assert.match(workReadinessGuide, /test:mutation:core/u);
  assert.match(workReadinessGuide, /mutation_minutes/u);
  assert.match(workReadinessGuide, /Math\.ceil\(implementation \* 65 \/ 28\)/u);
  assert.match(workReadinessGuide, /any implementation commit after this task invalidates it/u);
  assert.match(workReadinessGuide, /`?mutation_minutes`? is not added to phase totals/u);
  assert.match(workReadinessGuide, /Calibration is optional and resets approval/u);
});

test("readiness guide requires the calibration and core-runner relationships", () => {
  const calibrationCommand = /pnpm readiness:calibrate -- WORK-ID/u;
  const manualOverride = /Authors may instead manually override\s+phase estimates before approval/u;
  const coreAuthority = /`pnpm test:mutation:core` is authoritative\s+only for a CHG that changes the effectiveness-critical set/u;
  const withoutCalibrationCommand = workReadinessGuide.replace("pnpm readiness:calibrate -- WORK-ID", "");
  const withoutManualOverride = workReadinessGuide.replace(/Authors may instead manually override\s+phase estimates before approval; /u, "");
  const withoutCoreAuthority = workReadinessGuide.replace(/only for a CHG that changes the effectiveness-critical set/u, "");
  assert.match(workReadinessGuide, calibrationCommand);
  assert.match(workReadinessGuide, manualOverride);
  assert.match(workReadinessGuide, coreAuthority);
  assert.throws(() => assert.match(withoutCalibrationCommand, calibrationCommand));
  assert.throws(() => assert.match(withoutManualOverride, manualOverride));
  assert.throws(() => assert.match(withoutCoreAuthority, coreAuthority));
});

test("schema structure and runtime preserve bootstrap while requiring normal controller metadata", () => {
  const bootstrapRule = readinessSchema.allOf.find((rule) => rule.if?.properties?.policy_bootstrap?.const === true);
  const kindRule = readinessSchema.allOf.find((rule) => rule.if?.properties?.kind?.const === "US");
  const actuals = readinessSchema.$defs.actuals;
  assert.deepEqual(bootstrapRule.else.required, ["controlling_change"]);
  assert.equal(bootstrapRule.then.required?.includes("controlling_change") ?? false, false);
  assert.equal(kindRule.else.required?.includes("controlling_change") ?? false, false);
  assert.equal(readinessSchema.required.includes("controlling_change"), false);
  assert.deepEqual(actuals.properties.mutation_minutes, { $ref: "#/$defs/nonnegative_integer" });
  assert.equal(actuals.required.includes("mutation_minutes"), false);
  assert.deepEqual(actuals.properties.mutation_shards_actual, { $ref: "#/$defs/nonnegative_integer" });
  assert.equal(actuals.required.includes("mutation_shards_actual"), false);
  assert.equal(validateAssessment(bootstrap, { feedbackRecords: [bootstrapDecision] }).decision, "ready");
  const us = normal();
  const change = normal({ work_id: "CHG-123", kind: "CHG", source: "docs/changes/CHG-123.md" });
  assert.equal(validateAssessment(us, { feedbackRecords: [decisionFor(us)] }).decision, "ready");
  assert.equal(validateAssessment(change, { feedbackRecords: [decisionFor(change)] }).decision, "ready");
  for (const artifact of [us, change]) {
    const missing = clone(artifact);
    delete missing.controlling_change;
    expectError("WR_MISSING_PROPERTY", "$.controlling_change", () => validateAssessment(missing, { feedbackRecords: [decisionFor(missing)] }));
  }
});

test("canonical payload recursively sorts objects, preserves arrays, and excludes mutable fields", () => {
  const a = normal();
  const b = clone(a);
  b.actuals = { ignored: true };
  b.checkpoints = [{ ignored: true }];
  b.approval.status = "rejected";
  b.readiness_payload_sha256 = "f".repeat(64);
  b.signals = Object.fromEntries(Object.entries(b.signals).reverse());
  assert.equal(canonicalReadinessPayload(a), canonicalReadinessPayload(b));
  assert.equal(computeReadinessPayloadSha256(a), computeReadinessPayloadSha256(b));
});

for (const [implementation, review] of [[0, 0], [1, 3], [28, 65], [29, 68], [60, 140]]) {
  test(`calibration maps ${implementation} implementation minutes to ${review} review minutes`, () => {
    const value = normal();
    value.estimate_minutes = {
      readiness: 7, implementation, focused_verification: 11, review: 999,
      integration: 5, total: 1022 + implementation,
    };
    const before = clone(value);
    const calibrated = calibrateAssessment(value);
    assert.deepEqual(calibrated.estimate_minutes, {
      readiness: 7, implementation, focused_verification: 11, review,
      integration: 5, total: 23 + implementation + review,
    });
    assert.deepEqual(value, before);
    const digest = computeReadinessPayloadSha256(calibrated);
    assert.equal(calibrated.readiness_payload_sha256, digest);
    assert.deepEqual(calibrated.approval, {
      status: "pending", approved_by: null, evidence: null, payload_sha256: digest,
    });
    const { estimate_minutes: _estimate, approval: _approval, readiness_payload_sha256: _digest, ...unrelated } = calibrated;
    const { estimate_minutes: _oldEstimate, approval: _oldApproval, readiness_payload_sha256: _oldDigest, ...original } = before;
    assert.deepEqual(unrelated, original);
  });
}

for (const phase of ["readiness", "implementation", "focused_verification", "review", "integration"]) {
  for (const invalid of [-1, 0.5, "1", null, undefined, NaN, Infinity]) {
    test(`calibration rejects invalid ${phase} minutes ${String(invalid)}`, () => {
      const value = normal();
      value.estimate_minutes[phase] = invalid;
      expectError("WR_INVALID_INTEGER", `$.estimate_minutes.${phase}`, () => calibrateAssessment(value));
    });
  }
}

test("CLI calibrate replaces an unstarted approval with exact pending estimates", () => {
  const { root } = makeGitRepo();
  try {
    const value = normal({ estimate_minutes: {
      readiness: 10, implementation: 60, focused_verification: 20, review: 10, integration: 5, total: 105,
    } });
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
    const records = [
      decisionFor(value),
      { story: "US-999", event: "started" },
      { story: "US-123", event: "feedback", notes: "Review estimate before starting" },
    ];
    const feedbackBytes = `${records.map(JSON.stringify).join("\n")}\n`;
    writeRepoFile(root, ".nous-feedback.jsonl", feedbackBytes);
    const result = runCli(root, ["calibrate", "us-123"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Calibrated docs/readiness/US-123.json; review=140, total=235; approval reset to pending\n");
    const calibrated = JSON.parse(readFileSync(join(root, "docs/readiness/US-123.json"), "utf8"));
    assert.deepEqual(calibrated.estimate_minutes, {
      readiness: 10, implementation: 60, focused_verification: 20, review: 140, integration: 5, total: 235,
    });
    const digest = computeReadinessPayloadSha256(calibrated);
    assert.equal(calibrated.readiness_payload_sha256, digest);
    assert.deepEqual(calibrated.approval, { status: "pending", approved_by: null, evidence: null, payload_sha256: digest });
    assert.equal(readFileSync(join(root, ".nous-feedback.jsonl"), "utf8"), feedbackBytes);
    assert.deepEqual(readdirSync(join(root, "docs/readiness")), ["US-123.json"]);
    const check = runCli(root, ["check", "US-123", "--json"]);
    assert.equal(check.status, 1);
    assert.equal(parseCliJson(check).errors[0].code, "WR_APPROVAL_REQUIRED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ["short write", "rename", "file sync", "directory sync"]) {
  test(`calibration preserves original bytes and cleans temporary files after ${failure} failure`, () => {
    const { root } = makeGitRepo();
    try {
      const value = normal();
      const originalBytes = `${JSON.stringify(value)}\n`;
      const path = join(root, "docs/readiness/US-123.json");
      writeRepoFile(root, "docs/readiness/US-123.json", originalBytes);
      const ioError = () => Object.assign(new Error(`injected ${failure} failure`), { code: "EIO" });
      const fsOps = failure === "short write" ? {
        writeSync(descriptor, bytes) { return nodeWriteSync(descriptor, bytes, 0, bytes.length - 1, 0); },
      } : failure === "rename" ? {
        renameSync() { throw ioError(); },
      } : {
        fsyncSync(descriptor) {
          if (fstatSync(descriptor).isDirectory() === (failure === "directory sync")) throw ioError();
          nodeFsyncSync(descriptor);
        },
      };
      expectError("WR_FILE_WRITE_FAILED", "docs/readiness/US-123.json", () => readinessCli.calibrateAssessmentFile({
        root, workId: "US-123", feedbackRecords: [decisionFor(value)], fsOps,
      }));
      assert.equal(readFileSync(path, "utf8"), originalBytes);
      assert.deepEqual(readdirSync(join(root, "docs/readiness")), ["US-123.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("calibration never removes a temporary file it failed to create exclusively", () => {
  const { root } = makeGitRepo();
  try {
    const value = normal();
    const originalBytes = `${JSON.stringify(value)}\n`;
    writeRepoFile(root, "docs/readiness/US-123.json", originalBytes);
    let occupiedPath;
    expectError("WR_FILE_WRITE_FAILED", "docs/readiness/US-123.json", () => readinessCli.calibrateAssessmentFile({
      root, workId: "US-123", feedbackRecords: [decisionFor(value)],
      fsOps: {
        openSync(path, flags, mode) {
          occupiedPath = path;
          writeFileSync(path, "another writer\n", { flag: "wx" });
          return nodeOpenSync(path, flags, mode);
        },
      },
    }));
    assert.equal(readFileSync(join(root, "docs/readiness/US-123.json"), "utf8"), originalBytes);
    assert.equal(readFileSync(occupiedPath, "utf8"), "another writer\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const target of ["artifact", "directory"]) {
  test(`CLI calibration rejects a symlinked ${target} and preserves outside bytes`, () => {
    const { root } = makeGitRepo();
    const outside = mkdtempSync(join(tmpdir(), "work-readiness-calibrate-outside-"));
    try {
      const value = normal();
      const originalBytes = `${JSON.stringify(value)}\n`;
      writeFileSync(join(outside, "US-123.json"), originalBytes);
      writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decisionFor(value))}\n`);
      mkdirSync(join(root, "docs"));
      if (target === "directory") symlinkSync(outside, join(root, "docs/readiness"));
      else {
        mkdirSync(join(root, "docs/readiness"));
        symlinkSync(join(outside, "US-123.json"), join(root, "docs/readiness/US-123.json"));
      }
      const result = runCli(root, ["calibrate", "US-123", "--json"]);
      assert.equal(result.status, 2);
      assert.equal(parseCliJson(result).errors[0].code, target === "directory" ? "WR_PATH_ESCAPE" : "WR_FILE_INVALID");
      assert.equal(readFileSync(join(outside, "US-123.json"), "utf8"), originalBytes);
      assert.deepEqual(readdirSync(outside), ["US-123.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

for (const [event, extra, code] of [
  ["done", {}, "WR_APPROVAL_INACTIVE"],
  ["started", {}, "WR_APPROVAL_ORDER"],
  ["build_pass", { notes: "Focused checks passed" }, "WR_APPROVAL_ORDER"],
  ["checkpoint", { status: "on_track" }, "WR_APPROVAL_ORDER"],
]) {
  test(`CLI calibration rejects post-approval ${event} without changing the artifact`, () => {
    const { root } = makeGitRepo();
    try {
      const value = event === "done" ? completed() : normal();
      const originalBytes = `${JSON.stringify(value)}\n`;
      writeRepoFile(root, "docs/readiness/US-123.json", originalBytes);
      const records = [decisionFor(value), { story: value.work_id, event, ...extra }];
      writeRepoFile(root, ".nous-feedback.jsonl", `${records.map(JSON.stringify).join("\n")}\n`);
      const result = runCli(root, ["calibrate", "US-123", "--json"]);
      assert.equal(result.status, 1);
      assert.equal(parseCliJson(result).errors[0].code, code);
      assert.equal(readFileSync(join(root, "docs/readiness/US-123.json"), "utf8"), originalBytes);
      assert.deepEqual(readdirSync(join(root, "docs/readiness")), ["US-123.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("CLI calibration preserves completed evidence even after a later approval", () => {
  const { root } = makeGitRepo();
  try {
    const value = completed();
    const originalBytes = `${JSON.stringify(value)}\n`;
    writeRepoFile(root, "docs/readiness/US-123.json", originalBytes);
    const records = [
      decisionFor(value, { id: "US123-FIRST" }),
      { story: value.work_id, event: "done" },
      decisionFor(value),
    ];
    writeRepoFile(root, ".nous-feedback.jsonl", `${records.map(JSON.stringify).join("\n")}\n`);
    const result = runCli(root, ["calibrate", "US-123", "--json"]);
    assert.equal(result.status, 1);
    assert.equal(parseCliJson(result).errors[0].code, "WR_APPROVAL_INACTIVE");
    assert.equal(readFileSync(join(root, "docs/readiness/US-123.json"), "utf8"), originalBytes);
    assert.deepEqual(readdirSync(join(root, "docs/readiness")), ["US-123.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI calibration requires exactly one official work ID", () => {
  const { root } = makeGitRepo();
  try {
    for (const args of [[], ["US-123", "US-456"], ["../US-123"], ["--base", "HEAD", "US-123"]]) {
      const result = runCli(root, ["calibrate", ...args, "--json"]);
      assert.equal(result.status, 2);
      assert.equal(parseCliJson(result).errors[0].code, "WR_INVOCATION_INVALID");
    }
    assert.equal(existsSync(join(root, "docs/readiness")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts an approved ready US", () => {
  const value = normal();
  assert.deepEqual(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }), {
    decision: "ready", active: true, complete: false, inactiveReason: null, correctedStarts: 0,
  });
  assert.equal(classifyAssessment(value), "ready");
});

for (const [name, mutate, code, path] of [
  ["normal estimate above the budget", (v) => { v.estimate_minutes.implementation = 276; v.estimate_minutes.total = 321; }, "WR_ESTIMATE_OVER_BUDGET", "$.estimate_minutes.total"],
  ["multiple primary outcomes", (v) => { v.outcomes.push({ id: "O2", statement: "Second", demo: "Second demo", primary: true }); }, "WR_MULTIPLE_OUTCOMES", "$.outcomes"],
  ["more than three scopes", (v) => { v.scopes = ["a", "b", "c", "d"]; }, "WR_TOO_MANY_SCOPES", "$.scopes"],
  ["more than two routes", (v) => { v.signals.routes_or_screens = 3; }, "WR_TOO_MANY_ROUTES", "$.signals.routes_or_screens"],
  ["more than three flows", (v) => { v.signals.acceptance_flows = 4; }, "WR_TOO_MANY_FLOWS", "$.signals.acceptance_flows"],
  ["more than twenty files", (v) => { v.signals.expected_changed_files = 21; }, "WR_TOO_MANY_FILES", "$.signals.expected_changed_files"],
  ["more than one lifecycle boundary", (v) => { v.signals.lifecycle_or_concurrency_boundaries = 2; }, "WR_TOO_MANY_LIFECYCLE_BOUNDARIES", "$.signals.lifecycle_or_concurrency_boundaries"],
  ["mixed work", (v) => { v.work_type = "mixed"; }, "WR_MIXED_FUNCTIONAL_TOOLING", "$.work_type"],
  ["functional tooling signal", (v) => { v.signals.tooling_change = true; }, "WR_MIXED_FUNCTIONAL_TOOLING", "$.signals.tooling_change"],
  ["functional tooling scope", (v) => { v.scopes = ["ui", "tooling"]; }, "WR_MIXED_FUNCTIONAL_TOOLING", "$.signals.tooling_change"],
]) {
  test(`rejects ready declaration for ${name}`, () => {
    const value = normal();
    mutate(value);
    refreshDigest(value);
    expectError(code, path, () => validateAssessment(value, { feedbackRecords: [decisionFor(value)] }));
  });
}

test("accepts a technical tooling CHG", () => {
  const value = normal({ work_id: "CHG-123", kind: "CHG", work_type: "technical" });
  value.signals.tooling_change = true;
  value.scopes = ["tooling"];
  refreshDigest(value);
  assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "ready");
});

test("classifies zero primary as blocked and multiple primary as partition required", () => {
  const zero = normal();
  zero.outcomes[0].primary = false;
  refreshDigest(zero);
  assert.equal(classifyAssessment(zero), "blocked");
  expectError("WR_MISSING_PRIMARY_OUTCOME", "$.outcomes", () => validateAssessment(zero, { feedbackRecords: [decisionFor(zero)] }));
  const multiple = normal();
  multiple.outcomes.push({ id: "O2", statement: "Second", demo: "Second demo", primary: true });
  refreshDigest(multiple);
  assert.equal(classifyAssessment(multiple), "partition_required");
});

test("rejects unresolved uncertainty as blocked", () => {
  const value = normal();
  value.uncertainties = [{ id: "U1", statement: "Unknown", status: "unresolved", estimate_impact_minutes: null, resolution: null }];
  refreshDigest(value);
  expectError("WR_UNRESOLVED_UNCERTAINTY", "$.uncertainties[0]", () => validateAssessment(value, { feedbackRecords: [decisionFor(value)] }));
});

test("rejects phase total mismatch", () => {
  const value = normal();
  value.estimate_minutes.total = 99;
  refreshDigest(value);
  expectError("WR_PHASE_TOTAL_MISMATCH", "$.estimate_minutes.total", () => validateAssessment(value));
});

test("rejects unknown and inherited properties", () => {
  const unknown = normal({ typo: true });
  refreshDigest(unknown);
  expectError("WR_UNKNOWN_PROPERTY", "$.typo", () => validateAssessment(unknown));
  const inherited = normal();
  Object.setPrototypeOf(inherited, { surprise: true });
  expectError("WR_UNSAFE_OBJECT", "$", () => validateAssessment(inherited));
});

test("rejects duplicate and unresolved references", () => {
  const duplicate = normal();
  duplicate.outcomes.push(clone(duplicate.outcomes[0]));
  refreshDigest(duplicate);
  expectError("WR_DUPLICATE_ID", "$.outcomes[1].id", () => validateAssessment(duplicate));
  const unresolved = normal();
  unresolved.acceptance_criteria[0].outcome_ids = ["missing"];
  refreshDigest(unresolved);
  expectError("WR_UNRESOLVED_REFERENCE", "$.acceptance_criteria[0].outcome_ids[0]", () => validateAssessment(unresolved));
});

test("rejects contradictory parent dependency edges as a cycle", () => {
  const value = normal();
  value.dependencies = [
    { work_id: "US-124", type: "blocks", reason: "Must follow this work" },
    { work_id: "US-124", type: "blocked_by", reason: "Must precede this work" },
  ];
  refreshDigest(value);
  expectError("WR_DEPENDENCY_CYCLE", "$.dependencies[1].work_id", () => validateAssessment(value));
});

function partitioned() {
  const value = normal({
    work_id: "CHG-123",
    kind: "CHG",
    decision: "partition_required",
    outcomes: [
      { id: "O1", statement: "First business result", demo: "First demo", primary: true },
      { id: "O2", statement: "Second business result", demo: "Second demo", primary: true },
    ],
    acceptance_criteria: [
      { id: "AC1", outcome_ids: ["O1"] },
      { id: "AC2", outcome_ids: ["O2"] },
    ],
  });
  value.partitions = [
    {
      proposal_key: "first",
      work_id: null,
      title: "First slice",
      outcome: "First business result",
      demo: "First demo",
      acceptance_criteria: ["AC1"],
      work_type: "functional",
      scopes: ["ui", "server"],
      signals: { ...value.signals },
      uncertainties: [],
      estimate_minutes: { ...value.estimate_minutes },
      depends_on: [],
      cross_cutting_rationale: null,
    },
    {
      proposal_key: "second",
      work_id: null,
      title: "Second slice",
      outcome: "Second business result",
      demo: "Second demo",
      acceptance_criteria: ["AC2"],
      work_type: "functional",
      scopes: ["ui"],
      signals: { ...value.signals, routes_or_screens: 1 },
      uncertainties: [],
      estimate_minutes: { ...value.estimate_minutes },
      depends_on: ["first"],
      cross_cutting_rationale: null,
    },
  ];
  refreshDigest(value);
  return value;
}

test("accepts a functional CHG partition proposal with local keys", () => {
  const value = partitioned();
  assert.deepEqual(validatePartitionGraph(value), { executableWorkIds: [] });
  assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "partition_required");
});

test("rejects orphan acceptance criteria", () => {
  const value = partitioned();
  value.partitions[1].acceptance_criteria = ["AC1"];
  expectError("WR_ORPHAN_AC", "$.acceptance_criteria[1].id", () => validatePartitionGraph(value));
});

test("rejects duplicate child keys and duplicate official IDs", () => {
  const key = partitioned();
  key.partitions[1].proposal_key = "first";
  expectError("WR_DUPLICATE_CHILD", "$.partitions[1].proposal_key", () => validatePartitionGraph(key));
  const id = partitioned();
  id.partitions[0].work_id = "CHG-124";
  id.partitions[1].work_id = "CHG-124";
  expectError("WR_DUPLICATE_CHILD", "$.partitions[1].work_id", () => validatePartitionGraph(id));
});

test("rejects unofficial child execution", () => {
  const value = partitioned();
  value.decision = "ready";
  expectError("WR_UNOFFICIAL_CHILD_ID", "$.partitions[0].work_id", () => validatePartitionGraph(value));
});

test("rejects cyclic and missing partition dependencies", () => {
  const cycle = partitioned();
  cycle.partitions[0].depends_on = ["second"];
  expectError("WR_DEPENDENCY_CYCLE", "$.partitions", () => validatePartitionGraph(cycle));
  const missing = partitioned();
  missing.partitions[0].depends_on = ["missing"];
  expectError("WR_UNRESOLVED_REFERENCE", "$.partitions[0].depends_on[0]", () => validatePartitionGraph(missing));
});

test("rejects oversized or incohesive child partitions", () => {
  const value = partitioned();
  value.partitions[0].estimate_minutes.implementation = 276;
  value.partitions[0].estimate_minutes.total = 321;
  expectError("WR_ESTIMATE_OVER_BUDGET", "$.partitions[0].estimate_minutes.total", () => validatePartitionGraph(value));
});

test("rejects unresolved child uncertainty", () => {
  const value = partitioned();
  value.partitions[0].uncertainties = [{
    id: "U1",
    statement: "Unknown child boundary",
    status: "unresolved",
    estimate_impact_minutes: null,
    resolution: null,
  }];
  expectError("WR_PARTITION_UNCERTAINTY", "$.partitions[0].uncertainties", () => validatePartitionGraph(value));
});

test("rejects child partitions without implementation and focused verification", () => {
  const noImplementation = partitioned();
  noImplementation.partitions[0].estimate_minutes.implementation = 0;
  noImplementation.partitions[0].estimate_minutes.total = 45;
  expectError("WR_VERTICAL_SLICE_INCOMPLETE", "$.partitions[0].estimate_minutes.implementation", () => validatePartitionGraph(noImplementation));

  const uiWithoutVerification = partitioned();
  uiWithoutVerification.partitions[0].scopes = ["ui"];
  uiWithoutVerification.partitions[0].estimate_minutes.focused_verification = 0;
  uiWithoutVerification.partitions[0].estimate_minutes.total = 80;
  expectError("WR_VERTICAL_SLICE_INCOMPLETE", "$.partitions[0].estimate_minutes.focused_verification", () => validatePartitionGraph(uiWithoutVerification));
});

test("rejects tests-only child while accepting a delivery scope with verification", () => {
  const testsOnly = partitioned();
  testsOnly.partitions[0].scopes = ["tests"];
  expectError("WR_VERTICAL_SLICE_INCOMPLETE", "$.partitions[0].scopes", () => validatePartitionGraph(testsOnly));

  const vertical = partitioned();
  vertical.partitions[0].scopes = ["ui"];
  assert.deepEqual(validatePartitionGraph(vertical), { executableWorkIds: [] });
});

test("requires rationale for duplicate AC coverage", () => {
  const value = partitioned();
  value.partitions[1].acceptance_criteria = ["AC1", "AC2"];
  expectError("WR_CROSS_CUTTING_RATIONALE_REQUIRED", "$.partitions[0].cross_cutting_rationale", () => validatePartitionGraph(value));
});

test("approval detects digest mismatch and any readiness mutation", () => {
  const mismatch = normal();
  mismatch.approval.payload_sha256 = "f".repeat(64);
  expectError("WR_APPROVAL_DIGEST_MISMATCH", "$.approval.payload_sha256", () => validateApproval(mismatch, [decisionFor(mismatch)]));
  const mutated = normal();
  mutated.title = "Changed after approval";
  expectError("WR_APPROVAL_DIGEST_MISMATCH", "$.readiness_payload_sha256", () => validateApproval(mutated, [decisionFor(mutated)]));
});

test("approval rejects missing, duplicate, wrong-decision, and old evidence", () => {
  const value = normal();
  expectError("WR_APPROVAL_EVIDENCE_MISSING", "$.approval.evidence", () => validateApproval(value, []));
  expectError("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", () => validateApproval(value, [decisionFor(value), decisionFor(value)]));
  expectError("WR_APPROVAL_DECISION_MISMATCH", "$.approval.evidence", () => validateApproval(value, [decisionFor(value, { text: `Decision blocked for readiness payload SHA-256 ${value.readiness_payload_sha256}.` })]));
  const old = clone(bootstrap);
  old.approval.evidence = "CHG022-READINESS-V1-APPROVAL";
  old.approval.payload_sha256 = old.readiness_payload_sha256;
  expectError("WR_BOOTSTRAP_APPROVAL_REPLAY", "$.approval.evidence", () => validateApproval(old, [{ ...bootstrapDecision, id: "CHG022-READINESS-V1-APPROVAL" }]));
});

test("approval requires approved status and same-story evidence", () => {
  const pending = normal();
  pending.approval.status = "pending";
  expectError("WR_APPROVAL_REQUIRED", "$.approval.status", () => validateApproval(pending, [decisionFor(pending)]));

  const wrongStory = normal();
  expectError("WR_APPROVAL_STORY_MISMATCH", "$.approval.evidence", () => validateApproval(wrongStory, [decisionFor(wrongStory, { story: "US-999" })]));
});

test("normal ready approval requires a non-empty human approver", () => {
  const value = normal();
  value.approval.approved_by = null;
  expectError("WR_APPROVER_REQUIRED", "$.approval.approved_by", () => validateApproval(value, [decisionFor(value)]));
});

// CHG-034 §1 — replaces "a self-authored digest-bound decision is not trusted
// approval" and "approval signatures fail closed for missing trust and
// tampering". Both asserted the signing ceremony; both are now removed
// behaviour, and a suite that still exercised them would be theatre.
//
// What replaces them is the contract that actually has to hold: BOTH ledger
// shapes validate, and neither is cryptographically checked. This is the
// assertion that would have failed had §1 been implemented as the flag flip the
// design's prose implied — the 5-key path alone would have rejected all 20
// historical signed records.
// CHG-037 §2/§3 — what replaces the 17 checkpoint tests deleted with the clock.
// A suite that still exercised deleted machinery would be theatre (parent design,
// Rollout section 3), but the cut needs its own oracle: these assert what is now
// true, and each would have FAILED before the cut.

test("a long-running item no longer needs 45/90-minute controls in its actuals", () => {
  // Before: implementation actuals >= 90 minutes without an exact partition stop
  // failed WR_CHECKPOINT_PARTITION_REQUIRED. The clock cannot know where a safe
  // stopping point is, so the contract moved to the plan's task boundaries.
  const value = completed();
  value.actuals.phase_minutes.implementation = 200;
  value.actuals.total = 245;
  value.actuals.estimate_variance_minutes = 245 - value.estimate_minutes.total;
  value.signals.expected_mutation_shards = 0;
  refreshDigest(value);
  assert.equal(
    validateCompletionActuals(value, [decisionFor(value), { story: value.work_id, event: "done" }]).complete,
    true,
    "200 minutes of implementation must not require a fabricated 90-minute stop",
  );
});

test("checkpoints is accepted where history recorded it, and never validated", () => {
  // One artifact carries two real checkpoint events. Dropping the key outright
  // would fail it on the closed-key shape check — the same history-preserving
  // reasoning as CHG-036's optional attestation keys.
  const value = normal();
  value.checkpoints = [
    { elapsed_minutes: 45, status: "on_track", implementation_complete: false, evidence: "historical" },
    { elapsed_minutes: 94, status: "variance", implementation_complete: false, evidence: "historical" },
  ];
  refreshDigest(value);
  assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "ready");

  // Shapes that the old policy rejected are now simply not inspected: out-of-order
  // elapsed minutes, an unknown status, a missing field.
  value.checkpoints = [
    { elapsed_minutes: 90, status: "whatever" },
    { elapsed_minutes: 12 },
  ];
  refreshDigest(value);
  assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "ready");
});

test("an artifact with no checkpoints key at all is valid", () => {
  // What `init` now emits.
  const value = normal();
  delete value.checkpoints;
  refreshDigest(value);
  assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "ready");
});

test("a malformed checkpoints value is still refused", () => {
  // Tolerated does not mean unparsed: it must still be an array.
  const value = normal();
  value.checkpoints = "not an array";
  refreshDigest(value);
  expectError("WR_INVALID_TYPE", "$.checkpoints",
    () => validateAssessment(value, { feedbackRecords: [decisionFor(value)] }));
});

test("the feedback ledger is still append-only after the collapse", () => {
  // THE GUARD THE PARENT DESIGN WOULD HAVE CUT. WR_FEEDBACK_HISTORY_MUTATED was
  // listed as bijection machinery; it is not — it is what makes the ONE surviving
  // ledger trustworthy. Covered independently of any checkpoint.
  const { root } = makeGitRepo();
  try {
    activateReadinessPolicy(root);
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    const rewritten = prior.split("\n").slice(0, -2).join("\n") + "\n";
    writeRepoFile(root, ".nous-feedback.jsonl", rewritten);
    git(root, ["add", ".nous-feedback.jsonl"]);
    git(root, ["commit", "--no-verify", "-m", "chore: rewrite ledger history"]);
    expectError("WR_FEEDBACK_HISTORY_MUTATED", ".nous-feedback.jsonl",
      () => validateRangeOwnership({ root, base: "HEAD~1", head: "HEAD" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("both historical (signed) and current (unsigned) decision shapes validate", () => {
  // Guards the §1 correction: the design's prose read as a flag flip, but the
  // shape check is exact-length, so flipping it would have rejected all 20
  // historical signed records. Both shapes must pass, and neither is verified.
  const value = normal();
  assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "ready");
  assert.equal(
    validateAssessment(value, { feedbackRecords: [currentDecision(decisionFor(value))] }).decision,
    "ready",
    "an unsigned decision must be accepted — it is the shape every new decision takes",
  );
});

test("a leftover attestation key is shape-checked but never verified", () => {
  const value = normal();
  const historical = decisionFor(value);
  // Garbage signature: pre-CHG-034 this failed WR_APPROVAL_ATTESTATION_INVALID.
  // Now it is simply not consulted — the digest binding is the tamper-evidence.
  assert.equal(
    validateAssessment(value, { feedbackRecords: [{ ...historical, signature: "not-a-signature" }] }).decision,
    "ready",
  );
  // But an EMPTY one is still a malformed record, not a silently-ignored field.
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence",
    () => validateApproval(value, [{ ...historical, key_id: "   " }]));
});

test("the recorded human approver still binds the artifact to its decision", () => {
  // "What stays" item 3. Signing went; the human decision on record did not.
  const value = normal();
  const wrongApprover = { ...currentDecision(decisionFor(value)), approved_by: "someone-else" };
  expectError("WR_APPROVER_MISMATCH", "$.approval.approved_by", () => validateApproval(value, [wrongApprover]));
});

test("no signing trust map is consulted anywhere", () => {
  const value = normal();
  const trust = process.env.WORK_READINESS_APPROVAL_KEYS_JSON;
  delete process.env.WORK_READINESS_APPROVAL_KEYS_JSON;
  try {
    assert.equal(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }).decision, "ready");
  } finally {
    if (trust === undefined) delete process.env.WORK_READINESS_APPROVAL_KEYS_JSON;
    else process.env.WORK_READINESS_APPROVAL_KEYS_JSON = trust;
  }
});

test("a controlling CHG can approve only an explicitly digest-bound subject", () => {
  const value = normal();
  value.controlling_change = {
    work_id: "CHG-123",
    relationship: "readiness_governance",
    reason: "CHG-123 owns this exact approved partition",
  };
  refreshDigest(value);
  const controlled = decisionFor(value, { story: "CHG-123", relationship: "controlling_change" });
  assert.equal(validateAssessment(value, { feedbackRecords: [controlled] }).decision, "ready");
  const unrelated = decisionFor(value, { story: "CHG-999", relationship: "controlling_change" });
  expectError("WR_APPROVAL_CONTROL_MISMATCH", "$.approval.evidence", () => validateApproval(value, [unrelated]));
});

// CHG-066: the run-ruling keys the ledger already carries (US-021, US-067..069)
// and the substrate's IMP-417 readiness object, with their real value types.
const RUN_RULING_KEYS = {
  agent: "claude/run-ruling",
  provenance: "operator ruling recorded from the run log",
  recorded_retrospectively: true,
  run_id: "INVITE-HYGIENE-20261002",
  run_ruling_index: 21,
  source_plan: "docs/superpowers/plans/example.md",
};
const IMP417_READINESS = { readiness: { digest: "a".repeat(64), decision: "ready" } };

test("current approval evidence closes only the fields the gate reads", () => {
  const value = normal();
  const current = decisionFor(value);
  const { reason: _reason, ...missingReason } = current;
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [missingReason]));
  for (const key of ["approved_by", "subject_work_id", "relationship"]) {
    for (const malformed of ["", "  ", 7, null]) {
      expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [{ ...current, [key]: malformed }]));
    }
  }
  for (const malformed of ["ready", ["ready"], null]) {
    expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [{ ...current, readiness: malformed }]));
  }
  for (const open of [{ extra: "carried" }, RUN_RULING_KEYS, IMP417_READINESS, { ...RUN_RULING_KEYS, ...IMP417_READINESS }]) {
    assert.equal(validateAssessment(value, { feedbackRecords: [{ ...current, ...open }] }).decision, "ready");
  }
});

test("a prior run-ruling decision on the same item does not redden later approval", () => {
  const value = normal();
  const ruling = {
    story: value.work_id,
    event: "decision",
    id: `${value.work_id.replace("-", "")}-RULING-21`,
    text: "Ruling: the run log supersedes the plan for this step.",
    reason: "Operator ruling recorded from the run log.",
    ts: "2026-10-02T12:00:00Z",
    subject_work_id: value.work_id,
    relationship: "self",
    ...RUN_RULING_KEYS,
  };
  assert.equal(validateAssessment(value, { feedbackRecords: [ruling, decisionFor(value)] }).decision, "ready");
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence",
    () => validateAssessment(value, { feedbackRecords: [{ ...ruling, approved_by: "" }, decisionFor(value)] }));
});

test("approval text cannot ambiguously bind multiple decisions or digests", () => {
  const value = normal();
  const ambiguous = decisionFor(value, {
    text: `Decision blocked for readiness payload SHA-256 ${"f".repeat(64)}; Decision ready for readiness payload SHA-256 ${value.readiness_payload_sha256}.`,
  });
  expectError("WR_APPROVAL_DECISION_MISMATCH", "$.approval.evidence", () => validateApproval(value, [ambiguous]));
});


test("reapproval permits only execution covered by a prior digest-bound ready decision", () => {
  const value = normal();
  const priorReady = attestDecision({
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approved scope",
  });
  const reopening = { story: value.work_id, event: "checkpoint", elapsed_minutes: 90, status: "partition_required" };
  const records = [
    priorReady,
    { story: value.work_id, event: "started", agent: "codex" },
    reopening,
    decisionFor(value),
  ];
  assert.equal(validateApproval(value, records).payloadSha256, value.readiness_payload_sha256);

  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, [
    { story: value.work_id, event: "started", agent: "codex" },
    priorReady,
    decisionFor(value),
  ]));
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, [
    priorReady,
    reopening,
    { story: value.work_id, event: "build_pass", notes: "executed after revocation" },
    decisionFor(value),
  ]));
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, [
    priorReady,
    attestDecision({ story: value.work_id, event: "decision", id: "REVOKE", text: `Decision blocked for readiness payload SHA-256 ${"e".repeat(64)}.`, reason: "Reopened" }),
    { story: value.work_id, event: "test_report", notes: "ran after revocation" },
    decisionFor(value),
  ]));
});


test("annotation bookkeeping may precede approval while explicit evidence may not", () => {
  const value = normal();
  for (const event of ["phase", "ac_pass", "deviation"]) {
    assert.equal(validateApproval(value, [
      { story: value.work_id, event, phase: "readiness" },
      decisionFor(value),
    ]).active, true);
  }
  for (const event of ["build_pass", "ac_verify", "test_report"]) {
    expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, [
      { story: value.work_id, event, notes: "premature" },
      decisionFor(value),
    ]));
  }
});

function correctedLifecycle(value = normal()) {
  const start = { story: value.work_id, event: "started", agent: "controller", ts: "2026-10-07T03:44:39Z" };
  const approval = decisionFor(value, { ts: "2026-10-07T04:00:00Z" });
  const correction = {
    story: value.work_id, event: "lifecycle_corrected", target_event: "started",
    target_ts: "2026-10-07T03:44:39Z", disposition: "not_execution",
    reason: "Controller readiness bookkeeping", approved_by: "user", ts: "2026-10-10T15:00:00Z",
  };
  return [start, approval, correction];
}

test("a later constrained correction exempts exactly one historical bookkeeping start", () => {
  const value = normal();
  const records = correctedLifecycle(value);
  const original = clone(records);
  assert.deepEqual([...validateLifecycleCorrections(records, value.work_id).correctedStartIndices], [0]);
  assert.equal(validateLifecycleCorrections(records, "US-999").correctedStarts, 0);
  assert.equal(validateApproval(value, records).active, true);
  assert.equal(validateApproval(value, records).correctedStarts, 1);
  assert.equal(validateAssessment(value, { feedbackRecords: records }).correctedStarts, 1);
  assert.deepEqual(records, original);
});

test("correction rejects raw evidence, malformed binding, missing approver and foreign story", () => {
  const value = normal();
  const [start, approval, correction] = correctedLifecycle(value);
  const reject = (records) => expectError("WR_CORRECTION_INVALID", "$.approval.evidence", () => validateApproval(value, records));
  for (const event of ["build_pass", "ac_verify", "test_report"]) {
    reject([start, { story: value.work_id, event }, approval, correction]);
  }
  for (const mutate of [
    (record) => { delete record.approved_by; },
    (record) => { record.reason = " "; },
    (record) => { record.target_event = "done"; },
    (record) => { record.disposition = "execution"; },
    (record) => { record.target_ts = "2026-10-07T03:44:40Z"; },
    (record) => { record.target_ts = "2026-02-30T03:44:39Z"; },
    (record) => { record.ts = "2026-10-10T15:00:00"; },
    (record) => { record.ts = approval.ts; },
    (record) => { record.extra = true; },
  ]) {
    const changed = clone(correction);
    mutate(changed);
    reject([start, approval, changed]);
  }
  reject([approval, correction]);
  reject([start, { ...start }, approval, correction]);
  reject([start, approval, correction, { ...correction }]);
  reject([start, { story: value.work_id, event: "build_pass" }, approval, {
    story: value.work_id, event: "evidence_superseded", ref: "US123-RAW-BUILD",
    target: { story: value.work_id, event: "build_pass" }, reason: "Later projection cannot erase raw evidence",
  }, correction]);
  const firstApproval = decisionFor(value, { id: "US123-FIRST", ts: "2026-10-07T03:40:00Z" });
  reject([firstApproval, start, approval, correction]);
  reject([start, { ...approval, text: "Decision ready without digest" }, correction]);
  reject([start, approval, { ...approval }, correction]);
  reject([start, correction, approval]);
  reject([approval, start, correction]);
  reject([start, { ...approval, ts: "invalid" }, correction]);
  reject([start, { ...approval, approved_by: " " }, correction]);
  reject([start, { ...approval, subject_work_id: "US-999" }, correction]);
  const foreign = normal({ work_id: "US-999" });
  reject([start, decisionFor(foreign, { ts: approval.ts }), { ...correction, story: foreign.work_id }]);
});

test("selected approval becomes inactive after raw, deferred, and projected terminals", () => {
  const value = normal();
  for (const terminal of ["done", "done_with_deferral", "done_with_external_deferral"]) {
    assert.deepEqual(validateApproval(value, [
      decisionFor(value),
      { story: value.work_id, event: terminal },
    ]), {
      evidence: value.approval.evidence,
      payloadSha256: value.readiness_payload_sha256,
      active: false,
      inactiveReason: "terminal",
      correctedStarts: 0,
    });
  }
  const changeDecision = { story: "CHG-099", event: "decision", id: "CHG099-TERMINAL", text: "Repair terminal", reason: "Review" };
  assert.equal(validateApproval(value, [
    decisionFor(value),
    changeDecision,
    { story: value.work_id, event: "done" },
    {
      story: value.work_id, event: "evidence_superseded", ref: "US123-DONE-ACTIVE",
      target: { story: value.work_id, event: "done" }, reason: "Revalidate terminal",
    },
    { story: value.work_id, event: "revalidated", ref: "US123-DONE-ACTIVE", change: "CHG-099", as_event: "done" },
  ]).active, false);
});

test("later readiness decision stales selected evidence and explicit fresh reapproval restores it", () => {
  const value = normal();
  const selected = decisionFor(value);
  const later = decisionFor(value, { id: "US123-READY-V2", reason: "Fresh review" });
  expectError("WR_APPROVAL_INACTIVE", "$.approval.evidence", () => validateApproval(value, [selected, later]));

  const refreshed = clone(value);
  refreshed.approval.evidence = later.id;
  assert.equal(validateApproval(refreshed, [
    selected,
    { story: value.work_id, event: "blocker", reason: "Scope reopened" },
    later,
  ]).active, true);
});

test("a deviation after the terminal event is informational; other evidence after done still fails", () => {
  const value = normal();
  const lifecycle = [
    decisionFor(value),
    { story: value.work_id, event: "started", agent: "codex" },
    { story: value.work_id, event: "done" },
  ];
  const note = { story: value.work_id, event: "deviation", notes: "Local integration evidence (informational)." };
  assert.equal(validateApproval(value, [...lifecycle, note]).payloadSha256, value.readiness_payload_sha256);
  for (const [event, extra] of [["started", { agent: "codex" }], ["ac_pass", { ac: 1 }], ["build_pass", { notes: "after done" }], ["test_report", { mutation_score: 100 }]]) {
    expectError("WR_APPROVAL_ORDER", "$.approval.evidence",
      () => validateApproval(value, [...lifecycle, note, { story: value.work_id, event, ...extra }]));
  }
  expectError("WR_APPROVAL_INACTIVE", "$.approval.evidence", () => validateApproval(value, [
    ...lifecycle,
    { story: value.work_id, event: "blocked", reason: "Reopened after done" },
    note,
  ]));
});

test("normal terminal events close prior authorization", () => {
  const value = normal();
  const priorReady = attestDecision({
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approved scope",
  });
  for (const terminal of ["done", "done_with_deferral"]) {
    expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, [
      priorReady,
      { story: value.work_id, event: terminal },
      { story: value.work_id, event: "started", agent: "codex" },
      decisionFor(value),
    ]));
  }
});

test("unknown same-story feedback events fail closed", () => {
  const value = normal();
  expectError("WR_APPROVAL_EVENT_UNKNOWN", "$.approval.evidence", () => validateApproval(value, [
    { story: value.work_id, event: "invented_execution_signal" },
    decisionFor(value),
  ]));
});

test("prior approval authorization requires a closed unambiguous decision record", () => {
  const value = normal();
  const digest = "f".repeat(64);
  const current = decisionFor(value);
  const fabricatedWithoutId = {
    story: value.work_id,
    event: "decision",
    text: `Decision ready for readiness payload SHA-256 ${digest}.`,
    reason: "Fabricated",
  };
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [
    fabricatedWithoutId,
    { story: value.work_id, event: "started", agent: "codex" },
    current,
  ]));

  const validPrior = attestDecision({ ...fabricatedWithoutId, id: "US123-READY-V1" });
  const malformedCases = [
    attestDecision({ ...validPrior, id: "AMBIGUOUS", text: `Decision blocked then Decision ready for readiness payload SHA-256 ${digest}.` }),
    attestDecision({ ...validPrior, id: "BAD-HASH", text: "Decision ready for readiness payload SHA-256 abc." }),
    attestDecision({ ...validPrior, id: "BAD-TOKEN", text: `Decision Ready for readiness payload SHA-256 ${digest}.` }),
    attestDecision({ ...validPrior, id: "TWO-HASHES", text: `Decision ready for SHA-256 ${digest} and SHA-256 ${"e".repeat(64)}.` }),
    attestDecision({ ...validPrior, id: "BAD-READINESS", readiness: "ready" }),
    attestDecision({ ...validPrior, id: "BAD-APPROVER", approved_by: "" }),
  ];
  for (const malformed of malformedCases) {
    expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [
      validPrior,
      malformed,
      { story: value.work_id, event: "ac_pass", ac: 1, notes: "must not retain authorization" },
      current,
    ]));
  }
});

test("duplicate prior approval evidence IDs fail closed", () => {
  const value = normal();
  const prior = attestDecision({
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approval",
  });
  expectError("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", () => validateApproval(value, [
    prior,
    { ...prior },
    decisionFor(value),
  ]));
});

test("prior authorization IDs are globally unique across stories and chronology", () => {
  const value = normal();
  const prior = attestDecision({
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approval",
  });
  const execution = { story: value.work_id, event: "started", agent: "codex" };
  const current = decisionFor(value);
  expectError("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", () => validateApproval(value, [
    { ...prior, story: "US-999" },
    prior,
    execution,
    current,
  ]));
  expectError("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", () => validateApproval(value, [
    prior,
    execution,
    current,
    { ...prior, story: "US-999" },
  ]));
});

test("partition approval binds each official child ID exactly once", () => {
  const value = partitioned();
  value.partitions[0].work_id = "CHG-124";
  value.partitions[1].work_id = "CHG-125";
  refreshDigest(value);
  const completeText = `${decisionFor(value).text} Approved official children: CHG-124, CHG-125.`;
  assert.equal(validateApproval(value, [decisionFor(value, { text: completeText })]).payloadSha256, value.readiness_payload_sha256);
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [decisionFor(value, { text: `${decisionFor(value).text} Approved official child: CHG-124.` })]));
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [decisionFor(value, { text: `${completeText} Duplicate CHG-124.` })]));
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [decisionFor(value, { text: `${decisionFor(value).text} Approved official children: CHG-1240, CHG-125.` })]));
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [decisionFor(value, { text: `${completeText} Undeclared CHG-999.` })]));
});

test("local-only partition approval rejects undeclared official ID tokens", () => {
  const value = partitioned();
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [decisionFor(value, { text: `${decisionFor(value).text} Undeclared CHG-999.` })]));
});

test("accepts only the exact CHG-022 bootstrap artifact and V2 decision", () => {
  assert.equal(classifyAssessment(bootstrap), "ready");
  assert.equal(validateAssessment(bootstrap, { feedbackRecords: [bootstrapDecision] }).decision, "ready");
  for (const [field, mutate, path] of [
    ["manifest", (v) => v.bootstrap_authorization.allowed_paths.reverse(), "$.bootstrap_authorization.allowed_paths"],
    ["title", (v) => { v.title += " changed"; }, "$.title"],
    ["source", (v) => { v.source = "docs/other.md"; }, "$.source"],
    ["plan", (v) => { v.bootstrap_authorization.plan_commit = "f".repeat(40); }, "$.bootstrap_authorization.plan_commit"],
    ["expiry", (v) => { v.bootstrap_authorization.expires_on_event = "verified"; }, "$.bootstrap_authorization.expires_on_event"],
  ]) {
    const altered = clone(bootstrap);
    mutate(altered);
    expectError("WR_INVALID_BOOTSTRAP", path, () => validateAssessment(altered, { feedbackRecords: [bootstrapDecision] }));
  }
});

test("bootstrap classification rejects a readiness mutation with retained digests", () => {
  const value = clone(bootstrap);
  value.outcomes[0].statement = "Tampered after approval";
  expectError("WR_APPROVAL_DIGEST_MISMATCH", "$.readiness_payload_sha256", () => classifyAssessment(value));
});

test("bootstrap semantic object comparisons ignore key insertion order", () => {
  const value = clone(bootstrap);
  value.estimate_minutes = Object.fromEntries(Object.entries(value.estimate_minutes).reverse());
  value.bootstrap_authorization = Object.fromEntries(Object.entries(value.bootstrap_authorization).reverse());
  assert.equal(classifyAssessment(value), "ready");
  assert.equal(validateAssessment(value, { feedbackRecords: [bootstrapDecision] }).decision, "ready");
});

test("bootstrap approval explicitly binds provenance, ordered paths, and first-done expiry", () => {
  for (const text of [
    bootstrapDecision.text.replace(bootstrap.bootstrap_authorization.design_commit, "f".repeat(40)),
    bootstrapDecision.text.replace(bootstrap.bootstrap_authorization.plan_commit, "f".repeat(40)),
    bootstrapDecision.text.replace("; scripts/work-readiness/model.mjs", "; scripts/work-readiness/model.mjs; extra/path"),
    bootstrapDecision.text.replace("expires on CHG-022's first valid terminal done event", "expires later"),
  ]) {
    expectError("WR_BOOTSTRAP_APPROVAL_BINDING", "$.approval.evidence", () => validateApproval(bootstrap, [{ ...bootstrapDecision, text }]));
  }
});


test("bootstrap completion recognizes canonical deferral and projected terminal events", () => {
  const value = completedBootstrap();
  assert.equal(validateAssessment(value, {
    feedbackRecords: [bootstrapDecision, bootstrapCheckpointDeviation(180), { story: "CHG-022", event: "done_with_deferral" }],
  }).active, false);

  const changeDecision = { story: "CHG-099", event: "decision", id: "CHG099-REPAIR", text: "Repair terminal evidence", reason: "Review" };
  const supersession = {
    story: "CHG-022",
    event: "evidence_superseded",
    ref: "CHG022-DONE-1",
    target: { story: "CHG-022", event: "done" },
    reason: "Revalidate completion",
  };
  const projectedDone = {
    story: "CHG-022",
    event: "revalidated",
    ref: "CHG022-DONE-1",
    change: "CHG-099",
    as_event: "done",
  };
  assert.equal(validateAssessment(value, {
    feedbackRecords: [bootstrapDecision, bootstrapCheckpointDeviation(180), changeDecision, { story: "CHG-022", event: "done" }, supersession, projectedDone],
  }).complete, true);
});

test("bootstrap rejects terminal evidence before V2 approval", () => {
  const records = [{ story: "CHG-022", event: "done" }, bootstrapDecision];
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateAssessment(bootstrap, { feedbackRecords: records }));
});

test("bootstrap permits its one historical start and earlier decisions before V2", () => {
  const records = [
    { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" },
    { story: "CHG-022", event: "decision", id: "CHG022-READINESS-APPROVAL", text: "Initial direction", reason: "Initial" },
    { story: "CHG-022", event: "decision", id: "CHG022-READINESS-V1-APPROVAL", text: "Superseded authority", reason: "Refresh required" },
    bootstrapDecision,
  ];
  assert.equal(validateAssessment(bootstrap, { feedbackRecords: records }).decision, "ready");
});

test("bootstrap historical start exception requires the exact committed record", () => {
  const invalidStarts = [
    { story: "CHG-022", event: "started" },
    { story: "CHG-022", event: "started", agent: "another-agent" },
    { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate", notes: "substituted semantics" },
  ];
  for (const started of invalidStarts) {
    expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateAssessment(bootstrap, {
      feedbackRecords: [started, bootstrapDecision],
    }));
  }
});

test("bootstrap historical start cannot be replayed across a revoked interval", () => {
  const priorReady = {
    story: "CHG-022",
    event: "decision",
    id: "CHG022-PRIOR",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior authorization",
  };
  const records = [
    priorReady,
    { story: "CHG-022", event: "blocker", reason: "Prior authorization revoked" },
    { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" },
    bootstrapDecision,
  ];
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateAssessment(bootstrap, { feedbackRecords: records }));
});

test("bootstrap historical start is rejected after authorization and when duplicated", () => {
  const start = { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" };
  const priorReady = {
    story: "CHG-022",
    event: "decision",
    id: "CHG022-PRIOR",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior authorization",
  };
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateAssessment(bootstrap, {
    feedbackRecords: [priorReady, start, bootstrapDecision],
  }));
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateAssessment(bootstrap, {
    feedbackRecords: [start, { ...start }, bootstrapDecision],
  }));
});

test("bootstrap prior ready decisions never authorize pre-V2 execution evidence", () => {
  const priorReady = {
    story: "CHG-022",
    event: "decision",
    id: "CHG022-FABRICATED-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Must not authorize bootstrap execution",
  };
  const executionRecords = [
    { story: "CHG-022", event: "build_pass", notes: "unauthorized" },
    { story: "CHG-022", event: "done" },
    { story: "CHG-022", event: "started", agent: "not-the-historical-agent" },
  ];
  for (const execution of executionRecords) {
    expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateAssessment(bootstrap, {
      feedbackRecords: [priorReady, execution, bootstrapDecision],
    }));
  }
});

function completed() {
  const value = normal();
  value.actuals = {
    phase_minutes: { readiness: 12, implementation: 44, focused_verification: 18, review: 10, integration: 5 },
    total: 89,
    changed_files: 7,
    commits: 2,
    review_fix_loops: 1,
    cold_mutation_attempts: 1,
    mutation_invalidations: 0,
    estimate_variance_minutes: -11,
    root_cause: "Implementation reused an existing component.",
  };
  return value;
}

function correctionFixture() {
  const value = completed();
  const authority = approvedArtifact("CHG-059");
  value.actuals.changed_files = 11;
  value.actuals.root_cause = "Raw changed-file count was captured from formatted output.";
  const replacement = clone(value.actuals);
  replacement.changed_files = 8;
  replacement.root_cause = "Raw Git output proves eight changed paths.";
  const records = [
    decisionFor(value),
    { story: value.work_id, event: "started", agent: "correction-test", ts: "2026-09-08T13:00:00Z" },
    { story: value.work_id, event: "build_pass", notes: "Focused gate passed", ts: "2026-09-08T13:30:00Z" },
    { story: value.work_id, event: "test_report", mutation_score: 100, ts: "2026-09-08T13:45:00Z" },
    { story: value.work_id, event: "done", ts: "2026-09-08T14:00:00Z" },
    decisionFor(authority, {
      reason: "Primary Git evidence disproves the recorded count.",
      ts: "2026-09-08T14:30:00Z",
    }),
  ];
  const correction = {
    story: value.work_id,
    event: "actuals_corrected",
    ref: "US123-ACTUALS-1",
    change: "CHG-059",
    target_actuals_sha256: "e414beafbd3df81d431cbd0f7406829e5fc3a4f3a553ca24e3e004748568fae3",
    replacement_actuals: replacement,
    reason: "The formatted display was counted instead of raw Git paths.",
    evidence: ["git diff --name-only -z authority/base..HEAD reports 8 paths"],
    ts: "2026-09-08T15:00:00Z",
  };
  return { value, authority, replacement, records, correction };
}

function correctionAuthorityDecision(workId, overrides = {}) {
  return decisionFor(approvedArtifact(workId), {
    reason: "Primary evidence authorizes a factual correction.",
    ...overrides,
  });
}

function correctionReasons(result) {
  return result.errors.map((error) => error.reason);
}

function correctionContext(value) {
  const authorities = [approvedArtifact("CHG-059"), approvedArtifact("CHG-060")];
  return {
    assessment: value,
    approvedReadinessAuthorities: new Map(authorities.map((authority) => [authority.work_id, {
      digest: authority.readiness_payload_sha256,
      evidence: authority.approval.evidence,
      approvedBy: authority.approval.approved_by,
    }])),
  };
}

test("canonical actuals hash is compact recursive-key-sorted UTF-8", () => {
  const left = { z: 1, a: { y: [3, 2, 1], x: "é" } };
  const right = { a: { x: "é", y: [3, 2, 1] }, z: 1 };
  const expected = "ab81c23f5f2102b8460bee81e88bdafb1a7a80c05b5a5bcfe063da8340a906b7";
  assert.equal(canonicalActualsSha256(left), expected);
  assert.equal(canonicalActualsSha256(right), expected);
  for (const invalid of [null, [], "actuals", 8]) {
    assert.throws(() => canonicalActualsSha256(invalid), TypeError);
  }
});

test("valid actuals correction preserves raw evidence and resolves a complete replacement", () => {
  const { value, replacement, records, correction } = correctionFixture();
  const rawBefore = clone(value.actuals);
  const recordsBefore = clone([...records, correction]);
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(result, {
    raw: rawBefore,
    effective: replacement,
    corrections: [correction],
    errors: [],
  });
  assert.equal(result.raw.changed_files, 11);
  assert.equal(result.effective.changed_files, 8);
  assert.deepEqual(value.actuals, rawBefore);
  assert.deepEqual([...records, correction], recordsBefore);
  assert.notEqual(result.raw, value.actuals);
  assert.notEqual(result.effective, correction.replacement_actuals);
});

test("uncorrected completion keeps raw and effective actuals compatible without aliasing", () => {
  const { value, records } = correctionFixture();
  const result = resolveEffectiveActuals(value.actuals, records, correctionContext(value));
  assert.deepEqual(result, { raw: value.actuals, effective: value.actuals, corrections: [], errors: [] });
  assert.notEqual(result.raw, value.actuals);
  assert.notEqual(result.effective, value.actuals);
  assert.notEqual(result.raw, result.effective);
});

test("actuals correction rejects stale and forged targets without changing effective actuals", () => {
  for (const target of ["0".repeat(64), "f".repeat(64)]) {
    const { value, records, correction } = correctionFixture();
    correction.target_actuals_sha256 = target;
    const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
    assert.deepEqual(result.effective, value.actuals);
    assert.deepEqual(result.corrections, []);
    assert.deepEqual(correctionReasons(result), ["target_hash_mismatch"]);
  }
});

test("globally duplicated correction refs invalidate every occurrence", () => {
  const { value, records, correction } = correctionFixture();
  const otherStory = { ...clone(correction), story: "US-999" };
  const result = resolveEffectiveActuals(value.actuals, [...records, correction, otherStory], correctionContext(value));
  assert.deepEqual(result.effective, value.actuals);
  assert.deepEqual(result.corrections, []);
  assert.deepEqual(correctionReasons(result), ["duplicate_ref"]);
  assert.match(result.errors[0].detail, /2 times/u);
});

test("a raw-hash replay forks the chain and leaves the accepted prefix effective", () => {
  const { value, replacement, records, correction } = correctionFixture();
  const replay = {
    ...clone(correction),
    ref: "US123-ACTUALS-2",
    change: "CHG-060",
    ts: "2026-09-08T16:00:00Z",
  };
  records.push(correctionAuthorityDecision("CHG-060"));
  const result = resolveEffectiveActuals(value.actuals, [...records, correction, replay], correctionContext(value));
  assert.deepEqual(result.effective, replacement);
  assert.deepEqual(result.corrections, [correction]);
  assert.deepEqual(correctionReasons(result), ["target_hash_mismatch"]);
});

test("actuals correction requires a strict UTC timestamp after its terminal", () => {
  for (const [timestamp, reason] of [
    ["not-a-timestamp", "invalid_timestamp"],
    ["2026-09-08T10:00:00-05:00", "invalid_timestamp"],
    ["2026-09-08T14:00:00Z", "not_after_terminal"],
    ["2026-09-08T13:59:59Z", "not_after_terminal"],
  ]) {
    const { value, records, correction } = correctionFixture();
    correction.ts = timestamp;
    const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
    assert.deepEqual(correctionReasons(result), [reason]);
    assert.deepEqual(result.effective, value.actuals);
  }
});

test("actuals correction requires a prior validated change decision by ledger order", () => {
  for (const variant of ["missing", "after", "malformed"]) {
    const { value, records, correction } = correctionFixture();
    const decisionIndex = records.findIndex((record) => record.story === "CHG-059");
    const [decision] = records.splice(decisionIndex, 1);
    if (variant === "malformed") {
      decision.reason = "";
      records.push(decision);
    }
    const history = variant === "after" ? [...records, correction, decision] : [...records, correction];
    const result = resolveEffectiveActuals(value.actuals, history, correctionContext(value));
    assert.deepEqual(correctionReasons(result), ["missing_decision"]);
    assert.deepEqual(result.effective, value.actuals);
  }
});

test("only a canonical digest-bound ready self-decision authorizes correction", () => {
  const variants = [
    (decision) => {
      for (const key of ["approved_by", "subject_work_id", "relationship"]) delete decision[key];
      decision.text = "Legacy prose approval without readiness digest binding.";
    },
    (decision) => { decision.text = `Decision blocked for readiness payload SHA-256 ${"a".repeat(64)}.`; },
    (decision) => { decision.subject_work_id = "CHG-060"; },
    (decision) => { decision.relationship = "controlling_change"; },
    (decision) => { decision.readiness = "ready"; },
    (decision) => { decision.approved_by = ""; },
  ];
  for (const mutate of variants) {
    const { value, records, correction } = correctionFixture();
    mutate(records.find((record) => record.story === "CHG-059"));
    const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
    assert.deepEqual(correctionReasons(result), ["missing_decision"]);
    assert.deepEqual(result.effective, value.actuals);
  }
});

test("a correction authority decision may carry unknown keys and the IMP-417 readiness object", () => {
  const { value, records, correction } = correctionFixture();
  Object.assign(records.find((record) => record.story === "CHG-059"), RUN_RULING_KEYS, IMP417_READINESS);
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(correctionReasons(result), []);
  assert.equal(result.effective.changed_files, 8);
});

test("correction authority digest must match trusted readiness", () => {
  const { value, records, correction } = correctionFixture();
  records.find((record) => record.story === "CHG-059").text = `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`;
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], {
    assessment: value,
    approvedReadinessAuthorities: correctionContext(value).approvedReadinessAuthorities,
  });
  assert.deepEqual(correctionReasons(result), ["missing_decision"]);
  assert.deepEqual(result.effective, value.actuals);
});

test("correction refs are unique across every feedback event family", () => {
  const { value, records, correction } = correctionFixture();
  records.push({
    story: "US-999",
    event: "evidence_superseded",
    ref: correction.ref,
    target: { story: "US-999", event: "done" },
    reason: "Historical lineage already owns this reference.",
  });
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(correctionReasons(result), ["duplicate_ref"]);
  assert.deepEqual(result.effective, value.actuals);
});

test("correction cannot invent a cold campaign without retained evidence", () => {
  const { value, records, correction } = correctionFixture();
  value.actuals.cold_mutation_attempts = 0;
  value.actuals.mutation_invalidations = 0;
  value.signals.expected_mutation_shards = 0;
  correction.target_actuals_sha256 = canonicalActualsSha256(value.actuals);
  records.splice(records.findIndex((record) => record.event === "test_report"), 1);
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(correctionReasons(result), ["invalid_replacement_actuals"]);
  assert.deepEqual(result.effective, value.actuals);
});

test("correction cannot erase a cold campaign with retained final evidence", () => {
  const { value, records, correction } = correctionFixture();
  value.signals.expected_mutation_shards = 0;
  correction.target_actuals_sha256 = canonicalActualsSha256(value.actuals);
  correction.replacement_actuals.cold_mutation_attempts = 0;
  correction.replacement_actuals.mutation_invalidations = 0;
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(correctionReasons(result), ["invalid_replacement_actuals"]);
  assert.deepEqual(result.effective, value.actuals);
});

test("a stamped correcting decision must be timestamp-consistent with ledger order", () => {
  for (const timestamp of ["invalid", "2026-09-08T10:00:00-05:00", "2026-09-08T15:00:00Z", "2026-09-08T15:00:01Z"]) {
    const { value, records, correction } = correctionFixture();
    records.find((record) => record.story === "CHG-059").ts = timestamp;
    const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
    assert.deepEqual(correctionReasons(result), [timestamp.startsWith("2026-09-08T15") ? "decision_not_before_correction" : "invalid_decision_timestamp"]);
  }
});

test("correction authority uses the earliest canonical decision like Nous", () => {
  const { value, records, correction } = correctionFixture();
  records.push(correctionAuthorityDecision("CHG-059", {
    id: "CHG059-LATER-READY",
    ts: correction.ts,
  }));
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.effective, correction.replacement_actuals);
});

test("actuals correction rejects wrong story and malformed change identities", () => {
  const { value, records, correction } = correctionFixture();
  correction.story = "US-999";
  let result = resolveEffectiveActuals(value.actuals, [...records, correction], { assessment: value, correctionEvents: [correction] });
  assert.deepEqual(correctionReasons(result), ["story_mismatch"]);

  const malformed = correctionFixture();
  malformed.correction.change = "IMP-404";
  result = resolveEffectiveActuals(malformed.value.actuals, [...malformed.records, malformed.correction], { assessment: malformed.value });
  assert.deepEqual(correctionReasons(result), ["invalid_schema"]);
});

test("actuals correction cannot precede the effective terminal in ledger order", () => {
  const { value, records, correction } = correctionFixture();
  const terminalIndex = records.findIndex((record) => record.event === "done");
  records.splice(terminalIndex, 0, correction);
  const result = resolveEffectiveActuals(value.actuals, records, correctionContext(value));
  assert.deepEqual(correctionReasons(result), ["not_after_terminal"]);
  assert.deepEqual(result.effective, value.actuals);
});

test("completion validation rejects a correction when no terminal ever exists", () => {
  const { value, records, correction } = correctionFixture();
  const withoutTerminal = records.filter((record) => record.event !== "done");
  expectError("WR_ACTUALS_CORRECTION_MISSING_TERMINAL", "$feedback[0]", () => validateCompletionActuals(
    value,
    [...withoutTerminal, correction],
  ));
});

test("Nous timestamp differential accepts a full microsecond advance", () => {
  const { value, records, correction } = correctionFixture();
  records.find((record) => record.event === "done").ts = "2026-09-08T14:00:00.000001Z";
  records.find((record) => record.story === "CHG-059").ts = "2026-09-08T14:00:00.0000015Z";
  correction.ts = "2026-09-08T14:00:00.000002Z";
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.effective, correction.replacement_actuals);
});

test("Nous timestamp differential rejects nanosecond changes within one microsecond", () => {
  const { value, records, correction } = correctionFixture();
  records.find((record) => record.event === "done").ts = "2026-09-08T15:00:00.000001100Z";
  correction.ts = "2026-09-08T15:00:00.000001200Z";
  const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
  assert.deepEqual(correctionReasons(result), ["not_after_terminal"]);
  assert.deepEqual(result.effective, value.actuals);
});

test("replacement actuals must be complete and satisfy arithmetic and campaign evidence", () => {
  const cases = [
    { mutate: (replacement) => { delete replacement.phase_minutes.review; }, reason: "incomplete_replacement" },
    { mutate: (replacement) => { replacement.total += 1; }, reason: "invalid_replacement_actuals" },
  ];
  for (const { mutate, reason } of cases) {
    const { value, records, correction } = correctionFixture();
    mutate(correction.replacement_actuals);
    const result = resolveEffectiveActuals(value.actuals, [...records, correction], correctionContext(value));
    assert.deepEqual(correctionReasons(result), [reason]);
    assert.deepEqual(result.effective, value.actuals);
  }
});

test("two corrections must form one timestamped linear hash chain", () => {
  const { value, replacement, records, correction } = correctionFixture();
  const secondReplacement = clone(replacement);
  secondReplacement.changed_files = 9;
  secondReplacement.root_cause = "A later primary-source recount proves nine paths.";
  const second = {
    ...clone(correction),
    ref: "US123-ACTUALS-2",
    change: "CHG-060",
    target_actuals_sha256: "cdc64d6fcb20e54ae8287cdab3a9baa53d3e9eb6996fbdb0078ef6fcfc0efc77",
    replacement_actuals: secondReplacement,
    ts: "2026-09-08T16:00:00+00:00",
  };
  records.push(correctionAuthorityDecision("CHG-060"));
  const result = resolveEffectiveActuals(value.actuals, [...records, correction, second], correctionContext(value));
  assert.deepEqual(result, { raw: value.actuals, effective: secondReplacement, corrections: [correction, second], errors: [] });

  second.ts = correction.ts;
  const invalid = resolveEffectiveActuals(value.actuals, [...records, correction, second], correctionContext(value));
  assert.deepEqual(correctionReasons(invalid), ["not_after_previous_correction"]);
  assert.deepEqual(invalid.effective, replacement);
});

function completedBootstrap() {
  const value = clone(bootstrap);
  value.actuals = {
    phase_minutes: { readiness: 30, implementation: 180, focused_verification: 60, review: 60, integration: 30 },
    total: 360,
    changed_files: 5,
    commits: 1,
    review_fix_loops: 1,
    cold_mutation_attempts: 1,
    mutation_invalidations: 0,
    estimate_variance_minutes: 0,
    root_cause: "Completed the authorized policy bootstrap within its recorded estimate.",
  };
  return value;
}

test("actuals may be null before done but are required and recomputed at done", () => {
  const value = normal();
  assert.deepEqual(validateCompletionActuals(value, []), { complete: false });
  expectError("WR_ACTUALS_REQUIRED", "$.actuals", () => validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]));
  const bad = completed();
  bad.actuals.total = 96;
  expectError("WR_ACTUALS_TOTAL_MISMATCH", "$.actuals.total", () => validateCompletionActuals(bad, [{ story: bad.work_id, event: "done" }]));
  const missing = completed();
  missing.actuals.root_cause = null;
  expectError("WR_ACTUALS_INCOMPLETE", "$.actuals.root_cause", () => validateCompletionActuals(missing, [{ story: missing.work_id, event: "done" }]));
});

test("mutation_minutes is optional and, when present, is a non-negative integer", () => {
  const historical = completed();
  assert.equal(Object.hasOwn(historical.actuals, "mutation_minutes"), false);
  assert.equal(validateAssessment(historical, {
    feedbackRecords: [decisionFor(historical), { story: historical.work_id, event: "done" }],
  }).complete, true);

  for (const minutes of [0, 1, 137]) {
    const measured = completed();
    measured.actuals.mutation_minutes = minutes;
    assert.equal(validateAssessment(measured, {
      feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
    }).complete, true);
  }

  for (const invalid of [-1, 1.5, null, "4"]) {
    const measured = completed();
    measured.actuals.mutation_minutes = invalid;
    expectError("WR_INVALID_INTEGER", "$.actuals.mutation_minutes", () => validateAssessment(measured, {
      feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
    }));
  }
});

test("mutation_shards_actual reports an optional observed count without rejecting readiness", () => {
  const historical = completed();
  assert.equal(Object.hasOwn(historical.actuals, "mutation_shards_actual"), false);
  assert.equal(validateAssessment(historical, {
    feedbackRecords: [decisionFor(historical), { story: historical.work_id, event: "done" }],
  }).complete, true);

  for (const count of [0, 1, 11]) {
    const measured = completed();
    measured.actuals.mutation_shards_actual = count;
    assert.equal(validateAssessment(measured, {
      feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
    }).complete, true);
  }

  const mismatch = completed();
  mismatch.signals.expected_mutation_shards = 1;
  mismatch.actuals.mutation_shards_actual = 11;
  refreshDigest(mismatch);
  assert.equal(validateAssessment(mismatch, {
    feedbackRecords: [decisionFor(mismatch), {
      story: mismatch.work_id,
      event: "deviation",
      notes: "Preflight calculated eleven shards after approval.",
    }, { story: mismatch.work_id, event: "done" }],
  }).complete, true, "an observed shard mismatch is evidence, never a readiness rejection");

  for (const invalid of [-1, 1.5, null, "4"]) {
    const measured = completed();
    measured.actuals.mutation_shards_actual = invalid;
    expectError("WR_INVALID_INTEGER", "$.actuals.mutation_shards_actual", () => validateAssessment(measured, {
      feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
    }));
  }
});


test("completed normal assessment remains valid but cannot authorize more implementation", () => {
  const value = completed();
  const records = [decisionFor(value), { story: value.work_id, event: "done" }];
  assert.deepEqual(validateAssessment(value, { feedbackRecords: records }), {
    decision: "ready", active: false, complete: true, inactiveReason: "terminal", correctedStarts: 0,
  });
  const missing = normal();
  expectError("WR_ACTUALS_REQUIRED", "$.actuals", () => validateAssessment(missing, {
    feedbackRecords: [decisionFor(missing), { story: missing.work_id, event: "done" }],
  }));
  value.actuals.estimate_variance_minutes += 1;
  expectError("WR_ACTUALS_VARIANCE_MISMATCH", "$.actuals.estimate_variance_minutes", () => validateAssessment(value, { feedbackRecords: records }));
});

test("canonical done-with-deferral requires and completes actuals", () => {
  const unfinished = normal();
  expectError("WR_ACTUALS_REQUIRED", "$.actuals", () => validateCompletionActuals(unfinished, [
    { story: unfinished.work_id, event: "done_with_external_deferral" },
  ]));
  const value = completed();
  assert.equal(validateCompletionActuals(value, [
    { story: value.work_id, event: "done_with_external_deferral" },
  ]).complete, true);
});

test("malformed projected terminal fails closed", () => {
  const value = normal();
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, [{
    story: value.work_id,
    event: "revalidated",
    ref: "MISSING-SUPERSESSION",
    change: "CHG-099",
    as_event: "done",
  }]));

  const completedValue = completed();
  const changeDecision = { story: "CHG-099", event: "decision", id: "CHG099-REPAIR", text: "Repair", reason: "Review" };
  const supersessionWithoutTarget = {
    story: completedValue.work_id,
    event: "evidence_superseded",
    ref: "US123-DONE-1",
    target: { story: completedValue.work_id, event: "done" },
    reason: "Missing original target",
  };
  const projection = {
    story: completedValue.work_id,
    event: "revalidated",
    ref: "US123-DONE-1",
    change: "CHG-099",
    as_event: "done",
  };
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(completedValue, [
    changeDecision,
    supersessionWithoutTarget,
    projection,
  ]));
});

function projectedTerminalRecords(value) {
  return [
    { story: "CHG-099", event: "decision", id: "CHG099-REPAIR", text: "Repair", reason: "Review" },
    { story: value.work_id, event: "done" },
    {
      story: value.work_id,
      event: "evidence_superseded",
      ref: `${value.work_id}-DONE-1`,
      target: { story: value.work_id, event: "done" },
      reason: "Revalidate terminal",
    },
    {
      story: value.work_id,
      event: "revalidated",
      ref: `${value.work_id}-DONE-1`,
      change: "CHG-099",
      as_event: "done",
    },
  ];
}

test("terminal projection rejects unresolved and malformed supersession chains", () => {
  const value = completed();
  const valid = projectedTerminalRecords(value);
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, valid.slice(0, -1)));
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, [
    ...valid.slice(0, -1),
    { ...valid.at(-1), extra: "not canonical" },
  ]));
});

test("canonical terminal projection replaces its raw target", () => {
  const value = completed();
  assert.equal(validateCompletionActuals(value, projectedTerminalRecords(value)).complete, true);
});

test("terminal projection accepts a closed change decision after supersession but before replacement", () => {
  const value = completed();
  const approval = decisionFor(value);
  const rawTerminal = { story: value.work_id, event: "done" };
  const supersession = {
    story: value.work_id,
    event: "evidence_superseded",
    ref: `${value.work_id}-DONE-LATE-DECISION`,
    target: { story: value.work_id, event: "done" },
    reason: "Revalidate terminal evidence",
  };
  const changeDecision = {
    story: "CHG-099",
    event: "decision",
    id: "CHG099-REPAIR-LATE",
    text: "Repair terminal evidence",
    reason: "Review",
  };
  const replacement = {
    story: value.work_id,
    event: "revalidated",
    ref: `${value.work_id}-DONE-LATE-DECISION`,
    change: "CHG-099",
    as_event: "done",
  };

  const validRecords = [approval, rawTerminal, supersession, changeDecision, replacement];
  assert.equal(validateCompletionActuals(value, validRecords).complete, true);
  assert.equal(validateApproval(value, validRecords).active, false);
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateAssessment(value, {
    feedbackRecords: [approval, rawTerminal, supersession, replacement, changeDecision],
  }));
});

test("canonical terminal projection resolves second-generation ref lineage", () => {
  const value = completed();
  const first = projectedTerminalRecords(value);
  const records = [
    ...first,
    { story: "CHG-100", event: "decision", id: "CHG100-REPAIR", text: "Repair again", reason: "Review" },
    {
      story: value.work_id,
      event: "evidence_superseded",
      ref: `${value.work_id}-DONE-2`,
      target: { ref: `${value.work_id}-DONE-1` },
      reason: "Revalidate projected terminal",
    },
    {
      story: value.work_id,
      event: "revalidated",
      ref: `${value.work_id}-DONE-2`,
      change: "CHG-100",
      as_event: "done",
    },
  ];
  assert.equal(validateCompletionActuals(value, records).complete, true);
});

test("terminal projection rejects cyclic and orphan ref lineage", () => {
  const value = completed();
  const cycle = [
    { story: "CHG-099", event: "decision", id: "CHG099-REPAIR", text: "Repair", reason: "Review" },
    {
      story: value.work_id,
      event: "evidence_superseded",
      ref: `${value.work_id}-DONE-CYCLE`,
      target: { ref: `${value.work_id}-DONE-CYCLE` },
      reason: "Cycle",
    },
    {
      story: value.work_id,
      event: "revalidated",
      ref: `${value.work_id}-DONE-CYCLE`,
      change: "CHG-099",
      as_event: "done",
    },
  ];
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, cycle));
  const orphan = clone(cycle);
  orphan[1].ref = `${value.work_id}-DONE-2`;
  orphan[1].target.ref = "MISSING-PRIOR-REF";
  orphan[2].ref = `${value.work_id}-DONE-2`;
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, orphan));
});

test("terminal projection rejects duplicate second-generation targets", () => {
  const value = completed();
  const first = projectedTerminalRecords(value);
  const secondSupersession = {
    story: value.work_id,
    event: "evidence_superseded",
    ref: `${value.work_id}-DONE-2`,
    target: { ref: `${value.work_id}-DONE-1` },
    reason: "Duplicate target",
  };
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, [
    ...first,
    { story: "CHG-100", event: "decision", id: "CHG100-REPAIR", text: "Repair", reason: "Review" },
    secondSupersession,
    { ...secondSupersession, ref: `${value.work_id}-DONE-3` },
    { story: value.work_id, event: "revalidated", ref: `${value.work_id}-DONE-2`, change: "CHG-100", as_event: "done" },
    { story: value.work_id, event: "revalidated", ref: `${value.work_id}-DONE-3`, change: "CHG-100", as_event: "done" },
  ]));
});

test("terminal projection requires a closed pre-supersession change decision", () => {
  const value = completed();
  const records = projectedTerminalRecords(value);
  records[0] = { story: "CHG-099", event: "decision" };
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, records));
  assert.equal(validateCompletionActuals(value, projectedTerminalRecords(value)).complete, true);
});

function projectedBuildRecords(value) {
  return [
    { story: "CHG-099", event: "decision", id: "CHG099-BUILD", text: "Repair build", reason: "Review" },
    { story: value.work_id, event: "build_pass", notes: "old build" },
    {
      story: value.work_id,
      event: "evidence_superseded",
      ref: `${value.work_id}-BUILD-1`,
      target: { story: value.work_id, event: "build_pass" },
      reason: "Revalidate build",
    },
    {
      story: value.work_id,
      event: "revalidated",
      ref: `${value.work_id}-BUILD-1`,
      change: "CHG-099",
      as_event: "build_pass",
      notes: "new build",
    },
  ];
}

test("non-terminal second-generation projection is validated and ignored for terminal selection", () => {
  const value = completed();
  const records = [
    ...projectedBuildRecords(value),
    { story: "CHG-100", event: "decision", id: "CHG100-BUILD", text: "Repair build again", reason: "Review" },
    {
      story: value.work_id,
      event: "evidence_superseded",
      ref: `${value.work_id}-BUILD-2`,
      target: { ref: `${value.work_id}-BUILD-1` },
      reason: "Revalidate projected build",
    },
    {
      story: value.work_id,
      event: "revalidated",
      ref: `${value.work_id}-BUILD-2`,
      change: "CHG-100",
      as_event: "build_pass",
      notes: "newest build",
    },
    { story: value.work_id, event: "done" },
  ];
  assert.equal(validateCompletionActuals(value, records).complete, true);
});

test("non-terminal lineage cannot fabricate a terminal projection", () => {
  const value = completed();
  const records = [
    ...projectedBuildRecords(value),
    { story: "CHG-100", event: "decision", id: "CHG100-BUILD", text: "Repair", reason: "Review" },
    {
      story: value.work_id,
      event: "evidence_superseded",
      ref: `${value.work_id}-BUILD-2`,
      target: { ref: `${value.work_id}-BUILD-1` },
      reason: "Invalid event-kind change",
    },
    { story: value.work_id, event: "revalidated", ref: `${value.work_id}-BUILD-2`, change: "CHG-100", as_event: "done" },
  ];
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, records));
});

test("malformed non-terminal projection chains fail closed", () => {
  const value = completed();
  const unresolved = projectedBuildRecords(value).slice(0, -1);
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, unresolved));
});

test("terminal projection rejects duplicate replacements and orphan projections", () => {
  const value = completed();
  const valid = projectedTerminalRecords(value);
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, [...valid, { ...valid.at(-1) }]));
  expectError("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", () => validateCompletionActuals(value, [valid.at(-1)]));
});

test("unsuperseded raw terminal variants remain terminal", () => {
  for (const event of ["done", "done_with_deferral", "done_with_external_deferral"]) {
    const value = completed();
    assert.equal(validateCompletionActuals(value, [{ story: value.work_id, event }]).complete, true);
  }
});

test("valid terminal actuals return exact recomputed facts", () => {
  const value = completed();
  assert.deepEqual(validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]), {
    complete: true,
    total: 89,
    variance: -11,
    raw: value.actuals,
    effective: value.actuals,
    corrections: [],
  });
});

test("rejects an incorrect actual estimate variance", () => {
  const value = completed();
  value.actuals.estimate_variance_minutes = -4;
  expectError("WR_ACTUALS_VARIANCE_MISMATCH", "$.actuals.estimate_variance_minutes", () => validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]));
});

test("repeated cold attempts require consistent invalidation counts and reasons", () => {
  const value = completed();
  value.actuals.cold_mutation_attempts = 3;
  value.actuals.mutation_invalidations = 2;
  const done = { story: value.work_id, event: "done" };
  expectError("WR_MUTATION_INVALIDATION_EVIDENCE", "$.actuals.mutation_invalidations", () => validateCompletionActuals(value, [done]));
  const records = [
    { story: value.work_id, event: "mutation_invalidation", reason: "Source changed after attempt one." },
    { story: value.work_id, event: "mutation_invalidation", reason: "Review fix invalidated attempt two." },
    { story: value.work_id, event: "test_report", scope: "diff", mutation_score: 88 },
    done,
  ];
  assert.equal(validateCompletionActuals(value, records).complete, true);
  value.actuals.mutation_invalidations = 1;
  expectError("WR_MUTATION_INVALIDATION_COUNT", "$.actuals.mutation_invalidations", () => validateCompletionActuals(value, records));
});

test("zero cold mutation attempts are valid only when no mutation shards are approved", () => {
  const value = completed();
  value.actuals.cold_mutation_attempts = 0;
  value.actuals.mutation_invalidations = 0;
  expectError("WR_MUTATION_COLD_REQUIRED", "$.actuals.cold_mutation_attempts", () => validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]));
  value.signals.expected_mutation_shards = 0;
  assert.equal(validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]).complete, true);
});










function git(root, args, expectedStatus = 0) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, expectedStatus, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function writeRepoFile(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, contents);
}

function makeGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "work-readiness-git-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "readiness@example.test"]);
  git(root, ["config", "user.name", "Readiness Test"]);
  writeRepoFile(root, "README.md", "fixture\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "chore(CHG-900): initialize fixture"]);
  return { root, base: git(root, ["rev-parse", "HEAD"]) };
}

function ownedScopeFixture({ completedSubject = false } = {}) {
  const { root, base } = makeGitRepo();
  const source = "packages/domain/src/owned.ts";
  writeRepoFile(root, source, "export const value = 1;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture source"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const subject = normal({ work_id: "US-900", approval: { status: "approved", approved_by: "user", evidence: "SUBJECT-READY" } });
  const scope = { version: 1, subject_work_id: subject.work_id, subject_readiness_sha256: subject.readiness_payload_sha256,
    scope_base: base, scope_head: head, sources: [{ path: source, head_blob: git(root, ["rev-parse", `${head}:${source}`]) }] };
  const governing = normal({ work_id: "CHG-900", kind: "CHG", work_type: "technical", mutation_scope: scope,
    approval: { status: "approved", approved_by: "user", evidence: "GOVERNING-READY" } });
  const feedback = [decisionFor(subject), decisionFor(governing)];
  if (completedSubject) {
    subject.actuals = completed().actuals;
    feedback.push({ story: subject.work_id, event: "started", agent: "fixture" },
      { story: subject.work_id, event: "build_pass", notes: "Fixture gate" }, { story: subject.work_id, event: "done" });
  }
  const save = () => {
    writeRepoFile(root, "docs/readiness/US-900.json", JSON.stringify(subject));
    writeRepoFile(root, "docs/readiness/CHG-900.json", JSON.stringify(governing));
    writeRepoFile(root, ".nous-feedback.jsonl", feedback.map(record => JSON.stringify(record)).join("\n") + "\n");
  };
  save();
  git(root, ["add", "."]); git(root, ["commit", "-m", "fixture committed authority"]);
  return { root, subject, governing, feedback, scope, save, executionHead: git(root, ["rev-parse", "HEAD"]) };
}

test("owned scope optional contract preserves legacy digest and binds complete shape", () => {
  const legacy = normal();
  assert.equal(computeReadinessPayloadSha256(legacy), "104f8e723c8b929a8ec6917420911fde327ad8e954d86302f49088f779647537");
  assert.equal(Object.hasOwn(JSON.parse(canonicalReadinessPayload(legacy)), "mutation_scope"), false);
  assert.equal(typeof readinessModel.validateOwnedScopeShape, "function");
  const scope = { version: 1, subject_work_id: "US-900", subject_readiness_sha256: "a".repeat(64), scope_base: "b".repeat(40), scope_head: "c".repeat(40), sources: [{ path: "packages/domain/src/owned.ts", head_blob: "d".repeat(40) }] };
  assert.deepEqual(readinessModel.validateOwnedScopeShape(scope), scope);
  assert.deepEqual(Object.keys(readinessSchema.$defs.mutation_scope.properties).sort(), Object.keys(scope).sort());
  assert.deepEqual(Object.keys(readinessSchema.$defs.mutation_scope.properties.sources.items.properties).sort(), ["head_blob", "path"]);
  for (const path of ["/absolute.ts", "a//b.ts", "a/./b.ts", "a/../b.ts", "a\\b.ts", "a:stream.ts", "a/", "a\u0000.ts"]) {
    assert.throws(() => readinessModel.validateOwnedScopeShape({ ...scope, sources: [{ ...scope.sources[0], path }] }), WorkReadinessError);
    assert.equal(new RegExp(readinessSchema.$defs.mutation_scope.properties.sources.items.properties.path.pattern, "u").test(path), false);
  }
  const governed = normal({ work_id: "CHG-900", kind: "CHG", work_type: "technical", mutation_scope: scope });
  assert.notEqual(computeReadinessPayloadSha256(governed), computeReadinessPayloadSha256(Object.fromEntries(Object.entries(governed).filter(([key]) => key !== "mutation_scope"))));
  for (const mutate of [s => { s.extra = true; }, s => { s.sources[0].ranges = []; }, s => { s.subject_work_id = "US-1"; }, s => { s.sources.push(clone(s.sources[0])); }, s => { s.sources[0].path = "../escape.ts"; }, s => { s.scope_head = "main"; }]) {
    const invalid = clone(scope); mutate(invalid); assert.throws(() => readinessModel.validateOwnedScopeShape(invalid), WorkReadinessError);
  }
  assert.throws(() => classifyAssessment(normal({ mutation_scope: scope })), WorkReadinessError);
  assert.throws(() => classifyAssessment(normal({ ...governed, mutation_scope: { ...scope, subject_work_id: "CHG-900" } })), WorkReadinessError);
});

test("owned scope committed authority rejects flags, tampering and mutable-only decisions", () => {
  const fixture = ownedScopeFixture();
  try {
    assert.equal(typeof ownedScopeModule?.loadApprovedOwnedScope, "function");
    const load = () => ownedScopeModule.loadApprovedOwnedScope({ root: fixture.root, governingWorkId: "CHG-900", subjectWorkId: "US-900", executionHead: fixture.executionHead });
    const loaded = load();
    assert.deepEqual(loaded.scope, fixture.scope);
    assert.equal(loaded.governingDigest, fixture.governing.readiness_payload_sha256);
    assert.equal(loaded.subjectDigest, fixture.subject.readiness_payload_sha256);
    for (const mutate of [g => { g.approval.status = "pending"; }, g => { g.mutation_scope.sources = []; }, g => { g.mutation_scope.scope_head = fixture.scope.scope_base; }, g => { g.mutation_scope.subject_readiness_sha256 = "f".repeat(64); }]) {
      const original = clone(fixture.governing); mutate(fixture.governing); fixture.save();
      assert.throws(load, WorkReadinessError);
      Object.assign(fixture.governing, original); fixture.save();
    }
    assert.throws(() => ownedScopeModule.loadApprovedOwnedScope({ root: fixture.root, governingWorkId: "CHG-900", subjectWorkId: "US-901", executionHead: fixture.executionHead }), WorkReadinessError);
    fixture.feedback.pop(); fixture.save();
    git(fixture.root, ["add", "."]); git(fixture.root, ["commit", "-m", "fixture remove committed decision"]);
    fixture.executionHead = git(fixture.root, ["rev-parse", "HEAD"]);
    fixture.feedback.push(decisionFor(fixture.governing)); fixture.save();
    assert.throws(load, WorkReadinessError);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("owned scope committed decisions bind full digest and allow closed subjects", () => {
  for (const mode of ["closed", "pending", "blocked", "subject-digest", "omitted-source", "changed-head"]) {
    const fixture = ownedScopeFixture({ completedSubject: mode === "closed" });
    try {
      if (mode === "pending") fixture.governing.approval.status = "pending";
      if (mode === "blocked") {
        fixture.governing.decision = "blocked";
        fixture.governing.dependencies = [{ work_id: "US-901", type: "blocked_by", reason: "Fixture unresolved dependency" }];
      }
      if (mode === "subject-digest") fixture.governing.mutation_scope.subject_readiness_sha256 = "f".repeat(64);
      // Removing/changing scope without the human decision must invalidate authority,
      // even when a caller refreshes the artifact's self-asserted hashes.
      if (mode === "omitted-source") fixture.governing.mutation_scope.sources = [];
      if (mode === "changed-head") fixture.governing.mutation_scope.scope_head = fixture.scope.scope_base;
      if (mode !== "closed") refreshDigest(fixture.governing);
      if (["pending", "blocked", "subject-digest"].includes(mode)) fixture.feedback[1] = decisionFor(fixture.governing);
      fixture.save(); git(fixture.root, ["add", "."]); git(fixture.root, ["commit", "--allow-empty", "-m", "fixture exact candidate"]);
      const action = () => ownedScopeModule.loadApprovedOwnedScope({ root: fixture.root, governingWorkId: "CHG-900", subjectWorkId: "US-900", executionHead: git(fixture.root, ["rev-parse", "HEAD"]) });
      if (mode === "closed") assert.equal(action().subjectDigest, fixture.subject.readiness_payload_sha256);
      else assert.throws(action, WorkReadinessError, mode);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

function writeExactNousSyncEnvelope(root, generatedPath, generated, {
  provenance: provenanceOverrides = {}, project: projectOverrides = {}, sync: syncOverrides = {}, mutate = () => {},
} = {}) {
  const provenance = {
    schema_version: 1,
    project_id: "fixture__ledger",
    git_sha: "d246c6ff15d4",
    dirty: false,
    dirty_paths: [],
    ...provenanceOverrides,
  };
  const project = {
    schema_version: 1,
    project_id: "fixture__ledger",
    organization: "org_fixture",
    nous_namespace: "fixture/ledger",
    generated_at: "2026-09-05T21:40:53Z",
    substrate_commit: "d246c6ff",
    checksum: "82f3e0de92a5834b",
    ...projectOverrides,
  };
  const sync = {
    synced_at: "2026-09-05T21:40:53.665778+00:00",
    project_id: "fixture__ledger",
    files: {
      [generatedPath]: {
        hash: createHash("sha256").update(generated).digest("hex").slice(0, 16),
        source: "generated",
      },
    },
    ...syncOverrides,
  };
  mutate({ provenance, project, sync });
  writeRepoFile(root, generatedPath, generated);
  writeRepoFile(root, ".nous-provenance.json", `${JSON.stringify(provenance, null, 2)}\n`);
  writeRepoFile(root, ".nous-project.json", `${JSON.stringify(project, null, 2)}\n`);
  writeRepoFile(root, ".nous-sync.json", `${JSON.stringify(sync, null, 2)}\n`);
}

function commitRepo(root, message, paths) {
  git(root, ["add", "--", ...paths]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function commitRepoAt(root, message, paths, timestamp) {
  git(root, ["add", "--", ...paths]);
  const result = runGit(root, ["commit", "--no-verify", "-m", message], {
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
  });
  assert.equal(result.status, 0, result.stderr);
  return git(root, ["rev-parse", "HEAD"]);
}

function runGit(root, args, env = {}) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

function installReadinessHook(root) {
  for (const path of [
    ".githooks/commit-msg",
    "scripts/work-readiness.mjs",
    "scripts/work-readiness/model.mjs",
    "scripts/work-readiness/git.mjs",
    "scripts/work-readiness/delivery-policy.mjs",
    "docs/dev-guide/feedback-vocabulary.json",
  ]) {
    writeRepoFile(root, path, readFileSync(new URL(path, sourceRoot), "utf8"));
  }
  chmodSync(join(root, ".githooks/commit-msg"), 0o755);
  git(root, ["config", "core.hooksPath", ".githooks"]);
}

function commitReadinessEvidence(root, values) {
  const records = [];
  const paths = [];
  for (const value of values) {
    writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(value, null, 2)}\n`);
    paths.push(`docs/readiness/${value.work_id}.json`);
    if (value.approval.status === "approved") records.push(decisionFor(value));
  }
  if (records.length > 0) {
    writeRepoFile(root, ".nous-feedback.jsonl", `${records.map(JSON.stringify).join("\n")}\n`);
    paths.push(".nous-feedback.jsonl");
  }
  const result = runGit(root, ["add", "--", ...paths]);
  assert.equal(result.status, 0, result.stderr);
  const committed = runGit(root, ["commit", "-m", `docs(${values.map((value) => value.work_id).join(" ")}): approve readiness`]);
  assert.equal(committed.status, 0, committed.stderr);
  return git(root, ["rev-parse", "HEAD"]);
}

function pendingArtifact(workId) {
  const value = approvedArtifact(workId);
  value.approval.status = "pending";
  value.approval.approved_by = null;
  value.approval.evidence = null;
  return value;
}

function approvedArtifact(workId) {
  const kind = workId.startsWith("US-") ? "US" : "CHG";
  const value = normal({
    work_id: workId,
    kind,
    source: kind === "US" ? `docs/stories/${workId}.md` : `docs/changes/${workId}.md`,
    approval: { status: "approved", approved_by: "user", evidence: `${workId.replace("-", "")}-READY`, payload_sha256: "0".repeat(64) },
  });
  refreshDigest(value);
  return value;
}

function activateReadinessPolicy(root) {
  writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
  writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(bootstrapDecision)}\n`);
  commitRepo(root, "docs(CHG-022): activate readiness policy", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
}

function approveAfterPolicyActivation(root, value) {
  activateReadinessPolicy(root);
  const priorFeedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
  writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(value, null, 2)}\n`);
  writeRepoFile(root, ".nous-feedback.jsonl", `${priorFeedback}${JSON.stringify(decisionFor(value))}\n`);
  return commitRepo(root, `docs(${value.work_id}): approve readiness`, [`docs/readiness/${value.work_id}.json`, ".nous-feedback.jsonl"]);
}

function implementationPlanHeader(value, overrides = {}) {
  const fields = {
    workId: value.work_id,
    readinessPath: `docs/readiness/${value.work_id}.json`,
    estimate: value.estimate_minutes.total,
    ...overrides,
  };
  return [
    `**Work item:** ${fields.workId}`,
    `**Readiness assessment:** ${fields.readinessPath}`,
    `**Approved estimate:** ${fields.estimate} minutes`,
    "",
    "# Fixture implementation plan",
    "",
    "## Tasks",
    "",
    "- Implement the approved outcome.",
    "",
  ].join("\n");
}

function writeApprovedWork(root, workId, { mutateAfterApproval = false } = {}) {
  const value = approvedArtifact(workId);
  const decision = decisionFor(value);
  if (mutateAfterApproval) {
    value.outcomes[0].statement = "Changed after approval";
    refreshDigest(value);
  }
  writeRepoFile(root, `docs/readiness/${workId}.json`, `${JSON.stringify(value, null, 2)}\n`);
  return decision;
}

function runCli(root, args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

function writeGitMessage(root, contents) {
  const path = resolve(root, git(root, ["rev-parse", "--git-path", "COMMIT_EDITMSG"]));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function parseCliJson(result) {
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const output = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(output), ["ok", "command", "work_ids", "errors", "summary"]);
  return output;
}

// Fault oracle: omitting the exact deviation projection must keep the parent RED;
// omitting raw identity/independent authority checks must admit an adversarial case.
const annotationLine = repositoryFeedback.split("\n").find((line) => {
  const row = line ? JSON.parse(line) : {};
  return row.story === "US-024" && row.ts === "2026-10-12T03:00:34.941232Z";
});
const annotationDigest = "d1dba52d00fd4b60aa47a2654e4ee4c82f229370966d1dcdfea2c5911b6150bd";
function annotationFixture() {
  const parent = normal({ work_id: "US-024", decision: "blocked",
    uncertainties: [{ id: "U1", statement: "Parent blocked", status: "unresolved", estimate_impact_minutes: null, resolution: null }] });
  const authority = normal({ work_id: "CHG-089", kind: "CHG", work_type: "technical",
    approval: { status: "approved", approved_by: "user", evidence: "CHG089-READY", payload_sha256: "0".repeat(64) } });
  const parentApproval = decisionFor(parent, { ts: "2026-10-12T02:00:00Z" });
  const approval = decisionFor(authority, { ts: "2026-10-12T03:22:25.308Z" });
  const correction = { story: "US-024", event: "lifecycle_corrected", target_event: "deviation",
    target_ts: "2026-10-12T03:00:34.941232Z", target_sha256: annotationDigest,
    disposition: "not_execution", reason: "Operator-authorized CHG-089 integration bookkeeping correction",
    approved_by: "user", authority: { work_id: "CHG-089", payload_sha256: authority.readiness_payload_sha256, evidence: authority.approval.evidence },
    ts: "2026-10-12T03:30:00Z" };
  return { parent, authority, parentApproval, approval, correction };
}
function withAnnotationRepo(body) {
  const { root } = makeGitRepo();
  const fixture = annotationFixture();
  const { parent, authority, parentApproval, approval, correction } = fixture;
  writeRepoFile(root, "docs/readiness/US-024.json", JSON.stringify(parent));
  writeRepoFile(root, "docs/readiness/CHG-089.json", JSON.stringify(authority));
  const prefix = `${JSON.stringify(parentApproval)}\n${annotationLine}\n${JSON.stringify(approval)}\n`;
  writeRepoFile(root, ".nous-feedback.jsonl", prefix);
  const base = commitRepo(root, "docs(CHG-089): approve annotation fixture", ["docs/readiness/US-024.json", "docs/readiness/CHG-089.json", ".nous-feedback.jsonl"]);
  try { body({ ...fixture, root, prefix, base }); } finally { rmSync(root, { recursive: true, force: true }); }
}
test("CHG-089 exact annotation restores lifecycle in CLI and real Git without rewriting parent or prefix", () => {
  assert.equal(createHash("sha256").update(annotationLine).digest("hex"), annotationDigest);
  withAnnotationRepo(({ root, prefix, correction, base }) => {
    const originalParent = readFileSync(join(root, "docs/readiness/US-024.json"));
    assert.equal(JSON.parse(runCli(root, ["check-all", "--json"]).stdout).errors[0].code, "WR_APPROVAL_ORDER");
    writeRepoFile(root, ".nous-feedback.jsonl", prefix + JSON.stringify(correction) + "\n");
    const result = runCli(root, ["check-all", "--json"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeRepoFile(root, "scripts/work-readiness/model.mjs", "export const annotationFixture = true;\n");
    const head = commitRepo(root, "fix(CHG-089): append exact correction", [".nous-feedback.jsonl", "scripts/work-readiness/model.mjs"]);
    assert.deepEqual(validateRangeOwnership({ root, base, head }).workIds, ["CHG-089"]);
    assert.deepEqual(readFileSync(join(root, "docs/readiness/US-024.json")), originalParent);
    assert.ok(readFileSync(join(root, ".nous-feedback.jsonl")).subarray(0, Buffer.byteLength(prefix)).equals(Buffer.from(prefix)));
    writeRepoFile(root, ".nous-feedback.jsonl", prefix.replace(annotationLine, annotationLine + " ") + JSON.stringify(correction) + "\n");
    const mutated = commitRepo(root, "fix(CHG-089): mutate original bytes", [".nous-feedback.jsonl"]);
    expectError("WR_FEEDBACK_HISTORY_MUTATED", ".nous-feedback.jsonl", () => validateRangeOwnership({ root, base: head, head: mutated }));
  });
});
test("CHG-089 refuses authority, identity, execution and duplicate attacks", () => {
  withAnnotationRepo(({ root, prefix, authority, correction, approval, parentApproval }) => {
    const reject = (text, artifact = authority, expectedCode = "WR_CORRECTION_INVALID") => {
      writeRepoFile(root, "docs/readiness/CHG-089.json", JSON.stringify(artifact));
      writeRepoFile(root, ".nous-feedback.jsonl", text);
      const result = runCli(root, ["check", "US-024", "--json"]);
      assert.equal(result.status, 1, result.stdout);
      assert.equal(JSON.parse(result.stdout).errors[0].code, expectedCode, result.stdout);
    };
    for (const mutate of [
      (r) => { delete r.authority; }, (r) => { r.authority.work_id = "US-024"; },
      (r) => { r.authority.evidence = "forged"; }, (r) => { r.authority.payload_sha256 = "0".repeat(64); },
      (r) => { r.story = "US-999"; }, (r) => { r.target_sha256 = "0".repeat(64); },
      (r) => { r.target_ts = "2026-10-12T03:00:35Z"; }, (r) => { r.approved_by = "forged"; },
      (r) => { r.reason = " "; }, (r) => { r.ts = approval.ts; },
    ]) { const changed = clone(correction); mutate(changed); reject(prefix + JSON.stringify(changed) + "\n"); }
    for (const event of ["started", "build_pass", "ac_verify", "test_report", "done", "deviation"]) {
      const target = { story: "US-024", event, ts: correction.target_ts, notes: "Actual execution" };
      const changed = { ...correction, target_event: event, target_sha256: createHash("sha256").update(JSON.stringify(target)).digest("hex") };
      reject(`${JSON.stringify(parentApproval)}\n${JSON.stringify(target)}\n${JSON.stringify(approval)}\n${JSON.stringify(changed)}\n`, authority, event === "done" ? "WR_ACTUALS_REQUIRED" : "WR_CORRECTION_INVALID");
    }
    reject(prefix.replace(annotationLine + "\n", "") + JSON.stringify(correction) + "\n");
    reject(prefix.replace(annotationLine, JSON.stringify(JSON.parse(annotationLine), null, 0) + " ") + JSON.stringify(correction) + "\n");
    reject(prefix + JSON.stringify({ story: "CHG-089", event: "done", ts: "2026-10-12T03:25:00Z" }) + "\n" + JSON.stringify(correction) + "\n");
    reject(prefix.replace(JSON.stringify(approval), JSON.stringify({ story: "CHG-089", event: "started", ts: "2026-10-12T03:21:00Z" }) + "\n" + JSON.stringify(approval)) + JSON.stringify(correction) + "\n");
    reject(prefix + annotationLine + "\n" + JSON.stringify(correction) + "\n");
    reject(prefix + JSON.stringify(correction) + "\n" + JSON.stringify(correction) + "\n");
    reject(prefix.replace(JSON.stringify(approval) + "\n", "") + JSON.stringify(correction) + "\n" + JSON.stringify(approval) + "\n");
    reject(prefix + JSON.stringify({ story: "CHG-089", event: "blocker", reason: "Inactive", ts: "2026-10-12T03:25:00Z" }) + "\n" + JSON.stringify(correction) + "\n");
    reject(prefix + JSON.stringify(correction) + "\n", { ...authority, approval: { ...authority.approval, status: "pending" } });
    reject(prefix + JSON.stringify(correction) + "\n", refreshDigest({ ...clone(authority), work_type: "functional" }));
    rmSync(join(root, "docs/readiness/CHG-089.json"));
    writeRepoFile(root, ".nous-feedback.jsonl", prefix + JSON.stringify(correction) + "\n");
    assert.equal(JSON.parse(runCli(root, ["check", "US-024", "--json"]).stdout).errors[0].code, "WR_CORRECTION_INVALID");
  });
});

test("CHG-089 real Git requires correction authority already committed in parent", () => {
  withAnnotationRepo(({ root, prefix, correction, base }) => {
    git(root, ["rm", "docs/readiness/CHG-089.json"]);
    git(root, ["commit", "-m", "docs(CHG-089): remove authority fixture"]);
    const missing = git(root, ["rev-parse", "HEAD"]);
    const { authority } = annotationFixture();
    writeRepoFile(root, "docs/readiness/CHG-089.json", JSON.stringify(authority));
    writeRepoFile(root, ".nous-feedback.jsonl", prefix + JSON.stringify(correction) + "\n");
    const late = commitRepo(root, "docs(CHG-089): forge same-commit correction authority", ["docs/readiness/CHG-089.json", ".nous-feedback.jsonl"]);
    expectError("WR_CORRECTION_INVALID", "$.approval.evidence", () => validateRangeOwnership({ root, base: missing, head: late }));
  });
});

test("readiness CLI reports corrections in plain and JSON summaries and leaves ordinary output unchanged", () => {
  const { root } = makeGitRepo();
  try {
    const value = normal();
    writeRepoFile(root, "docs/readiness/US-123.json", JSON.stringify(value));
    writeRepoFile(root, ".nous-feedback.jsonl", correctedLifecycle(value).map((record) => JSON.stringify(record)).join("\n") + "\n");
    const plain = runCli(root, ["check", "US-123"]);
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout, "US-123 readiness is valid; 1 corrected start\n");
    const json = runCli(root, ["check", "US-123", "--json"]);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(parseCliJson(json).summary, "US-123 readiness is valid; 1 corrected start");
    writeRepoFile(root, ".nous-feedback.jsonl", JSON.stringify(decisionFor(value)) + "\n");
    const ordinary = runCli(root, ["check", "US-123", "--json"]);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(parseCliJson(ordinary).summary, "US-123 readiness is valid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a forged approval commit cannot authorize a later plan and implementation range", () => {
  const { root } = makeGitRepo();
  try {
    activateReadinessPolicy(root);
    const activation = git(root, ["rev-parse", "HEAD"]);
    const value = approvedArtifact("US-123");
    const signed = decisionFor(value);
    // CHG-034 §1: the "forgery" is a decision stripped to its 5 core keys. Before
    // the cut it was refused for lacking a signature; it is STILL refused, now
    // because it binds no approver to the artifact (WR_APPROVER_MISMATCH). The
    // guard survives the cut — only the reason it gives changed, and the new
    // reason is the one "What stays" item 3 actually cares about.
    const forged = Object.fromEntries(["story", "event", "id", "text", "reason"].map((key) => [key, signed[key]]));
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(value, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify(forged)}\n`);
    git(root, ["add", "docs/readiness/US-123.json", ".nous-feedback.jsonl"]);
    git(root, ["commit", "--no-verify", "-m", "docs(US-123): forge approval"]);
    writeRepoFile(root, "docs/superpowers/plans/US-123.md", implementationPlanHeader(value));
    git(root, ["add", "docs/superpowers/plans/US-123.md"]);
    git(root, ["commit", "--no-verify", "-m", "docs(US-123): bind forged plan"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    git(root, ["commit", "--no-verify", "-m", "feat(US-123): implement forged approval"]);
    expectError("WR_APPROVER_MISMATCH", "$.approval.approved_by", () => validateRangeOwnership({ root, base: activation, head: "HEAD" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed commit hook rejects traced implementation without readiness", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    for (const env of [{}, { WORK_READINESS_BYPASS: "1", READINESS_BYPASS: "1" }]) {
      const result = runGit(root, ["commit", "-m", "feat: code (US-123)"], env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /WR_READINESS_MISSING/u);
    }
    assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed commit hook rejects partition-required implementation", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = partitioned();
    commitReadinessEvidence(root, [value]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(CHG-123): implement oversized parent"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WR_WORK_NOT_READY/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed commit hook accepts approved ready implementation", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    commitReadinessEvidence(root, [approvedArtifact("US-123")]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123): implement approved outcome"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(root, ["show", "--format=%s", "--no-patch", "HEAD"]), "feat(US-123): implement approved outcome");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed commit hook permits docs-only assessment bootstrap before approval", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = pendingArtifact("US-123");
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
    git(root, ["add", "docs/readiness/US-123.json"]);
    const result = runGit(root, ["commit", "-m", "docs(US-123): bootstrap readiness assessment"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(root, ["show", "--format=%s", "--no-patch", "HEAD"]), "docs(US-123): bootstrap readiness assessment");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed commit hook requires readiness for every referenced ID", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    commitReadinessEvidence(root, [approvedArtifact("US-123")]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123 CHG-456): implement joint outcome"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WR_READINESS_MISSING.*CHG-456/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("COMMIT_MSG_NO_US bypasses missing-ID messaging but not staged readiness", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    const committed = runGit(root, ["commit", "-m", "fix: emergency implementation"], { COMMIT_MSG_NO_US: "1" });
    assert.equal(committed.status, 1);
    assert.match(committed.stderr, /missing-ID traceability check bypassed/u);
    assert.match(committed.stderr, /WR_WORK_ID_MISSING/u);
    assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("COMMIT_MSG_NO_US permits only a readiness-safe docs bootstrap", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    writeRepoFile(root, "docs/superpowers/plans/emergency.md", "# Emergency assessment\n");
    git(root, ["add", "docs/superpowers/plans/emergency.md"]);
    const committed = runGit(root, ["commit", "-m", "docs: emergency assessment"], { COMMIT_MSG_NO_US: "1" });
    assert.equal(committed.status, 0, committed.stderr);
    assert.match(committed.stderr, /missing-ID traceability check bypassed/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed hook rejects approval and implementation staged in the same commit", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = approvedArtifact("US-123");
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decisionFor(value))}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "docs/readiness/US-123.json", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123): approve and implement together"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WR_READINESS_MISSING/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed hook rejects candidate blocker after parent approval", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = approvedArtifact("US-123");
    commitReadinessEvidence(root, [value]);
    const priorFeedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, ".nous-feedback.jsonl", `${priorFeedback}${JSON.stringify({ story: "US-123", event: "blocker", reason: "Scope reopened" })}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123): implement after candidate blocker"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WR_APPROVAL_INACTIVE/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate readiness payload cannot change during its implementation commit", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const parentValue = approvedArtifact("US-123");
    const parent = commitReadinessEvidence(root, [parentValue]);
    const changed = clone(parentValue);
    changed.title = "Expanded outcome after parent approval";
    changed.approval.evidence = "US123-READY-V2";
    refreshDigest(changed);
    const priorFeedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(changed, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${priorFeedback}${JSON.stringify(decisionFor(changed))}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "docs/readiness/US-123.json", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const hook = runGit(root, ["commit", "-m", "feat(US-123): mutate approval and implement"]);
    assert.equal(hook.status, 1);
    assert.match(hook.stderr, /WR_CANDIDATE_PAYLOAD_CHANGED/u);
    const bypassed = runGit(root, ["commit", "--no-verify", "-m", "feat(US-123): mutate approval and implement"]);
    assert.equal(bypassed.status, 0, bypassed.stderr);
    assert.throws(
      () => validateRangeOwnership({ root, base: parent, head: "HEAD" }),
      (error) => error.code === "WR_CANDIDATE_PAYLOAD_CHANGED",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate approval binding cannot switch during its implementation commit", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const parentValue = approvedArtifact("US-123");
    commitReadinessEvidence(root, [parentValue]);
    const candidate = clone(parentValue);
    candidate.approval.evidence = "US123-READY-V2";
    const priorFeedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(candidate, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${priorFeedback}${JSON.stringify(decisionFor(candidate))}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "docs/readiness/US-123.json", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const hook = runGit(root, ["commit", "-m", "feat(US-123): switch approval and implement"]);
    assert.equal(hook.status, 1);
    assert.match(hook.stderr, /WR_CANDIDATE_APPROVAL_CHANGED/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});



test("installed hook rejects rewriting selected approval bytes during implementation", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = approvedArtifact("US-123");
    commitReadinessEvidence(root, [value]);
    const rewritten = decisionFor(value, {
      text: `${decisionFor(value).text} Reworded without changing its binding.`,
      reason: "Rewritten historical reason",
    });
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(rewritten)}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123): rewrite approval and implement"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WR_FEEDBACK_HISTORY_MUTATED/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback history rejects deletion, reorder, truncation, and partial appended records", () => {
  const mutations = [
    ["deletion", (lines) => `${lines[0]}\n`],
    ["reorder", (lines) => `${lines[1]}\n${lines[0]}\n`],
    ["truncation", (lines) => `${lines[0].slice(0, -1)}\n${lines[1]}\n`],
    ["partial append", (lines) => `${lines.join("\n")}\n{\"story\":`],
  ];
  for (const [name, mutate] of mutations) {
    const { root, base } = makeGitRepo();
    try {
      installReadinessHook(root);
      const value = approvedArtifact("US-123");
      const lines = [
        JSON.stringify(decisionFor(value)),
        JSON.stringify({ story: "US-123", event: "feedback", title: "Sizing", description: "Baseline", images: [] }),
      ];
      writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
      writeRepoFile(root, ".nous-feedback.jsonl", `${lines.join("\n")}\n`);
      commitRepo(root, "docs(US-123): establish append-only history", ["docs/readiness/US-123.json", ".nous-feedback.jsonl"]);
      writeRepoFile(root, ".nous-feedback.jsonl", mutate(lines));
      git(root, ["add", ".nous-feedback.jsonl"]);
      const hook = runGit(root, ["commit", "-m", `docs(US-123): ${name} history`]);
      assert.equal(hook.status, 1, name);
      assert.match(hook.stderr, /WR_FEEDBACK_HISTORY_MUTATED/u, name);
      const bypassed = runGit(root, ["commit", "--no-verify", "-m", `docs(US-123): ${name} history`]);
      assert.equal(bypassed.status, 0, bypassed.stderr);
      assert.throws(
        () => validateRangeOwnership({ root, base, head: "HEAD" }),
        (error) => error.code === "WR_FEEDBACK_HISTORY_MUTATED",
        name,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("installed hook accepts exact complete feedback append with active implementation", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = approvedArtifact("US-123");
    commitReadinessEvidence(root, [value]);
    const parentFeedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    const appended = { story: "US-123", event: "feedback", title: "Checkpoint note", description: "No scope change", images: [] };
    writeRepoFile(root, ".nous-feedback.jsonl", `${parentFeedback}${JSON.stringify(appended)}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123): append feedback and implement"]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("traceability-exempt release and revert commits remain readiness-gated", () => {
  const release = makeGitRepo();
  try {
    installReadinessHook(release.root);
    writeRepoFile(release.root, "docs/superpowers/plans/release.md", "# Release notes\n");
    git(release.root, ["add", "docs/superpowers/plans/release.md"]);
    const documentation = runGit(release.root, ["commit", "-m", "chore(release): docs only"]);
    assert.equal(documentation.status, 0, documentation.stderr);
    writeRepoFile(release.root, "apps/web/src/app/release.ts", "export {};\n");
    git(release.root, ["add", "apps/web/src/app/release.ts"]);
    const committed = runGit(release.root, ["commit", "-m", "chore(release): v1.2.3"]);
    assert.equal(committed.status, 1);
    assert.match(committed.stderr, /WR_WORK_ID_MISSING/u);
    const bypassed = runGit(release.root, ["commit", "--no-verify", "-m", "chore(release): v1.2.3"]);
    assert.equal(bypassed.status, 0, bypassed.stderr);
    assert.throws(
      () => validateRangeOwnership({ root: release.root, base: release.base, head: "HEAD" }),
      (error) => error.code === "WR_WORK_ID_MISSING",
    );
  } finally {
    rmSync(release.root, { recursive: true, force: true });
  }

  const revert = makeGitRepo();
  try {
    writeRepoFile(revert.root, "apps/web/src/app/reverted.ts", "export {};\n");
    commitRepo(revert.root, "feat(CHG-900): implementation later reverted", ["apps/web/src/app/reverted.ts"]);
    installReadinessHook(revert.root);
    const committed = runGit(revert.root, ["revert", "--no-edit", "HEAD"]);
    assert.equal(committed.status, 0, committed.stderr);
    assert.throws(
      () => validateRangeOwnership({ root: revert.root, base: revert.base, head: "HEAD" }),
      (error) => error.code === "WR_READINESS_MISSING",
    );
  } finally {
    rmSync(revert.root, { recursive: true, force: true });
  }
});

test("traceability-exempt merge commit remains locally and range readiness-gated", () => {
  const { root, base } = makeGitRepo();
  try {
    git(root, ["checkout", "-b", "side"]);
    writeRepoFile(root, "apps/web/src/app/side.ts", "export {};\n");
    commitRepo(root, "feat(CHG-900): unassessed side implementation", ["apps/web/src/app/side.ts"]);
    git(root, ["checkout", "main"]);
    installReadinessHook(root);
    const committed = runGit(root, ["merge", "--no-ff", "side", "-m", "Merge branch 'side'"]);
    assert.equal(committed.status, 1);
    assert.match(committed.stderr, /WR_FILE_INVALID/u);
    const bypassed = runGit(root, ["commit", "--no-verify", "-m", "Merge branch 'side'"]);
    assert.equal(bypassed.status, 0, bypassed.stderr);
    assert.throws(
      () => validateRangeOwnership({ root, base, head: "HEAD" }),
      (error) => error.code === "WR_GIT_TOPOLOGY_UNSUPPORTED",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI init normalizes an explicit ID, creates exclusively, and never invents IDs", () => {
  const { root } = makeGitRepo();
  try {
    const created = runCli(root, ["init", "chg-123", "--json"]);
    assert.equal(created.status, 0);
    assert.deepEqual(parseCliJson(created), {
      ok: true,
      command: "init",
      work_ids: ["CHG-123"],
      errors: [],
      summary: "Created docs/readiness/CHG-123.json",
    });
    const createdPath = join(root, "docs/readiness/CHG-123.json");
    assert.equal(existsSync(createdPath), true);
    const createdBytes = readFileSync(createdPath, "utf8");
    const createdValue = JSON.parse(createdBytes);
    assert.equal(createdValue.work_id, "CHG-123");
    assert.equal(createdValue.decision, "blocked");
    assert.equal(createdValue.approval.status, "pending");
    assert.equal(createdValue.readiness_payload_sha256, computeReadinessPayloadSha256(createdValue));

    const overwrite = runCli(root, ["init", "CHG-123", "--json"]);
    assert.equal(overwrite.status, 1);
    assert.equal(parseCliJson(overwrite).errors[0].code, "WR_READINESS_EXISTS");
    assert.equal(readFileSync(createdPath, "utf8"), createdBytes);
    assert.deepEqual(readdirSync(join(root, "docs/readiness")), ["CHG-123.json"]);

    const missing = runCli(root, ["init", "--json"]);
    assert.equal(missing.status, 2);
    assert.equal(parseCliJson(missing).errors[0].code, "WR_INVOCATION_INVALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check and check-all load repository feedback and validate completion state", () => {
  const { root } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(approvedArtifact("US-321"), null, 2)}\n`);
    const artifact = JSON.parse(readFileSync(join(root, "docs/readiness/US-321.json"), "utf8"));
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decisionFor(artifact))}\n`);
    for (const [command, args] of [["check", ["check", "US-321", "--json"]], ["check-all", ["check-all", "--json"]]]) {
      const result = runCli(root, args);
      assert.equal(result.status, 0);
      const output = parseCliJson(result);
      assert.equal(output.command, command);
      assert.deepEqual(output.work_ids, ["US-321"]);
      assert.deepEqual(output.errors, []);
    }
    writeRepoFile(root, ".nous-feedback.jsonl", `${[
      decisionFor(artifact),
      { story: "US-321", event: "started", agent: "cli-test" },
      { story: "US-321", event: "build_pass", notes: "Focused verification passed" },
      { story: "US-321", event: "done" },
    ].map(JSON.stringify).join("\n")}\n`);
    const incomplete = runCli(root, ["check", "US-321", "--json"]);
    assert.equal(incomplete.status, 1);
    assert.equal(parseCliJson(incomplete).errors[0].code, "WR_ACTUALS_REQUIRED");

    const completedArtifact = approvedArtifact("US-321");
    completedArtifact.actuals = clone(completed().actuals);
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(completedArtifact, null, 2)}\n`);
    for (const [command, args] of [["check", ["check", "US-321", "--json"]], ["check-all", ["check-all", "--json"]]]) {
      const result = runCli(root, args);
      assert.equal(result.status, 0);
      const output = parseCliJson(result);
      assert.equal(output.command, command);
      assert.deepEqual(output.work_ids, ["US-321"]);
      assert.deepEqual(output.errors, []);
    }
    completedArtifact.actuals.estimate_variance_minutes += 1;
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(completedArtifact, null, 2)}\n`);
    const badActuals = runCli(root, ["check", "US-321", "--json"]);
    assert.equal(badActuals.status, 1);
    assert.equal(parseCliJson(badActuals).errors[0].code, "WR_ACTUALS_VARIANCE_MISMATCH");

    writeRepoFile(root, "docs/readiness/US-321.json", "{}\n");
    const rejected = runCli(root, ["check", "US-321", "--json"]);
    assert.equal(rejected.status, 1);
    assert.equal(parseCliJson(rejected).errors[0].code.startsWith("WR_"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check and check-all accept completed CHG-022 as valid but inactive", () => {
  const { root } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(completedBootstrap(), null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${[
      bootstrapDecision,
      bootstrapCheckpointDeviation(180),
      { story: "CHG-022", event: "done" },
    ].map(JSON.stringify).join("\n")}\n`);
    for (const [command, args] of [["check", ["check", "CHG-022", "--json"]], ["check-all", ["check-all", "--json"]]]) {
      const result = runCli(root, args);
      assert.equal(result.status, 0);
      const output = parseCliJson(result);
      assert.equal(output.command, command);
      assert.deepEqual(output.work_ids, ["CHG-022"]);
      assert.deepEqual(output.errors, []);
    }
    const withoutActuals = clone(bootstrap);
    withoutActuals.actuals = null;
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(withoutActuals, null, 2)}\n`);
    const missingActuals = runCli(root, ["check", "CHG-022", "--json"]);
    assert.equal(missingActuals.status, 1);
    assert.equal(parseCliJson(missingActuals).errors[0].code, "WR_ACTUALS_REQUIRED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-range supports named refs and maps invalid Git environment to exit 2", () => {
  const { root, base } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/README.md", "range bootstrap docs\n");
    const head = commitRepo(root, "docs(CHG-123): document readiness range", ["docs/readiness/README.md"]);
    const accepted = runCli(root, ["check-range", "--base", base, "--head", head, "--json"]);
    assert.equal(accepted.status, 0);
    assert.deepEqual(parseCliJson(accepted), {
      ok: true,
      command: "check-range",
      work_ids: ["CHG-123"],
      errors: [],
      summary: "Range readiness is valid for 1 changed path",
    });
    const separated = runCli(root, ["check-range", "--json", base, "--", head]);
    assert.equal(separated.status, 0);
    assert.deepEqual(parseCliJson(separated).work_ids, ["CHG-123"]);
    const result = runCli(root, ["check-range", "--base", "1".repeat(40), "--head", "HEAD", "--json"]);
    assert.equal(result.status, 2);
    const output = parseCliJson(result);
    assert.equal(output.command, "check-range");
    assert.equal(output.errors[0].code, "WR_GIT_ERROR");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-range defaults to the main merge base and rejects a no-verify implementation commit", () => {
  const { root } = makeGitRepo();
  try {
    activateReadinessPolicy(root);
    git(root, ["switch", "-c", "feature/range-bypass"]);
    writeRepoFile(root, "src/bypass.ts", "export const bypass = true;\n");
    git(root, ["add", "--", "src/bypass.ts"]);
    git(root, ["commit", "--no-verify", "-m", "feat(US-999): bypass local readiness hook"]);

    const result = runCli(root, ["check-range", "--json"]);
    assert.equal(result.status, 1);
    const output = parseCliJson(result);
    assert.equal(output.command, "check-range");
    assert.equal(output.errors[0].code, "WR_READINESS_MISSING");
    assert.match(output.errors[0].message, /US-999/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-range on synchronized main validates the latest non-merge commit", () => {
  const { root } = makeGitRepo();
  try {
    activateReadinessPolicy(root);
    writeRepoFile(root, "src/main-bypass.ts", "export const bypass = true;\n");
    git(root, ["add", "--", "src/main-bypass.ts"]);
    git(root, ["commit", "--no-verify", "-m", "feat(US-999): bypass readiness on main"]);
    assert.equal(git(root, ["rev-parse", "main"]), git(root, ["rev-parse", "HEAD"]));

    const result = runCli(root, ["check-range", "--json"]);
    assert.equal(result.status, 1);
    assert.equal(parseCliJson(result).errors[0].code, "WR_READINESS_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-range acquires exact missing GitHub base commits in depth-one PR and push clones", () => {
  const source = makeGitRepo();
  try {
    activateReadinessPolicy(source.root);
    const base = git(source.root, ["rev-parse", "HEAD"]);
    git(source.root, ["switch", "-c", "feature/ci-shallow"]);
    writeRepoFile(source.root, "src/ci-bypass.ts", "export const bypass = true;\n");
    const head = commitRepo(source.root, "feat(US-999): bypass readiness in CI", ["src/ci-bypass.ts"]);

    for (const [name, event] of [
      ["pull-request", { pull_request: { base: { sha: base }, head: { sha: head } } }],
      ["push", { before: base, after: head }],
    ]) {
      const cloneRoot = mkdtempSync(join(tmpdir(), `work-readiness-${name}-clone-`));
      rmSync(cloneRoot, { recursive: true, force: true });
      const cloned = spawnSync("git", ["clone", "--depth=1", "--branch", "feature/ci-shallow", pathToFileURL(source.root).href, cloneRoot], {
        encoding: "utf8",
        shell: false,
        maxBuffer: 1024 * 1024,
      });
      assert.equal(cloned.status, 0, cloned.stderr);
      try {
        assert.notEqual(runGit(cloneRoot, ["cat-file", "-e", `${base}^{commit}`]).status, 0);
        const eventPath = join(cloneRoot, "github-event.json");
        writeFileSync(eventPath, `${JSON.stringify(event)}\n`);
        const result = runCli(cloneRoot, ["check-range", "--json"], {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_PATH: eventPath,
        });
        assert.equal(result.status, 1, `${name}: ${result.stderr}${result.stdout}`);
        assert.equal(parseCliJson(result).errors[0].code, "WR_READINESS_MISSING");
        assert.equal(runGit(cloneRoot, ["cat-file", "-e", `${base}^{commit}`]).status, 0);
      } finally {
        rmSync(cloneRoot, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(source.root, { recursive: true, force: true });
  }
});

// DEC-SMP-022 (2026-10-01) reversed this pin: root `test` is the substrate value and
// the readiness backstop is deliberately NOT chained into it (scripts kept, run on
// demand; check-staged still runs on every commit via .githooks/commit-msg).
test("repository test gate is the substrate value; the readiness backstop stays runnable on demand (DEC-SMP-022)", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts.test, "turbo run test");
  for (const script of ["readiness:check:all", "readiness:check:range", "test:work-readiness"]) {
    assert.equal(typeof manifest.scripts[script], "string", `${script} must remain runnable on demand`);
  }
});

test("CLI parser rejects range mixtures and treats post-separator flags as positional", () => {
  const { root } = makeGitRepo();
  try {
    for (const args of [
      ["check-range", "HEAD", "--head", "missing", "--json"],
      ["check-range", "--base", "HEAD", "HEAD", "--json"],
      ["check", "--json", "--", "US-321", "--json"],
      ["check", "--json", "--", "US-321", "--", "extra"],
    ]) {
      const result = runCli(root, args);
      assert.equal(result.status, 2);
      assert.equal(parseCliJson(result).errors[0].code, "WR_INVOCATION_INVALID");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI init rejects a symlink ancestor before creating anything outside", () => {
  const { root } = makeGitRepo();
  const outside = mkdtempSync(join(tmpdir(), "work-readiness-init-outside-"));
  try {
    symlinkSync(outside, join(root, "docs"));
    const result = runCli(root, ["init", "CHG-123", "--json"]);
    assert.equal(result.status, 2);
    assert.equal(parseCliJson(result).errors[0].code, "WR_PATH_ESCAPE");
    assert.equal(existsSync(join(outside, "readiness")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("exclusive init cleans a short write and remains retryable", () => {
  const { root } = makeGitRepo();
  try {
    assert.throws(
      () => createAssessmentFile({ root, workId: "CHG-123", fsOps: { writeSync: () => 1 } }),
      (error) => error.code === "WR_FILE_WRITE_FAILED",
    );
    assert.equal(existsSync(join(root, "docs/readiness/CHG-123.json")), false);
    assert.deepEqual(readdirSync(join(root, "docs/readiness")), []);
    const retry = runCli(root, ["init", "CHG-123", "--json"]);
    assert.equal(retry.status, 0);
    assert.equal(existsSync(join(root, "docs/readiness/CHG-123.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exclusive init removes a published final when directory durability fails", () => {
  const { root } = makeGitRepo();
  try {
    let syncCalls = 0;
    assert.throws(
      () => createAssessmentFile({
        root,
        workId: "CHG-123",
        fsOps: {
          fsyncSync(descriptor) {
            syncCalls += 1;
            if (syncCalls === 2) {
              const error = new Error("injected directory sync failure");
              error.code = "EIO";
              throw error;
            }
            nodeFsyncSync(descriptor);
          },
        },
      }),
      (error) => error.code === "WR_FILE_WRITE_FAILED",
    );
    assert.equal(syncCalls, 2);
    assert.deepEqual(readdirSync(join(root, "docs/readiness")), []);
    const retry = runCli(root, ["init", "CHG-123", "--json"]);
    assert.equal(retry.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-staged reads the real message file and staged index", () => {
  const { root } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/README.md", "bootstrap docs\n");
    const messagePath = writeGitMessage(root, "docs(CHG-123): document readiness\n");
    git(root, ["add", "docs/readiness/README.md"]);
    const result = runCli(root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(result.status, 0);
    assert.deepEqual(parseCliJson(result), {
      ok: true,
      command: "check-staged",
      work_ids: ["CHG-123"],
      errors: [],
      summary: "Staged readiness ownership is valid for 1 changed path",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-staged validates the index snapshot rather than unstaged authorization", () => {
  const { root } = makeGitRepo();
  try {
    git(root, ["update-index", "--split-index"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    const messagePath = writeGitMessage(root, "feat(US-321): staged implementation\n");

    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(approvedArtifact("US-321"), null, 2)}\n`);
    const unstaged = JSON.parse(readFileSync(join(root, "docs/readiness/US-321.json"), "utf8"));
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decisionFor(unstaged))}\n`);
    const missingFromIndex = runCli(root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(missingFromIndex.status, 1);
    assert.equal(parseCliJson(missingFromIndex).errors[0].code, "WR_READINESS_MISSING");

    writeRepoFile(root, "docs/readiness/US-321.json", "{}\n");
    writeRepoFile(root, ".nous-feedback.jsonl", "{\"story\":\"US-321\",\"event\":\"decision\"}\n");
    git(root, ["add", "docs/readiness/US-321.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(unstaged, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decisionFor(unstaged))}\n`);
    const maskedMalformedIndex = runCli(root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(maskedMalformedIndex.status, 1);
    assert.equal(parseCliJson(maskedMalformedIndex).errors[0].code.startsWith("WR_"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-staged accepts implementation only after readiness evidence is committed", () => {
  const { root } = makeGitRepo();
  try {
    const artifact = approvedArtifact("US-321");
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(artifact, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decisionFor(artifact))}\n`);
    commitRepo(root, "docs(US-321): approve readiness", ["docs/readiness/US-321.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "apps/web/src/app/page.tsx"]);
    writeRepoFile(root, ".nous-feedback.jsonl", "not valid unstaged feedback\n");
    const messagePath = writeGitMessage(root, "feat(US-321): staged approved implementation\n");
    const result = runCli(root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(result.status, 0);
    assert.deepEqual(parseCliJson(result).work_ids, ["US-321"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-staged accepts the actual linked-worktree Git message path", () => {
  const primary = makeGitRepo();
  const linkedRoot = mkdtempSync(join(tmpdir(), "work-readiness-linked-"));
  rmSync(linkedRoot, { recursive: true, force: true });
  try {
    git(primary.root, ["worktree", "add", "-b", "linked-readiness", linkedRoot]);
    writeRepoFile(linkedRoot, "docs/readiness/README.md", "linked bootstrap docs\n");
    git(linkedRoot, ["add", "docs/readiness/README.md"]);
    const messagePath = writeGitMessage(linkedRoot, "docs(CHG-123): linked worktree readiness\n");
    const result = runCli(linkedRoot, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(result.status, 0);
    assert.equal(parseCliJson(result).summary, "Staged readiness ownership is valid for 1 changed path");
  } finally {
    rmSync(linkedRoot, { recursive: true, force: true });
    rmSync(primary.root, { recursive: true, force: true });
  }
});

test("CLI check-staged rejects noncanonical, symlink, directory, and oversized message paths", () => {
  const { root } = makeGitRepo();
  const outside = mkdtempSync(join(tmpdir(), "work-readiness-message-"));
  try {
    writeRepoFile(root, "docs/readiness/README.md", "bootstrap docs\n");
    git(root, ["add", "docs/readiness/README.md"]);
    const canonical = writeGitMessage(root, "docs(CHG-123): canonical\n");
    const arbitrary = join(outside, "COMMIT_EDITMSG");
    writeFileSync(arbitrary, "docs(CHG-123): arbitrary\n");
    const oversized = join(outside, "OVERSIZED");
    writeFileSync(oversized, "x".repeat((4 * 1024 * 1024) + 1));
    for (const path of [arbitrary, outside, oversized]) {
      const result = runCli(root, ["check-staged", "--message-file", path, "--json"]);
      assert.equal(result.status, 2);
      assert.equal(parseCliJson(result).errors[0].code, "WR_FILE_INVALID");
    }
    rmSync(canonical);
    symlinkSync(arbitrary, canonical);
    const canonicalSymlink = runCli(root, ["check-staged", "--message-file", canonical, "--json"]);
    assert.equal(canonicalSymlink.status, 2);
    assert.equal(parseCliJson(canonicalSymlink).errors[0].code, "WR_FILE_INVALID");
    rmSync(canonical);
    writeFileSync(canonical, "x".repeat((4 * 1024 * 1024) + 1));
    const canonicalOversized = runCli(root, ["check-staged", "--message-file", canonical, "--json"]);
    assert.equal(canonicalOversized.status, 2);
    assert.equal(parseCliJson(canonicalOversized).errors[0].code, "WR_FILE_INVALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("CLI commit-message reader keeps reading the opened file after pathname replacement", () => {
  const { root } = makeGitRepo();
  try {
    const original = "docs(CHG-123): original message\n";
    const external = "feat(US-999): replacement message\n";
    const messagePath = writeGitMessage(root, original);
    const movedPath = `${messagePath}.opened`;
    let swapped = false;
    const contents = readCanonicalMessageFile(root, messagePath, {
      openSync(path, flags, mode) {
        assert.equal(flags, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const descriptor = nodeOpenSync(path, flags, mode);
        renameSync(path, movedPath);
        writeFileSync(path, external);
        swapped = true;
        return descriptor;
      },
    });
    assert.equal(swapped, true);
    assert.equal(contents, original);
    assert.equal(readFileSync(messagePath, "utf8"), external);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI check-staged fails closed for unborn and merge HEAD states", () => {
  const unborn = mkdtempSync(join(tmpdir(), "work-readiness-unborn-"));
  const merged = makeGitRepo();
  try {
    git(unborn, ["init", "--initial-branch=main"]);
    git(unborn, ["config", "user.email", "readiness@example.test"]);
    git(unborn, ["config", "user.name", "Readiness Test"]);
    writeRepoFile(unborn, "docs/readiness/README.md", "unborn\n");
    git(unborn, ["add", "docs/readiness/README.md"]);
    const unbornMessage = writeGitMessage(unborn, "docs(CHG-123): unborn\n");
    const unbornResult = runCli(unborn, ["check-staged", "--message-file", unbornMessage, "--json"]);
    assert.equal(unbornResult.status, 2);
    assert.equal(parseCliJson(unbornResult).errors[0].code, "WR_GIT_ERROR");

    git(merged.root, ["checkout", "-b", "side"]);
    writeRepoFile(merged.root, "side.txt", "side\n");
    commitRepo(merged.root, "docs(CHG-123): side", ["side.txt"]);
    git(merged.root, ["checkout", "main"]);
    writeRepoFile(merged.root, "main.txt", "main\n");
    commitRepo(merged.root, "docs(CHG-123): main", ["main.txt"]);
    git(merged.root, ["merge", "--no-ff", "side", "-m", "merge(CHG-123): fixture"]);
    writeRepoFile(merged.root, "docs/readiness/README.md", "after merge\n");
    git(merged.root, ["add", "docs/readiness/README.md"]);
    const mergeMessage = writeGitMessage(merged.root, "docs(CHG-123): after merge\n");
    const mergeResult = runCli(merged.root, ["check-staged", "--message-file", mergeMessage, "--json"]);
    assert.equal(mergeResult.status, 0);
  } finally {
    rmSync(unborn, { recursive: true, force: true });
    rmSync(merged.root, { recursive: true, force: true });
  }
});

function makeMergeHeadRepo() {
  const repo = makeGitRepo();
  git(repo.root, ["checkout", "-b", "side"]);
  writeRepoFile(repo.root, "side.txt", "side\n");
  commitRepo(repo.root, "docs(CHG-123): side", ["side.txt"]);
  git(repo.root, ["checkout", "main"]);
  writeRepoFile(repo.root, "main.txt", "main\n");
  commitRepo(repo.root, "docs(CHG-123): main", ["main.txt"]);
  git(repo.root, ["merge", "--no-ff", "side", "-m", "merge(CHG-123): fixture"]);
  const parents = git(repo.root, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(/\s+/u);
  assert.equal(parents.length, 3, "fixture HEAD must be a two-parent merge");
  return repo;
}

test("CLI check-staged accepts a documentation change staged on a merge HEAD", () => {
  const repo = makeMergeHeadRepo();
  try {
    writeRepoFile(repo.root, "docs/readiness/README.md", "after merge\n");
    git(repo.root, ["add", "docs/readiness/README.md"]);
    const messagePath = writeGitMessage(repo.root, "docs(CHG-123): after merge\n");
    const result = runCli(repo.root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("REVIEWED_RECONCILER_SHA256 matches the reconciler on disk", () => {
  const gitModule = readFileSync(new URL("./work-readiness/git.mjs", import.meta.url), "utf8");
  const pinned = /const REVIEWED_RECONCILER_SHA256 = "([0-9a-f]{64})";/u.exec(gitModule);
  assert.ok(pinned, "REVIEWED_RECONCILER_SHA256 must be a 64-hex constant");
  const reconciler = readFileSync(
    new URL("../infra/scripts/reconcile-sprint1-docs.py", import.meta.url),
  );
  const actual = createHash("sha256").update(reconciler).digest("hex");
  assert.equal(
    pinned[1],
    actual,
    "registeredOverlayLayers() fails closed on a digest mismatch, silently dropping "
      + "overlay ownership for docs/stories/**; re-pin the constant with the reconciler edit",
  );
});

test("CLI check-staged still rejects an unowned implementation path on a merge HEAD", () => {
  const repo = makeMergeHeadRepo();
  try {
    writeRepoFile(repo.root, "src/app.ts", "export const value = 1;\n");
    git(repo.root, ["add", "src/app.ts"]);
    const messagePath = writeGitMessage(repo.root, "chore: unowned implementation\n");
    const result = runCli(repo.root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(parseCliJson(result).errors[0].code, "WR_WORK_ID_MISSING");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

function commitActivationHistory(root, records) {
  writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
  const bootstrapStart = { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" };
  writeRepoFile(root, ".nous-feedback.jsonl", `${[...records, bootstrapStart, bootstrapDecision].map(JSON.stringify).join("\n")}\n`);
  return commitRepo(root, "docs(CHG-022): establish validated activation history", [
    "docs/readiness/CHG-022.json",
    ".nous-feedback.jsonl",
  ]);
}

function historicalOwnership(records) {
  const { root } = makeGitRepo();
  try {
    writeRepoFile(root, ".nous-feedback.jsonl", `${records.map(JSON.stringify).join("\n")}\n`);
    const base = commitRepo(root, "docs(US-321): record historical completion", [".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    commitRepo(root, "feat(US-321): preactivation historical repair", ["apps/web/src/app/page.tsx"]);
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify({ story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" })}\n${JSON.stringify(bootstrapDecision)}\n`);
    const head = commitRepo(root, "docs(CHG-022): activate after historical repair", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
    return validateRangeOwnership({ root, base, head });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Git ownership extracts bounded official IDs and closes path classes", () => {
  assert.deepEqual(
    extractWorkIds("feat(us-123): pair CHG-456 with Us-1234 and US-123, not US-12 or XUS-999Z"),
    ["US-123", "CHG-456", "US-1234"],
  );
  assert.equal(classifyChangedPath("docs/readiness/US-123.json"), "bootstrap-documentation");
  assert.equal(classifyChangedPath("docs/superpowers/plans/plan.md"), "bootstrap-documentation");
  assert.equal(classifyChangedPath(".nous-feedback.jsonl"), "bootstrap-documentation");
  assert.equal(classifyChangedPath("scripts/test-work-readiness.mjs"), "implementation");
  assert.equal(classifyChangedPath("apps/web/src/app/page.tsx"), "implementation");
  assert.equal(classifyChangedPath("docs/stories/SPRINT_PLAN.md"), "generated-nous");
});

test("active policy rejects a new implementation plan without the exact three-line header", () => {
  const { root } = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    const base = approveAfterPolicyActivation(root, value);
    writeRepoFile(root, "docs/superpowers/plans/US-123.md", "# Fixture implementation plan\n\n- Implement it.\n");
    const head = commitRepo(root, "docs(US-123): add unbound implementation plan", ["docs/superpowers/plans/US-123.md"]);
    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_PLAN_HEADER_MISSING" && error.path === "docs/superpowers/plans/US-123.md",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("implementation plan metadata is an exact byte-zero singleton block", () => {
  const variants = [
    ["leading prose", (header) => `# Prose before metadata\n\n${header}`, "WR_PLAN_HEADER_MISSING"],
    ["leading whitespace", (header) => ` ${header}`, "WR_PLAN_HEADER_MISSING"],
    ["UTF-8 BOM", (header) => `\ufeff${header}`, "WR_PLAN_HEADER_MISSING"],
    ["second metadata block", (header) => `${header}\n${header}`, "WR_PLAN_HEADER_INVALID"],
    ["duplicate work key", (header) => `${header}\n**Work item:** US-123\n`, "WR_PLAN_HEADER_INVALID"],
    ["extra metadata line", (header) => header.replace("\n\n# Fixture", "\n**Owner:** user\n\n# Fixture"), "WR_PLAN_HEADER_INVALID"],
    ["malformed estimate key", (header) => header.replace("**Approved estimate:**", "**Approved budget:**"), "WR_PLAN_HEADER_INVALID"],
    ["duplicate metadata beyond scan prefix", (header) => `${header}${"x".repeat(17 * 1024)}\n**Work item:** US-123\n`, "WR_PLAN_HEADER_INVALID"],
  ];
  for (const [name, mutate, code] of variants) {
    const { root } = makeGitRepo();
    try {
      const value = approvedArtifact("US-123");
      const base = approveAfterPolicyActivation(root, value);
      writeRepoFile(root, "docs/superpowers/plans/US-123.md", mutate(implementationPlanHeader(value)));
      const head = commitRepo(root, `docs(US-123): ${name}`, ["docs/superpowers/plans/US-123.md"]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === code, name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("implementation plan header binds the exact work ID and normalized readiness path", () => {
  for (const [overrides, code] of [
    [{ workId: "CHG-456" }, "WR_PLAN_WORK_ID_MISMATCH"],
    [{ readinessPath: "docs/readiness/CHG-456.json" }, "WR_PLAN_READINESS_PATH_MISMATCH"],
    [{ readinessPath: "docs/readiness/../readiness/US-123.json" }, "WR_GIT_PATH_INVALID"],
  ]) {
    const { root } = makeGitRepo();
    try {
      const value = approvedArtifact("US-123");
      const base = approveAfterPolicyActivation(root, value);
      writeRepoFile(root, "docs/superpowers/plans/US-123.md", implementationPlanHeader(value, overrides));
      const head = commitRepo(root, "docs(US-123): add mismatched implementation plan", ["docs/superpowers/plans/US-123.md"]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === code);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("implementation plan estimate cannot exceed the approved readiness estimate", () => {
  const { root } = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    const base = approveAfterPolicyActivation(root, value);
    writeRepoFile(root, "docs/superpowers/plans/US-123.md", implementationPlanHeader(value, { estimate: value.estimate_minutes.total + 1 }));
    const head = commitRepo(root, "docs(US-123): raise plan estimate", ["docs/superpowers/plans/US-123.md"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_PLAN_ESTIMATE_OVER_BUDGET");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("normal implementation after activation requires one valid approved plan binding", () => {
  const missing = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    const base = approveAfterPolicyActivation(missing.root, value);
    writeRepoFile(missing.root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(missing.root, "feat(US-123): implement without a plan", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root: missing.root, base, head }), (error) => error.code === "WR_IMPLEMENTATION_PLAN_MISSING");
  } finally {
    rmSync(missing.root, { recursive: true, force: true });
  }

  const valid = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    approveAfterPolicyActivation(valid.root, value);
    writeRepoFile(valid.root, "docs/superpowers/plans/US-123.md", implementationPlanHeader(value));
    commitRepo(valid.root, "docs(US-123): bind implementation plan", ["docs/superpowers/plans/US-123.md"]);
    const base = git(valid.root, ["rev-parse", "HEAD"]);
    writeRepoFile(valid.root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(valid.root, "feat(US-123): implement approved plan", ["apps/web/src/app/page.tsx"]);
    assert.equal(validateRangeOwnership({ root: valid.root, base, head }).classification, "implementation");
  } finally {
    rmSync(valid.root, { recursive: true, force: true });
  }
});




test("docs-only terminal transition requires complete actuals and freezes them forever", () => {
  for (const missingActuals of [true, false]) {
    const { root } = makeGitRepo();
    try {
      const value = approvedArtifact("US-123");
      approveAfterPolicyActivation(root, value);
      const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
      writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify({ story: value.work_id, event: "started", agent: "actuals-transition-test" })}\n${JSON.stringify({ story: value.work_id, event: "build_pass", notes: "Focused gate passed" })}\n`);
      commitRepo(root, "docs(US-123): establish terminal prerequisites", [".nous-feedback.jsonl"]);
      const base = git(root, ["rev-parse", "HEAD"]);
      const terminal = missingActuals ? value : completed();
      writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(terminal, null, 2)}\n`);
      const lifecycle = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
      writeRepoFile(root, ".nous-feedback.jsonl", `${lifecycle}${JSON.stringify({ story: value.work_id, event: "done" })}\n`);
      const head = commitRepo(root, "docs(US-123): record terminal completion", [`docs/readiness/${value.work_id}.json`, ".nous-feedback.jsonl"]);
      if (missingActuals) {
        assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_ACTUALS_REQUIRED");
      } else {
        assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
        const frozenBase = head;
        terminal.actuals.root_cause = "Recalibrated after done";
        writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(terminal, null, 2)}\n`);
        const rewritten = commitRepo(root, "docs(US-123): rewrite completed actuals", [`docs/readiness/${value.work_id}.json`]);
        assert.throws(() => validateRangeOwnership({ root, base: frozenBase, head: rewritten }), (error) => error.code === "WR_ACTUALS_IMMUTABLE");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("preterminal provisional actuals remain mutable", () => {
  const { root } = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    const base = approveAfterPolicyActivation(root, value);
    value.actuals = {
      phase_minutes: { readiness: null, implementation: 1, focused_verification: null, review: null, integration: null },
      total: null, changed_files: null, commits: null, review_fix_loops: null,
      cold_mutation_attempts: null, mutation_invalidations: null,
      estimate_variance_minutes: null, root_cause: null,
    };
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
    commitRepo(root, "docs(US-123): record provisional actuals", ["docs/readiness/US-123.json"]);
    value.actuals.phase_minutes.implementation = 2;
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
    const head = commitRepo(root, "docs(US-123): recalibrate provisional actuals", ["docs/readiness/US-123.json"]);
    assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("completed actuals reject deletion as well as recalibration", () => {
  for (const mutation of ["delete", "recalibrate"]) {
    const { root } = makeGitRepo();
    try {
      const value = approvedArtifact("US-123");
      approveAfterPolicyActivation(root, value);
      const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
      const terminal = completed();
      writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(terminal, null, 2)}\n`);
      writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify({ story: value.work_id, event: "started", agent: "immutable-actuals-test" })}\n${JSON.stringify({ story: value.work_id, event: "build_pass", notes: "Gate passed" })}\n${JSON.stringify({ story: value.work_id, event: "done" })}\n`);
      commitRepo(root, "docs(US-123): establish immutable completion", ["docs/readiness/US-123.json", ".nous-feedback.jsonl"]);
      const base = git(root, ["rev-parse", "HEAD"]);
      if (mutation === "delete") terminal.actuals = null;
      else terminal.actuals.changed_files += 1;
      writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(terminal, null, 2)}\n`);
      const head = commitRepo(root, `docs(US-123): ${mutation} completed actuals`, ["docs/readiness/US-123.json"]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_ACTUALS_IMMUTABLE", mutation);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("completed actuals reject byte-only reformatting", () => {
  const { root } = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    approveAfterPolicyActivation(root, value);
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    const terminal = completed();
    const readinessPath = "docs/readiness/US-123.json";
    writeRepoFile(root, readinessPath, `${JSON.stringify(terminal, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify({ story: value.work_id, event: "started", agent: "immutable-bytes-test" })}\n${JSON.stringify({ story: value.work_id, event: "build_pass", notes: "Gate passed" })}\n${JSON.stringify({ story: value.work_id, event: "done" })}\n`);
    commitRepo(root, "docs(US-123): establish byte-immutable completion", [readinessPath, ".nous-feedback.jsonl"]);
    const base = git(root, ["rev-parse", "HEAD"]);
    const original = readFileSync(join(root, readinessPath), "utf8");
    writeRepoFile(root, readinessPath, original.replace('"changed_files": 7', '"changed_files" : 7'));
    const head = commitRepo(root, "docs(US-123): reformat completed actuals", [readinessPath]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_ACTUALS_IMMUTABLE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function establishCorrectableCompletion(root) {
  const { value, authority, records, correction } = correctionFixture();
  approveAfterPolicyActivation(root, value);
  const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
  const lifecycle = records.filter((record) => record.story === value.work_id && record.event !== "decision");
  writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(value, null, 2)}\n`);
  writeRepoFile(root, `docs/readiness/${authority.work_id}.json`, `${JSON.stringify(authority, null, 2)}\n`);
  writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${lifecycle.map(JSON.stringify).join("\n")}\n`);
  const base = commitRepo(root, `docs(${value.work_id}): record correctable completion`, [
    `docs/readiness/${value.work_id}.json`,
    `docs/readiness/${authority.work_id}.json`,
    ".nous-feedback.jsonl",
  ]);
  return { value, base, correction, correctingDecision: records.find((record) => record.story === "CHG-059") };
}

test("a correction-only commit validates the appended event and includes its target work item", () => {
  const { root } = makeGitRepo();
  try {
    const { value, base, correction, correctingDecision } = establishCorrectableCompletion(root);
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify(correctingDecision)}\n${JSON.stringify(correction)}\n`);
    const head = commitRepo(root, "docs(CHG-059): append factual actuals correction", [".nous-feedback.jsonl"]);
    const result = validateRangeOwnership({ root, base, head });
    assert.equal(result.classification, "bootstrap-documentation");
    assert.deepEqual(result.workIds, ["CHG-059", value.work_id]);
    assert.deepEqual(JSON.parse(readFileSync(join(root, `docs/readiness/${value.work_id}.json`), "utf8")).actuals, value.actuals);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a correction-only Git transition fails when the target never reaches a terminal", () => {
  const { root } = makeGitRepo();
  try {
    const { value, records, correction } = correctionFixture();
    const correctingDecision = records.find((record) => record.story === "CHG-059");
    const base = approveAfterPolicyActivation(root, value);
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify(correctingDecision)}\n${JSON.stringify(correction)}\n`);
    const head = commitRepo(root, "docs(CHG-059): append pre-terminal actuals correction", [".nous-feedback.jsonl"]);
    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_ACTUALS_CORRECTION_MISSING_TERMINAL",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a correction-only commit rejects a forged target hash", () => {
  const { root } = makeGitRepo();
  try {
    const { base, correction, correctingDecision } = establishCorrectableCompletion(root);
    correction.target_actuals_sha256 = "f".repeat(64);
    const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify(correctingDecision)}\n${JSON.stringify(correction)}\n`);
    const head = commitRepo(root, "docs(CHG-059): append forged actuals correction", [".nous-feedback.jsonl"]);
    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_ACTUALS_CORRECTION_TARGET_HASH_MISMATCH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a valid correction never authorizes rewriting or deleting immutable raw actuals", () => {
  for (const mutation of ["rewrite", "delete"]) {
    const { root } = makeGitRepo();
    try {
      const { value, base, correction, correctingDecision } = establishCorrectableCompletion(root);
      const prior = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
      writeRepoFile(root, ".nous-feedback.jsonl", `${prior}${JSON.stringify(correctingDecision)}\n${JSON.stringify(correction)}\n`);
      if (mutation === "delete") value.actuals = null;
      else value.actuals.changed_files = 8;
      writeRepoFile(root, `docs/readiness/${value.work_id}.json`, `${JSON.stringify(value, null, 2)}\n`);
      const head = commitRepo(root, `docs(CHG-059): ${mutation} raw actuals with correction`, [
        `docs/readiness/${value.work_id}.json`,
        ".nous-feedback.jsonl",
      ]);
      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_ACTUALS_IMMUTABLE",
        mutation,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("range ownership rejects same-commit approval for every implementation ID", () => {
  const { root, base } = makeGitRepo();
  try {
    const first = approvedArtifact("US-321");
    const second = approvedArtifact("CHG-456");
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(first, null, 2)}\n`);
    writeRepoFile(root, "docs/readiness/CHG-456.json", `${JSON.stringify(second, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${[decisionFor(first), decisionFor(second)].map(JSON.stringify).join("\n")}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321 CHG-456): approve and implement together", [
      "docs/readiness/US-321.json",
      "docs/readiness/CHG-456.json",
      ".nous-feedback.jsonl",
      "apps/web/src/app/page.tsx",
    ]);
    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_READINESS_MISSING" && error.path === "docs/readiness/US-321.json",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lowercase message and path work references normalize to parent-approved IDs", () => {
  const messageFixture = makeGitRepo();
  try {
    installReadinessHook(messageFixture.root);
    commitReadinessEvidence(messageFixture.root, [approvedArtifact("US-123")]);
    writeRepoFile(messageFixture.root, "apps/web/src/app/page.tsx", "export {};\n");
    git(messageFixture.root, ["add", "apps/web/src/app/page.tsx"]);
    const committed = runGit(messageFixture.root, ["commit", "-m", "feat(us-123): lowercase ownership"]);
    assert.equal(committed.status, 0, committed.stderr);
  } finally {
    rmSync(messageFixture.root, { recursive: true, force: true });
  }

  const pathFixture = makeGitRepo();
  try {
    const decision = writeApprovedWork(pathFixture.root, "US-123");
    writeRepoFile(pathFixture.root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    commitRepo(pathFixture.root, "docs(US-123): approve lowercase path fixture", ["docs/readiness/US-123.json", ".nous-feedback.jsonl"]);
    const base = git(pathFixture.root, ["rev-parse", "HEAD"]);
    writeRepoFile(pathFixture.root, "artifacts/us-123/result.txt", "implementation\n");
    const head = commitRepo(pathFixture.root, "feat: lowercase path ownership", ["artifacts/us-123/result.txt"]);
    assert.deepEqual(validateRangeOwnership({ root: pathFixture.root, base, head }).workIds, ["US-123"]);
  } finally {
    rmSync(pathFixture.root, { recursive: true, force: true });
  }
});

test("real Git permits only a documentation bootstrap without prior approval", () => {
  const { root, base } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/superpowers/plans/US-321.md", "# assessment plan\n");
    const head = commitRepo(root, "docs(US-321): assess readiness", ["docs/superpowers/plans/US-321.md"]);
    assert.deepEqual(validateRangeOwnership({ root, base, head }), {
      workIds: ["US-321"],
      changedPaths: ["docs/superpowers/plans/US-321.md"],
      classification: "bootstrap-documentation",
      grandfatheredWorkIds: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("range ownership validates implementation at each commit before later approval", () => {
  const { root, base } = makeGitRepo();
  try {
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    commitRepo(root, "feat(US-321): implement before approval", ["apps/web/src/app/page.tsx"]);
    const decision = writeApprovedWork(root, "US-321");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    const head = commitRepo(root, "docs(US-321): approve after implementation", ["docs/readiness/US-321.json", ".nous-feedback.jsonl"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("range ownership accepts approval before a later implementation commit", () => {
  const { root, base } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "US-321");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    commitRepo(root, "docs(US-321): approve before implementation", ["docs/readiness/US-321.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): implement approved work", ["apps/web/src/app/page.tsx"]);
    assert.equal(validateRangeOwnership({ root, base, head }).classification, "implementation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real range requires a currently active parent authorization interval", () => {
  const terminalValue = completed();
  const terminalDecision = decisionFor(terminalValue);
  const changeDecision = { story: "CHG-099", event: "decision", id: "CHG099-RANGE-TERMINAL", text: "Repair terminal", reason: "Review" };
  const variants = [
    ["blocked", normal(), [decisionFor(normal()), { story: "US-123", event: "blocked", reason: "Dependency reopened" }]],
    ["blocker", normal(), [decisionFor(normal()), { story: "US-123", event: "blocker", reason: "Scope reopened" }]],
    ["terminal", terminalValue, [
      terminalDecision,
      { story: "US-123", event: "started", agent: "range-test" },
      { story: "US-123", event: "build_pass", notes: "Build passed" },
      { story: "US-123", event: "done" },
    ]],
    ["deferred terminal", terminalValue, [
      terminalDecision,
      { story: "US-123", event: "started", agent: "range-test" },
      { story: "US-123", event: "build_pass", notes: "Build passed" },
      { story: "US-123", event: "done_with_deferral" },
    ]],
    ["projected terminal", terminalValue, [
      terminalDecision,
      { story: "US-123", event: "started", agent: "range-test" },
      { story: "US-123", event: "build_pass", notes: "Build passed" },
      { story: "US-123", event: "done" },
      changeDecision,
      {
        story: "US-123", event: "evidence_superseded", ref: "US123-RANGE-DONE",
        target: { story: "US-123", event: "done" }, reason: "Revalidate",
      },
      { story: "US-123", event: "revalidated", ref: "US123-RANGE-DONE", change: "CHG-099", as_event: "done" },
    ]],
    ["later decision", normal(), [
      decisionFor(normal()),
      decisionFor(normal(), { id: "US123-READY-LATER", reason: "Later readiness review" }),
    ]],
  ];
  for (const [name, value, records] of variants) {
    const { root } = makeGitRepo();
    try {
      writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
      writeRepoFile(root, ".nous-feedback.jsonl", `${records.map(JSON.stringify).join("\n")}\n`);
      const base = commitRepo(root, `docs(US-123): ${name} authorization fixture`, ["docs/readiness/US-123.json", ".nous-feedback.jsonl"]);
      writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
      const head = commitRepo(root, "feat(US-123): attempt inactive implementation", ["apps/web/src/app/page.tsx"]);
      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_APPROVAL_INACTIVE",
        name,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const refreshedRepo = makeGitRepo();
  try {
    const value = approvedArtifact("US-123");
    const oldDecision = decisionFor(value);
    value.approval.evidence = "US123-READY-V2";
    const freshDecision = decisionFor(value);
    writeRepoFile(refreshedRepo.root, "docs/readiness/US-123.json", `${JSON.stringify(value, null, 2)}\n`);
    writeRepoFile(refreshedRepo.root, ".nous-feedback.jsonl", `${[
      oldDecision,
      { story: "US-123", event: "blocker", reason: "Scope reopened" },
      freshDecision,
    ].map(JSON.stringify).join("\n")}\n`);
    const base = commitRepo(refreshedRepo.root, "docs(US-123): record fresh reapproval", ["docs/readiness/US-123.json", ".nous-feedback.jsonl"]);
    writeRepoFile(refreshedRepo.root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(refreshedRepo.root, "feat(US-123): implement freshly approved scope", ["apps/web/src/app/page.tsx"]);
    assert.equal(validateRangeOwnership({ root: refreshedRepo.root, base, head }).classification, "implementation");
  } finally {
    rmSync(refreshedRepo.root, { recursive: true, force: true });
  }
});

test("documentation bootstrap rejects malformed feedback JSONL and readiness artifacts", () => {
  const fixtures = [
    [".nous-feedback.jsonl", "not json\n", "WR_FEEDBACK_INVALID"],
    [".nous-feedback.jsonl", "[]\n", "WR_FEEDBACK_INVALID"],
    ["docs/readiness/US-321.json", "{not json}\n", "WR_READINESS_INVALID"],
    ["docs/readiness/US-321.json", "{}\n", "WR_MISSING_PROPERTY"],
  ];
  for (const [path, contents, code] of fixtures) {
    const { root, base } = makeGitRepo();
    try {
      writeRepoFile(root, path, contents);
      const head = commitRepo(root, "docs(US-321): malformed machine bootstrap", [path]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === code);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("documentation bootstrap accepts a closed pending normal assessment", () => {
  const { root, base } = makeGitRepo();
  try {
    const pending = approvedArtifact("US-321");
    pending.approval.status = "pending";
    pending.approval.approved_by = null;
    pending.approval.evidence = null;
    writeRepoFile(root, "docs/readiness/US-321.json", `${JSON.stringify(pending, null, 2)}\n`);
    const head = commitRepo(root, "docs(US-321): create pending readiness", ["docs/readiness/US-321.json"]);
    assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real Git rejects missing readiness and treats tests and tools as implementation", () => {
  for (const path of ["apps/web/src/app/page.tsx", "scripts/new-tool.mjs", "apps/web/src/page.test.ts"] ) {
    const { root, base } = makeGitRepo();
    try {
      writeRepoFile(root, path, "export {};\n");
      const head = commitRepo(root, "feat(US-321): implementation", [path]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("real Git requires readiness for every ID named by a production range", () => {
  const { root, base } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "US-321");
    const unready = approvedArtifact("CHG-456");
    unready.approval.status = "pending";
    unready.approval.approved_by = null;
    unready.approval.evidence = null;
    writeRepoFile(root, "docs/readiness/CHG-456.json", `${JSON.stringify(unready, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    commitRepo(root, "docs(US-321 CHG-456): record readiness before implementation", [
      "docs/readiness/US-321.json", "docs/readiness/CHG-456.json", ".nous-feedback.jsonl",
    ]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321 CHG-456): production change", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_APPROVAL_REQUIRED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an exact Nous sync envelope authorizes generated documentation", () => {
  const { root, base } = makeGitRepo();
  try {
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    const generated = "# Sprint plan from Nous\n";
    writeExactNousSyncEnvelope(root, generatedPath, generated);
    const head = commitRepo(root, "docs(CHG-045): sync generated sprint", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);

    assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// CHG-106: real index, ordinary hook, immutable transition and whole history
// share one snapshot; these kill all-envelope and equal-second regressions.
test("CHG-106 consistent snapshots pass staged committed and complete linear history", () => {
  const { root } = makeGitRepo();
  const generatedPath = "docs/stories/SPRINT_PLAN.md";
  const paths = [".nous-provenance.json", ".nous-project.json", ".nous-sync.json", generatedPath];
  try {
    activateReadinessPolicy(root);
    const base = git(root, ["rev-parse", "HEAD"]);
    installReadinessHook(root);
    let parent = base;
    const variants = [
      ["initial", {}],
      ["cross-second identity", { project: { generated_at: "2026-09-05T21:40:54Z" }, sync: { synced_at: "2026-09-05T21:42:56Z" } }],
      ["retained identity and provenance", { project: { generated_at: "2026-09-05T21:40:54Z" }, sync: { synced_at: "2026-09-05T21:43:00Z" } }],
      ["future UTC", { project: { generated_at: "2099-12-31T23:59:59Z" }, sync: { synced_at: "2099-12-31T23:59:58+00:00" } }],
      ["nonmonotonic UTC", { project: { generated_at: "2001-01-01T00:00:00Z" }, sync: { synced_at: "2000-01-01T00:00:00Z" } }],
      ["checksum transition", { project: { checksum: "1122334455667788" }, sync: { synced_at: "2026-09-06T00:00:00Z" } }],
      ["revision transition", { provenance: { git_sha: "12345678abcd" }, project: { substrate_commit: "12345678" } }],
    ];
    for (const [name, overrides] of variants) {
      writeExactNousSyncEnvelope(root, generatedPath, `# Snapshot ${name}\n`, overrides);
      git(root, ["add", "--", ...paths]);
      if (name === "retained identity and provenance") {
        assert.deepEqual(listChangedPaths({ root, staged: true }).sort(), [".nous-sync.json", generatedPath].sort());
      }
      const message = `docs(CHG-106): ${name}`;
      const staged = runCli(root, ["check-staged", "--message-file", writeGitMessage(root, message + "\n"), "--json"]);
      assert.equal(staged.status, 0, `${name}: ${staged.stdout}${staged.stderr}`);
      assert.equal(JSON.parse(staged.stdout).ok, true);
      const committed = runGit(root, ["commit", "-m", message]);
      assert.equal(committed.status, 0, `${name}: ${committed.stderr}`);
      const head = git(root, ["rev-parse", "HEAD"]);
      assert.equal(validateRangeOwnership({ root, base: parent, head }).classification, "bootstrap-documentation");
      assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
      parent = head;
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CHG-106 snapshot guards reject independent hostile state from passing controls", () => {
  const path = "docs/stories/SPRINT_PLAN.md";
  const source = "/fixture/Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
  const cases = [
    ["identity shape", ({ project }) => { project.extra = true; }],
    ["sync shape", ({ sync }) => { sync.extra = true; }],
    ["provenance shape", ({ provenance }) => { provenance.extra = true; }],
    ["calendar", ({ project }) => { project.generated_at = "2026-02-30T00:00:00Z"; }],
    ["UTC syntax", ({ sync }) => { sync.synced_at = "2026-09-05T21:40:53"; }],
    ["UTC offset", ({ sync }) => { sync.synced_at = "2026-09-05T16:40:53-05:00"; }],
    ["project boundary", ({ project, provenance, sync }) => { project.project_id = provenance.project_id = sync.project_id = "other__tenant"; }],
    ["organization boundary", ({ project }) => { project.organization = "other_org"; }],
    ["namespace boundary", ({ project }) => { project.nous_namespace = "other/tenant"; }],
    ["checksum", ({ project }) => { project.checksum = "invalid"; }],
    ["revision", ({ project }) => { project.substrate_commit = "00000000"; }],
    ["provenance project", ({ provenance }) => { provenance.project_id = "other__tenant"; }],
    ["candidate hash", ({ sync }) => { sync.files[path].hash = "0".repeat(16); }],
    ["candidate source", ({ sync }) => { sync.files[path].source = "Nous/relative.md"; }],
    ["fresh extra claim", ({ sync }) => { sync.files["docs/specs/extra.md"] = { hash: "0".repeat(16), source: "generated" }; }],
    ["changed extra claim", ({ sync }) => { sync.files["docs/specs/retained.md"] = { hash: "0".repeat(16), source: "generated" }; }],
    ...["Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md", "Nous/Specs/fixture/ledger/v1/stories", "Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md/child"].map(dirty =>
      [`dirty overlap ${dirty}`, ({ provenance }) => { provenance.dirty = true; provenance.dirty_paths = [dirty]; }]),
    ["identity executable", () => {}], ["provenance executable", () => {}],
    ["generated executable", () => {}], ["generated symlink", () => {}],
    ["unmanaged path", () => {}],
  ];
  for (const [name, mutate] of cases) {
    const { root } = makeGitRepo();
    const paths = [".nous-provenance.json", ".nous-project.json", ".nous-sync.json", path, "docs/specs/retained.md"];
    try {
      writeRepoFile(root, "docs/specs/retained.md", "# Retained\n");
      const retained = { hash: createHash("sha256").update("# Retained\n").digest("hex").slice(0, 16), source: "generated" };
      const write = (text, change = () => {}) => writeExactNousSyncEnvelope(root, path, text, {
        mutate: envelope => { envelope.sync.files[path].source = source; envelope.sync.files["docs/specs/retained.md"] = retained; change(envelope); },
      });
      write("# First\n");
      const base = commitRepo(root, "docs(CHG-106): seed snapshot guard", paths);
      write("# Second\n");
      const good = commitRepo(root, "docs(CHG-106): passing guard control", paths);
      assert.equal(validateRangeOwnership({ root, base, head: good }).classification, "bootstrap-documentation", name);
      git(root, ["reset", "--hard", base]);
      write("# Second\n", mutate);
      if (name === "identity executable") chmodSync(join(root, ".nous-project.json"), 0o755);
      if (name === "provenance executable") chmodSync(join(root, ".nous-provenance.json"), 0o755);
      if (name === "generated executable") chmodSync(join(root, path), 0o755);
      if (name === "generated symlink") { rmSync(join(root, path)); symlinkSync("../../README.md", join(root, path)); }
      if (name === "unmanaged path") { writeRepoFile(root, "docs/unmanaged.md", "# Extra\n"); paths.push("docs/unmanaged.md"); }
      const bad = commitRepo(root, `docs(CHG-106): hostile ${name}`, paths);
      assert.throws(() => validateRangeOwnership({ root, base, head: bad }),
        error => error instanceof WorkReadinessError && error.code === "WR_GENERATED_NOUS_PATH" && error.path === path, name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("CHG-106 ordinary implementation retains independent parent authority", () => {
  const variants = [
    ["missing readiness", "WR_READINESS_MISSING", "docs/readiness/US-123.json"],
    ["missing approval", "WR_APPROVAL_REQUIRED", "$.approval.status"],
    ["digest", "WR_APPROVAL_DIGEST_MISMATCH", "$.readiness_payload_sha256"],
    ["missing plan", "WR_IMPLEMENTATION_PLAN_MISSING", "docs/superpowers/plans/US-123.md"],
    ["ambiguous plan", "WR_IMPLEMENTATION_PLAN_AMBIGUOUS", "docs/superpowers/plans"],
    ["inactive", "WR_APPROVAL_INACTIVE", "$.approval.evidence"],
    ["candidate self-approval", "WR_READINESS_MISSING", "docs/readiness/US-123.json"],
    ["missing ownership", "WR_WORK_ID_MISSING", "$.message"],
    ["feedback history", "WR_FEEDBACK_HISTORY_MUTATED", ".nous-feedback.jsonl"],
  ];
  for (const [name, code, errorPath] of variants) {
    const { root } = makeGitRepo();
    const path = "src/implementation.ts", readinessPath = "docs/readiness/US-123.json";
    try {
      const value = approvedArtifact("US-123");
      approveAfterPolicyActivation(root, value);
      writeRepoFile(root, "docs/superpowers/plans/US-123.md", implementationPlanHeader(value));
      const base = commitRepo(root, "docs(US-123): bound authority control", ["docs/superpowers/plans/US-123.md"]);
      writeExactNousSyncEnvelope(root, path, "export const implemented = true;\n");
      const good = commitRepo(root, "feat(US-123): passing independent authority", [path, ".nous-project.json", ".nous-provenance.json", ".nous-sync.json"]);
      assert.equal(validateRangeOwnership({ root, base, head: good }).classification, "implementation", name);
      git(root, ["reset", "--hard", base]);
      const records = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
      const parentPaths = [];
      if (["missing readiness", "candidate self-approval"].includes(name)) { rmSync(join(root, readinessPath)); parentPaths.push(readinessPath); }
      if (name === "missing approval") { const pending = pendingArtifact("US-123"); writeRepoFile(root, readinessPath, JSON.stringify(pending) + "\n"); parentPaths.push(readinessPath); }
      if (name === "digest") { value.outcomes[0].statement = "Changed without fresh digest"; writeRepoFile(root, readinessPath, JSON.stringify(value) + "\n"); parentPaths.push(readinessPath); }
      if (name === "missing plan") { rmSync(join(root, "docs/superpowers/plans/US-123.md")); parentPaths.push("docs/superpowers/plans/US-123.md"); }
      if (name === "ambiguous plan") { writeRepoFile(root, "docs/superpowers/plans/duplicate.md", implementationPlanHeader(value)); parentPaths.push("docs/superpowers/plans/duplicate.md"); }
      if (name === "inactive") { writeRepoFile(root, ".nous-feedback.jsonl", records + JSON.stringify({ story: "US-123", event: "blocker", reason: "Independent inactive control" }) + "\n"); parentPaths.push(".nous-feedback.jsonl"); }
      const parent = parentPaths.length ? commitRepo(root, "docs(US-123): hostile parent fixture", parentPaths) : base;
      const childPaths = [path, ".nous-project.json", ".nous-provenance.json", ".nous-sync.json"];
      if (name === "candidate self-approval") { writeRepoFile(root, readinessPath, JSON.stringify(value) + "\n"); childPaths.push(readinessPath); }
      if (name === "feedback history") { writeRepoFile(root, ".nous-feedback.jsonl", records.replace("Policy activation", "Rewritten activation")); childPaths.push(".nous-feedback.jsonl"); }
      writeExactNousSyncEnvelope(root, path, "export const implemented = true;\n");
      const head = commitRepo(root, name === "missing ownership" ? "feat: unowned implementation" : `feat(US-123): hostile ${name}`, childPaths);
      assert.throws(() => validateRangeOwnership({ root, base: parent, head }),
        error => error instanceof WorkReadinessError && error.code === code && error.path === errorPath, name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("CHG-106 complete history rejects invalid middle snapshot after endpoint restoration", () => {
  const { root } = makeGitRepo();
  const path = "docs/stories/SPRINT_PLAN.md";
  const paths = [path, ".nous-project.json", ".nous-provenance.json", ".nous-sync.json"];
  try {
    writeExactNousSyncEnvelope(root, path, "# First\n");
    const base = commitRepo(root, "docs(CHG-106): valid history seed", paths);
    writeExactNousSyncEnvelope(root, path, "# Second\n");
    const good = commitRepo(root, "docs(CHG-106): valid history control", paths);
    assert.equal(validateRangeOwnership({ root, base, head: good }).classification, "bootstrap-documentation");
    writeExactNousSyncEnvelope(root, path, "# Invalid middle\n", { mutate: ({ sync }) => { sync.files[path].hash = "0".repeat(16); } });
    commitRepo(root, "docs(CHG-106): invalid middle", paths);
    writeExactNousSyncEnvelope(root, path, "# Third valid endpoint\n");
    const head = commitRepo(root, "docs(CHG-106): restore valid endpoint", paths);
    const middle = git(root, ["rev-parse", `${head}^`]);
    assert.equal(validateRangeOwnership({ root, base: middle, head }).classification, "bootstrap-documentation");
    assert.throws(() => validateRangeOwnership({ root, base, head }),
      error => error instanceof WorkReadinessError && error.code === "WR_GENERATED_NOUS_PATH" && error.path === path);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// CHG-103 keeps the existing custody route and all predicates; the only new
// category is canonical managed decisions. These are real Git/hook contracts.
const managedDecisionPath = "docs/decisions/DECISION_MATRIX.md";
const managedDecisionStory = "docs/stories/CHANGES.md";
const managedDecisionSource = "/fixture/Nous/Specs/fixture/ledger/v1/decisions/DECISION_MATRIX.md";
const decisionEnvelopePaths = [".nous-provenance.json", ".nous-project.json", ".nous-sync.json"];
function writeManagedDecisionDelivery(root, version, { retainDecision = false, mutate = () => {} } = {}) {
  const decisionBytes = `# Canonical decision version ${version}\n`;
  const storyBytes = `# Canonical changes version ${version}\n`;
  const priorDecision = retainDecision ? JSON.parse(readFileSync(join(root, ".nous-sync.json"), "utf8")).files[managedDecisionPath] : null;
  if (!retainDecision) writeRepoFile(root, managedDecisionPath, decisionBytes);
  writeExactNousSyncEnvelope(root, managedDecisionStory, storyBytes, {
    provenance: { git_sha: version === 1 ? "11111111abcd" : version === 2 ? "22222222abcd" : "33333333abcd" },
    project: { substrate_commit: version === 1 ? "11111111" : version === 2 ? "22222222" : "33333333" },
    mutate: (envelope) => {
      envelope.sync.files[managedDecisionPath] = priorDecision ?? {
        hash: createHash("sha256").update(decisionBytes).digest("hex").slice(0, 16), source: managedDecisionSource,
      };
      mutate(envelope);
    },
  });
  return [...decisionEnvelopePaths, managedDecisionStory, ...(retainDecision ? [] : [managedDecisionPath])];
}

test("CHG-103 managed decisions pass first changed and retained delivery through staged commit and complete history", () => {
  const { root } = makeGitRepo();
  try {
    activateReadinessPolicy(root);
    const base = git(root, ["rev-parse", "HEAD"]);
    installReadinessHook(root);
    let parent = base;
    for (const version of [1, 2, 3]) {
      const paths = writeManagedDecisionDelivery(root, version, { retainDecision: version === 3 });
      git(root, ["add", "--", ...paths]);
      const message = `docs(CHG-103): canonical managed decision delivery ${version}`;
      const messagePath = writeGitMessage(root, message + "\n");
      const staged = runCli(root, ["check-staged", "--message-file", messagePath, "--json"]);
      assert.equal(staged.status, 0, `version ${version}: ${staged.stdout}${staged.stderr}`);
      assert.equal(JSON.parse(staged.stdout).ok, true);
      const ordinary = runGit(root, ["commit", "-m", message]);
      assert.equal(ordinary.status, 0, ordinary.stderr);
      const head = git(root, ["rev-parse", "HEAD"]);
      assert.equal(validateRangeOwnership({ root, base: parent, head }).classification, "bootstrap-documentation");
      assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
      if (version === 3) assert.equal(listChangedPaths({ root, base: parent, head }).includes(managedDecisionPath), false);
      parent = head;
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CHG-103 managed decision custody rejects independent hostile claims", () => {
  const variants = [
    ["unclaimed decision", ({ sync }) => { delete sync.files[managedDecisionPath]; }],
    ["forged hash", ({ sync }) => { sync.files[managedDecisionPath].hash = "0".repeat(16); }],
    ["relative source", ({ sync }) => { sync.files[managedDecisionPath].source = "Nous/Specs/fixture/decision.md"; }],
    ["dirty decision source", ({ provenance }) => { provenance.dirty = true; provenance.dirty_paths = ["Nous/Specs/fixture/ledger/v1/decisions/DECISION_MATRIX.md"]; }],
    ["wrong project", ({ project }) => { project.project_id = "other__project"; }],
    ["forged closed shape", ({ provenance }) => { provenance.forged = true; }],
    ["mode", () => {}], ["symlink", () => {}], ["missing identity", () => {}], ["unmanaged path", () => {}],
  ];
  for (const [name, mutate] of variants) {
    const { root } = makeGitRepo();
    const base = git(root, ["rev-parse", "HEAD"]);
    try {
      let paths = writeManagedDecisionDelivery(root, 1, { mutate });
      if (name === "unmanaged path") {
        const path = "docs/other/unmanaged.md", bytes = "# Unmanaged category\n";
        writeRepoFile(root, path, bytes); paths.push(path);
        const sync = JSON.parse(readFileSync(join(root, ".nous-sync.json"), "utf8"));
        sync.files[path] = { hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16), source: "generated" };
        writeRepoFile(root, ".nous-sync.json", JSON.stringify(sync) + "\n");
      }
      if (name === "mode") chmodSync(join(root, managedDecisionPath), 0o755);
      if (name === "symlink") { rmSync(join(root, managedDecisionPath)); symlinkSync("../../README.md", join(root, managedDecisionPath)); }
      if (name === "missing identity") { rmSync(join(root, ".nous-project.json")); paths = paths.filter(path => path !== ".nous-project.json"); }
      const head = commitRepo(root, `docs(CHG-103): hostile managed decision ${name}`, paths);
      assert.throws(() => validateRangeOwnership({ root, base, head }),
        error => error.code === "WR_GENERATED_NOUS_PATH" && error.path === managedDecisionStory, name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // Existing unchanged-claim replay guard must cover this additional category.
  const { root } = makeGitRepo();
  try {
    writeManagedDecisionDelivery(root, 1);
    writeRepoFile(root, managedDecisionPath, "# Parent bytes differ from stale decision claim\n");
    const base = commitRepo(root, "docs(CHG-103): retain stale parent claim fixture", [...decisionEnvelopePaths, managedDecisionStory, managedDecisionPath]);
    const paths = writeManagedDecisionDelivery(root, 1, {
      mutate: ({ provenance, project, sync }) => {
        provenance.git_sha = "44444444abcd"; project.substrate_commit = "44444444";
        // The story entry changes independently, so only the decision guard
        // can reject the unchanged decision hash/source replay.
        sync.files[managedDecisionStory].hash = createHash("sha256").update("# New canonical changes\n").digest("hex").slice(0, 16);
      },
    });
    writeRepoFile(root, managedDecisionStory, "# New canonical changes\n");
    const head = commitRepo(root, "docs(CHG-103): reject unchanged decision claim replay", paths);
    assert.throws(() => validateRangeOwnership({ root, base, head }),
      error => error.code === "WR_GENERATED_NOUS_PATH" && error.path === managedDecisionStory, "unchanged decision claim");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CHG-103 bounded Git reader accepts complete actual ledger above one MiB and refuses child output above two MiB", () => {
  const { root } = makeGitRepo();
  try {
    assert.ok(Buffer.byteLength(repositoryFeedback) > 1024 * 1024, "actual complete project ledger exceeds old ceiling");
    assert.ok(Buffer.byteLength(repositoryFeedback) < 2 * 1024 * 1024, "actual ledger fits the explicitly waived bound");
    const paths = [".nous-feedback.jsonl"];
    writeRepoFile(root, ".nous-feedback.jsonl", repositoryFeedback);
    for (const name of readdirSync(new URL("../docs/readiness/", import.meta.url))) {
      if (!name.endsWith(".json")) continue;
      const path = `docs/readiness/${name}`;
      writeRepoFile(root, path, readFileSync(new URL(`../${path}`, import.meta.url)));
      paths.push(path);
    }
    const base = commitRepo(root, "docs(CHG-103): retain complete immutable ledger fixture", paths);
    const annotation = { story: "CHG-103", event: "feedback", title: "Bounded reader contract", description: "Complete raw ledger retained", images: [], ts: "2026-10-17T01:00:00Z" };
    const candidate = repositoryFeedback + JSON.stringify(annotation) + "\n";
    writeRepoFile(root, ".nous-feedback.jsonl", candidate);
    installReadinessHook(root);
    const head = commitRepo(root, "docs(CHG-103): append valid evidence above old reader ceiling", [".nous-feedback.jsonl"]);
    assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
    const retained = spawnSync("git", ["show", `${head}:.nous-feedback.jsonl`], { cwd: root, encoding: "buffer", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(retained.status, 0); assert.equal(retained.stdout.equals(Buffer.from(candidate)), true);
    annotation.description = "";
    const emptyTail = JSON.stringify(annotation) + "\n";
    annotation.description = "x".repeat(2 * 1024 * 1024 + 128 - Buffer.byteLength(candidate + emptyTail));
    const oversized = candidate + JSON.stringify(annotation) + "\n";
    assert.equal(Buffer.byteLength(oversized), 2 * 1024 * 1024 + 128);
    writeRepoFile(root, ".nous-feedback.jsonl", oversized);
    git(root, ["add", ".nous-feedback.jsonl"]);
    const messagePath = writeGitMessage(root, "docs(CHG-103): oversized child output must fail closed\n");
    const rejected = runCli(root, ["check-staged", "--message-file", messagePath, "--json"]);
    assert.equal(rejected.status, 2, rejected.stdout + rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).errors[0].code, "WR_GIT_ERROR");
    assert.match(JSON.parse(rejected.stdout).errors[0].message, /Git output exceeds 2097152 bytes/u);
    assert.equal(git(root, ["rev-parse", "HEAD"]), head);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a full Nous manifest retains unrelated entries and authorizes a generated source with unrelated dirtiness", () => {
  const { root } = makeGitRepo();
  try {
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    const retainedFiles = {
      "docs/specs/unchanged.md": "# Unchanged specification\n",
      "docs/dev-guide/retained.md": "# Retained guidance\n",
    };
    const retainEntries = ({ project, sync }) => {
      for (const [path, bytes] of Object.entries(retainedFiles)) {
        sync.files[path] = { hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16), source: "generated" };
      }
      sync.files[".nous-project.json"] = {
        hash: createHash("sha256").update(`${JSON.stringify(project, null, 2)}\n`).digest("hex").slice(0, 16),
        source: "generated",
      };
    };
    for (const [path, bytes] of Object.entries(retainedFiles)) writeRepoFile(root, path, bytes);
    writeExactNousSyncEnvelope(root, generatedPath, "# Previous sprint plan\n", { mutate: retainEntries });
    const base = commitRepo(root, "docs(CHG-045): seed full manifest", [
      generatedPath, ...Object.keys(retainedFiles), ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);
    writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n", {
      provenance: { dirty: true, dirty_paths: ["Nous/System/IMP_SESSION_PLAYBOOK.md"] },
      project: { generated_at: "2026-09-05T21:41:53Z" },
      sync: { synced_at: "2026-09-05T21:41:53.665778+00:00" },
      mutate: retainEntries,
    });
    const head = commitRepo(root, "docs(CHG-045): sync full manifest with unrelated dirtiness", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);

    assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a generated document edited after an exact Nous sync fails closed", () => {
  const { root, base } = makeGitRepo();
  try {
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n");
    const synced = commitRepo(root, "docs(CHG-045): sync generated sprint", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);
    assert.equal(validateRangeOwnership({ root, base, head: synced }).classification, "bootstrap-documentation");

    writeRepoFile(root, generatedPath, "# Hand-edited sprint plan\n");
    const edited = commitRepo(root, "docs(CHG-045): edit generated sprint", [generatedPath]);

    assert.throws(
      () => validateRangeOwnership({ root, base: synced, head: edited }),
      (error) => error.code === "WR_GENERATED_NOUS_PATH"
        && error.path === generatedPath,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Nous sync cannot replay an unchanged parent entry by reformatting the envelope", () => {
  const { root } = makeGitRepo();
  try {
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    const generated = "# Manifest-bound sprint plan\n";
    writeExactNousSyncEnvelope(root, generatedPath, generated);
    writeRepoFile(root, generatedPath, "# Parent bytes differ from the stale manifest\n");
    const base = commitRepo(root, "docs(CHG-045): seed stale manifest", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);
    writeExactNousSyncEnvelope(root, generatedPath, generated, {
      project: { generated_at: "2026-09-05T21:41:53Z" },
      sync: { synced_at: "2026-09-05T21:41:53.665778+00:00" },
      mutate: ({ sync }) => {
        const { hash, source } = sync.files[generatedPath];
        sync.files[generatedPath] = { source, hash };
      },
    });
    const provenance = JSON.parse(readFileSync(join(root, ".nous-provenance.json"), "utf8"));
    writeRepoFile(root, ".nous-provenance.json", `${JSON.stringify(provenance)}\n`);
    const head = commitRepo(root, "docs(CHG-045): replay old entry with new envelope bytes", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);

    assert.throws(() => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_GENERATED_NOUS_PATH" && error.path === generatedPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a full Nous manifest cannot authorize an implementation path", () => {
  const { root } = makeGitRepo();
  try {
    const implementationPath = "apps/web/src/app/page.tsx";
    const generatedPath = "docs/specs/unchanged.md";
    writeExactNousSyncEnvelope(root, generatedPath, "# Retained specification\n");
    const base = commitRepo(root, "docs(CHG-045): seed retained specification", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);
    const retained = JSON.parse(readFileSync(join(root, ".nous-sync.json"), "utf8")).files;
    writeExactNousSyncEnvelope(root, implementationPath, "export {};\n", {
      provenance: { git_sha: "123456789abc" },
      project: { substrate_commit: "12345678" },
      mutate: ({ project, sync }) => {
        Object.assign(sync.files, retained);
        sync.files[".nous-project.json"] = {
          hash: createHash("sha256").update(`${JSON.stringify(project, null, 2)}\n`).digest("hex").slice(0, 16),
          source: "generated",
        };
      },
    });
    const head = commitRepo(root, "feat(CHG-045): forge implementation manifest entry", [
      implementationPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);

    assert.throws(() => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_READINESS_MISSING" && error.path === "docs/readiness/CHG-045.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("forged Nous sync provenance cannot authorize generated documentation", () => {
  const generatedPath = "docs/stories/SPRINT_PLAN.md";
  const sourcePath = "/fixture/Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
  const forgeries = [
    ["provenance-to-project mismatch", ({ project }) => { project.project_id = "other__project"; }],
    ["provenance-to-sync mismatch", ({ sync }) => { sync.project_id = "other__project"; }],
    ["array checksum", ({ project }) => { project.checksum = ["82f3e0de92a5834b"]; }],
    ["revision mismatch", ({ project }) => { project.substrate_commit = "00000000"; }],
    ["stale blob hash", ({ sync }) => { sync.files[generatedPath].hash = "0".repeat(16); }],
    ["affected dirty source", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = ["Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md"];
      sync.files[generatedPath].source = sourcePath;
    }],
    ["extra provenance field", ({ provenance }) => { provenance.forged = true; }],
  ];

  for (const [name, mutate] of forgeries) {
    const { root, base } = makeGitRepo();
    try {
      writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n", { mutate });
      const head = commitRepo(root, `docs(CHG-045): reject ${name}`, [
        generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
      ]);

      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_GENERATED_NOUS_PATH"
          && error.path === generatedPath,
        name,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an unrelated declared dirty substrate path does not invalidate a Nous sync", () => {
  const { root, base } = makeGitRepo();
  try {
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n", {
      mutate: ({ provenance, sync }) => {
        provenance.dirty = true;
        provenance.dirty_paths = ["Nous/System/IMP_SESSION_PLAYBOOK.md"];
        sync.files[generatedPath].source = "/fixture/Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
      },
    });
    const head = commitRepo(root, "docs(CHG-045): sync with unrelated substrate dirtiness", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);

    assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed or ambiguous dirty-source metadata fails closed", () => {
  const generatedPath = "docs/stories/SPRINT_PLAN.md";
  const sourcePath = "/fixture/Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
  const unrelatedPath = "Nous/System/IMP_SESSION_PLAYBOOK.md";
  const cases = [
    ["dirty flag without paths", ({ provenance, sync }) => {
      provenance.dirty = true;
      sync.files[generatedPath].source = sourcePath;
    }],
    ["dirty paths without dirty flag", ({ provenance, sync }) => {
      provenance.dirty_paths = [unrelatedPath];
      sync.files[generatedPath].source = sourcePath;
    }],
    ["duplicate dirty path", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = [unrelatedPath, unrelatedPath];
      sync.files[generatedPath].source = sourcePath;
    }],
    ["non-Nous dirty path", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = ["Specs/fixture/ledger/v1/stories/OTHER.md"];
      sync.files[generatedPath].source = sourcePath;
    }],
    ["noncanonical dirty path", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = ["Nous/Specs/fixture/../ledger/v1/stories/OTHER.md"];
      sync.files[generatedPath].source = sourcePath;
    }],
    ["relative source", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = [unrelatedPath];
      sync.files[generatedPath].source = "Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
    }],
    ["ambiguous Nous source", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = [unrelatedPath];
      sync.files[generatedPath].source = "/fixture/Nous/cache/Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
    }],
    ["unbounded dirty paths", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = Array.from(
        { length: 1025 },
        (_, index) => `Nous/System/unrelated-${String(index)}.md`,
      );
      sync.files[generatedPath].source = sourcePath;
    }],
    ["extra manifest-entry field", ({ sync }) => {
      sync.files[generatedPath].forged = true;
    }],
  ];

  for (const [name, mutate] of cases) {
    const { root, base } = makeGitRepo();
    try {
      writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n", { mutate });
      const head = commitRepo(root, `docs(CHG-045): reject ${name}`, [
        generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
      ]);

      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_GENERATED_NOUS_PATH"
          && error.path === generatedPath,
        name,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an exact Nous sync envelope requires an eight-hex substrate revision", () => {
  for (const substrateCommit of ["d246c6f", "d246c6ff1", "d246c6ff15d4"]) {
    const { root, base } = makeGitRepo();
    try {
      const generatedPath = "docs/stories/SPRINT_PLAN.md";
      writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n", {
        project: { substrate_commit: substrateCommit },
      });
      const head = commitRepo(root, "docs(CHG-045): malformed substrate revision", [
        generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
      ]);

      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_GENERATED_NOUS_PATH",
        substrateCommit,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an exact Nous sync envelope requires strict valid UTC timestamps", () => {
  const variants = [
    { project: { generated_at: "2026-09-05T21:40:53" } },
    { project: { generated_at: "2026-09-05T16:40:53-05:00" } },
    { project: { generated_at: "2026-02-30T21:40:53Z" }, sync: { synced_at: "2026-02-30T21:40:53.000000+00:00" } },
    { sync: { synced_at: "2026-09-05T21:40:53.665778" } },
    { sync: { synced_at: "2026-09-05T16:40:53.665778-05:00" } },
    { sync: { synced_at: "2026-09-05T21:40:53.1234567890+00:00" } },
  ];
  for (const envelopeOverrides of variants) {
    const { root, base } = makeGitRepo();
    try {
      const generatedPath = "docs/stories/SPRINT_PLAN.md";
      writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n", envelopeOverrides);
      const head = commitRepo(root, "docs(CHG-045): malformed sync timestamp", [
        generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
      ]);

      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_GENERATED_NOUS_PATH",
        JSON.stringify(envelopeOverrides),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function parentNamedOverlayCommit(message, layerToken = "6466f60") {
  const { root } = makeGitRepo();
  const parent = partitioned();
  parent.work_id = "CHG-049";
  parent.source = "docs/changes/CHG-049.md";
  parent.approval.evidence = "CHG049-PARTITION";
  parent.partitions[0].work_id = "CHG-051";
  refreshDigest(parent);
  const parentDecision = decisionFor(parent, {
    text: `${decisionFor(parent).text} Approved official child: CHG-051.`,
  });
  const child = approvedArtifact("CHG-051");
  writeRepoFile(root, "docs/readiness/CHG-049.json", `${JSON.stringify(parent, null, 2)}\n`);
  writeRepoFile(root, "docs/readiness/CHG-051.json", `${JSON.stringify(child, null, 2)}\n`);
  writeRepoFile(
    root,
    ".nous-feedback.jsonl",
    `${JSON.stringify(parentDecision)}\n${JSON.stringify(decisionFor(child))}\n`,
  );
  const base = commitRepo(root, "docs(CHG-049 CHG-051): approve overlay child", [
    "docs/readiness/CHG-049.json",
    "docs/readiness/CHG-051.json",
    ".nous-feedback.jsonl",
  ]);
  writeRepoFile(root, "src/implementation.ts", "export const implemented = true;\n");
  writeRepoFile(
    root,
    `infra/scripts/overrides/CHG-049/${layerToken}/manifest.json`,
    "{}\n",
  );
  const head = commitRepo(root, message, [
    "src/implementation.ts",
    `infra/scripts/overrides/CHG-049/${layerToken}/manifest.json`,
  ]);
  return { root, base, head };
}

test("parent-named overlay storage belongs to the executable child owner", () => {
  const { root, base, head } = parentNamedOverlayCommit(
    "fix(CHG-051): register the guidance overlay",
  );
  try {
    assert.deepEqual(
      validateRangeOwnership({ root, base, head }).workIds,
      ["CHG-051"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parent-named overlay storage cannot supply an owner to an ownerless commit", () => {
  const { root, base, head } = parentNamedOverlayCommit(
    "fix: register the guidance overlay",
  );
  try {
    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_WORK_ID_MISSING",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nonconforming parent-named overlay storage remains ordinary path ownership", () => {
  for (const layerToken of ["6466f6", "ABC1234"]) {
    const { root, base, head } = parentNamedOverlayCommit(
      "fix(CHG-051): register the guidance overlay",
      layerToken,
    );
    try {
      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_WORK_NOT_READY"
          && error.path === "docs/readiness/CHG-049.json",
        layerToken,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("ownership is the union of commit-message and changed-path work IDs", () => {
  for (const pathWorkReady of [false, true]) {
    const { root } = makeGitRepo();
    try {
      const decisions = [writeApprovedWork(root, "US-321")];
      const paths = ["docs/readiness/US-321.json"];
      if (pathWorkReady) {
        decisions.push(writeApprovedWork(root, "CHG-456"));
        paths.push("docs/readiness/CHG-456.json");
      }
      writeRepoFile(root, ".nous-feedback.jsonl", `${decisions.map(JSON.stringify).join("\n")}\n`);
      paths.push(".nous-feedback.jsonl");
      const base = commitRepo(root, "docs(US-321): approve ownership fixtures", paths);
      writeRepoFile(root, "artifacts/CHG-456/result.txt", "implementation\n");
      const head = commitRepo(root, "feat(US-321): implement approved message scope", ["artifacts/CHG-456/result.txt"]);
      if (pathWorkReady) {
        assert.deepEqual(validateRangeOwnership({ root, base, head }).workIds, ["US-321", "CHG-456"]);
      } else {
        assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING" && error.path === "docs/readiness/CHG-456.json");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an arbitrary unregistered overlay manifest cannot authorize generated Nous changes", () => {
  const { root, base } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "CHG-456");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    writeRepoFile(root, "docs/stories/SPRINT_PLAN.md", "generated mutation\n");
    let head = commitRepo(root, "docs(CHG-456): mutate generated sprint", ["docs/readiness/CHG-456.json", ".nous-feedback.jsonl", "docs/stories/SPRINT_PLAN.md"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_GENERATED_NOUS_PATH");

    const generated = "generated mutation\n";
    const desired = createHash("sha256").update(generated, "utf8").digest("hex");
    writeRepoFile(root, "infra/scripts/overrides/CHG-456/abc1234/docs/stories/SPRINT_PLAN.md", generated);
    writeRepoFile(root, "infra/scripts/overrides/CHG-456/abc1234/manifest.json", `${JSON.stringify({
      version: 1,
      paths: { "docs/stories/SPRINT_PLAN.md": {
        source_path: "overrides/CHG-001/base/docs/stories/SPRINT_PLAN.md",
        source_sha256: "a".repeat(64),
        desired_sha256: desired,
      } },
    })}\n`);
    head = commitRepo(root, "docs(CHG-456): own exact generated sprint overlay", [
      "infra/scripts/overrides/CHG-456/abc1234/manifest.json",
      "infra/scripts/overrides/CHG-456/abc1234/docs/stories/SPRINT_PLAN.md",
    ]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_GENERATED_NOUS_PATH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreviewed tautological loader cannot own a generated path", () => {
  const { root } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "CHG-456");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    const sourcePath = "overrides/CHG-001/base/docs/stories/SPRINT_PLAN.md";
    const sourceRepoPath = `infra/scripts/${sourcePath}`;
    const desiredPath = "infra/scripts/overrides/CHG-456/abc1234/docs/stories/SPRINT_PLAN.md";
    const source = "generated source\n";
    const desired = "registered desired\n";
    writeRepoFile(root, sourceRepoPath, source);
    writeRepoFile(root, desiredPath, desired);
    writeRepoFile(root, "docs/stories/SPRINT_PLAN.md", source);
    writeRepoFile(root, "infra/scripts/overrides/CHG-456/abc1234/manifest.json", `${JSON.stringify({
      version: 1,
      paths: { "docs/stories/SPRINT_PLAN.md": {
        source_path: sourcePath,
        source_sha256: createHash("sha256").update(source).digest("hex"),
        desired_sha256: createHash("sha256").update(desired).digest("hex"),
      } },
    })}\n`);
    writeRepoFile(root, "infra/scripts/reconcile-sprint1-docs.py", [
      "CHG456_PATHS = {",
      '    "docs/stories/SPRINT_PLAN.md": (',
      `        "${sourcePath}"`,
      "    ),",
      "}",
      "LAYERED_OVERRIDE_SPECS = (",
      '    ("CHG-456/abc1234", CHG456_PATHS),',
      ")",
      "def load_layered_overrides():",
      "    layers = []",
      "    for layer_name, expected_paths in LAYERED_OVERRIDE_SPECS:",
      "        pinned = {}",
      '        override_root = data_root / "overrides" / layer_name',
      '        source_path = expected_paths["docs/stories/SPRINT_PLAN.md"]',
      '        if source_path != expected_paths["docs/stories/SPRINT_PLAN.md"]:',
      '            raise ValueError("source")',
      "        pinned[source_path] = override_root",
      "        layers.append((layer_name, pinned))",
      "    return layers",
      "",
    ].join("\n"));
    const setupPaths = [
      "docs/readiness/CHG-456.json", ".nous-feedback.jsonl", sourceRepoPath, desiredPath,
      "docs/stories/SPRINT_PLAN.md", "infra/scripts/overrides/CHG-456/abc1234/manifest.json",
      "infra/scripts/reconcile-sprint1-docs.py",
    ];
    const base = commitRepo(root, "docs(CHG-456): register canonical generated overlay", setupPaths);
    writeRepoFile(root, "docs/stories/SPRINT_PLAN.md", desired);
    const head = commitRepo(root, "docs(CHG-456): apply registered generated overlay", ["docs/stories/SPRINT_PLAN.md"]);
    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_GENERATED_NOUS_PATH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the committed ordered CHG-004 and CHG-022 layers authorize the real CHG-004 transition", () => {
  const { root } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "CHG-004");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    const fixturePaths = [
      "infra/scripts/reconcile-sprint1-docs.py",
      "infra/scripts/overrides/CHG-001/825e882/docs/stories/CHANGES.md",
      "infra/scripts/overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md",
      "infra/scripts/overrides/CHG-004/e4b9a06/testing/critical-paths.md",
      "infra/scripts/overrides/CHG-004/e4b9a06/manifest.json",
      "infra/scripts/overrides/CHG-022/16f72c9/AGENTS.md",
      "infra/scripts/overrides/CHG-022/16f72c9/CLAUDE.md",
      "infra/scripts/overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md",
      "infra/scripts/overrides/CHG-022/16f72c9/manifest.json",
    ];
    for (const path of fixturePaths) {
      writeRepoFile(root, path, readFileSync(new URL(`../${path}`, import.meta.url)));
    }
    const generatedPath = "docs/stories/CHANGES.md";
    const sourcePath = "infra/scripts/overrides/CHG-001/825e882/docs/stories/CHANGES.md";
    const desiredPath = "infra/scripts/overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md";
    writeRepoFile(root, generatedPath, readFileSync(new URL(`../${sourcePath}`, import.meta.url)));
    const base = commitRepo(root, "docs(CHG-004): register real ordered overlay fixture", [
      "docs/readiness/CHG-004.json", ".nous-feedback.jsonl", generatedPath, ...fixturePaths,
    ]);
    writeRepoFile(root, generatedPath, readFileSync(new URL(`../${desiredPath}`, import.meta.url)));
    const head = commitRepo(root, "docs(CHG-004): apply real ordered overlay fixture", [generatedPath]);

    assert.equal(validateRangeOwnership({ root, base, head }).classification, "implementation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the reviewed overlay specs reject an altered manifest hash helper implementation", () => {
  const { root } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "CHG-004");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    const fixturePaths = [
      "infra/scripts/overrides/CHG-001/825e882/docs/stories/CHANGES.md",
      "infra/scripts/overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md",
      "infra/scripts/overrides/CHG-004/e4b9a06/testing/critical-paths.md",
      "infra/scripts/overrides/CHG-004/e4b9a06/manifest.json",
      "infra/scripts/overrides/CHG-022/16f72c9/AGENTS.md",
      "infra/scripts/overrides/CHG-022/16f72c9/CLAUDE.md",
      "infra/scripts/overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md",
      "infra/scripts/overrides/CHG-022/16f72c9/manifest.json",
    ];
    for (const path of fixturePaths) {
      writeRepoFile(root, path, readFileSync(new URL(`../${path}`, import.meta.url)));
    }
    const reconcilerPath = "infra/scripts/reconcile-sprint1-docs.py";
    const reviewed = readFileSync(new URL(`../${reconcilerPath}`, import.meta.url), "utf8");
    const altered = reviewed.replace(
      "return hashlib.sha256(content).hexdigest()",
      'return "0" * 64',
    );
    assert.notEqual(altered, reviewed);
    writeRepoFile(root, reconcilerPath, altered);
    const generatedPath = "docs/stories/CHANGES.md";
    const sourcePath = "infra/scripts/overrides/CHG-001/825e882/docs/stories/CHANGES.md";
    const desiredPath = "infra/scripts/overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md";
    writeRepoFile(root, generatedPath, readFileSync(new URL(`../${sourcePath}`, import.meta.url)));
    const base = commitRepo(root, "docs(CHG-004): register altered helper fixture", [
      "docs/readiness/CHG-004.json", ".nous-feedback.jsonl", reconcilerPath,
      generatedPath, ...fixturePaths,
    ]);
    writeRepoFile(root, generatedPath, readFileSync(new URL(`../${desiredPath}`, import.meta.url)));
    const head = commitRepo(root, "docs(CHG-004): apply altered helper fixture", [generatedPath]);

    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_GENERATED_NOUS_PATH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the reviewed reconciler binding rejects late rebinding and ignored-layer runtime changes", () => {
  const mutations = [
    ["whitespace-only", (source) => source.replace(
      "#!/usr/bin/env python3\n",
      "#!/usr/bin/env python3\n\n",
    )],
    ["late-rebind", (source) => `${source}\nload_layered_overrides = lambda: []\n`],
    ["ignore-layers", (source) => source.replace(
      "layers = load_layered_overrides()",
      "layers = ()  # maliciously ignore registered overlays",
    )],
  ];
  for (const [variant, mutate] of mutations) {
    const { root } = makeGitRepo();
    try {
      const decision = writeApprovedWork(root, "CHG-004");
      writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
      const fixturePaths = [
        "infra/scripts/overrides/CHG-001/825e882/docs/stories/CHANGES.md",
        "infra/scripts/overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md",
        "infra/scripts/overrides/CHG-004/e4b9a06/testing/critical-paths.md",
        "infra/scripts/overrides/CHG-004/e4b9a06/manifest.json",
        "infra/scripts/overrides/CHG-022/16f72c9/AGENTS.md",
        "infra/scripts/overrides/CHG-022/16f72c9/CLAUDE.md",
        "infra/scripts/overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md",
        "infra/scripts/overrides/CHG-022/16f72c9/manifest.json",
      ];
      for (const path of fixturePaths) {
        writeRepoFile(root, path, readFileSync(new URL(`../${path}`, import.meta.url)));
      }
      const reconcilerPath = "infra/scripts/reconcile-sprint1-docs.py";
      const reviewed = readFileSync(new URL(`../${reconcilerPath}`, import.meta.url), "utf8");
      const altered = mutate(reviewed);
      assert.notEqual(altered, reviewed, variant);
      writeRepoFile(root, reconcilerPath, altered);
      const generatedPath = "docs/stories/CHANGES.md";
      const sourcePath = "infra/scripts/overrides/CHG-001/825e882/docs/stories/CHANGES.md";
      const desiredPath = "infra/scripts/overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md";
      writeRepoFile(root, generatedPath, readFileSync(new URL(`../${sourcePath}`, import.meta.url)));
      const base = commitRepo(root, `docs(CHG-004): register ${variant} fixture`, [
        "docs/readiness/CHG-004.json", ".nous-feedback.jsonl", reconcilerPath,
        generatedPath, ...fixturePaths,
      ]);
      writeRepoFile(root, generatedPath, readFileSync(new URL(`../${desiredPath}`, import.meta.url)));
      const head = commitRepo(root, `docs(CHG-004): apply ${variant} fixture`, [generatedPath]);

      assert.throws(
        () => validateRangeOwnership({ root, base, head }),
        (error) => error.code === "WR_GENERATED_NOUS_PATH",
        variant,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a literal overlay tuple that is never applied cannot own generated Nous output", () => {
  const { root } = makeGitRepo();
  try {
    const decision = writeApprovedWork(root, "CHG-456");
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    const sourcePath = "overrides/CHG-001/base/docs/stories/SPRINT_PLAN.md";
    const sourceRepoPath = `infra/scripts/${sourcePath}`;
    const desiredPath = "infra/scripts/overrides/CHG-456/abc1234/docs/stories/SPRINT_PLAN.md";
    const source = "source\n";
    const desired = "desired\n";
    writeRepoFile(root, sourceRepoPath, source);
    writeRepoFile(root, desiredPath, desired);
    writeRepoFile(root, generatedPath, source);
    writeRepoFile(root, "infra/scripts/overrides/CHG-456/abc1234/manifest.json", `${JSON.stringify({
      version: 1,
      paths: { [generatedPath]: {
        source_path: sourcePath,
        source_sha256: createHash("sha256").update(source).digest("hex"),
        desired_sha256: createHash("sha256").update(desired).digest("hex"),
      } },
    })}\n`);
    writeRepoFile(root, "infra/scripts/reconcile-sprint1-docs.py", [
      `CHG456_PATHS = {"${generatedPath}": "${sourcePath}"}`,
      'LAYERED_OVERRIDE_SPECS = (("CHG-456/abc1234", CHG456_PATHS),)',
      "for layer, paths in LAYERED_OVERRIDE_SPECS:",
      "    audit_only(layer, paths)",
      "",
    ].join("\n"));
    const base = commitRepo(root, "docs(CHG-456): register unapplied tuple", [
      "docs/readiness/CHG-456.json", ".nous-feedback.jsonl", sourceRepoPath,
      desiredPath, generatedPath, "infra/scripts/overrides/CHG-456/abc1234/manifest.json",
      "infra/scripts/reconcile-sprint1-docs.py",
    ]);
    writeRepoFile(root, generatedPath, desired);
    const head = commitRepo(root, "docs(CHG-456): attempt unapplied overlay", [generatedPath]);

    assert.throws(
      () => validateRangeOwnership({ root, base, head }),
      (error) => error.code === "WR_GENERATED_NOUS_PATH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registered overlays fail closed on missing paths, hashes, registration, and unknown base state", () => {
  const variants = ["missing-source-path", "source-hash", "desired-hash", "unregistered-layer", "base-state"];
  for (const variant of variants) {
    const { root } = makeGitRepo();
    try {
      const decision = writeApprovedWork(root, "CHG-456");
      writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(decision)}\n`);
      const sourcePath = "overrides/CHG-001/base/docs/stories/SPRINT_PLAN.md";
      const sourceRepoPath = `infra/scripts/${sourcePath}`;
      const desiredPath = "infra/scripts/overrides/CHG-456/abc1234/docs/stories/SPRINT_PLAN.md";
      writeRepoFile(root, sourceRepoPath, "source\n");
      writeRepoFile(root, desiredPath, "desired\n");
      writeRepoFile(root, "docs/stories/SPRINT_PLAN.md", variant === "base-state" ? "tampered unknown base\n" : "source\n");
      const metadata = {
        source_path: sourcePath,
        source_sha256: createHash("sha256").update("source\n").digest("hex"),
        desired_sha256: createHash("sha256").update("desired\n").digest("hex"),
      };
      if (variant === "missing-source-path") delete metadata.source_path;
      if (variant === "source-hash") metadata.source_sha256 = "0".repeat(64);
      if (variant === "desired-hash") metadata.desired_sha256 = "0".repeat(64);
      writeRepoFile(root, "infra/scripts/overrides/CHG-456/abc1234/manifest.json", `${JSON.stringify({
        version: 1,
        paths: { "docs/stories/SPRINT_PLAN.md": metadata },
      })}\n`);
      const registeredLayer = variant === "unregistered-layer" ? "CHG-456/different" : "CHG-456/abc1234";
      writeRepoFile(root, "infra/scripts/reconcile-sprint1-docs.py", [
        "CHG456_PATHS = {",
        '    "docs/stories/SPRINT_PLAN.md": (',
        `        "${sourcePath}"`,
        "    ),",
        "}",
        "LAYERED_OVERRIDE_SPECS = (",
        `    ("${registeredLayer}", CHG456_PATHS),`,
        ")",
        "def load_layered_overrides():",
        "    layers = []",
        "    for layer, paths in LAYERED_OVERRIDE_SPECS:",
        "        pinned = {}",
        '        override_root = data_root / "overrides" / layer',
        '        source_path = paths["docs/stories/SPRINT_PLAN.md"]',
        '        if source_path != paths["docs/stories/SPRINT_PLAN.md"]:',
        '            raise ValueError("source")',
        "        pinned[source_path] = override_root",
        "        layers.append((layer, pinned))",
        "    return layers",
        "",
      ].join("\n"));
      const base = commitRepo(root, "docs(CHG-456): register invalid overlay fixture", [
        "docs/readiness/CHG-456.json", ".nous-feedback.jsonl", sourceRepoPath, desiredPath,
        "docs/stories/SPRINT_PLAN.md", "infra/scripts/overrides/CHG-456/abc1234/manifest.json",
        "infra/scripts/reconcile-sprint1-docs.py",
      ]);
      writeRepoFile(root, "docs/stories/SPRINT_PLAN.md", "desired\n");
      const head = commitRepo(root, "docs(CHG-456): apply invalid overlay", ["docs/stories/SPRINT_PLAN.md"]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_GENERATED_NOUS_PATH");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("postactivation implementation never reuses a preactivation completed ID", () => {
  for (const beforeActivation of [true, false]) {
    const { root } = makeGitRepo();
    try {
      const lifecycle = [
        { story: "US-321", event: "started", agent: "historical-agent" },
        { story: "US-321", event: "build_pass", notes: "historical build passed" },
        { story: "US-321", event: "done", source_commit: "a".repeat(40) },
      ];
      const records = beforeActivation ? lifecycle : [];
      const base = commitActivationHistory(root, records);
      if (!beforeActivation) {
        const activationHistory = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
        writeRepoFile(root, ".nous-feedback.jsonl", `${activationHistory}${lifecycle.map(JSON.stringify).join("\n")}\n`);
        commitRepo(root, "docs(US-321): append late terminal", [".nous-feedback.jsonl"]);
      }
      writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
      const head = commitRepo(root, "feat(US-321): historical repair", ["apps/web/src/app/page.tsx"]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("grandfathering rejects missing lifecycle evidence, malformed done, and duplicate activation", () => {
  const invalidHistories = [
    [[{ story: "US-321", event: "build_pass", notes: "missing start" }, { story: "US-321", event: "done" }], "WR_FEEDBACK_ORDER"],
    [[{ story: "US-321", event: "started", agent: "agent" }, { story: "US-321", event: "done" }], "WR_FEEDBACK_ORDER"],
    [[
      { story: "US-321", event: "started", agent: "agent" },
      { story: "US-321", event: "build_pass", notes: "ok" },
      { story: "US-321", event: "done", source_commit: "not-a-commit" },
    ], "WR_READINESS_MISSING"],
  ];
  for (const [records, expectedCode] of invalidHistories) {
    const { root } = makeGitRepo();
    try {
      const base = commitActivationHistory(root, records);
      writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
      const head = commitRepo(root, "feat(US-321): invalid historical exemption", ["apps/web/src/app/page.tsx"]);
      assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === expectedCode);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const { root } = makeGitRepo();
  try {
    const lifecycle = [
      { story: "US-321", event: "started", agent: "agent" },
      { story: "US-321", event: "build_pass", notes: "ok" },
      { story: "US-321", event: "done" },
      { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" },
      bootstrapDecision,
      { ...bootstrapDecision },
    ];
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${lifecycle.map(JSON.stringify).join("\n")}\n`);
    const base = commitRepo(root, "docs(CHG-022): duplicate activation fixture", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): duplicate activation exemption", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grandfathering rejects a forged activation that does not bind the committed digest", () => {
  const { root } = makeGitRepo();
  try {
    const records = [
      { story: "US-321", event: "started", agent: "agent" },
      { story: "US-321", event: "build_pass", notes: "ok" },
      { story: "US-321", event: "done" },
      { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" },
      { ...bootstrapDecision, text: `Decision ready for readiness payload SHA-256 ${"0".repeat(64)}.` },
    ];
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${records.map(JSON.stringify).join("\n")}\n`);
    const base = commitRepo(root, "docs(CHG-022): forged activation fixture", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): forged activation exemption", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("postactivation implementation rejects even a canonical projected historical terminal", () => {
  const { root } = makeGitRepo();
  try {
    const records = [
      { story: "US-321", event: "started", agent: "agent" },
      { story: "US-321", event: "build_pass", notes: "historical build" },
      { story: "US-321", event: "done" },
      { story: "CHG-099", event: "started", agent: "repair-agent" },
      { story: "CHG-099", event: "decision", id: "CHG099-REPAIR", text: "Repair terminal evidence", reason: "review" },
      {
        story: "US-321", event: "evidence_superseded", ref: "US321-DONE-1",
        target: { story: "US-321", event: "done" }, reason: "revalidate historical terminal",
      },
      { story: "US-321", event: "revalidated", ref: "US321-DONE-1", change: "CHG-099", as_event: "done" },
    ];
    const base = commitActivationHistory(root, records);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): projected historical exemption", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grandfather projection rejects noncanonical terminal lineage records", () => {
  const canonical = [
    { story: "US-321", event: "started", agent: "agent" },
    { story: "US-321", event: "build_pass", notes: "historical build" },
    { story: "US-321", event: "done" },
    { story: "CHG-099", event: "decision", id: "CHG099-REPAIR", text: "Repair", reason: "review" },
    {
      story: "US-321", event: "evidence_superseded", ref: "US321-DONE-1",
      target: { story: "US-321", event: "done" }, reason: "revalidate",
    },
    { story: "US-321", event: "revalidated", ref: "US321-DONE-1", change: "CHG-099", as_event: "done" },
  ];
  const variants = [];
  const lateDecision = clone(canonical);
  const decision = lateDecision.splice(3, 1)[0];
  lateDecision.splice(4, 0, decision);
  assert.deepEqual(historicalOwnership(lateDecision).grandfatheredWorkIds, ["US-321"]);
  const secondGeneration = clone(canonical);
  secondGeneration.push(
    { story: "CHG-100", event: "decision", id: "CHG100-REPAIR", text: "Repair again", reason: "review" },
    { story: "US-321", event: "evidence_superseded", ref: "US321-DONE-2", target: { ref: "US321-DONE-1" }, reason: "revalidate again" },
    { story: "US-321", event: "revalidated", ref: "US321-DONE-2", change: "CHG-100", as_event: "done" },
  );
  assert.deepEqual(historicalOwnership(secondGeneration).grandfatheredWorkIds, ["US-321"]);
  const extraTerminal = clone(canonical);
  extraTerminal.at(-1).notes = "not canonical for terminal projection";
  variants.push(extraTerminal);
  const missingChange = clone(canonical);
  delete missingChange.at(-1).change;
  variants.push(missingChange);
  const wrongKind = clone(canonical);
  wrongKind.at(-1).as_event = "build_pass";
  wrongKind.at(-1).notes = "wrong kind";
  variants.push(wrongKind);
  const duplicateReplacement = clone(canonical);
  duplicateReplacement.push({ ...duplicateReplacement.at(-1) });
  variants.push(duplicateReplacement);
  const orphanReplacement = clone(canonical);
  orphanReplacement.push({ story: "US-321", event: "revalidated", ref: "ORPHAN", change: "CHG-099", as_event: "done" });
  variants.push(orphanReplacement);
  const duplicateRef = clone(canonical);
  duplicateRef.splice(-1, 0, { ...duplicateRef.at(-2) });
  variants.push(duplicateRef);
  const duplicateTarget = clone(canonical);
  duplicateTarget.push(
    { story: "US-321", event: "evidence_superseded", ref: "US321-DONE-2", target: { story: "US-321", event: "done" }, reason: "duplicate target" },
    { story: "US-321", event: "revalidated", ref: "US321-DONE-2", change: "CHG-099", as_event: "done" },
  );
  variants.push(duplicateTarget);
  const malformedDecision = clone(canonical);
  delete malformedDecision[3].reason;
  variants.push(malformedDecision);
  for (const records of variants) {
    assert.throws(
      () => historicalOwnership(records),
      (error) => ["WR_READINESS_MISSING", "WR_FEEDBACK_INVALID"].includes(error.code),
    );
  }
});

test("grandfather projection enforces exact build replacement shape", () => {
  const canonical = [
    { story: "US-321", event: "started", agent: "agent" },
    { story: "US-321", event: "build_pass", notes: "old build" },
    { story: "CHG-099", event: "decision", id: "CHG099-BUILD", text: "Repair build", reason: "review" },
    { story: "US-321", event: "evidence_superseded", ref: "US321-BUILD-1", target: { story: "US-321", event: "build_pass" }, reason: "revalidate" },
    { story: "US-321", event: "revalidated", ref: "US321-BUILD-1", change: "CHG-099", as_event: "build_pass", notes: "new build" },
    { story: "US-321", event: "done" },
  ];
  assert.deepEqual(historicalOwnership(canonical).grandfatheredWorkIds, ["US-321"]);
  const extra = clone(canonical);
  extra[4].pass = true;
  assert.throws(() => historicalOwnership(extra), (error) => error.code === "WR_READINESS_MISSING");
  const missing = clone(canonical);
  delete missing[4].notes;
  assert.throws(() => historicalOwnership(missing), (error) => error.code === "WR_READINESS_MISSING");
});

test("grandfather projection enforces exact AC replacement shape", () => {
  const canonical = [
    { story: "US-321", event: "started", agent: "agent" },
    { story: "US-321", event: "ac_verify", ac: 1, method: "old", pass: true, notes: "old AC" },
    { story: "CHG-099", event: "decision", id: "CHG099-AC", text: "Repair AC", reason: "review" },
    { story: "US-321", event: "evidence_superseded", ref: "US321-AC-1", target: { story: "US-321", event: "ac_verify", ac: 1 }, reason: "revalidate" },
    { story: "US-321", event: "revalidated", ref: "US321-AC-1", change: "CHG-099", as_event: "ac_verify", ac: 1, method: "new", pass: true, notes: "new AC" },
    { story: "US-321", event: "build_pass", notes: "build" },
    { story: "US-321", event: "done" },
  ];
  assert.deepEqual(historicalOwnership(canonical).grandfatheredWorkIds, ["US-321"]);
  const extra = clone(canonical);
  extra[4].source_commit = "a".repeat(40);
  assert.throws(() => historicalOwnership(extra), (error) => error.code === "WR_READINESS_MISSING");
  const missing = clone(canonical);
  delete missing[4].method;
  assert.throws(() => historicalOwnership(missing), (error) => error.code === "WR_READINESS_MISSING");
});

test("grandfathering rejects the repository's noncanonical extra-field US-023 terminal projection", () => {
  const { root } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", repositoryFeedback);
    const base = commitRepo(root, "docs(CHG-022): install committed activation history", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "fix(US-023): historical maintenance", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a range cannot manufacture grandfathering by inserting history before activation", () => {
  const { root } = makeGitRepo();
  try {
    const activation = { story: "CHG-022", event: "decision", id: "CHG022-READINESS-V2-APPROVAL", text: "activation", reason: "policy" };
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(activation)}\n`);
    const base = commitRepo(root, "docs(CHG-022): activate policy", [".nous-feedback.jsonl"]);
    const forgedDone = { story: "US-321", event: "done", source_commit: "a".repeat(40) };
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(forgedDone)}\n${JSON.stringify(activation)}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): forge historical completion", [".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_FEEDBACK_HISTORY_MUTATED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changed readiness content cannot replay an older digest", () => {
  const { root, base } = makeGitRepo();
  try {
    const oldDecision = writeApprovedWork(root, "US-321", { mutateAfterApproval: true });
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(oldDecision)}\n`);
    commitRepo(root, "docs(US-321): persist stale approval fixture", ["docs/readiness/US-321.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): replay old approval", ["apps/web/src/app/page.tsx"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_APPROVAL_DECISION_MISMATCH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CHG-022 bootstrap cannot authorize implementation after its first done", () => {
  const { root, base } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(completedBootstrap(), null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${[
      { story: "CHG-022", event: "started", agent: "codex/work-readiness-gate" },
      bootstrapDecision,
      bootstrapCheckpointDeviation(180),
      { story: "CHG-022", event: "build_pass", notes: "bootstrap build" },
      { story: "CHG-022", event: "done" },
    ].map(JSON.stringify).join("\n")}\n`);
    commitRepo(root, "docs(CHG-022): record expired bootstrap fixture", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "scripts/work-readiness/git.mjs", "export {};\n");
    const head = commitRepo(root, "feat(CHG-022): replay bootstrap", ["scripts/work-readiness/git.mjs"]);
    assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_BOOTSTRAP_EXPIRED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CHG-022 bootstrap authorizes only its exact manifest paths before done", () => {
  const { root, base } = makeGitRepo();
  try {
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${JSON.stringify(bootstrapDecision)}\n`);
    commitRepo(root, "docs(CHG-022): establish bootstrap authority", ["docs/readiness/CHG-022.json", ".nous-feedback.jsonl"]);
    writeRepoFile(root, "scripts/work-readiness/git.mjs", "export {};\n");
    const head = commitRepo(root, "feat(CHG-022): implement authorized Git classifier", ["scripts/work-readiness/git.mjs"]);
    assert.equal(validateRangeOwnership({ root, base, head }).classification, "implementation");
    writeRepoFile(root, "src/outside-bootstrap.ts", "export {};\n");
    const unauthorized = commitRepo(root, "feat(CHG-022): unauthorized bootstrap path", ["src/outside-bootstrap.ts"]);
    assert.throws(() => validateRangeOwnership({ root, base: head, head: unauthorized }),
      error => error instanceof WorkReadinessError && error.code === "WR_BOOTSTRAP_PATH_UNAUTHORIZED"
        && error.path === "src/outside-bootstrap.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real Git rejects missing and ambiguous bases, and the MESSAGE tells them apart", () => {
  // CHG-038 collapsed WR_GIT_REF_INVALID and WR_GIT_REF_AMBIGUOUS into
  // WR_GIT_ERROR. That is only acceptable because the message still
  // discriminates — asserting the shared code alone would make this test unable
  // to tell the two conditions apart, which is exactly the diagnostic loss the
  // collapse must not cause.
  const { root } = makeGitRepo();
  try {
    assert.throws(() => listChangedPaths({ root, base: "missing-ref" }), (error) => {
      assert.equal(error.code, "WR_GIT_ERROR");
      assert.match(error.message, /does not resolve to one commit/u);
      return true;
    });
    git(root, ["branch", "collision"]);
    git(root, ["tag", "collision"]);
    assert.throws(() => listChangedPaths({ root, base: "collision" }), (error) => {
      assert.equal(error.code, "WR_GIT_ERROR");
      assert.match(error.message, /is ambiguous/u);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the budget is one constant, and the schema tracks it", () => {
  // CHG-035. The ceiling used to be a literal repeated across the check, its
  // message, two schema maxima, three doc lines and CLAUDE.md. A constant the
  // schema does not track is still two sources of truth, so this binds them:
  // the next re-baseline fails loudly if it updates one and not the other.
  const schema = JSON.parse(readFileSync(new URL("../docs/dev-guide/work-readiness.schema.json", import.meta.url), "utf8"));
  const maxima = [...JSON.stringify(schema).matchAll(/"maximum":(\d+)/gu)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 60);
  assert.equal(maxima.length, 2, "expected exactly two budget maxima in the schema");
  for (const m of maxima) assert.equal(m, MAX_READINESS_MINUTES);

  // And the message quotes the constant rather than a second literal.
  const source = readFileSync(new URL("../scripts/work-readiness/model.mjs", import.meta.url), "utf8");
  assert.match(source, /Estimate exceeds \$\{MAX_READINESS_MINUTES\} minutes/u);
});

test("the budget boundary is inclusive at the ceiling and refuses one over", () => {
  const at = normal();
  at.estimate_minutes = { readiness: 10, implementation: MAX_READINESS_MINUTES - 45,
    focused_verification: 20, review: 10, integration: 5 };
  at.estimate_minutes.total = MAX_READINESS_MINUTES;
  refreshDigest(at);
  assert.equal(validateAssessment(at, { feedbackRecords: [decisionFor(at)] }).decision, "ready",
    "an estimate landing exactly on the ceiling fits");

  const over = normal();
  over.estimate_minutes = { readiness: 10, implementation: MAX_READINESS_MINUTES - 44,
    focused_verification: 20, review: 10, integration: 5 };
  over.estimate_minutes.total = MAX_READINESS_MINUTES + 1;
  refreshDigest(over);
  expectError("WR_ESTIMATE_OVER_BUDGET", "$.estimate_minutes.total",
    () => validateAssessment(over, { feedbackRecords: [decisionFor(over)] }));
});

test("every raised code is spelled with the WR_ prefix at its call site", () => {
  // CHG-039. `fail()` prepends WR_ to a bare code at throw time, so both
  // spellings surfaced identically and the code set was split across two
  // vocabularies — which made it uncountable. Two separate censuses during this
  // rollout got the total wrong because of it (reporting 52 when the real figure
  // was 87), and the parent's success criterion 1 asks for exactly that count.
  //
  // Normalising the source makes the set greppable and leaves `stableCode` as a
  // no-op safety net. This test is what stops it drifting back.
  const bare = [];
  for (const rel of ["scripts/work-readiness.mjs", "scripts/work-readiness/model.mjs", "scripts/work-readiness/git.mjs"]) {
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    for (const m of source.matchAll(/(?:fail|cliError)\(\s*"([A-Z][A-Z0-9_]+)"/gu)) {
      if (!m[1].startsWith("WR_")) bare.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual(bare, [], `these call sites raise a bare code; spell it WR_*:\n${bare.join("\n")}`);
});

test("the WR_ normalisation in fail() is now a no-op safety net", () => {
  // Kept deliberately: it costs nothing and catches a future call site that
  // forgets. But it must no longer be doing real translation work — that is what
  // hid the second vocabulary.
  const source = readFileSync(new URL("../scripts/work-readiness/model.mjs", import.meta.url), "utf8");
  assert.match(source, /startsWith\("WR_"\)/u, "the safety net should stay");
});

test("collapsing the git codes preserved every message verbatim", () => {
  // The contract of a message-carrying error: the taxonomy went, the diagnosis
  // did not. Asserted structurally over the source so a future edit that drops a
  // message back to a bare code fails here.
  const sources = ["scripts/work-readiness/git.mjs", "scripts/work-readiness.mjs"]
    .map((rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"))
    .join("\n");
  const calls = [...sources.matchAll(/(?:fail|cliError)\(\s*"WR_GIT_ERROR",\s*([^,]+),\s*(.+?)\);/gsu)];
  assert.ok(calls.length >= 30, `expected the collapsed call sites, found ${calls.length}`);
  for (const [whole, , message] of calls) {
    const trimmed = message.trim();
    assert.ok(
      trimmed.length > 2 && trimmed !== '""' && trimmed !== "''",
      `WR_GIT_ERROR raised without a message: ${whole.slice(0, 90)}`,
    );
  }
  // And the ten collapsed names are gone from enforcement entirely.
  for (const gone of ["WR_GIT_EXEC_FAILED", "WR_GIT_COMMAND_FAILED", "WR_GIT_OUTPUT_LIMIT",
    "WR_GIT_REF_AMBIGUOUS", "WR_GIT_REF_INVALID", "WR_GIT_ROOT_INVALID", "WR_GIT_FILE_MISSING",
    "WR_GIT_CI_FETCH_FAILED", "WR_GIT_CI_BASE_INVALID", "WR_GIT_STATUS_INVALID"]) {
    assert.equal(sources.includes(`"${gone}"`), false, `${gone} is still raised`);
  }
  // The five that carry a distinct remedy stay.
  for (const kept of ["WR_GIT_PATH_ESCAPE", "WR_GIT_PATH_INVALID", "WR_GIT_ARGUMENT_INVALID",
    "WR_GIT_NON_ANCESTRAL", "WR_GIT_TOPOLOGY_UNSUPPORTED"]) {
    assert.ok(sources.includes(`"${kept}"`), `${kept} was collapsed but carries a distinct remedy`);
  }
});

test("range ownership rejects non-ancestral and merge topology", () => {
  const { root, base } = makeGitRepo();
  try {
    git(root, ["checkout", "-b", "side"]);
    writeRepoFile(root, "side.txt", "side\n");
    const side = commitRepo(root, "feat(US-321): side", ["side.txt"]);
    git(root, ["checkout", "main"]);
    writeRepoFile(root, "main.txt", "main\n");
    commitRepo(root, "feat(US-321): main", ["main.txt"]);
    assert.throws(() => validateRangeOwnership({ root, base: "main", head: side }), (error) => error.code === "WR_GIT_NON_ANCESTRAL");
    git(root, ["merge", "--no-ff", "side", "-m", "merge(CHG-456): unsupported topology"]);
    const mergeHead = git(root, ["rev-parse", "HEAD"]);
    assert.throws(() => validateRangeOwnership({ root, base, head: mergeHead }), (error) => error.code === "WR_GIT_TOPOLOGY_UNSUPPORTED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("path validation rejects traversal, NUL, absolute paths, and escaping symlinks", () => {
  for (const path of ["../escape", "/absolute", "bad\0path"]) {
    assert.throws(() => classifyChangedPath(path), (error) => error.code === "WR_GIT_PATH_INVALID");
  }
  const { root, base } = makeGitRepo();
  const outside = mkdtempSync(join(tmpdir(), "work-readiness-outside-"));
  try {
    symlinkSync(outside, join(root, "escape"));
    git(root, ["add", "escape"]);
    git(root, ["commit", "-m", "feat(US-321): add escaping symlink"]);
    assert.throws(() => listChangedPaths({ root, base }), (error) => error.code === "WR_GIT_PATH_ESCAPE");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }

  const historical = makeGitRepo();
  const historicalOutside = mkdtempSync(join(tmpdir(), "work-readiness-old-outside-"));
  try {
    symlinkSync(historicalOutside, join(historical.root, "old-escape"));
    const symlinkBase = commitRepo(historical.root, "feat(US-321): add historical escaping symlink", ["old-escape"]);
    rmSync(join(historical.root, "old-escape"));
    const head = commitRepo(historical.root, "fix(US-321): remove historical escaping symlink", ["old-escape"]);
    assert.throws(() => listChangedPaths({ root: historical.root, base: symlinkBase, head }), (error) => error.code === "WR_GIT_PATH_ESCAPE");
  } finally {
    rmSync(historical.root, { recursive: true, force: true });
    rmSync(historicalOutside, { recursive: true, force: true });
  }


  const staged = makeGitRepo();
  const stagedOutside = mkdtempSync(join(tmpdir(), "work-readiness-staged-outside-"));
  try {
    symlinkSync(stagedOutside, join(staged.root, "staged-escape"));
    git(staged.root, ["add", "staged-escape"]);
    assert.throws(() => listChangedPaths({ root: staged.root, staged: true }), (error) => error.code === "WR_GIT_PATH_ESCAPE");
  } finally {
    rmSync(staged.root, { recursive: true, force: true });
    rmSync(stagedOutside, { recursive: true, force: true });
  }
});

test("default base resolution is explicit and rejects an unavailable environment ref", () => {
  const { root, base } = makeGitRepo();
  try {
    assert.equal(resolveDefaultBase(root, { WORK_READINESS_BASE: base }), base);
    assert.throws(() => resolveDefaultBase(root, { WORK_READINESS_BASE: "missing" }), (error) => error.code === "WR_GIT_ERROR");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("default base resolution honors the CHG-022 boundary before merge and latest non-merge base after merge", () => {
  const root = sourceRoot.pathname;
  const boundary = "72f5e8545ea5d98795e2a5f19e62f6ba5e7ae7cb";
  const main = git(root, ["rev-parse", "main^{commit}"]);
  const head = git(root, ["rev-parse", "HEAD^{commit}"]);
  if (main === head) {
    const latestNonMerge = git(root, ["rev-list", "--no-merges", "-1", head]);
    const latestNonMergeParent = git(root, ["rev-parse", `${latestNonMerge}^`]);
    assert.equal(resolveDefaultBase(root, {}), latestNonMergeParent);
    return;
  }
  const mergeBase = git(root, ["merge-base", main, head]);
  const boundaryApplies = runGit(root, ["merge-base", "--is-ancestor", mergeBase, boundary]).status === 0
    && runGit(root, ["merge-base", "--is-ancestor", boundary, head]).status === 0;
  assert.equal(resolveDefaultBase(root, {}), boundaryApplies ? boundary : mergeBase);
});

test("default base resolution uses validated GitHub event SHAs and fails closed on missing CI provenance", () => {
  const { root, base } = makeGitRepo();
  try {
    git(root, ["switch", "-c", "feature/ci-base"]);
    writeRepoFile(root, "feature.ts", "export const feature = true;\n");
    const head = commitRepo(root, "feat(US-321): add feature", ["feature.ts"]);
    const pullRequestEvent = join(root, "pull-request-event.json");
    writeFileSync(pullRequestEvent, `${JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } })}\n`);
    assert.equal(resolveDefaultBase(root, { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: pullRequestEvent }), base);

    const pushEvent = join(root, "push-event.json");
    writeFileSync(pushEvent, `${JSON.stringify({ before: base, after: head })}\n`);
    assert.equal(resolveDefaultBase(root, { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: pushEvent }), base);

    const missingEvent = join(root, "missing-base-event.json");
    writeFileSync(missingEvent, "{}\n");
    assert.throws(
      () => resolveDefaultBase(root, { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: missingEvent }),
      (error) => error.code === "WR_GIT_ERROR",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mutation invalidation evidence after done cannot satisfy completion", () => {
  const value = completed();
  value.actuals.cold_mutation_attempts = 2;
  value.actuals.mutation_invalidations = 1;
  const records = [
    { story: value.work_id, event: "done" },
    { story: value.work_id, event: "mutation_invalidation", reason: "Too late." },
  ];
  expectError("WR_MUTATION_INVALIDATION_EVIDENCE", "$.actuals.mutation_invalidations", () => validateCompletionActuals(value, records));
});

test("delivered canonical and local names are recognized; invented names fail closed", () => {
  assert.ok(DELIVERED_CANONICAL_EVENTS.has("phase"));
  assert.ok(DELIVERED_LOCAL_EVENTS.has("lifecycle_corrected"));
  const accepted = makeGitRepo();
  try {
    writeRepoFile(accepted.root, ".nous-feedback.jsonl", [
      { story: "US-321", event: "phase", phase: "focused_verification", ts: "2026-10-01T16:00:00Z" },
      ...correctedLifecycle(normal({ work_id: "US-321" })),
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");
    const head = commitRepo(accepted.root, "docs(US-321): record a phase marker", [".nous-feedback.jsonl"]);
    validateRangeOwnership({ root: accepted.root, base: accepted.base, head });
  } finally {
    rmSync(accepted.root, { recursive: true, force: true });
  }
  const rejected = makeGitRepo();
  try {
    writeRepoFile(rejected.root, ".nous-feedback.jsonl", `${JSON.stringify({ story: "US-321", event: "invented_event", ts: "2026-10-01T16:00:00Z" })}\n`);
    const head = commitRepo(rejected.root, "docs(US-321): record an invented event", [".nous-feedback.jsonl"]);
    assert.throws(() => validateRangeOwnership({ root: rejected.root, base: rejected.base, head }), (error) => error.code === "WR_FEEDBACK_INVALID");
  } finally {
    rmSync(rejected.root, { recursive: true, force: true });
  }
});

test("CHG-062: done accepts an optional well-formed cost and rejects a malformed one", () => {
  const sha = "a".repeat(40);
  assert.equal(validDone({ story: "US-321", event: "done", source_commit: sha }), true);
  assert.equal(validDone({ story: "US-321", event: "done", source_commit: sha, ts: "2026-10-01T16:00:00Z",
    cost: { model: "claude", window: 1000000, calls: 142, context_tokens: 310000, output_tokens: 41000 } }), true);
  assert.equal(validDone({ story: "US-321", event: "done", cost: { calls: 1, context_tokens: 0 } }), true);
  assert.equal(validDone({ story: "US-321", event: "done", cost: { calls: "many", context_tokens: 1 } }), false);
  assert.equal(validDone({ story: "US-321", event: "done", cost: { calls: 1 } }), false);
  assert.equal(validDone({ story: "US-321", event: "done", cost: { calls: 1, context_tokens: 1, usd: 3 } }), false);
  assert.equal(validDone({ story: "US-321", event: "done", cost: { calls: -1, context_tokens: 1 } }), false);
  assert.equal(validDone({ story: "US-321", event: "done", notes: "extra key" }), false);
});

// CHG-065: optional preview actuals next to mutation_minutes.
test("preview_rounds and preview_minutes are optional non-negative integer actuals", () => {
  const actualsSchema = readinessSchema.$defs.actuals;
  for (const key of ["preview_rounds", "preview_minutes"]) {
    assert.deepEqual(actualsSchema.properties[key], { $ref: "#/$defs/nonnegative_integer" });
    assert.equal(actualsSchema.required.includes(key), false);
  }

  const historical = completed();
  assert.equal(Object.hasOwn(historical.actuals, "preview_rounds"), false);
  assert.equal(validateAssessment(historical, {
    feedbackRecords: [decisionFor(historical), { story: historical.work_id, event: "done" }],
  }).complete, true, "an artifact without preview actuals stays valid");

  const measured = completed();
  measured.actuals.preview_rounds = 2;
  measured.actuals.preview_minutes = 25;
  assert.equal(validateAssessment(measured, {
    feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
  }).complete, true);

  for (const key of ["preview_rounds", "preview_minutes"]) {
    for (const invalid of [-1, 1.5, null, "25"]) {
      const bad = completed();
      bad.actuals[key] = invalid;
      expectError("WR_INVALID_INTEGER", `$.actuals.${key}`, () => validateAssessment(bad, {
        feedbackRecords: [decisionFor(bad), { story: bad.work_id, event: "done" }],
      }));
    }
  }
});

// CHG-088: use the real committed child authority and inherited Git blobs.
const replayPath = "packages/db/scripts/verify-schema.mjs";
const replayOldBlob = "c793e5d163eb2abe025701b919c83df17d5c5abd";
const replayNewBlob = "4b189bb3adc899d4ea6bc9767a8ee5b83a6aeef3";
// Captured verbatim from immutable ff859d390126dcb3a13ece1ecdb00e2eaf863d70
// (approved readiness artifact and raw US-088 ledger lines), and the inherited
// c793e5d / 4b189bb Git blobs. Inline lossless gzip keeps clean clones independent
// of private/unreachable historical objects. These are captured authority bytes,
// not synthetic approvals. Hashes below independently verify every decoded value.
const replayArtifactBytes = gunzipSync(Buffer.from("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", "base64"));
const replayFeedbackBytes = gunzipSync(Buffer.from("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", "base64"));
const replayOldBytes = gunzipSync(Buffer.from("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", "base64"));
const replayNewBytes = gunzipSync(Buffer.from("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", "base64"));
function gitBlobId(bytes) {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}
assert.equal(createHash("sha256").update(replayArtifactBytes).digest("hex"), "14ec5d756da68d488107d859617a4edbd5de297764f8cee4e08bc8e14994936d");
assert.equal(createHash("sha256").update(replayFeedbackBytes).digest("hex"), "e7b7b433a3e87a3571f381a35f39e4e6c8efd13ce9fe7fbe0ea5696a7c1dc66d");
assert.equal(gitBlobId(replayOldBytes), replayOldBlob);
assert.equal(gitBlobId(replayNewBytes), replayNewBlob);
function makeReplayRepo({ hooks = true, routes = {} } = {}) {
  const { root } = makeGitRepo();
  assert.equal(computeReadinessPayloadSha256(JSON.parse(replayArtifactBytes.toString("utf8"))), "4904efb89d28d78f2e7cc754c8fbeb4ce16cf2bd1f1581e282d2781be98c469b");
  writeRepoFile(root, "docs/readiness/US-088.json", replayArtifactBytes);
  writeRepoFile(root, ".nous-feedback.jsonl", replayFeedbackBytes);
  writeRepoFile(root, replayPath, replayOldBytes);
  writeRepoFile(root, "scripts/mutation-routes.json", `${JSON.stringify(routes)}\n`);
  const base = commitRepo(root, "docs(US-088): preserve committed child authority", ["docs/readiness/US-088.json", ".nous-feedback.jsonl", replayPath, "scripts/mutation-routes.json"]);
  assert.equal(git(root, ["rev-parse", `${base}:${replayPath}`]), replayOldBlob);
  if (hooks) installReadinessHook(root);
  writeRepoFile(root, replayPath, replayNewBytes);
  return { root, base, authority: base, workId: "US-088" };
}

// CHG-091: real committed foreign correction coexists with the portable exact
// US-088 authority and verifier fixture. No private Git objects are required.
function makeCorrectionReplayRepo({ variant = "valid", hooks = false } = {}) {
  const fixture = makeReplayRepo({ hooks: false });
  const { root } = fixture;
  git(root, ["checkout", "--", replayPath]);
  const { authority, parentApproval, approval, correction } = annotationFixture();
  const prefix = `${JSON.stringify(parentApproval)}\n${annotationLine}\n${JSON.stringify(approval)}\n`;
  const authorityPath = "docs/readiness/CHG-089.json";
  let artifact = authority;
  if (variant === "unapproved") artifact = { ...authority, approval: { ...authority.approval, status: "pending" } };
  if (variant === "mismatched") artifact = { ...authority, readiness_payload_sha256: "0".repeat(64) };
  if (!["missing", "future", "uncommitted"].includes(variant)) writeRepoFile(root, authorityPath, JSON.stringify(artifact));
  writeRepoFile(root, ".nous-feedback.jsonl", replayFeedbackBytes.toString("utf8") + prefix);
  const authorityPaths = [".nous-feedback.jsonl", ...(existsSync(join(root, authorityPath)) ? [authorityPath] : [])];
  commitRepo(root, "docs(CHG-089): commit independent correction authority", authorityPaths);
  const changedCorrection = clone(correction);
  if (variant === "wrong actor") changedCorrection.approved_by = "forged";
  if (variant === "cross story") changedCorrection.story = "US-088";
  if (variant === "wrong target") changedCorrection.target_ts = "2026-10-12T03:00:35Z";
  let text = replayFeedbackBytes.toString("utf8") + prefix + JSON.stringify(changedCorrection) + "\n";
  if (variant === "raw bytes") text = text.replace(annotationLine, annotationLine + " ");
  if (variant === "duplicate") text += JSON.stringify(correction) + "\n";
  writeRepoFile(root, ".nous-feedback.jsonl", text);
  const base = commitRepo(root, "docs(CHG-089): retain foreign correction", [".nous-feedback.jsonl"]);
  if (["future", "uncommitted"].includes(variant)) writeRepoFile(root, authorityPath, JSON.stringify(authority));
  if (hooks) installReadinessHook(root);
  writeRepoFile(root, replayPath, replayNewBytes);
  return { ...fixture, base };
}

test("CHG-091 exact replay retains committed foreign correction context in helper and ordinary hook", () => {
  const fixture = makeCorrectionReplayRepo();
  try {
    const head = commitRepo(fixture.root, "feat(US-088): replay with foreign correction", [replayPath]);
    assert.equal(validateFunctionalDelivery({ ...fixture, head }), true);
    assert.deepEqual(validateRangeOwnership({ root: fixture.root, base: fixture.base, head }).workIds, ["US-088"]);
    git(fixture.root, ["reset", "--soft", fixture.base]);
    installReadinessHook(fixture.root);
    const ordinary = runGit(fixture.root, ["commit", "-m", "feat(US-088): ordinary corrected-context replay"]);
    assert.equal(ordinary.status, 0, ordinary.stderr);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("CHG-091 replay refuses hostile correction authority raw identity and history", () => {
  for (const variant of ["missing", "mismatched", "unapproved", "future", "uncommitted", "raw bytes", "wrong actor", "cross story", "wrong target", "duplicate"]) {
    const fixture = makeCorrectionReplayRepo({ variant });
    try {
      const paths = [replayPath, ...(variant === "future" ? ["docs/readiness/CHG-089.json"] : [])];
      const head = commitRepo(fixture.root, "feat(US-088): hostile correction context", paths);
      assert.throws(() => validateFunctionalDelivery({ ...fixture, head }),
        (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING", variant);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test("CHG-088 exact inherited replay passes ordinary staged commit and range", () => {
  const fixture = makeReplayRepo();
  try {
    const head = commitRepo(fixture.root, "feat(US-088): replay assigned verifier bytes", [replayPath]);
    assert.equal(git(fixture.root, ["rev-parse", `${head}:${replayPath}`]), replayNewBlob);
    assert.equal(validateFunctionalDelivery({ ...fixture, head }), true);
    assert.deepEqual(validateRangeOwnership({ root: fixture.root, base: fixture.base, head }).workIds, ["US-088"]);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("CHG-088 replay requires immutable validated exact authority", () => {
  const fixture = makeReplayRepo();
  try {
    const head = commitRepo(fixture.root, "feat(US-088): replay authority fixture", [replayPath]);
    for (const overrides of [
      { authority: undefined }, { authority: "missing-authority" },
      { authority: `${fixture.base}^` }, { authority: head },
      { workId: "US-089" }, { authority: { readiness_payload_sha256: "4904efb89d28d78f2e7cc754c8fbeb4ce16cf2bd1f1581e282d2781be98c469b" } },
    ]) {
      assert.throws(() => validateFunctionalDelivery({ ...fixture, head, ...overrides }),
        (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING");
    }
    // Working-tree assertions cannot lend approval to immutable Git authority.
    writeRepoFile(fixture.root, "docs/readiness/US-088.json", '{}\n');
    assert.equal(validateFunctionalDelivery({ ...fixture, head }), true);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("CHG-088 hostile replay bytes modes paths and mixed tooling reject through real Git", () => {
  const variants = [
    ["one byte", (r) => writeRepoFile(r, replayPath, `${readFileSync(join(r, replayPath), "utf8")} `)],
    ["deletion", (r) => rmSync(join(r, replayPath))],
    ["rename", (r) => renameSync(join(r, replayPath), join(r, "packages/db/scripts/renamed.mjs"))],
    ["copy", (r) => writeRepoFile(r, "packages/db/copied.txt", readFileSync(join(r, replayPath)))],
    ["symlink", (r) => { rmSync(join(r, replayPath)); symlinkSync("other.mjs", join(r, replayPath)); }],
    ["executable", (r) => chmodSync(join(r, replayPath), 0o755)],
    ...["scripts/arbitrary.mjs", "scripts/test-mutation.mjs", "scripts/mutation-cache.mjs", "stryker.config.json", "vitest.config.ts", ".githooks/commit-msg", "packages/domain/src/disguised.ts", "packages/domain/src/disguised.js"].map((path) => [path, (r) => writeRepoFile(r, path, "#!/usr/bin/env node\nexport {};\n")]),
    ["removed existing route", (r) => writeRepoFile(r, "scripts/mutation-routes.json", '{}\n')],
    ["unsafe route data", (r) => writeRepoFile(r, "scripts/mutation-routes.json", '{"threshold":0}\n')],
    ["unowned route", (r) => {
      writeRepoFile(r, "scripts/mutation-routes.json", '{"packages/domain/src/missing.ts":["packages/domain/src/replay.test.ts"]}\n');
      writeRepoFile(r, "packages/domain/src/replay.test.ts", 'export {};\n');
    }],
  ];
  for (const [name, mutate] of variants) {
    const fixture = makeReplayRepo({ hooks: false, routes: name === "removed existing route" ? { "packages/domain/src/prior.ts": ["packages/domain/src/prior.test.ts"] } : {} });
    try {
      mutate(fixture.root);
      git(fixture.root, ["add", "-A"]);
      git(fixture.root, ["commit", "-m", `feat(US-088): hostile ${name}`]);
      assert.throws(() => validateFunctionalDelivery({ ...fixture, head: "HEAD" }),
        (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING", name);
      assert.throws(() => validateRangeOwnership({ root: fixture.root, base: fixture.base, head: "HEAD" }),
        (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING", name);
      git(fixture.root, ["reset", "--soft", fixture.base]);
      installReadinessHook(fixture.root);
      const staged = runGit(fixture.root, ["commit", "-m", `feat(US-088): staged hostile ${name}`]);
      assert.equal(staged.status, 1, `${name}: ${staged.stderr}`);
      assert.match(staged.stderr, /WR_MIXED_FUNCTIONAL_TOOLING/u, name);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test("CHG-088 wrong parent digest approval and foreign authority reject", () => {
  for (const variant of ["parent blob", "parent mode", "digest", "approval", "missing feedback", "missing artifact", "foreign work"]) {
    const fixture = makeReplayRepo({ hooks: false });
    try {
      git(fixture.root, ["checkout", "--", replayPath]);
      const path = "docs/readiness/US-088.json";
      const artifact = JSON.parse(readFileSync(join(fixture.root, path), "utf8"));
      if (variant === "parent blob") writeRepoFile(fixture.root, replayPath, 'different parent\n');
      if (variant === "parent mode") chmodSync(join(fixture.root, replayPath), 0o755);
      if (variant === "digest") {
        artifact.title += " changed";
        const oldDigest = artifact.readiness_payload_sha256;
        refreshDigest(artifact);
        // Valid differently approved payload: rejection must come from the closed binding.
        const feedbackPath = join(fixture.root, ".nous-feedback.jsonl");
        writeFileSync(feedbackPath, readFileSync(feedbackPath, "utf8").replaceAll(oldDigest, artifact.readiness_payload_sha256));
        assert.equal(validateAssessment(artifact, { feedbackRecords: readFileSync(feedbackPath, "utf8").trim().split("\n").map(JSON.parse), deliveryPolicy: true }).active, true);
      }
      if (variant === "approval") artifact.approval.approved_by = "forged";
      if (variant === "foreign work") artifact.work_id = "US-089";
      if (["digest", "approval", "foreign work"].includes(variant)) writeRepoFile(fixture.root, path, `${JSON.stringify(artifact)}\n`);
      if (variant === "missing feedback") writeRepoFile(fixture.root, ".nous-feedback.jsonl", '');
      if (variant === "missing artifact") rmSync(join(fixture.root, path));
      git(fixture.root, ["add", "-A"]);
      git(fixture.root, ["commit", "-m", `docs(US-088): hostile authority ${variant}`]);
      const base = git(fixture.root, ["rev-parse", "HEAD"]);
      writeRepoFile(fixture.root, replayPath, replayNewBytes);
      chmodSync(join(fixture.root, replayPath), 0o644);
      const head = commitRepo(fixture.root, "feat(US-088): hostile authority replay", [replayPath]);
      assert.throws(() => validateFunctionalDelivery({ ...fixture, base, head, authority: ["parent blob", "parent mode"].includes(variant) ? fixture.authority : base }),
        (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING", variant);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test("CHG-088 allowed verifier still permits owned additive routes and refuses later edits", () => {
  const fixture = makeReplayRepo();
  try {
    const source = "packages/domain/src/replay.ts", responsible = "packages/domain/src/replay.test.ts";
    writeRepoFile(fixture.root, source, 'export const value = 1;\n');
    writeRepoFile(fixture.root, responsible, 'export {};\n');
    writeRepoFile(fixture.root, "scripts/mutation-routes.json", `${JSON.stringify({ [source]: [responsible] })}\n`);
    const first = commitRepo(fixture.root, "feat(US-088): replay with owned additive route", [replayPath, source, responsible, "scripts/mutation-routes.json"]);
    assert.equal(validateFunctionalDelivery({ ...fixture, head: first }), true);
    assert.deepEqual(validateRangeOwnership({ root: fixture.root, base: fixture.base, head: first }).workIds, ["US-088"]);
    writeRepoFile(fixture.root, replayPath, `${readFileSync(join(fixture.root, replayPath), "utf8")} `);
    git(fixture.root, ["add", replayPath]);
    const later = runGit(fixture.root, ["commit", "-m", "feat(US-088): forbidden later verifier edit"]);
    assert.equal(later.status, 1);
    assert.match(later.stderr, /WR_MIXED_FUNCTIONAL_TOOLING/u);
    git(fixture.root, ["checkout", "HEAD", "--", replayPath]);
    writeRepoFile(fixture.root, "scripts/mutation-routes.json", '{}\n');
    git(fixture.root, ["add", "scripts/mutation-routes.json"]);
    const removal = runGit(fixture.root, ["commit", "-m", "feat(US-088): remove existing route"]);
    assert.equal(removal.status, 1);
    assert.match(removal.stderr, /WR_MIXED_FUNCTIONAL_TOOLING/u);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("CHG-088 aggregate endpoints cannot conceal reversal and later edits", () => {
  const fixture = makeReplayRepo({ hooks: false });
  try {
    const first = commitRepo(fixture.root, "feat(US-088): exact initial transition", [replayPath]);
    git(fixture.root, ["checkout", fixture.base, "--", replayPath]);
    const reversed = commitRepo(fixture.root, "feat(US-088): hostile reversal", [replayPath]);
    assert.throws(() => validateFunctionalDelivery({ ...fixture, base: first, head: reversed }),
      (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING");
    git(fixture.root, ["checkout", first, "--", replayPath]);
    const restored = commitRepo(fixture.root, "feat(US-088): hostile aggregate replay", [replayPath]);
    assert.equal(git(fixture.root, ["rev-parse", `${restored}:${replayPath}`]), replayNewBlob);
    assert.throws(() => validateFunctionalDelivery({ ...fixture, head: restored }),
      (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING");
    assert.throws(() => validateRangeOwnership({ root: fixture.root, base: fixture.base, head: restored }),
      (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING");
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("CHG-088 copy-only delivery cannot export the bound candidate bytes elsewhere", () => {
  const fixture = makeReplayRepo({ hooks: false });
  try {
    git(fixture.root, ["checkout", "--", replayPath]);
    const copiedPath = "packages/db/copied.txt";
    writeRepoFile(fixture.root, copiedPath, replayNewBytes);
    const head = commitRepo(fixture.root, "feat(US-088): hostile copy-only delivery", [copiedPath]);
    assert.equal(git(fixture.root, ["rev-parse", `${head}:${replayPath}`]), replayOldBlob);
    assert.equal(git(fixture.root, ["rev-parse", `${head}:${copiedPath}`]), replayNewBlob);
    assert.throws(() => validateFunctionalDelivery({ ...fixture, head }),
      (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING");
    assert.throws(() => validateRangeOwnership({ root: fixture.root, base: fixture.base, head }),
      (error) => error.code === "WR_MIXED_FUNCTIONAL_TOOLING");
    git(fixture.root, ["reset", "--soft", fixture.base]);
    installReadinessHook(fixture.root);
    const staged = runGit(fixture.root, ["commit", "-m", "feat(US-088): staged copy-only delivery"]);
    assert.equal(staged.status, 1, staged.stderr);
    assert.match(staged.stderr, /WR_MIXED_FUNCTIONAL_TOOLING/u);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

const schemaContractPath = "packages/db/schema-contract.json";
const schemaContractBytes = readFileSync(new URL("../packages/db/schema-contract.json", import.meta.url));
function makeSchemaContractRepo({ existing = false, deliveryCounting = true, technicalPlan = true } = {}) {
  const { root } = makeGitRepo();
  git(root, ["config", "core.filemode", "true"]);
  const functional = approvedArtifact("US-123");
  if (deliveryCounting) functional.signals.bookkeeping_files = 0;
  refreshDigest(functional);
  approveAfterPolicyActivation(root, functional);
  const technical = approvedArtifact("CHG-123");
  technical.work_type = "technical";
  technical.scopes = ["tooling"];
  technical.signals.tooling_change = true;
  technical.signals.bookkeeping_files = 0;
  refreshDigest(technical);
  writeRepoFile(root, "docs/readiness/CHG-123.json", JSON.stringify(technical));
  const feedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
  writeRepoFile(root, ".nous-feedback.jsonl", feedback + JSON.stringify(decisionFor(technical)) + "\n");
  const plan = (value) => `docs/superpowers/plans/${value.work_id}.md`;
  writeRepoFile(root, plan(functional), implementationPlanHeader(functional));
  if (technicalPlan) writeRepoFile(root, plan(technical), implementationPlanHeader(technical));
  if (existing) writeRepoFile(root, schemaContractPath, schemaContractBytes);
  const paths = ["docs/readiness/CHG-123.json", ".nous-feedback.jsonl", plan(functional),
    ...(technicalPlan ? [plan(technical)] : []), ...(existing ? [schemaContractPath] : [])];
  const base = commitRepo(root, "docs(CHG-123): commit contract fixture authority and plans", paths);
  return { root, base, authority: base, workId: functional.work_id };
}

test("CHG-100 functional contract introduction edits and modes reject staged and per commit", () => {
  for (const deliveryCounting of [true, false]) {
    for (const variant of ["initial add", "edit", "delete", "mode", "symlink", "mixed"]) {
      const fixture = makeSchemaContractRepo({ existing: !["initial add", "mixed"].includes(variant), deliveryCounting });
      try {
        const { root, base } = fixture;
        if (["initial add", "mixed"].includes(variant)) writeRepoFile(root, schemaContractPath, schemaContractBytes);
        if (variant === "edit") {
          // CHG-101 consumes this data, but safe canonical existing-file edits
          // still cannot acquire functional authority before CHG-102.
          const changed = JSON.parse(schemaContractBytes.toString("utf8"));
          changed.coreTableNames.push("new_table");
          writeRepoFile(root, schemaContractPath, JSON.stringify(changed, null, 2) + "\n");
        }
        if (variant === "delete") rmSync(join(root, schemaContractPath));
        if (variant === "mode") chmodSync(join(root, schemaContractPath), 0o755);
        if (variant === "symlink") {
          rmSync(join(root, schemaContractPath));
          symlinkSync("other.json", join(root, schemaContractPath));
        }
        const paths = [schemaContractPath];
        if (variant === "mixed") {
          writeRepoFile(root, "apps/web/src/feature.ts", "export const feature = true;\n");
          paths.push("apps/web/src/feature.ts");
        }
        const message = `feat(US-123${variant === "mixed" ? " CHG-123" : ""}): functional ${variant}`;
        // Commit without a hook so historical validation must catch the same
        // forbidden transition independently of ordinary staged enforcement.
        const head = commitRepo(root, message, paths);
        expectError("WR_MIXED_FUNCTIONAL_TOOLING", schemaContractPath, () => validateFunctionalDelivery({ ...fixture, head }));
        expectError("WR_MIXED_FUNCTIONAL_TOOLING", schemaContractPath, () => validateRangeOwnership({ root, base, head }));
        git(root, ["reset", "--soft", base]);
        installReadinessHook(root);
        const staged = runGit(root, ["commit", "-m", message]);
        assert.equal(staged.status, 1, `${variant}/${deliveryCounting}: ${staged.stderr}`);
        assert.match(staged.stderr, /WR_MIXED_FUNCTIONAL_TOOLING/u);
        assert.ok(staged.stderr.includes(schemaContractPath), `${variant}/${deliveryCounting}: ${staged.stderr}`);
        assert.equal(git(root, ["rev-parse", "HEAD"]), base);
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
  }
});

test("CHG-100 later technical commits cannot launder functional contract history", () => {
  for (const existing of [false, true]) {
    const fixture = makeSchemaContractRepo({ existing });
    try {
      const { root, base } = fixture;
      writeRepoFile(root, schemaContractPath, existing ? schemaContractBytes.toString("utf8") + "\n" : schemaContractBytes);
      const first = commitRepo(root, "feat(US-123): forbidden historical contract change", [schemaContractPath]);
      if (existing) writeRepoFile(root, schemaContractPath, schemaContractBytes);
      else rmSync(join(root, schemaContractPath));
      const head = commitRepo(root, "fix(CHG-123): technical restore of aggregate endpoints", [schemaContractPath]);
      assert.deepEqual(listChangedPaths({ root, base, head }), [], "matching endpoints conceal the contract transition");
      assert.deepEqual(validateRangeOwnership({ root, base: first, head }).workIds, ["CHG-123"]);
      expectError("WR_MIXED_FUNCTIONAL_TOOLING", schemaContractPath, () => validateRangeOwnership({ root, base, head }));
      expectError("WR_MIXED_FUNCTIONAL_TOOLING", schemaContractPath, () => validateRangeOwnership({ root, base, head, message: "CHG-123" }));
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test("CHG-100 technical contract delivery requires committed ready authority and plan", () => {
  for (const technicalPlan of [true, false]) {
    const fixture = makeSchemaContractRepo({ technicalPlan });
    try {
      const { root, base } = fixture;
      installReadinessHook(root);
      writeRepoFile(root, schemaContractPath, schemaContractBytes);
      git(root, ["add", schemaContractPath]);
      const unowned = runGit(root, ["commit", "-m", "feat(CHG-999): unowned contract introduction"]);
      assert.equal(unowned.status, 1);
      assert.match(unowned.stderr, /WR_READINESS_MISSING/u);
      const result = runGit(root, ["commit", "-m", "feat(CHG-123): technical contract introduction"]);
      if (technicalPlan) {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(validateRangeOwnership({ root, base, head: "HEAD" }).workIds, ["CHG-123"]);
        assert.equal(git(root, ["show", `HEAD:${schemaContractPath}`]), schemaContractBytes.toString("utf8").trim());
      } else {
        assert.equal(result.status, 1);
        assert.match(result.stderr, /WR_IMPLEMENTATION_PLAN_MISSING/u);
      }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

assert.ok(process.env.READINESS_TEST_FILTER ? assertions > 0 : assertions >= 30);
process.stdout.write(`work-readiness model: ${assertions} behavioral tests passed\n`);

// CHG-082 focused real-Git and differential contracts.
await import("./test-chg082.mjs");

// CHG-084 explicit counting and unchanged approval rebase contracts.
await import("./test-chg084.mjs");
