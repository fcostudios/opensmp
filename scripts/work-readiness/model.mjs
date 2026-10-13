import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const TOP_LEVEL_KEYS = [
  "schema_version", "readiness_payload_sha256", "work_id", "kind", "work_type", "title", "source",
  "outcomes", "acceptance_criteria", "scopes", "signals", "estimate_minutes", "uncertainties",
  "dependencies", "decision", "partitions", "approval", "actuals", "policy_bootstrap",
  "bootstrap_exemption_rationale", "bootstrap_authorization",
];
const SIGNAL_KEYS = [
  "routes_or_screens", "acceptance_flows", "expected_changed_files", "expected_mutation_shards",
  "lifecycle_or_concurrency_boundaries", "external_integrations", "schema_or_migration_changes",
  "authorization_or_audit_boundaries", "tooling_change",
];
// CHG-035 — the execution budget, in ONE place.
//
// 320, not the original 120. The 120 came from a single incident (one 11-hour,
// 57-file, 47-commit story) and was never calibrated against the story-point
// scale the design phase actually sizes in. IMP-374 measured that scale on this
// project: 104 min/SP, the SLOWEST of the two observed rates. At 104, the modal
// 3SP story projects to 312 minutes, so a 120-minute ceiling partitioned
// essentially every remaining story for budget reasons alone — 30 of 30
// unstarted. At 320 it is 2 of 30, both genuine 5SP outliers.
//
// Provisional, and deliberately so: the two calibration pairs are ESTIMATES, and
// docs/readiness/README.md records estimates running two to three times under
// actuals. Once actuals.total exists on two items the recalibrator can be pointed
// at them and this becomes a one-line diff.
//
// Both schema `maximum` values must equal this; a test asserts it, because a
// constant the schema does not track is two sources of truth again.
export const MAX_READINESS_MINUTES = 320;

const PHASE_KEYS = ["readiness", "implementation", "focused_verification", "review", "integration"];
const ESTIMATE_KEYS = [...PHASE_KEYS, "total"];
const DELIVERED_VOCABULARY = JSON.parse(readFileSync(
  new URL("../../docs/dev-guide/feedback-vocabulary.json", import.meta.url),
  "utf8",
));
const ACTUALS_CORRECTED_SCHEMA = DELIVERED_VOCABULARY.event_schemas.actuals_corrected;
// CHG-062: event names Nous delivers as canonical (e.g. the DoD's `phase`
// marker). The gate treats any of them it has no specific rule for as a known,
// non-execution annotation; an event in neither set stays unknown.
export const DELIVERED_CANONICAL_EVENTS = new Set(Object.keys(DELIVERED_VOCABULARY.canonical ?? {}));
export const DELIVERED_LOCAL_EVENTS = new Set(DELIVERED_VOCABULARY.local ?? []);
export const DELIVERED_ANNOTATION_EVENTS = new Set([
  ...Object.entries(DELIVERED_VOCABULARY.canonical ?? {})
    .filter(([, category]) => category === "annotation").map(([event]) => event),
  ...DELIVERED_LOCAL_EVENTS,
]);
const EXPLICIT_UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/u;
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

function object(value, path, keys, { optional = [] } = {}) {
  if (!isPlainObject(value)) fail("WR_UNSAFE_OBJECT", path, `${path} must be a plain object`);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail("WR_MISSING_PROPERTY", `${path}.${key}`, `${path}.${key} is required`);
  }
  // CHG-037: `optional` keys are ACCEPTED but not required — the shape stays closed
  // (an unlisted key is still refused), it simply tolerates a field history recorded
  // and new artifacts no longer emit.
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optional.includes(key)) fail("WR_UNKNOWN_PROPERTY", `${path}.${key}`, `${path}.${key} is not allowed`);
  }
}

function array(value, path, { min = 0 } = {}) {
  if (!Array.isArray(value)) fail("WR_INVALID_TYPE", path, `${path} must be an array`);
  if (value.length < min) fail("WR_MIN_ITEMS", path, `${path} must contain at least ${min} item(s)`);
}

function string(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/\S/u.test(value)) fail("WR_INVALID_STRING", path, `${path} must be a non-empty string`);
}

function integer(value, path, { nullable = false, signed = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isInteger(value) || (!signed && value < 0)) fail("WR_INVALID_INTEGER", path, `${path} must be ${signed ? "an" : "a non-negative"} integer`);
}

function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) fail("WR_INVALID_VALUE", path, `${path} must be one of: ${allowed.join(", ")}`);
}

function uniqueStrings(values, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    string(value, `${path}[${index}]`);
    if (seen.has(value)) fail("WR_DUPLICATE_ID", `${path}[${index}]`, `${path} contains duplicate value ${value}`);
    seen.add(value);
  });
}

function validateWorkId(value, path) {
  string(value, path);
  if (!/^(?:US|CHG)-[0-9]{3,}$/u.test(value)) fail("WR_INVALID_WORK_ID", path, `${path} must be an official US-* or CHG-* identifier`);
}

function validateSignals(value, path) {
  object(value, path, SIGNAL_KEYS, { optional: ["bookkeeping_files"] });
  if (Object.hasOwn(value, "bookkeeping_files")) integer(value.bookkeeping_files, `${path}.bookkeeping_files`);
  for (const key of SIGNAL_KEYS.slice(0, -1)) integer(value[key], `${path}.${key}`);
  if (typeof value.tooling_change !== "boolean") fail("WR_INVALID_TYPE", `${path}.tooling_change`, `${path}.tooling_change must be boolean`);
}

function phaseSum(value) {
  return PHASE_KEYS.reduce((sum, key) => sum + value[key], 0);
}

function validateEstimate(value, path) {
  object(value, path, ESTIMATE_KEYS);
  for (const key of ESTIMATE_KEYS) integer(value[key], `${path}.${key}`);
  if (phaseSum(value) !== value.total) fail("WR_PHASE_TOTAL_MISMATCH", `${path}.total`, `${path}.total must equal the five phase values`);
}

function validateUncertainties(values, path) {
  array(values, path);
  const ids = new Set();
  values.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    object(item, itemPath, ["id", "statement", "status", "estimate_impact_minutes", "resolution"]);
    string(item.id, `${itemPath}.id`);
    if (ids.has(item.id)) fail("WR_DUPLICATE_ID", `${itemPath}.id`, `Duplicate uncertainty id ${item.id}`);
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
  ], { optional: ["mutation_minutes", "mutation_shards_actual", "preview_rounds", "preview_minutes"] });
  object(value.phase_minutes, `${path}.phase_minutes`, PHASE_KEYS);
  for (const key of PHASE_KEYS) integer(value.phase_minutes[key], `${path}.phase_minutes.${key}`, { nullable: true });
  for (const key of ["total", "changed_files", "commits", "review_fix_loops", "cold_mutation_attempts", "mutation_invalidations"]) {
    integer(value[key], `${path}.${key}`, { nullable: true });
  }
  if (Object.hasOwn(value, "mutation_minutes")) {
    integer(value.mutation_minutes, `${path}.mutation_minutes`);
  }
  if (Object.hasOwn(value, "mutation_shards_actual")) {
    integer(value.mutation_shards_actual, `${path}.mutation_shards_actual`);
  }
  for (const key of ["preview_rounds", "preview_minutes"]) {
    if (Object.hasOwn(value, key)) integer(value[key], `${path}.${key}`);
  }
  integer(value.estimate_variance_minutes, `${path}.estimate_variance_minutes`, { nullable: true, signed: true });
  string(value.root_cause, `${path}.root_cause`, { nullable: true });
}

