import { createHash } from "node:crypto";
import ts from "../../apps/web/node_modules/typescript/lib/typescript.js";
import { parseSchemaContract, attestSchemaContract } from "../../packages/db/scripts/schema-contract-policy.mjs";
import { WorkReadinessError } from "./model.mjs";
import { SCHEMA_CONTRACT_PATH } from "./delivery-policy.mjs";

const SCHEMA_PATH = "packages/db/src/schema.ts";
const MIGRATION_PREFIX = "packages/db/src/migrations/";
const MIGRATION_PATH = /^packages\/db\/src\/migrations\/V[0-9]{14}__[a-z0-9][a-z0-9_]*\.sql$/u;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

function reject(detail) {
  throw new WorkReadinessError("WR_MIXED_FUNCTIONAL_TOOLING", detail, SCHEMA_CONTRACT_PATH);
}
function regular(file, path) {
  if (file?.path !== path || file.mode !== "100644" || !/^[a-f0-9]{40}$/u.test(file.blob)
    || !(file.bytes instanceof Uint8Array)) reject(`Expected immutable regular source: ${path}`);
  return file;
}
function declaration(file) {
  regular(file, SCHEMA_CONTRACT_PATH);
  try {
    const parsed = parseSchemaContract(file.bytes, SCHEMA_CONTRACT_PATH);
    attestSchemaContract(parsed);
    const projection = { schema_version: 1, coreTableNames: parsed.coreTableNames,
      normallyUpdateableTableNames: parsed.normallyUpdateableTableNames,
      expectedAppendOnlyColumnUpdates: parsed.expectedAppendOnlyColumnUpdates };
    if (file.schemaVersion !== parsed.schema_version
      || file.baselineProjectionSha256 !== createHash("sha256").update(JSON.stringify(projection, null, 2) + "\n").digest("hex")
      || JSON.stringify(file.newTableRowSha256) !== JSON.stringify((parsed.newTables ?? [])
        .map((row) => createHash("sha256").update(JSON.stringify(row)).digest("hex")))) reject("Declaration projection identity differs from its immutable bytes");
    return parsed;
  } catch (error) {
    reject(`Finite declaration rejected: ${error.message}`);
  }
}
function sameFile(left, right) {
  return left?.path === right?.path && left?.mode === right?.mode && left?.blob === right?.blob;
}
function migrations(snapshot) {
  if (!Array.isArray(snapshot.migrations)) reject("Missing complete migration snapshot");
  let previous = "";
  for (const file of snapshot.migrations) {
    if (!file) reject("Migration entry is missing");
    regular(file, file.path);
    if (!file.path.startsWith(MIGRATION_PREFIX) || !MIGRATION_PATH.test(file.path) || file.path <= previous
      || file.sha256 !== createHash("sha256").update(file.bytes).digest("hex")) reject("Migration names, order or bytes are invalid");
    previous = file.path;
  }
  return snapshot.migrations;
}
function appendOnly(before, after) {
  if (before.length > after.length || before.some((file, index) => !sameFile(file, after[index]))) {
    reject("Existing migration path, mode and blob prefix must remain unchanged");
  }
}
function rowPrefix(before, after) {
  const prior = before.newTables ?? [];
  const next = after.newTables ?? [];
  if (prior.length > next.length || prior.some((row, index) => JSON.stringify(row) !== JSON.stringify(next[index]))) {
    reject("Existing finite declaration rows must remain an exact ordered prefix");
  }
}

