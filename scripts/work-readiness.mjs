#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  WorkReadinessError,
  computeReadinessPayloadSha256,
  validateAssessment,
} from "./work-readiness/model.mjs";
import {
  resolveDefaultRange,
  validateRangeOwnership,
} from "./work-readiness/git.mjs";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const WORK_ID = /^(?:US|CHG)-[0-9]{3,}$/u;

function cliError(code, message, path = "$") {
  throw new WorkReadinessError(code, message, path);
}

function repositoryRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) cliError("WR_REPOSITORY_INVALID", "Current directory is not inside a readable Git repository", "$.root");
  const reported = result.stdout.trim();
  if (!isAbsolute(reported)) cliError("WR_REPOSITORY_INVALID", "Git returned a non-absolute repository root", "$.root");
  try {
    return realpathSync(reported);
  } catch {
    cliError("WR_REPOSITORY_INVALID", "Repository root cannot be resolved", "$.root");
  }
}

function safeRepoPath(root, path, { mustExist = true } = {}) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) cliError("WR_PATH_INVALID", "Path must be non-empty and NUL-free", "$.path");
  const absolute = resolve(root, path);
  const lexical = relative(root, absolute);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) cliError("WR_PATH_ESCAPE", `Path escapes repository: ${path}`, "$.path");
  if (mustExist) {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) cliError("WR_FILE_INVALID", `File is not a bounded regular file: ${path}`, path);
    const canonical = realpathSync(absolute);
    const canonicalRelative = relative(root, canonical);
    if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) cliError("WR_PATH_ESCAPE", `Path resolves outside repository: ${path}`, path);
  }
  return absolute;
}

function readBoundedFile(root, path, { required = true } = {}) {
  try {
    const absolute = safeRepoPath(root, path);
    return readFileSync(absolute, "utf8");
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    if (error instanceof WorkReadinessError) throw error;
    if (error?.code === "ENOENT") cliError("WR_READINESS_MISSING", `Required file is missing: ${path}`, path);
    cliError("WR_FILE_INVALID", `Unable to read ${path}`, path);
  }
}

function git(root, args, { input } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim();
    cliError("WR_GIT_COMMAND_FAILED", detail ? `Git command failed: ${detail}` : "Git command failed", "$.git");
  }
  return result.stdout.trim();
}

export function readCanonicalMessageFile(root, path, fsOps = {}) {
  const ops = { closeSync, fstatSync, openSync, readFileSync, realpathSync, ...fsOps };
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const expectedPath = git(root, ["rev-parse", "--git-path", "COMMIT_EDITMSG"]);
  const expectedAbsolute = isAbsolute(expectedPath) ? expectedPath : resolve(root, expectedPath);
  try {
    const suppliedCandidate = join(ops.realpathSync(dirname(absolute)), basename(absolute));
    const expectedCandidate = join(ops.realpathSync(dirname(expectedAbsolute)), basename(expectedAbsolute));
    if (basename(absolute) !== "COMMIT_EDITMSG"
      || basename(expectedAbsolute) !== "COMMIT_EDITMSG"
      || (absolute !== expectedAbsolute && suppliedCandidate !== expectedCandidate)) {
      cliError("WR_FILE_INVALID", "Commit message file is not the canonical Git COMMIT_EDITMSG", "$.message_file");
    }
    if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
      cliError("WR_FILE_INVALID", "Platform cannot safely open the Git commit message without following symlinks", "$.message_file");
    }
    let descriptor;
    try {
      descriptor = ops.openSync(expectedAbsolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stat = ops.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        cliError("WR_FILE_INVALID", "Commit message file must be a bounded regular file", "$.message_file");
      }
      const contents = ops.readFileSync(descriptor, "utf8");
      if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES) {
        cliError("WR_FILE_INVALID", "Commit message file exceeds the size limit", "$.message_file");
      }
      return contents;
    } finally {
      if (descriptor !== undefined) ops.closeSync(descriptor);
    }
  } catch (error) {
    if (error instanceof WorkReadinessError) throw error;
    cliError("WR_FILE_INVALID", "Commit message file cannot be read", "$.message_file");
  }
}

function parseObject(text, path) {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value;
  } catch (error) {
    cliError("WR_READINESS_INVALID", `Invalid JSON in ${path}: ${error.message}`, path);
  }
}

function loadFeedback(root) {
  const text = readBoundedFile(root, ".nous-feedback.jsonl", { required: false });
  if (text === null || text.trim() === "") return [];
  return text.split(/\r?\n/u).filter((line) => line.length > 0).map((line, index) => {
    const path = `.nous-feedback.jsonl:${index + 1}`;
    try {
      const record = JSON.parse(line);
      if (record === null || typeof record !== "object" || Array.isArray(record)) throw new Error("expected an object");
      return record;
    } catch (error) {
      cliError("WR_FEEDBACK_INVALID", `Invalid feedback JSON: ${error.message}`, path);
    }
  });
}