export function validateOwnedScopeShape(value) {
  const path = "$.mutation_scope";
  object(value, path, ["version", "subject_work_id", "subject_readiness_sha256", "scope_base", "scope_head", "sources"]);
  if (value.version !== 1) fail("WR_INVALID_VALUE", `${path}.version`, "Owned scope version must be 1");
  validateWorkId(value.subject_work_id, `${path}.subject_work_id`);
  for (const [key, length] of [["subject_readiness_sha256", 64], ["scope_base", 40], ["scope_head", 40]]) {
    if (typeof value[key] !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value[key])) fail("WR_INVALID_VALUE", `${path}.${key}`, "Owned scope requires a full lowercase digest");
  }
  array(value.sources, `${path}.sources`, { min: 1 });
  let previous = null;
  value.sources.forEach((source, index) => {
    const sourcePath = `${path}.sources[${index}]`;
    object(source, sourcePath, ["path", "head_blob"]);
    if (typeof source.path !== "string" || source.path.length === 0 || /[\u0000-\u001f\u007f\ufffd\\:]/u.test(source.path)
      || source.path.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
      fail("WR_INVALID_VALUE", `${sourcePath}.path`, "Owned source must be a canonical repository-relative POSIX path");
    }
    if (previous !== null && previous >= source.path) fail("WR_INVALID_VALUE", `${sourcePath}.path`, "Owned sources must be sorted and unique");
    previous = source.path;
    if (typeof source.head_blob !== "string" || !/^[0-9a-f]{40}$/u.test(source.head_blob)) fail("WR_INVALID_VALUE", `${sourcePath}.head_blob`, "Owned source requires a full lowercase blob digest");
  });
  return value;
}

function validateShape(value) {
  // CHG-037 §3: `checkpoints` is OPTIONAL — dropped from new artifacts, tolerated
  // where history already recorded it. Listing it keeps `object()`'s closed-key
  // check from rejecting the artifacts that still carry it.
  object(value, "$",
    value.policy_bootstrap === true ? TOP_LEVEL_KEYS : [...TOP_LEVEL_KEYS, "controlling_change"],
    { optional: ["checkpoints", "mutation_scope"] });
  if (value.schema_version !== 1) fail("WR_UNSUPPORTED_SCHEMA_VERSION", "$.schema_version", "Only schema version 1 is supported");
  if (typeof value.readiness_payload_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.readiness_payload_sha256)) fail("WR_INVALID_SHA256", "$.readiness_payload_sha256", "Root digest must be lowercase SHA-256");
  validateWorkId(value.work_id, "$.work_id");
  oneOf(value.kind, ["US", "CHG"], "$.kind");
  if (!value.work_id.startsWith(`${value.kind}-`)) fail("WR_WORK_KIND_MISMATCH", "$.kind", "kind must match the work_id prefix");
  oneOf(value.work_type, ["functional", "technical", "mixed"], "$.work_type");
  if (Object.hasOwn(value, "mutation_scope")) {
    validateOwnedScopeShape(value.mutation_scope);
    if (value.kind !== "CHG" || value.work_type !== "technical") fail("WR_INVALID_VALUE", "$.mutation_scope", "Only technical governing CHGs may carry an owned scope");
    if (value.mutation_scope.subject_work_id === value.work_id) fail("WR_INVALID_VALUE", "$.mutation_scope.subject_work_id", "Owned scope subject must differ from governing work");
  }
  string(value.title, "$.title");
  string(value.source, "$.source");

  array(value.outcomes, "$.outcomes", { min: 1 });
  const outcomeIds = new Set();
  value.outcomes.forEach((item, index) => {
    const path = `$.outcomes[${index}]`;
    object(item, path, ["id", "statement", "demo", "primary"]);
    string(item.id, `${path}.id`);
    if (outcomeIds.has(item.id)) fail("WR_DUPLICATE_ID", `${path}.id`, `Duplicate outcome id ${item.id}`);
    outcomeIds.add(item.id);
    string(item.statement, `${path}.statement`);
    string(item.demo, `${path}.demo`);
    if (typeof item.primary !== "boolean") fail("WR_INVALID_TYPE", `${path}.primary`, `${path}.primary must be boolean`);
  });

  array(value.acceptance_criteria, "$.acceptance_criteria", { min: 1 });
  const acceptanceIds = new Set();
  value.acceptance_criteria.forEach((item, index) => {
    const path = `$.acceptance_criteria[${index}]`;
    object(item, path, ["id", "outcome_ids"]);
    string(item.id, `${path}.id`);
    if (acceptanceIds.has(item.id)) fail("WR_DUPLICATE_ID", `${path}.id`, `Duplicate acceptance criterion id ${item.id}`);
    acceptanceIds.add(item.id);
    array(item.outcome_ids, `${path}.outcome_ids`, { min: 1 });
    uniqueStrings(item.outcome_ids, `${path}.outcome_ids`);
    item.outcome_ids.forEach((id, refIndex) => {
      if (!outcomeIds.has(id)) fail("WR_UNRESOLVED_REFERENCE", `${path}.outcome_ids[${refIndex}]`, `Unknown outcome id ${id}`);
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
    if (item.work_id === value.work_id) fail("WR_DEPENDENCY_CYCLE", `${path}.work_id`, "A work item cannot depend on itself");
    const edge = `${item.type}:${item.work_id}`;
    if (dependencyIds.has(edge)) fail("WR_DUPLICATE_DEPENDENCY", `${path}.work_id`, `Duplicate dependency ${edge}`);
    dependencyIds.add(edge);
    oneOf(item.type, ["blocks", "blocked_by"], `${path}.type`);
    if (dependencyDirections.has(item.work_id) && dependencyDirections.get(item.work_id) !== item.type) {
      fail("WR_DEPENDENCY_CYCLE", `${path}.work_id`, `Contradictory dependency edges with ${item.work_id} form a cycle`);
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
  if (typeof value.approval.payload_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.approval.payload_sha256)) fail("WR_INVALID_SHA256", "$.approval.payload_sha256", "Approval digest must be lowercase SHA-256");
  if (value.actuals !== null) validateActualsShape(value.actuals, "$.actuals");
  // CHG-037: legacy field, accepted and ignored. Must still be an array so a
  // malformed artifact is still a malformed artifact.
  if (Object.hasOwn(value, "checkpoints")) array(value.checkpoints, "$.checkpoints");
  if (typeof value.policy_bootstrap !== "boolean") fail("WR_INVALID_TYPE", "$.policy_bootstrap", "policy_bootstrap must be boolean");
  string(value.bootstrap_exemption_rationale, "$.bootstrap_exemption_rationale", { nullable: true });
  if (!value.policy_bootstrap && value.controlling_change !== null) {
    object(value.controlling_change, "$.controlling_change", ["work_id", "relationship", "reason"]);
    validateWorkId(value.controlling_change.work_id, "$.controlling_change.work_id");
    if (!value.controlling_change.work_id.startsWith("CHG-") || value.controlling_change.work_id === value.work_id) fail("WR_APPROVAL_CONTROL_INVALID", "$.controlling_change.work_id", "Controller must be a different official CHG");
    if (value.controlling_change.relationship !== "readiness_governance") fail("WR_APPROVAL_CONTROL_INVALID", "$.controlling_change.relationship", "Controller relationship must be readiness_governance");
    string(value.controlling_change.reason, "$.controlling_change.reason");
  }
}

function canonicalize(value, path = "$") {
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (value !== null && typeof value === "object") {
    if (!isPlainObject(value)) fail("WR_UNSAFE_OBJECT", path, `${path} must be a plain object`);
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], `${path}.${key}`)]));
  }
  return value;
}

