import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const CACHE_SCHEMA_VERSION = 2;
const CACHE_DIRECTORY = path.join("ledger-mutation-cache", `v${CACHE_SCHEMA_VERSION}`);
const EVIDENCE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const UNSAFE_KEY_PATTERN = /(?:database.?url|password|token|authorization|credential|secret|api.?key|^__proto__$|^prototype$|^constructor$)/i;
const UNSAFE_VALUE_PATTERN = /(?:\b[a-z][a-z\d+.-]*:\/\/|\b(?:basic|bearer)\s+|^--?[\w-]*(?:password|token|authorization|credential|secret|api[-_]?key|database[-_]?url))/i;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/i;
const VERSION_PATTERN = /^v?\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?$/i;
const MUTANT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const MUTATOR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 ]{0,100}$/;
const TERMINAL_MUTANT_STATUSES = new Set([
  "Killed", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Timeout", "Ignored",
]);
const ALLOWED_ARTIFACTS = new Set(["mutation-report.json", "projection-evidence.json"]);
const RUNTIME_PROFILE_PATTERNS = {
  platform: /^(?:aix|darwin|freebsd|linux|openbsd|sunos|win32)$/,
  arch: /^(?:arm|arm64|ia32|loong64|mips|mipsel|ppc|ppc64|riscv64|s390|s390x|x64)$/,
  locale: /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i,
  timezone: /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/,
  databaseDriver: IDENTIFIER_PATTERN,
  databaseHarness: IDENTIFIER_PATTERN,
  databaseServerVersion: VERSION_PATTERN,
  schemaFingerprint: EVIDENCE_KEY_PATTERN,
};
const ENTRY_FIELDS = new Set([
  "schemaVersion",
  "evidenceKey",
  "result",
  "shardKind",
  "classification",
  "durationMs",
  "toolVersions",
  "runtimeProfile",
  "dependencyHashes",
  "commandList",
  "commandIdentity",
  "artifacts",
]);

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function unsafeMetadata() {
  throw new Error("Unsafe cache metadata");
}

function assertSafeString(value) {
  if (typeof value !== "string" || UNSAFE_VALUE_PATTERN.test(value)) unsafeMetadata();
}

function inspectMetadata(value, parentKey = "") {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) unsafeMetadata();
    return;
  }
  if (typeof value === "string") {
    assertSafeString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectMetadata(item);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    unsafeMetadata();
  }
  for (const [key, nested] of Object.entries(value)) {
    if (parentKey !== "dependencyHashes" && key !== "evidenceKey" && UNSAFE_KEY_PATTERN.test(key)) {
      unsafeMetadata();
    }
    inspectMetadata(nested, key);
  }
}

function canonicalMetadata(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalMetadata).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalMetadata(value[key])}`).join(",")}}`;
}

function stringRecord(value, valuePattern = null, { allowSensitiveKeys = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) unsafeMetadata();
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if ((!allowSensitiveKeys && UNSAFE_KEY_PATTERN.test(key)) || typeof item !== "string"
        || (valuePattern && !valuePattern.test(item))) {
      unsafeMetadata();
    }
    assertSafeString(item);
    result[key] = item;
  }
  return result;
}

function assertEvidenceKey(evidenceKey) {
  if (typeof evidenceKey !== "string" || !EVIDENCE_KEY_PATTERN.test(evidenceKey)) {
    throw new TypeError("evidenceKey must be a lowercase SHA-256 digest");
  }
}

function artifactRelativePath(name) {
  if (typeof name !== "string" || name.length === 0 || path.isAbsolute(name)) {
    throw new TypeError("Artifact names must be non-empty relative paths");
  }
  if (name.split(/[\\/]/).includes("..")) {
    throw new TypeError("Artifact paths cannot traverse outside a cache entry");
  }
  const normalized = path.normalize(name);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new TypeError("Artifact paths cannot escape a cache entry");
  }
  return normalized;
}

function isStrictlyWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function assertCacheRoot(root, { create = false } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)
      || path.basename(root) !== `v${CACHE_SCHEMA_VERSION}`
      || path.basename(path.dirname(root)) !== "ledger-mutation-cache") {
    throw new Error(`Refusing unvalidated cache path: ${root}`);
  }
  const absoluteRoot = path.resolve(root);
  const commonDirectory = path.dirname(path.dirname(absoluteRoot));
  for (const gitControl of ["HEAD", "config"]) {
    const controlPath = path.join(commonDirectory, gitControl);
    if (!existsSync(controlPath) || lstatSync(controlPath).isSymbolicLink()
        || !lstatSync(controlPath).isFile()) {
      throw new Error(`Refusing non-Git-common cache path: ${root}`);
    }
  }
  let existing = absoluteRoot;
  while (!existsSync(existing)) existing = path.dirname(existing);
  let current = path.parse(existing).root;
  for (const component of path.relative(current, existing).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlink cache path: ${root}`);
    }
  }
  if (!lstatSync(existing).isDirectory()) throw new Error(`Refusing unvalidated cache path: ${root}`);
  if (create) mkdirSync(absoluteRoot, { recursive: true });
  if (existsSync(absoluteRoot)) {
    if (lstatSync(absoluteRoot).isSymbolicLink() || !lstatSync(absoluteRoot).isDirectory()
        || realpathSync(absoluteRoot) !== absoluteRoot) {
      throw new Error(`Refusing unvalidated cache path: ${root}`);
    }
  }
  return absoluteRoot;
}

export function projectMutationReportArtifact(report) {
  const config = report?.config;
  if (!config || !Array.isArray(config.mutate) || typeof config.configFile !== "string"
      || typeof config.jsonReporter?.fileName !== "string") {
    throw new Error("Mutation report cannot be safely projected");
  }
  const files = {};
  for (const [fileName, file] of Object.entries(report.files ?? {})) {
    if (typeof fileName !== "string" || typeof file?.source !== "string"
        || !Array.isArray(file.mutants)) throw new Error("Mutation report cannot be safely projected");
    assertSafeString(fileName);
    const safeFileName = artifactRelativePath(fileName);
    files[safeFileName] = {
      sourceHash: digest(file.source),
      mutants: file.mutants.map((mutant) => {
        const id = String(mutant.id);
        const mutatorName = String(mutant.mutatorName ?? "unknown");
        const status = String(mutant.status);
        const location = mutant.location;
        if (!MUTANT_ID_PATTERN.test(id) || !MUTATOR_NAME_PATTERN.test(mutatorName)
            || !TERMINAL_MUTANT_STATUSES.has(status)
            || !location || typeof location !== "object" || Array.isArray(location)
            || Object.keys(location).some((key) => key !== "start" && key !== "end")) {
          throw new Error("Mutation report cannot be safely projected");
        }
        const projectPosition = (position) => {
          if (!position || typeof position !== "object" || Array.isArray(position)
              || Object.keys(position).some((key) => key !== "line" && key !== "column")
              || !Number.isInteger(position.line) || position.line < 1
              || (position.column !== undefined
                && (!Number.isInteger(position.column) || position.column < 0))) {
            throw new Error("Mutation report cannot be safely projected");
          }
          return position.column === undefined
            ? { line: position.line }
            : { line: position.line, column: position.column };
        };
        const projected = {
          id,
          mutatorName,
          location: { start: projectPosition(location.start), end: projectPosition(location.end) },
          status,
        };
        return projected;
      }),
    };
  }
  return { config: { mutationIdentity: digest(canonicalMetadata(config.mutate)) }, files };
}

function safeArtifactPath(entryDirectory, relativePath) {
  const realEntryDirectory = realpathSync(entryDirectory);
  let candidate = entryDirectory;
  for (const component of relativePath.split(path.sep)) {
    candidate = path.join(candidate, component);
    const candidateStat = lstatSync(candidate);
    if (candidateStat.isSymbolicLink()) throw new Error("symlink artifact path");
  }
  const realCandidate = realpathSync(candidate);
  if (!isStrictlyWithin(realEntryDirectory, realCandidate)) {
    throw new Error("artifact escaped cache entry");
  }
  return realCandidate;
}

function safeEntry(entry, evidenceKey, artifactHashes) {
  inspectMetadata(entry);
  if (Object.keys(entry).some((field) => !ENTRY_FIELDS.has(field))) unsafeMetadata();
  const persisted = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    evidenceKey,
    result: "passed",
  };
  for (const field of ["shardKind", "classification"]) {
    if (entry[field] !== undefined) {
      assertSafeString(entry[field]);
      if (!IDENTIFIER_PATTERN.test(entry[field])) unsafeMetadata();
      persisted[field] = entry[field];
    }
  }
  if (entry.durationMs !== undefined) {
    if (typeof entry.durationMs !== "number" || !Number.isFinite(entry.durationMs)
        || entry.durationMs < 0) {
      unsafeMetadata();
    }
    persisted.durationMs = entry.durationMs;
  }
  if (entry.toolVersions !== undefined) {
    persisted.toolVersions = stringRecord(entry.toolVersions, VERSION_PATTERN);
  }
  if (entry.runtimeProfile !== undefined) {
    if (!entry.runtimeProfile || typeof entry.runtimeProfile !== "object"
        || Array.isArray(entry.runtimeProfile)) {
      unsafeMetadata();
    }
    const runtimeProfile = {};
    for (const [key, value] of Object.entries(entry.runtimeProfile)) {
      const pattern = RUNTIME_PROFILE_PATTERNS[key];
      if (!pattern) unsafeMetadata();
      assertSafeString(value);
      if (!pattern.test(value)) unsafeMetadata();
      runtimeProfile[key] = value;
    }
    persisted.runtimeProfile = runtimeProfile;
  }
  if (entry.dependencyHashes !== undefined) {
    persisted.dependencyHashes = stringRecord(
      entry.dependencyHashes,
      EVIDENCE_KEY_PATTERN,
      { allowSensitiveKeys: true },
    );
  }
  if (entry.commandList !== undefined) {
    persisted.commandIdentity = digest(canonicalMetadata(entry.commandList));
  } else if (entry.commandIdentity !== undefined) {
    if (typeof entry.commandIdentity !== "string"
        || !EVIDENCE_KEY_PATTERN.test(entry.commandIdentity)) {
      unsafeMetadata();
    }
    persisted.commandIdentity = entry.commandIdentity;
  }
  persisted.artifacts = artifactHashes;
  return persisted;
}

function entryCount(root) {
  if (!existsSync(root)) return 0;
  return readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory() && EVIDENCE_KEY_PATTERN.test(item.name))
    .length;
}

export function cacheRoot(repoRoot, runGit) {
  if (typeof runGit !== "function") throw new TypeError("runGit callback is required");
  const absoluteRepository = realpathSync(repoRoot);
  const commonDirectoryOutput = runGit(
    ["rev-parse", "--git-common-dir"],
    { cwd: absoluteRepository },
  );
  if (typeof commonDirectoryOutput !== "string" || commonDirectoryOutput.trim() === "") {
    throw new Error("git rev-parse --git-common-dir returned no path");
  }
  const commonDirectory = path.resolve(absoluteRepository, commonDirectoryOutput.trim());
  return path.join(realpathSync(commonDirectory), CACHE_DIRECTORY);
}

export function readCacheEntry({ root, evidenceKey, validateArtifacts }) {
  assertEvidenceKey(evidenceKey);
  if (typeof validateArtifacts !== "function") {
    throw new TypeError("validateArtifacts callback is required");
  }
  try {
    root = assertCacheRoot(root);
  } catch {
    return { hit: false, reason: "entry-invalid" };
  }
  const entryDirectory = path.join(root, evidenceKey);
  if (!existsSync(entryDirectory)) return { hit: false, reason: "not-found" };

  let entry;
  try {
    const directoryStat = lstatSync(entryDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      return { hit: false, reason: "entry-invalid" };
    }
    const entryPath = path.join(entryDirectory, "entry.json");
    const entryStat = lstatSync(entryPath);
    if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
      return { hit: false, reason: "entry-invalid" };
    }
    entry = JSON.parse(readFileSync(entryPath, "utf8"));
  } catch {
    return { hit: false, reason: "entry-invalid" };
  }
  if (entry?.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return { hit: false, reason: "schema-version-mismatch" };
  }
  if (entry.evidenceKey !== evidenceKey) {
    return { hit: false, reason: "evidence-key-mismatch" };
  }
  if (entry.result !== "passed") {
    return { hit: false, reason: "result-not-passed" };
  }
  if (!entry.artifacts || typeof entry.artifacts !== "object" || Array.isArray(entry.artifacts)) {
    return { hit: false, reason: "artifact-manifest-invalid" };
  }
  try {
    const normalizedEntry = safeEntry(entry, evidenceKey, entry.artifacts);
    if (canonicalMetadata(normalizedEntry) !== canonicalMetadata(entry)) {
      return { hit: false, reason: "entry-metadata-invalid" };
    }
  } catch {
    return { hit: false, reason: "entry-metadata-invalid" };
  }

  const artifacts = {};
  for (const [name, expectedHash] of Object.entries(entry.artifacts)) {
    if (!ALLOWED_ARTIFACTS.has(name)) {
      return { hit: false, reason: "artifact-manifest-invalid" };
    }
    let relativePath;
    try {
      relativePath = artifactRelativePath(name);
    } catch {
      return { hit: false, reason: "artifact-manifest-invalid" };
    }
    if (typeof expectedHash !== "string" || !EVIDENCE_KEY_PATTERN.test(expectedHash)) {
      return { hit: false, reason: "artifact-manifest-invalid" };
    }
    let artifactPath;
    let contents;
    try {
      artifactPath = safeArtifactPath(entryDirectory, relativePath);
      const artifactStat = lstatSync(artifactPath);
      if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
        return { hit: false, reason: "artifact-missing" };
      }
      contents = readFileSync(artifactPath);
    } catch {
      return { hit: false, reason: "artifact-missing" };
    }
    if (digest(contents) !== expectedHash) {
      return { hit: false, reason: "artifact-hash-mismatch" };
    }
    artifacts[name] = artifactPath;
  }
  if (Object.keys(artifacts).length === 0) {
    return { hit: false, reason: "artifact-manifest-invalid" };
  }

  try {
    if (validateArtifacts(artifacts, entry) !== true) {
      return { hit: false, reason: "artifact-validation-failed" };
    }
  } catch {
    return { hit: false, reason: "artifact-validation-failed" };
  }
  return { hit: true, entry, artifacts };
}

export function writeSuccessfulCacheEntry({
  root, evidenceKey, entry, artifacts, artifactProjectors,
}) {
  assertEvidenceKey(evidenceKey);
  if (!entry || entry.result !== "passed") {
    throw new Error("Only passed mutation evidence may be cached");
  }
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new TypeError("artifacts must map cache names to source files");
  }
  const artifactEntries = Object.entries(artifacts);
  if (artifactEntries.length === 0) throw new Error("A cache entry requires artifacts");
  if (!artifactProjectors || typeof artifactProjectors !== "object"
      || Array.isArray(artifactProjectors)
      || Object.keys(artifactProjectors).length !== artifactEntries.length) {
    throw new Error("Each cache artifact requires an exact safe projector");
  }
  for (const [name] of artifactEntries) {
    if (!ALLOWED_ARTIFACTS.has(name) || typeof artifactProjectors[name] !== "function"
        || (name === "mutation-report.json"
          && artifactProjectors[name] !== projectMutationReportArtifact)) {
      throw new Error(`Cache artifact is not allowlisted with a safe projector: ${name}`);
    }
  }

  root = assertCacheRoot(root, { create: true });
  const entryDirectory = path.join(root, evidenceKey);
  const temporaryDirectory = path.join(
    root,
    `.${evidenceKey}.${process.pid}.${randomBytes(8).toString("hex")}.temporary`,
  );
  mkdirSync(temporaryDirectory);
  try {
    const artifactHashes = {};
    for (const [name, sourcePath] of artifactEntries) {
      const relativePath = artifactRelativePath(name);
      if (typeof sourcePath !== "string" || !statSync(sourcePath).isFile()) {
        throw new TypeError(`Artifact source is not a file: ${name}`);
      }
      const destination = path.join(temporaryDirectory, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      const rawArtifact = JSON.parse(readFileSync(sourcePath, "utf8"));
      const projectedArtifact = artifactProjectors[name](rawArtifact);
      if (!projectedArtifact || typeof projectedArtifact !== "object"
          || Array.isArray(projectedArtifact)) {
        throw new Error(`Cache artifact projector returned an unsafe value: ${name}`);
      }
      inspectMetadata(projectedArtifact);
      writeFileSync(destination, `${canonicalMetadata(projectedArtifact)}\n`, {
        encoding: "utf8", mode: 0o600,
      });
      artifactHashes[name] = digest(readFileSync(destination));
    }
    if (Object.keys(artifactHashes).length === 0) {
      throw new Error("A cache entry requires a persistable artifact");
    }
    writeFileSync(
      path.join(temporaryDirectory, "entry.json"),
      `${JSON.stringify(safeEntry(entry, evidenceKey, artifactHashes))}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    if (existsSync(entryDirectory)) {
      const entryStat = lstatSync(entryDirectory);
      if (!entryStat.isDirectory() || entryStat.isSymbolicLink()
          || !isStrictlyWithin(root, realpathSync(entryDirectory))) {
        throw new Error(`Refusing unvalidated cache entry path: ${entryDirectory}`);
      }
      rmSync(entryDirectory, { recursive: true });
    }
    try {
      renameSync(temporaryDirectory, entryDirectory);
    } catch (error) {
      if (!existsSync(entryDirectory)) throw error;
    }
    return entryDirectory;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function inspectMutationCache({ repoRoot, runGit }) {
  const root = cacheRoot(repoRoot, runGit);
  return { root, count: entryCount(root) };
}

export function clearMutationCache({ repoRoot, runGit }) {
  const root = cacheRoot(repoRoot, runGit);
  if (!existsSync(root)) return { root, count: 0 };

  assertCacheRoot(root);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Refusing to clear unvalidated cache path: ${root}`);
  }
  const resolvedRoot = realpathSync(root);
  if (resolvedRoot !== root || path.basename(root) !== `v${CACHE_SCHEMA_VERSION}`
      || path.basename(path.dirname(root)) !== "ledger-mutation-cache") {
    throw new Error(`Refusing to clear unvalidated cache path: ${root}`);
  }
  const count = entryCount(root);
  rmSync(root, { recursive: true });
  return { root, count };
}
