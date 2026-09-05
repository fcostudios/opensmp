import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { WorkReadinessError, classifyAssessment, validateAssessment, validateCompletionActuals } from "./model.mjs";

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAX_CI_EVENT_BYTES = 1024 * 1024;
const WORK_ID_PATTERN = /(?<![A-Z0-9-])(?:US|CHG)-[0-9]{3,}(?![A-Z0-9-])/giu;
const BOOTSTRAP_DOCUMENT_PREFIXES = [
  "docs/readiness/",
  "docs/superpowers/specs/",
  "docs/superpowers/plans/",
];
const GENERATED_NOUS_PATHS = [
  /^docs\/stories\//u,
  /^docs\/sprints\//u,
];
const IMPLEMENTATION_PLAN_PATTERN = /^docs\/superpowers\/plans\/.+\.md$/u;
const PLAN_HEADER_LIMIT_BYTES = 16 * 1024;
const OVERLAY_LAYER_PATTERN = /^(CHG-[0-9]{3,})\/[a-z0-9]{7,64}$/u;
const ACTIVATION_EVIDENCE = "CHG022-READINESS-V2-APPROVAL";
const CHG022_EXECUTABLE_BOUNDARY = "72f5e8545ea5d98795e2a5f19e62f6ba5e7ae7cb";
// Reviewed fail-closed raw-byte binding for the complete reconciler. Any
// whitespace, definition rebinding, helper, build-plan, or runtime edit
// requires an explicit review and a new digest before ownership is accepted.
// Re-pinned by CHG-024. Reviewed delta against 9ab3409f…d3d8: build_plan's
// mirror source changes from the CHG-001 pinned CLAUDE.md to the layered
// desired text, plus a None-guard so an unresolved CLAUDE.md still surfaces its
// own diagnostic. No helper, overlay-registration, or runtime path is touched.
// test-work-readiness.mjs asserts this constant against the file on disk.
const REVIEWED_RECONCILER_SHA256 = "889a9d0a4f69f8c1491d2221d8072815ae735e7d17488f8165c5ccc2d3356d60";

function isTerminalEvent(event) {
  return event === "done" || event === "verified"
    || (typeof event === "string" && /^done_with_[a-z0-9_]+$/u.test(event));
}

function fail(code, path, message) {
  throw new WorkReadinessError(code, message, path);
}