function canonicalizeActuals(value) {
  if (Array.isArray(value)) return value.map(canonicalizeActuals);
  if (value !== null && typeof value === "object") {
    if (!isPlainObject(value)) throw new TypeError("actuals must contain only JSON objects and arrays");
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeActuals(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("actuals must contain only finite JSON numbers");
  if (!["string", "number", "boolean"].includes(typeof value) && value !== null) {
    throw new TypeError("actuals must contain only JSON values");
  }
  return value;
}

export function canonicalActualsSha256(actuals) {
  if (!isPlainObject(actuals)) throw new TypeError("actuals must be a JSON object");
  return createHash("sha256").update(JSON.stringify(canonicalizeActuals(actuals)), "utf8").digest("hex");
}

function jsonSchemaErrors(value, schema, path = "$") {
  const errors = [];
  const expectedType = schema?.type;
  const typeMatches = expectedType === undefined
    || (expectedType === "object" && isPlainObject(value))
    || (expectedType === "array" && Array.isArray(value))
    || (expectedType === "string" && typeof value === "string")
    || (expectedType === "integer" && Number.isInteger(value))
    || (expectedType === "number" && typeof value === "number" && Number.isFinite(value))
    || (expectedType === "boolean" && typeof value === "boolean")
    || (expectedType === "null" && value === null);
  if (!typeMatches) return [`${path} must be ${expectedType}`];
  if (Array.isArray(schema?.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path} must equal one of the emitted enum values`);
  }
  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
    if (typeof schema.pattern === "string" && !(new RegExp(schema.pattern, "u")).test(value)) errors.push(`${path} does not match the emitted pattern`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path} requires at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((item, index) => errors.push(...jsonSchemaErrors(item, schema.items, `${path}[${index}]`)));
  }
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) errors.push(`${path} requires at least ${schema.minProperties} properties`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not allowed`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) errors.push(...jsonSchemaErrors(value[key], childSchema, `${path}.${key}`));
    }
  }
  return errors;
}

export function actualsCorrectionSchemaErrors(record, path = "$") {
  return jsonSchemaErrors(record, ACTUALS_CORRECTED_SCHEMA, path);
}

export function canonicalReadinessPayload(value) {
  if (!isPlainObject(value)) fail("WR_UNSAFE_OBJECT", "$", "Readiness payload must be a plain object");
  const excluded = new Set(["readiness_payload_sha256", "approval", "actuals", "checkpoints"]);
  const payload = Object.fromEntries(Object.keys(value).filter((key) => !excluded.has(key)).map((key) => [key, value[key]]));
  return JSON.stringify(canonicalize(payload));
}

export function computeReadinessPayloadSha256(value) {
  return createHash("sha256").update(canonicalReadinessPayload(value), "utf8").digest("hex");
}

function hardLimitViolation(value) {
  if (value.estimate_minutes.total > MAX_READINESS_MINUTES) return ["WR_ESTIMATE_OVER_BUDGET", "estimate_minutes.total", `Estimate exceeds ${MAX_READINESS_MINUTES} minutes`];
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
  if (uncertaintyBlocks(partition)) fail("WR_PARTITION_UNCERTAINTY", `${path}.uncertainties`, "Partition uncertainties must be resolved and budgeted");
  const deliveryScopes = new Set(["contracts", "db", "server", "ui", "infra", "tooling"]);
  if (!partition.scopes.some((scope) => deliveryScopes.has(scope))) fail("WR_VERTICAL_SLICE_INCOMPLETE", `${path}.scopes`, "A child must include an implementation or delivery scope");
  if (partition.estimate_minutes.implementation === 0) fail("WR_VERTICAL_SLICE_INCOMPLETE", `${path}.estimate_minutes.implementation`, "A child must budget implementation work");
  if (partition.estimate_minutes.focused_verification === 0) fail("WR_VERTICAL_SLICE_INCOMPLETE", `${path}.estimate_minutes.focused_verification`, "A child must budget focused verification");
}

export function validatePartitionGraph(value) {
  if (!isPlainObject(value)) fail("WR_UNSAFE_OBJECT", "$", "Assessment must be a plain object");
  if (!Array.isArray(value.partitions)) fail("WR_INVALID_TYPE", "$.partitions", "partitions must be an array");
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
      if (!acceptanceIds.has(id)) fail("WR_UNRESOLVED_REFERENCE", `${path}.acceptance_criteria[${refIndex}]`, `Unknown acceptance criterion ${id}`);
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
      if (!keys.has(key)) fail("WR_UNRESOLVED_REFERENCE", `$.partitions[${index}].depends_on[${dependencyIndex}]`, `Unknown proposal key ${key}`);
      if (key === partition.proposal_key) fail("WR_DEPENDENCY_CYCLE", "$.partitions", "Partition dependency graph contains a cycle");
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
        if (value.partitions[index].cross_cutting_rationale === null) fail("WR_CROSS_CUTTING_RATIONALE_REQUIRED", `$.partitions[${index}].cross_cutting_rationale`, `Duplicate coverage of ${id} requires rationale on every affected partition`);
      }
    }
  }

  const state = new Map();
  const visit = (key) => {
    if (state.get(key) === "visiting") fail("WR_DEPENDENCY_CYCLE", "$.partitions", "Partition dependency graph contains a cycle");
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
  for (const [valid, path] of checks) if (!valid) fail("WR_INVALID_BOOTSTRAP", path, "CHG-022 bootstrap does not match its committed authorization");
  if (!isPlainObject(value.bootstrap_authorization)) fail("WR_INVALID_BOOTSTRAP", "$.bootstrap_authorization", "Bootstrap authorization is required");
  for (const key of Object.keys(BOOTSTRAP_AUTHORIZATION)) {
    if (!deepSemanticEqual(value.bootstrap_authorization[key], BOOTSTRAP_AUTHORIZATION[key])) fail("WR_INVALID_BOOTSTRAP", `$.bootstrap_authorization.${key}`, `Bootstrap ${key} differs from the committed authorization`);
  }
  object(value.bootstrap_authorization, "$.bootstrap_authorization", Object.keys(BOOTSTRAP_AUTHORIZATION));
}

function deepSemanticEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function feedbackArray(records) {
  if (!Array.isArray(records)) fail("WR_INVALID_TYPE", "$feedback", "feedbackRecords must be an array");
  records.forEach((record, index) => {
    if (!isPlainObject(record)) fail("WR_UNSAFE_OBJECT", `$feedback[${index}]`, "Feedback records must be plain objects");
  });
}

function readinessTokens(text) {
  if (typeof text !== "string") return { decisions: [], digests: [] };
  return {
    decisions: [...text.matchAll(/Decision (ready|partition_required|blocked)\b/gu)].map((match) => match[1]),
    digests: [...text.matchAll(/SHA-256 ([0-9a-f]{64})\b/gu)].map((match) => match[1]),
  };
}

// CHG-034 §1 — Ed25519 signing retired.
//
// What went: `approvalAuthorities()` (the WORK_READINESS_APPROVAL_KEYS_JSON trust
// map) and `verifyDecisionAttestation()` (key lookup + signature verification),
// with their five codes: WR_APPROVAL_TRUST_{UNAVAILABLE,INVALID},
// WR_APPROVAL_KEY_UNTRUSTED, WR_APPROVAL_ATTESTATION_{INVALID,REQUIRED}.
// Separation-of-duties infrastructure for a threat model this project does not
// have — one human approver, no adversarial second party — and it never defended
// against the failure that actually occurred (unsound estimates, US-056/US-058).
//
// What stayed, and why it is not a flag flip: the ledger holds 62 decision
// events in TWO shapes — 20 signed (10 keys) and 42 legacy (5 keys) — and this
// function enforced an EXACT-LENGTH closed key set. Simply passing
// `requireAttestation: false` would have made all 20 signed records fail the
// 5-key match with WR_APPROVAL_EVIDENCE_INVALID, breaking every one of the 17
// existing artifacts. So the attestation keys are now OPTIONAL-BUT-ACCEPTED:
// present or absent both validate, and neither is cryptographically checked.
// That is what keeps the already-signed history readable (success criterion 3)
// without carrying its verification machinery forward.
//
// The digest binding (readiness_payload_sha256, "What stays" item 2) is
// untouched and remains the tamper-evidence for every decision, old and new.
//
// CHG-066 — the shape is closed only for the fields the gate reads. Unknown
// top-level keys are accepted: run-ruling decisions carry provenance, run_id,
// run_ruling_index, source_plan, recorded_retrospectively and agent, and the
// substrate's IMP-417 adds a `readiness` object. An exact key set made the gate
// reject a ledger that had outgrown it (CHG-062, then CHG-066), so only the
// keys below are typed; anything else is carried, not checked.
const OPTIONAL_ATTESTATION_KEYS = ["approved_by", "subject_work_id", "relationship", "key_id", "signature", "ts"];