function normalizeWorkId(raw) {
  if (typeof raw !== "string") cliError("WR_INVOCATION_INVALID", "An explicit WORK-ID is required", "$.arguments");
  const normalized = raw.toUpperCase();
  if (!WORK_ID.test(normalized)) cliError("WR_INVOCATION_INVALID", "WORK-ID must be an official US-* or CHG-* identifier", "$.arguments");
  return normalized;
}

function assessmentPath(workId) {
  return `docs/readiness/${workId}.json`;
}

function loadAssessment(root, workId) {
  const path = assessmentPath(workId);
  const value = parseObject(readBoundedFile(root, path), path);
  if (value.work_id !== workId) cliError("WR_READINESS_WORK_ID_MISMATCH", `Artifact work_id does not match ${workId}`, path);
  return value;
}

function validateOne(root, workId, feedbackRecords) {
  const value = loadAssessment(root, workId);
  validateAssessment(value, { feedbackRecords });
  return value;
}

function skeleton(workId) {
  const kind = workId.startsWith("US-") ? "US" : "CHG";
  const value = {
    schema_version: 1,
    readiness_payload_sha256: "0".repeat(64),
    work_id: workId,
    kind,
    work_type: kind === "US" ? "functional" : "technical",
    title: "Replace with one outcome-oriented title",
    source: kind === "US" ? `docs/stories/${workId}.md` : `docs/changes/${workId}.md`,
    outcomes: [{ id: "O1", statement: "Replace with the user-visible or operational outcome", demo: "Replace with observable demo evidence", primary: false }],
    acceptance_criteria: [{ id: "AC1", outcome_ids: ["O1"] }],
    scopes: ["planning"],
    signals: {
      routes_or_screens: 0,
      acceptance_flows: 0,
      expected_changed_files: 0,
      expected_mutation_shards: 0,
      lifecycle_or_concurrency_boundaries: 0,
      external_integrations: 0,
      schema_or_migration_changes: 0,
      authorization_or_audit_boundaries: 0,
      tooling_change: false,
    },
    estimate_minutes: { readiness: 0, implementation: 0, focused_verification: 0, review: 0, integration: 0, total: 0 },
    uncertainties: [{ id: "U1", statement: "Complete assessment before execution", status: "unresolved", estimate_impact_minutes: null, resolution: null }],
    dependencies: [],
    decision: "blocked",
    partitions: [],
    approval: { status: "pending", approved_by: null, evidence: null, payload_sha256: "0".repeat(64) },
    actuals: null,
    checkpoints: [],
    policy_bootstrap: false,
    bootstrap_exemption_rationale: null,
    bootstrap_authorization: null,
    controlling_change: null,
  };
  const digest = computeReadinessPayloadSha256(value);
  value.readiness_payload_sha256 = digest;
  value.approval.payload_sha256 = digest;
  return value;
}

function containedDirectory(root, relativePath, ops) {
  let current = root;
  for (const segment of relativePath.split("/")) {
    const candidate = join(current, segment);
    let stat;
    try {
      stat = ops.lstatSync(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (ops.realpathSync(current) !== current) cliError("WR_PATH_ESCAPE", `Directory ancestor is not canonical: ${current}`, relativePath);
      ops.mkdirSync(candidate, { mode: 0o755 });
      stat = ops.lstatSync(candidate);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) cliError("WR_PATH_ESCAPE", `Directory ancestor is unsafe: ${candidate}`, relativePath);
    const canonical = ops.realpathSync(candidate);
    const canonicalRelative = relative(root, canonical);
    if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) {
      cliError("WR_PATH_ESCAPE", `Directory ancestor escapes repository: ${candidate}`, relativePath);
    }
    current = canonical;
  }
  return current;
}

