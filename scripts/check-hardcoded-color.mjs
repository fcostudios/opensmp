#!/usr/bin/env node
// IMP-241 no-hardcoded-color: brand ∪ semantic hexes (greyscale neutrals
// EXCLUDED — review #4) outside the token layer + the status-pill atom are
// violations (use tokens / tailwind classes). Catches #hex, #RGB shorthand,
// rgb()/rgba() and hsl()/hsla() (review #6); comments/strings skipped.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
// Token ownership contract:
// - packages/design-system/tokens.json is the only editable token data.
// - this script deterministically derives both CSS artifacts from it.
// - `--write-tokens` refreshes those artifacts; normal lint mode verifies parity.
const writeTokens = process.argv.includes("--write-tokens");
const rootArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const root = resolve(rootArg || ".");
const HEXES = ["#166534", "#16A34A", "#92400E", "#991B1B", "#C96F12", "#D97706", "#DC2626", "#DCFCE7", "#E7851A", "#FEF3C7"];

function schemaError(path, message) {
  throw new Error(`[token-schema] ${path}: ${message}`);
}

function objectAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) schemaError(path, "must be an object");
  return value;
}

function exactKeys(value, path, keys) {
  const object = objectAt(value, path);
  for (const key of Object.keys(object)) if (!keys.includes(key)) schemaError(`${path}.${key}`, "is not a supported canonical token");
  for (const key of keys) if (!(key in object)) schemaError(`${path}.${key}`, "is required");
  return object;
}

function cssTextAt(value, path) {
  if (typeof value !== "string" || !value.trim()) schemaError(path, "must be a non-empty CSS token string");
  if (/[\u0000-\u001F\u007F;{}@]|\/\*|\*\//.test(value)) schemaError(path, "contains a control character or CSS injection delimiter");
  return value;
}

function colorAt(value, path) {
  const color = cssTextAt(value, path);
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) schemaError(path, "must be a 3, 4, 6, or 8-digit hex color");
  return color;
}

function lengthAt(value, path, units = "px|rem|em|%") {
  const length = cssTextAt(value, path);
  if (!new RegExp(`^(?:0|(?:0|[1-9]\\d*)(?:\\.\\d+)?)(?:${units})$`).test(length)) schemaError(path, `must be a CSS length using ${units}`);
  return length;
}

function fontAt(value, path) {
  const font = cssTextAt(value, path);
  if (!/^[\p{L}\p{N} ._-]+$/u.test(font)) schemaError(path, "must contain only safe font-family characters");
  return font.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
}

function shadowAt(value, path) {
  const shadow = cssTextAt(value, path);
  const length = "-?(?:0|(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:px|rem|em))";
  const color = "(?:transparent|#[0-9a-fA-F]{3,8}|rgba?\\(\\d{1,3},\\d{1,3},\\d{1,3}(?:,(?:0|1|0?\\.\\d+))?\\))";
  if (!new RegExp(`^(?:${length}\\s+){1,3}${color}$`).test(shadow)) schemaError(path, "must be a safe offset/blur shadow");
  return shadow;
}

function positiveNumberAt(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) schemaError(path, "must be a finite non-negative number");
  return value;
}

// Canonical JSON maps to CSS in this fixed order: color, semantic color,
// fonts, spacing, text/size metrics, radii, shadows, breakpoints, motion.
// JSON keys become CSS-safe kebab-case (for example `spacing[\"0.5\"]` ->
// `--spacing-0-5`). A normalized-name collision is a schema error, never an
// alias. This is intentionally one-way and lossless.
function cssName(name, path) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) schemaError(path, "contains characters that cannot normalize to a CSS token name");
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .replaceAll(".", "-")
    .toLowerCase();
}

