#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const node = process.execPath;
const failures = [];

function run(name, records, expectedExit, files = {}, expectedError = null) {
  const root = mkdtempSync(join(tmpdir(), "smp-feedback-order-"));
  try {
    writeFileSync(join(root, ".nous-feedback.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    for (const [path, contents] of Object.entries(files)) {
      const absolute = join(root, path);
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, contents);
    }
    const result = spawnSync(node, [join(repo, "scripts", "check-nous-feedback-order.mjs"), root], { encoding: "utf8" });
    if (result.status !== expectedExit) failures.push(`${name}: expected exit ${expectedExit}, got ${result.status}: ${result.stderr}`);
    if (expectedError !== null && !result.stderr.includes(expectedError)) failures.push(`${name}: missing expected error ${expectedError}: ${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

run("later valid story", [
  { story: "US-001", event: "started", agent: "test", ts: "2026-07-24T08:00:00.000Z" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "test", pass: true, notes: "ok", ts: "2026-07-24T08:01:00.000Z" },
  { story: "US-001", event: "build_pass", notes: "ok", ts: "2026-07-24T08:02:00.000Z" },
  { story: "US-001", event: "done", ts: "2026-07-24T08:03:00.000Z" },
  { story: "US-002", event: "started", agent: "test", ts: "2026-07-24T08:04:00.000Z" },
], 0);
// CHG-029: a signed approval is required BEFORE work begins, so `decision`
// necessarily precedes `started`; a partition record is never started at all.
run("decision before started is allowed", [
  { story: "CHG-100", event: "decision", id: "CHG100-READY", text: `Decision ready for readiness payload SHA-256 ${"a".repeat(64)}.`, reason: "Approved assessment", ts: "2026-07-24T08:00:00.000Z" },
  { story: "CHG-100", event: "started", agent: "test", ts: "2026-07-24T08:01:00.000Z" },
  { story: "CHG-100", event: "build_pass", notes: "ok", ts: "2026-07-24T08:02:00.000Z" },
  { story: "CHG-100", event: "done", ts: "2026-07-24T08:03:00.000Z" },
], 0);
run("decision with no started at all is allowed (partition record)", [
  { story: "CHG-101", event: "decision", id: "CHG101-PARTITION", text: `Decision partition_required for readiness payload SHA-256 ${"b".repeat(64)}.`, reason: "Approved assessment", ts: "2026-07-24T08:00:00.000Z" },
], 0);
// RED fixture: the exemption must stay narrow. A real progress event before
// `started` must still fail; if this ever exits 0 the guard has been lost.
run("build before started fails", [
  { story: "US-900", event: "build_pass", notes: "premature", ts: "2026-07-24T08:00:00.000Z" },
  { story: "US-900", event: "started", agent: "test", ts: "2026-07-24T08:01:00.000Z" },
], 1);
run("same-story execution timestamp regression fails", [
  { story: "US-001", event: "started", agent: "test", ts: "2026-07-24T08:01:00.000Z" },
  { story: "US-001", event: "build_pass", notes: "ok", ts: "2026-07-24T08:00:00.000Z" },
], 1);
run("feedback before started passes", [
  { story: "US-900", event: "feedback", title: "Assessment", description: "Bookkeeping", images: [] },
  { story: "US-900", event: "started", agent: "test" },
], 0);
run("done before build fails", [
  { story: "US-900", event: "started", agent: "test" },
  { story: "US-900", event: "done" },
], 1);
run("duplicate starts still fail", [
  { story: "US-900", event: "started", agent: "test" },
  { story: "US-900", event: "started", agent: "test" },
], 1);
run("parallel-story append order preserves each execution clock", [
  { story: "US-001", event: "started", agent: "test", ts: "2026-07-24T08:00:00Z" },
  { story: "US-002", event: "started", agent: "test", ts: "2026-07-24T09:00:00Z" },
  { story: "US-001", event: "build_pass", notes: "ok", ts: "2026-07-24T08:01:00Z" },
  { story: "US-002", event: "build_pass", notes: "ok", ts: "2026-07-24T09:01:00Z" },
], 0);
run("bookkeeping does not advance or regress an execution clock", [
  { story: "US-001", event: "started", agent: "test", ts: "2026-07-24T08:00:00Z" },
  { story: "US-001", event: "phase", phase: "review", ts: "2026-07-24T10:00:00Z" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "test", pass: true, notes: "bookkeeping", ts: "2026-07-24T07:00:00Z" },
  { story: "US-001", event: "decision", id: "NOTE", text: "Informational ruling", reason: "Bookkeeping", ts: "2026-07-24T11:00:00Z" },
  { story: "US-001", event: "build_pass", notes: "ok", ts: "2026-07-24T08:01:00Z" },
], 0);
run("reason-only deviation preserves append-only descriptive compatibility", [
  { story: "CHG-100", event: "deviation", reason: "Supported emitter registration" },
], 0);
for (const reason of [undefined, "", "   ", 17, null]) {
  run("reason-only deviation rejects absent, blank or non-string reason", [
    { story: "CHG-100", event: "deviation", reason },
  ], 1);
}
run("present malformed deviation notes cannot be rescued by reason", [
  { story: "CHG-100", event: "deviation", notes: null, reason: "Valid fallback text" },
], 1);
for (const event of ["ac_fail", "ac_unverifiable"]) {
  run(`${event} still requires notes`, [{ story: "CHG-100", event, reason: "No fallback for this event" }], 1);
}

const lifecycleStart = { story: "CHG-100", event: "started", agent: "controller", ts: "2026-07-24T08:00:00Z" };
const lifecycleApproval = {
  story: "CHG-100", event: "decision", id: "CHG100-CORRECTION-READY",
  text: `Decision ready for readiness payload SHA-256 ${"a".repeat(64)}.`, reason: "Approved assessment",
  approved_by: "human", subject_work_id: "CHG-100", relationship: "self", ts: "2026-07-24T09:00:00Z",
};
const lifecycleCorrection = {
  story: "CHG-100", event: "lifecycle_corrected", target_event: "started", target_ts: lifecycleStart.ts,
  disposition: "not_execution", reason: "Readiness bookkeeping", approved_by: "human", ts: "2026-07-24T10:00:00Z",
};
run("registered lifecycle correction validates its own constrained contract", [lifecycleStart, lifecycleApproval, lifecycleCorrection], 0);
run("lifecycle correction rejects execution evidence before approval", [
  lifecycleStart, { story: "CHG-100", event: "build_pass", notes: "real execution", ts: "2026-07-24T08:01:00Z" },
  lifecycleApproval, lifecycleCorrection,
], 1, {}, "WR_CORRECTION_INVALID");
run("lifecycle correction rejects a foreign target", [
  lifecycleStart, lifecycleApproval, { ...lifecycleCorrection, story: "CHG-101" },
], 1, {}, "WR_CORRECTION_INVALID");
run("invalid lifecycle", [
  { story: "US-001", event: "done", ts: "2026-07-24T08:00:00.000Z" },
], 1);

run("all canonical feedback categories", [
  { story: "US-001", event: "started", agent: "test" },
  { story: "US-001", event: "ac_pass", ac: 1, notes: "ok" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "test", pass: true, notes: "ok" },
  { story: "US-001", event: "blocked", reason: "dependency", needs: "decision" },
  { story: "US-001", event: "blocker", reason: "dependency" },
  { story: "US-001", event: "deviation", notes: "ok" },
  { story: "US-001", event: "ac_fail", notes: "ok" },
  { story: "US-001", event: "ac_unverifiable", notes: "ok" },
  { story: "US-001", event: "test_report" },
  { story: "US-001", event: "feedback", title: "title", description: "description", images: [] },
  { story: "US-001", event: "nav_gap", route: "/missing" },
  { story: "US-001", event: "decision", id: "DEC-001", text: "text", reason: "reason" },
  { story: "US-001", event: "closed_with_deferrals" },
  { story: "US-001", event: "adversarial_review" },
  { story: "US-001", event: "deferred_memory_saved" },
  { story: "US-001", event: "closure_hygiene" },
  { story: "US-001", event: "implemented_with_external_verification" },
  { story: "US-001", event: "build_pass", notes: "ok" },
  { story: "US-001", event: "done" },
], 0);

const correctedReadiness = readFileSync(join(repo, "docs/readiness/CHG-058.json"), "utf8");
const correctionAuthorityReadiness = readFileSync(join(repo, "docs/readiness/CHG-059.json"), "utf8");
const correctionAuthority = JSON.parse(correctionAuthorityReadiness);
const correctedActuals = JSON.parse(correctedReadiness).actuals;
const replacementActuals = structuredClone(correctedActuals);
replacementActuals.changed_files = 8;
replacementActuals.root_cause = "Raw NUL-delimited Git output proves eight unique changed paths.";
const correctionHistory = [
  { story: "CHG-058", event: "started", agent: "test", ts: "2026-09-08T14:53:25Z" },
  { story: "CHG-058", event: "build_pass", notes: "ok", ts: "2026-09-08T14:53:30Z" },
  { story: "CHG-058", event: "test_report", mutation_score: 100, ts: "2026-09-08T14:54:23Z" },
  { story: "CHG-058", event: "done", ts: "2026-09-08T14:55:14Z" },
  {
    story: "CHG-059",
    event: "decision",
    id: "CHG059-READY",
    text: `Decision ready for readiness payload SHA-256 ${correctionAuthority.readiness_payload_sha256}.`,
    reason: "Primary evidence disproves the immutable measurement.",
    approved_by: "Francisco Lomas",
    subject_work_id: "CHG-059",
    relationship: "self",
    ts: "2026-09-08T15:00:00Z",
  },
];
const canonicalCorrection = {
  story: "CHG-058",
  event: "actuals_corrected",
  ref: "CHG058-ACTUALS-1",
  change: "CHG-059",
  target_actuals_sha256: "dd232b1b4d60216c6ae8b4bb54ab9997b84db9868183ccd28839ba1faefce6d7",
  replacement_actuals: replacementActuals,
  reason: "Formatted display lines inflated the changed-file count.",
  evidence: ["git diff --name-only -z authority/chg-058-base..HEAD reports 8 paths"],
  ts: "2026-09-08T15:30:00Z",
};
const correctionFiles = {
  "docs/readiness/CHG-058.json": correctedReadiness,
  "docs/readiness/CHG-059.json": correctionAuthorityReadiness,
};

run("canonical actuals correction follows terminal and correcting decision", [
  ...correctionHistory,
  canonicalCorrection,
], 0, correctionFiles);

const fractionalHistory = structuredClone(correctionHistory);
fractionalHistory.find((record) => record.event === "done").ts = "2026-09-08T14:55:14.000001Z";
fractionalHistory.find((record) => record.event === "decision").ts = "2026-09-08T14:55:14.0000015Z";
run("fractional UTC ordering preserves nine digits like Nous", [
  ...fractionalHistory,
  { ...structuredClone(canonicalCorrection), ts: "2026-09-08T14:55:14.000002Z" },
], 0, correctionFiles);

run("actuals correction cannot precede its terminal", [
  correctionHistory[0],
  correctionHistory[1],
  correctionHistory[2],
  correctionHistory[4],
  canonicalCorrection,
  correctionHistory[3],
], 1, correctionFiles);

run("actuals correction requires a prior correcting decision", [
  ...correctionHistory.filter((record) => record.event !== "decision"),
  canonicalCorrection,
], 1, correctionFiles);

run("actuals correction fails when no terminal ever appears", [
  ...correctionHistory.filter((record) => record.event !== "done"),
  canonicalCorrection,
], 1, correctionFiles);

for (const [name, mutate] of [
  ["legacy prose decision", (decision) => {
    decision.text = "Legacy prose authorization.";
    delete decision.approved_by;
    delete decision.subject_work_id;
    delete decision.relationship;
  }],
  ["blocked readiness decision", (decision) => { decision.text = `Decision blocked for readiness payload SHA-256 ${"a".repeat(64)}.`; }],
  ["mismatched decision subject", (decision) => { decision.subject_work_id = "CHG-060"; }],
]) {
  const history = structuredClone(correctionHistory);
  mutate(history.find((record) => record.event === "decision"));
  run(`actuals correction rejects ${name}`, [...history, canonicalCorrection], 1, correctionFiles);
}

for (const [name, mutate] of [
  ["unknown property", (record) => { record.extra = true; }],
  ["empty reason", (record) => { record.reason = ""; }],
  ["empty evidence", (record) => { record.evidence = []; }],
  ["malformed change", (record) => { record.change = "IMP-404"; }],
  ["non-UTC timestamp", (record) => { record.ts = "2026-09-08T10:30:00-05:00"; }],
  ["partial replacement", (record) => { record.replacement_actuals = { changed_files: 8 }; }],
  ["bad replacement arithmetic", (record) => { record.replacement_actuals.total += 1; }],
  ["forged target hash", (record) => { record.target_actuals_sha256 = "f".repeat(64); }],
]) {
  const correction = structuredClone(canonicalCorrection);
  mutate(correction);
  run(`actuals correction rejects ${name}`, [...correctionHistory, correction], 1, correctionFiles);
}

run("actuals correction refs are globally unique", [
  ...correctionHistory,
  canonicalCorrection,
  { ...structuredClone(canonicalCorrection), story: "US-999" },
], 1, correctionFiles);

for (const terminal of ["done", "verified", "done_with_deferral", "done_with_external_deferral"]) {
  run(`${terminal} requires build_pass`, [
    { story: "US-001", event: "started", agent: "test" },
    { story: "US-001", event: terminal },
  ], 1);
  run(`${terminal} accepts prior build_pass`, [
    { story: "US-001", event: "started", agent: "test" },
    { story: "US-001", event: "build_pass", notes: "ok" },
    { story: "US-001", event: terminal },
  ], 0);
}

const priorEvidence = [
  { story: "US-001", event: "started", agent: "test" },
  { story: "US-001", event: "ac_verify", ac: 1, method: "old", pass: true, notes: "old" },
  { story: "US-001", event: "build_pass", notes: "old build" },
  { story: "US-001", event: "done" },
  { story: "CHG-007", event: "started", agent: "test" },
  { story: "CHG-007", event: "decision", id: "CHG007-TEST", text: "repair", reason: "review" },
];
const supersededBuild = {
  story: "US-001",
  event: "evidence_superseded",
  ref: "US001-BUILD-1",
  target: { story: "US-001", event: "build_pass" },
  reason: "post-change gates required",
};
const supersededDone = {
  story: "US-001",
  event: "evidence_superseded",
  ref: "US001-DONE-1",
  target: { story: "US-001", event: "done" },
  reason: "post-change terminal evidence required",
};
run("append-only supersession projects one post-change evidence chain", [
  ...priorEvidence,
  supersededBuild,
  supersededDone,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-DONE-1",
    change: "CHG-007",
    as_event: "done",
  },
], 0);
run("a later change can supersede prior projected revalidation evidence", [
  ...priorEvidence,
  supersededBuild,
  supersededDone,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "first repaired head",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-DONE-1",
    change: "CHG-007",
    as_event: "done",
  },
  { story: "CHG-008", event: "started", agent: "test" },
  { story: "CHG-008", event: "decision", id: "CHG008-TEST", text: "repair again", reason: "review" },
  {
    story: "US-001",
    event: "evidence_superseded",
    ref: "US001-BUILD-2",
    target: { ref: "US001-BUILD-1" },
    reason: "new head gates required",
  },
  {
    story: "US-001",
    event: "evidence_superseded",
    ref: "US001-DONE-2",
    target: { ref: "US001-DONE-1" },
    reason: "new terminal evidence required",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-2",
    change: "CHG-008",
    as_event: "build_pass",
    notes: "second repaired head",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-DONE-2",
    change: "CHG-008",
    as_event: "done",
  },
], 0);
run("supersession rejects a missing target", [
  ...priorEvidence,
  {
    ...supersededBuild,
    target: { story: "US-999", event: "build_pass" },
  },
], 1);
run("supersession rejects an ambiguous target", [
  ...priorEvidence.slice(0, 3),
  { story: "US-001", event: "build_pass", notes: "second build" },
  ...priorEvidence.slice(3),
  supersededBuild,
], 1);
run("supersession requires a later revalidation", [
  ...priorEvidence,
  supersededBuild,
], 1);
run("revalidation requires a prior unique supersession reference", [
  ...priorEvidence,
  {
    story: "US-001",
    event: "revalidated",
    ref: "MISSING",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
], 1);
run("revalidation rejects a duplicate reference", [
  ...priorEvidence,
  supersededBuild,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "duplicate",
  },
], 1);
run("revalidation requires an earlier change decision", [
  ...priorEvidence.slice(0, 4),
  supersededBuild,
  {
    story: "US-001",
    event: "revalidated",
    ref: "US001-BUILD-1",
    change: "CHG-007",
    as_event: "build_pass",
    notes: "new head gates passed",
  },
  ...priorEvidence.slice(4),
], 1);

// CHG-091: capture actual closed CHG-089 bytes from the committed project
// bundle; disposable repositories independently commit the authority first.
const annotationRaw = readFileSync(join(repo, ".nous-feedback.jsonl"), "utf8").split("\n").find((line) => {
  const record = line ? JSON.parse(line) : {};
  return record.story === "US-024" && record.ts === "2026-10-12T03:00:34.941232Z";
});
assert.equal(createHash("sha256").update(annotationRaw).digest("hex"), "d1dba52d00fd4b60aa47a2654e4ee4c82f229370966d1dcdfea2c5911b6150bd");
const actualAnnotationAuthorityBytes = readFileSync(join(repo, "docs/readiness/CHG-089.json"), "utf8");
const actualAnnotationAuthority = JSON.parse(actualAnnotationAuthorityBytes);
const annotationDecision = {
  story: "CHG-089", event: "decision", id: actualAnnotationAuthority.approval.evidence,
  text: `Decision ready for readiness payload SHA-256 ${actualAnnotationAuthority.readiness_payload_sha256}.`,
  reason: "Approved technical correction", approved_by: actualAnnotationAuthority.approval.approved_by,
  subject_work_id: "CHG-089", relationship: "self", ts: "2026-10-12T03:22:25.308Z",
};
const exactAnnotationCorrection = {
  story: "US-024", event: "lifecycle_corrected", target_event: "deviation",
  target_ts: "2026-10-12T03:00:34.941232Z", target_sha256: "d1dba52d00fd4b60aa47a2654e4ee4c82f229370966d1dcdfea2c5911b6150bd",
  disposition: "not_execution", reason: "Approved CHG-089 annotation correction",
  approved_by: actualAnnotationAuthority.approval.approved_by,
  authority: { work_id: "CHG-089", payload_sha256: actualAnnotationAuthority.readiness_payload_sha256, evidence: actualAnnotationAuthority.approval.evidence },
  ts: "2026-10-12T03:30:00Z",
};
for (const variant of ["valid", "missing", "mismatched", "unapproved", "uncommitted", "raw bytes", "wrong actor", "cross story", "wrong target", "duplicate", "terminal", "line diagnostics"]) {
  const root = mkdtempSync(join(tmpdir(), "smp-feedback-annotation-"));
  try {
    const git = (args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(["init", "--initial-branch=main"]);
    git(["config", "user.email", "fixture@example.test"]); git(["config", "user.name", "Fixture"]);
    mkdirSync(join(root, "docs/readiness"), { recursive: true });
    const artifact = structuredClone(actualAnnotationAuthority);
    if (variant === "unapproved") artifact.approval.status = "pending";
    if (variant === "mismatched") artifact.approval.payload_sha256 = "0".repeat(64);
    const authorityPath = join(root, "docs/readiness/CHG-089.json");
    if (!["missing", "uncommitted"].includes(variant)) writeFileSync(authorityPath, JSON.stringify(artifact));
    writeFileSync(join(root, ".nous-feedback.jsonl"), `${annotationRaw}\n${JSON.stringify(annotationDecision)}\n`);
    git(["add", "."]); git(["commit", "-m", "docs(CHG-089): independent authority"]);
    if (variant === "uncommitted") writeFileSync(authorityPath, actualAnnotationAuthorityBytes);
    const correction = structuredClone(exactAnnotationCorrection);
    if (variant === "wrong actor") correction.approved_by = "forged";
    if (variant === "cross story") correction.story = "US-088";
    if (variant === "wrong target") correction.target_ts = "2026-10-12T03:00:35Z";
    let raw = `${annotationRaw}${variant === "raw bytes" ? " " : ""}\n${JSON.stringify(annotationDecision)}\n`;
    if (variant === "terminal") raw += JSON.stringify({ story: "CHG-089", event: "done", ts: "2026-10-12T03:25:00Z" }) + "\n";
    raw += JSON.stringify(correction) + "\n";
    if (variant === "duplicate") raw += JSON.stringify(correction) + "\n";
    if (variant === "line diagnostics") raw = "\n" + raw + "{invalid\n";
    writeFileSync(join(root, ".nous-feedback.jsonl"), raw);
    const result = spawnSync(node, [join(repo, "scripts/check-nous-feedback-order.mjs"), root], { encoding: "utf8" });
    assert.equal(result.status, variant === "valid" ? 0 : 1, `${variant}: ${result.stderr}`);
    if (variant === "line diagnostics") assert.match(result.stderr, /line 5:/u);
    else if (variant !== "valid") assert.match(result.stderr, /WR_CORRECTION_INVALID/u, variant);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (failures.length) {
  for (const failure of failures) console.error(`[feedback-order test] ${failure}`);
  process.exit(1);
}
console.log("[feedback-order test] ok");
