import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { readinessDeliveryPolicy } from "./work-readiness/git.mjs";
import { computeReadinessPayloadSha256, validateAssessment } from "./work-readiness/model.mjs";

const seed = JSON.parse(readFileSync(new URL("../docs/readiness/CHG-082.json", import.meta.url)));
function refresh(value) {
  value.readiness_payload_sha256 = computeReadinessPayloadSha256(value);
  value.approval.payload_sha256 = value.readiness_payload_sha256;
}
function assessment() {
  const value = structuredClone(seed);
  Object.assign(value, { work_id: "CHG-904", uncertainties: [], actuals: null });
  value.signals.expected_changed_files = 16;
  delete value.signals.bookkeeping_files;
  value.approval = { status: "approved", approved_by: "Fixture human", evidence: "CHG904-READY", payload_sha256: "" };
  refresh(value);
  return value;
}
function decision(value) {
  return { story: value.work_id, event: "decision", id: value.approval.evidence, text: `Decision ready for readiness payload SHA-256 ${value.readiness_payload_sha256}.`, reason: "Fixture approval", approved_by: value.approval.approved_by, subject_work_id: value.work_id, relationship: "self" };
}
function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function write(root, path, text) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
function commit(root, message) { git(root, "add", "."); git(root, "-c", "core.hooksPath=/dev/null", "commit", "-qm", message); return git(root, "rev-parse", "HEAD"); }

// Catches ancestry-based reclassification of an unchanged, approved payload.
test("CHG-084 unchanged legacy approval validates before and after real Git rebase", () => {
  const root = mkdtempSync(join(tmpdir(), "chg084-"));
  try {
    git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test");
    const value = assessment();
    const policy = structuredClone(seed);
    policy.approval = { status: "approved", approved_by: "Fixture human", evidence: "CHG082-READY", payload_sha256: policy.readiness_payload_sha256 };
    policy.actuals = { phase_minutes: { readiness: 1, implementation: 1, focused_verification: 1, review: 1, integration: 1 }, total: 5, changed_files: 1, commits: 1, review_fix_loops: 0, cold_mutation_attempts: 0, mutation_invalidations: 0, estimate_variance_minutes: 5 - policy.estimate_minutes.total, root_cause: "Deterministic rebase fixture" };
    const records = [decision(value), decision(policy), { story: "CHG-082", event: "started", agent: "fixture" }, { story: "CHG-082", event: "build_pass", notes: "Fixture green" }, { story: "CHG-082", event: "done" }];
    assert.equal(validateAssessment(policy, { feedbackRecords: records }).complete, true);
    write(root, ".nous-feedback.jsonl", records.map(JSON.stringify).join("\n") + "\n");
    const base = commit(root, "CHG-904 fixture predecessor");
    git(root, "checkout", "-qb", "legacy");
    const bytes = JSON.stringify(value);
    write(root, "docs/readiness/CHG-904.json", bytes);
    const before = commit(root, "CHG-904 approved legacy payload");
    const validate = (revision) => validateAssessment(value, { feedbackRecords: records, deliveryPolicy: readinessDeliveryPolicy({ root, revision, artifact: value }) });
    assert.equal(readinessDeliveryPolicy({ root, revision: before, artifact: value }), false);
    assert.equal(validate(before).decision, "ready");
    git(root, "checkout", "-qb", "policy", base);
    write(root, "docs/readiness/CHG-082.json", JSON.stringify(policy));
    const integrated = commit(root, "CHG-082 completed policy integration");
    git(root, "checkout", "-q", "legacy"); git(root, "rebase", integrated);
    const after = git(root, "rev-parse", "HEAD");
    assert.notEqual(after, before);
    const rebasedBytes = readFileSync(join(root, "docs/readiness/CHG-904.json"), "utf8");
    assert.equal(rebasedBytes, bytes);
    assert.equal(computeReadinessPayloadSha256(JSON.parse(rebasedBytes)), value.readiness_payload_sha256);
    assert.equal(validate(after).decision, "ready");
    assert.equal(readinessDeliveryPolicy({ root, revision: after, artifact: value }), false);
    assert.equal(validate(before).decision, "ready");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Catches treating missing bookkeeping as permission to discount legacy paths.
test("CHG-084 legacy 21 inclusive paths refuse the exact hard limit", () => {
  const value = assessment(); value.signals.expected_changed_files = 21; refresh(value);
  assert.throws(() => validateAssessment(value, { feedbackRecords: [decision(value)], deliveryPolicy: true }), { code: "WR_TOO_MANY_FILES" });
});

// Catches ignoring explicit presence or counting informational bookkeeping as delivery.
test("CHG-084 explicit 16 delivery and five bookkeeping paths are ready", () => {
  const value = assessment(); value.signals.bookkeeping_files = 5; refresh(value);
  assert.equal(readinessDeliveryPolicy({ root: "/no-git-needed", revision: "nonexistent", artifact: value }), true);
  assert.equal(validateAssessment(value, { feedbackRecords: [decision(value)] }).decision, "ready");
  for (const invalid of [-1, 1.5, "5", null]) {
    value.signals.bookkeeping_files = invalid; refresh(value);
    assert.throws(() => validateAssessment(value, { feedbackRecords: [decision(value)] }), { code: "WR_INVALID_INTEGER" });
  }
});
