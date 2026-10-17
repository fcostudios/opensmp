import { createHash } from "node:crypto";

// Immutable canonical baseline identity; declaration values have one runtime
// source. This digest is never derived from caller-supplied approval data.
const ORIGINAL_BASELINE_SHA256 = "0b755c2c2b71cf8065093608ae01c9353232da7eb196ea9da78f5445e59b6e7b";

const topKeys = [
  "schema_version",
  "coreTableNames",
  "normallyUpdateableTableNames",
  "expectedAppendOnlyColumnUpdates",
];
const rowKeys = ["tableName", "columnName"];
const identifier = /^[a-z][a-z0-9_]{0,62}$/;
const declarationPaths = new WeakMap();

function reject(category, path, detail) {
  const error = new Error(`schema-contract/${category}: ${path}: ${detail}`);
  error.category = category;
  error.path = path;
  throw error;
}

// JSON.parse first establishes valid syntax. This small lexical walk then
// checks decoded object keys before the parsed object can hide duplicates.
function rejectDuplicateKeys(text, path) {
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? "") && index < text.length) index++; };
  function string() {
    const start = index++;
    while (text[index] !== '"') {
      if (text[index] === "\\") index++;
      index++;
    }
    index++;
    return JSON.parse(text.slice(start, index));
  }
  // Valid JSON lets a following colon identify a key unambiguously. Keep
  // container state on the heap so even wrong-shape deep values are scanned
  // for decoded duplicates before the shape check, without recursive calls.
  const containers = [];
  while (index < text.length) {
    const token = text[index];
    if (token === "{" || token === "[") {
      containers.push(token === "{" ? new Set() : null);
      index++;
    } else if (token === "}" || token === "]") {
      containers.pop();
      index++;
    } else if (token === '"') {
      const key = string();
      whitespace();
      if (text[index] === ":") {
        const keys = containers.at(-1);
        if (keys.has(key)) reject("duplicate-key", path, `repeated decoded key ${JSON.stringify(key)}`);
        keys.add(key);
      }
    } else {
      index++;
    }
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

// The only extension vocabulary is DEC-SMP-053's finite drift-episode profile.
// Names remain declaration identifiers; they never supply SQL or modules.
function extensionRows(rows, path) {
  if (!Array.isArray(rows)) reject("shape", path, "newTables must be an array");
  if (rows.length > 1) reject("profile", path, "at most one drift-episode-v1 table");
  return rows.map((row) => {
    if (!exactKeys(row, ["tableName", "profile", "mutable", "rls", "policies", "constraints"]) ||
        !exactKeys(row.rls, ["enabled", "forced"]) || !Array.isArray(row.policies) || !Array.isArray(row.constraints)) {
      reject("shape", path, "expected closed new-table descriptor");
    }
    const names = [row.tableName];
    const predicate = (value) => {
      if (value === null) return null;
      if (!exactKeys(value, ["template", "columnName", "referencedTable", "referencedColumn"])) reject("shape", path, "expected closed predicate descriptor");
      names.push(value.columnName, value.referencedTable, value.referencedColumn);
      return { template: value.template, columnName: value.columnName, referencedTable: value.referencedTable, referencedColumn: value.referencedColumn };
    };
    const policies = row.policies.map((policy) => {
      if (!exactKeys(policy, ["name", "command", "role", "using", "withCheck"])) reject("shape", path, "expected closed policy descriptor");
      names.push(policy.name, policy.role);
      return { name: policy.name, command: policy.command, role: policy.role, using: predicate(policy.using), withCheck: predicate(policy.withCheck) };
    });
    const constraints = row.constraints.map((constraint) => {
      const keys = constraint?.kind === "FOREIGN_KEY"
        ? ["name", "kind", "columns", "referencedTable", "referencedColumns", "onUpdate", "onDelete"]
        : constraint?.kind === "UNIQUE_OPEN" ? ["name", "kind", "columns", "nullColumn"]
        : ["PRIMARY_KEY", "UNIQUE"].includes(constraint?.kind) ? ["name", "kind", "columns"] : [];
      if (keys.length === 0 || !exactKeys(constraint, keys) || !Array.isArray(constraint.columns) ||
          (constraint.kind === "FOREIGN_KEY" && !Array.isArray(constraint.referencedColumns))) reject("shape", path, "expected closed constraint descriptor");
      names.push(constraint.name, ...constraint.columns);
      const result = { name: constraint.name, kind: constraint.kind, columns: constraint.columns };
      if (constraint.kind === "FOREIGN_KEY") {
        names.push(constraint.referencedTable, ...constraint.referencedColumns);
        Object.assign(result, { referencedTable: constraint.referencedTable, referencedColumns: constraint.referencedColumns, onUpdate: constraint.onUpdate, onDelete: constraint.onDelete });
      }
      if (constraint.kind === "UNIQUE_OPEN") { names.push(constraint.nullColumn); result.nullColumn = constraint.nullColumn; }
      return result;
    });
    if (!names.every((name) => typeof name === "string" && identifier.test(name))) reject("invalid-identifier", path, "identifiers must be lowercase ASCII and at most 63 characters");
    const objectNames = [...policies, ...constraints].map(({ name }) => name);
    if (new Set(objectNames).size !== objectNames.length) reject("duplicate-element", path, "catalog object names must be unique");
    const expectedPredicate = { template: "account-reference-exists-v1", columnName: "vendor_account_id", referencedTable: "vendor_account", referencedColumn: "id" };
    const expectedPolicies = [
      { name: policies[0]?.name, command: "SELECT", role: "ledger_app", using: expectedPredicate, withCheck: null },
      { name: policies[1]?.name, command: "INSERT", role: "ledger_app", using: null, withCheck: expectedPredicate },
      { name: policies[2]?.name, command: "UPDATE", role: "ledger_app", using: expectedPredicate, withCheck: expectedPredicate },
    ];
    const expectedConstraints = [
      { name: constraints[0]?.name, kind: "PRIMARY_KEY", columns: ["id"] },
      ...[["vendor_account_id", "vendor_account"], ["license_type_id", "license_type"], ["person_id", "person"], ["resolved_by_assignment_id", "license_assignment"]].map(([column, table], index) => ({ name: constraints[index + 1]?.name, kind: "FOREIGN_KEY", columns: [column], referencedTable: table, referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" })),
      { name: constraints[5]?.name, kind: "UNIQUE", columns: ["resolved_by_assignment_id"] },
      { name: constraints[6]?.name, kind: "UNIQUE_OPEN", columns: ["vendor_account_id", "member_identity", "license_type_id"], nullColumn: "resolved_at" },
    ];
    if (row.tableName !== "drift_episode" || row.profile !== "drift-episode-v1" || row.mutable !== true || row.rls.enabled !== true || row.rls.forced !== false ||
        JSON.stringify(policies) !== JSON.stringify(expectedPolicies) || JSON.stringify(constraints) !== JSON.stringify(expectedConstraints)) {
      reject("profile", path, "expected exact drift-episode-v1 capabilities");
    }
    return { tableName: row.tableName, profile: row.profile, mutable: row.mutable, rls: { enabled: row.rls.enabled, forced: row.rls.forced }, policies, constraints };
  });
}

export function parseSchemaContract(bytes, path) {
  let text;
  let candidate;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.startsWith("\ufeff")) throw new Error("BOM forbidden");
    candidate = JSON.parse(text);
  } catch {
    reject("invalid-json", path, "expected UTF-8 JSON without BOM");
  }
  rejectDuplicateKeys(text, path);
  if (
    !exactKeys(candidate, candidate?.schema_version === 2 ? [...topKeys, "newTables"] : topKeys) || ![1, 2].includes(candidate.schema_version) ||
    !Array.isArray(candidate.coreTableNames) || candidate.coreTableNames.length === 0 ||
    !Array.isArray(candidate.normallyUpdateableTableNames) ||
    !Array.isArray(candidate.expectedAppendOnlyColumnUpdates) ||
    !candidate.coreTableNames.every((name) => typeof name === "string") ||
    !candidate.normallyUpdateableTableNames.every((name) => typeof name === "string") ||
    !candidate.expectedAppendOnlyColumnUpdates.every((row) =>
      exactKeys(row, rowKeys) && typeof row.tableName === "string" && typeof row.columnName === "string")
  ) {
    reject("shape", path, "expected exact version-1 declaration keys and types");
  }
  const { coreTableNames, normallyUpdateableTableNames, expectedAppendOnlyColumnUpdates } = candidate;
  const names = [
    ...coreTableNames,
    ...normallyUpdateableTableNames,
    ...expectedAppendOnlyColumnUpdates.flatMap(({ tableName, columnName }) => [tableName, columnName]),
  ];
  if (!names.every((name) => identifier.test(name))) {
    reject("invalid-identifier", path, "identifiers must be lowercase ASCII and at most 63 characters");
  }
  for (const elements of [coreTableNames, normallyUpdateableTableNames,
    expectedAppendOnlyColumnUpdates.map(({ tableName, columnName }) => `${tableName}.${columnName}`)]) {
    if (new Set(elements).size !== elements.length) {
      reject("duplicate-element", path, "table identifiers and column-update pairs must be unique");
    }
  }
  const core = new Set(coreTableNames);
  if (!normallyUpdateableTableNames.every((name) => core.has(name)) ||
    !expectedAppendOnlyColumnUpdates.every(({ tableName }) => core.has(tableName))) {
    reject("cross-reference", path, "update declarations must refer to core tables");
  }
  const canonical = {
    schema_version: candidate.schema_version,
    coreTableNames,
    normallyUpdateableTableNames,
    expectedAppendOnlyColumnUpdates: expectedAppendOnlyColumnUpdates.map(({ tableName, columnName }) => ({ tableName, columnName })),
  };
  if (candidate.schema_version === 2) canonical.newTables = extensionRows(candidate.newTables, path);
  if (text !== JSON.stringify(canonical, null, 2) + "\n") {
    reject("noncanonical", path, "expected ordered keys, two-space JSON, LF and final LF");
  }
  declarationPaths.set(candidate, path);
  return candidate;
}

export function attestSchemaContract(candidate) {
  const projection = candidate.schema_version === 2 ? {
    schema_version: 1,
    coreTableNames: candidate.coreTableNames,
    normallyUpdateableTableNames: candidate.normallyUpdateableTableNames,
    expectedAppendOnlyColumnUpdates: candidate.expectedAppendOnlyColumnUpdates,
  } : candidate;
  if (createHash("sha256").update(JSON.stringify(projection, null, 2) + "\n").digest("hex") !== ORIGINAL_BASELINE_SHA256) {
    reject("baseline-mismatch", declarationPaths.get(candidate) ?? "schema-contract", "declaration must equal the original ordered literal baseline");
  }
  if (candidate.schema_version === 2) {
    const newTables = extensionRows(candidate.newTables, declarationPaths.get(candidate) ?? "schema-contract");
    return { ...candidate,
      coreTableNames: [...candidate.coreTableNames, ...newTables.map(({ tableName }) => tableName)],
      normallyUpdateableTableNames: [...candidate.normallyUpdateableTableNames, ...newTables.map(({ tableName }) => tableName)],
      newTables,
    };
  }
  return candidate;
}
