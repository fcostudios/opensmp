import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { canonicalJson, sha256 } from "./fingerprint.mjs";
import { isBookkeepingPath } from "../work-readiness/delivery-policy.mjs";
import { WorkReadinessError, classifyAssessment, computeReadinessPayloadSha256, validateOwnedScopeShape } from "../work-readiness/model.mjs";
import { loadCommittedReadinessAuthority } from "../work-readiness/git.mjs";

export { validateOwnedScopeShape };

function reject(path, message) {
  throw new WorkReadinessError("WR_OWNED_SCOPE_AUTHORITY", message, path);
}

function requireDiskBinding(authority) {
  const path = `docs/readiness/${authority.artifact.work_id}.json`;
  try {
    const absolute = join(authority.root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(absolute).equals(authority.bytes)) reject(path, "Working artifact differs from committed authority");
    const diskLines = readFileSync(join(authority.root, ".nous-feedback.jsonl"), "utf8").split("\n");
    const committedLines = (authority.feedbackText ?? "").split("\n");
    for (const record of authority.feedbackRecords.filter(record => record.event === "decision" && record.id === authority.artifact.approval.evidence)) {
      const matching = committedLines.filter(line => { try { const value = JSON.parse(line); return value.event === "decision" && value.id === record.id; } catch { return false; } });
      if (matching.length !== 1 || !diskLines.includes(matching[0])) reject(".nous-feedback.jsonl", "Approval record differs from committed authority");
    }
  } catch (error) {
    if (error instanceof WorkReadinessError) throw error;
    reject(path, "Committed authority is unavailable in the working tree");
  }
}

export function loadApprovedOwnedScope({ root, governingWorkId, subjectWorkId, executionHead }) {
  const governing = loadCommittedReadinessAuthority({ root, revision: executionHead, workId: governingWorkId });
  requireDiskBinding(governing);
  if (governing.artifact.kind !== "CHG" || governing.artifact.work_type !== "technical" || governing.assessment.decision !== "ready" || !governing.assessment.active) reject("$.governingWorkId", "Owned scope requires active ready technical CHG authority");
  const scope = validateOwnedScopeShape(governing.artifact.mutation_scope);
  if (scope.subject_work_id !== subjectWorkId) reject("$.subjectWorkId", "Owned scope authority is for a different subject");
  const subject = loadCommittedReadinessAuthority({ root, revision: executionHead, workId: subjectWorkId });
  requireDiskBinding(subject);
  if (subject.assessment.decision !== "ready" || (!subject.assessment.active && !subject.assessment.complete) || subject.artifact.approval.status !== "approved") reject("$.subjectWorkId", "Owned scope subject requires valid approval");
  if (scope.subject_readiness_sha256 !== subject.artifact.readiness_payload_sha256) reject("$.mutation_scope.subject_readiness_sha256", "Owned scope subject digest differs from approved payload");
  return { scope, governingWorkId, governingDigest: governing.artifact.readiness_payload_sha256, subjectDigest: subject.artifact.readiness_payload_sha256, expectedMutationShards: governing.artifact.signals.expected_mutation_shards };
}

function scopeGit(root, args, { optional = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, shell: false, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (optional && error.status !== undefined) return null;
    reject("$.git", "Owned scope immutable Git input is unavailable");
  }
}

function requireCommit(root, commit) {
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/u.test(commit)
    || scopeGit(root, ["cat-file", "-t", commit]).toString("utf8").trim() !== "commit") reject("$.scope", "Owned scope requires immutable full commit IDs");
}

function blobEntry(root, commit, path) {
  const entries = scopeGit(root, ["ls-tree", "-z", commit, "--", path]).toString("utf8").split("\0").filter(Boolean);
  if (entries.length === 0) return null;
  if (entries.length !== 1) reject(path, "Owned source has ambiguous tree entries");
  const entry = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entries[0]);
  if (!entry || entry[3] !== path) reject(path, "Owned source must be a regular Git blob, not a symlink or submodule");
  return { mode: entry[1], blob: entry[2] };
}

