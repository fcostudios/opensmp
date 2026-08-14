#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, constants as fsConstants, existsSync, fsyncSync as nodeFsyncSync, mkdtempSync, mkdirSync, openSync as nodeOpenSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
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
import { createAssessmentFile, readCanonicalMessageFile } from "./work-readiness.mjs";

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

const clone = (value) => structuredClone(value);

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

function decisionFor(value, overrides = {}) {
  return {
    story: value.work_id,
    event: "decision",
    id: value.approval.evidence,
    text: `Decision ${value.decision} for readiness payload SHA-256 ${value.readiness_payload_sha256}.`,
    reason: "Approved assessment",
    ...overrides,
  };
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

test("accepts an approved ready US", () => {
  const value = normal();
  assert.deepEqual(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }), {
    decision: "ready", active: true, complete: false, inactiveReason: null,
  });
  assert.equal(classifyAssessment(value), "ready");
});

for (const [name, mutate, code, path] of [
  ["normal estimate above 120", (v) => { v.estimate_minutes.implementation = 76; v.estimate_minutes.total = 121; }, "WR_ESTIMATE_OVER_BUDGET", "$.estimate_minutes.total"],
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
  value.partitions[0].estimate_minutes.implementation = 76;
  value.partitions[0].estimate_minutes.total = 121;
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

test("approval must precede checkpoints and terminal implementation evidence", () => {
  const value = normal();
  const startedBeforeDecision = [{ story: value.work_id, event: "started", agent: "codex" }, decisionFor(value)];
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, startedBeforeDecision));
  const acBeforeDecision = [{ story: value.work_id, event: "ac_pass", ac: 1, notes: "implemented" }, decisionFor(value)];
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, acBeforeDecision));
  const doneBeforeDecision = [{ story: value.work_id, event: "done" }, decisionFor(value)];
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, doneBeforeDecision));
  const checkpointBeforeDecision = [{ story: value.work_id, event: "checkpoint", status: "on_track" }, decisionFor(value)];
  expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () => validateApproval(value, checkpointBeforeDecision));
});

test("reapproval permits only execution covered by a prior digest-bound ready decision", () => {
  const value = normal();
  const priorReady = {
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approved scope",
  };
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
    { story: value.work_id, event: "decision", id: "REVOKE", text: `Decision blocked for readiness payload SHA-256 ${"e".repeat(64)}.`, reason: "Reopened" },
    { story: value.work_id, event: "test_report", notes: "ran after revocation" },
    decisionFor(value),
  ]));
});

test("selected approval becomes inactive after a blocker or 90-minute partition checkpoint", () => {
  const value = normal();
  for (const revocation of [
    { story: value.work_id, event: "blocked", reason: "Dependency reopened" },
    { story: value.work_id, event: "blocker", reason: "Scope is unresolved" },
    { story: value.work_id, event: "checkpoint", elapsed_minutes: 90, status: "partition_required" },
    { story: value.work_id, event: "checkpoint", elapsed_minutes: 90, status: "blocked" },
  ]) {
    expectError("WR_APPROVAL_INACTIVE", "$.approval.evidence", () => validateApproval(value, [decisionFor(value), revocation]));
  }
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
  const priorReady = {
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approved scope",
  };
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

  const validPrior = { ...fabricatedWithoutId, id: "US123-READY-V1" };
  const malformedCases = [
    { ...validPrior, id: "AMBIGUOUS", text: `Decision blocked then Decision ready for readiness payload SHA-256 ${digest}.` },
    { ...validPrior, id: "BAD-HASH", text: "Decision ready for readiness payload SHA-256 abc." },
    { ...validPrior, id: "BAD-TOKEN", text: `Decision Ready for readiness payload SHA-256 ${digest}.` },
    { ...validPrior, id: "TWO-HASHES", text: `Decision ready for SHA-256 ${digest} and SHA-256 ${"e".repeat(64)}.` },
    { ...validPrior, id: "EXTRA-FIELD", extra: "not closed" },
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
  const prior = {
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approval",
  };
  expectError("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", () => validateApproval(value, [
    prior,
    { ...prior },
    decisionFor(value),
  ]));
});

test("prior authorization IDs are globally unique across stories and chronology", () => {
  const value = normal();
  const prior = {
    story: value.work_id,
    event: "decision",
    id: "US123-READY-V1",
    text: `Decision ready for readiness payload SHA-256 ${"f".repeat(64)}.`,
    reason: "Prior approval",
  };
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
  assert.equal(validateApproval(value, [{ ...decisionFor(value), text: completeText }]).payloadSha256, value.readiness_payload_sha256);
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [{ ...decisionFor(value), text: `${decisionFor(value).text} Approved official child: CHG-124.` }]));
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [{ ...decisionFor(value), text: `${completeText} Duplicate CHG-124.` }]));
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [{ ...decisionFor(value), text: `${decisionFor(value).text} Approved official children: CHG-1240, CHG-125.` }]));
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [{ ...decisionFor(value), text: `${completeText} Undeclared CHG-999.` }]));
});

