#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const target = resolve(process.argv[2] || ".");
const helperDirectory = dirname(fileURLToPath(import.meta.url));
const compilerPath = process.env.NOUS_TYPESCRIPT_COMPILER || resolve(
  helperDirectory,
  "../../apps/web/node_modules/typescript/lib/typescript.js",
);
const ts = await import(pathToFileURL(compilerPath).href);
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const AUTHJS_ROUTE = "apps/web/src/app/api/auth/[...nextauth]/route.ts";

function repoRelative(path) {
  return relative(target, path).split(sep).join("/");
}

function filesUnder(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  try {
    visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return files;
}

const webSource = join(target, "apps/web/src");
const routeFiles = filesUnder(join(webSource, "app/api")).filter(
  (path) => path.endsWith(`${sep}route.ts`) && repoRelative(path) !== AUTHJS_ROUTE,
);
const frontendFiles = filesUnder(webSource).filter((path) => {
  const name = repoRelative(path);
  return (
    (name.endsWith(".ts") || name.endsWith(".tsx"))
    && !name.includes(".test.")
    && !name.includes(".spec.")
    && !name.startsWith("apps/web/src/app/api/")
  );
});
const allFiles = [...new Set([...routeFiles, ...frontendFiles])].sort();
const program = ts.createProgram(allFiles, {
  allowJs: false,
  jsx: ts.JsxEmit.Preserve,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
});
const checker = program.getTypeChecker();

function sourceFileFor(path) {
  const sourceFile = program.getSourceFile(path);
  if (!sourceFile) throw new Error(`AST helper did not load ${repoRelative(path)}`);
  if (sourceFile.parseDiagnostics.length) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    throw new Error(
      `TypeScript parse error ${repoRelative(path)}:${position.line + 1}:`
      + `${position.character + 1}: ${message}`,
    );
  }
  return sourceFile;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function routePath(path) {
  const apiRoot = join(webSource, "app/api");
  const segments = relative(apiRoot, dirname(path))
    .split(sep)
    .filter((segment) => segment && !segment.startsWith("("))
    .map((segment) => {
      const catchAll = segment.match(/^\[\[?\.\.\.(\w+)\]?\]$/);
      if (catchAll) return `:${catchAll[1]}*`;
      const dynamic = segment.match(/^\[(\w+)\]$/);
      return dynamic ? `:${dynamic[1]}` : segment;
    });
  return `/api/${segments.join("/")}`.replace(/\/$/, "");
}

function hasExportModifier(node) {
  return Boolean(
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function scanRoute(path) {
  const sourceFile = sourceFileFor(path);
  const methods = new Map();
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && hasExportModifier(statement)
      && statement.name
      && HTTP_METHODS.has(statement.name.text)
    ) {
      methods.set(statement.name.text, lineOf(sourceFile, statement.name));
    } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.has(declaration.name.text)) {
          methods.set(declaration.name.text, lineOf(sourceFile, declaration.name));
        }
      }
    } else if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (HTTP_METHODS.has(element.name.text)) {
          methods.set(element.name.text, lineOf(sourceFile, element.name));
        }
      }
    }
  }
  return [...methods]
    .sort(([left], [right]) => [...HTTP_METHODS].indexOf(left) - [...HTTP_METHODS].indexOf(right))
    .map(([method, line]) => ({
      method,
      path: routePath(path),
      file: repoRelative(path),
      line,
    }));
}

function symbolInitializer(identifier) {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol) return null;
  for (const declaration of symbol.declarations || []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return declaration.initializer;
    }
  }
  return null;
}

function isGlobalObject(node) {
  if (
    !ts.isIdentifier(node)
    || !["globalThis", "window", "self", "global"].includes(node.text)
  ) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(node);
  return Boolean(
    !symbol
    || !(symbol.declarations || []).some(
      (declaration) => declaration.getSourceFile() === node.getSourceFile(),
    ),
  );
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node)
    && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function memberObject(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? node.expression
    : null;
}

function bindingElementIsNativeFetch(declaration) {
  const property = ts.isBindingElement(declaration)
    ? declaration.propertyName || declaration.name
    : null;
  if (
    !ts.isBindingElement(declaration)
    || !ts.isObjectBindingPattern(declaration.parent)
    || !property
    || (!ts.isIdentifier(property) && !ts.isStringLiteralLike(property))
    || property.text !== "fetch"
  ) {
    return false;
  }
  const variable = declaration.parent.parent;
  return (
    ts.isVariableDeclaration(variable)
    && Boolean(variable.initializer)
    && isGlobalObject(variable.initializer)
  );
}