function orderedEntries(object) {
  return Object.entries(object).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function tokenDeclarations(tokens) {
  const root = exactKeys(tokens, "tokens", ["color", "spacing", "typography", "radii", "shadow", "breakpoints", "motion"]);
  const declarations = [];
  const declarationPaths = new Map();
  const add = (name, value, path) => {
    const prior = declarationPaths.get(name);
    if (prior) schemaError(path, `normalizes to ${name}, already defined by ${prior}`);
    declarationPaths.set(name, path);
    declarations.push([name, value]);
  };
  const color = objectAt(root.color, "tokens.color");
  for (const [name, value] of orderedEntries(color)) {
    if (name === "semantic") continue;
    add(`--color-${cssName(name, `tokens.color.${name}`)}`, colorAt(value, `tokens.color.${name}`), `tokens.color.${name}`);
  }
  const semantic = objectAt(color.semantic, "tokens.color.semantic");
  for (const [name, value] of orderedEntries(semantic)) add(`--color-${cssName(name, `tokens.color.semantic.${name}`)}`, colorAt(value, `tokens.color.semantic.${name}`), `tokens.color.semantic.${name}`);

  const typography = exactKeys(root.typography, "tokens.typography", ["fontFamily", "bodyDefaultPx", "bodyMinPx", "tapTargetMinPx"]);
  const fonts = exactKeys(typography.fontFamily, "tokens.typography.fontFamily", ["base", "mono", "display"]);
  const fontFallbacks = { base: "ui-sans-serif, system-ui, sans-serif", display: "ui-serif, Georgia, serif", mono: "ui-monospace, monospace" };
  const fontNames = { base: "sans", display: "display", mono: "mono" };
  for (const key of ["base", "display", "mono"]) add(`--font-${fontNames[key]}`, `\"${fontAt(fonts[key], `tokens.typography.fontFamily.${key}`)}\", ${fontFallbacks[key]}`, `tokens.typography.fontFamily.${key}`);

  const spacing = objectAt(root.spacing, "tokens.spacing");
  for (const [name, value] of orderedEntries(spacing)) add(`--spacing-${cssName(name, `tokens.spacing.${name}`)}`, lengthAt(value, `tokens.spacing.${name}`), `tokens.spacing.${name}`);
  add("--text-body-default", `${positiveNumberAt(typography.bodyDefaultPx, "tokens.typography.bodyDefaultPx")}px`, "tokens.typography.bodyDefaultPx");
  add("--text-body-min", `${positiveNumberAt(typography.bodyMinPx, "tokens.typography.bodyMinPx")}px`, "tokens.typography.bodyMinPx");
  add("--size-tap-target-min", `${positiveNumberAt(typography.tapTargetMinPx, "tokens.typography.tapTargetMinPx")}px`, "tokens.typography.tapTargetMinPx");

  for (const [name, value] of orderedEntries(objectAt(root.radii, "tokens.radii"))) add(`--radius-${cssName(name, `tokens.radii.${name}`)}`, lengthAt(value, `tokens.radii.${name}`), `tokens.radii.${name}`);
  for (const [name, value] of orderedEntries(objectAt(root.shadow, "tokens.shadow"))) add(`--shadow-${cssName(name, `tokens.shadow.${name}`)}`, shadowAt(value, `tokens.shadow.${name}`), `tokens.shadow.${name}`);
  for (const [name, value] of orderedEntries(objectAt(root.breakpoints, "tokens.breakpoints"))) add(`--breakpoint-${cssName(name, `tokens.breakpoints.${name}`)}`, lengthAt(value, `tokens.breakpoints.${name}`, "px|rem|em"), `tokens.breakpoints.${name}`);

  const motion = exactKeys(root.motion, "tokens.motion", ["base", "fast", "max_motion_ms", "no_parallax_no_carousels"]);
  add("--duration-base", `${positiveNumberAt(motion.base, "tokens.motion.base")}ms`, "tokens.motion.base");
  add("--duration-fast", `${positiveNumberAt(motion.fast, "tokens.motion.fast")}ms`, "tokens.motion.fast");
  add("--motion-max-motion", `${positiveNumberAt(motion.max_motion_ms, "tokens.motion.max_motion_ms")}ms`, "tokens.motion.max_motion_ms");
  if (typeof motion.no_parallax_no_carousels !== "boolean") schemaError("tokens.motion.no_parallax_no_carousels", "must be a boolean");
  add("--motion-no-parallax-no-carousels", String(motion.no_parallax_no_carousels), "tokens.motion.no_parallax_no_carousels");
  return declarations;
}

function renderTokens(selector, declarations) {
  return [
    "/* Generated from packages/design-system/tokens.json by scripts/check-hardcoded-color.mjs --write-tokens — DO NOT hand-edit */",
    `${selector} {`,
    ...declarations.map(([name, value]) => `  ${name}: ${value};`),
    "}",
    "",
  ].join("\n");
}

function syncTokenArtifacts(root) {
  const tokenPath = join(root, "packages", "design-system", "tokens.json");
  const tokens = JSON.parse(readFileSync(tokenPath, "utf8"));
  const declarations = tokenDeclarations(tokens);
  const artifacts = [
    [join(root, "packages", "design-system", "tokens.css"), renderTokens(":root", declarations)],
    [join(root, "apps", "web", "src", "styles", "tokens.css"), renderTokens("@theme", declarations)],
  ];
  let stale = false;
  for (const [path, expected] of artifacts) {
    const actual = readFileSync(path, "utf8");
    if (actual !== expected) {
      if (writeTokens) writeFileSync(path, expected);
      else {
        console.error(`[token-parity] ${path} differs from packages/design-system/tokens.json; run: node scripts/check-hardcoded-color.mjs --write-tokens`);
        stale = true;
      }
    }
  }
  return stale;
}
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

const IGNORE = loadIgnore(root, "color");
const ROOTS = ["apps/web/src", "packages"];
const EXTS = [".ts", ".tsx", ".css", ".js", ".jsx"];
const NEEDLE = new Map();   // "R,G,B" -> original hex
for (const hex of HEXES) { for (const c of normColors(hex)) NEEDLE.set(c, hex); }
let failed = false;
if (syncTokenArtifacts(root)) failed = true;
for (const f of walkRoots(root, ROOTS, EXTS)) {
  if (ignored(f, root, IGNORE)) continue;   // token-definition layers exempt
  const colors = normColors(stripComments(readFileSync(f, "utf8")));  // skip comments, keep string-literal hexes
  for (const c of colors) {
    if (NEEDLE.has(c)) {
      console.error(`[no-hardcoded-color] ${f}: ${NEEDLE.get(c)} — use design tokens`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("[no-hardcoded-color] ok");