function git(root, args, { allowMissing = false } = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    fail("WR_GIT_ARGUMENT_INVALID", "$.git", "Git arguments must be NUL-free strings");
  }
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "buffer",
    shell: false,
    maxBuffer: MAX_GIT_OUTPUT_BYTES + 1,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  if (stdout.length > MAX_GIT_OUTPUT_BYTES || stderr.length > MAX_GIT_OUTPUT_BYTES || result.error?.code === "ENOBUFS") {
    fail("WR_GIT_ERROR", "$.git", `Git output exceeds ${MAX_GIT_OUTPUT_BYTES} bytes`);
  }
  if (result.error) fail("WR_GIT_ERROR", "$.git", `Unable to execute Git: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowMissing) return null;
    const detail = stderr.toString("utf8").trim();
    fail("WR_GIT_ERROR", "$.git", detail || `Git exited with status ${String(result.status)}`);
  }
  return stdout;
}

function repositoryRoot(root) {
  if (typeof root !== "string" || root.includes("\0") || !isAbsolute(root)) {
    fail("WR_GIT_ERROR", "$.root", "Repository root must be an absolute NUL-free path");
  }
  let canonical;
  try {
    canonical = realpathSync(root);
  } catch {
    fail("WR_GIT_ERROR", "$.root", "Repository root does not exist");
  }
  const reported = git(canonical, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  let reportedCanonical;
  try {
    reportedCanonical = realpathSync(reported);
  } catch {
    fail("WR_GIT_ERROR", "$.root", "Git reported an unavailable repository root");
  }
  if (reportedCanonical !== canonical) fail("WR_GIT_ERROR", "$.root", "Root must name the repository top level exactly");
  return canonical;
}

function resolveCommit(root, ref, path) {
  if (typeof ref !== "string" || !/\S/u.test(ref) || ref.includes("\0") || ref.startsWith("-")) {
    fail("WR_GIT_ERROR", path, "Git ref must be a non-empty NUL-free non-option string");
  }
  const result = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    encoding: "buffer",
    shell: false,
    maxBuffer: MAX_GIT_OUTPUT_BYTES + 1,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  if (stdout.length > MAX_GIT_OUTPUT_BYTES || stderr.length > MAX_GIT_OUTPUT_BYTES || result.error?.code === "ENOBUFS") {
    fail("WR_GIT_ERROR", path, `Git output exceeds ${MAX_GIT_OUTPUT_BYTES} bytes`);
  }
  if (result.error) fail("WR_GIT_ERROR", path, `Unable to execute Git: ${result.error.message}`);
  const detail = stderr.toString("utf8");
  if (/ambiguous/iu.test(detail)) fail("WR_GIT_ERROR", path, `Git ref ${ref} is ambiguous`);
  if (result.status !== 0) {
    fail("WR_GIT_ERROR", path, `Git ref ${ref} does not resolve to one commit`);
  }
  const sha = stdout.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(sha)) fail("WR_GIT_ERROR", path, `Git ref ${ref} did not resolve to a full commit ID`);
  return sha;
}

function validateRelativePath(path, root = null) {
  if (typeof path !== "string" || path.length === 0 || /[\u0000-\u001f\u007f\ufffd]/u.test(path) || path.includes("\\") || path.includes(":")) {
    fail("WR_GIT_PATH_INVALID", "$.path", "Changed path must be a non-empty canonical Git path");
  }
  if (isAbsolute(path) || path.startsWith("/") || path.endsWith("/") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("WR_GIT_PATH_INVALID", "$.path", `Changed path is not canonical: ${path}`);
  }
  if (root !== null) {
    const absolute = resolve(root, path);
    const lexical = relative(root, absolute);
    if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
      fail("WR_GIT_PATH_ESCAPE", path, `Changed path escapes the repository: ${path}`);
    }
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(absolute);
        const targetRelative = relative(root, target);
        if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
          fail("WR_GIT_PATH_ESCAPE", path, `Changed symlink escapes the repository: ${path}`);
        }
      } else {
        const canonical = realpathSync(absolute);
        const canonicalRelative = relative(root, canonical);
        if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) {
          fail("WR_GIT_PATH_ESCAPE", path, `Changed path resolves outside the repository: ${path}`);
        }
      }
    } catch (error) {
      if (error instanceof WorkReadinessError) throw error;
      // Deleted paths have no filesystem target. Their canonical lexical path was checked above.
    }
  }
  return path;
}

function parseNameStatus(buffer, root) {
  const fields = buffer.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (/^[AMDT]$/u.test(status)) {
      if (index >= fields.length) fail("WR_GIT_ERROR", "$.git", `Missing path for status ${status}`);
      paths.push(validateRelativePath(fields[index], root));
      index += 1;
      continue;
    }
    if (/^[RC][0-9]{1,3}$/u.test(status)) {
      if (index + 1 >= fields.length) fail("WR_GIT_ERROR", "$.git", `Missing rename/copy paths for status ${status}`);
      paths.push(validateRelativePath(fields[index], root), validateRelativePath(fields[index + 1], root));
      index += 2;
      continue;
    }
    fail("WR_GIT_ERROR", "$.git", `Unexpected Git name-status record ${String(status)}`);
  }
  return [...new Set(paths)].sort();
}

function validateRevisionSymlink(root, revision, path) {
  const record = git(root, ["ls-tree", "-z", revision, "--", path]).toString("utf8");
  if (record === "") return;
  const entries = record.split("\0").filter(Boolean);
  if (entries.length !== 1) fail("WR_GIT_ERROR", path, `Expected one tree entry for ${path}`);
  const match = /^(\d{6}) (?:blob|tree) [0-9a-f]{40}\t(.+)$/u.exec(entries[0]);
  if (!match || match[2] !== path) fail("WR_GIT_ERROR", path, `Unexpected tree entry for ${path}`);
  if (match[1] !== "120000") return;
  const target = git(root, ["show", `${revision}:${path}`]).toString("utf8");
  if (target.length === 0 || target.includes("\0") || isAbsolute(target)) {
    fail("WR_GIT_PATH_ESCAPE", path, `Changed symlink has an unsafe target: ${path}`);
  }
  const targetAbsolute = resolve(root, dirname(path), target);
  const targetRelative = relative(root, targetAbsolute);
  if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
    fail("WR_GIT_PATH_ESCAPE", path, `Changed symlink escapes the repository: ${path}`);
  }
}

function revisionMode(root, revision, path) {
  const record = git(root, ["ls-tree", "-z", revision, "--", path], { allowMissing: true });
  if (record === null || record.length === 0) return null;
  const entries = record.toString("utf8").split("\0").filter(Boolean);
  if (entries.length !== 1) return null;
  return /^(\d{6}) (?:blob|tree) [0-9a-f]{40}\t(.+)$/u.exec(entries[0])?.[1] ?? null;
}

function validateIndexSymlink(root, path) {
  const record = git(root, ["ls-files", "--stage", "-z", "--", path]).toString("utf8");
  if (record === "") return;
  const entries = record.split("\0").filter(Boolean);
  if (entries.length !== 1) fail("WR_GIT_ERROR", path, `Expected one index entry for ${path}`);
  const match = /^(\d{6}) [0-9a-f]{40} 0\t(.+)$/u.exec(entries[0]);
  if (!match || match[2] !== path) fail("WR_GIT_ERROR", path, `Unexpected index entry for ${path}`);
  if (match[1] !== "120000") return;
  const target = git(root, ["show", `:${path}`]).toString("utf8");
  if (target.length === 0 || target.includes("\0") || isAbsolute(target)) {
    fail("WR_GIT_PATH_ESCAPE", path, `Staged symlink has an unsafe target: ${path}`);
  }
  const targetAbsolute = resolve(root, dirname(path), target);
  const targetRelative = relative(root, targetAbsolute);
  if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
    fail("WR_GIT_PATH_ESCAPE", path, `Staged symlink escapes the repository: ${path}`);
  }
}

function readRevisionFile(root, revision, path, { required = true } = {}) {
  validateRelativePath(path);
  const contents = git(root, ["show", `${revision}:${path}`], { allowMissing: !required });
  if (contents === null && required) fail("WR_GIT_ERROR", path, `Required file ${path} is unavailable at ${revision}`);
  return contents?.toString("utf8") ?? null;
}

function readRevisionBytes(root, revision, path, { required = true } = {}) {
  validateRelativePath(path);
  const contents = git(root, ["show", `${revision}:${path}`], { allowMissing: !required });
  if (contents === null && required) fail("WR_GIT_ERROR", path, `Required file ${path} is unavailable at ${revision}`);
  return contents;
}

function parseFeedback(text) {
  if (text === null || text.trim() === "") return [];
  return text.split(/\r?\n/u).filter((line) => line.length > 0).map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("record is not an object");
      return value;
    } catch (error) {
      fail("WR_FEEDBACK_INVALID", `.nous-feedback.jsonl:${index + 1}`, `Invalid feedback JSON: ${error.message}`);
    }
  });
}

const KNOWN_FEEDBACK_EVENTS = new Set([
  "started", "done", "verified", "done_with_deferral", "done_with_external_deferral", "ac_pass", "ac_verify",
  "blocked", "blocker", "deviation", "ac_fail", "ac_unverifiable", "test_report", "feedback", "nav_gap",
  "evidence_superseded", "revalidated", "decision", "build_pass", "closed_with_deferrals", "adversarial_review",
  "deferred_memory_saved", "closure_hygiene", "implemented_with_external_verification", "mutation_invalidation",
  "checkpoint",
]);

function validateFeedbackStructure(records) {
  const lifecycle = new Map();
  records.forEach((record, index) => {
    const path = `.nous-feedback.jsonl:${index + 1}`;
    const terminal = record.event === "done" || record.event === "verified"
      || (typeof record.event === "string" && /^done_with_[a-z0-9_]+$/u.test(record.event));
    if (typeof record.story !== "string" || !/\S/u.test(record.story)
      || typeof record.event !== "string" || (!KNOWN_FEEDBACK_EVENTS.has(record.event) && !terminal)) {
      fail("WR_FEEDBACK_INVALID", path, "Feedback record requires a non-empty story and known event");
    }
    if (record.ts !== undefined && (typeof record.ts !== "string" || Number.isNaN(Date.parse(record.ts)))) {
      fail("WR_FEEDBACK_INVALID", path, "Feedback ts must be an ISO timestamp");
    }
    const required = record.event === "started" ? [["agent", "string"]]
      : record.event === "ac_pass" ? [["ac", "integer"], ["notes", "string"]]
        : record.event === "ac_verify" ? [["ac", "integer"], ["method", "string"], ["pass", "boolean"], ["notes", "string"]]
          : record.event === "build_pass" ? [["notes", "string"]]
            : record.event === "decision" ? [["id", "string"], ["text", "string"], ["reason", "string"]]
              : record.event === "checkpoint" ? [["elapsed_minutes", "integer"], ["status", "string"]]
              : record.event === "feedback" ? [["title", "string"], ["description", "string"], ["images", "array"]]
                : ["blocked", "blocker"].includes(record.event) ? [["reason", "string"]]
                  : record.event === "nav_gap" ? [["route", "string"]]
                    : record.event === "evidence_superseded" ? [["ref", "string"], ["reason", "string"], ["target", "object"]]
                      : record.event === "revalidated" ? [["ref", "string"], ["change", "string"], ["as_event", "string"]]
                        : [];
    for (const [key, type] of required) {
      const value = record[key];
      const valid = type === "integer" ? Number.isInteger(value)
        : type === "array" ? Array.isArray(value)
          : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
            : typeof value === type;
      if (!valid) fail("WR_FEEDBACK_INVALID", path, `${record.event} requires ${key} as ${type}`);
    }
    const state = lifecycle.get(record.story) ?? { started: false, buildPassed: false };
    if (record.event === "started") {
      if (state.started) fail("WR_FEEDBACK_ORDER", path, `${record.story} started more than once`);
      state.started = true;
    } else if (["ac_pass", "ac_verify", "build_pass"].includes(record.event) || terminal) {
      if (!state.started) fail("WR_FEEDBACK_ORDER", path, `${record.event} occurs before started`);
      if (terminal && !state.buildPassed) {
        fail("WR_FEEDBACK_ORDER", path, `${record.event} occurs before build_pass`);
      }
    }
    if (record.event === "build_pass") state.buildPassed = true;
    lifecycle.set(record.story, state);
  });
}

function validateFeedbackHistoryTransition(root, parent, candidate) {
  const path = ".nous-feedback.jsonl";
  const parentBytes = readRevisionBytes(root, parent, path, { required: false }) ?? Buffer.alloc(0);
  const candidateBytes = readRevisionBytes(root, candidate, path, { required: false }) ?? Buffer.alloc(0);
  const historyError = (message) => fail("WR_FEEDBACK_HISTORY_MUTATED", path, message);

  if (!candidateBytes.subarray(0, parentBytes.length).equals(parentBytes)) {
    historyError("Feedback history must preserve every parent byte in exact order");
  }
  if (candidateBytes.length !== parentBytes.length) {
    if (candidateBytes.at(-1) !== 0x0a) historyError("Appended feedback must end at a complete newline-delimited record boundary");
    let appended = candidateBytes.subarray(parentBytes.length);
    if (parentBytes.length > 0 && parentBytes.at(-1) !== 0x0a) {
      if (appended[0] !== 0x0a) historyError("Appending after a non-newline parent requires an exact record separator");
      appended = appended.subarray(1);
    } else if (appended[0] === 0x0a) {
      historyError("Appended feedback cannot insert an empty JSONL record");
    }
    if (appended.length === 0) historyError("A feedback transition must append at least one complete JSON object");
    const appendedLines = appended.toString("utf8").slice(0, -1).split("\n");
    for (const line of appendedLines) {
      if (line.replace(/\r$/u, "").length === 0) historyError("Appended feedback cannot contain empty JSONL records");
    }
  }
  const candidateRecords = parseFeedback(candidateBytes.toString("utf8"));
  validateFeedbackStructure(candidateRecords);
  return candidateRecords;
}

function parseJson(text, path) {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("document is not an object");
    return value;
  } catch (error) {
    fail("WR_READINESS_INVALID", path, `Invalid readiness JSON: ${error.message}`);
  }
}

function parseImplementationPlanHeader(text, path, { required = true } = {}) {
  if (typeof text !== "string" || text.includes("\0") || Buffer.byteLength(text, "utf8") > PLAN_HEADER_LIMIT_BYTES * 64) {
    fail("WR_PLAN_HEADER_INVALID", path, "Implementation plan must be bounded UTF-8 Markdown without NUL bytes");
  }
  const prefix = text.slice(0, PLAN_HEADER_LIMIT_BYTES);
  const pattern = /^\*\*Work item:\*\* ((?:US|CHG)-[0-9]{3,})\r?\n\*\*Readiness assessment:\*\* ([^\r\n]+)\r?\n\*\*Approved estimate:\*\* ([0-9]+) minutes(?=\r?\n\r?\n|$)/u;
  const match = pattern.exec(prefix);
  if (match === null) {
    if (!required) return null;
    const code = prefix.startsWith("**Work item:**") ? "WR_PLAN_HEADER_INVALID" : "WR_PLAN_HEADER_MISSING";
    fail(code, path, "Implementation plan requires the exact byte-zero Work item, Readiness assessment, and Approved estimate header");
  }
  const metadataKeys = text.match(/^\*\*(?:Work item|Readiness assessment|Approved estimate):\*\*/gmu) ?? [];
  if (metadataKeys.length !== 3) fail("WR_PLAN_HEADER_INVALID", path, "Implementation plan metadata keys must occur exactly once in the byte-zero header");
  const estimate = Number(match[3]);
  if (!Number.isSafeInteger(estimate)) fail("WR_PLAN_HEADER_INVALID", path, "Approved estimate must be a safe integer number of minutes");
  return { workId: match[1], readinessPath: match[2], estimate };
}

function validatePlanBinding({ root, revision, authorizationRevision, feedback, planPath, expectedWorkId = null }) {
  const header = parseImplementationPlanHeader(readRevisionFile(root, revision, planPath), planPath);
  if (expectedWorkId !== null && header.workId !== expectedWorkId) {
    fail("WR_PLAN_WORK_ID_MISMATCH", planPath, `Plan work item ${header.workId} does not match ${expectedWorkId}`);
  }
  validateRelativePath(header.readinessPath);
  const expectedPath = `docs/readiness/${header.workId}.json`;
  if (header.readinessPath !== expectedPath) {
    fail("WR_PLAN_READINESS_PATH_MISMATCH", planPath, `Plan readiness path must be exactly ${expectedPath}`);
  }
  const artifactText = readRevisionFile(root, authorizationRevision, expectedPath, { required: false });
  if (artifactText === null) fail("WR_READINESS_MISSING", expectedPath, `Implementation plan for ${header.workId} requires prior readiness approval`);
  const assessment = parseJson(artifactText, expectedPath);
  if (assessment.work_id !== header.workId) fail("WR_READINESS_WORK_ID_MISMATCH", expectedPath, `Artifact work_id does not match ${header.workId}`);
  const validated = validateAssessment(assessment, { feedbackRecords: feedback });
  if (assessment.decision !== "ready") fail("WR_WORK_NOT_READY", expectedPath, `${header.workId} is ${String(assessment.decision)}, not ready`);
  if (!validated.active) fail("WR_APPROVAL_INACTIVE", expectedPath, `${header.workId} readiness authorization is inactive`);
  if (header.estimate > assessment.estimate_minutes.total) {
    fail("WR_PLAN_ESTIMATE_OVER_BUDGET", planPath, `Plan estimate ${header.estimate} exceeds approved ${assessment.estimate_minutes.total} minutes`);
  }
  return { ...header, planPath };
}

function implementationPlanPaths(root, revision) {
  const output = git(root, ["ls-tree", "-r", "--name-only", "-z", revision, "--", "docs/superpowers/plans"]);
  return output.toString("utf8").split("\0").filter((path) => path.length > 0 && IMPLEMENTATION_PLAN_PATTERN.test(path));
}

function requireImplementationPlan({ root, revision, feedback, workId }) {
  const matches = [];
  for (const planPath of implementationPlanPaths(root, revision)) {
    const text = readRevisionFile(root, revision, planPath);
    const header = parseImplementationPlanHeader(text, planPath, { required: false });
    if (header?.workId === workId) matches.push(planPath);
  }
  if (matches.length === 0) fail("WR_IMPLEMENTATION_PLAN_MISSING", `docs/superpowers/plans/${workId}.md`, `${workId} implementation requires one readiness-bound plan`);
  if (matches.length !== 1) fail("WR_IMPLEMENTATION_PLAN_AMBIGUOUS", "docs/superpowers/plans", `${workId} has more than one readiness-bound plan`);
  return validatePlanBinding({ root, revision, authorizationRevision: revision, feedback, planPath: matches[0], expectedWorkId: workId });
}

// CHG-037 §3 — the artifact↔feedback checkpoint bijection is gone:
// canonicalFeedbackCheckpoint, validateCheckpointTransition and
// validateAllCheckpointTransitions. It existed only to mirror the clock above,
// so with the clock removed it guarded an empty set.
//
// validateFeedbackHistoryTransition SURVIVES. The parent design listed
// WR_FEEDBACK_HISTORY_MUTATED as bijection machinery; it is not. That function is
// a pure byte-prefix append-only guard on .nous-feedback.jsonl and never reads the
// artifact side — it is what makes the ONE surviving ledger trustworthy.
// validateAllActualTransitions survives too; actuals are not checkpoints.
function validateAllActualTransitions({ root, parent, commit, changedPaths, parentFeedback, candidateFeedback }) {
  const appendedFeedback = candidateFeedback.slice(parentFeedback.length);
  const workIds = new Set();
  changedPaths.forEach((path) => {
    const match = /^docs\/readiness\/((?:US|CHG)-[0-9]{3,})\.json$/u.exec(path);
    if (match) workIds.add(match[1]);
  });
  appendedFeedback.forEach((record) => {
    if ((isTerminalEvent(record.event) || ["evidence_superseded", "revalidated"].includes(record.event))
      && typeof record.story === "string" && /^(?:US|CHG)-[0-9]{3,}$/u.test(record.story)) workIds.add(record.story);
  });
  for (const workId of workIds) {
    const readinessPath = `docs/readiness/${workId}.json`;
    const parentText = readRevisionFile(root, parent, readinessPath, { required: false });
    const candidateText = readRevisionFile(root, commit, readinessPath, { required: false });
    const parentArtifact = parentText === null ? null : parseJson(parentText, readinessPath);
    const candidateArtifact = candidateText === null ? null : parseJson(candidateText, readinessPath);
    const parentComplete = parentArtifact === null ? false : validateCompletionActuals(parentArtifact, parentFeedback).complete;
    if (parentComplete && (candidateArtifact === null || JSON.stringify(candidateArtifact.actuals) !== JSON.stringify(parentArtifact.actuals))) {
      fail("WR_ACTUALS_IMMUTABLE", "$.actuals", "Completion actuals are immutable after the first effective terminal");
    }
    if (candidateArtifact === null) {
      if (appendedFeedback.some((record) => record.story === workId && isTerminalEvent(record.event))) {
        fail("WR_READINESS_MISSING", readinessPath, "Terminal evidence requires a readiness artifact with complete actuals");
      }
      continue;
    }
    validateCompletionActuals(candidateArtifact, candidateFeedback);
  }
}

function validateChangedMachineArtifacts(root, revision, changedPaths) {
  if (changedPaths.includes(".nous-feedback.jsonl")) {
    const records = parseFeedback(readRevisionFile(root, revision, ".nous-feedback.jsonl"));
    validateFeedbackStructure(records);
  }
  for (const path of changedPaths.filter((candidate) => /^docs\/readiness\/(?:US|CHG)-[0-9]{3,}\.json$/u.test(candidate))) {
    const assessment = parseJson(readRevisionFile(root, revision, path), path);
    const expectedWorkId = path.slice("docs/readiness/".length, -".json".length);
    classifyAssessment(assessment);
    if (assessment.work_id !== expectedWorkId) fail("WR_READINESS_WORK_ID_MISMATCH", path, `Artifact work_id does not match ${expectedWorkId}`);
  }
}

function closedKeys(record, keys) {
  return record !== null && typeof record === "object" && !Array.isArray(record)
    && Object.keys(record).sort().join(",") === [...keys].sort().join(",");
}

function validDecision(record) {
  return closedKeys(record, ["story", "event", "id", "text", "reason"])
    && record.event === "decision"
    && [record.story, record.id, record.text, record.reason].every((value) => typeof value === "string" && /\S/u.test(value));
}

function validatedActivationIndex(root, base, feedback) {
  const candidates = feedback.map((record, index) => ({ record, index }))
    .filter(({ record }) => record.story === "CHG-022" && record.event === "decision" && record.id === ACTIVATION_EVIDENCE);
  if (candidates.length !== 1 || !validDecision(candidates[0].record)) return -1;
  const artifactPath = "docs/readiness/CHG-022.json";
  const artifactText = readRevisionFile(root, base, artifactPath, { required: false });
  if (artifactText === null) return -1;
  try {
    const artifact = parseJson(artifactText, artifactPath);
    validateAssessment(artifact, { feedbackRecords: feedback.slice(0, candidates[0].index + 1) });
    return candidates[0].index;
  } catch {
    return -1;
  }
}

function validStarted(record) {
  const keys = record.ts === undefined ? ["story", "event", "agent"] : ["story", "event", "agent", "ts"];
  return closedKeys(record, keys) && typeof record.agent === "string" && /\S/u.test(record.agent)
    && (record.ts === undefined || (typeof record.ts === "string" && !Number.isNaN(Date.parse(record.ts))));
}

function validBuild(record) {
  const allowed = new Set(["story", "event", "notes", "source_commit", "method", "pass", "ts"]);
  return record !== null && typeof record === "object" && !Array.isArray(record)
    && Object.keys(record).every((key) => allowed.has(key))
    && typeof record.notes === "string"
    && (record.source_commit === undefined || (typeof record.source_commit === "string" && /^[0-9a-f]{40}$/u.test(record.source_commit)))
    && (record.ts === undefined || (typeof record.ts === "string" && !Number.isNaN(Date.parse(record.ts))));
}

function validDone(record) {
  const keys = ["story", "event", ...(record.source_commit === undefined ? [] : ["source_commit"]), ...(record.ts === undefined ? [] : ["ts"])];
  return closedKeys(record, keys)
    && (record.source_commit === undefined || (typeof record.source_commit === "string" && /^[0-9a-f]{40}$/u.test(record.source_commit)))
    && (record.ts === undefined || (typeof record.ts === "string" && !Number.isNaN(Date.parse(record.ts))));
}

function validAcVerify(record) {
  const allowed = new Set(["story", "event", "ac", "method", "pass", "notes", "source_commit", "ts"]);
  return record !== null && typeof record === "object" && !Array.isArray(record)
    && Object.keys(record).every((key) => allowed.has(key))
    && Number.isInteger(record.ac) && typeof record.method === "string"
    && typeof record.pass === "boolean" && typeof record.notes === "string"
    && (record.source_commit === undefined || (typeof record.source_commit === "string" && /^[0-9a-f]{40}$/u.test(record.source_commit)))
    && (record.ts === undefined || (typeof record.ts === "string" && !Number.isNaN(Date.parse(record.ts))));
}

function hasEffectiveHistoricalTerminal(feedback, activationIndex, workId) {
  const prefix = feedback.slice(0, activationIndex);
  const active = new Map();
  const lineages = new Map();
  const controlIndices = new Set();
  const supersededIndices = new Set();
  const projectedIndices = new Set();
  for (let index = 0; index < prefix.length; index += 1) {
    const record = prefix[index];
    if (record.story !== workId) continue;
    if (record.event === "started") {
      if (!validStarted(record)) return false;
      active.set(index, record);
    } else if (record.event === "build_pass") {
      if (!validBuild(record)) return false;
      active.set(index, record);
    } else if (record.event === "done") {
      if (!validDone(record)) return false;
      active.set(index, record);
    } else if (record.event === "ac_verify") {
      if (!validAcVerify(record)) return false;
      active.set(index, record);
    }
  }
  const supersessions = prefix.map((record, index) => ({ record, index }))
    .filter(({ record }) => record.story === workId && record.event === "evidence_superseded");
  for (const { record, index } of supersessions) {
    if (!closedKeys(record, ["story", "event", "ref", "target", "reason"])
      || typeof record.ref !== "string" || !/\S/u.test(record.ref)
      || typeof record.reason !== "string" || !/\S/u.test(record.reason)
      || lineages.has(record.ref)
      || prefix.filter((candidate) => candidate.event === "evidence_superseded" && candidate.ref === record.ref).length !== 1) return false;
    let targetIndex;
    let targetEvent;
    let targetAc;
    if (closedKeys(record.target, ["ref"])) {
      const prior = lineages.get(record.target.ref);
      if (!prior || !prior.active || prior.replacementIndex >= index) return false;
      prior.active = false;
      targetIndex = prior.replacementIndex;
      targetEvent = prior.event;
      targetAc = prior.ac;
    } else if ((closedKeys(record.target, ["story", "event"])
      || closedKeys(record.target, ["story", "event", "ac"]))
      && record.target.story === workId && ["ac_verify", "build_pass", "done"].includes(record.target.event)
      && (record.target.event !== "ac_verify" || Number.isInteger(record.target.ac))) {
      const matches = [...active.entries()].filter(([candidateIndex, candidate]) => candidateIndex < index
        && !projectedIndices.has(candidateIndex)
        && candidate.story === workId && candidate.event === record.target.event
        && (record.target.event !== "ac_verify" || candidate.ac === record.target.ac));
      if (matches.length !== 1) return false;
      [targetIndex] = matches[0];
      targetEvent = record.target.event;
      targetAc = record.target.ac;
    } else {
      return false;
    }
    const replacements = prefix.map((candidate, replacementIndex) => ({ candidate, replacementIndex }))
      .filter(({ candidate }) => candidate.event === "revalidated" && candidate.ref === record.ref);
    if (replacements.length !== 1 || replacements[0].replacementIndex <= index) return false;
    const { candidate: replacement, replacementIndex } = replacements[0];
    const replacementKeys = targetEvent === "build_pass"
      ? ["story", "event", "ref", "change", "as_event", "notes"]
      : targetEvent === "ac_verify"
        ? ["story", "event", "ref", "change", "as_event", "ac", "method", "pass", "notes"]
        : ["story", "event", "ref", "change", "as_event"];
    const replacementValid = closedKeys(replacement, replacementKeys)
      && replacement.story === workId && replacement.event === "revalidated"
      && replacement.as_event === targetEvent
      && [replacement.story, replacement.ref, replacement.change, replacement.as_event]
        .every((value) => typeof value === "string" && /\S/u.test(value))
      && replacement.ref === record.ref
      && (targetEvent !== "build_pass" || typeof replacement.notes === "string")
      && (targetEvent !== "ac_verify" || (replacement.ac === targetAc && typeof replacement.method === "string"
        && typeof replacement.pass === "boolean" && typeof replacement.notes === "string"));
    if (!replacementValid) return false;
    const changeDecisions = prefix.slice(0, replacementIndex)
      .filter((candidate) => candidate.story === replacement.change && candidate.event === "decision");
    const decisionIds = new Set();
    if (changeDecisions.length === 0 || changeDecisions.some((decision) => {
      if (!validDecision(decision) || decisionIds.has(decision.id)) return true;
      decisionIds.add(decision.id);
      return false;
    })) return false;
    active.delete(targetIndex);
    supersededIndices.add(targetIndex);
    active.set(replacementIndex, targetEvent === "build_pass"
      ? { story: workId, event: "build_pass", notes: replacement.notes }
      : targetEvent === "ac_verify"
        ? { story: workId, event: "ac_verify", ac: targetAc, method: replacement.method, pass: replacement.pass, notes: replacement.notes }
        : { story: workId, event: "done" });
    controlIndices.add(index);
    controlIndices.add(replacementIndex);
    projectedIndices.add(replacementIndex);
    lineages.set(record.ref, { event: targetEvent, ac: targetAc, replacementIndex, active: true });
  }
  const orphanProjection = prefix.some((record, index) => record.story === workId && record.event === "revalidated" && !controlIndices.has(index));
  if (orphanProjection) return false;
  const canonical = [...active.entries()].sort(([left], [right]) => left - right);
  const starts = canonical.filter(([, record]) => record.event === "started");
  const builds = canonical.filter(([, record]) => record.event === "build_pass");
  const terminals = canonical.filter(([, record]) => record.event === "done");
  if (starts.length !== 1 || builds.length === 0 || terminals.length === 0) return false;
  const startIndex = starts[0][0];
  const canonicalStoryIndices = prefix.map((record, index) => ({ record, index }))
    .filter(({ record, index }) => record.story === workId && !controlIndices.has(index) && !supersededIndices.has(index))
    .map(({ index }) => index);
  return canonicalStoryIndices.every((index) => index >= startIndex)
    && builds.every(([buildIndex]) => buildIndex > startIndex)
    && terminals.every(([terminalIndex]) => terminalIndex > startIndex
      && builds.some(([buildIndex]) => buildIndex < terminalIndex));
}

function isHistoricalDone(root, base, feedback, workId) {
  const activationIndex = validatedActivationIndex(root, base, feedback);
  return activationIndex >= 0 && hasEffectiveHistoricalTerminal(feedback, activationIndex, workId);
}

function registeredOverlayLayers(source) {
  if (createHash("sha256").update(source, "utf8").digest("hex") !== REVIEWED_RECONCILER_SHA256) return [];
  const analyzer = String.raw`
import ast
import json
import sys

try:
    source = sys.stdin.read()
    tree = ast.parse(source)
except (SyntaxError, UnicodeError):
    print("[]")
    raise SystemExit(0)

assignments = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        assignments[node.targets[0].id] = node.value

spec = assignments.get("LAYERED_OVERRIDE_SPECS")
if not isinstance(spec, (ast.Tuple, ast.List)):
    print("[]")
    raise SystemExit(0)

layers = []
for item in spec.elts:
    if not (isinstance(item, (ast.Tuple, ast.List)) and len(item.elts) == 2
            and isinstance(item.elts[0], ast.Constant) and isinstance(item.elts[0].value, str)
            and isinstance(item.elts[1], ast.Name)):
        print("[]")
        raise SystemExit(0)
    layer, constant = item.elts[0].value, item.elts[1].id
    mapping = assignments.get(constant)
    if not isinstance(mapping, ast.Dict) or len(mapping.keys) == 0:
        print("[]")
        raise SystemExit(0)
    paths = []
    for key, value in zip(mapping.keys, mapping.values):
        if not (isinstance(key, ast.Constant) and isinstance(key.value, str)
                and isinstance(value, ast.Constant) and isinstance(value.value, str)):
            print("[]")
            raise SystemExit(0)
        paths.append([key.value, value.value])
    layers.append({"layer": layer, "pathsConstant": constant, "paths": paths})

applied = False
for loader in (node for node in tree.body if isinstance(node, ast.FunctionDef)
               and node.name == "load_layered_overrides"):
    returns_layers = any(
        isinstance(node, ast.Return)
        and ((isinstance(node.value, ast.Name) and node.value.id == "layers")
             or (isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
                 and node.value.func.id == "tuple" and len(node.value.args) == 1
                 and isinstance(node.value.args[0], ast.Name)
                 and node.value.args[0].id == "layers"))
        for node in ast.walk(loader)
    )
    for loop in (node for node in ast.walk(loader) if isinstance(node, ast.For)):
        if not (isinstance(loop.iter, ast.Name) and loop.iter.id == "LAYERED_OVERRIDE_SPECS"
                and isinstance(loop.target, (ast.Tuple, ast.List)) and len(loop.target.elts) == 2
                and all(isinstance(item, ast.Name) for item in loop.target.elts)):
            continue
        layer_name, paths_name = [item.id for item in loop.target.elts]
        body = ast.Module(body=loop.body, type_ignores=[])
        calls = [node for node in ast.walk(body) if isinstance(node, ast.Call)]
        layer_builds_override_root = any(
            isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "override_root" for target in node.targets)
            and any(isinstance(name, ast.Name) and name.id == layer_name for name in ast.walk(node.value))
            and any(isinstance(value, ast.Constant) and value.value == "overrides" for value in ast.walk(node.value))
            for node in ast.walk(body)
        )
        paths_validate_source = any(
            isinstance(node, ast.Compare)
            and any(isinstance(child, ast.Subscript)
                    and isinstance(child.value, ast.Name) and child.value.id == paths_name
                    for child in ast.walk(node))
            for node in ast.walk(body)
        )
        appends_loaded_layer = any(
            isinstance(call.func, ast.Attribute) and call.func.attr == "append"
            and isinstance(call.func.value, ast.Name) and call.func.value.id == "layers"
            and any(isinstance(name, ast.Name) and name.id == "pinned"
                    for argument in call.args for name in ast.walk(argument))
            for call in calls
        )
        if returns_layers and layer_builds_override_root and paths_validate_source and appends_loaded_layer:
            applied = True
            break
    if applied:
        break

