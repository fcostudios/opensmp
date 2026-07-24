#!/usr/bin/env node
// IMP-241 status-pill SSOT lint:
// "any_color_literal_matching_semantic_hexes_outside_status_pill_css_is_build_fail"
// The 7 semantic hexes are read from the GENERATED tokens.json (not hardcoded).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || ".");
const TOKENS = join(root, "packages", "design-system", "tokens.json");
let SEM = ["#166534", "#16A34A", "#595756", "#92400E", "#949394", "#991B1B", "#D97706", "#DC2626", "#DCFCE7", "#F2F2F2", "#FEE2E2", "#FEF3C7"];
try {
  const t = JSON.parse(readFileSync(TOKENS, "utf8"));
  const s = (t.color && t.color.semantic) || {};
  const fromTokens = Object.values(s).map((v) => String(v).toUpperCase());
  if (fromTokens.length) SEM = [...new Set(fromTokens)].sort();
} catch { /* fall back to the baked list */ }

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

// The status-pill atom + the token-definition layers (globals/tokens.css)
// legitimately render the semantic hexes — exempt via the shared manifest.
const IGNORE = loadIgnore(root, "color");
const ROOTS = ["apps/web/src", "packages"];
const EXTS = [".ts", ".tsx", ".css", ".js", ".jsx"];
// Canonicalize each needle hex to "R,G,B" so rgb()/hsl()/#RGB shorthand
// escape hatches are also caught (review #6). Keep the hex for the message.
const SEM_RGB = new Map();   // "R,G,B" -> original hex
for (const hex of SEM) { for (const c of normColors(hex)) SEM_RGB.set(c, hex); }

let failed = false;
const statusPillPath = join(root, "packages", "ui", "src", "atoms", "status-pill.css");
const statusPillTsxPath = join(root, "packages", "ui", "src", "atoms", "status-pill.tsx");
const statusPillCss = readFileSync(statusPillPath, "utf8");
const statusPillTsx = readFileSync(statusPillTsxPath, "utf8");
const statusPillRules = [
  ["success", "--color-success", "--color-success-bg", "--color-success-dot"],
  ["pending", "--color-pending-text", "--color-pending-bg", "--color-pending-dot"],
  ["attention", "--color-error-text", "--color-error-bg", "--color-error-dot"],
  ["neutral", "--color-neutral-text", "--color-neutral-bg", "--color-neutral-dot"],
];
const canonicalSelectors = new Set([
  ".status-pill",
  ".status-pill::before",
  ...statusPillRules.flatMap(([variant]) => [`.status-pill--${variant}`, `.status-pill--${variant}::before`]),
]);
const allowedProperties = new Map([
  [".status-pill", new Set(["align-items", "display", "gap"])],
  [".status-pill::before", new Set(["border-radius", "content", "flex", "height", "width"])],
  ...statusPillRules.flatMap(([variant]) => [
    [`.status-pill--${variant}`, new Set(["color", "background"])],
    [`.status-pill--${variant}::before`, new Set(["background"])],
  ]),
]);
function parseCssRules(css) {
  const rules = new Map();
  const text = stripComments(css);
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const declarations = [];
    for (const statement of match[2].split(";")) {
      const colon = statement.indexOf(":");
      if (colon < 1) continue;
      declarations.push({ property: statement.slice(0, colon).trim(), value: statement.slice(colon + 1).trim() });
    }
    const entries = rules.get(selector) || [];
    entries.push(declarations);
    rules.set(selector, entries);
  }
  return rules;
}

