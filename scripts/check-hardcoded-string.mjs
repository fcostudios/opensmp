#!/usr/bin/env node
// IMP-241 no-hardcoded user-facing string: a non-trivial text node between
// JSX tags (e.g. <button>Guardar</button>) must come via useLocale(), not a
// bare literal. The generator-owned app-shell scaffold is exempt (the
// manifest's "string" globs) so the lint passes on the baseline yet stays
// STRICT on dev-team feature code.
//
// Review #5: the naive />...</  regex ran over RAW text and captured JS
// operators (x.count > min && y < max, if (a > b) f()). We (a) stripCode
// first (removes comments + string/template literals so >text< inside a
// string can't match) and (b) reject any candidate containing JS
// operator/punctuation chars — a real JSX text node never does.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
const root = resolve(process.argv[2] || ".");
function loadIgnore(root, key) {
  try {
    const j = JSON.parse(readFileSync(join(root, ".design-system-lint-ignore.json"), "utf8"));
    return (j[key] || []).map((g) => g.split("/").join(sep));
  } catch { return []; }
}
function ignored(f, root, globs) {
  let rel = f.startsWith(root) ? f.slice(root.length + 1) : f;
  rel = rel.split(sep).join("/");
  // Anchored: exact match OR a directory prefix (g + "/"). No unanchored
  // endsWith (that over-exempts every file ending in the glob text).
  return globs.some((g) => {
    const gg = g.split(sep).join("/");
    return rel === gg || rel.startsWith(gg.endsWith("/") ? gg : gg + "/");
  });
}
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);
function walkRoots(root, roots, exts) {
  let out = [];
  for (const r of roots) {
    out = out.concat(walkOne(join(root, ...r.split("/")), exts));
  }
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
  // Remove block + line comments only (keeps string literals — color
  // hexes legitimately live in `color: "#2D7A4F"`). Used by the color
  // scans so a hex in a comment doesn't false-fail but a hex in code does.
  let t = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  t = t.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  return t;
}
function stripCode(text) {
  // Remove comments AND string/template literals. Used by the JSX-string
  // scan so operators inside string literals can't be mistaken for JSX
  // text nodes (review #5).
  let t = stripComments(text);
  t = t.replace(/'(?:\\.|[^'\\])*'/g, "''");
  t = t.replace(/"(?:\\.|[^"\\])*"/g, '""');
  t = t.replace(/`(?:\\.|[^`\\])*`/g, "``");
  return t;
}
function normColors(text) {
  const set = new Set();
  const push = (r, g, b) => set.add(r + "," + g + "," + b);
  let m;
  const hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
  while ((m = hexRe.exec(text)) !== null) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    push(parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16));
  }
  const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
  while ((m = rgbRe.exec(text)) !== null) push(+m[1], +m[2], +m[3]);
  const hslRe = /hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%/g;
  while ((m = hslRe.exec(text)) !== null) {
    const [r,g,b] = hslToRgb(+m[1], +m[2], +m[3]);
    push(r, g, b);
  }
  return set;
}
function hslToRgb(h, s, l) {
  h = (h % 360) / 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [Math.round(hue(h + 1/3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1/3) * 255)];
}

const IGNORE = loadIgnore(root, "string");
const ROOTS = ["apps/web/src", "packages"];
const EXTS = [".tsx", ".jsx"];
// a text node: >  Some Words  <  with at least 2 letters, not an expression {…}
const RE = />\s*([A-Za-zÀ-ÿ][^<>{}]*[A-Za-zÀ-ÿ])\s*</g;
// operator/punctuation that never appears in a genuine JSX text node but
// does in captured logic (`a > b) f(); c = d < e`, `x > min && y < max`).
const NOT_JSX_TEXT = /[;=()&|{}[\]]|&&|\|\|/;
let failed = false;
for (const f of walkRoots(root, ROOTS, EXTS)) {
  if (ignored(f, root, IGNORE)) continue;   // generator-owned app-shell scaffold
  const text = stripCode(readFileSync(f, "utf8"));   // comments + string literals removed
  let m;
  while ((m = RE.exec(text)) !== null) {
    const s = m[1].trim();
    if (s.length >= 2 && !NOT_JSX_TEXT.test(s)) {
      console.error(`[no-hardcoded-string] ${f}: bare JSX text "${s}" — route it through i18n: a Server Component imports the messages JSON (never the client useLocale hook); a "use client" component calls useLocale()`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("[no-hardcoded-string] ok");
