#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { EXACT_HEX_FRAGMENT, isExactHex, normalizeExactHex } from "./token-validation.mjs";

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
  if (!semantic || typeof semantic !== "object" || !Object.values(semantic).every(isExactHex)) throw new Error("color.semantic must contain 3, 4, 6, or 8-digit hex colors");
  semanticHexes = new Set(Object.values(semantic).map(normalizeExactHex));
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
const reportedStatFailures = new Set();
let failed = false;
function fail(message) { console.error(`[status-pill contract] ${message}`); failed = true; }
function walk(directory, extensions) {
  let files = [];
  let entries;
  try { entries = readdirSync(directory); } catch { return files; }
  for (const entry of entries) {
    if (skipDirectories.has(entry)) continue;
    const path = join(directory, entry);
    let stat;
    try { stat = statSync(path); }
    catch (error) {
      const relative = path.slice(root.length + 1).split(sep).join("/");
      if (!reportedStatFailures.has(relative)) {
        reportedStatFailures.add(relative);
        fail(`cannot stat ${relative}: ${error instanceof Error && "code" in error ? error.code : String(error)}`);
      }
      continue;
    }
    if (stat.isDirectory()) files = files.concat(walk(path, extensions));
    else if (extensions.some((extension) => path.endsWith(extension))) files.push(path);
  }
  return files;
}
const sourceRoots = [join(root, "apps", "web", "src"), join(root, "packages")];
const cssFiles = sourceRoots.flatMap((directory) => walk(directory, [".css"]));
const sourceFiles = sourceRoots.flatMap((directory) => walk(directory, [".ts", ".tsx", ".css", ".js", ".jsx"]));

const canonicalRules = new Map();
const stylesheets = new Map();
for (const file of cssFiles) {
  let stylesheet;
  try { stylesheet = postcss.parse(readFileSync(file, "utf8"), { from: file }); }
  catch (error) { fail(`cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`); continue; }
  stylesheets.set(file, stylesheet);
  stylesheet.walkRules((rule) => {
    if (!/\.status-pill(?:--[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/.test(rule.selector)) return;
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
function isExported(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}
const topLevelKinds = statusAst.statements.flatMap((statement) => ts.isVariableStatement(statement)
  ? statement.declarationList.declarations.filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "STATUS_KINDS").map((declaration) => ({ declaration, exported: isExported(statement) }))
  : []);
const kindsDeclaration = topLevelKinds.length === 1 && topLevelKinds[0].exported ? topLevelKinds[0].declaration : undefined;
const tupleValues = kindsDeclaration?.initializer && ts.isAsExpression(kindsDeclaration.initializer) && kindsDeclaration.initializer.type.getText(statusAst) === "const" && ts.isArrayLiteralExpression(kindsDeclaration.initializer.expression)
  ? kindsDeclaration.initializer.expression.elements.map((element) => ts.isStringLiteral(element) ? element.text : undefined)
  : undefined;
if (!tupleValues || tupleValues.length !== expectedKinds.length || tupleValues.some((value, index) => value !== expectedKinds[index])) fail(`STATUS_KINDS must be the unique top-level exported ${expectedKinds.join(", ")} tuple asserted as const`);

const statusKindAliases = statusAst.statements.filter((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "StatusKind" && isExported(statement));
const statusKindAlias = statusKindAliases.length === 1 ? statusKindAliases[0] : undefined;
if (!statusKindAlias) fail("StatusKind must be a unique top-level exported type alias");
else {
  const program = ts.createProgram({ rootNames: [statusPillTsxPath], options: { jsx: ts.JsxEmit.Preserve, noEmit: true, skipLibCheck: true } });
  const checkerSource = program.getSourceFile(statusPillTsxPath);
  const checkerAlias = checkerSource?.statements.find((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "StatusKind");
  const type = checkerAlias ? program.getTypeChecker().getTypeAtLocation(checkerAlias.name) : undefined;
  const values = type?.isUnion() ? type.types.map((member) => member.isStringLiteral() ? member.value : undefined) : [];
  if (values.length !== expectedKinds.length || values.some((value, index) => value !== expectedKinds[index])) fail(`StatusKind must resolve to exactly ${expectedKinds.join(", ")}`);
}

const statusPillFunctions = statusAst.statements.filter((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "StatusPill" && isExported(statement));
const statusPillFunction = statusPillFunctions.length === 1 ? statusPillFunctions[0] : undefined;
const hasKindParameter = statusPillFunction?.parameters.some((parameter) => ts.isObjectBindingPattern(parameter.name) && parameter.name.elements.some((element) => ts.isIdentifier(element.name) && element.name.text === "kind"));
const returnStatement = statusPillFunction?.body?.statements.find(ts.isReturnStatement);
let returnedExpression = returnStatement?.expression;
while (returnedExpression && ts.isParenthesizedExpression(returnedExpression)) returnedExpression = returnedExpression.expression;
const openingElement = returnedExpression && ts.isJsxElement(returnedExpression) ? returnedExpression.openingElement : returnedExpression && ts.isJsxSelfClosingElement(returnedExpression) ? returnedExpression : undefined;
const className = openingElement?.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === "className");
const classExpression = className && ts.isJsxAttribute(className) && className.initializer && ts.isJsxExpression(className.initializer) ? className.initializer.expression : undefined;
const classMappingValid = Boolean(hasKindParameter && classExpression && ts.isTemplateExpression(classExpression) && classExpression.head.text === "status-pill status-pill--" && classExpression.templateSpans.length === 1 && ts.isIdentifier(classExpression.templateSpans[0].expression) && classExpression.templateSpans[0].expression.text === "kind" && classExpression.templateSpans[0].literal.text === "");
if (!classMappingValid) fail("StatusPill must compose its class from the checked kind template in its returned JSX");

function normColors(text) {
  const colors = new Set();
  const hex = new RegExp(`${EXACT_HEX_FRAGMENT}(?![0-9a-zA-Z])`, "g");
  for (const match of text.matchAll(hex)) colors.add(normalizeExactHex(match[0]));
  return colors;
}
function renderedCssColors(file) {
  const colors = new Set();
  stylesheets.get(file)?.walkDecls((declaration) => {
    for (const color of normColors(declaration.value)) colors.add(color);
  });
  return colors;
}
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}
if (renderedCssColors(canonicalCssPath).size) fail("status-pill.css must reference semantic tokens, not color literals");
const ignore = loadIgnore("color");
for (const file of sourceFiles) {
  if (ignored(file, ignore)) continue;
  const colors = file.endsWith(".css") ? renderedCssColors(file) : normColors(withoutComments(readFileSync(file, "utf8")));
  for (const color of colors) if (semanticHexes.has(color)) fail(`${file}: semantic hex ${color} rendered outside status-pill.css`);
}

if (failed) process.exit(1);
console.log("[status-pill SSOT] ok");