function removeIfPresent(ops, path) {
  try {
    ops.unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function syncDirectoryIfSupported(directory, ops) {
  let descriptor;
  try {
    descriptor = ops.openSync(directory, fsConstants.O_RDONLY);
    ops.fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) ops.closeSync(descriptor);
  }
}

export function createAssessmentFile({ root, workId, fsOps = {} }) {
  const ops = {
    closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
    realpathSync, unlinkSync, writeSync, ...fsOps,
  };
  const canonicalRoot = ops.realpathSync(root);
  const directory = containedDirectory(canonicalRoot, "docs/readiness", ops);
  const finalPath = join(directory, `${workId}.json`);
  const temporaryPath = join(directory, `.${workId}.json.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(skeleton(workId), null, 2)}\n`, "utf8");
  let descriptor;
  let published = false;
  try {
    descriptor = ops.openSync(temporaryPath, "wx", 0o644);
    const written = ops.writeSync(descriptor, bytes, 0, bytes.length, 0);
    if (written !== bytes.length || ops.fstatSync(descriptor).size !== bytes.length) {
      cliError("WR_FILE_WRITE_FAILED", "Readiness artifact was not written completely", assessmentPath(workId));
    }
    ops.fsyncSync(descriptor);
    ops.closeSync(descriptor);
    descriptor = undefined;
    ops.linkSync(temporaryPath, finalPath);
    published = true;
    ops.unlinkSync(temporaryPath);
    syncDirectoryIfSupported(directory, ops);
    return { path: assessmentPath(workId), value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    if (descriptor !== undefined) {
      try { ops.closeSync(descriptor); } catch { /* cleanup continues */ }
      descriptor = undefined;
    }
    try {
      if (published) removeIfPresent(ops, finalPath);
      removeIfPresent(ops, temporaryPath);
    } catch (cleanupError) {
      cliError("WR_FILE_WRITE_FAILED", `Readiness cleanup failed: ${cleanupError.message}`, assessmentPath(workId));
    }
    if (error instanceof WorkReadinessError) throw error;
    if (error?.code === "EEXIST") cliError("WR_READINESS_EXISTS", `Refusing to overwrite ${assessmentPath(workId)}`, assessmentPath(workId));
    cliError("WR_FILE_WRITE_FAILED", `Unable to create readiness artifact: ${error?.message ?? String(error)}`, assessmentPath(workId));
  }
}

function initAssessment({ root, positionals }) {
  if (positionals.length !== 1) cliError("WR_INVOCATION_INVALID", "Usage: init <WORK-ID>", "$.arguments");
  const workId = normalizeWorkId(positionals[0]);
  const created = createAssessmentFile({ root, workId });
  return { workIds: [workId], summary: `Created ${created.path}` };
}

function checkAssessment({ root, positionals, feedbackRecords }) {
  if (positionals.length !== 1) cliError("WR_INVOCATION_INVALID", "Usage: check <WORK-ID>", "$.arguments");
  const workId = normalizeWorkId(positionals[0]);
  validateOne(root, workId, feedbackRecords);
  return { workIds: [workId], summary: `${workId} readiness is valid` };
}

function readinessFiles(root) {
  const directory = join(root, "docs/readiness");
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") cliError("WR_READINESS_MISSING", "docs/readiness does not exist", "docs/readiness");
    throw error;
  }
  return entries.filter((entry) => entry.name.endsWith(".json")).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) cliError("WR_FILE_INVALID", `Readiness artifact must be a regular file: ${entry.name}`, `docs/readiness/${entry.name}`);
    const workId = entry.name.slice(0, -5);
    if (!WORK_ID.test(workId)) cliError("WR_READINESS_FILENAME_INVALID", `Readiness filename must be an official work ID: ${entry.name}`, `docs/readiness/${entry.name}`);
    return workId;
  }).sort();
}

function checkAllAssessments({ root, positionals, feedbackRecords }) {
  if (positionals.length !== 0) cliError("WR_INVOCATION_INVALID", "Usage: check-all", "$.arguments");
  const workIds = readinessFiles(root);
  workIds.forEach((workId) => validateOne(root, workId, feedbackRecords));
  return { workIds, summary: `Validated ${workIds.length} readiness artifact${workIds.length === 1 ? "" : "s"}` };
}

function checkRange({ root, positionals, options }) {
  if (positionals.length > 0 && (options.base !== undefined || options.head !== undefined)) {
    cliError("WR_INVOCATION_INVALID", "Do not mix positional and named range refs", "$.arguments");
  }
  let base = options.base;
  let head = options.head;
  if (base === undefined && positionals.length > 0) [base, head = "HEAD"] = positionals;
  if (base === undefined) ({ base, head } = resolveDefaultRange(root));
  else head ??= "HEAD";
  if (typeof base !== "string" || positionals.length > 2) {
    cliError("WR_INVOCATION_INVALID", "Usage: check-range [<base> [head]] or check-range [--base <base>] [--head <head>]", "$.arguments");
  }
  const result = validateRangeOwnership({ root, base, head });
  return { workIds: result.workIds, summary: `Range readiness is valid for ${result.changedPaths.length} changed path${result.changedPaths.length === 1 ? "" : "s"}` };
}

