#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const runtimeRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const postcss = runtimeRequire("postcss");
const ts = runtimeRequire("typescript");
const root = resolve(process.argv[2] || ".");
const canonicalCssPath = join(root, "packages", "ui", "src", "atoms", "status-pill.css");
const statusPillTsxPath = join(root, "packages", "ui", "src", "atoms", "status-pill.tsx");
const statusPillRules = [
  ["success", "--color-success", "--color-success-bg", "--color-success-dot"],
  ["pending", "--color-pending-text", "--color-pending-bg", "--color-pending-dot"],
  ["attention", "--color-error-text", "--color-error-bg", "--color-error-dot"],
  ["neutral", "--color-neutral-text", "--color-neutral-bg", "--color-neutral-dot"],
];
const expectedKinds = statusPillRules.map(([kind]) => kind);
const canonicalSelectors = new Set([
  ".status-pill",
  ".status-pill::before",
  ...statusPillRules.flatMap(([kind]) => [`.status-pill--${kind}`, `.status-pill--${kind}::before`]),
]);
const allowedProperties = new Map([
  [".status-pill", new Set(["align-items", "display", "gap"])],
  [".status-pill::before", new Set(["border-radius", "content", "flex", "height", "width"])],
  ...statusPillRules.flatMap(([kind]) => [
    [`.status-pill--${kind}`, new Set(["color", "background"])],
    [`.status-pill--${kind}::before`, new Set(["background"])],
  ]),
]);

function fatal(message) {
  console.error(`[status-pill contract] ${message}`);
  process.exit(1);
}

let semanticHexes;
try {
  const tokens = JSON.parse(readFileSync(join(root, "packages", "design-system", "tokens.json"), "utf8"));
  const semantic = tokens?.color?.semantic;
  if (!semantic || typeof semantic !== "object" || !Object.values(semantic).every((value) => typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value))) throw new Error("color.semantic must contain 3, 4, 6, or 8-digit hex colors");
  semanticHexes = [...new Set(Object.values(semantic).map((value) => value.toUpperCase()))];
} catch (error) {
  fatal(`cannot load canonical semantic tokens: ${error instanceof Error ? error.message : String(error)}`);
}

function loadIgnore(key) {
  try {
    const ignored = JSON.parse(readFileSync(join(root, ".design-system-lint-ignore.json"), "utf8"))[key] || [];
    return ignored.map((entry) => entry.split("/").join(sep));
  } catch { return []; }
}
function ignored(file, globs) {
  const relative = file.slice(root.length + 1).split(sep).join("/");
  return globs.some((glob) => relative === glob || relative.startsWith(glob.endsWith("/") ? glob : `${glob}/`));
}
const skipDirectories = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);
function walk(directory, extensions) {
  let files = [];
  let entries;
  try { entries = readdirSync(directory); } catch { return files; }
  for (const entry of entries) {
    if (skipDirectories.has(entry)) continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files = files.concat(walk(path, extensions));
    else if (extensions.some((extension) => path.endsWith(extension))) files.push(path);
  }
  return files;
}
const sourceRoots = [join(root, "apps", "web", "src"), join(root, "packages")];
const cssFiles = sourceRoots.flatMap((directory) => walk(directory, [".css"]));
const sourceFiles = sourceRoots.flatMap((directory) => walk(directory, [".ts", ".tsx", ".css", ".js", ".jsx"]));
let failed = false;
function fail(message) { console.error(`[status-pill contract] ${message}`); failed = true; }

const canonicalRules = new Map();
for (const file of cssFiles) {
  let stylesheet;
  try { stylesheet = postcss.parse(readFileSync(file, "utf8"), { from: file }); }
  catch (error) { fail(`cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`); continue; }
  stylesheet.walkRules((rule) => {
    if (!rule.selector.includes(".status-pill")) return;
    if (file !== canonicalCssPath) {
      fail(`status-pill selector ${rule.selector} outside packages/ui/src/atoms/status-pill.css`);
      return;
    }
    if (!canonicalSelectors.has(rule.selector)) {
      fail(`noncanonical status-pill selector: ${rule.selector}`);
      return;
    }
    const rules = canonicalRules.get(rule.selector) || [];
    rules.push(rule);
    canonicalRules.set(rule.selector, rules);
  });
}