function decisionObjectKeysValid(record) {
  return !Object.hasOwn(record, "readiness") || isPlainObject(record.readiness);
}

function validateDecisionRecordShape(record) {
  const required = ["story", "event", "id", "text", "reason"];
  const missing = required.filter((key) => !Object.hasOwn(record, key));
  if (missing.length > 0 || !decisionObjectKeysValid(record)) {
    fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", "Approval decisions must use the closed feedback decision shape");
  }
  for (const key of ["story", "id", "text", "reason"]) {
    if (typeof record[key] !== "string" || !/\S/u.test(record[key])) fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", `Prior decision ${key} must be non-empty`);
  }
  if (record.event !== "decision") fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", "Prior approval evidence must be a decision event");
  // Historical signed records keep their shape checked — a malformed leftover
  // attestation is still a malformed record — but nothing is verified against a key.
  for (const key of OPTIONAL_ATTESTATION_KEYS) {
    if (Object.hasOwn(record, key) && (typeof record[key] !== "string" || !/\S/u.test(record[key]))) {
      fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", `Prior decision ${key}, when present, must be non-empty`);
    }
  }
}

function validatePriorDecisionRecord(record, seenIds) {
  const readinessLike = /\bDecision\s+(?:ready|partition_required|blocked)\b/iu.test(record.text) || /SHA-256\b/iu.test(record.text);
  validateDecisionRecordShape(record);
  if (seenIds.has(record.id)) fail("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", `Duplicate prior decision evidence id ${record.id}`);
  seenIds.add(record.id);
  const tokens = readinessTokens(record.text);
  if (readinessLike && (tokens.decisions.length !== 1 || tokens.digests.length !== 1)) {
    fail("WR_APPROVAL_EVIDENCE_INVALID", "$.approval.evidence", "Readiness decisions must contain exactly one canonical Decision token and one SHA-256 token");
  }
  return tokens;
}

const POSTAPPROVAL_NON_EXECUTION_EVENTS = new Set(["feedback", "actuals_corrected"]);
const REVOCATION_EVENTS = new Set(["blocked", "blocker"]);
const IMPLEMENTATION_EVIDENCE_EVENTS = new Set([
  "started", "ac_pass", "ac_verify", "verified", "deviation", "ac_fail", "ac_unverifiable", "test_report",
  "build_pass", "nav_gap", "evidence_superseded", "revalidated", "mutation_invalidation", "closed_with_deferrals",
  "adversarial_review", "deferred_memory_saved", "closure_hygiene", "implemented_with_external_verification",
]);

function isRawTerminalEvent(event) {
  return event === "done" || (typeof event === "string" && /^done_with_[a-z0-9_]+$/u.test(event));
}

export function isExecutionEvidenceEvent(event) {
  return event === "checkpoint" || IMPLEMENTATION_EVIDENCE_EVENTS.has(event) || isRawTerminalEvent(event);
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
  return event === "decision" || POSTAPPROVAL_NON_EXECUTION_EVENTS.has(event)
    || REVOCATION_EVENTS.has(event) || isExecutionEvidenceEvent(event)
    || DELIVERED_CANONICAL_EVENTS.has(event) || DELIVERED_LOCAL_EVENTS.has(event);
}

function isPreapprovalAnnotation(event) {
  return DELIVERED_ANNOTATION_EVENTS.has(event)
    && !["build_pass", "ac_verify", "test_report"].includes(event);
}

// Identity is carried privately from the raw ledger parser, never reserialized.
const feedbackLineDigests = new WeakMap();
export function parseFeedbackRecords(text) {
  if (text === null || text.trim() === "") return [];
  return text.split("\n").filter((line) => line.length > 0).map((line, index) => {
    try {
      const record = JSON.parse(line);
      if (record === null || typeof record !== "object" || Array.isArray(record)) throw new Error("expected an object");
      feedbackLineDigests.set(record, createHash("sha256").update(line, "utf8").digest("hex"));
      return record;
    } catch (error) {
      fail("WR_FEEDBACK_INVALID", `.nous-feedback.jsonl:${index + 1}`, `Invalid feedback JSON: ${error.message}`);
    }
  });
}
const ANNOTATION_IDENTITY = Object.freeze({
  story: "US-024", event: "deviation", ts: "2026-10-12T03:00:34.941232Z",
  digest: "d1dba52d00fd4b60aa47a2654e4ee4c82f229370966d1dcdfea2c5911b6150bd",
});
function validateAnnotationCorrection(records, record, index, correctedIndices, context) {
  const invalid = (message) => fail("WR_CORRECTION_INVALID", "$.approval.evidence", message);
  object(record, "$.correction", ["story", "event", "target_event", "target_ts", "target_sha256",
    "disposition", "reason", "approved_by", "authority", "ts"]);
  string(record.reason, "$.correction.reason");
  string(record.approved_by, "$.correction.approved_by");
  if (record.story !== ANNOTATION_IDENTITY.story || record.target_event !== ANNOTATION_IDENTITY.event
    || record.target_ts !== ANNOTATION_IDENTITY.ts || record.target_sha256 !== ANNOTATION_IDENTITY.digest
    || record.disposition !== "not_execution") invalid("Only the canonical CHG-089 non-execution annotation may be corrected");
  object(record.authority, "$.correction.authority", ["work_id", "payload_sha256", "evidence"]);
  if (record.authority.work_id !== "CHG-089") invalid("Annotation correction requires independent CHG-089 technical authority");
  const targets = records.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(({ candidate }) => candidate.story === record.story && candidate.event === record.target_event && candidate.ts === record.target_ts);
  if (targets.length !== 1 || targets[0].candidateIndex >= index) invalid("Correction requires exactly one earlier canonical annotation");
  const { candidate, candidateIndex } = targets[0];
  if (feedbackLineDigests.get(candidate) !== record.target_sha256) invalid("Original raw annotation bytes do not match the canonical identity");
  if (correctedIndices.has(candidateIndex)) invalid("Annotation may be corrected only once");
  const artifact = context.approvedReadinessAuthorities?.get("CHG-089")?.artifact;
  if (!artifact || artifact.work_id !== "CHG-089" || artifact.kind !== "CHG" || artifact.work_type !== "technical"
    || artifact.decision !== "ready" || artifact.policy_bootstrap || artifact.controlling_change != null
    || artifact.readiness_payload_sha256 !== record.authority.payload_sha256
    || artifact.approval.evidence !== record.authority.evidence || artifact.approval.approved_by !== record.approved_by) {
    invalid("Missing or mismatched independently approved technical artifact");
  }
  // The raw prefix validates ONLY the authority's lifecycle. Parent projection
  // cannot grant authority, and this correction cannot authorize itself.
  const prefix = records.slice(0, index);
  const assessment = validateAssessment(artifact, { feedbackRecords: prefix, independentAuthority: true });
  if (!assessment.active || assessment.complete) invalid("Technical authority must be active and uncompleted before correction");
  const approvals = prefix.map((entry, position) => ({ entry, position }))
    .filter(({ entry }) => entry.event === "decision" && entry.id === record.authority.evidence);
  if (approvals.length !== 1 || approvals[0].position <= candidateIndex) invalid("Independent approval must follow the target and precede correction");
  const approvalTime = parseExplicitUtcTimestamp(approvals[0].entry.ts);
  const correctionTime = parseExplicitUtcTimestamp(record.ts);
  if (approvalTime === null || correctionTime === null
    || approvalTime <= parseExplicitUtcTimestamp(record.target_ts) || correctionTime <= approvalTime) invalid("Annotation correction chronology is invalid");
  correctedIndices.add(candidateIndex);
}