print(json.dumps(layers if applied else [], separators=(",", ":")))
`;
  const result = spawnSync("python3", ["-c", analyzer], {
    input: source,
    encoding: "utf8",
    shell: false,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    timeout: 5000,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return [];
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => ({
      layer: entry.layer,
      pathsConstant: entry.pathsConstant,
      paths: new Map(entry.paths),
    }));
  } catch {
    return [];
  }
}

function exactOverlayOwns({ root, base, head, workIds, generatedPath }) {
  const reconcilerPath = "infra/scripts/reconcile-sprint1-docs.py";
  const reconciler = readRevisionFile(root, base, reconcilerPath, { required: false });
  if (reconciler === null) return false;
  return registeredOverlayLayers(reconciler).some(({ layer, paths }) => {
    const layerMatch = OVERLAY_LAYER_PATTERN.exec(layer);
    if (!layerMatch || !workIds.includes(layerMatch[1]) || !paths.has(generatedPath) || paths.size === 0) return false;
    try {
      paths.forEach((sourcePath, path) => {
        validateRelativePath(path);
        validateRelativePath(sourcePath);
      });
    } catch {
      return false;
    }
    const manifestPath = `infra/scripts/overrides/${layer}/manifest.json`;
    const manifestText = readRevisionFile(root, base, manifestPath, { required: false });
    if (manifestText === null) return false;
    const manifest = parseJson(manifestText, manifestPath);
    if (Object.keys(manifest).sort().join(",") !== "paths,version" || manifest.version !== 1
      || manifest.paths === null || typeof manifest.paths !== "object" || Array.isArray(manifest.paths)
      || Object.keys(manifest.paths).sort().join(",") !== [...paths.keys()].sort().join(",")) return false;
    const ownership = manifest.paths[generatedPath];
    if (ownership === null || typeof ownership !== "object" || Array.isArray(ownership)
      || Object.keys(ownership).sort().join(",") !== "desired_sha256,source_path,source_sha256") return false;
    const { source_path: sourcePath, source_sha256: sourceSha, desired_sha256: desiredSha } = ownership;
    const sourceRepoPath = `infra/scripts/${sourcePath}`;
    const desiredPath = `infra/scripts/overrides/${layer}/${generatedPath}`;
    try {
      validateRelativePath(sourcePath);
      validateRelativePath(sourceRepoPath);
      validateRelativePath(desiredPath);
    } catch {
      return false;
    }
    if (sourcePath !== paths.get(generatedPath) || sourceRepoPath === desiredPath
      || !sourcePath.startsWith("overrides/")
      || !/^[0-9a-f]{64}$/u.test(sourceSha) || !/^[0-9a-f]{64}$/u.test(desiredSha)) return false;
    const sourceBytes = readRevisionBytes(root, base, sourceRepoPath, { required: false });
    const desiredBytes = readRevisionBytes(root, base, desiredPath, { required: false });
    const baseGeneratedBytes = readRevisionBytes(root, base, generatedPath, { required: false });
    const generatedBytes = readRevisionBytes(root, head, generatedPath, { required: false });
    if (sourceBytes === null || desiredBytes === null || baseGeneratedBytes === null || generatedBytes === null
      || !["100644", "100755"].includes(revisionMode(root, base, sourceRepoPath))
      || !["100644", "100755"].includes(revisionMode(root, base, desiredPath))
      || !["100644", "100755"].includes(revisionMode(root, base, generatedPath))
      || !["100644", "100755"].includes(revisionMode(root, head, generatedPath))) return false;
    return sourceBytes.equals(baseGeneratedBytes)
      && createHash("sha256").update(sourceBytes).digest("hex") === sourceSha
      && createHash("sha256").update(baseGeneratedBytes).digest("hex") === sourceSha
      && createHash("sha256").update(desiredBytes).digest("hex") === desiredSha
      && createHash("sha256").update(generatedBytes).digest("hex") === desiredSha;
  });
}

export function extractWorkIds(message) {
  if (typeof message !== "string" || message.includes("\0")) fail("WR_COMMIT_MESSAGE_INVALID", "$.message", "Commit message must be a NUL-free string");
  const seen = new Set();
  const normalized = [];
  for (const match of message.match(WORK_ID_PATTERN) ?? []) {
    const workId = match.toUpperCase();
    if (!seen.has(workId)) {
      seen.add(workId);
      normalized.push(workId);
    }
  }
  return normalized;
}

export function classifyChangedPath(path) {
  validateRelativePath(path);
  if (path === ".nous-feedback.jsonl" || BOOTSTRAP_DOCUMENT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return "bootstrap-documentation";
  }
  if (GENERATED_NOUS_PATHS.some((pattern) => pattern.test(path))) return "generated-nous";
  return "implementation";
}

export function listChangedPaths({ root, base, head = "HEAD", staged = false }) {
  const canonicalRoot = repositoryRoot(root);
  if (typeof staged !== "boolean") fail("WR_GIT_ARGUMENT_INVALID", "$.staged", "staged must be boolean");
  if (staged) {
    const paths = parseNameStatus(git(canonicalRoot, ["diff", "--cached", "--name-status", "-z", "--no-renames"]), canonicalRoot);
    const headSha = resolveCommit(canonicalRoot, "HEAD", "$.head");
    paths.forEach((path) => {
      validateRevisionSymlink(canonicalRoot, headSha, path);
      validateIndexSymlink(canonicalRoot, path);
    });
    return paths;
  }
  const baseSha = resolveCommit(canonicalRoot, base, "$.base");
  const headSha = resolveCommit(canonicalRoot, head, "$.head");
  const paths = parseNameStatus(git(canonicalRoot, ["diff", "--name-status", "-z", "--find-renames", baseSha, headSha]), canonicalRoot);
  paths.forEach((path) => {
    validateRevisionSymlink(canonicalRoot, baseSha, path);
    validateRevisionSymlink(canonicalRoot, headSha, path);
  });
  return paths;
}

function readGithubRangeEvent(env) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (typeof eventPath !== "string" || eventPath.length === 0 || eventPath.includes("\0") || !isAbsolute(eventPath)) {
    fail("WR_GIT_ERROR", "$.base", "GitHub Actions requires an absolute, NUL-free GITHUB_EVENT_PATH");
  }
  let event;
  try {
    const stat = lstatSync(eventPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CI_EVENT_BYTES) {
      fail("WR_GIT_ERROR", "$.base", "GitHub event payload must be a bounded regular file");
    }
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    if (error instanceof WorkReadinessError) throw error;
    fail("WR_GIT_ERROR", "$.base", "GitHub event payload is unavailable or invalid JSON");
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    fail("WR_GIT_ERROR", "$.base", "GitHub event payload must be an object");
  }
  const pullRequest = event.pull_request !== null && typeof event.pull_request === "object" && !Array.isArray(event.pull_request);
  const base = pullRequest ? event.pull_request.base?.sha : event.before;
  const head = pullRequest ? event.pull_request.head?.sha : event.after;
  for (const [path, candidate] of [["$.base", base], ["$.head", head]]) {
    if (typeof candidate !== "string" || !/^[0-9a-f]{40}$/u.test(candidate) || /^0{40}$/u.test(candidate)) {
      fail("WR_GIT_ERROR", path, "GitHub event payload does not contain one valid base/head commit SHA pair");
    }
  }
  return { base, head, pullRequest };
}

function fetchCiCommit(root, sha, depth) {
  const result = spawnSync("git", ["fetch", "--no-tags", `--depth=${String(depth)}`, "origin", sha], {
    cwd: root,
    encoding: "buffer",
    shell: false,
    maxBuffer: MAX_GIT_OUTPUT_BYTES + 1,
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  if (stdout.length > MAX_GIT_OUTPUT_BYTES || stderr.length > MAX_GIT_OUTPUT_BYTES || result.error?.code === "ENOBUFS") {
    fail("WR_GIT_ERROR", "$.git", `Git fetch output exceeds ${MAX_GIT_OUTPUT_BYTES} bytes`);
  }
  if (result.error?.code === "ETIMEDOUT") fail("WR_GIT_ERROR", "$.git", "Timed out acquiring the exact GitHub event ancestry");
  if (result.error || result.status !== 0) {
    const detail = stderr.toString("utf8").trim();
    fail("WR_GIT_ERROR", "$.git", detail || "Unable to acquire the exact GitHub event ancestry");
  }
}

function acquireCiRange(root, range) {
  const ancestryAvailable = () => git(root, ["merge-base", "--is-ancestor", range.base, range.head], { allowMissing: true }) !== null;
  if (!ancestryAvailable()) {
    fetchCiCommit(root, range.head, 256);
    fetchCiCommit(root, range.base, 1);
  }
  const base = resolveCommit(root, range.base, "$.base");
  const head = resolveCommit(root, range.head, "$.head");
  if (!ancestryAvailable()) fail("WR_GIT_NON_ANCESTRAL", "$.base", "GitHub event base must be an ancestor of its head after bounded acquisition");
  return { ...range, base, head };
}

function latestNonMergeRange(root, head, lowerBound = null) {
  const revision = lowerBound === null ? head : `${lowerBound}..${head}`;
  const latest = git(root, ["rev-list", "--no-merges", "-1", revision]).toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(latest)) fail("WR_GIT_ERROR", "$.head", "No latest non-merge commit is available for main verification");
  const fields = git(root, ["rev-list", "--parents", "-n", "1", latest]).toString("utf8").trim().split(/\s+/u);
  if (fields.length !== 2 || !/^[0-9a-f]{40}$/u.test(fields[1])) {
    fail("WR_GIT_TOPOLOGY_UNSUPPORTED", "$.base", "Latest non-merge commit must have one parent");
  }
  return { base: fields[1], head: latest };
}

export function resolveDefaultRange(root, env = process.env) {
  const canonicalRoot = repositoryRoot(root);
  const explicitBase = env.WORK_READINESS_BASE ?? env.READINESS_BASE_SHA ?? env.GITHUB_BASE_SHA;
  if (explicitBase !== undefined) {
    return {
      base: resolveCommit(canonicalRoot, explicitBase, "$.base"),
      head: resolveCommit(canonicalRoot, env.WORK_READINESS_HEAD ?? env.GITHUB_HEAD_SHA ?? "HEAD", "$.head"),
    };
  }
  if (env.GITHUB_ACTIONS === "true") {
    const range = acquireCiRange(canonicalRoot, readGithubRangeEvent(env));
    return range.pullRequest ? { base: range.base, head: range.head } : latestNonMergeRange(canonicalRoot, range.head, range.base);
  }
  const main = resolveCommit(canonicalRoot, "main", "$.base");
  const head = resolveCommit(canonicalRoot, "HEAD", "$.head");
  if (main === head) return latestNonMergeRange(canonicalRoot, head);
  const mergeBase = git(canonicalRoot, ["merge-base", main, head]).toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(mergeBase)) fail("WR_GIT_ERROR", "$.base", "Unable to resolve a unique merge base with main");
  const mergeBasePrecedesBoundary = git(
    canonicalRoot,
    ["merge-base", "--is-ancestor", mergeBase, CHG022_EXECUTABLE_BOUNDARY],
    { allowMissing: true },
  ) !== null;
  const boundaryPrecedesHead = git(
    canonicalRoot,
    ["merge-base", "--is-ancestor", CHG022_EXECUTABLE_BOUNDARY, head],
    { allowMissing: true },
  ) !== null;
  return {
    base: mergeBasePrecedesBoundary && boundaryPrecedesHead ? CHG022_EXECUTABLE_BOUNDARY : mergeBase,
    head,
  };
}

export function resolveDefaultBase(root, env = process.env) {
  return resolveDefaultRange(root, env).base;
}

// CHG-037 §2 — the git-timestamp execution clock is gone: findExecutionTimeline,
// commitEpochSeconds, validateElapsedCheckpoint and hasBootstrapElapsedDeviation.
// It fired twice in the project's history, and both times it stopped work at a
// point the task structure did not choose. A clock cannot know where a safe
// stopping point is; the plan's task list can, so the contract moved there.
//
// Removing it also retires a latent defect: findExecutionTimeline matched a
// decision by `story === workId`, but a `controlling_change` decision necessarily
// carries `story === <parent>` — so a controlling-change-approved item could never
// satisfy WR_EXECUTION_ANCHOR_MISSING and could never land an implementation commit.
function validateCommitOwnership({
  root, parent, commit, message, preActivationCommit = false,
}) {
  const changedPaths = listChangedPaths({ root, base: parent, head: commit });
  const messageWorkIds = extractWorkIds(message);
  const pathWorkIds = extractWorkIds(changedPaths.join("\n"));
  const workIds = [...new Set([...messageWorkIds, ...pathWorkIds])];
  const candidateFeedback = validateFeedbackHistoryTransition(root, parent, commit);
  const authorizationFeedback = parseFeedback(readRevisionFile(root, parent, ".nous-feedback.jsonl", { required: false }));
  const policyActive = validatedActivationIndex(root, parent, authorizationFeedback) >= 0;
  validateAllActualTransitions({
    root,
    parent,
    commit,
    changedPaths,
    parentFeedback: authorizationFeedback,
    candidateFeedback,
  });
  validateChangedMachineArtifacts(root, commit, changedPaths);
  if (policyActive) {
    for (const planPath of changedPaths.filter((path) => IMPLEMENTATION_PLAN_PATTERN.test(path))) {
      const planPathWorkIds = extractWorkIds(planPath);
      validatePlanBinding({
        root,
        revision: commit,
        authorizationRevision: parent,
        feedback: authorizationFeedback,
        planPath,
        expectedWorkId: planPathWorkIds.length === 1 ? planPathWorkIds[0] : null,
      });
    }
  }
  const classes = changedPaths.map(classifyChangedPath);
  const generatedPaths = changedPaths.filter((path, index) => classes[index] === "generated-nous");
  for (const generatedPath of generatedPaths) {
    if (!exactOverlayOwns({ root, base: parent, head: commit, workIds, generatedPath })) {
      fail("WR_GENERATED_NOUS_PATH", generatedPath, `Generated Nous path ${generatedPath} requires exact changed overlay ownership`);
    }
  }
  const classification = classes.every((value) => value === "bootstrap-documentation")
    ? "bootstrap-documentation"
    : "implementation";
  if (classification === "bootstrap-documentation") {
    return { workIds, changedPaths, classification, grandfatheredWorkIds: [] };
  }
  if (workIds.length === 0) fail("WR_WORK_ID_MISSING", "$.message", "Implementation changes require at least one US-* or CHG-* reference");
  // Candidate-tree machine artifacts are structurally validated above, but an
  // implementation commit cannot authorize itself. Readiness and its approval
  // must already exist in the immutable parent tree.
  const grandfatheredWorkIds = [];
  for (const workId of workIds) {
    const readinessPath = `docs/readiness/${workId}.json`;
    const artifactText = readRevisionFile(root, parent, readinessPath, { required: false });
    if (artifactText === null) {
      if (preActivationCommit && hasEffectiveHistoricalTerminal(authorizationFeedback, authorizationFeedback.length, workId)) {
        grandfatheredWorkIds.push(workId);
        continue;
      }
      fail("WR_READINESS_MISSING", readinessPath, `Implementation for ${workId} requires ${readinessPath}`);
    }
    const parentArtifact = parseJson(artifactText, readinessPath);
    if (parentArtifact.work_id !== workId) fail("WR_READINESS_WORK_ID_MISMATCH", readinessPath, `Artifact work_id does not match ${workId}`);
    const parentAssessment = validateAssessment(parentArtifact, { feedbackRecords: authorizationFeedback });
    if (parentArtifact.decision !== "ready") fail("WR_WORK_NOT_READY", readinessPath, `${workId} is ${String(parentArtifact.decision)}, not ready`);
    if (!parentAssessment.active) {
      if (parentArtifact.policy_bootstrap && parentAssessment.complete) {
        fail("WR_BOOTSTRAP_EXPIRED", "$.bootstrap_authorization.expires_on_event", "The one-time CHG-022 bootstrap expired at its first valid terminal event");
      }
      fail("WR_APPROVAL_INACTIVE", readinessPath, `${workId} parent readiness authorization is inactive`);
    }
    if (policyActive && !parentArtifact.policy_bootstrap) {
      requireImplementationPlan({ root, revision: parent, feedback: authorizationFeedback, workId });
    }

    const candidateArtifactText = readRevisionFile(root, commit, readinessPath, { required: false });
    if (candidateArtifactText === null) fail("WR_READINESS_MISSING", readinessPath, `Candidate implementation removes readiness for ${workId}`);
    const candidateArtifact = parseJson(candidateArtifactText, readinessPath);
    if (candidateArtifact.work_id !== workId) fail("WR_READINESS_WORK_ID_MISMATCH", readinessPath, `Candidate artifact work_id does not match ${workId}`);
    const candidateAssessment = validateAssessment(candidateArtifact, { feedbackRecords: candidateFeedback });
    if (candidateArtifact.decision !== "ready") fail("WR_WORK_NOT_READY", readinessPath, `${workId} candidate state is ${String(candidateArtifact.decision)}, not ready`);
    if (!candidateAssessment.active) {
      if (candidateArtifact.policy_bootstrap && candidateAssessment.complete) {
        fail("WR_BOOTSTRAP_EXPIRED", "$.bootstrap_authorization.expires_on_event", "The one-time CHG-022 bootstrap expired at its first valid terminal event");
      }
      fail("WR_APPROVAL_INACTIVE", readinessPath, `${workId} candidate readiness authorization is inactive`);
    }
    if (candidateArtifact.readiness_payload_sha256 !== parentArtifact.readiness_payload_sha256) {
      fail("WR_CANDIDATE_PAYLOAD_CHANGED", readinessPath, `${workId} canonical readiness payload cannot change in its implementation commit`);
    }
    if (candidateArtifact.approval.evidence !== parentArtifact.approval.evidence
      || candidateArtifact.approval.payload_sha256 !== parentArtifact.approval.payload_sha256
      || candidateArtifact.approval.status !== parentArtifact.approval.status
      || candidateArtifact.approval.approved_by !== parentArtifact.approval.approved_by) {
      fail("WR_CANDIDATE_APPROVAL_CHANGED", readinessPath, `${workId} approval binding cannot change in its implementation commit`);
    }
    if (parentArtifact.policy_bootstrap) {
      const allowed = new Set(parentArtifact.bootstrap_authorization.allowed_paths);
      const unauthorized = changedPaths.find((path) => !allowed.has(path));
      if (unauthorized) fail("WR_BOOTSTRAP_PATH_UNAUTHORIZED", unauthorized, `CHG-022 bootstrap does not authorize ${unauthorized}`);
    }
  }
  return { workIds, changedPaths, classification, grandfatheredWorkIds };
}

function linearCommits(root, base, head) {
  if (git(root, ["merge-base", "--is-ancestor", base, head], { allowMissing: true }) === null) {
    fail("WR_GIT_NON_ANCESTRAL", "$.base", "Base must be an ancestor of head");
  }
  const output = git(root, ["rev-list", "--reverse", "--topo-order", "--parents", `${base}..${head}`]).toString("utf8").trim();
  if (output === "") return [];
  let expectedParent = base;
  return output.split("\n").map((line) => {
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 2 || fields[1] !== expectedParent) {
      fail("WR_GIT_TOPOLOGY_UNSUPPORTED", "$.base", "Readiness range must be one linear first-parent ancestry without merges");
    }
    const entry = { commit: fields[0], parent: fields[1] };
    expectedParent = fields[0];
    return entry;
  });
}

export function validateRangeOwnership({ root, base, head = "HEAD", message }) {
  const canonicalRoot = repositoryRoot(root);
  const baseSha = resolveCommit(canonicalRoot, base, "$.base");
  const headSha = resolveCommit(canonicalRoot, head, "$.head");
  const commits = linearCommits(canonicalRoot, baseSha, headSha);
  const scanFeedback = (revision) => {
    try {
      return parseFeedback(readRevisionFile(canonicalRoot, revision, ".nous-feedback.jsonl", { required: false }));
    } catch (error) {
      if (error instanceof WorkReadinessError) return null;
      throw error;
    }
  };
  const headFeedback = scanFeedback(headSha);
  const hasActivationMarker = (feedback) => feedback?.some((record) => record.story === "CHG-022"
    && record.event === "decision" && record.id === ACTIVATION_EVIDENCE) === true;
  const activationPresentAtHead = hasActivationMarker(headFeedback);
  let activationOrdinal = -1;
  if (activationPresentAtHead) {
    activationOrdinal = commits.findIndex((entry) => {
      const candidateFeedback = scanFeedback(entry.commit);
      const parentFeedback = scanFeedback(entry.parent);
      return hasActivationMarker(candidateFeedback) && !hasActivationMarker(parentFeedback);
    });
  }
  const aggregate = {
    workIds: [],
    changedPaths: [],
    classification: "bootstrap-documentation",
    grandfatheredWorkIds: [],
  };
  for (let ordinal = 0; ordinal < commits.length; ordinal += 1) {
    const entry = commits[ordinal];
    const commitMessage = git(canonicalRoot, ["show", "-s", "--format=%B", entry.commit]).toString("utf8");
    const effectiveMessage = message !== undefined && entry.commit === headSha ? `${commitMessage}\n${message}` : commitMessage;
    const preActivationCommit = !activationPresentAtHead || (activationOrdinal >= 0 && ordinal < activationOrdinal);
    const result = validateCommitOwnership({
      root: canonicalRoot, ...entry, message: effectiveMessage, preActivationCommit,
    });
    aggregate.workIds.push(...result.workIds.filter((workId) => !aggregate.workIds.includes(workId)));
    aggregate.changedPaths.push(...result.changedPaths.filter((path) => !aggregate.changedPaths.includes(path)));
    aggregate.grandfatheredWorkIds.push(...result.grandfatheredWorkIds.filter((workId) => !aggregate.grandfatheredWorkIds.includes(workId)));
    if (result.classification === "implementation") aggregate.classification = "implementation";
  }
  return aggregate;
}