function gitBlob(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function executionPath(path) {
  return !isBookkeepingPath(path) && !/^(?:\.tmp|reports|coverage|\.cache|\.next|\.turbo)(?:\/|$)/u.test(path)
    && !/(?:^|\/)node_modules(?:\/|$)|\.tsbuildinfo$/u.test(path);
}

export function snapshotOwnedExecution(root, executionHead, mutatable) {
  requireCommit(root, executionHead);
  if (scopeGit(root, ["rev-parse", "HEAD"]).toString("utf8").trim() !== executionHead) reject("$.executionHead", "Execution HEAD changed");
  const dirty = scopeGit(root, ["diff", "--name-only", "-z", executionHead, "--"]).toString("utf8").split("\0").filter(Boolean).filter(executionPath);
  if (dirty.length) reject(dirty[0], "Owned scope refuses dirty tracked execution inputs");
  const untracked = scopeGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean);
  if (mutatable(untracked).length) reject("$.executionInputs", "Owned scope refuses untracked mutatable sources");
  const paths = scopeGit(root, ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean).filter(executionPath).sort();
  const hashes = Object.fromEntries(paths.map(path => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    // Existing unrelated symlinks have their link identity pinned in Git; owned
    // source paths separately require physical regular files.
    return [path, stat.isSymbolicLink() ? scopeGit(root, ["ls-files", "--stage", "--", path]).toString("utf8") : sha256(readFileSync(absolute))];
  }));
  return { root, executionHead, hashes };
}

