import { createHash } from "node:crypto";

const TOP_LEVEL_KEYS = [
  "schema_version", "readiness_payload_sha256", "work_id", "kind", "work_type", "title", "source",
  "outcomes", "acceptance_criteria", "scopes", "signals", "estimate_minutes", "uncertainties",
  "dependencies", "decision", "partitions", "approval", "actuals", "checkpoints", "policy_bootstrap",
  "bootstrap_exemption_rationale", "bootstrap_authorization",
];
const SIGNAL_KEYS = [
  "routes_or_screens", "acceptance_flows", "expected_changed_files", "expected_mutation_shards",
  "lifecycle_or_concurrency_boundaries", "external_integrations", "schema_or_migration_changes",
  "authorization_or_audit_boundaries", "tooling_change",
];
const PHASE_KEYS = ["readiness", "implementation", "focused_verification", "review", "integration"];
const ESTIMATE_KEYS = [...PHASE_KEYS, "total"];
const BOOTSTRAP_DIGEST = "c9526d8070e749820d83edfba136cd2ec129ea239bb9e94d710d0a2120a16d32";
const BOOTSTRAP_TITLE = "Enforce work readiness and outcome-based partitioning";
const BOOTSTRAP_SOURCE = "docs/superpowers/specs/2026-08-13-work-readiness-and-partitioning-design.md";
const BOOTSTRAP_EVIDENCE = "CHG022-READINESS-V2-APPROVAL";
const BOOTSTRAP_SCOPES = ["policy", "repository-tooling", "generator-guidance"];
const BOOTSTRAP_ESTIMATE = { readiness: 30, implementation: 180, focused_verification: 60, review: 60, integration: 30, total: 360 };
const BOOTSTRAP_AUTHORIZATION = {
  work_id: "CHG-022",
  design_commit: "8743cbb3b8ed57ddba9b1649587439d8d4d8c920",
  plan_commit: "3454e2a09ccdeb39f63f907bbe4fe355b1cb59c3",
  source: BOOTSTRAP_SOURCE,
  expires_on_event: "done",
  allowed_paths: [
    "docs/dev-guide/work-readiness.schema.json",
    "docs/dev-guide/WORK_READINESS.md",
    "docs/readiness/README.md",
    "docs/readiness/CHG-022.json",
    ".nous-feedback.jsonl",
    "scripts/work-readiness/model.mjs",
    "scripts/test-work-readiness.mjs",
    "scripts/work-readiness/git.mjs",
    "scripts/work-readiness.mjs",
    "package.json",
    ".githooks/commit-msg",
    "docs/dev-guide/COMMITS.md",
    "infra/scripts/overrides/CHG-022/16f72c9/manifest.json",
    "infra/scripts/overrides/CHG-022/16f72c9/AGENTS.md",
    "infra/scripts/overrides/CHG-022/16f72c9/CLAUDE.md",
    "infra/scripts/overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md",
    "infra/scripts/reconcile-sprint1-docs.py",
    "infra/scripts/tests/test_reconcile_sprint1_docs.py",
    "AGENTS.md",
    "CLAUDE.md",
    "docs/dev-guide/DEFINITION_OF_DONE.md",
  ],
};