export function validateLifecycleCorrections(records, workId, context = {}) {
  feedbackArray(records);
  const correctedStartIndices = new Set();
  const correctedAnnotationIndices = new Set();
  const corrections = records.map((record, index) => ({ record, index }))
    .filter(({ record }) => record.story === workId && record.event === "lifecycle_corrected");
  for (const { record, index } of corrections) {
    const invalid = (message) => fail("WR_CORRECTION_INVALID", "$.approval.evidence", message);
    try {
      if (record.target_event !== "started" || record.authority !== undefined || record.target_sha256 !== undefined) {
        if (context.independentAuthority) invalid("Technical authority cannot use annotation projection");
        validateAnnotationCorrection(records, record, index, correctedAnnotationIndices, context);
        continue;
      }
      object(record, "$.correction", [
        "story", "event", "target_event", "target_ts", "disposition", "reason", "approved_by", "ts",
      ]);
      validateWorkId(record.story, "$.correction.story");
      string(record.reason, "$.correction.reason");
      string(record.approved_by, "$.correction.approved_by");
      if (record.target_event !== "started" || record.disposition !== "not_execution") {
        invalid("Correction must classify a raw started event as not_execution");
      }
      const targetTime = parseExplicitUtcTimestamp(record.target_ts);
      const correctionTime = parseExplicitUtcTimestamp(record.ts);
      if (targetTime === null || correctionTime === null) invalid("Correction timestamps must be valid explicit UTC timestamps");
      const targets = records.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate.story === record.story
          && candidate.event === "started" && candidate.ts === record.target_ts);
      if (targets.length !== 1 || targets[0].candidateIndex >= index) {
        invalid("Correction must identify exactly one earlier raw start for its own story");
      }
      const targetIndex = targets[0].candidateIndex;
      if (correctedStartIndices.has(targetIndex)) invalid("A raw start may be corrected only once");
      let approvalIndex = -1;
      for (let candidateIndex = 0; candidateIndex < records.length; candidateIndex += 1) {
        const candidate = records[candidateIndex];
        if (candidate.story !== record.story || candidate.event !== "decision") continue;
        let tokens;
        try {
          tokens = validatePriorDecisionRecord(candidate, new Set());
        } catch (error) {
          if (error instanceof WorkReadinessError) continue;
          throw error;
        }
        if (tokens.decisions.length !== 1 || tokens.decisions[0] !== "ready" || tokens.digests.length !== 1
          || typeof candidate.approved_by !== "string" || !/\S/u.test(candidate.approved_by)
          || candidate.subject_work_id !== record.story || candidate.relationship !== "self"
          || records.filter((entry) => entry.event === "decision" && entry.id === candidate.id).length !== 1) continue;
        approvalIndex = candidateIndex;
        break;
      }
      if (approvalIndex <= targetIndex || approvalIndex >= index) invalid("Correction must follow the first valid ready approval, and its target must precede it");
      const approvalTime = parseExplicitUtcTimestamp(records[approvalIndex].ts);
      if (approvalTime === null || targetTime >= approvalTime || correctionTime <= approvalTime) {
        invalid("Correction chronology must strictly follow target, ready approval and append time");
      }
      if (records.slice(targetIndex + 1, approvalIndex).some((candidate) => candidate.story === record.story
        && ["build_pass", "ac_verify", "test_report"].includes(candidate.event))) {
        invalid("Raw implementation evidence between the start and first approval cannot be corrected");
      }
      correctedStartIndices.add(targetIndex);
    } catch (error) {
      if (error instanceof WorkReadinessError && error.code !== "WR_CORRECTION_INVALID") invalid(error.message);
      throw error;
    }
  }
  return { correctedStartIndices, correctedAnnotationIndices, correctedStarts: correctedStartIndices.size };
}