function requiredRule(selector) {
  const rules = canonicalRules.get(selector) || [];
  if (rules.length !== 1) {
    fail(`${rules.length > 1 ? "duplicate" : "missing"} required selector: ${selector}`);
    return undefined;
  }
  return rules[0];
}
function declarations(rule) { return rule?.nodes?.filter((node) => node.type === "decl") || []; }
function exactDeclaration(rule, property, value) {
  const matches = declarations(rule).filter((declaration) => declaration.prop === property);
  return matches.length === 1 && matches[0].value === value;
}
function validateProperties(selector, rule) {
  const allowed = allowedProperties.get(selector);
  for (const declaration of declarations(rule)) if (!allowed?.has(declaration.prop)) fail(`unexpected declaration ${declaration.prop} in ${selector}`);
}

const base = requiredRule(".status-pill");
const baseDot = requiredRule(".status-pill::before");
validateProperties(".status-pill", base);
validateProperties(".status-pill::before", baseDot);
if (!exactDeclaration(baseDot, "content", '""') || !exactDeclaration(baseDot, "width", "var(--spacing-1)") || !exactDeclaration(baseDot, "height", "var(--spacing-1)") || !exactDeclaration(baseDot, "border-radius", "var(--radius-full)")) fail(".status-pill::before must render a visible dot");
for (const [kind, color, background, dot] of statusPillRules) {
  const rule = requiredRule(`.status-pill--${kind}`);
  const dotRule = requiredRule(`.status-pill--${kind}::before`);
  validateProperties(`.status-pill--${kind}`, rule);
  validateProperties(`.status-pill--${kind}::before`, dotRule);
  if (!exactDeclaration(rule, "color", `var(${color})`) || !exactDeclaration(rule, "background", `var(${background})`)) fail(`.status-pill--${kind} must use color: var(${color}) and background: var(${background})`);
  if (!exactDeclaration(dotRule, "background", `var(${dot})`)) fail(`.status-pill--${kind}::before must render var(${dot})`);
}

const statusSource = readFileSync(statusPillTsxPath, "utf8");
const statusAst = ts.createSourceFile(statusPillTsxPath, statusSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let kindsDeclaration;
let statusKindAlias;
let classMappingValid = false;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "STATUS_KINDS") kindsDeclaration = node;
  if (ts.isTypeAliasDeclaration(node) && node.name.text === "StatusKind") statusKindAlias = node;
  if (ts.isJsxAttribute(node) && node.name.text === "className" && node.initializer && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression;
    if (expression && ts.isTemplateExpression(expression) && expression.head.text === "status-pill status-pill--" && expression.templateSpans.length === 1 && ts.isIdentifier(expression.templateSpans[0].expression) && expression.templateSpans[0].expression.text === "kind" && expression.templateSpans[0].literal.text === "") classMappingValid = true;
  }
  ts.forEachChild(node, visit);
}
visit(statusAst);
const tupleValues = kindsDeclaration && kindsDeclaration.initializer && ts.isAsExpression(kindsDeclaration.initializer) && ts.isArrayLiteralExpression(kindsDeclaration.initializer.expression)
  ? kindsDeclaration.initializer.expression.elements.map((element) => ts.isStringLiteral(element) ? element.text : undefined)
  : undefined;
if (!tupleValues || tupleValues.length !== expectedKinds.length || tupleValues.some((value, index) => value !== expectedKinds[index])) fail(`STATUS_KINDS must be the live tuple ${expectedKinds.join(", ")}`);
const indexedStatusKind = statusKindAlias && ts.isIndexedAccessTypeNode(statusKindAlias.type) ? statusKindAlias.type : undefined;
const statusKindObject = indexedStatusKind && ts.isParenthesizedTypeNode(indexedStatusKind.objectType) ? indexedStatusKind.objectType.type : indexedStatusKind?.objectType;
const derivedUnion = indexedStatusKind && ts.isTypeQueryNode(statusKindObject) && statusKindObject.exprName.getText(statusAst) === "STATUS_KINDS" && indexedStatusKind.indexType.kind === ts.SyntaxKind.NumberKeyword;
if (!derivedUnion) fail("StatusKind must be derived from STATUS_KINDS");
if (!classMappingValid) fail("StatusPill must compose its class from the checked kind template");

function normColors(text) {
  const colors = new Set();
  for (const match of text.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
    let hex = match[1];
    if (hex.length === 3) hex = hex.split("").map((char) => char + char).join("");
    colors.add(`#${hex}`.toUpperCase());
  }
  return colors;
}
if (normColors(readFileSync(canonicalCssPath, "utf8")).size) fail("status-pill.css must reference semantic tokens, not color literals");
const ignore = loadIgnore("color");
for (const file of sourceFiles) {
  if (ignored(file, ignore)) continue;
  for (const color of normColors(readFileSync(file, "utf8"))) if (semanticHexes.includes(color)) fail(`${file}: semantic hex ${color} rendered outside status-pill.css`);
}

if (failed) process.exit(1);
console.log("[status-pill SSOT] ok");
