#!/usr/bin/env node
// nous-sync-owns.mjs — emitted by the Nous substrate (IMP-410). Do not edit:
// the substrate owns this file and `nous_package.py sync` keeps it current.
//
// Recognises a commit that is ONLY a Nous sync, from the package's own tree.
//
//   node scripts/nous-sync-owns.mjs <base> <head>   # a committed range
//   node scripts/nous-sync-owns.mjs --staged        # HEAD vs the index (commit-msg)
//
// Exit 0 iff ALL of:
//   (a) `.nous-sync.json` changed; `.nous-project.json` + `.nous-provenance.json`
//       present, one `project_id` across all three, and `substrate_commit` /
//       `git_sha` both non-empty with one a prefix of the other;
//   (b) every other changed path is claimed in `.nous-sync.json` `files`, its
//       bytes hash (sha256, first 16 hex) to the claimed hash, and it matches
//       the substrate-managed ALLOWLIST below;
//   (c) each claim's `source` is generated | toolchain | emitted, or an
//       ABSOLUTE substrate path: starts with `/`, has a `Nous` segment, no `..`
//       segment, no NUL / control characters;
//   (d) provenance `dirty` is false (a dirty-tree delivery is not reproducible);
//   (e) a path deleted in the range was claimed in `.nous-sync.json` at BASE
//       (`--staged`: at HEAD), is no longer claimed at head (`--staged`: in the
//       index), and matches the ALLOWLIST — sync retiring what it had claimed.
// This is a CONVENTION gate over the package's own tree, not an authentication:
// whoever edits `.nous-sync.json` can claim a path, so it authorizes by
// consistency (claims, hashes, envelope agree), not by proof of authorship.
// Limitation: under `git commit --amend`, `--staged` compares the index with the
// commit being amended, so only the amend's delta is checked, not the whole commit.
// Exit 1 otherwise, one line per violation. Exit 2 on usage / not a git repo.
// Pure node built-ins: no network, no database, no dependencies.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// Derived at emission from the destinations `sync` writes. An entry ending in
// `/` is a prefix; any other entry is an exact path.
const ALLOWLIST = [
  ".cursorrules",
  ".githooks/",
  ".github/copilot-instructions.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "apps/api/src/main/resources/db/migration/",
  "apps/web/src/components/shell/nav-items.gen.ts",
  "docs/dashboard.html",
  "docs/decisions/",
  "docs/dev-guide/",
  "docs/discovered/",
  "docs/mocks/",
  "docs/screens/",
  "docs/specs-html/",
  "docs/specs/",
  "docs/stories/",
  "infra/scripts/",
  "package.json",
  "packages/db/package.json",
  "packages/db/scripts/apply-migrations.mjs",
  "packages/db/scripts/migration-plan.mjs",
  "scripts/check-test-mocks.mjs",
  "scripts/check-test-oracles.mjs",
  "scripts/mutation-preflight.mjs",
  "scripts/mutation-scope.mjs",
  "scripts/nous-sync-owns.mjs",
  "scripts/readiness-check.mjs",
  "stryker.conf.json",
  "testing/critical-paths.md"
];

const MANIFEST = ".nous-sync.json";
const IDENTITY = ".nous-project.json";
const PROVENANCE = ".nous-provenance.json";
const ENVELOPE = new Set([MANIFEST, IDENTITY, PROVENANCE]);
const SOURCE_TOKENS = new Set(["generated", "toolchain", "emitted"]);

// The path arm of the `source` vocabulary: an absolute host path into the
// substrate (`/…/Nous/…`). A bare substring test accepted "handwritten/Nous/x".
function isSubstratePath(source) {
  if (!source.startsWith("/") || /[\u0000-\u001f\u007f]/.test(source)) return false;
  const segments = source.split("/");
  return !segments.includes("..") && segments.slice(1, -1).includes("Nous");
}

function usage(message) {
  process.stderr.write(
    `nous-sync-owns: ${message}\n` +
    "usage: node scripts/nous-sync-owns.mjs <base> <head>\n" +
    "       node scripts/nous-sync-owns.mjs --staged\n");
  process.exit(2);
}

function git(args, asBuffer = false) {
  return execFileSync("git", args, {
    encoding: asBuffer ? null : "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 1024,
  });
}

try {
  if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
    usage("not inside a git work tree");
  }
} catch {
  usage("not a git repository (or git is unavailable)");
}

const argv = process.argv.slice(2);
let staged = false;
let base = null;
let head = null;
if (argv.length === 1 && argv[0] === "--staged") {
  staged = true;
} else if (argv.length === 2 && !argv.some((a) => a.startsWith("-"))) {
  [base, head] = argv;
  for (const rev of argv) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    } catch {
      usage(`not a commit: ${rev}`);
    }
  }
} else {
  usage("expected `<base> <head>` or `--staged`");
}

function changedPaths() {
  const args = staged
    ? ["diff", "--cached", "--name-status", "-z", "--no-renames"]
    : ["diff", "--name-status", "-z", "--no-renames", base, head];
  const tokens = git(args).split("\0").filter((t) => t !== "");
  const out = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    out.push({ status: tokens[i], path: tokens[i + 1] });
  }
  return out;
}