function validatePreapprovalHistory(value, feedbackRecords, evidenceIndex, terminalProjection, correctedStartIndices) {
  let authorized = false;
  let everAuthorized = false;
  let bootstrapStarts = 0;
  const seenDecisionIds = new Set();
  for (let index = 0; index < evidenceIndex; index += 1) {
    if (terminalProjection.omittedIndices.has(index) || correctedStartIndices.has(index)) continue;
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
    if (isPreapprovalAnnotation(record.event) && !REVOCATION_EVENTS.has(record.event)) continue;
    if (REVOCATION_EVENTS.has(record.event)) {
      if (typeof record.reason !== "string" || !/\S/u.test(record.reason)) {
        fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", `${record.event} requires a non-empty reason`);
      }
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

function validatePostapprovalHistory(value, feedbackRecords, evidenceIndex, terminalProjection, correctedAnnotationIndices) {
  let active = value.decision === "ready";
  let stale = false;
  let inactiveReason = active ? null : "decision_not_ready";
  const seenDecisionIds = new Set([value.approval.evidence]);
  for (let index = evidenceIndex + 1; index < feedbackRecords.length; index += 1) {
    if (terminalProjection.omittedIndices.has(index) || correctedAnnotationIndices.has(index)) continue;
    const record = feedbackRecords[index];
    if (record.story !== value.work_id) continue;
    if (record.event === "decision") {
      const { decisions } = validatePriorDecisionRecord(record, seenDecisionIds);
      if (decisions.length === 1) {
        stale = true;
        active = false;
      }
      continue;
    }
    if (POSTAPPROVAL_NON_EXECUTION_EVENTS.has(record.event)) continue;
    if (REVOCATION_EVENTS.has(record.event)) {
      if (typeof record.reason !== "string" || !/\S/u.test(record.reason)) {
        fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", `${record.event} requires a non-empty reason`);
      }
      stale = true;
      active = false;
      continue;
    }
    if (record.event === "checkpoint") {
      if (!["on_track", "variance", "partition_required", "blocked"].includes(record.status)) {
        fail("WR_APPROVAL_EVENT_INVALID", "$.approval.evidence", "Checkpoint status is outside the closed readiness vocabulary");
      }
      if (["partition_required", "blocked"].includes(record.status)) {
        stale = true;
        active = false;
      }
      continue;
    }
    if (terminalProjection.terminalIndices.has(index)) {
      active = false;
      inactiveReason = "terminal";
      continue;
    }
    // CHG-066: a deviation recorded after the terminal event (e.g. integration
    // notes, US-021 line 883) is informational. It claims no work and never
    // re-authorizes any; every other implementation event after done still fails.
    if (!active && inactiveReason === "terminal" && record.event === "deviation") continue;
    if (!active && IMPLEMENTATION_EVIDENCE_EVENTS.has(record.event)) {
      fail("WR_APPROVAL_ORDER", "$.approval.evidence", "Implementation evidence occurs after readiness authorization became inactive");
    }
  }
  if (stale) {
    fail("WR_APPROVAL_INACTIVE", "$.approval.evidence", "Selected approval is no longer the active readiness decision");
  }
  return { active, inactiveReason };
}

export function validateApproval(value, feedbackRecords, context = {}) {
  feedbackArray(feedbackRecords);
  const correctedStories = new Set(context.independentAuthority ? [] : feedbackRecords.filter((record) => record.event === "lifecycle_corrected").map((record) => record.story));
  correctedStories.add(value.work_id);
  let corrections;
  for (const workId of correctedStories) {
    const result = validateLifecycleCorrections(feedbackRecords, workId, context);
    if (workId === value.work_id) corrections = result;
  }
  const terminalProjection = buildTerminalProjection(feedbackRecords, value.work_id);
  const unknownEvent = feedbackRecords.find((record) => record.story === value.work_id && !isKnownFeedbackEvent(record.event));
  if (unknownEvent) fail("WR_APPROVAL_EVENT_UNKNOWN", "$.approval.evidence", `Unknown feedback event ${String(unknownEvent.event)}`);
  const recomputed = computeReadinessPayloadSha256(value);
  if (value.readiness_payload_sha256 !== recomputed) fail("WR_APPROVAL_DIGEST_MISMATCH", "$.readiness_payload_sha256", "Root readiness digest does not match the canonical payload");
  if (value.approval.payload_sha256 !== value.readiness_payload_sha256) fail("WR_APPROVAL_DIGEST_MISMATCH", "$.approval.payload_sha256", "Approval digest must equal the root readiness digest");
  if (value.approval.status !== "approved") fail("WR_APPROVAL_REQUIRED", "$.approval.status", "The declared decision requires approved evidence");
  if (typeof value.approval.approved_by !== "string" || !/\S/u.test(value.approval.approved_by)) {
    fail("WR_APPROVER_REQUIRED", "$.approval.approved_by", "Normal ready approval requires a non-empty approver identity");
  }
  string(value.approval.evidence, "$.approval.evidence");
  const candidates = feedbackRecords.filter((record) => record.event === "decision" && record.id === value.approval.evidence);
  if (candidates.length === 0) fail("WR_APPROVAL_EVIDENCE_MISSING", "$.approval.evidence", "No matching decision event exists");
  if (candidates.length !== 1) fail("WR_APPROVAL_EVIDENCE_DUPLICATE", "$.approval.evidence", "Approval evidence must identify exactly one decision event");
  const evidence = candidates[0];
  const evidenceIndex = feedbackRecords.indexOf(evidence);
  validateDecisionRecordShape(evidence);
  if (!value.policy_bootstrap) {
    if (evidence.approved_by !== value.approval.approved_by) fail("WR_APPROVER_MISMATCH", "$.approval.approved_by", "Artifact approver must match the signed decision approver");
    if (evidence.subject_work_id !== value.work_id) fail("WR_APPROVAL_STORY_MISMATCH", "$.approval.evidence", "Signed decision subject belongs to another work item");
    const controlling = value.controlling_change ?? null;
    if (controlling === null) {
      if (evidence.relationship !== "self") fail("WR_APPROVAL_CONTROL_MISMATCH", "$.approval.evidence", "Self approval must declare the self relationship");
      if (evidence.story !== value.work_id) fail("WR_APPROVAL_STORY_MISMATCH", "$.approval.evidence", "Decision evidence belongs to another work item");
    } else if (evidence.relationship !== "controlling_change" || evidence.story !== controlling.work_id) {
      fail("WR_APPROVAL_CONTROL_MISMATCH", "$.approval.evidence", "Controlling approval must be signed by the exact CHG declared in the digest-bound assessment");
    }
  } else if (evidence.story !== value.work_id) {
    fail("WR_APPROVAL_STORY_MISMATCH", "$.approval.evidence", "Decision evidence belongs to another work item");
  }
  validatePreapprovalHistory(value, feedbackRecords, evidenceIndex, terminalProjection, corrections.correctedStartIndices);
  const { decisions, digests } = readinessTokens(evidence.text);
  if (decisions.length !== 1 || decisions[0] !== value.decision || digests.length !== 1 || digests[0] !== value.readiness_payload_sha256) {
    fail("WR_APPROVAL_DECISION_MISMATCH", "$.approval.evidence", "Decision evidence must bind the declared decision and exact digest");
  }
  if (value.policy_bootstrap) {
    if (value.approval.evidence !== BOOTSTRAP_EVIDENCE) fail("WR_BOOTSTRAP_APPROVAL_REPLAY", "$.approval.evidence", "Only the CHG-022 V2 approval can authorize this bootstrap");
    const authorization = value.bootstrap_authorization;
    const orderedPaths = `Exact authorized paths, in order: ${authorization.allowed_paths.join("; ")}.`;
    const bindings = [
      authorization.design_commit,
      authorization.plan_commit,
      orderedPaths,
      "interval begins at this matching decision",
      "expires on CHG-022's first valid terminal done event",
    ];
    if (!bindings.every((binding) => evidence.text.includes(binding))) fail("WR_BOOTSTRAP_APPROVAL_BINDING", "$.approval.evidence", "Bootstrap decision must bind provenance, ordered paths, and expiry");
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
  const authorization = validatePostapprovalHistory(value, feedbackRecords, evidenceIndex, terminalProjection, corrections.correctedAnnotationIndices);
  return { evidence: value.approval.evidence, payloadSha256: recomputed, ...authorization, correctedStarts: corrections.correctedStarts };
}

function approvalIndex(records, value) {
  return records.findIndex((record) => record.story === value.work_id && record.event === "decision" && record.id === value.approval?.evidence);
}

function terminalDoneIndex(records, value, terminalProjection = buildTerminalProjection(records, value.work_id)) {
  const afterIndex = value.policy_bootstrap ? approvalIndex(records, value) : -1;
  return records.findIndex((record, index) => index > afterIndex && record.story === value.work_id && terminalProjection.terminalIndices.has(index));
}

function validateCompleteActuals(actuals, value, feedbackRecords, doneIndex, path) {
  validateActualsShape(actuals, path);
  for (const key of PHASE_KEYS) {
    if (actuals.phase_minutes[key] === null) fail("WR_ACTUALS_INCOMPLETE", `${path}.phase_minutes.${key}`, "All actual phase minutes are required at done");
  }
  for (const key of ["total", "changed_files", "commits", "review_fix_loops", "cold_mutation_attempts", "mutation_invalidations", "estimate_variance_minutes", "root_cause"]) {
    if (actuals[key] === null) fail("WR_ACTUALS_INCOMPLETE", `${path}.${key}`, `actuals.${key} is required at done`);
  }
  const total = phaseSum(actuals.phase_minutes);
  if (actuals.total !== total) fail("WR_ACTUALS_TOTAL_MISMATCH", `${path}.total`, "Actual total must equal the five actual phase values");
  const variance = total - value.estimate_minutes.total;
  if (actuals.estimate_variance_minutes !== variance) fail("WR_ACTUALS_VARIANCE_MISMATCH", `${path}.estimate_variance_minutes`, "Estimate variance must equal actual total minus estimated total");
  // CHG-037 §2: actuals no longer have to evidence 45/90-minute controls. The
  // gate demanded a checkpoint for every long phase, which is why the bootstrap
  // needed a "corrective deviation" escape to avoid fabricating controls it never
  // took. Both the demand and the escape are gone.
  const attempts = actuals.cold_mutation_attempts;
  if (attempts === 0 && value.signals.expected_mutation_shards > 0) {
    fail("WR_MUTATION_COLD_REQUIRED", `${path}.cold_mutation_attempts`, "At least one authoritative cold campaign is required when mutation shards are approved");
  }
  const expectedInvalidations = Math.max(0, attempts - 1);
  if (actuals.mutation_invalidations !== expectedInvalidations) fail("WR_MUTATION_INVALIDATION_COUNT", `${path}.mutation_invalidations`, "Mutation invalidations must equal cold attempts minus one");
  if (attempts > 1) {
    const evidence = feedbackRecords.slice(0, doneIndex).filter((record) => record.story === value.work_id && record.event === "mutation_invalidation" && typeof record.reason === "string" && /\S/u.test(record.reason));
    if (evidence.length !== actuals.mutation_invalidations) fail("WR_MUTATION_INVALIDATION_EVIDENCE", `${path}.mutation_invalidations`, "Each mutation invalidation requires one non-empty reason event");
  }
  const campaignEvidence = feedbackRecords.slice(0, doneIndex).filter((record) => record.story === value.work_id && record.event === "test_report");
  if (campaignEvidence.length === 1 && attempts === 0) {
    fail("WR_MUTATION_CAMPAIGN_EVIDENCE", `${path}.cold_mutation_attempts`, "Retained test_report evidence requires at least one cold mutation attempt");
  }
  if (campaignEvidence.length > 1) {
    fail("WR_MUTATION_CAMPAIGN_EVIDENCE", `${path}.cold_mutation_attempts`, "Only the final retained cold campaign may emit test_report evidence");
  }
  return { total, variance };
}

function missingShapePaths(reference, replacement, path = "$") {
  if (isPlainObject(reference)) {
    if (!isPlainObject(replacement)) return [path];
    return Object.entries(reference).flatMap(([key, value]) => Object.hasOwn(replacement, key)
      ? missingShapePaths(value, replacement[key], `${path}.${key}`)
      : [`${path}.${key}`]);
  }
  if (Array.isArray(reference) && !Array.isArray(replacement)) return [path];
  return [];
}

function parseExplicitUtcTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = EXPLICIT_UTC_TIMESTAMP.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, fractional = ""] = match;
  const wholeSecond = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const milliseconds = Date.parse(wholeSecond);
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour)
    || date.getUTCMinutes() !== Number(minute)
    || date.getUTCSeconds() !== Number(second)) return null;
  const microseconds = fractional.slice(0, 6).padEnd(6, "0");
  return BigInt(milliseconds) * 1_000n + BigInt(microseconds || "0");
}

