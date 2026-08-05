#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";

const root = resolve(process.argv[2] ?? process.cwd());
const sourceRoot = existsSync(resolve(root, "src"))
  ? resolve(root, "src")
  : root;
const auditBoundary = resolve(
  sourceRoot,
  "modules/audit/with-audit.ts",
);
const sourceExtensions = new Set([".ts", ".tsx"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name.startsWith(".")
        ? []
        : sourceFiles(path);
    }
    return sourceExtensions.has(extname(entry.name)) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
      ? [path]
      : [];
  });
}

function hasModifier(node, kind) {
  return (node.modifiers ?? []).some(
    (modifier) => modifier.kind === kind,
  );
}

function hasDirective(statements, directive) {
  return statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === directive,
  );
}

function actionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return "<inline-server-action>";
}

function serverActions(sourceFile) {
  const actions = [];
  const moduleIsServer = hasDirective(sourceFile.statements, "use server");

  if (moduleIsServer) {
    for (const statement of sourceFile.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        statement.body &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
        hasModifier(statement, ts.SyntaxKind.AsyncKeyword)
      ) {
        actions.push({
          name: statement.name.text,
          node: statement,
          annotationNode: statement,
        });
      }
      if (
        ts.isVariableStatement(statement) &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (
            ts.isIdentifier(declaration.name) &&
            initializer &&
            (ts.isArrowFunction(initializer) ||
              ts.isFunctionExpression(initializer)) &&
            initializer.body &&
            hasModifier(initializer, ts.SyntaxKind.AsyncKeyword)
          ) {
            actions.push({
              name: declaration.name.text,
              node: initializer,
              annotationNode: statement,
            });
          }
        }
      }
    }
  }

  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasModifier(node, ts.SyntaxKind.AsyncKeyword) &&
      hasDirective(node.body.statements, "use server")
    ) {
      actions.push({
        name: actionName(node),
        node,
        annotationNode: node,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return actions;
}

function importedBindings(sourceFile) {
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (statement.importClause.name) {
      imports.set(statement.importClause.name.text, {
        importedName: "default",
        specifier,
      });
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          importedName: element.propertyName?.text ?? element.name.text,
          specifier,
        });
      }
    }
  }
  return imports;
}