function showAtHead(path) {
  try {
    return git(["show", staged ? `:${path}` : `${head}:${path}`], true);
  } catch {
    return null;
  }
}

function showAtBase(path) {
  try {
    return git(["show", staged ? `HEAD:${path}` : `${base}:${path}`], true);
  } catch {
    return null;
  }
}

function claimsAtBase() {
  const raw = showAtBase(MANIFEST);
  if (raw === null) return {};
  try {
    const m = JSON.parse(raw.toString("utf8"));
    return m && m.files && typeof m.files === "object" ? m.files : {};
  } catch {
    return {};
  }
}

function jsonAtHead(path, violations) {
  const raw = showAtHead(path);
  if (raw === null) {
    violations.push(`${path}: envelope file absent at head`);
    return null;
  }
  try {
    const value = JSON.parse(raw.toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // fall through
  }
  violations.push(`${path}: envelope file is not a JSON object`);
  return null;
}

function allowed(path) {
  return ALLOWLIST.some((e) => (e.endsWith("/") ? path.startsWith(e) : path === e));
}

function nonEmpty(v) {
  return typeof v === "string" && v.length > 0;
}

const violations = [];
const changed = changedPaths();

// (a) the envelope
if (!changed.some((c) => c.path === MANIFEST && c.status !== "D")) {
  violations.push(`${MANIFEST}: not changed in the range — not a Nous sync`);
}
const manifest = jsonAtHead(MANIFEST, violations);
const identity = jsonAtHead(IDENTITY, violations);
const provenance = jsonAtHead(PROVENANCE, violations);
if (manifest && identity && provenance) {
  const ids = [manifest.project_id, identity.project_id, provenance.project_id];
  if (!ids.every(nonEmpty) || new Set(ids).size !== 1) {
    violations.push(
      `envelope: project_id inconsistent — ${MANIFEST}=${JSON.stringify(ids[0])} ` +
      `${IDENTITY}=${JSON.stringify(ids[1])} ${PROVENANCE}=${JSON.stringify(ids[2])}`);
  }
  const commit = identity.substrate_commit;
  const sha = provenance.git_sha;
  if (!nonEmpty(commit) || !nonEmpty(sha) ||
      !(commit.startsWith(sha) || sha.startsWith(commit))) {
    violations.push(
      `envelope: substrate commit inconsistent — ${IDENTITY} substrate_commit=` +
      `${JSON.stringify(commit)} ${PROVENANCE} git_sha=${JSON.stringify(sha)}`);
  }
  // (d) clean-tree delivery
  if (provenance.dirty !== false) {
    const paths = Array.isArray(provenance.dirty_paths) ? provenance.dirty_paths : [];
    violations.push(
      `${PROVENANCE}: delivered from a dirty substrate tree (dirty=` +
      `${JSON.stringify(provenance.dirty)}; dirty_paths: ${paths.join(", ") || "none named"})`);
  }
}

// (b) (c) (e) every other changed path
const claims = manifest && manifest.files && typeof manifest.files === "object"
  ? manifest.files : {};
const baseClaims = claimsAtBase();
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
let owned = 0;
for (const { status, path } of changed) {
  if (ENVELOPE.has(path)) continue;
  if (status === "D") {
    if (!has(baseClaims, path)) {
      violations.push(`${path}: deleted in the range but was not claimed in ${MANIFEST} at base`);
    } else if (has(claims, path)) {
      violations.push(`${path}: deleted in the range but is still claimed in ${MANIFEST} at head`);
    } else if (!allowed(path)) {
      violations.push(`${path}: deleted in the range and outside the substrate-managed allowlist`);
    } else {
      owned += 1;
    }
    continue;
  }
  const claim = has(claims, path) ? claims[path] : null;
  if (!claim || typeof claim !== "object") {
    violations.push(`${path}: not claimed in ${MANIFEST}`);
    continue;
  }
  let ok = true;
  const source = claim.source;
  if (!(nonEmpty(source) && (SOURCE_TOKENS.has(source) || isSubstratePath(source)))) {
    violations.push(`${path}: claim source ${JSON.stringify(source)} is not generated|toolchain|emitted or an absolute /…/Nous/… path`);
    ok = false;
  }
  const bytes = showAtHead(path);
  const actual = bytes === null ? null : createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  if (actual === null || actual !== claim.hash) {
    violations.push(`${path}: bytes at head hash ${actual} but ${MANIFEST} claims ${JSON.stringify(claim.hash)}`);
    ok = false;
  }
  if (!allowed(path)) {
    violations.push(`${path}: outside the substrate-managed allowlist`);
    ok = false;
  }
  if (ok) owned += 1;
}

if (violations.length > 0) {
  for (const v of violations) process.stdout.write(`nous-sync-owns: ${v}\n`);
  process.exit(1);
}
process.stdout.write(`nous-sync-owns: ok — a Nous sync (${owned} claimed path(s))\n`);
process.exit(0);
// nous-emitted: sha256=c951b148f8e86d5f
