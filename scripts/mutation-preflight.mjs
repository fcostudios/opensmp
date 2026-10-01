#!/usr/bin/env node
// mutation-preflight — the fast questions, before the cold campaign (Nous, IMP-402).
//
// `pnpm test:mutation` is the gate and it runs LAST, so it is also where an
// agent first discovers a changed file with no test, or a test database that
// cannot be constructed. Both are answerable in seconds, statically, over the
// SAME diff scope the campaign will mutate — which is what this script does.
//
// It does NOT tell you whether the tests that exist have strong oracles. That is
// a mutation score, and nothing static substitutes for running mutants.
//
// Three legs:
//   accountability   a changed mutatable file that NO test file imports
//   oracles          delegated to the delivered scripts/check-test-oracles.mjs
//   seam             can `createTestDb()` be constructed right now?
//
// Strictness comes in on the command line, from the `test:mutation:preflight`
// script the substrate emits into package.json. That value is resolved from
// `enforcement.mutation_preflight` at GENERATE time — this file stays a pure
// function of nothing, which is what lets the toolchain inventory treat it as an
// ordinary owned script with one canonical body.
//   --mode=strict     exit 1 on any finding
//   --mode=warn-only  report every finding, exit 0   (the default)
//   --mode=off        exit 0 immediately
//
// Env overrides:
//   MUTATION_BASE=<ref>   compare against this ref instead of the default branch
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MODES = ["off", "warn-only", "strict"];
const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith("--mode="));
const MODE = modeArg ? modeArg.slice("--mode=".length) : "warn-only";
if (!MODES.includes(MODE)) {
  // A typo'd mode that silently fell back to warn-only would be
  // indistinguishable from a deliberate choice — and would silently un-arm a
  // package an operator had set to strict.
  console.error(`mutation-preflight: --mode=${MODE} is not one of ${MODES.join("|")}`);
  process.exit(2);
}
const root = resolve(args.find((a) => !a.startsWith("--")) || ".");

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);
function walkRoots(root, roots, exts) {
  let out = [];
  for (const r of roots) out = out.concat(walkOne(join(root, ...r.split("/")), exts));
  return out;
}
function walkOne(dir, exts) {
  let out = [];
  let ents;
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }   // broken symlink/race => skip, never crash
    if (st.isDirectory()) out = out.concat(walkOne(p, exts));
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}
function stripComments(text) {
  // Remove block + line comments only (keeps string literals).
  let t = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  t = t.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  return t;
}
function stripCode(text) {
  // Remove comments AND string/template literals, so an `expect` or a mock
  // specifier that only appears inside a string cannot be mistaken for code.
  let t = stripComments(text);
  t = t.replace(/'(?:\\.|[^'\\])*'/g, "''");
  t = t.replace(/"(?:\\.|[^"\\])*"/g, '""');
  t = t.replace(/`(?:\\.|[^`\\])*`/g, "``");
  return t;
}

// The owned-alias prefixes (each compared as a specifier prefix).
function ownedAliases(root) {
  const set = new Set(["@/"]);   // Next/shadcn app-internal alias — always owned
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const m = String(pkg.name || "").match(/^(@[^/]+)\//) || String(pkg.name || "").match(/^(@[^/]+)$/);
    if (m) set.add(m[1] + "/");
  } catch { /* no root package.json => just the defaults */ }
  // IMP-402 — the WORKSPACE packages' own names. Reading the scope from the ROOT
  // package.json is where the scope is not: smp's root is named `smp` and its
  // packages are `@smp/*`, so the alias set never contained the scope its 206
  // test files actually import through. Measured 2026-09-09 on three live
  // tenants: smp +0 findings, kontract +0, mi-banquito 27 -> 109, and all 82 are
  // genuine over-mocks of `@mi-banquito/{db,db/tenant,domain,db/schema}`.
  for (const group of ["packages", "apps"]) {
    let entries = [];
    try { entries = readdirSync(join(root, group)); } catch { continue; }
    for (const entry of entries) {
      try {
        const wp = JSON.parse(readFileSync(join(root, group, entry, "package.json"), "utf8"));
        // The trailing "/" is load-bearing, same reason the campaign script
        // anchors its worktree patterns: an UNSCOPED workspace name (`smp-web`)
        // added bare would make `isOwned` match `smp-web-utils` by prefix — a
        // real npm package read as owned code. With the separator it cannot.
        if (wp.name) set.add(String(wp.name) + "/");
      } catch { /* not a package directory */ }
    }
  }
  for (const tc of ["tsconfig.json", "tsconfig.base.json"]) {
    try {
      const j = JSON.parse(stripComments(readFileSync(join(root, tc), "utf8")));
      const paths = (j.compilerOptions && j.compilerOptions.paths) || {};
      for (const k of Object.keys(paths)) set.add(k.replace(/\*$/, ""));
    } catch { /* absent/unparseable tsconfig => skip */ }
  }
  return [...set];
}
function isOwned(spec, owned) {
  if (spec.startsWith("./") || spec.startsWith("../")) return true;
  return owned.some((a) => spec === a.replace(/\/$/, "") || spec.startsWith(a));
}

