#!/usr/bin/env node
// IMP-309 / TE-5 anti-over-mock (standard §5.3, P5): a test that mocks OWNED code
// passes without validating the real interaction and rots as production drifts.
// HARD-fails (exit 1) on vi.mock/jest.mock/vi.doMock of an OWNED module. Owned =
// a relative specifier (./ ../), the app alias `@/`, a workspace scope alias
// `@<scope>/` (scope read from the root package.json name), or any tsconfig
// `compilerOptions.paths` alias key. Bare npm packages (true externals — the only
// sanctioned mock target) are allowed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2] || ".");
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
const OWNED = ownedAliases(root);
const ROOTS = ["packages", "apps"];
const EXTS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
// vi.mock("spec") / jest.mock('spec') / vi.doMock(`spec`) — first string arg.
const MOCK_RE = /\b(?:vi|jest)\.(?:mock|doMock)\s*\(\s*["'`]([^"'`]+)["'`]/g;
let failed = false, mocks = 0, files = 0;
for (const f of walkRoots(root, ROOTS, EXTS)) {
  files++;
  const text = stripComments(readFileSync(f, "utf8"));
  let m;
  while ((m = MOCK_RE.exec(text)) !== null) {
    mocks++;
    const spec = m[1];
    if (isOwned(spec, OWNED)) {
      console.error(`[test-mocks] ${f}: mocks OWNED module "${spec}" — inject the collaborator or use the real DB (createTestDb); do not mock code we own (standard §5.3 / P5)`);
      failed = true;
    }
  }
}
if (files) console.error(`[test-mocks] diagnostic: ${mocks} mock(s) across ${files} test file(s) (ratio ${(mocks / files).toFixed(2)})`);
if (failed) process.exit(1);
console.log("[test-mocks] ok");