function correctionError(index, event, reason, detail) {
  return {
    index,
    ref: isPlainObject(event) ? event.ref ?? null : null,
    story: isPlainObject(event) ? event.story ?? null : null,
    change: isPlainObject(event) ? event.change ?? null : null,
    reason,
    detail,
  };
}

const CORRECTION_DECISION_REQUIRED = [
  "story", "event", "id", "text", "reason", "approved_by", "subject_work_id", "relationship",
];
const CORRECTION_DECISION_OPTIONAL = ["key_id", "signature", "ts"];

function validCorrectionDecision(record, feedbackRecords, expectedWorkId, approvedReadinessAuthorities) {
  if (!isPlainObject(record)) return false;
  if (CORRECTION_DECISION_REQUIRED.some((key) => !Object.hasOwn(record, key))) return false;
  if (!decisionObjectKeysValid(record)) return false;
  for (const key of CORRECTION_DECISION_REQUIRED) {
    if (key !== "event" && (typeof record[key] !== "string" || !/\S/u.test(record[key]))) return false;
  }
  for (const key of CORRECTION_DECISION_OPTIONAL) {
    if (Object.hasOwn(record, key) && (typeof record[key] !== "string" || !/\S/u.test(record[key]))) return false;
  }
  if (record.event !== "decision") return false;
  if (!/^(?:US|CHG)-[0-9]{3,}$/u.test(record.story)) return false;
  if (record.story !== expectedWorkId || record.subject_work_id !== expectedWorkId) return false;
  if (record.relationship !== "self") return false;
  const decisionTokens = [...record.text.matchAll(/\bDecision\s+(ready|partition_required|blocked)\b/giu)].map((match) => match[1].toLowerCase());
  const digestTokens = [...record.text.matchAll(/\bSHA-256\s+([0-9a-f]{64})\b/gu)].map((match) => match[1]);
  if (decisionTokens.length !== 1 || decisionTokens[0] !== "ready" || digestTokens.length !== 1) return false;
  const authority = approvedReadinessAuthorities instanceof Map
    ? approvedReadinessAuthorities.get(expectedWorkId)
    : null;
  if (!isPlainObject(authority)
    || authority.digest !== digestTokens[0]
    || authority.evidence !== record.id
    || authority.approvedBy !== record.approved_by) return false;
  return feedbackRecords.filter((candidate) => candidate.event === "decision" && candidate.id === record.id).length === 1;
}

export function resolveEffectiveActuals(rawActuals, feedbackRecords, context = {}) {
  if (!isPlainObject(rawActuals)) throw new TypeError("rawActuals must be a JSON object");
  if (!Array.isArray(feedbackRecords)) throw new TypeError("feedbackRecords must be an array");
  const value = context.assessment;
  if (!isPlainObject(value)) throw new TypeError("context.assessment must be a readiness assessment");

  const raw = structuredClone(rawActuals);
  let effective = structuredClone(rawActuals);
  const corrections = [];
  const errors = [];
  const allCorrectionEntries = feedbackRecords
    .map((event, position) => ({ event, position }))
    .filter(({ event }) => isPlainObject(event) && event.event === "actuals_corrected");
  const correctionEntries = Array.isArray(context.correctionEvents)
    ? context.correctionEvents.map((event) => ({ event, position: feedbackRecords.indexOf(event) }))
    : allCorrectionEntries.filter(({ event }) => event.story === value.work_id);
  if (correctionEntries.length === 0) return { raw, effective, corrections, errors };

  const refCounts = new Map();
  for (const event of feedbackRecords.filter((record) => isPlainObject(record))) {
    if (typeof event.ref === "string") refCounts.set(event.ref, (refCounts.get(event.ref) ?? 0) + 1);
  }
  const terminalProjection = buildTerminalProjection(feedbackRecords, value.work_id);
  const doneIndex = terminalDoneIndex(feedbackRecords, value, terminalProjection);
  const terminalTimestamp = doneIndex < 0 ? null : parseExplicitUtcTimestamp(feedbackRecords[doneIndex]?.ts);
  let previousTimestamp = terminalTimestamp;
  let chainBroken = false;
  let rawValidationError = null;
  if (doneIndex >= 0) {
    try {
      validateCompleteActuals(rawActuals, value, feedbackRecords, doneIndex, "$.actuals");
    } catch (error) {
      if (!(error instanceof WorkReadinessError)) throw error;
      rawValidationError = error;
    }
  }

  correctionEntries.forEach(({ event, position }, index) => {
    const exclude = (reason, detail, { breakChain = true } = {}) => {
      errors.push(correctionError(index, event, reason, detail));
      if (breakChain) chainBroken = true;
    };
    const eventTimestamp = parseExplicitUtcTimestamp(event.ts);
    if (Object.hasOwn(event, "ts") && eventTimestamp === null) {
      exclude("invalid_timestamp", "timestamp must be a valid ISO-8601 value explicitly in UTC");
      return;
    }
    const schemaErrors = actualsCorrectionSchemaErrors(event, `$feedback[${position}]`);
    if (schemaErrors.length > 0) {
      exclude("invalid_schema", schemaErrors.join("; "));
      return;
    }
    if ((refCounts.get(event.ref) ?? 0) !== 1) {
      exclude("duplicate_ref", `correction ref '${event.ref}' occurs ${refCounts.get(event.ref)} times`);
      return;
    }
    if (chainBroken) {
      exclude("chain_not_linear", "an earlier correction was excluded, so this suffix cannot be applied", { breakChain: false });
      return;
    }
    if (event.story !== value.work_id) {
      exclude("story_mismatch", `story '${event.story}' does not match target '${value.work_id}'`);
      return;
    }
    if (doneIndex < 0 || terminalTimestamp === null || rawValidationError !== null) {
      exclude("missing_terminal", rawValidationError?.message ?? "the story has no timestamped effective terminal with complete raw actuals");
      return;
    }
    if (position <= doneIndex || eventTimestamp <= terminalTimestamp) {
      exclude("not_after_terminal", "correction must follow and be later than the effective terminal");
      return;
    }
    if (corrections.length > 0 && eventTimestamp <= previousTimestamp) {
      exclude("not_after_previous_correction", "correction timestamp must advance strictly in append order");
      return;
    }

    const decisionCandidates = feedbackRecords.slice(0, position)
      .filter((record) => isPlainObject(record) && record.event === "decision" && record.story === event.change)
      .filter((record) => validCorrectionDecision(record, feedbackRecords, event.change, context.approvedReadinessAuthorities));
    if (decisionCandidates.length === 0) {
      exclude("missing_decision", `change '${event.change}' has no prior valid decision event`);
      return;
    }
    const decision = decisionCandidates[0];
    if (Object.hasOwn(decision, "ts")) {
      const decisionTimestamp = parseExplicitUtcTimestamp(decision.ts);
      if (decisionTimestamp === null) {
        exclude("invalid_decision_timestamp", "decision timestamp must be a valid ISO-8601 value explicitly in UTC");
        return;
      }
      if (decisionTimestamp >= eventTimestamp) {
        exclude("decision_not_before_correction", "decision timestamp contradicts append-ledger order");
        return;
      }
    }

    const replacement = event.replacement_actuals;
    const missing = missingShapePaths(rawActuals, replacement);
    if (missing.length > 0) {
      exclude("incomplete_replacement", `replacement is missing raw actuals shape at ${missing.join(", ")}`);
      return;
    }
    try {
      canonicalActualsSha256(replacement);
    } catch (error) {
      exclude("invalid_replacement_actuals", `replacement actuals must be canonical finite JSON: ${error.message}`);
      return;
    }
    const expectedTarget = canonicalActualsSha256(effective);
    if (event.target_actuals_sha256 !== expectedTarget) {
      exclude("target_hash_mismatch", "target_actuals_sha256 does not match the currently effective actuals");
      return;
    }
    const retainedReports = feedbackRecords.slice(0, doneIndex)
      .filter((record) => record.story === value.work_id && record.event === "test_report");
    if (retainedReports.length === 0
      && replacement.cold_mutation_attempts !== effective.cold_mutation_attempts) {
      exclude("invalid_replacement_actuals", "cold_mutation_attempts cannot change without retained test_report evidence");
      return;
    }
    try {
      validateCompleteActuals(replacement, value, feedbackRecords, doneIndex, `$feedback[${position}].replacement_actuals`);
    } catch (error) {
      if (!(error instanceof WorkReadinessError)) throw error;
      exclude("invalid_replacement_actuals", `${error.code}: ${error.message}`);
      return;
    }
    corrections.push(structuredClone(event));
    effective = structuredClone(replacement);
    previousTimestamp = eventTimestamp;
  });
  return { raw, effective, corrections, errors };
}

