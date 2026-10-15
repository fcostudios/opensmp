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
  function value() {
    whitespace();
    if (text[index] === "{") {
      index++;
      whitespace();
      const keys = new Set();
      while (text[index] !== "}") {
        const key = string();
        if (keys.has(key)) reject("duplicate-key", path, `repeated decoded key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        index++; // colon
        value();
        whitespace();
        if (text[index] !== ",") break;
        index++;
        whitespace();
      }
      index++;
    } else if (text[index] === "[") {
      index++;
      whitespace();
      while (text[index] !== "]") {
        value();
        whitespace();
        if (text[index] !== ",") break;
        index++;
      }
      index++;
    } else if (text[index] === '"') {
      string();
    } else {
      while (index < text.length && !/[\s,}\]]/.test(text[index])) index++;
    }
  }
  value();
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
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
    !exactKeys(candidate, topKeys) || candidate.schema_version !== 1 ||
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
    schema_version: 1,
    coreTableNames,
    normallyUpdateableTableNames,
    expectedAppendOnlyColumnUpdates: expectedAppendOnlyColumnUpdates.map(({ tableName, columnName }) => ({ tableName, columnName })),
  };
  if (text !== JSON.stringify(canonical, null, 2) + "\n") {
    reject("noncanonical", path, "expected ordered keys, two-space JSON, LF and final LF");
  }
  declarationPaths.set(candidate, path);
  return candidate;
}

export function attestSchemaContract(candidate, baseline) {
  if (JSON.stringify(candidate) !== JSON.stringify(baseline)) {
    reject("baseline-mismatch", declarationPaths.get(candidate) ?? "schema-contract", "declaration must equal the original ordered literal baseline");
  }
}
