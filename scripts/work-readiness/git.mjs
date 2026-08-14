import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { WorkReadinessError, classifyAssessment, validateAssessment } from "./model.mjs";

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const WORK_ID_PATTERN = /(?<![A-Z0-9-])(?:US|CHG)-[0-9]{3,}(?![A-Z0-9-])/gu;
const BOOTSTRAP_DOCUMENT_PREFIXES = [
  "docs/readiness/",
  "docs/superpowers/specs/",
  "docs/superpowers/plans/",
];
const GENERATED_NOUS_PATHS = [
  /^docs\/stories\//u,
  /^docs\/sprints\//u,
];
const OVERLAY_LAYER_PATTERN = /^(CHG-[0-9]{3,})\/[a-z0-9]{7,64}$/u;
const ACTIVATION_EVIDENCE = "CHG022-READINESS-V2-APPROVAL";

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
    fail("WR_GIT_OUTPUT_LIMIT", "$.git", `Git output exceeds ${MAX_GIT_OUTPUT_BYTES} bytes`);
  }
  if (result.error) fail("WR_GIT_EXEC_FAILED", "$.git", `Unable to execute Git: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowMissing) return null;
    const detail = stderr.toString("utf8").trim();
    fail("WR_GIT_COMMAND_FAILED", "$.git", detail || `Git exited with status ${String(result.status)}`);
  }
  return stdout;
}

function repositoryRoot(root) {
  if (typeof root !== "string" || root.includes("\0") || !isAbsolute(root)) {
    fail("WR_GIT_ROOT_INVALID", "$.root", "Repository root must be an absolute NUL-free path");
  }
  let canonical;
  try {
    canonical = realpathSync(root);
  } catch {
    fail("WR_GIT_ROOT_INVALID", "$.root", "Repository root does not exist");
  }
  const reported = git(canonical, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  let reportedCanonical;
  try {
    reportedCanonical = realpathSync(reported);
  } catch {
    fail("WR_GIT_ROOT_INVALID", "$.root", "Git reported an unavailable repository root");
  }
  if (reportedCanonical !== canonical) fail("WR_GIT_ROOT_INVALID", "$.root", "Root must name the repository top level exactly");
  return canonical;
}

function resolveCommit(root, ref, path) {
  if (typeof ref !== "string" || !/\S/u.test(ref) || ref.includes("\0") || ref.startsWith("-")) {
    fail("WR_GIT_REF_INVALID", path, "Git ref must be a non-empty NUL-free non-option string");
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
    fail("WR_GIT_OUTPUT_LIMIT", path, `Git output exceeds ${MAX_GIT_OUTPUT_BYTES} bytes`);
  }
  if (result.error) fail("WR_GIT_EXEC_FAILED", path, `Unable to execute Git: ${result.error.message}`);
  const detail = stderr.toString("utf8");
  if (/ambiguous/iu.test(detail)) fail("WR_GIT_REF_AMBIGUOUS", path, `Git ref ${ref} is ambiguous`);
  if (result.status !== 0) {
    fail("WR_GIT_REF_INVALID", path, `Git ref ${ref} does not resolve to one commit`);
  }
  const sha = stdout.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(sha)) fail("WR_GIT_REF_INVALID", path, `Git ref ${ref} did not resolve to a full commit ID`);
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
      if (index >= fields.length) fail("WR_GIT_STATUS_INVALID", "$.git", `Missing path for status ${status}`);
      paths.push(validateRelativePath(fields[index], root));
      index += 1;
      continue;
    }
    if (/^[RC][0-9]{1,3}$/u.test(status)) {
      if (index + 1 >= fields.length) fail("WR_GIT_STATUS_INVALID", "$.git", `Missing rename/copy paths for status ${status}`);
      paths.push(validateRelativePath(fields[index], root), validateRelativePath(fields[index + 1], root));
      index += 2;
      continue;
    }
    fail("WR_GIT_STATUS_INVALID", "$.git", `Unexpected Git name-status record ${String(status)}`);
  }
  return [...new Set(paths)].sort();
}

function validateRevisionSymlink(root, revision, path) {
  const record = git(root, ["ls-tree", "-z", revision, "--", path]).toString("utf8");
  if (record === "") return;
  const entries = record.split("\0").filter(Boolean);
  if (entries.length !== 1) fail("WR_GIT_STATUS_INVALID", path, `Expected one tree entry for ${path}`);
  const match = /^(\d{6}) (?:blob|tree) [0-9a-f]{40}\t(.+)$/u.exec(entries[0]);
  if (!match || match[2] !== path) fail("WR_GIT_STATUS_INVALID", path, `Unexpected tree entry for ${path}`);
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
  if (entries.length !== 1) fail("WR_GIT_STATUS_INVALID", path, `Expected one index entry for ${path}`);
  const match = /^(\d{6}) [0-9a-f]{40} 0\t(.+)$/u.exec(entries[0]);
  if (!match || match[2] !== path) fail("WR_GIT_STATUS_INVALID", path, `Unexpected index entry for ${path}`);
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
  if (contents === null && required) fail("WR_GIT_FILE_MISSING", path, `Required file ${path} is unavailable at ${revision}`);
  return contents?.toString("utf8") ?? null;
}

function readRevisionBytes(root, revision, path, { required = true } = {}) {
  validateRelativePath(path);
  const contents = git(root, ["show", `${revision}:${path}`], { allowMissing: !required });
  if (contents === null && required) fail("WR_GIT_FILE_MISSING", path, `Required file ${path} is unavailable at ${revision}`);
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

function parseJson(text, path) {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("document is not an object");
    return value;
  } catch (error) {
    fail("WR_READINESS_INVALID", path, `Invalid readiness JSON: ${error.message}`);
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
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === "LAYERED_OVERRIDE_SPECS = (");
  if (start < 0) return [];
  const layers = [];
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === ")") {
      end = index;
      break;
    }
    if (lines[index].trim() === "") continue;
    const match = /^\s*\("(CHG-[0-9]{3,}\/[a-z0-9]{7,64})",\s*([A-Z][A-Z0-9_]*)\),\s*$/u.exec(lines[index]);
    if (!match) return [];
    layers.push({ layer: match[1], pathsConstant: match[2] });
  }
  if (end < 0) return [];
  const applicationIndex = lines.findIndex((line, index) => index > end
    && /^\s*for\s+[a-z_][a-z0-9_]*,\s*[a-z_][a-z0-9_]*\s+in\s+LAYERED_OVERRIDE_SPECS:\s*$/u.test(line));
  if (applicationIndex < 0) return [];
  const loopMatch = /^\s*for\s+([a-z_][a-z0-9_]*),\s*([a-z_][a-z0-9_]*)\s+in\s+LAYERED_OVERRIDE_SPECS:\s*$/u.exec(lines[applicationIndex]);
  const applicationLines = lines.slice(applicationIndex + 1, applicationIndex + 13);
  if (!loopMatch || !applicationLines.some((line) => line.includes(loopMatch[1]) && line.includes(loopMatch[2])
    && /^\s+[a-z_][a-z0-9_]*\([^\n]*\)\s*$/iu.test(line))) return [];
  return layers.map((entry) => {
    const constantPattern = new RegExp(`${entry.pathsConstant}\\s*=\\s*\\{([\\s\\S]*?)\\}`, "u");
    const body = constantPattern.exec(source)?.[1];
    if (body === undefined) return { ...entry, paths: new Map() };
    const mappingPattern = /["']([^"']+)["']\s*:\s*(?:\(\s*)?["']([^"']+)["'](?:\s*\))?\s*,?/gu;
    const mappings = [...body.matchAll(mappingPattern)];
    const residual = body.replace(mappingPattern, "");
    if (mappings.length === 0 || /\S/u.test(residual)) return { ...entry, paths: new Map() };
    return { ...entry, paths: new Map(mappings.map((match) => [match[1], match[2]])) };
  });
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
  return [...new Set(message.match(WORK_ID_PATTERN) ?? [])];
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

export function resolveDefaultBase(root, env = process.env) {
  const canonicalRoot = repositoryRoot(root);
  const explicit = env.WORK_READINESS_BASE ?? env.READINESS_BASE_SHA ?? env.GITHUB_BASE_SHA ?? env.GITHUB_BASE_REF;
  if (explicit !== undefined) return resolveCommit(canonicalRoot, explicit, "$.base");
  const main = resolveCommit(canonicalRoot, "main", "$.base");
  const head = resolveCommit(canonicalRoot, "HEAD", "$.head");
  const mergeBase = git(canonicalRoot, ["merge-base", main, head]).toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(mergeBase)) fail("WR_GIT_REF_INVALID", "$.base", "Unable to resolve a unique merge base with main");
  return mergeBase;
}

function validateCommitOwnership({ root, parent, commit, message }) {
  const changedPaths = listChangedPaths({ root, base: parent, head: commit });
  const messageWorkIds = extractWorkIds(message);
  const pathWorkIds = extractWorkIds(changedPaths.join("\n"));
  const workIds = [...new Set([...messageWorkIds, ...pathWorkIds])];
  validateChangedMachineArtifacts(root, commit, changedPaths);
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
  const feedback = parseFeedback(readRevisionFile(root, commit, ".nous-feedback.jsonl", { required: false }));
  const baseFeedback = parseFeedback(readRevisionFile(root, parent, ".nous-feedback.jsonl", { required: false }));
  const grandfatheredWorkIds = [];
  for (const workId of workIds) {
    const readinessPath = `docs/readiness/${workId}.json`;
    const artifactText = readRevisionFile(root, commit, readinessPath, { required: false });
    if (artifactText === null) {
      if (isHistoricalDone(root, parent, baseFeedback, workId)) {
        grandfatheredWorkIds.push(workId);
        continue;
      }
      fail("WR_READINESS_MISSING", readinessPath, `Implementation for ${workId} requires ${readinessPath}`);
    }
    const artifact = parseJson(artifactText, readinessPath);
    if (artifact.work_id !== workId) fail("WR_READINESS_WORK_ID_MISMATCH", readinessPath, `Artifact work_id does not match ${workId}`);
    validateAssessment(artifact, { feedbackRecords: feedback });
    if (artifact.decision !== "ready") fail("WR_WORK_NOT_READY", readinessPath, `${workId} is ${String(artifact.decision)}, not ready`);
    if (artifact.policy_bootstrap) {
      const allowed = new Set(artifact.bootstrap_authorization.allowed_paths);
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
  const aggregate = {
    workIds: [],
    changedPaths: [],
    classification: "bootstrap-documentation",
    grandfatheredWorkIds: [],
  };
  for (const entry of commits) {
    const commitMessage = git(canonicalRoot, ["show", "-s", "--format=%B", entry.commit]).toString("utf8");
    const effectiveMessage = message !== undefined && entry.commit === headSha ? `${commitMessage}\n${message}` : commitMessage;
    const result = validateCommitOwnership({ root: canonicalRoot, ...entry, message: effectiveMessage });
    aggregate.workIds.push(...result.workIds.filter((workId) => !aggregate.workIds.includes(workId)));
    aggregate.changedPaths.push(...result.changedPaths.filter((path) => !aggregate.changedPaths.includes(path)));
    aggregate.grandfatheredWorkIds.push(...result.grandfatheredWorkIds.filter((workId) => !aggregate.grandfatheredWorkIds.includes(workId)));
    if (result.classification === "implementation") aggregate.classification = "implementation";
  }
  return aggregate;
}