function resolveImportedSource(fromFile, specifier) {
  const base = specifier.startsWith("@/")
    ? resolve(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return null;
}

function bindingContainsName(name, binding) {
  if (ts.isIdentifier(name)) return name.text === binding;
  if (ts.isObjectBindingPattern(name) ||
      ts.isArrayBindingPattern(name)) {
    return name.elements.some(
      (element) =>
        ts.isBindingElement(element) &&
        bindingContainsName(element.name, binding),
    );
  }
  return false;
}

function shadowsBinding(node, binding) {
  let shadowed = (node.parameters ?? []).some((parameter) =>
    bindingContainsName(parameter.name, binding),
  );
  function visit(current) {
    if (shadowed) return;
    if (
      current !== node &&
      ((ts.isVariableDeclaration(current) &&
        bindingContainsName(current.name, binding)) ||
        (ts.isFunctionDeclaration(current) &&
          current.name?.text === binding) ||
        (ts.isClassDeclaration(current) &&
          current.name?.text === binding) ||
        (ts.isCatchClause(current) &&
          current.variableDeclaration &&
          bindingContainsName(
            current.variableDeclaration.name,
            binding,
          )))
    ) {
      shadowed = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return shadowed;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function statementExpression(statement) {
  if (ts.isReturnStatement(statement) ||
      ts.isExpressionStatement(statement)) {
    return statement.expression
      ? unwrapExpression(statement.expression)
      : null;
  }
  return null;
}

function callTarget(expression) {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped)) return null;
  let callee = unwrapped.expression;
  let member = null;
  while (ts.isPropertyAccessExpression(callee)) {
    member ??= callee.name.text;
    callee = callee.expression;
  }
  return ts.isIdentifier(callee)
    ? { call: unwrapped, member, root: callee.text }
    : null;
}

function directAuditStatement(
  statement,
  owner,
  imports,
  sourceFilePath,
) {
  const expression = statementExpression(statement);
  const target = expression ? callTarget(expression) : null;
  if (!target || target.member !== null) return false;
  const imported = imports.get(target.root);
  return !!imported &&
    imported.importedName === "withAudit" &&
    resolveImportedSource(sourceFilePath, imported.specifier) ===
      auditBoundary &&
    !shadowsBinding(owner, target.root);
}

function allCallsMatch(node, predicate) {
  let safe = true;
  function visit(current) {
    if (!safe) return;
    if (
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      safe = false;
      return;
    }
    if (ts.isCallExpression(current) && !predicate(current)) {
      safe = false;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return safe;
}

function safePreludeCall(call, owner, imports) {
  const target = callTarget(call);
  if (!target || shadowsBinding(owner, target.root)) return false;
  const imported = imports.get(target.root);
  if (
    target.member === null &&
    imported?.importedName === "auth" &&
    imported.specifier === "@/lib/auth/auth-config"
  ) {
    return true;
  }
  if (
    target.member === null &&
    imported?.importedName === "loadCurrentLedgerAuthorization" &&
    imported.specifier.endsWith("identity-access/server-authorization")
  ) {
    return true;
  }
  if (
    target.member === null &&
    imported?.importedName === "refresh" &&
    imported.specifier === "next/cache"
  ) {
    return true;
  }
  return target.member === "parse" &&
    imported?.specifier === "@smp/contracts";
}

function isNonMutatingExpression(expression, owner, imports) {
  let mutation = false;
  function inspect(node) {
    if (
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >=
          ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <=
          ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(node) ||
        ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)) ||
      ts.isDeleteExpression(node)
    ) {
      mutation = true;
      return;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(expression);
  return !mutation &&
    allCallsMatch(
      expression,
      (call) => safePreludeCall(call, owner, imports),
    );
}

function safeGuardBranch(statement, owner, imports) {
  if (ts.isThrowStatement(statement)) {
    return !statement.expression ||
      isNonMutatingExpression(
        statement.expression,
        owner,
        imports,
      );
  }
  return ts.isBlock(statement) &&
    statement.statements.length > 0 &&
    statement.statements.every((nested) =>
      safeGuardBranch(nested, owner, imports),
    );
}

function safeNonAuditStatement(statement, owner, imports) {
  if (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression)
  ) {
    return true;
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.every(
      (declaration) =>
        !declaration.initializer ||
        isNonMutatingExpression(
          declaration.initializer,
          owner,
          imports,
        ),
    );
  }
  if (ts.isExpressionStatement(statement)) {
    const target = callTarget(statement.expression);
    return !!target &&
      safePreludeCall(target.call, owner, imports);
  }
  if (ts.isIfStatement(statement)) {
    return isNonMutatingExpression(
      statement.expression,
      owner,
      imports,
    ) &&
      safeGuardBranch(statement.thenStatement, owner, imports) &&
      (!statement.elseStatement ||
        safeGuardBranch(statement.elseStatement, owner, imports));
  }
  if (ts.isEmptyStatement(statement)) return true;
  return false;
}

function namedTarget(sourceFile, targetName) {
  let target = null;
  function inspect(node) {
    const name = node.name;
    if (
      !target &&
      name &&
      ((ts.isIdentifier(name) && name.text === targetName) ||
        (ts.isStringLiteral(name) && name.text === targetName)) &&
      (ts.isMethodDeclaration(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node))
    ) {
      target = ts.isPropertyAssignment(node) ? node.initializer : node;
      return;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(sourceFile);
  return target;
}

function returnedFactoryMember(factoryTarget, memberName) {
  const callable = ts.isVariableDeclaration(factoryTarget)
    ? factoryTarget.initializer
    : factoryTarget;
  if (!callable ||
      !(ts.isFunctionDeclaration(callable) ||
        ts.isFunctionExpression(callable) ||
        ts.isArrowFunction(callable))) {
    return null;
  }
  const returned = [];
  if (!ts.isBlock(callable.body)) {
    returned.push(unwrapExpression(callable.body));
  } else {
    function visit(current) {
      if (current !== callable.body &&
          (ts.isFunctionDeclaration(current) ||
           ts.isFunctionExpression(current) ||
           ts.isArrowFunction(current))) {
        return;
      }
      if (ts.isReturnStatement(current) && current.expression) {
        returned.push(unwrapExpression(current.expression));
        return;
      }
      ts.forEachChild(current, visit);
    }
    visit(callable.body);
  }
  for (const expression of returned) {
    if (!ts.isObjectLiteralExpression(expression)) continue;
    for (const property of expression.properties) {
      const name = property.name;
      if (!name ||
          !((ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
            name.text === memberName)) {
        continue;
      }
      if (ts.isPropertyAssignment(property)) return property.initializer;
      if (ts.isMethodDeclaration(property)) return property;
    }
  }
  return null;
}

function objectBindingMap(parameter) {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return null;
  const bindings = new Map();
  for (const element of parameter.name.elements) {
    if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) return null;
    const property = element.propertyName ?? element.name;
    if (!(ts.isIdentifier(property) || ts.isStringLiteral(property))) return null;
    bindings.set(property.text, element.name.text);
  }
  return bindings;
}

function objectArgumentMap(expression) {
  const argument = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(argument)) return null;
  const values = new Map();
  for (const property of argument.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      values.set(property.name.text, property.name);
      continue;
    }
    if (!ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      return null;
    }
    values.set(property.name.text, property.initializer);
  }
  return values;
}

function boundFactoryArgument(factoryTarget, factoryCall, propertyName) {
  const bindings = objectBindingMap(factoryTarget.parameters?.[0]);
  const values = factoryCall.call.arguments.length === 1
    ? objectArgumentMap(factoryCall.call.arguments[0])
    : null;
  const localName = bindings?.get(propertyName);
  const value = values?.get(propertyName);
  return localName && value ? { localName, value } : null;
}

function trustedAuthorizationLoader(expression, owner, imports) {
  const value = unwrapExpression(expression);
  if (!ts.isIdentifier(value) || shadowsBinding(owner, value.text)) return false;
  const imported = imports.get(value.text);
  return imported?.importedName === "loadCurrentLedgerAuthorization" &&
    imported.specifier.endsWith("identity-access/server-authorization");
}

function trustedRevalidator(expression, owner, imports) {
  const value = unwrapExpression(expression);
  if (!ts.isIdentifier(value) || shadowsBinding(owner, value.text)) return false;
  const imported = imports.get(value.text);
  return imported?.importedName === "revalidatePath" &&
    imported.specifier === "next/cache";
}

function factoryOperationIsAudited(
  factoryFile,
  factorySourcePath,
  actionsName,
  memberName,
) {
  const actionsTarget = namedTarget(factoryFile, actionsName);
  const initializer = actionsTarget?.initializer;
  const actionFactoryCall = initializer ? callTarget(initializer) : null;
  if (!actionFactoryCall || actionFactoryCall.member !== null) return false;
  const factoryImport = importedBindings(factoryFile).get(actionFactoryCall.root);
  if (!factoryImport) return false;
  const operationsSource = resolveImportedSource(factorySourcePath, factoryImport.specifier);
  if (!operationsSource) return false;
  const operationsFile = ts.createSourceFile(
    operationsSource,
    readFileSync(operationsSource, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    operationsSource.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const operationsFactory = namedTarget(operationsFile, factoryImport.importedName);
  const operation = operationsFactory
    ? returnedFactoryMember(operationsFactory, memberName)
    : null;
  return !!operation && wholeBodyUsesAudit(
    operation,
    importedBindings(operationsFile),
    operationsSource,
    true,
  );
}

function configuredActionFactoryMemberIsAudited({
  callerImports,
  factoryCall,
  factoryFile,
  factorySourcePath,
  factoryTarget,
  memberName,
  memberTarget,
  owner,
}) {
  const authorization = boundFactoryArgument(
    factoryTarget,
    factoryCall,
    "loadAuthorization",
  );
  const revalidator = boundFactoryArgument(factoryTarget, factoryCall, "revalidate");
  if (!authorization || !revalidator ||
      !trustedAuthorizationLoader(authorization.value, owner, callerImports) ||
      !trustedRevalidator(revalidator.value, owner, callerImports)) {
    return false;
  }
  const body = memberTarget.body ?? memberTarget;
  if (!ts.isBlock(body) || body.statements.length < 4) return false;
  const [load, guard, operation, ...postAudit] = body.statements;
  if (!ts.isVariableStatement(load) ||
      load.declarationList.declarations.length !== 1) return false;
  const declaration = load.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return false;
  const authorizationName = declaration.name.text;
  const loadCall = callTarget(declaration.initializer);
  if (!loadCall || loadCall.member !== null ||
      loadCall.root !== authorization.localName ||
      loadCall.call.arguments.length !== 0) return false;
  if (!ts.isIfStatement(guard) || guard.elseStatement ||
      !ts.isPrefixUnaryExpression(guard.expression) ||
      guard.expression.operator !== ts.SyntaxKind.ExclamationToken ||
      !ts.isIdentifier(guard.expression.operand) ||
      guard.expression.operand.text !== authorizationName) return false;
  const guarded = ts.isBlock(guard.thenStatement)
    ? guard.thenStatement.statements
    : [guard.thenStatement];
  if (guarded.length !== 1 || !ts.isThrowStatement(guarded[0])) return false;
  const operationExpression = statementExpression(operation);
  const operationCall = operationExpression ? callTarget(operationExpression) : null;
  if (!operationCall || operationCall.member !== memberName ||
      operationCall.call.arguments.length !== 2 ||
      !ts.isIdentifier(operationCall.call.arguments[0]) ||
      operationCall.call.arguments[0].text !== authorizationName ||
      !ts.isIdentifier(operationCall.call.arguments[1]) ||
      operationCall.call.arguments[1].text !== "input" ||
      !factoryOperationIsAudited(
        factoryFile,
        factorySourcePath,
        operationCall.root,
        memberName,
      )) return false;
  return postAudit.length > 0 && postAudit.every((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    const revalidateCall = callTarget(statement.expression);
    return !!revalidateCall && revalidateCall.member === null &&
      revalidateCall.root === revalidator.localName &&
      revalidateCall.call.arguments.length === 1 &&
      ts.isStringLiteral(revalidateCall.call.arguments[0]);
  });
}

function serviceTargetIsAudited(
  expression,
  owner,
  imports,
  sourceFilePath,
) {
  const call = callTarget(expression);
  if (!call || shadowsBinding(owner, call.root)) {
    return false;
  }
  if (!call.member) {
    const localTarget = namedTarget(
      ts.getSourceFileOfNode(owner),
      call.root,
    );
    return !!localTarget && localTarget !== owner &&
      wholeBodyUsesAudit(localTarget, imports, sourceFilePath, true);
  }
  const imported = imports.get(call.root);
  if (!imported) {
    const localService = namedTarget(ts.getSourceFileOfNode(owner), call.root);
    const initializer = localService?.initializer;
    const factoryCall = initializer ? callTarget(initializer) : null;
    if (!factoryCall || factoryCall.member !== null) return false;
    const factoryImport = imports.get(factoryCall.root);
    if (!factoryImport || shadowsBinding(owner, factoryCall.root)) return false;
    const factorySource = resolveImportedSource(sourceFilePath, factoryImport.specifier);
    if (!factorySource) return false;
    const factoryText = readFileSync(factorySource, "utf8");
    const factoryFile = ts.createSourceFile(
      factorySource,
      factoryText,
      ts.ScriptTarget.Latest,
      true,
      factorySource.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const factoryTarget = namedTarget(
      factoryFile,
      factoryImport.importedName,
    );
    const memberTarget = factoryTarget
      ? returnedFactoryMember(factoryTarget, call.member)
      : null;
    return !!memberTarget && (
      wholeBodyUsesAudit(
        memberTarget,
        importedBindings(factoryFile),
        factorySource,
        true,
      ) || configuredActionFactoryMemberIsAudited({
        callerImports: imports,
        factoryCall,
        factoryFile,
        factorySourcePath: factorySource,
        factoryTarget,
        memberName: call.member,
        memberTarget,
        owner,
      })
    );
  }
    const importedSourcePath = resolveImportedSource(
      sourceFilePath,
      imported.specifier,
    );
  if (!importedSourcePath) return false;
    const sourceText = readFileSync(importedSourcePath, "utf8");
    const sourceFile = ts.createSourceFile(
      importedSourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      importedSourcePath.endsWith(".tsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );
    const target = namedTarget(
      sourceFile,
    call.member,
    );
  return !!target &&
    wholeBodyUsesAudit(
      target,
      importedBindings(sourceFile),
      importedSourcePath,
      false,
    );
}

function auditedServiceAssignment(
  statement,
  owner,
  imports,
  sourceFilePath,
) {
  if (
    !ts.isVariableStatement(statement) ||
    statement.declarationList.declarations.length !== 1
  ) {
    return false;
  }
  const [declaration] = statement.declarationList.declarations;
  return !!declaration.initializer &&
    serviceTargetIsAudited(
      declaration.initializer,
      owner,
      imports,
      sourceFilePath,
    );
}

function safeRedirectCall(expression, owner, imports) {
  const target = callTarget(expression);
  if (
    !target ||
    target.member !== null ||
    shadowsBinding(owner, target.root)
  ) {
    return false;
  }
  const imported = imports.get(target.root);
  return ((imported?.importedName === "redirect" &&
    imported.specifier === "next/navigation") ||
    (imported?.importedName === "revalidatePath" &&
      imported.specifier === "next/cache")) &&
    target.call.arguments.every((argument) =>
      isNonMutatingExpression(argument, owner, imports),
    );
}

function safePostAuditStatement(statement, owner, imports) {
  if (ts.isBlock(statement)) {
    return statement.statements.every((nested) =>
      safePostAuditStatement(nested, owner, imports),
    );
  }
  if (ts.isReturnStatement(statement)) {
    return !statement.expression ||
      isNonMutatingExpression(statement.expression, owner, imports);
  }
  if (ts.isExpressionStatement(statement)) {
    return safeRedirectCall(statement.expression, owner, imports);
  }
  if (ts.isIfStatement(statement)) {
    return isNonMutatingExpression(
      statement.expression,
      owner,
      imports,
    ) &&
      safePostAuditStatement(statement.thenStatement, owner, imports) &&
      (!statement.elseStatement ||
        safePostAuditStatement(statement.elseStatement, owner, imports));
  }
  return ts.isEmptyStatement(statement);
}

function wholeBodyUsesAudit(
  owner,
  imports,
  sourceFilePath,
  allowOneHop,
) {
  const body = owner.body ?? owner;
  if (!ts.isBlock(body)) {
    const synthetic = ts.factory.createReturnStatement(body);
    return directAuditStatement(
      synthetic,
      owner,
      imports,
      sourceFilePath,
    );
  }

  let auditedStatements = 0;
  for (const statement of body.statements) {
    if (
      directAuditStatement(
        statement,
        owner,
        imports,
        sourceFilePath,
      )
    ) {
      auditedStatements += 1;
      continue;
    }
    if (
      allowOneHop &&
      auditedStatements === 0 &&
      auditedServiceAssignment(
        statement,
        owner,
        imports,
        sourceFilePath,
      )
    ) {
      auditedStatements += 1;
      continue;
    }
    if (
      auditedStatements === 1 &&
      safePostAuditStatement(statement, owner, imports)
    ) {
      continue;
    }
    const expression = statementExpression(statement);
    if (
      allowOneHop &&
      expression &&
      serviceTargetIsAudited(
        expression,
        owner,
        imports,
        sourceFilePath,
      )
    ) {
      auditedStatements += 1;
      continue;
    }
    if (!safeNonAuditStatement(statement, owner, imports)) return false;
  }
  return auditedStatements === 1;
}

const failures = [];
for (const path of sourceFiles(sourceRoot)) {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = importedBindings(sourceFile);
  for (const action of serverActions(sourceFile)) {
    const leadingText = sourceText.slice(
      action.annotationNode.getFullStart(),
      action.annotationNode.getStart(sourceFile),
    );
    if (leadingText.includes("@read-only-action")) continue;
    if (wholeBodyUsesAudit(action.node, imports, path, true)) continue;
    failures.push(`${path}: ${action.name}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Unaudited server actions:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Audited server action enforcement passed\n");
}
