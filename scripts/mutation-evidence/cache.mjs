import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
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

export const CACHE_SCHEMA_VERSION = 1;
const CACHE_DIRECTORY = path.join("ledger-mutation-cache", `v${CACHE_SCHEMA_VERSION}`);
const EVIDENCE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const UNSAFE_KEY_PATTERN = /(?:database.?url|password|token|authorization|credential|secret|api.?key|^__proto__$|^prototype$|^constructor$)/i;
const UNSAFE_VALUE_PATTERN = /(?:\b[a-z][a-z\d+.-]*:\/\/|\b(?:basic|bearer)\s+|^--?[\w-]*(?:password|token|authorization|credential|secret|api[-_]?key|database[-_]?url))/i;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/i;
const VERSION_PATTERN = /^v?\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?$/i;
const RUNTIME_PROFILE_PATTERNS = {
  platform: /^(?:aix|darwin|freebsd|linux|openbsd|sunos|win32)$/,
  arch: /^(?:arm|arm64|ia32|loong64|mips|mipsel|ppc|ppc64|riscv64|s390|s390x|x64)$/,
  locale: /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i,
  timezone: /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/,
  databaseDriver: IDENTIFIER_PATTERN,
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

function stringRecord(value, valuePattern = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) unsafeMetadata();
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEY_PATTERN.test(key) || typeof item !== "string"
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
    persisted.dependencyHashes = stringRecord(entry.dependencyHashes, EVIDENCE_KEY_PATTERN);
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

export function writeSuccessfulCacheEntry({ root, evidenceKey, entry, artifacts }) {
  assertEvidenceKey(evidenceKey);
  if (!entry || entry.result !== "passed") {
    throw new Error("Only passed mutation evidence may be cached");
  }
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new TypeError("artifacts must map cache names to source files");
  }
  const artifactEntries = Object.entries(artifacts);
  if (artifactEntries.length === 0) throw new Error("A cache entry requires artifacts");

  mkdirSync(root, { recursive: true });
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
      copyFileSync(sourcePath, destination);
      artifactHashes[name] = digest(readFileSync(destination));
    }
    writeFileSync(
      path.join(temporaryDirectory, "entry.json"),
      `${JSON.stringify(safeEntry(entry, evidenceKey, artifactHashes))}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    rmSync(entryDirectory, { recursive: true, force: true });
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