function isNativeFetchReference(node, seen = new Set()) {
  if (
    memberObject(node)
    && isGlobalObject(memberObject(node))
    && memberName(node) === "fetch"
  ) {
    return true;
  }
  if (
    ts.isCallExpression(node)
    && memberObject(node.expression)
    && memberName(node.expression) === "bind"
    && isNativeFetchReference(memberObject(node.expression), seen)
  ) {
    return true;
  }
  if (!ts.isIdentifier(node)) return false;
  const symbol = checker.getSymbolAtLocation(node);
  if (node.text === "fetch") {
    if (!symbol) return true;
    const ownedDeclaration = (symbol.declarations || []).find(
      (declaration) => declaration.getSourceFile() === node.getSourceFile(),
    );
    if (!ownedDeclaration) return true;
  }
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  for (const declaration of symbol.declarations || []) {
    if (
      ts.isVariableDeclaration(declaration)
      && declaration.initializer
      && isNativeFetchReference(declaration.initializer, seen)
    ) {
      return true;
    }
    if (bindingElementIsNativeFetch(declaration)) return true;
  }
  return false;
}

function firstArrayArgument(node, seen = new Set()) {
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node)
  ) {
    return firstArrayArgument(node.expression, seen);
  }
  if (
    ts.isArrayLiteralExpression(node)
    && node.elements.length
    && !ts.isSpreadElement(node.elements[0])
  ) {
    return node.elements[0];
  }
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    const initializer = symbolInitializer(node);
    return initializer ? firstArrayArgument(initializer, seen) : null;
  }
  return null;
}

function nativeFetchArgument(call) {
  if (isNativeFetchReference(call.expression)) {
    return {
      native: true,
      argument: call.arguments.length ? call.arguments[0] : null,
    };
  }
  const object = memberObject(call.expression);
  const wrapper = memberName(call.expression);
  if (!object || !["call", "apply"].includes(wrapper) || !isNativeFetchReference(object)) {
    return { native: false, argument: null };
  }
  if (wrapper === "call") {
    return {
      native: true,
      argument: call.arguments.length > 1 ? call.arguments[1] : null,
    };
  }
  const argumentList = call.arguments.length > 1 ? call.arguments[1] : null;
  return {
    native: true,
    argument: argumentList ? firstArrayArgument(argumentList) : null,
  };
}

function templateValue(node) {
  let value = node.head.text;
  for (const span of node.templateSpans) {
    value += `\${${span.expression.getText(node.getSourceFile())}}`;
    value += span.literal.text;
  }
  return value;
}

function staticValue(node, seen = new Set()) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) return templateValue(node);
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    const initializer = symbolInitializer(node);
    return initializer ? staticValue(initializer, seen) : null;
  }
  if (
    ts.isNewExpression(node)
    && ts.isIdentifier(node.expression)
    && (node.expression.text === "Request" || node.expression.text === "URL")
    && node.arguments?.length
  ) {
    return staticValue(node.arguments[0], seen);
  }
  return null;
}

function internalApiPath(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/\/api\/[A-Za-z0-9_$./:{}?=&-]+/);
  return match ? match[0] : null;
}

function scanFrontend(path) {
  const sourceFile = sourceFileFor(path);
  const file = repoRelative(path);
  const calls = [];
  const add = (entry) => {
    if (
      !calls.some(
        (candidate) => candidate.path === entry.path
          && candidate.type === entry.type
          && candidate.line === entry.line,
      )
    ) {
      calls.push(entry);
    }
  };
  function visit(node) {
    if (
      ts.isStringLiteralLike(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)
    ) {
      const pathValue = internalApiPath(staticValue(node));
      if (pathValue) {
        add({ path: pathValue, type: "api_reference", file, line: lineOf(sourceFile, node) });
      }
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression)
        && /^api(Get|Post|Patch|Put|Delete)$/.test(node.expression.text)
      ) {
        const pathValue = internalApiPath(
          node.arguments.length ? staticValue(node.arguments[0]) : null,
        );
        if (pathValue) {
          add({ path: pathValue, type: "shared_client", file, line: lineOf(sourceFile, node) });
        }
      }
      const invocation = nativeFetchArgument(node);
      if (invocation.native) {
        const value = invocation.argument ? staticValue(invocation.argument) : null;
        const pathValue = internalApiPath(value);
        if (pathValue) {
          add({ path: pathValue, type: "raw_fetch", file, line: lineOf(sourceFile, node) });
        } else if (value === null) {
          add({
            path: null,
            type: "raw_fetch_unresolved",
            file,
            line: lineOf(sourceFile, node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return calls;
}

try {
  const backendEndpoints = routeFiles.flatMap(scanRoute);
  const frontendCalls = frontendFiles.flatMap(scanFrontend);
  process.stdout.write(JSON.stringify({
    version: 1,
    backend_endpoints: backendEndpoints,
    frontend_calls: frontendCalls,
  }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