function checkStaged({ root, positionals, options }) {
  if (positionals.length !== 0 || typeof options.messageFile !== "string") cliError("WR_INVOCATION_INVALID", "Usage: check-staged --message-file <path>", "$.arguments");
  const message = readCanonicalMessageFile(root, options.messageFile);
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!/^[0-9a-f]{40}$/u.test(head)) cliError("WR_GIT_REF_INVALID", "HEAD did not resolve to one full commit", "$.head");
  const headLine = git(root, ["rev-list", "--parents", "-n", "1", head]).split(/\s+/u);
  if (headLine.length > 2) cliError("WR_GIT_TOPOLOGY_UNSUPPORTED", "Staged readiness does not support a merge HEAD", "$.head");
  const tree = git(root, ["write-tree"]);
  if (!/^[0-9a-f]{40}$/u.test(tree)) cliError("WR_GIT_COMMAND_FAILED", "Git index did not produce one tree", "$.git");
  const commit = git(root, ["commit-tree", tree, "-p", head, "-F", "-"], { input: message });
  if (!/^[0-9a-f]{40}$/u.test(commit)) cliError("WR_GIT_COMMAND_FAILED", "Git did not produce one ephemeral commit", "$.git");
  const result = validateRangeOwnership({ root, base: head, head: commit });
  return {
    workIds: result.workIds,
    summary: `Staged readiness ownership is valid for ${result.changedPaths.length} changed path${result.changedPaths.length === 1 ? "" : "s"}`,
  };
}

const commands = new Map([
  ["init", initAssessment],
  ["check", checkAssessment],
  ["check-all", checkAllAssessments],
  ["check-range", checkRange],
  ["check-staged", checkStaged],
]);

function parseArguments(argv) {
  const args = [...argv];
  const separatorIndices = args.map((value, index) => value === "--" ? index : -1).filter((index) => index >= 0);
  if (separatorIndices.length > 1) cliError("WR_INVOCATION_INVALID", "Argument separator may be supplied only once", "$.arguments");
  const separatorIndex = separatorIndices[0] ?? args.length;
  const optionArguments = args.slice(0, separatorIndex);
  const separatorPositionals = separatorIndex < args.length ? args.slice(separatorIndex + 1) : [];
  const jsonIndex = optionArguments.indexOf("--json");
  const json = jsonIndex >= 0;
  if (json) optionArguments.splice(jsonIndex, 1);
  if (optionArguments.includes("--json")) cliError("WR_INVOCATION_INVALID", "--json may be supplied only once", "$.arguments");
  const command = optionArguments.shift();
  if (!commands.has(command)) cliError("WR_INVOCATION_INVALID", "Command must be one of init, check, check-all, check-range, check-staged", "$.command");
  const options = {};
  const positionals = [];
  const names = new Map([["--base", "base"], ["--head", "head"], ["--message-file", "messageFile"]]);
  for (let index = 0; index < optionArguments.length; index += 1) {
    const argument = optionArguments[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const key = names.get(argument);
    if (key === undefined || options[key] !== undefined || index + 1 >= optionArguments.length || optionArguments[index + 1].startsWith("--")) {
      cliError("WR_INVOCATION_INVALID", `Invalid option ${argument}`, "$.arguments");
    }
    options[key] = optionArguments[index + 1];
    index += 1;
  }
  positionals.push(...separatorPositionals);
  const allowed = command === "check-range" ? new Set(["base", "head"]) : command === "check-staged" ? new Set(["messageFile"]) : new Set();
  if (Object.keys(options).some((key) => !allowed.has(key))) cliError("WR_INVOCATION_INVALID", `Unsupported option for ${command}`, "$.arguments");
  return { command, json, positionals, options };
}

function errorRecord(error) {
  return {
    code: error instanceof WorkReadinessError ? error.code : "WR_INTERNAL_ERROR",
    path: error instanceof WorkReadinessError ? error.path : "$",
    message: error instanceof Error ? error.message : String(error),
  };
}

function exitStatus(error) {
  if (!(error instanceof WorkReadinessError)) return 2;
  if (error.code === "WR_INVOCATION_INVALID" || error.code === "WR_REPOSITORY_INVALID" || error.code === "WR_FILE_WRITE_FAILED"
    || error.code.startsWith("WR_GIT_") || ["WR_PATH_ESCAPE", "WR_PATH_INVALID", "WR_FILE_INVALID"].includes(error.code)) return 2;
  return 1;
}

function emit(output, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }
  if (output.ok) process.stdout.write(`${output.summary}\n`);
  else process.stderr.write(`${output.errors[0].code}: ${output.errors[0].message}\n`);
}

function main() {
  let parsed = { command: process.argv[2] ?? null, json: process.argv.includes("--json") };
  try {
    parsed = parseArguments(process.argv.slice(2));
    const root = repositoryRoot(process.cwd());
    const feedbackRecords = parsed.command === "check-staged" ? [] : loadFeedback(root);
    const result = commands.get(parsed.command)({ root, positionals: parsed.positionals, options: parsed.options, feedbackRecords });
    emit({ ok: true, command: parsed.command, work_ids: result.workIds, errors: [], summary: result.summary }, parsed.json);
  } catch (error) {
    const record = errorRecord(error);
    emit({ ok: false, command: parsed.command, work_ids: [], errors: [record], summary: record.message }, parsed.json);
    process.exitCode = exitStatus(error);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
