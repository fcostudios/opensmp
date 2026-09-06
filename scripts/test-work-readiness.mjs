#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, constants as fsConstants, existsSync, fstatSync, fsyncSync as nodeFsyncSync, mkdtempSync, mkdirSync, openSync as nodeOpenSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync as nodeWriteSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  MAX_READINESS_MINUTES,
  WorkReadinessError,
  canonicalReadinessPayload,
  classifyAssessment,
  computeReadinessPayloadSha256,
  validateApproval,
  validateAssessment,
  validateCompletionActuals,
  validatePartitionGraph,
} from "./work-readiness/model.mjs";
import {
  classifyChangedPath,
  extractWorkIds,
  listChangedPaths,
  resolveDefaultBase,
  validateRangeOwnership,
} from "./work-readiness/git.mjs";
import { calibrateAssessment, createAssessmentFile, readCanonicalMessageFile } from "./work-readiness.mjs";
import * as readinessCli from "./work-readiness.mjs";


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
  try {
    body();
    assertions += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

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
    decision: "ready", active: true, complete: false, inactiveReason: null,
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

test("current approval evidence uses the closed canonical decision shape", () => {
  const value = normal();
  const current = decisionFor(value);
  const { reason: _reason, ...missingReason } = current;
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [missingReason]));
  expectError("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", () => validateApproval(value, [{ ...current, extra: "not canonical" }]));
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
    { story: value.work_id, event: "ac_pass", ac: 1, notes: "executed after revocation" },
    decisionFor(value),
  ]));
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, [
    priorReady,
    attestDecision({ story: value.work_id, event: "decision", id: "REVOKE", text: `Decision blocked for readiness payload SHA-256 ${"e".repeat(64)}.`, reason: "Reopened" }),
    { story: value.work_id, event: "test_report", notes: "ran after revocation" },
    decisionFor(value),
  ]));
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
    attestDecision({ ...validPrior, id: "EXTRA-FIELD", extra: "not closed" }),
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
    { story: "CHG-022", event: "ac_pass", ac: 1, notes: "unauthorized" },
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


test("completed normal assessment remains valid but cannot authorize more implementation", () => {
  const value = completed();
  const records = [decisionFor(value), { story: value.work_id, event: "done" }];
  assert.deepEqual(validateAssessment(value, { feedbackRecords: records }), {
    decision: "ready", active: false, complete: true, inactiveReason: "terminal",
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
  assert.deepEqual(validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]), { complete: true, total: 89, variance: -11 });
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

test("repository test gate runs the readiness range backstop before focused tests", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.test, /^pnpm run readiness:check:all && pnpm run readiness:check:range && pnpm run test:work-readiness\b/u);
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

test("a partial Nous sync envelope cannot authorize a generated edit", () => {
  const { root } = makeGitRepo();
  try {
    const generatedPath = "docs/stories/SPRINT_PLAN.md";
    writeExactNousSyncEnvelope(root, generatedPath, "# Sprint plan from Nous\n");
    const synced = commitRepo(root, "docs(CHG-045): sync generated sprint", [
      generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
    ]);

    const generated = "# Hand-edited sprint plan with partial provenance\n";
    writeRepoFile(root, generatedPath, generated);
    writeRepoFile(root, ".nous-sync.json", `${JSON.stringify({
      synced_at: "2026-09-05T21:40:53.665778+00:00",
      project_id: "fixture__ledger",
      files: {
        [generatedPath]: {
          hash: createHash("sha256").update(generated).digest("hex").slice(0, 16),
          source: "generated",
        },
      },
    }, null, 2)}\n`);
    const edited = commitRepo(root, "docs(CHG-045): partially sync generated sprint", [
      generatedPath, ".nous-sync.json",
    ]);

    assert.throws(
      () => validateRangeOwnership({ root, base: synced, head: edited }),
      (error) => error.code === "WR_GENERATED_NOUS_PATH"
        && error.path === generatedPath,
    );
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

test("an exact Nous sync envelope requires equal UTC-second timestamps", () => {
  const variants = [
    { project: { generated_at: "2026-09-05T21:40:53" } },
    { project: { generated_at: "2026-09-05T16:40:53-05:00" } },
    { project: { generated_at: "2026-02-30T21:40:53Z" }, sync: { synced_at: "2026-02-30T21:40:53.000000+00:00" } },
    { sync: { synced_at: "2026-09-05T21:40:53.665778" } },
    { sync: { synced_at: "2026-09-05T16:40:53.665778-05:00" } },
    { sync: { synced_at: "2026-09-05T21:40:53.1234567890+00:00" } },
    { sync: { synced_at: "2026-09-05T21:40:54.000000+00:00" } },
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

assert.ok(assertions >= 30);
process.stdout.write(`work-readiness model: ${assertions} behavioral tests passed\n`);
