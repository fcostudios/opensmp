import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as ownership from "./work-readiness/git.mjs";
import { computeReadinessPayloadSha256, validateAssessment } from "./work-readiness/model.mjs";

const seed = JSON.parse(readFileSync(new URL("../docs/readiness/CHG-082.json", import.meta.url)));
function artifact(id = "US-901") {
  const value = structuredClone(seed);
  Object.assign(value, { work_id: id, kind: id.startsWith("US") ? "US" : "CHG", work_type: "functional", scopes: ["delivery"], uncertainties: [], actuals: null });
  Object.assign(value.signals, { tooling_change: false, bookkeeping_files: 0 });
  value.approval = { status: "approved", approved_by: "Fixture human", evidence: id + "-READY", payload_sha256: "" };
  refresh(value);
  return value;
}
function refresh(value) { value.readiness_payload_sha256 = computeReadinessPayloadSha256(value); value.approval.payload_sha256 = value.readiness_payload_sha256; }
function decision(value) { return { story: value.work_id, event: "decision", id: value.approval.evidence, text: `Decision ready for readiness payload SHA-256 ${value.readiness_payload_sha256}.`, reason: "Fixture approval", approved_by: value.approval.approved_by, subject_work_id: value.work_id, relationship: "self" }; }
function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function write(root, path, value) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); }
function commit(root, message) { git(root, "add", "."); git(root, "-c", "core.hooksPath=/dev/null", "commit", "-qm", message); return git(root, "rev-parse", "HEAD"); }
function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "chg082-"));
  try {
    git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test");
    write(root, "apps/web/src/owned.ts", "export const owned = 1;\n");
    write(root, "apps/web/src/foreign.ts", "export const foreign = 1;\n");
    write(root, "apps/web/src/oracle.test.ts", "import assert from 'node:assert/strict'; assert.equal(1, 1);\n");
    write(root, "apps/web/src/extra.test.ts", "import assert from 'node:assert/strict'; assert.equal(2, 2);\n");
    write(root, "scripts/mutation-routes.json", JSON.stringify({ "apps/web/src/foreign.ts": ["apps/web/src/oracle.test.ts"] }));
    const value = artifact(); delete value.signals.bookkeeping_files; refresh(value);
    write(root, "docs/readiness/US-901.json", JSON.stringify(value));
    write(root, ".nous-feedback.jsonl", JSON.stringify(decision(value)) + "\n");
    const authority = commit(root, "US-901 approve fixture");
    body({ root, authority, value });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function activate(root, { genuine = true } = {}) {
  const value = structuredClone(seed);
  value.approval = { status: "approved", approved_by: "Fixture human", evidence: "CHG082-READY", payload_sha256: value.readiness_payload_sha256 };
  value.actuals = { phase_minutes: { readiness: 1, implementation: 1, focused_verification: 1, review: 1, integration: 1 }, total: 5, changed_files: 1, commits: 1, review_fix_loops: 0, cold_mutation_attempts: 0, mutation_invalidations: 0, mutation_minutes: 0, mutation_shards_actual: 0, preview_rounds: 0, preview_minutes: 0, estimate_variance_minutes: 5 - value.estimate_minutes.total, root_cause: "Deterministic policy fixture" };
  write(root, "docs/readiness/CHG-082.json", JSON.stringify(value));
  const records = genuine ? [decision(value), { story: "CHG-082", event: "started", agent: "fixture" }, { story: "CHG-082", event: "build_pass", notes: "Fixture green gate" }, { story: "CHG-082", event: "done" }] : [{ story: "CHG-082", event: "done" }];
  write(root, ".nous-feedback.jsonl", readFileSync(join(root, ".nous-feedback.jsonl"), "utf8") + records.map(JSON.stringify).join("\n") + "\n");
  if (genuine) assert.equal(validateAssessment(value, { feedbackRecords: records }).complete, true);
  return commit(root, "CHG-082 integrate completed policy");
}
const mixed = (body) => assert.throws(body, { code: "WR_MIXED_FUNCTIONAL_TOOLING" });

test("CHG-082 counts 21 paths with five closed-list bookkeeping as 16 delivery", async () => {
  const policy = await import("./work-readiness/delivery-policy.mjs");
  const paths = [...Array.from({ length: 16 }, (_, i) => `apps/web/src/source${i}.ts`), "docs/readiness/US-901.json", "docs/readiness/drafts/request.md", "docs/superpowers/specs/item.md", "docs/superpowers/plans/item.md", ".nous-feedback.jsonl"];
  const counts = policy.deliveryFileSignals(paths);
  assert.deepEqual(counts, { expected_changed_files: 16, bookkeeping_files: 5 });
  const value = artifact(); Object.assign(value.signals, counts); refresh(value);
  assert.equal(validateAssessment(value, { feedbackRecords: [decision(value)], deliveryPolicy: true }).decision, "ready");
  value.signals.expected_changed_files = 21; refresh(value);
  assert.throws(() => validateAssessment(value, { feedbackRecords: [decision(value)], deliveryPolicy: true }), { code: "WR_TOO_MANY_FILES" });
  assert.deepEqual(policy.deliveryFileSignals(["docs/readiness-other/a", "docs/superpowers/specs-other/a", ".nous-feedback.jsonl.bak"]), { expected_changed_files: 3, bookkeeping_files: 0 });
});
test("CHG-082 prospective field omission fails while historical payload stays valid", () => {
  const value = artifact(); delete value.signals.bookkeeping_files; refresh(value);
  assert.equal(validateAssessment(value, { feedbackRecords: [decision(value)] }).decision, "ready");
  assert.throws(() => validateAssessment(value, { feedbackRecords: [decision(value)], deliveryPolicy: true }), { code: "WR_MISSING_PROPERTY" });
  for (const invalid of [-1, 1.5, "5"]) { value.signals.bookkeeping_files = invalid; refresh(value); assert.throws(() => validateAssessment(value, { feedbackRecords: [decision(value)] }), { code: "WR_INVALID_INTEGER" }); }
});

test("CHG-082 allows new route owned by this item across earlier commits", () => fixture(({ root, authority }) => {
  write(root, "apps/web/src/owned.ts", "export const owned = 2;\n"); commit(root, "US-901 deliver source");
  const base = git(root, "rev-parse", "HEAD");
  write(root, "scripts/mutation-routes.json", JSON.stringify({ "apps/web/src/foreign.ts": ["apps/web/src/oracle.test.ts"], "apps/web/src/owned.ts": ["apps/web/src/extra.test.ts"] }));
  const head = commit(root, "US-901 add responsible route");
  assert.equal(ownership.validateFunctionalDelivery({ root, base, head, workId: "US-901", authority }), true);
}));
test("CHG-082 existing keys may append existing test values without source edit", () => fixture(({ root, authority }) => {
  write(root, "scripts/mutation-routes.json", JSON.stringify({ "apps/web/src/foreign.ts": ["apps/web/src/oracle.test.ts", "apps/web/src/extra.test.ts"] }));
  const head = commit(root, "US-901 append test");
  assert.equal(ownership.validateFunctionalDelivery({ root, base: authority, head, workId: "US-901", authority }), true);
}));
for (const mode of ["unowned", "foreign-commit", "remove", "alter", "reorder", "script", "missing-test", "unsafe-test", "symlink-test", "unsafe-source", "metadata", "json-array"]) {
  test(`CHG-082 rejects ${mode} route or executable tooling`, () => fixture(({ root, authority }) => {
    let routes = { "apps/web/src/foreign.ts": ["apps/web/src/oracle.test.ts"] };
    if (mode === "foreign-commit") { write(root, "apps/web/src/owned.ts", "export const owned = 3;\n"); commit(root, "US-902 unrelated source"); }
    if (["unowned", "foreign-commit"].includes(mode)) routes["apps/web/src/owned.ts"] = ["apps/web/src/extra.test.ts"];
    if (mode === "remove") routes = {};
    if (mode === "alter") routes["apps/web/src/foreign.ts"] = ["apps/web/src/extra.test.ts"];
    if (mode === "reorder") routes["apps/web/src/foreign.ts"] = ["apps/web/src/extra.test.ts", "apps/web/src/oracle.test.ts"];
    if (mode === "script") write(root, "scripts/mutation-scope.mjs", "export const threshold = 0;\n");
    if (mode === "missing-test") routes["apps/web/src/foreign.ts"].push("apps/web/src/missing.test.ts");
    if (mode === "unsafe-test") routes["apps/web/src/foreign.ts"].push("apps/web/src/../outside.test.ts");
    if (mode === "symlink-test") { symlinkSync("oracle.test.ts", join(root, "apps/web/src/link.test.ts")); routes["apps/web/src/foreign.ts"].push("apps/web/src/link.test.ts"); }
    if (mode === "unsafe-source") routes["../outside.ts"] = ["apps/web/src/extra.test.ts"];
    if (mode === "metadata") routes.threshold = 0;
    if (mode === "json-array") routes = [];
    write(root, "scripts/mutation-routes.json", JSON.stringify(routes));
    const head = commit(root, "US-901 change delivery");
    mixed(() => ownership.validateFunctionalDelivery({ root, base: authority, head, workId: "US-901", authority }));
  }));
}

test("CHG-082 full-table routing equals immutable predecessor for every source", async () => {
  const { DIRECT_TEST_ROUTES, routedTestFiles } = await import("./mutation-scope.mjs");
  const sourceRoot = new URL("../", import.meta.url).pathname;
  const oldScript = git(sourceRoot, "show", "fd73ee3:scripts/mutation-scope.mjs");
  const tableText = /export const DIRECT_TEST_ROUTES = (\{[\s\S]*?\n\});/.exec(oldScript)[1];
  const oldRoutes = JSON.parse(tableText.replace(/,\s*([}\]])/g, "$1"));
  const newRoutes = JSON.parse(readFileSync(new URL("./mutation-routes.json", import.meta.url)));
  assert.equal(Object.keys(oldRoutes).length, 57);
  assert.deepEqual(DIRECT_TEST_ROUTES, newRoutes);
  for (const source of Object.keys(oldRoutes)) {
    assert.deepEqual(routedTestFiles([], [source], () => true, newRoutes), routedTestFiles([], [source], () => true, oldRoutes), source);
  }
});