function throwCorrectionError(error) {
  const suffix = error.reason.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
  fail(`WR_ACTUALS_CORRECTION_${suffix}`, `$feedback[${error.index}]`, error.detail);
}

export function validateCompletionActuals(value, feedbackRecords, { approvedReadinessAuthorities } = {}) {
  feedbackArray(feedbackRecords);
  const terminalProjection = buildTerminalProjection(feedbackRecords, value.work_id);
  const doneIndex = terminalDoneIndex(feedbackRecords, value, terminalProjection);
  if (doneIndex < 0) {
    const hasCorrection = feedbackRecords.some((record) => record.story === value.work_id && record.event === "actuals_corrected");
    if (!hasCorrection) return { complete: false };
    const resolution = resolveEffectiveActuals(isPlainObject(value.actuals) ? value.actuals : {}, feedbackRecords, { assessment: value, approvedReadinessAuthorities });
    if (resolution.errors.length > 0) throwCorrectionError(resolution.errors[0]);
    fail("WR_ACTUALS_CORRECTION_MISSING_TERMINAL", "$feedback", "Actuals corrections require an effective terminal with complete raw actuals");
  }
  if (value.actuals === null || value.actuals === undefined) fail("WR_ACTUALS_REQUIRED", "$.actuals", "Terminal done requires completion actuals");
  validateCompleteActuals(value.actuals, value, feedbackRecords, doneIndex, "$.actuals");
  const resolution = resolveEffectiveActuals(value.actuals, feedbackRecords, { assessment: value, approvedReadinessAuthorities });
  if (resolution.errors.length > 0) throwCorrectionError(resolution.errors[0]);
  const effectiveFacts = validateCompleteActuals(resolution.effective, value, feedbackRecords, doneIndex, "$.effective_actuals");
  return {
    complete: true,
    total: effectiveFacts.total,
    variance: effectiveFacts.variance,
    raw: resolution.raw,
    effective: resolution.effective,
    corrections: resolution.corrections,
  };
}

// CHG-037 §2/§3 — the checkpoint machinery is gone: validateCheckpointPolicy (the
// 45/90-minute policy), checkpointRequiresPartition, validateCheckpointEvidence,
// terminalCompletionSolelySupersedesCheckpoint and hasBootstrapCheckpointDeviation.
// It produced 2 feedback events in 547, and both stopped work at a point the task
// structure did not choose.
//
// `checkpoints` remains an ACCEPTED but unvalidated artifact key. One artifact records
// two real checkpoint events, and the closed-key shape check would reject it outright
// if the key were dropped — the same history-preserving reasoning as CHG-036's optional
// attestation keys. `init` no longer emits it for new artifacts.
export function validateAssessment(value, { feedbackRecords = [], approvedReadinessAuthorities, independentAuthority = false } = {}) {
  validateShape(value);
  feedbackArray(feedbackRecords);
  if (value.policy_bootstrap) {
    exactBootstrap(value);
  } else {
    if (value.bootstrap_exemption_rationale !== null) fail("WR_INVALID_BOOTSTRAP", "$.bootstrap_exemption_rationale", "Normal work cannot claim a bootstrap exemption");
    if (value.bootstrap_authorization !== null) fail("WR_INVALID_BOOTSTRAP", "$.bootstrap_authorization", "Normal work cannot carry bootstrap authorization");
  }
  validatePartitionGraph(value);
  const completion = validateCompletionActuals(value, feedbackRecords, { approvedReadinessAuthorities });
  const computedDecision = value.policy_bootstrap ? "ready" : classifyAssessment(value);
  if (computedDecision !== value.decision) {
    const violation = computedDecision === "blocked" ? blockingViolation(value) : hardLimitViolation(value);
    if (value.decision === "ready" && violation) fail(violation[0], `$.${violation[1]}`, violation[2]);
    fail("WR_DECISION_MISMATCH", "$.decision", `Declared decision ${value.decision} does not match recomputed decision ${computedDecision}`);
  }
  if (value.decision === "ready" && value.partitions.length !== 0) fail("WR_PARTITIONS_NOT_ALLOWED", "$.partitions", "Ready normal work cannot contain partitions");
  if (value.decision === "partition_required" && value.partitions.length === 0) fail("WR_PARTITIONS_REQUIRED", "$.partitions", "Partition-required work must propose at least one child");
  // CHG-037 §3: the checkpoint-supersession escape hatch went with the clock —
  // it existed so a terminal completion could override a 90-minute partition stop.
  const authorization = validateApproval(value, feedbackRecords, { approvedReadinessAuthorities, independentAuthority });
  if (value.decision === "ready" && !authorization.active && !completion.complete) {
    fail("WR_APPROVAL_INACTIVE", "$.approval.evidence", "Inactive ready authorization requires valid terminal completion actuals");
  }
  return {
    decision: computedDecision,
    active: authorization.active,
    complete: completion.complete,
    inactiveReason: authorization.inactiveReason,
    correctedStarts: authorization.correctedStarts,
  };
}