// Mirrors stryker.conf.json's mutate globs: which files can carry mutants.
// This is a FILE-TYPE filter, not a critical-set narrowing — a changed `.md` or
// `.json` has no mutants, so excluding it removes nothing real.
const MUTATABLE_EXT = /\.(ts|tsx)$/;

// Build output. `--exclude-standard` already honours .gitignore, so this is the
// belt-and-braces layer for a package whose ignore file is thin. `.tmp/` is not
// optional paranoia: THIS SCRIPT writes `.tmp/stryker.generated.conf.json`, so
// without the exclusion an untracked-file scan can feed the run its own output.
const GENERATED_ARTIFACT = [
  /(^|\/)\.tmp\//,
  /(^|\/)\.next\//,
  /(^|\/)(coverage|dist|reports)\//,
];

const EXCLUDED = [
  /\.(test|spec)\.tsx?$/,
  /\.d\.ts$/,
  /(^|\/)migrations\//,
  /(^|\/)testing\//,
  /(^|\/)node_modules\//,
  ...GENERATED_ARTIFACT,
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** A git call whose FAILURE is an expected, handled outcome (probing for a ref
 *  that may not exist). git writes `fatal: ...` to stderr even when the caller
 *  copes, so stderr is discarded here — otherwise every run in a repo without
 *  `origin/HEAD` prints a scary line that is not an error. Real failures still
 *  surface: the caller decides, via the thrown exception. */
function gitProbe(args) {
  return execFileSync("git", args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** Fail LOUD. A mutation run that cannot determine its scope must NOT report
 *  success having mutated nothing — a silent empty scope is a false green. */
function fail(message, hint) {
  console.error(`mutation-preflight: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(2);
}

/** The ref to diff against. Resolved, never hardcoded to `main`: a repo whose
 *  trunk is `master`, or a CI checkout with a different default, must not
 *  silently produce an empty diff. */
function resolveBase() {
  if (process.env.MUTATION_BASE) {
    const ref = process.env.MUTATION_BASE;
    try {
      gitProbe(["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      fail(`MUTATION_BASE=${ref} does not resolve to a ref`,
           "check the ref name, or unset MUTATION_BASE to use the default branch");
    }
  }
  try {
    // origin/HEAD is the authoritative default branch when a remote exists.
    const sym = gitProbe(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (sym) return sym;
  } catch { /* no remote / no origin/HEAD — fall through to local trunks */ }
  for (const ref of ["main", "master"]) {
    try {
      gitProbe(["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch { /* try the next candidate */ }
  }
  fail("cannot resolve a default branch to diff against (tried origin/HEAD, main, master)",
       "set MUTATION_BASE=<ref> explicitly");
}

function changedFiles(base) {
  let mergeBase;
  try {
    mergeBase = gitProbe(["merge-base", "HEAD", base]);
  } catch {
    // A shallow clone or an unrelated history has no merge base. Exiting 0 here
    // would mutate nothing and report success — the false green this guard
    // exists to prevent.
    fail(`no merge base between HEAD and ${base}`,
         "unshallow the clone (git fetch --unshallow) or set MUTATION_BASE=<ref>");
  }
  // ACMR excludes deletions: Stryker cannot mutate a file that is gone.
  //
  // Diff the merge base against the WORKING TREE, not `${mergeBase}..HEAD`. That
  // range compares two COMMITS and cannot see a working tree, but the Definition
  // of Done tells the developer to run this while CLOSING a story — before the
  // final commit. Scoped that way the gate is blind at exactly the moment it is
  // invoked, finds nothing, and exits 0: a green over code it never mutated,
  // which HR-48 then records as mutation evidence. Git does not report untracked
  // files at all, so those are added explicitly — otherwise a newly created
  // production module escapes the gate permanently (IMP-361).
  //
  // In CI this is equivalent to the old form: a clean tree checked out at a
  // commit has nothing staged, unstaged, or untracked to add.
  const tracked = git(["diff", "--name-only", "--diff-filter=ACMR", mergeBase]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(
    [tracked, untracked]
      .flatMap((value) => value ? value.split("\n") : [])
      .filter(Boolean)
      .filter((path) => !GENERATED_ARTIFACT.some((pattern) => pattern.test(path))),
  )].sort();  // deterministic: the generated config must be byte-stable
}

function mutatable(files) {
  return files
    .filter((f) => MUTATABLE_EXT.test(f))
    .filter((f) => !EXCLUDED.some((re) => re.test(f)))
    .sort();  // deterministic: the generated config must be byte-stable
}

// ── leg 1: accountability ───────────────────────────────────────────────────
// Which source files does the test suite actually reach?
//
// RESOLUTION IS SUFFIX-BASED, AND THE DIRECTION OF ITS ERROR IS THE DESIGN.
// A relative specifier resolves exactly. An ALIASED one (`@/db/schema`,
// `@acme/db`, a tsconfig `paths` key) is reduced to the subpath after the alias
// prefix and matched against the tail of the changed file's path, because the
// alias TARGETS live in a tsconfig this script deliberately does not re-read
// (`ownedAliases` above is shared verbatim with check-test-mocks.mjs, and
// widening its contract would change that delivered file's bytes).
//
// A suffix match can only make a file look COVERED that a precise resolver would
// have called uncovered. It can never invent a finding. That is the safe
// direction for a signal whose failure mode is noise: a preflight that cries
// "this has no test" at files that do is one nobody reads.
const TEST_EXTS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const SOURCE_ROOTS = ["packages", "apps"];
// `import x from "s"` / `export … from "s"` / `import("s")` / `require("s")`.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

function stripExt(path) {
  return path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

/** The comparable tail of an import specifier, or null when it is a bare npm
 *  package (an external — never an owned source file). */
function specifierKey(spec, testFile, owned) {
  if (!isOwned(spec, owned)) return null;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    // Exact: resolve against the importing file's directory.
    const abs = resolve(testFile.slice(0, testFile.lastIndexOf("/")), spec);
    return stripExt(abs.startsWith(root) ? abs.slice(root.length + 1) : abs);
  }
  // Aliased: keep everything after the alias prefix.
  const alias = owned.find((a) => spec === a.replace(/\/$/, "") || spec.startsWith(a));
  const rest = spec.slice(alias.replace(/\/$/, "").length).replace(/^\//, "");
  return stripExt(rest);
}

function importedKeys(testFiles, owned) {
  const keys = new Set();
  for (const f of testFiles) {
    const text = stripComments(readFileSync(f, "utf8"));
    let m;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      const key = specifierKey(m[1], f, owned);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function unaccountedFiles(changed, keys) {
  const out = [];
  for (const file of changed) {
    const stem = stripExt(file);
    const reached = [...keys].some(
      (k) => k !== "" && (stem === k || stem.endsWith(`/${k}`) || stem.endsWith(`/${k}/index`)),
    );
    if (!reached) out.push(file);
  }
  return out.sort();
}

// ── leg 2: oracle quality (delegated, never re-implemented) ─────────────────
// `check-test-oracles.mjs` already decides what an assertion-free file, a
// print-theatre file and an auto-updating snapshot are. Re-deriving those rules
// here is the three-hand-written-copies shape IMP-394 closed, so this leg RUNS
// the delivered checker and keeps the lines that name a test file in the diff.
const ORACLES_CHECKER = join("scripts", "check-test-oracles.mjs");

function oracleFindings(diffTests) {
  if (!existsSync(join(root, ORACLES_CHECKER))) {
    return { warn: `${ORACLES_CHECKER} is absent — oracle leg skipped`, findings: [] };
  }
  let output = "";
  try {
    // stdio is pinned: with only `encoding` set, execFileSync passes the child's
    // stderr straight through to ours, so the checker's own diagnostic line would
    // print unfiltered above our findings and read as one of them.
    const clean = execFileSync("node", [ORACLES_CHECKER, "."],
                               { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    output = String(clean ?? "");
  } catch (err) {
    if (typeof err?.status !== "number") {
      return { warn: `could not run ${ORACLES_CHECKER}: ${err?.message ?? err}`, findings: [] };
    }
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const inDiff = new Set(diffTests);
  const findings = output
    .split("\n")
    .filter((line) => line.startsWith("[test-oracles] "))
    .filter((line) => [...inDiff].some((t) => line.includes(t)))
    .map((line) => line.trim());
  return { warn: null, findings: [...new Set(findings)].sort() };
}

// ── leg 3: the real-DB seam ────────────────────────────────────────────────
// The emitted seam smoke constructs `createTestDb()` and queries a migrated
// table. smp US-064's first campaign rejected four database sandboxes because a
// constructor still referenced variables from an older story — the class this
// leg exists to surface before hours of work depend on the seam.
const SEAM_TEST = join("packages", "db", "src", "testing", "pglite.smoke.test.ts");
const VITEST_BINS = [
  join("packages", "db", "node_modules", ".bin", "vitest"),
  join("node_modules", ".bin", "vitest"),
];

function seamCheck() {
  if (!existsSync(join(root, SEAM_TEST))) {
    return { skip: `${SEAM_TEST} is absent — seam leg skipped (no real-DB fixture in this package)` };
  }
  const bin = VITEST_BINS.find((b) => existsSync(join(root, b)));
  if (!bin) {
    // Attribution honesty: a missing runner is OUR inability to answer, not the
    // package's defect. It is a visible warning and never a finding.
    return { warn: "no vitest binary found (run `pnpm install`) — seam leg skipped" };
  }
  try {
    execFileSync(bin, ["run", "--root", ".", SEAM_TEST], { cwd: root, stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    if (typeof err?.status !== "number") {
      return { warn: `could not run the seam smoke: ${err?.message ?? err}` };
    }
    return { finding: `createTestDb() could not be constructed — ${SEAM_TEST} failed` };
  }
}

function main() {
  if (MODE === "off") {
    console.log("mutation-preflight: disabled (--mode=off, from enforcement.mutation_preflight)");
    process.exit(0);
  }

  const base = resolveBase();
  const changed = changedFiles(base);
  const mutate = mutatable(changed);
  const diffTests = changed.filter((f) => TEST_EXTS.some((x) => f.endsWith(x)));

  console.log(
    `mutation-preflight: mode=${MODE} base=${base} changed=${changed.length} ` +
    `mutatable=${mutate.length} tests-in-diff=${diffTests.length}`,
  );

  const findings = [];
  const warnings = [];

  // Leg 1 runs against the whole tree's tests, not just the diff's: a changed
  // file is accounted for by ANY test that imports it, whenever it was written.
  const owned = ownedAliases(root);
  const allTests = walkRoots(root, SOURCE_ROOTS, TEST_EXTS);
  const unaccounted = mutate.length ? unaccountedFiles(mutate, importedKeys(allTests, owned)) : [];
  for (const f of unaccounted) {
    findings.push(`[accountability] ${f}: changed, mutatable, and no test file imports it`);
  }

  const oracles = oracleFindings(diffTests);
  if (oracles.warn) warnings.push(oracles.warn);
  for (const line of oracles.findings) findings.push(`[oracles] ${line}`);

  const seam = seamCheck();
  if (seam.warn) warnings.push(seam.warn);
  if (seam.skip) console.log(`mutation-preflight: ${seam.skip}`);
  if (seam.finding) findings.push(`[seam] ${seam.finding}`);

  for (const w of warnings) console.error(`mutation-preflight: WARNING — ${w}`);
  for (const f of findings) console.error(`mutation-preflight: ${f}`);

  if (findings.length === 0) {
    console.log("mutation-preflight: ok — nothing to fix before the campaign");
    process.exit(0);
  }
  console.error(
    `mutation-preflight: ${findings.length} finding(s). These cost the most when a ` +
    "cold campaign is where you meet them. Weak oracles on tests that DO exist are " +
    "NOT checked here — only the campaign can score those.",
  );
  process.exit(MODE === "strict" ? 1 : 0);
}

main();
// nous-emitted: sha256=cb2b6e11c714fede