test("CHG-082 immutable payload introductions preserve history and require new omitted-field payloads", () => fixture(({ root, value }) => {
  activate(root);
  assert.equal(ownership.readinessDeliveryPolicy({ root, revision: "HEAD", artifact: value }), false);
  value.title = "A newly assessed outcome in the old file"; refresh(value);
  write(root, "docs/readiness/US-901.json", JSON.stringify(value)); commit(root, "US-901 replace assessment payload");
  assert.equal(ownership.readinessDeliveryPolicy({ root, revision: "HEAD", artifact: value }), true);
  const later = artifact("US-903"); delete later.signals.bookkeeping_files; refresh(later);
  assert.equal(ownership.readinessDeliveryPolicy({ root, revision: "HEAD", artifact: later }), true);
  write(root, "docs/readiness/US-903.json", JSON.stringify(later)); commit(root, "US-903 introduce pending assessment");
  assert.equal(ownership.readinessDeliveryPolicy({ root, revision: "HEAD", artifact: later }), true);
}));
test("CHG-082 raw done cannot activate prospective rules", () => fixture(({ root }) => {
  activate(root, { genuine: false });
  assert.equal(ownership.readinessDeliveryPolicy({ root, revision: "HEAD", artifact: artifact("US-903") }), false);
}));

for (const mode of ["responsible", "unowned", "alter", "script"]) {
  test(`CHG-082 actual ownership gate ${mode}`, () => fixture(({ root }) => {
    activate(root);
    const value = artifact(); value.approval.evidence = "US901-FUTURE";
    write(root, "docs/readiness/US-901.json", JSON.stringify(value));
    write(root, ".nous-feedback.jsonl", readFileSync(join(root, ".nous-feedback.jsonl"), "utf8") + JSON.stringify(decision(value)) + "\n");
    const base = commit(root, "US-901 approve future assessment");
    let routes = { "apps/web/src/foreign.ts": ["apps/web/src/oracle.test.ts"] };
    if (mode === "responsible") write(root, "apps/web/src/owned.ts", "export const owned = 7;\n");
    if (["responsible", "unowned"].includes(mode)) routes["apps/web/src/owned.ts"] = ["apps/web/src/extra.test.ts"];
    if (mode === "alter") routes["apps/web/src/foreign.ts"] = ["apps/web/src/extra.test.ts"];
    if (mode === "script") write(root, "scripts/mutation-scope.mjs", "export const instrumentation = false;\n");
    write(root, "scripts/mutation-routes.json", JSON.stringify(routes));
    const head = commit(root, "US-901 functional delivery");
    if (mode === "responsible") assert.equal(ownership.validateRangeOwnership({ root, base, head }).classification, "implementation");
    else mixed(() => ownership.validateRangeOwnership({ root, base, head }));
  }));
}