export class WorkReadinessError extends Error {
  constructor(code, message, path = "$") {
    super(message);
    this.name = "WorkReadinessError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  const stableCode = code.startsWith("WR_") ? code : `WR_${code}`;
  throw new WorkReadinessError(stableCode, message, path);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, path, keys) {
  if (!isPlainObject(value)) fail("UNSAFE_OBJECT", path, `${path} must be a plain object`);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail("MISSING_PROPERTY", `${path}.${key}`, `${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail("UNKNOWN_PROPERTY", `${path}.${key}`, `${path}.${key} is not allowed`);
  }
}

function array(value, path, { min = 0 } = {}) {
  if (!Array.isArray(value)) fail("INVALID_TYPE", path, `${path} must be an array`);
  if (value.length < min) fail("MIN_ITEMS", path, `${path} must contain at least ${min} item(s)`);
}

function string(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/\S/u.test(value)) fail("INVALID_STRING", path, `${path} must be a non-empty string`);
}

function integer(value, path, { nullable = false, signed = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isInteger(value) || (!signed && value < 0)) fail("INVALID_INTEGER", path, `${path} must be ${signed ? "an" : "a non-negative"} integer`);
}

function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) fail("INVALID_VALUE", path, `${path} must be one of: ${allowed.join(", ")}`);
}

function uniqueStrings(values, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    string(value, `${path}[${index}]`);
    if (seen.has(value)) fail("DUPLICATE_ID", `${path}[${index}]`, `${path} contains duplicate value ${value}`);
    seen.add(value);
  });
}

function validateWorkId(value, path) {
  string(value, path);
  if (!/^(?:US|CHG)-[0-9]{3,}$/u.test(value)) fail("INVALID_WORK_ID", path, `${path} must be an official US-* or CHG-* identifier`);
}

function validateSignals(value, path) {
  object(value, path, SIGNAL_KEYS);
  for (const key of SIGNAL_KEYS.slice(0, -1)) integer(value[key], `${path}.${key}`);
  if (typeof value.tooling_change !== "boolean") fail("INVALID_TYPE", `${path}.tooling_change`, `${path}.tooling_change must be boolean`);
}

function phaseSum(value) {
  return PHASE_KEYS.reduce((sum, key) => sum + value[key], 0);
}

function validateEstimate(value, path) {
  object(value, path, ESTIMATE_KEYS);
  for (const key of ESTIMATE_KEYS) integer(value[key], `${path}.${key}`);
  if (phaseSum(value) !== value.total) fail("PHASE_TOTAL_MISMATCH", `${path}.total`, `${path}.total must equal the five phase values`);
}

function validateUncertainties(values, path) {
  array(values, path);
  const ids = new Set();
  values.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    object(item, itemPath, ["id", "statement", "status", "estimate_impact_minutes", "resolution"]);
    string(item.id, `${itemPath}.id`);
    if (ids.has(item.id)) fail("DUPLICATE_ID", `${itemPath}.id`, `Duplicate uncertainty id ${item.id}`);
    ids.add(item.id);
    string(item.statement, `${itemPath}.statement`);
    oneOf(item.status, ["resolved", "budgeted", "unresolved"], `${itemPath}.status`);
    integer(item.estimate_impact_minutes, `${itemPath}.estimate_impact_minutes`, { nullable: true });
    string(item.resolution, `${itemPath}.resolution`, { nullable: true });
  });
}

function validateActualsShape(value, path) {
  object(value, path, [
    "phase_minutes", "total", "changed_files", "commits", "review_fix_loops", "cold_mutation_attempts",
    "mutation_invalidations", "estimate_variance_minutes", "root_cause",
  ]);
  object(value.phase_minutes, `${path}.phase_minutes`, PHASE_KEYS);
  for (const key of PHASE_KEYS) integer(value.phase_minutes[key], `${path}.phase_minutes.${key}`, { nullable: true });
  for (const key of ["total", "changed_files", "commits", "review_fix_loops", "cold_mutation_attempts", "mutation_invalidations"]) {
    integer(value[key], `${path}.${key}`, { nullable: true });
  }
  integer(value.estimate_variance_minutes, `${path}.estimate_variance_minutes`, { nullable: true, signed: true });
  string(value.root_cause, `${path}.root_cause`, { nullable: true });
}

function validateShape(value) {
  object(value, "$", TOP_LEVEL_KEYS);
  if (value.schema_version !== 1) fail("UNSUPPORTED_SCHEMA_VERSION", "$.schema_version", "Only schema version 1 is supported");
  if (typeof value.readiness_payload_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.readiness_payload_sha256)) fail("INVALID_SHA256", "$.readiness_payload_sha256", "Root digest must be lowercase SHA-256");
  validateWorkId(value.work_id, "$.work_id");
  oneOf(value.kind, ["US", "CHG"], "$.kind");
  if (!value.work_id.startsWith(`${value.kind}-`)) fail("WORK_KIND_MISMATCH", "$.kind", "kind must match the work_id prefix");
  oneOf(value.work_type, ["functional", "technical", "mixed"], "$.work_type");
  string(value.title, "$.title");
  string(value.source, "$.source");

  array(value.outcomes, "$.outcomes", { min: 1 });
  const outcomeIds = new Set();
  value.outcomes.forEach((item, index) => {
    const path = `$.outcomes[${index}]`;
    object(item, path, ["id", "statement", "demo", "primary"]);
    string(item.id, `${path}.id`);
    if (outcomeIds.has(item.id)) fail("DUPLICATE_ID", `${path}.id`, `Duplicate outcome id ${item.id}`);
    outcomeIds.add(item.id);
    string(item.statement, `${path}.statement`);
    string(item.demo, `${path}.demo`);
    if (typeof item.primary !== "boolean") fail("INVALID_TYPE", `${path}.primary`, `${path}.primary must be boolean`);
  });

  array(value.acceptance_criteria, "$.acceptance_criteria", { min: 1 });
  const acceptanceIds = new Set();
  value.acceptance_criteria.forEach((item, index) => {
    const path = `$.acceptance_criteria[${index}]`;
    object(item, path, ["id", "outcome_ids"]);
    string(item.id, `${path}.id`);
    if (acceptanceIds.has(item.id)) fail("DUPLICATE_ID", `${path}.id`, `Duplicate acceptance criterion id ${item.id}`);
    acceptanceIds.add(item.id);
    array(item.outcome_ids, `${path}.outcome_ids`, { min: 1 });
    uniqueStrings(item.outcome_ids, `${path}.outcome_ids`);
    item.outcome_ids.forEach((id, refIndex) => {
      if (!outcomeIds.has(id)) fail("UNRESOLVED_REFERENCE", `${path}.outcome_ids[${refIndex}]`, `Unknown outcome id ${id}`);
    });
  });

  array(value.scopes, "$.scopes", { min: 1 });
  uniqueStrings(value.scopes, "$.scopes");
  validateSignals(value.signals, "$.signals");
  validateEstimate(value.estimate_minutes, "$.estimate_minutes");
  validateUncertainties(value.uncertainties, "$.uncertainties");

  array(value.dependencies, "$.dependencies");
  const dependencyIds = new Set();
  const dependencyDirections = new Map();
  value.dependencies.forEach((item, index) => {
    const path = `$.dependencies[${index}]`;
    object(item, path, ["work_id", "type", "reason"]);
    validateWorkId(item.work_id, `${path}.work_id`);
    if (item.work_id === value.work_id) fail("DEPENDENCY_CYCLE", `${path}.work_id`, "A work item cannot depend on itself");
    const edge = `${item.type}:${item.work_id}`;
    if (dependencyIds.has(edge)) fail("DUPLICATE_DEPENDENCY", `${path}.work_id`, `Duplicate dependency ${edge}`);
    dependencyIds.add(edge);
    oneOf(item.type, ["blocks", "blocked_by"], `${path}.type`);
    if (dependencyDirections.has(item.work_id) && dependencyDirections.get(item.work_id) !== item.type) {
      fail("DEPENDENCY_CYCLE", `${path}.work_id`, `Contradictory dependency edges with ${item.work_id} form a cycle`);
    }
    dependencyDirections.set(item.work_id, item.type);
    string(item.reason, `${path}.reason`);
  });

  oneOf(value.decision, ["ready", "partition_required", "blocked"], "$.decision");
  array(value.partitions, "$.partitions");
  object(value.approval, "$.approval", ["status", "approved_by", "evidence", "payload_sha256"]);
  oneOf(value.approval.status, ["pending", "approved", "rejected"], "$.approval.status");
  string(value.approval.approved_by, "$.approval.approved_by", { nullable: true });
  string(value.approval.evidence, "$.approval.evidence", { nullable: true });
  if (typeof value.approval.payload_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.approval.payload_sha256)) fail("INVALID_SHA256", "$.approval.payload_sha256", "Approval digest must be lowercase SHA-256");
  if (value.actuals !== null) validateActualsShape(value.actuals, "$.actuals");
  array(value.checkpoints, "$.checkpoints");
  value.checkpoints.forEach((item, index) => {
    const path = `$.checkpoints[${index}]`;
    object(item, path, ["elapsed_minutes", "status", "implementation_complete", "evidence"]);
    integer(item.elapsed_minutes, `${path}.elapsed_minutes`);
    oneOf(item.status, ["on_track", "variance", "partition_required"], `${path}.status`);
    if (typeof item.implementation_complete !== "boolean") fail("INVALID_TYPE", `${path}.implementation_complete`, `${path}.implementation_complete must be boolean`);
    string(item.evidence, `${path}.evidence`);
  });
  if (typeof value.policy_bootstrap !== "boolean") fail("INVALID_TYPE", "$.policy_bootstrap", "policy_bootstrap must be boolean");
  string(value.bootstrap_exemption_rationale, "$.bootstrap_exemption_rationale", { nullable: true });
}

function canonicalize(value, path = "$") {
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (value !== null && typeof value === "object") {
    if (!isPlainObject(value)) fail("UNSAFE_OBJECT", path, `${path} must be a plain object`);
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], `${path}.${key}`)]));
  }
  return value;
}

export function canonicalReadinessPayload(value) {
  if (!isPlainObject(value)) fail("UNSAFE_OBJECT", "$", "Readiness payload must be a plain object");
  const excluded = new Set(["readiness_payload_sha256", "approval", "actuals", "checkpoints"]);
  const payload = Object.fromEntries(Object.keys(value).filter((key) => !excluded.has(key)).map((key) => [key, value[key]]));
  return JSON.stringify(canonicalize(payload));
}

export function computeReadinessPayloadSha256(value) {
  return createHash("sha256").update(canonicalReadinessPayload(value), "utf8").digest("hex");
}

function hardLimitViolation(value) {
  if (value.estimate_minutes.total > 120) return ["WR_ESTIMATE_OVER_BUDGET", "estimate_minutes.total", "Estimate exceeds 120 minutes"];
  if (value.outcomes.filter((outcome) => outcome.primary).length > 1) return ["WR_MULTIPLE_OUTCOMES", "outcomes", "More than one primary outcome requires partitioning"];
  if (value.scopes.length > 3) return ["WR_TOO_MANY_SCOPES", "scopes", "More than three scopes are not cohesive"];
  if (value.signals.routes_or_screens > 2) return ["WR_TOO_MANY_ROUTES", "signals.routes_or_screens", "More than two routes or screens requires partitioning"];
  if (value.signals.acceptance_flows > 3) return ["WR_TOO_MANY_FLOWS", "signals.acceptance_flows", "More than three acceptance flows requires partitioning"];
  if (value.signals.expected_changed_files > 20) return ["WR_TOO_MANY_FILES", "signals.expected_changed_files", "More than twenty expected files requires partitioning"];
  if (value.signals.lifecycle_or_concurrency_boundaries > 1) return ["WR_TOO_MANY_LIFECYCLE_BOUNDARIES", "signals.lifecycle_or_concurrency_boundaries", "More than one lifecycle boundary requires partitioning"];
  if (value.work_type === "mixed") return ["WR_MIXED_FUNCTIONAL_TOOLING", "work_type", "Mixed work must be partitioned"];
  if (value.work_type === "functional" && (value.signals.tooling_change || value.scopes.includes("tooling"))) return ["WR_MIXED_FUNCTIONAL_TOOLING", "signals.tooling_change", "Functional work cannot include tooling changes"];
  return null;
}

function blockingViolation(value) {
  if (value.outcomes.every((outcome) => !outcome.primary)) return ["WR_MISSING_PRIMARY_OUTCOME", "outcomes", "A primary outcome is required"];
  const uncertaintyIndex = value.uncertainties.findIndex((item) => item.status === "unresolved" || item.resolution === null || item.estimate_impact_minutes === null);
  if (uncertaintyIndex >= 0) return ["WR_UNRESOLVED_UNCERTAINTY", `uncertainties[${uncertaintyIndex}]`, "Every uncertainty must be resolved and have an explicit estimate impact"];
  const dependencyIndex = value.dependencies.findIndex((dependency) => dependency.type === "blocked_by");
  if (dependencyIndex >= 0) return ["WR_BLOCKED_DEPENDENCY", `dependencies[${dependencyIndex}]`, "A blocked_by dependency prevents execution"];
  return null;
}

function uncertaintyBlocks(value) {
  return value.uncertainties.some((item) => item.status === "unresolved" || item.resolution === null || item.estimate_impact_minutes === null);
}

export function classifyAssessment(value) {
  validateShape(value);
  if (value.policy_bootstrap) {
    exactBootstrap(value);
    const recomputed = computeReadinessPayloadSha256(value);
    if (value.readiness_payload_sha256 !== recomputed) fail("WR_APPROVAL_DIGEST_MISMATCH", "$.readiness_payload_sha256", "Root readiness digest does not match the canonical payload");
    if (value.approval.payload_sha256 !== value.readiness_payload_sha256) fail("WR_APPROVAL_DIGEST_MISMATCH", "$.approval.payload_sha256", "Approval digest must equal the root readiness digest");
    return "ready";
  }
  if (blockingViolation(value)) return "blocked";
  return hardLimitViolation(value) ? "partition_required" : "ready";
}

function validatePartitionLimits(partition, path) {
  const pseudo = { outcomes: [{ primary: true }], ...partition };
  const violation = hardLimitViolation(pseudo);
  if (violation) fail(violation[0], `${path}.${violation[1]}`, violation[2]);
  if (uncertaintyBlocks(partition)) fail("PARTITION_UNCERTAINTY", `${path}.uncertainties`, "Partition uncertainties must be resolved and budgeted");
  const deliveryScopes = new Set(["contracts", "db", "server", "ui", "infra", "tooling"]);
  if (!partition.scopes.some((scope) => deliveryScopes.has(scope))) fail("WR_VERTICAL_SLICE_INCOMPLETE", `${path}.scopes`, "A child must include an implementation or delivery scope");
  if (partition.estimate_minutes.implementation === 0) fail("WR_VERTICAL_SLICE_INCOMPLETE", `${path}.estimate_minutes.implementation`, "A child must budget implementation work");
  if (partition.estimate_minutes.focused_verification === 0) fail("WR_VERTICAL_SLICE_INCOMPLETE", `${path}.estimate_minutes.focused_verification`, "A child must budget focused verification");
}

export function validatePartitionGraph(value) {
  if (!isPlainObject(value)) fail("UNSAFE_OBJECT", "$", "Assessment must be a plain object");
  if (!Array.isArray(value.partitions)) fail("INVALID_TYPE", "$.partitions", "partitions must be an array");
  if (value.partitions.length === 0) return { executableWorkIds: [] };
  const acceptanceIds = new Set((value.acceptance_criteria ?? []).map((item) => item.id));
  const keys = new Map();
  const workIds = new Map();

  value.partitions.forEach((partition, index) => {
    const path = `$.partitions[${index}]`;
    object(partition, path, [
      "proposal_key", "work_id", "title", "outcome", "demo", "acceptance_criteria", "work_type", "scopes",
      "signals", "uncertainties", "estimate_minutes", "depends_on", "cross_cutting_rationale",
    ]);
    string(partition.proposal_key, `${path}.proposal_key`);
    if (keys.has(partition.proposal_key)) fail("WR_DUPLICATE_CHILD", `${path}.proposal_key`, `Duplicate proposal key ${partition.proposal_key}`);
    keys.set(partition.proposal_key, index);
    if (partition.work_id !== null) {
      validateWorkId(partition.work_id, `${path}.work_id`);
      if (workIds.has(partition.work_id)) fail("WR_DUPLICATE_CHILD", `${path}.work_id`, `Duplicate child work id ${partition.work_id}`);
      workIds.set(partition.work_id, index);
    } else if (value.decision === "ready") {
      fail("WR_UNOFFICIAL_CHILD_ID", `${path}.work_id`, "Executable child proposals require official work IDs");
    }
    string(partition.title, `${path}.title`);
    string(partition.outcome, `${path}.outcome`);
    string(partition.demo, `${path}.demo`);
    array(partition.acceptance_criteria, `${path}.acceptance_criteria`, { min: 1 });
    uniqueStrings(partition.acceptance_criteria, `${path}.acceptance_criteria`);
    partition.acceptance_criteria.forEach((id, refIndex) => {
      if (!acceptanceIds.has(id)) fail("UNRESOLVED_REFERENCE", `${path}.acceptance_criteria[${refIndex}]`, `Unknown acceptance criterion ${id}`);
    });
    oneOf(partition.work_type, ["functional", "technical"], `${path}.work_type`);
    array(partition.scopes, `${path}.scopes`, { min: 1 });
    uniqueStrings(partition.scopes, `${path}.scopes`);
    validateSignals(partition.signals, `${path}.signals`);
    validateUncertainties(partition.uncertainties, `${path}.uncertainties`);
    validateEstimate(partition.estimate_minutes, `${path}.estimate_minutes`);
    array(partition.depends_on, `${path}.depends_on`);
    uniqueStrings(partition.depends_on, `${path}.depends_on`);
    string(partition.cross_cutting_rationale, `${path}.cross_cutting_rationale`, { nullable: true });
    validatePartitionLimits(partition, path);
  });

  const coverage = new Map([...acceptanceIds].map((id) => [id, []]));
  value.partitions.forEach((partition, index) => {
    partition.acceptance_criteria.forEach((id) => coverage.get(id).push(index));
    partition.depends_on.forEach((key, dependencyIndex) => {
      if (!keys.has(key)) fail("UNRESOLVED_REFERENCE", `$.partitions[${index}].depends_on[${dependencyIndex}]`, `Unknown proposal key ${key}`);
      if (key === partition.proposal_key) fail("DEPENDENCY_CYCLE", "$.partitions", "Partition dependency graph contains a cycle");
    });
  });
  for (const [id, indexes] of coverage) {
    if (indexes.length === 0) {
      const parentIndex = value.acceptance_criteria.findIndex((item) => item.id === id);
      fail("WR_ORPHAN_AC", `$.acceptance_criteria[${parentIndex}].id`, `Acceptance criterion ${id} is not assigned`);
    }
  }
  for (const [id, indexes] of coverage) {
    if (indexes.length > 1) {
      for (const index of indexes) {
        if (value.partitions[index].cross_cutting_rationale === null) fail("CROSS_CUTTING_RATIONALE_REQUIRED", `$.partitions[${index}].cross_cutting_rationale`, `Duplicate coverage of ${id} requires rationale on every affected partition`);
      }
    }
  }

  const state = new Map();
  const visit = (key) => {
    if (state.get(key) === "visiting") fail("DEPENDENCY_CYCLE", "$.partitions", "Partition dependency graph contains a cycle");
    if (state.get(key) === "done") return;
    state.set(key, "visiting");
    const partition = value.partitions[keys.get(key)];
    partition.depends_on.forEach(visit);
    state.set(key, "done");
  };
  for (const key of keys.keys()) visit(key);
  return { executableWorkIds: [...workIds.keys()] };
}

function exactBootstrap(value) {
  const checks = [
    [value.work_id === "CHG-022", "$.work_id"],
    [value.kind === "CHG", "$.kind"],
    [value.work_type === "technical", "$.work_type"],
    [value.title === BOOTSTRAP_TITLE, "$.title"],
    [value.source === BOOTSTRAP_SOURCE, "$.source"],
    [deepSemanticEqual(value.scopes, BOOTSTRAP_SCOPES), "$.scopes"],
    [deepSemanticEqual(value.estimate_minutes, BOOTSTRAP_ESTIMATE), "$.estimate_minutes"],
    [value.decision === "ready", "$.decision"],
    [value.readiness_payload_sha256 === BOOTSTRAP_DIGEST, "$.readiness_payload_sha256"],
    [value.approval?.status === "approved", "$.approval.status"],
    [value.approval?.evidence === BOOTSTRAP_EVIDENCE, "$.approval.evidence"],
    [value.approval?.payload_sha256 === BOOTSTRAP_DIGEST, "$.approval.payload_sha256"],
    [typeof value.bootstrap_exemption_rationale === "string" && /\S/u.test(value.bootstrap_exemption_rationale), "$.bootstrap_exemption_rationale"],
  ];
  for (const [valid, path] of checks) if (!valid) fail("INVALID_BOOTSTRAP", path, "CHG-022 bootstrap does not match its committed authorization");
  if (!isPlainObject(value.bootstrap_authorization)) fail("INVALID_BOOTSTRAP", "$.bootstrap_authorization", "Bootstrap authorization is required");
  for (const key of Object.keys(BOOTSTRAP_AUTHORIZATION)) {
    if (!deepSemanticEqual(value.bootstrap_authorization[key], BOOTSTRAP_AUTHORIZATION[key])) fail("INVALID_BOOTSTRAP", `$.bootstrap_authorization.${key}`, `Bootstrap ${key} differs from the committed authorization`);
  }
  object(value.bootstrap_authorization, "$.bootstrap_authorization", Object.keys(BOOTSTRAP_AUTHORIZATION));
}

function deepSemanticEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function feedbackArray(records) {
  if (!Array.isArray(records)) fail("INVALID_TYPE", "$feedback", "feedbackRecords must be an array");
  records.forEach((record, index) => {
    if (!isPlainObject(record)) fail("UNSAFE_OBJECT", `$feedback[${index}]`, "Feedback records must be plain objects");
  });
}

function readinessTokens(text) {
  if (typeof text !== "string") return { decisions: [], digests: [] };
  return {
    decisions: [...text.matchAll(/Decision (ready|partition_required|blocked)\b/gu)].map((match) => match[1]),
    digests: [...text.matchAll(/SHA-256 ([0-9a-f]{64})\b/gu)].map((match) => match[1]),
  };
}

function validateDecisionRecordShape(record) {
  const keys = ["story", "event", "id", "text", "reason"];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", "Approval decisions must use the closed feedback decision shape");
  }
  for (const key of ["story", "id", "text", "reason"]) {
    if (typeof record[key] !== "string" || !/\S/u.test(record[key])) fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", `Prior decision ${key} must be non-empty`);
  }
  if (record.event !== "decision") fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", "Prior approval evidence must be a decision event");
}

function validatePriorDecisionRecord(record, seenIds) {
  validateDecisionRecordShape(record);
  if (seenIds.has(record.id)) fail("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", `Duplicate prior decision evidence id ${record.id}`);
  seenIds.add(record.id);
  const tokens = readinessTokens(record.text);
  const readinessLike = /\bDecision\s+(?:ready|partition_required|blocked)\b/iu.test(record.text) || /SHA-256\b/iu.test(record.text);
  if (readinessLike && (tokens.decisions.length !== 1 || tokens.digests.length !== 1)) {
    fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", "Readiness decisions must contain exactly one canonical Decision token and one SHA-256 token");
  }
  return tokens;
}

const NON_EXECUTION_EVENTS = new Set(["feedback"]);
const REVOCATION_EVENTS = new Set(["blocked", "blocker"]);
const IMPLEMENTATION_EVIDENCE_EVENTS = new Set([
  "started", "ac_pass", "ac_verify", "verified", "deviation", "ac_fail", "ac_unverifiable", "test_report",
  "build_pass", "nav_gap", "evidence_superseded", "revalidated", "mutation_invalidation", "closed_with_deferrals",
  "adversarial_review", "deferred_memory_saved", "closure_hygiene", "implemented_with_external_verification",
]);

function isRawTerminalEvent(event) {
  return event === "done" || (typeof event === "string" && /^done_with_[a-z0-9_]+$/u.test(event));
}

function isProjectableEvent(event) {
  return event === "build_pass" || event === "ac_verify" || isRawTerminalEvent(event);
}

function buildTerminalProjection(records, workId) {
  const terminalIndices = new Set();
  const omittedIndices = new Set();
  records.forEach((record, index) => {
    if (record.story === workId && isRawTerminalEvent(record.event)) terminalIndices.add(index);
  });
  const projectableRevalidations = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.story === workId && record.event === "revalidated" && isProjectableEvent(record.as_event));
  const handledRevalidationIndices = new Set();
  const supersededEvidenceIndices = new Set();
  const lineages = new Map();
  const supersessions = records.map((record, index) => ({ record, index }))
    .filter(({ record }) => record.story === workId && record.event === "evidence_superseded");
  for (const { record: supersession, index: supersessionIndex } of supersessions) {
    const supersessionKeys = ["event", "reason", "ref", "story", "target"];
    const targetKeys = isPlainObject(supersession.target) ? Object.keys(supersession.target).sort() : [];
    const referenceTarget = targetKeys.join(",") === "ref" && typeof supersession.target.ref === "string" && /\S/u.test(supersession.target.ref);
    const directTargetKeys = supersession.target?.event === "ac_verify" ? "ac,event,story" : "event,story";
    const directProjectableTarget = targetKeys.join(",") === directTargetKeys && isProjectableEvent(supersession.target?.event);
    const matchingRevalidations = records.map((record, index) => ({ record, index }))
      .filter(({ record }) => record.event === "revalidated" && record.ref === supersession.ref);
    const projectableReplacement = matchingRevalidations.some(({ record }) => isProjectableEvent(record.as_event));
    if (!referenceTarget && !directProjectableTarget && !projectableReplacement) continue;
    const canonicalSupersession = Object.keys(supersession).sort().join(",") === supersessionKeys.join(",")
      && [supersession.story, supersession.ref, supersession.reason].every((value) => typeof value === "string" && /\S/u.test(value))
      && (referenceTarget || (directProjectableTarget && supersession.target.story === supersession.story
        && (supersession.target.event !== "ac_verify" || Number.isInteger(supersession.target.ac))));
    const globalSupersessionCount = records.filter((candidate) => candidate.event === "evidence_superseded" && candidate.ref === supersession.ref).length;
    if (!canonicalSupersession || lineages.has(supersession.ref) || globalSupersessionCount !== 1) {
      fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Terminal supersession must use one unique canonical record");
    }
    let targetEvent;
    let targetEvidenceIndex;
    let targetAc;
    let terminalLineage;
    if (referenceTarget) {
      const previous = lineages.get(supersession.target.ref);
      if (!previous || previous.replacementIndex >= supersessionIndex || !previous.active) {
        fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Terminal supersession ref must name one earlier active revalidation");
      }
      targetEvent = previous.event;
      targetEvidenceIndex = previous.replacementIndex;
      targetAc = previous.ac;
      terminalLineage = previous.terminal;
      previous.active = false;
    } else {
      const targets = records.map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate, index }) => index < supersessionIndex
          && candidate.story === supersession.target.story && candidate.event === supersession.target.event
          && (supersession.target.event !== "ac_verify" || candidate.ac === supersession.target.ac));
      if (targets.length !== 1) fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Terminal supersession must identify one unique raw target");
      targetEvent = supersession.target.event;
      targetEvidenceIndex = targets[0].index;
      targetAc = supersession.target.ac;
      terminalLineage = isRawTerminalEvent(targetEvent);
    }
    if (supersededEvidenceIndices.has(targetEvidenceIndex)) {
      fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Terminal supersession must identify one unique unsuperseded raw target");
    }
    if (matchingRevalidations.length !== 1 || matchingRevalidations[0].index <= supersessionIndex) {
      fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Terminal supersession requires exactly one later revalidated replacement");
    }
    const { record: replacement, index: replacementIndex } = matchingRevalidations[0];
    const revalidationKeys = targetEvent === "build_pass"
      ? ["as_event", "change", "event", "notes", "ref", "story"]
      : targetEvent === "ac_verify"
        ? ["ac", "as_event", "change", "event", "method", "notes", "pass", "ref", "story"]
        : ["as_event", "change", "event", "ref", "story"];
    const replacementEvidenceValid = targetEvent === "build_pass"
      ? typeof replacement.notes === "string"
      : targetEvent === "ac_verify"
        ? replacement.ac === targetAc && typeof replacement.method === "string" && typeof replacement.pass === "boolean" && typeof replacement.notes === "string"
        : true;
    const canonicalReplacement = isProjectableEvent(replacement.as_event)
      && Object.keys(replacement).sort().join(",") === revalidationKeys.join(",")
      && [replacement.story, replacement.ref, replacement.change, replacement.as_event].every((value) => typeof value === "string" && /\S/u.test(value))
      && replacement.story === supersession.story
      && replacement.as_event === targetEvent
      && replacementEvidenceValid;
    const changeDecisions = records.filter((candidate, index) => index < replacementIndex
      && candidate.event === "decision" && candidate.story === replacement.change);
    if (changeDecisions.length === 0) fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Projected terminal requires a change decision before its replacement");
    const changeDecisionIds = new Set();
    changeDecisions.forEach((decision) => validatePriorDecisionRecord(decision, changeDecisionIds));
    if (!canonicalReplacement) {
      fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Projected terminal must match its target and an earlier change decision");
    }
    supersededEvidenceIndices.add(targetEvidenceIndex);
    handledRevalidationIndices.add(replacementIndex);
    if (terminalLineage) {
      terminalIndices.delete(targetEvidenceIndex);
      terminalIndices.add(replacementIndex);
    }
    omittedIndices.add(targetEvidenceIndex);
    omittedIndices.add(supersessionIndex);
    lineages.set(supersession.ref, { event: targetEvent, ac: targetAc, terminal: terminalLineage, replacementIndex, active: true });
  }
  if (projectableRevalidations.some(({ index }) => !handledRevalidationIndices.has(index))) {
    fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Projectable revalidation is orphaned or duplicated");
  }
  return { terminalIndices, omittedIndices };
}

function isKnownFeedbackEvent(event) {
  return event === "decision" || event === "checkpoint" || NON_EXECUTION_EVENTS.has(event)
    || REVOCATION_EVENTS.has(event) || IMPLEMENTATION_EVIDENCE_EVENTS.has(event) || isRawTerminalEvent(event);
}

function validatePreapprovalHistory(value, feedbackRecords, evidenceIndex, terminalProjection) {
  let authorized = false;
  let everAuthorized = false;
  let bootstrapStarts = 0;
  const seenDecisionIds = new Set();
  for (let index = 0; index < evidenceIndex; index += 1) {
    if (terminalProjection.omittedIndices.has(index)) continue;
    const record = feedbackRecords[index];
    if (record.story !== value.work_id) continue;
    if (record.event === "decision") {
      const { decisions, digests } = validatePriorDecisionRecord(record, seenDecisionIds);
      if (decisions.length === 1 && ["blocked", "partition_required"].includes(decisions[0])) authorized = false;
      if (decisions.length === 1 && decisions[0] === "ready" && digests.length === 1) {
        const globalOccurrences = feedbackRecords.filter((candidate) => candidate.event === "decision" && candidate.id === record.id).length;
        if (globalOccurrences !== 1) fail("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", `Prior approval evidence id ${record.id} must be globally unique`);
        if (!value.policy_bootstrap) authorized = true;
        everAuthorized = true;
      }
      continue;
    }
    if (NON_EXECUTION_EVENTS.has(record.event)) continue;
    if (REVOCATION_EVENTS.has(record.event)) {
      authorized = false;
      continue;
    }
    if (value.policy_bootstrap && record.event === "started") {
      bootstrapStarts += 1;
      const exactHistoricalStart = Object.keys(record).length === 3
        && record.story === "CHG-022"
        && record.event === "started"
        && record.agent === "codex/work-readiness-gate";
      if (exactHistoricalStart && everAuthorized) fail("WR_APPROVAL_ORDER", "$.approval.evidence", "The CHG-022 historical start exception cannot be replayed after authorization");
      if (exactHistoricalStart && bootstrapStarts === 1 && !everAuthorized) continue;
    }
    if (!authorized) fail("WR_APPROVAL_ORDER", "$.approval.evidence", "Implementation evidence occurs outside a digest-bound readiness authorization interval");
    if (record.event === "checkpoint") {
      if (["blocked", "partition_required"].includes(record.status)) authorized = false;
      else if (!["on_track", "variance"].includes(record.status)) fail("WR_APPROVAL_ORDER", "$.approval.evidence", "Unknown checkpoint status cannot preserve readiness authorization");
      continue;
    }
    if (terminalProjection.terminalIndices.has(index)) authorized = false;
  }
}

export function validateApproval(value, feedbackRecords) {
  feedbackArray(feedbackRecords);
  const terminalProjection = buildTerminalProjection(feedbackRecords, value.work_id);
  const unknownEvent = feedbackRecords.find((record) => record.story === value.work_id && !isKnownFeedbackEvent(record.event));
  if (unknownEvent) fail("WR_APPROVAL_EVENT_UNKNOWN", "$.approval.evidence", `Unknown feedback event ${String(unknownEvent.event)}`);
  const recomputed = computeReadinessPayloadSha256(value);
  if (value.readiness_payload_sha256 !== recomputed) fail("WR_APPROVAL_DIGEST_MISMATCH", "$.readiness_payload_sha256", "Root readiness digest does not match the canonical payload");
  if (value.approval.payload_sha256 !== value.readiness_payload_sha256) fail("WR_APPROVAL_DIGEST_MISMATCH", "$.approval.payload_sha256", "Approval digest must equal the root readiness digest");
  if (value.approval.status !== "approved") fail("APPROVAL_REQUIRED", "$.approval.status", "The declared decision requires approved evidence");
  string(value.approval.evidence, "$.approval.evidence");
  const candidates = feedbackRecords.filter((record) => record.event === "decision" && record.id === value.approval.evidence);
  if (candidates.length === 0) fail("APPROVAL_EVIDENCE_MISSING", "$.approval.evidence", "No matching decision event exists");
  if (candidates.length !== 1) fail("APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", "Approval evidence must identify exactly one decision event");
  const evidence = candidates[0];
  const evidenceIndex = feedbackRecords.indexOf(evidence);
  validateDecisionRecordShape(evidence);
  if (evidence.story !== value.work_id) fail("APPROVAL_STORY_MISMATCH", "$.approval.evidence", "Decision evidence belongs to another work item");
  validatePreapprovalHistory(value, feedbackRecords, evidenceIndex, terminalProjection);
  const { decisions, digests } = readinessTokens(evidence.text);
  if (decisions.length !== 1 || decisions[0] !== value.decision || digests.length !== 1 || digests[0] !== value.readiness_payload_sha256) {
    fail("APPROVAL_DECISION_MISMATCH", "$.approval.evidence", "Decision evidence must bind the declared decision and exact digest");
  }
  if (value.policy_bootstrap) {
    if (value.approval.evidence !== BOOTSTRAP_EVIDENCE) fail("BOOTSTRAP_APPROVAL_REPLAY", "$.approval.evidence", "Only the CHG-022 V2 approval can authorize this bootstrap");
    const authorization = value.bootstrap_authorization;
    const orderedPaths = `Exact authorized paths, in order: ${authorization.allowed_paths.join("; ")}.`;
    const bindings = [
      authorization.design_commit,
      authorization.plan_commit,
      orderedPaths,
      "interval begins at this matching decision",
      "expires on CHG-022's first valid terminal done event",
    ];
    if (!bindings.every((binding) => evidence.text.includes(binding))) fail("BOOTSTRAP_APPROVAL_BINDING", "$.approval.evidence", "Bootstrap decision must bind provenance, ordered paths, and expiry");
  }
  if (value.decision === "partition_required") {
    const childIds = value.partitions.map((partition) => partition.work_id).filter((workId) => workId !== null);
    const allowedIds = new Set([value.work_id, ...childIds]);
    const mentionedIds = evidence.text.match(/(?<![A-Z0-9-])(?:US|CHG)-[0-9]{3,}(?![A-Z0-9-])/gu) ?? [];
    if (mentionedIds.some((workId) => !allowedIds.has(workId))) fail("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", "Approval decision contains an undeclared official work ID");
    for (const childId of childIds) {
      if (mentionedIds.filter((workId) => workId === childId).length !== 1) fail("WR_APPROVAL_CHILD_BINDING", "$.approval.evidence", `Approval decision must bind official child ${childId} exactly once`);
    }
  }
  return { evidence: value.approval.evidence, payloadSha256: recomputed };
}

function approvalIndex(records, value) {
  return records.findIndex((record) => record.story === value.work_id && record.event === "decision" && record.id === value.approval?.evidence);
}

function terminalDoneIndex(records, value, terminalProjection = buildTerminalProjection(records, value.work_id)) {
  const afterIndex = value.policy_bootstrap ? approvalIndex(records, value) : -1;
  return records.findIndex((record, index) => index > afterIndex && record.story === value.work_id && terminalProjection.terminalIndices.has(index));
}

export function validateCompletionActuals(value, feedbackRecords) {
  feedbackArray(feedbackRecords);
  const terminalProjection = buildTerminalProjection(feedbackRecords, value.work_id);
  const doneIndex = terminalDoneIndex(feedbackRecords, value, terminalProjection);
  if (doneIndex < 0) return { complete: false };
  if (value.actuals === null || value.actuals === undefined) fail("ACTUALS_REQUIRED", "$.actuals", "Terminal done requires completion actuals");
  validateActualsShape(value.actuals, "$.actuals");
  for (const key of PHASE_KEYS) {
    if (value.actuals.phase_minutes[key] === null) fail("ACTUALS_INCOMPLETE", `$.actuals.phase_minutes.${key}`, "All actual phase minutes are required at done");
  }
  for (const key of ["total", "changed_files", "commits", "review_fix_loops", "cold_mutation_attempts", "mutation_invalidations", "estimate_variance_minutes", "root_cause"]) {
    if (value.actuals[key] === null) fail("ACTUALS_INCOMPLETE", `$.actuals.${key}`, `actuals.${key} is required at done`);
  }
  const total = phaseSum(value.actuals.phase_minutes);
  if (value.actuals.total !== total) fail("ACTUALS_TOTAL_MISMATCH", "$.actuals.total", "Actual total must equal the five actual phase values");
  const variance = total - value.estimate_minutes.total;
  if (value.actuals.estimate_variance_minutes !== variance) fail("ACTUALS_VARIANCE_MISMATCH", "$.actuals.estimate_variance_minutes", "Estimate variance must equal actual total minus estimated total");
  const attempts = value.actuals.cold_mutation_attempts;
  const expectedInvalidations = Math.max(0, attempts - 1);
  if (value.actuals.mutation_invalidations !== expectedInvalidations) fail("MUTATION_INVALIDATION_COUNT", "$.actuals.mutation_invalidations", "Mutation invalidations must equal cold attempts minus one");
  if (attempts > 1) {
    const evidence = feedbackRecords.slice(0, doneIndex).filter((record) => record.story === value.work_id && record.event === "mutation_invalidation" && typeof record.reason === "string" && /\S/u.test(record.reason));
    if (evidence.length !== value.actuals.mutation_invalidations) fail("MUTATION_INVALIDATION_EVIDENCE", "$.actuals.mutation_invalidations", "Each mutation invalidation requires one non-empty reason event");
  }
  return { complete: true, total, variance };
}

export function validateAssessment(value, { feedbackRecords = [] } = {}) {
  validateShape(value);
  if (value.policy_bootstrap) {
    exactBootstrap(value);
  } else {
    if (value.bootstrap_exemption_rationale !== null) fail("INVALID_BOOTSTRAP", "$.bootstrap_exemption_rationale", "Normal work cannot claim a bootstrap exemption");
    if (value.bootstrap_authorization !== null) fail("INVALID_BOOTSTRAP", "$.bootstrap_authorization", "Normal work cannot carry bootstrap authorization");
  }
  validatePartitionGraph(value);
  const computedDecision = value.policy_bootstrap ? "ready" : classifyAssessment(value);
  if (computedDecision !== value.decision) {
    const violation = computedDecision === "blocked" ? blockingViolation(value) : hardLimitViolation(value);
    if (value.decision === "ready" && violation) fail(violation[0], `$.${violation[1]}`, violation[2]);
    fail("DECISION_MISMATCH", "$.decision", `Declared decision ${value.decision} does not match recomputed decision ${computedDecision}`);
  }
  if (value.decision === "ready" && value.partitions.length !== 0) fail("PARTITIONS_NOT_ALLOWED", "$.partitions", "Ready normal work cannot contain partitions");
  if (value.decision === "partition_required" && value.partitions.length === 0) fail("PARTITIONS_REQUIRED", "$.partitions", "Partition-required work must propose at least one child");
  validateApproval(value, feedbackRecords);
  if (value.policy_bootstrap && terminalDoneIndex(feedbackRecords, value) >= 0) fail("BOOTSTRAP_EXPIRED", "$.bootstrap_authorization.expires_on_event", "The one-time CHG-022 bootstrap expired at its first done event after V2 approval");
  validateCompletionActuals(value, feedbackRecords);
  return { decision: computedDecision };
}