const parsedRules = parseCssRules(statusPillCss);
function requiredRule(selector) {
  const matches = parsedRules.get(`.${selector}`) || [];
  if (matches.length !== 1) {
    console.error(`[status-pill contract] ${matches.length > 1 ? "duplicate required selector" : "missing required selector"}: .${selector}`);
    failed = true;
    return [];
  }
  return matches[0];
}
function statusHasDeclaration(rule, property, value) {
  const matches = rule.filter((declaration) => declaration.property === property);
  return matches.length === 1 && matches[0].value === value;
}
function validateAllowedProperties(selector, rule) {
  const allowed = allowedProperties.get(`.${selector}`);
  for (const declaration of rule) {
    if (!allowed?.has(declaration.property)) {
      console.error(`[status-pill contract] unexpected declaration ${declaration.property} in .${selector}`);
      failed = true;
    }
  }
}
for (const selector of parsedRules.keys()) {
  if (selector.includes(".status-pill") && !canonicalSelectors.has(selector)) {
    console.error(`[status-pill contract] noncanonical status-pill selector: ${selector}`);
    failed = true;
  }
}
const baseRule = requiredRule("status-pill");
validateAllowedProperties("status-pill", baseRule);
const baseDotRule = requiredRule("status-pill::before");
validateAllowedProperties("status-pill::before", baseDotRule);
if (!statusHasDeclaration(baseDotRule, "content", "\"\"") || !statusHasDeclaration(baseDotRule, "width", "var(--spacing-1)") || !statusHasDeclaration(baseDotRule, "height", "var(--spacing-1)") || !statusHasDeclaration(baseDotRule, "border-radius", "var(--radius-full)")) {
  console.error("[status-pill contract] .status-pill::before must render a visible dot");
  failed = true;
}
for (const [variant, color, background, dot] of statusPillRules) {
  const rule = requiredRule(`status-pill--${variant}`);
  const dotRule = requiredRule(`status-pill--${variant}::before`);
  validateAllowedProperties(`status-pill--${variant}`, rule);
  validateAllowedProperties(`status-pill--${variant}::before`, dotRule);
  if (!statusHasDeclaration(rule, "color", `var(${color})`) || !statusHasDeclaration(rule, "background", `var(${background})`)) {
    console.error(`[status-pill contract] .status-pill--${variant} must use color: var(${color}) and background: var(${background})`);
    failed = true;
  }
  if (!statusHasDeclaration(dotRule, "background", `var(${dot})`)) {
    console.error(`[status-pill contract] .status-pill--${variant}::before must render var(${dot})`);
    failed = true;
  }
}
const allowedVariants = new Set(statusPillRules.map(([variant]) => variant));
for (const selector of parsedRules.keys()) {
  const match = /^\.status-pill--([a-z-]+)(::before)?$/.exec(selector);
  if (match && !allowedVariants.has(match[1])) {
    console.error(`[status-pill contract] unsupported status-pill variant: ${match[1]}`);
    failed = true;
  }
}
const expectedStatusKind = statusPillRules.map(([variant]) => `"${variant}"`).join(" | ");
const statusKind = /export\s+type\s+StatusKind\s*=\s*([^;]+);/.exec(statusPillTsx)?.[1]?.replace(/\s+/g, " ").trim();
if (statusKind !== expectedStatusKind) {
  console.error(`[status-pill contract] StatusKind must be exactly ${expectedStatusKind}`);
  failed = true;
}
if (!/className=\{`status-pill status-pill--\$\{kind\}`\}/.test(statusPillTsx)) {
  console.error("[status-pill contract] StatusPill must compose its class directly from the checked StatusKind");
  failed = true;
}
if (normColors(stripComments(statusPillCss)).size > 0) {
  console.error("[status-pill contract] status-pill.css must reference semantic tokens, not color literals");
  failed = true;
}
for (const f of walkRoots(root, ROOTS, EXTS)) {
  if (ignored(f, root, IGNORE)) continue;   // token layers + the SSOT atom are exempt
  const colors = normColors(stripComments(readFileSync(f, "utf8")));  // skip comments, keep string-literal hexes
  for (const c of colors) {
    if (SEM_RGB.has(c)) {
      console.error(`[status-pill SSOT] ${f}: semantic hex ${SEM_RGB.get(c)} rendered outside the status-pill atom — build fail`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("[status-pill SSOT] ok");
