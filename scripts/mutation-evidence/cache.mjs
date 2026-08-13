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
const SAFE_ENTRY_FIELDS = [
  "shardKind",
  "classification",
  "durationMs",
  "toolVersions",
  "runtimeProfile",
  "dependencyHashes",
  "commandList",
];

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
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
  const normalized = path.normalize(name);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new TypeError("Artifact paths cannot escape a cache entry");
  }
  return normalized;
}

function safeEntry(entry, evidenceKey, artifactHashes) {
  const persisted = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    evidenceKey,
    result: "passed",
  };
  for (const field of SAFE_ENTRY_FIELDS) {
    if (entry[field] !== undefined) persisted[field] = entry[field];
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
    entry = JSON.parse(readFileSync(path.join(entryDirectory, "entry.json"), "utf8"));
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
    const artifactPath = path.join(entryDirectory, relativePath);
    let contents;
    try {
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
