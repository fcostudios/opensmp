#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

const bootstrap = JSON.parse(
  await readFile(new URL("../docs/readiness/CHG-022.json", import.meta.url), "utf8"),
);
const bootstrapDecision = {
  story: "CHG-022",
  event: "decision",
  id: "CHG022-READINESS-V2-APPROVAL",
  text: `Decision ready for readiness payload SHA-256 ${bootstrap.readiness_payload_sha256} as the one-time, immutable, non-repeatable CHG-022 policy bootstrap, based on design commit ${bootstrap.bootstrap_authorization.design_commit} and refreshed authority plan commit ${bootstrap.bootstrap_authorization.plan_commit}. Exact authorized paths, in order: ${bootstrap.bootstrap_authorization.allowed_paths.join("; ")}. This authorization interval begins at this matching decision and expires on CHG-022's first valid terminal done event; every later implementation commit must be rejected and cannot reuse this or any earlier bootstrap approval.`,
  reason: "Policy activation",
};

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
  assert.deepEqual(validateAssessment(value, { feedbackRecords: [decisionFor(value)] }), { decision: "ready" });
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

test("bootstrap cannot be reused after the first done", () => {
  const records = [bootstrapDecision, { story: "CHG-022", event: "done" }];
  expectError("WR_BOOTSTRAP_EXPIRED", "$.bootstrap_authorization.expires_on_event", () => validateAssessment(bootstrap, { feedbackRecords: records }));
});

test("bootstrap expires on canonical deferral and projected terminal events", () => {
  expectError("WR_BOOTSTRAP_EXPIRED", "$.bootstrap_authorization.expires_on_event", () => validateAssessment(bootstrap, {
    feedbackRecords: [bootstrapDecision, { story: "CHG-022", event: "done_with_deferral" }],
  }));

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
  expectError("WR_BOOTSTRAP_EXPIRED", "$.bootstrap_authorization.expires_on_event", () => validateAssessment(bootstrap, {
    feedbackRecords: [bootstrapDecision, changeDecision, { story: "CHG-022", event: "done" }, supersession, projectedDone],
  }));
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

  assert.equal(validateAssessment(value, {
    feedbackRecords: [approval, rawTerminal, supersession, changeDecision, replacement],
  }).decision, "ready");
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