export function resolveOwnedMutationScope({ root, authority, executionHead }, parserPorts) {
  if (typeof root !== "string" || !isAbsolute(root)) reject("$.root", "Owned scope requires the absolute repository root");
  root = realpathSync(root);
  if (realpathSync(scopeGit(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim()) !== root) reject("$.root", "Owned scope requires the repository top level");
  const scope = validateOwnedScopeShape(authority.scope);
  const { mutationTargetsFromPatch, mutationHunksFromPatch, mutatable } = parserPorts;
  requireCommit(root, scope.scope_base); requireCommit(root, scope.scope_head); requireCommit(root, executionHead);
  if (scopeGit(root, ["merge-base", "--is-ancestor", scope.scope_base, scope.scope_head], { optional: true }) === null) reject("$.scope_base", "Scope base must be ancestor of scope head");
  const paths = scope.sources.map(source => source.path);
  if (canonicalJson(mutatable(paths)) !== canonicalJson(paths)) reject("$.sources", "Owned scope sources must all be supported mutatable production files");
  const statuses = scopeGit(root, ["diff", "--name-status", "-z", "--find-renames", scope.scope_base, scope.scope_head, "--"]).toString("utf8").split("\0").filter(Boolean);
  for (let index = 0; index < statuses.length;) {
    const status = statuses[index++];
    const names = statuses.slice(index, index + (/^[RC]/u.test(status) ? 2 : 1)); index += names.length;
    if (names.some(path => paths.includes(path)) && !/^[AM]$/u.test(status)) reject("$.sources", "Owned scope refuses deleted, renamed, copied or unsupported sources");
  }
  for (const source of scope.sources) {
    const historical = blobEntry(root, scope.scope_head, source.path);
    const current = blobEntry(root, executionHead, source.path);
    if (!historical || !current || historical.blob !== source.head_blob || current.blob !== source.head_blob) reject(source.path, "Owned source blob differs from approved historical scope");
    const absolute = join(root, source.path);
    if (!lstatSync(absolute).isFile() || relative(root, realpathSync(absolute)).split(sep).join("/") !== source.path
      || gitBlob(readFileSync(absolute)) !== source.head_blob) reject(source.path, "Owned source working bytes must match the approved regular blob");
  }
  const executionInputs = snapshotOwnedExecution(root, executionHead, mutatable);
  const patch = scopeGit(root, ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", "--unified=0", scope.scope_base, scope.scope_head, "--", ...paths]).toString("utf8");
  const targets = mutationTargetsFromPatch(patch);
  const hunks = mutationHunksFromPatch(patch, source => ({
    oldContents: blobEntry(root, scope.scope_base, source) ? scopeGit(root, ["show", `${scope.scope_base}:${source}`]).toString("utf8") : "",
    newContents: scopeGit(root, ["show", `${scope.scope_head}:${source}`]).toString("utf8"),
  }));
  const sources = scope.sources.map(source => {
    const ranges = targets.filter(target => target.startsWith(`${source.path}:`)).map(target => {
      const coordinate = /:(\d+)-(\d+)$/u.exec(target);
      return { start: Number(coordinate[1]), end: Number(coordinate[2]) };
    }).sort((left, right) => left.start - right.start || left.end - right.end);
    if (!ranges.length) reject(source.path, "Every owned source requires supported nonempty historical ranges");
    return { path: source.path, headBlob: source.head_blob, ranges };
  });
  const scopeDigest = sha256(canonicalJson({ version: 1, base: scope.scope_base, head: scope.scope_head, sources }));
  const ownedScope = { version: 1, governingWorkId: authority.governingWorkId, governingDigest: authority.governingDigest,
    subjectWorkId: scope.subject_work_id, subjectDigest: authority.subjectDigest, scopeBase: scope.scope_base, scopeHead: scope.scope_head, sources, scopeDigest };
  return { changedPaths: paths, targets, hunks, ownedScope, executionInputs: { ...executionInputs,
    governingWorkId: authority.governingWorkId, subjectWorkId: scope.subject_work_id,
    governingDigest: authority.governingDigest, subjectDigest: authority.subjectDigest } };
}

export function loadPlannedOwnedScope({ root, governingWorkId }) {
  if (typeof governingWorkId !== "string" || !/^CHG-[0-9]{3,}$/u.test(governingWorkId)) reject("$.governingWorkId", "Planning requires an official CHG ID");
  const artifact = JSON.parse(readFileSync(join(root, `docs/readiness/${governingWorkId}.json`), "utf8"));
  // Shape and digest only: planning deliberately cannot mint execution authority.
  classifyAssessment(artifact);
  if (computeReadinessPayloadSha256(artifact) !== artifact.readiness_payload_sha256) reject("$.readiness_payload_sha256", "Planning artifact digest differs from its full payload");
  const scope = validateOwnedScopeShape(artifact.mutation_scope);
  if (artifact.work_id !== governingWorkId || artifact.kind !== "CHG" || artifact.work_type !== "technical" || scope.subject_work_id === governingWorkId) reject("$.mutation_scope", "Planning requires a technical governing CHG");
  return { scope, governingWorkId, governingDigest: artifact.readiness_payload_sha256, subjectDigest: scope.subject_readiness_sha256, expectedMutationShards: artifact.signals?.expected_mutation_shards };
}

function closedProvenanceObject(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) reject(path, "Owned provenance requires the exact closed object shape");
}

export function validateOwnedScopeProvenance(value) {
  closedProvenanceObject(value, ["version", "governingWorkId", "governingDigest", "subjectWorkId", "subjectDigest", "scopeBase", "scopeHead", "sources", "scopeDigest"], "$.ownedScope");
  if (typeof value.governingWorkId !== "string" || !/^CHG-[0-9]{3,}$/u.test(value.governingWorkId)
    || value.governingWorkId === value.subjectWorkId) reject("$.ownedScope.governingWorkId", "Owned provenance requires a distinct governing CHG");
  for (const key of ["governingDigest", "subjectDigest", "scopeDigest"]) {
    if (typeof value[key] !== "string" || !/^[0-9a-f]{64}$/u.test(value[key])) reject(`$.ownedScope.${key}`, "Owned provenance requires lowercase SHA-256");
  }
  if (!Array.isArray(value.sources)) reject("$.ownedScope.sources", "Owned provenance sources must be an array");
  validateOwnedScopeShape({ version: value.version, subject_work_id: value.subjectWorkId, subject_readiness_sha256: value.subjectDigest,
    scope_base: value.scopeBase, scope_head: value.scopeHead, sources: value.sources.map(source => {
      closedProvenanceObject(source, ["path", "headBlob", "ranges"], "$.ownedScope.sources");
      if (!Array.isArray(source.ranges) || !source.ranges.length) reject("$.ownedScope.sources.ranges", "Every source must retain nonempty ranges");
      let previous = null;
      for (const range of source.ranges) {
        closedProvenanceObject(range, ["start", "end"], "$.ownedScope.sources.ranges");
        if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start
          || previous && (range.start < previous.start || range.start === previous.start && range.end <= previous.end)) reject("$.ownedScope.sources.ranges", "Ranges must be positive safe integers, sorted and unique");
        previous = range;
      }
      return { path: source.path, head_blob: source.headBlob };
    }) });
  const computed = sha256(canonicalJson({ version: value.version, base: value.scopeBase, head: value.scopeHead, sources: value.sources }));
  if (computed !== value.scopeDigest) reject("$.ownedScope.scopeDigest", "Owned provenance digest does not match complete source ranges");
  return value;
}

export function assertOwnedExecutionUnchanged(snapshot, mutatable = paths => paths.filter(path => /\.[cm]?[jt]sx?$/u.test(path) && !/\.(?:test|spec)\./u.test(path))) {
  const current = snapshotOwnedExecution(snapshot.root, snapshot.executionHead, mutatable);
  if (canonicalJson(current.hashes) !== canonicalJson(snapshot.hashes)) reject("$.executionInputs", "Owned execution input identity changed during the run");
  if (snapshot.governingWorkId) {
    const authority = loadApprovedOwnedScope({ root: snapshot.root, governingWorkId: snapshot.governingWorkId, subjectWorkId: snapshot.subjectWorkId, executionHead: snapshot.executionHead });
    if (authority.governingDigest !== snapshot.governingDigest || authority.subjectDigest !== snapshot.subjectDigest) reject("$.executionInputs", "Owned execution approval identity changed during the run");
  }
}