test("local-only partition approval rejects undeclared official ID tokens", () => {
  const value = partitioned();
  expectError("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", () => validateApproval(value, [{ ...decisionFor(value), text: `${decisionFor(value).text} Undeclared CHG-999.` }]));
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

test("completed bootstrap remains valid but inactive and requires correct actuals", () => {
  const records = [bootstrapDecision, { story: "CHG-022", event: "done" }];
  expectError("WR_ACTUALS_REQUIRED", "$.actuals", () => validateAssessment(bootstrap, { feedbackRecords: records }));
  const value = completedBootstrap();
  assert.deepEqual(validateAssessment(value, { feedbackRecords: records }), {
    decision: "ready", active: false, complete: true, inactiveReason: "terminal",
  });
  value.actuals.total += 1;
  expectError("WR_ACTUALS_TOTAL_MISMATCH", "$.actuals.total", () => validateAssessment(value, { feedbackRecords: records }));
});

test("bootstrap completion recognizes canonical deferral and projected terminal events", () => {
  const value = completedBootstrap();
  assert.equal(validateAssessment(value, {
    feedbackRecords: [bootstrapDecision, { story: "CHG-022", event: "done_with_deferral" }],
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
    feedbackRecords: [bootstrapDecision, changeDecision, { story: "CHG-022", event: "done" }, supersession, projectedDone],
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
    { story: "CHG-022", event: "checkpoint", status: "partition_required" },
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
    phase_minutes: { readiness: 12, implementation: 50, focused_verification: 18, review: 10, integration: 5 },
    total: 95,
    changed_files: 7,
    commits: 2,
    review_fix_loops: 1,
    cold_mutation_attempts: 1,
    mutation_invalidations: 0,
    estimate_variance_minutes: -5,
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
  assert.deepEqual(validateCompletionActuals(value, [{ story: value.work_id, event: "done" }]), { complete: true, total: 95, variance: -5 });
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

function commitRepo(root, message, paths) {
  git(root, ["add", "--", ...paths]);
  git(root, ["commit", "-m", message]);
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

function runCli(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
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

test("unchanged payload permits candidate on-track checkpoint and mutable actuals", () => {
  const { root } = makeGitRepo();
  try {
    installReadinessHook(root);
    const value = approvedArtifact("US-123");
    commitReadinessEvidence(root, [value]);
    const candidate = clone(value);
    candidate.checkpoints = [{ elapsed_minutes: 45, status: "on_track", implementation_complete: false, evidence: "Focused slice is on estimate" }];
    candidate.actuals = {
      phase_minutes: { readiness: null, implementation: null, focused_verification: null, review: null, integration: null },
      total: null, changed_files: null, commits: null, review_fix_loops: null,
      cold_mutation_attempts: null, mutation_invalidations: null,
      estimate_variance_minutes: null, root_cause: null,
    };
    const priorFeedback = readFileSync(join(root, ".nous-feedback.jsonl"), "utf8");
    writeRepoFile(root, "docs/readiness/US-123.json", `${JSON.stringify(candidate, null, 2)}\n`);
    writeRepoFile(root, ".nous-feedback.jsonl", `${priorFeedback}${JSON.stringify({ story: "US-123", event: "checkpoint", elapsed_minutes: 45, status: "on_track" })}\n`);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    git(root, ["add", "docs/readiness/US-123.json", ".nous-feedback.jsonl", "apps/web/src/app/page.tsx"]);
    const result = runGit(root, ["commit", "-m", "feat(US-123): continue active checkpoint"]);
    assert.equal(result.status, 0, result.stderr);
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
    writeRepoFile(root, "docs/readiness/CHG-022.json", `${JSON.stringify(bootstrap, null, 2)}\n`);
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
    assert.equal(output.errors[0].code, "WR_GIT_REF_INVALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
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
    assert.equal(parseCliJson(unbornResult).errors[0].code, "WR_GIT_COMMAND_FAILED");

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
    assert.equal(mergeResult.status, 2);
    assert.equal(parseCliJson(mergeResult).errors[0].code, "WR_GIT_TOPOLOGY_UNSUPPORTED");
  } finally {
    rmSync(unborn, { recursive: true, force: true });
    rmSync(merged.root, { recursive: true, force: true });
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
    const base = commitActivationHistory(root, records);
    writeRepoFile(root, "apps/web/src/app/page.tsx", "export {};\n");
    const head = commitRepo(root, "feat(US-321): historical exemption fixture", ["apps/web/src/app/page.tsx"]);
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
    ["checkpoint", normal(), [decisionFor(normal()), { story: "US-123", event: "checkpoint", elapsed_minutes: 90, status: "partition_required" }]],
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

test("historical grandfathering requires terminal done before CHG-022 V2 activation", () => {
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
      if (beforeActivation) {
        assert.deepEqual(validateRangeOwnership({ root, base, head }).grandfatheredWorkIds, ["US-321"]);
      } else {
        assert.throws(() => validateRangeOwnership({ root, base, head }), (error) => error.code === "WR_READINESS_MISSING");
      }
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

test("grandfathering honors a canonical projected terminal lifecycle", () => {
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
    assert.deepEqual(validateRangeOwnership({ root, base, head }).grandfatheredWorkIds, ["US-321"]);
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

test("real Git rejects missing and ambiguous bases", () => {
  const { root } = makeGitRepo();
  try {
    assert.throws(() => listChangedPaths({ root, base: "missing-ref" }), (error) => error.code === "WR_GIT_REF_INVALID");
    git(root, ["branch", "collision"]);
    git(root, ["tag", "collision"]);
    assert.throws(() => listChangedPaths({ root, base: "collision" }), (error) => error.code === "WR_GIT_REF_AMBIGUOUS");
  } finally {
    rmSync(root, { recursive: true, force: true });
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
    assert.throws(() => resolveDefaultBase(root, { WORK_READINESS_BASE: "missing" }), (error) => error.code === "WR_GIT_REF_INVALID");
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