// This parser establishes literal source identity only. Catalog semantics and
// authorization are checked by the actual release and functional application.
function tableIdentity(file, target, required) {
  regular(file, SCHEMA_PATH);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes); }
  catch { reject("Schema must contain valid UTF-8"); }
  const source = ts.createSourceFile(SCHEMA_PATH, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) reject("Schema has unsupported syntax");
  const tableImports = new Set(["pgTable"]);
  const columns = new Set();
  let realTableImports = 0;
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const emptyModuleMarker = !statement.moduleSpecifier && statement.exportClause
        && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length === 0;
      if (!emptyModuleMarker) reject("Runtime schema reexports cannot prove table absence or ownership");
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "drizzle-orm/pg-core") continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (!clause?.isTypeOnly && (clause?.name || (bindings && ts.isNamespaceImport(bindings)))) reject("Namespace or default schema builders are unsupported");
    if (clause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "pgTable") {
        tableImports.add(element.name.text);
        if (!element.propertyName && !element.isTypeOnly) realTableImports++;
      }
      if (!element.propertyName && !element.isTypeOnly) columns.add(element.name.text);
    }
  }
  const matches = [];
  function visit(node) {
    if (ts.isIdentifier(node) && tableImports.has(node.text)) {
      const parent = node.parent;
      const imported = ts.isImportSpecifier(parent);
      const directCallee = ts.isCallExpression(parent) && parent.expression === node;
      const propertyName = (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isPropertyAccessExpression(parent) && parent.name === node);
      if (!imported && !directCallee && !propertyName) reject("Aliased or escaped table builder identity is unsupported");
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) reject("Dynamic schema modules are unsupported");
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === target && !(ts.isIdentifier(node.expression)
        && (tableImports.has(node.expression.text) || columns.has(node.expression.text)))) {
      reject("The selected table cannot be hidden behind an unsupported builder");
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && tableImports.has(node.expression.text)) {
      if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) reject("Computed table identities are unsupported");
      if (node.arguments[0].text === target) matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!required) {
    if (matches.length) reject("Declared table already exists in the immutable authority base");
    return false;
  }
  if (required === "optional" && matches.length === 0) return false;
  if (realTableImports !== 1 || matches.length !== 1) reject("Expected one new direct exported pgTable from the real named import");
  const call = matches[0];
  const variable = call.parent;
  const statement = variable?.parent?.parent;
  if (call.expression.text !== "pgTable" || !ts.isVariableDeclaration(variable) || variable.initializer !== call
    || !ts.isIdentifier(variable.name) || !ts.isVariableStatement(statement) || statement.parent !== source
    || !(statement.declarationList.flags & ts.NodeFlags.Const)
    || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    || !call.arguments[1] || !ts.isObjectLiteralExpression(call.arguments[1])) reject("Table must be a direct exported const pgTable literal");
  const identities = new Set();
  const properties = new Set();
  for (const property of call.arguments[1].properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      reject("Computed, spread or dynamic schema columns are unsupported");
    }
    if (properties.has(property.name.text)) reject("Duplicate schema property identity");
    properties.add(property.name.text);
    let builder = property.initializer;
    while (ts.isCallExpression(builder) && ts.isPropertyAccessExpression(builder.expression)) builder = builder.expression.expression;
    if (!ts.isCallExpression(builder) || !ts.isIdentifier(builder.expression) || !columns.has(builder.expression.text)
      || builder.expression.text === "pgTable" || !builder.arguments[0] || !ts.isStringLiteral(builder.arguments[0])
      || !IDENTIFIER.test(builder.arguments[0].text)) reject("Columns require a real named builder and literal canonical identity");
    const name = builder.arguments[0].text;
    if (identities.has(name)) reject("Duplicate database column identity");
    identities.add(name);
  }
  for (const column of ["id", "vendor_account_id", "license_type_id", "person_id", "resolved_by_assignment_id", "member_identity", "resolved_at"]) {
    if (!identities.has(column)) reject(`Finite profile column is absent: ${column}`);
  }
  return true;
}

export function validateSchemaDeclarationOwnership({ workId, digest, authorityBase, parent, candidate, transitions }) {
  if (!/^(?:US|CHG)-[0-9]{3,}$/u.test(workId) || !/^[0-9a-f]{64}$/u.test(digest)) reject("Invalid current item/digest identity");
  const initial = declaration(authorityBase.declaration);
  const prior = declaration(parent.declaration);
  const next = declaration(candidate.declaration);
  rowPrefix(initial, next);
  rowPrefix(prior, next);
  if (next.schema_version !== 2 || next.newTables.length !== (prior.newTables?.length ?? 0) + 1) reject("Only an additive nonempty version2 declaration qualifies");
  tableIdentity(authorityBase.schema, "drift_episode", false);
  tableIdentity(candidate.schema, "drift_episode", true);
  const originalMigrations = migrations(authorityBase);
  const finalMigrations = migrations(candidate);
  appendOnly(originalMigrations, finalMigrations);
  if (finalMigrations.length === originalMigrations.length) reject("A new table requires an owned append-only migration");
  if (!Array.isArray(transitions) || transitions.length === 0) reject("Actual introduction history is required");
  let previous = authorityBase;
  let schemaIntroduced = false;
  const introducedMigrations = new Set();
  for (const transition of transitions) {
    const { before, after } = transition;
    const oldMigrations = migrations(before);
    const newMigrations = migrations(after);
    if (transition.parent !== previous.revision || before.revision !== previous.revision || after.revision !== transition.commit
      || !sameFile(before.schema, previous.schema) || !sameFile(before.declaration, previous.declaration)
      || JSON.stringify(before.migrations.map(({ path, mode, blob }) => ({ path, mode, blob })))
        !== JSON.stringify(previous.migrations.map(({ path, mode, blob }) => ({ path, mode, blob })))) reject("Incomplete or discontinuous immutable history");
    appendOnly(oldMigrations, newMigrations);
    const oldDeclaration = declaration(before.declaration);
    const newDeclaration = declaration(after.declaration);
    rowPrefix(oldDeclaration, newDeclaration);
    const schemaChanged = !sameFile(before.schema, after.schema);
    const declarationChanged = !sameFile(before.declaration, after.declaration);
    const migrationChanged = newMigrations.length !== oldMigrations.length;
    if (schemaChanged || declarationChanged || migrationChanged) {
      if (transition.workId !== workId || transition.digest !== digest || transition.parentApproved !== true || transition.planBound !== true) {
        reject("Source transition lacks this exact item's actually approved parent and plan");
      }
      if (schemaChanged) {
        const hasTable = tableIdentity(after.schema, "drift_episode", "optional");
        if (schemaIntroduced && !hasTable) reject("Owned table cannot disappear from introduction history");
        schemaIntroduced ||= hasTable;
      }
      for (const file of newMigrations.slice(oldMigrations.length)) introducedMigrations.add(file.path);
    }
    previous = after;
  }
  if (previous.revision !== candidate.revision || transitions.at(-1).parent !== parent.revision
    || !sameFile(previous.schema, candidate.schema) || !sameFile(previous.declaration, candidate.declaration)
    || !schemaIntroduced || finalMigrations.slice(originalMigrations.length).some((file) => !introducedMigrations.has(file.path))) {
    reject("Candidate sources do not have complete same-item introduction lineage");
  }
  return true;
}
