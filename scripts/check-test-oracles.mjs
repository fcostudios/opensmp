#!/usr/bin/env node
// IMP-309 / TE-5 anti-print-theatre (standard §5.4, P3/P4): "a test whose only
// oracle is that the code ran without throwing is not a test and MUST NOT be
// merged" (§4.4). HARD-fails (exit 1) on:
//   (a) a test FILE with >=1 it()/test() and ZERO assertion anywhere (generous
//       oracle detection: expect(/assert/matcher/.rejects/.resolves) — the
//       file-confident signal, near-zero false-reds;
//   (b) that file whose only observation is console.* (print-theatre label);
//   (c) an auto-updating snapshot (--update/-u/--updateSnapshot in a test script,
//       or updateSnapshot: true in a vitest config) — a golden that asserts
//       nothing (§9.3).
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
const ROOTS = ["packages", "apps"];
const TEST_EXTS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const CFG_EXTS = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js"];
const HAS_TEST = /\b(?:it|test)\s*\(/;
// Generous oracle detection (safe direction — only flag when confident there is
// NO oracle): expect(/assert (any custom expect*/assert* helper), a vitest/jest
// matcher (.toBe/.toEqual/.toThrow/.toHaveBeen…/.toContain/.toMatch/.rejects/.resolves).
const HAS_ORACLE = /\b(?:expect|assert)\w*\s*\(|\.(?:toBe|toEqual|toStrictEqual|toMatch|toContain|toThrow|toHaveBeen|toHaveLength|toBeNull|toBeUndefined|toBeDefined|toBeTruthy|toBeFalsy|toBeGreaterThan|toBeLessThan|toBeCloseTo|rejects|resolves)\b/;
const HAS_CONSOLE = /\bconsole\.\w+\s*\(/;
let failed = false, testFiles = 0, assertFree = 0, printOnly = 0;
for (const f of walkRoots(root, ROOTS, TEST_EXTS)) {
  const code = stripCode(readFileSync(f, "utf8"));   // strings + comments removed
  if (!HAS_TEST.test(code)) continue;                // not a real test file
  testFiles++;
  if (HAS_ORACLE.test(code)) continue;               // has an oracle somewhere — pass (generous)
  assertFree++;
  if (HAS_CONSOLE.test(code)) {
    printOnly++;
    console.error(`[test-oracles] ${f}: test file with NO assertion — only console.* output as an "oracle". Observational output is not an oracle (standard §5.4 / P3); assert a property or contract.`);
  } else {
    console.error(`[test-oracles] ${f}: test file asserts nothing (no expect/assert/matcher). A test with no oracle is theatre and MUST NOT be merged (standard §4.4).`);
  }
  failed = true;
}
// (c) auto-updating snapshots — package.json test scripts + vitest configs.
const UPD_SCRIPT = /(^|\s)(-u|--update|--updateSnapshot)(\s|=|$)/;
function pkgPaths(root) {
  const out = [join(root, "package.json")];
  for (const base of ROOTS) {
    let ents;
    try { ents = readdirSync(join(root, base)); } catch { continue; }
    for (const e of ents) out.push(join(root, base, e, "package.json"));
  }
  return out;
}
for (const p of pkgPaths(root)) {
  let scripts;
  try { scripts = (JSON.parse(readFileSync(p, "utf8")).scripts) || {}; } catch { continue; }
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/vitest|jest/.test(cmd) && UPD_SCRIPT.test(cmd)) {
      console.error(`[test-oracles] ${p} script "${name}": "${cmd}" auto-updates snapshots — an auto-accepted golden asserts nothing (standard §9.3).`);
      failed = true;
    }
  }
}
const cfgs = walkRoots(root, ROOTS, CFG_EXTS).concat(CFG_EXTS.map((c) => join(root, c)));
for (const f of cfgs) {
  let text;
  try { text = stripComments(readFileSync(f, "utf8")); } catch { continue; }
  if (/updateSnapshot\s*:\s*true/.test(text)) {
    console.error(`[test-oracles] ${f}: updateSnapshot:true auto-updates goldens — an auto-accepted golden asserts nothing (standard §9.3).`);
    failed = true;
  }
}
if (testFiles) console.error(`[test-oracles] diagnostic: ${assertFree}/${testFiles} test file(s) assertion-free (${printOnly} print-only)`);
if (failed) process.exit(1);
console.log("[test-oracles] ok");
