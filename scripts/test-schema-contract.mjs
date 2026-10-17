import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(root, "packages/db/schema-contract.json");
// Hand-checked original ordered privilege declaration; changes must still be
// rejected by the real release consumer; this independent test oracle is not
// another runtime declaration source.
const baseline = {
  schema_version: 1,
  coreTableNames: [
    "activity_record", "alert_event", "alert_notification_delivery", "alert_rule",
    "audit_log", "close_run", "capacity_recovery_work", "company",
    "company_role_assignment", "connector_call_observation", "cost_record",
    "integration_credential", "identity_provider_operation", "license_assignment",
    "license_request", "license_type", "lifecycle_notification",
    "lifecycle_notification_delivery", "member_observation", "person",
    "provisioning_action", "rate_card", "reclamation_proposal", "reconciliation",
    "reconciliation_variance_line", "request_transition", "statement",
    "statement_line", "system_setting", "user_account", "vendor", "vendor_account",
    "vendor_account_capacity",
  ],
  normallyUpdateableTableNames: [
    "alert_rule", "capacity_recovery_work", "close_run", "company",
    "company_role_assignment", "integration_credential", "identity_provider_operation",
    "license_request", "license_type", "person", "reclamation_proposal",
    "reconciliation", "statement", "system_setting", "user_account", "vendor",
    "vendor_account",
  ],
  expectedAppendOnlyColumnUpdates: [
    { tableName: "activity_record", columnName: "counters" },
    { tableName: "activity_record", columnName: "raw_payload" },
    { tableName: "activity_record", columnName: "source" },
    { tableName: "activity_record", columnName: "synced_at" },
    { tableName: "cost_record", columnName: "amount_usd" },
    { tableName: "cost_record", columnName: "raw_payload" },
    { tableName: "cost_record", columnName: "source" },
    { tableName: "cost_record", columnName: "synced_at" },
    { tableName: "alert_event", columnName: "acknowledged_at" },
    { tableName: "alert_event", columnName: "acknowledged_by" },
    { tableName: "license_assignment", columnName: "end_reason" },
    { tableName: "license_assignment", columnName: "ended_on" },
    { tableName: "provisioning_action", columnName: "failure_reason" },
    { tableName: "provisioning_action", columnName: "raw_response" },
    { tableName: "provisioning_action", columnName: "resolved_at" },
    { tableName: "provisioning_action", columnName: "sent_at" },
    { tableName: "provisioning_action", columnName: "status" },
    { tableName: "provisioning_action", columnName: "vendor_ref" },
  ],
};
const predicate = { template: "account-reference-exists-v1", columnName: "vendor_account_id", referencedTable: "vendor_account", referencedColumn: "id" };
const extension = {
  tableName: "drift_episode", profile: "drift-episode-v1", mutable: true,
  rls: { enabled: true, forced: false },
  policies: [
    { name: "drift_episode_select", command: "SELECT", role: "ledger_app", using: predicate, withCheck: null },
    { name: "drift_episode_insert", command: "INSERT", role: "ledger_app", using: null, withCheck: predicate },
    { name: "drift_episode_update", command: "UPDATE", role: "ledger_app", using: predicate, withCheck: predicate },
  ],
  constraints: [
    { name: "drift_episode_pkey", kind: "PRIMARY_KEY", columns: ["id"] },
    { name: "drift_episode_vendor_account_id_fkey", kind: "FOREIGN_KEY", columns: ["vendor_account_id"], referencedTable: "vendor_account", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_license_type_id_fkey", kind: "FOREIGN_KEY", columns: ["license_type_id"], referencedTable: "license_type", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_person_id_fkey", kind: "FOREIGN_KEY", columns: ["person_id"], referencedTable: "person", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_resolved_by_assignment_id_fkey", kind: "FOREIGN_KEY", columns: ["resolved_by_assignment_id"], referencedTable: "license_assignment", referencedColumns: ["id"], onUpdate: "NO_ACTION", onDelete: "NO_ACTION" },
    { name: "drift_episode_resolved_by_assignment_id_key", kind: "UNIQUE", columns: ["resolved_by_assignment_id"] },
    { name: "drift_episode_open", kind: "UNIQUE_OPEN", columns: ["vendor_account_id", "member_identity", "license_type_id"], nullColumn: "resolved_at" },
  ],
};
const version2 = { ...structuredClone(baseline), schema_version: 2, newTables: [extension] };

const canonical = (value) => JSON.stringify(value, null, 2) + "\n";
const bytes = canonical(baseline);
const changed = (mutate) => {
  const value = structuredClone(baseline);
  mutate(value);
  return canonical(value);
};
const failures = [
  ["invalid UTF-8", Buffer.from([0xc3, 0x28]), "invalid-json"],
  ["BOM", "\ufeff" + bytes, "invalid-json"],
  ["malformed JSON", bytes + "!", "invalid-json"],
  ["syntax before duplicate", '{"a":1,"a":2,}', "invalid-json"],
  ["duplicate key", bytes.replace('"schema_version": 1,', '"schema_version": 1, "schema_version": 1,'), "duplicate-key"],
  ["escaped duplicate alias", bytes.replace('"schema_version": 1,', '"schema_version": 1, "schema_\\u0076ersion": 1,'), "duplicate-key"],
  ["nested decoded duplicate", bytes.replace('"columnName": "counters"', '"columnName": "counters", "column\\u004eame": "source"'), "duplicate-key"],
  ["duplicate before unknown", '{"unknown":1,"unknown":2}', "duplicate-key"],
  ["deep unknown shape", '{"unknown":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + '}', "shape"],
  ["deep decoded duplicate before shape", '{"unknown":' + '['.repeat(10000) + '{"key":1,"\\u006bey":2}' + ']'.repeat(10000) + '}', "duplicate-key"],
  ["unknown top key", changed((v) => { v.extra = 1; }), "shape"],
  ["missing top key", changed((v) => { delete v.coreTableNames; }), "shape"],
  ["wrong version", changed((v) => { v.schema_version = 2; }), "shape"],
  ["string version", changed((v) => { v.schema_version = "1"; }), "shape"],
  ["nonobject root", "[]\n", "shape"],
  ["null root", "null\n", "shape"],
  ["wrong array", changed((v) => { v.coreTableNames = {}; }), "shape"],
  ["empty core", changed((v) => { v.coreTableNames = []; }), "shape"],
  ["wrong identifier type", changed((v) => { v.coreTableNames[0] = 1; }), "shape"],
  ["unknown row key", changed((v) => { v.expectedAppendOnlyColumnUpdates[0].grant = "DELETE"; }), "shape"],
  ["missing row key", changed((v) => { delete v.expectedAppendOnlyColumnUpdates[0].columnName; }), "shape"],
  ["null row", changed((v) => { v.expectedAppendOnlyColumnUpdates[0] = null; }), "shape"],
  ...["public.activity_record", "activity_record; DROP TABLE company", "UPPER", "a".repeat(64), "é", "_table", "a b", "./module.mjs"].map((name) => [
    `unsafe identifier ${name}`, changed((v) => { v.coreTableNames[0] = name; }), "invalid-identifier",
  ]),
  ["unsafe column", changed((v) => { v.expectedAppendOnlyColumnUpdates[0].columnName = "Bad"; }), "invalid-identifier"],
  ["duplicate core", changed((v) => { v.coreTableNames.push(v.coreTableNames[0]); }), "duplicate-element"],
  ["duplicate updateable", changed((v) => { v.normallyUpdateableTableNames.push(v.normallyUpdateableTableNames[0]); }), "duplicate-element"],
  ["duplicate pair", changed((v) => { v.expectedAppendOnlyColumnUpdates.push(v.expectedAppendOnlyColumnUpdates[0]); }), "duplicate-element"],
  ["updateable cross-reference", changed((v) => { v.normallyUpdateableTableNames[0] = "unknown_table"; }), "cross-reference"],
  ["column cross-reference", changed((v) => { v.expectedAppendOnlyColumnUpdates[0].tableName = "unknown_table"; }), "cross-reference"],
  ["identifier before formatting", changed((v) => { v.coreTableNames[0] = "Bad"; }).trim(), "invalid-identifier"],
  ["CRLF", bytes.replaceAll("\n", "\r\n"), "noncanonical"],
  ["no final LF", bytes.trimEnd(), "noncanonical"],
  ["compact", JSON.stringify(baseline) + "\n", "noncanonical"],
  ["escaped ASCII", bytes.replace('"activity_record"', '"activity_\\u0072ecord"'), "noncanonical"],
  ["top key order", canonical({ coreTableNames: baseline.coreTableNames, schema_version: 1, normallyUpdateableTableNames: baseline.normallyUpdateableTableNames, expectedAppendOnlyColumnUpdates: baseline.expectedAppendOnlyColumnUpdates }), "noncanonical"],
  ["row key order", changed((v) => { v.expectedAppendOnlyColumnUpdates[0] = { columnName: "counters", tableName: "activity_record" }; }), "noncanonical"],
  ["core array order", changed((v) => { [v.coreTableNames[0], v.coreTableNames[1]] = [v.coreTableNames[1], v.coreTableNames[0]]; }), "baseline-mismatch"],
  ["updateable array order", changed((v) => { v.normallyUpdateableTableNames.reverse(); }), "baseline-mismatch"],
  ["row order", changed((v) => { v.expectedAppendOnlyColumnUpdates.reverse(); }), "baseline-mismatch"],
  ["changed column", changed((v) => { v.expectedAppendOnlyColumnUpdates[0].columnName = "wrong_column"; }), "baseline-mismatch"],
  ["changed table", changed((v) => { v.coreTableNames.push("new_table"); }), "baseline-mismatch"],
];

const v2Faults = [
  ["extra descriptor", v => { v.newTables[0].sql = "SELECT 1"; }, "shape"],
  ["extra rls field", v => { v.newTables[0].rls.owner = "ledger_app"; }, "shape"],
  ["wrong table", v => { v.newTables[0].tableName = "company"; }, "profile"],
  ["duplicate extension", v => { v.newTables.push(v.newTables[0]); }, "profile"],
  ["unknown profile", v => { v.newTables[0].profile = "./arbitrary.mjs"; }, "profile"],
  ["immutable new table", v => { v.newTables[0].mutable = false; }, "profile"],
  ["forced declaration", v => { v.newTables[0].rls.forced = true; }, "profile"],
  ["missing policy", v => { v.newTables[0].policies.pop(); }, "profile"],
  ["policy role", v => { v.newTables[0].policies[0].role = "public"; }, "profile"],
  ["policy command", v => { v.newTables[0].policies[0].command = "ALL"; }, "profile"],
  ["predicate capability", v => { v.newTables[0].policies[0].using.template = "raw-sql"; }, "profile"],
  ["wrong predicate argument", v => { v.newTables[0].policies[0].using.referencedTable = "company"; }, "profile"],
  ["predicate null branch", v => { v.newTables[0].policies[1].using = predicate; }, "profile"],
  ["unsafe policy identifier", v => { v.newTables[0].policies[0].name = "a;SELECT"; }, "invalid-identifier"],
  ["duplicate names", v => { v.newTables[0].policies[1].name = v.newTables[0].policies[0].name; }, "duplicate-element"],
  ["missing constraint", v => { v.newTables[0].constraints.pop(); }, "profile"],
  ["wrong key order", v => { v.newTables[0].constraints[6].columns.reverse(); }, "profile"],
  ["FK action", v => { v.newTables[0].constraints[1].onDelete = "CASCADE"; }, "profile"],
  ["FK reference", v => { v.newTables[0].constraints[1].referencedTable = "company"; }, "profile"],
  ["unknown constraint", v => { v.newTables[0].constraints[0].kind = "CHECK"; }, "shape"],
  ["extra predicate", v => { v.newTables[0].constraints[6].where = "true"; }, "shape"],
  ["wrong null column", v => { v.newTables[0].constraints[6].nullColumn = "id"; }, "profile"],
  ["old prefix changed", v => { v.coreTableNames.reverse(); }, "baseline-mismatch"],
  ["nested order", v => { v.newTables[0].rls = { forced: false, enabled: true }; }, "noncanonical"],
].map(([label, mutate, category]) => { const v = structuredClone(version2); mutate(v); return [label, canonical(v), category]; });
v2Faults.push(["nested decoded alias", canonical(version2).replace('"enabled": true,', '"enabled": true, "enab\\u006ced": true,'), "duplicate-key"]);

// Missing invocation, wrong fixed path, or late-only validation must fail these
// actual process oracles before the verifier can report catalog success.
const fixture = await realpath(await mkdtemp(resolve(tmpdir(), "schema-contract-process-")));
try {
  await mkdir(resolve(fixture, "scripts"));
  await cp(resolve(root, "packages/db/scripts"), resolve(fixture, "scripts"), { recursive: true });
  await symlink(resolve(root, "packages/db/node_modules"), resolve(fixture, "node_modules"));
  const fixedPath = resolve(fixture, "schema-contract.json");
  await writeFile(resolve(fixture, "alternate.json"), bytes);
  const run = () => spawnSync(process.execPath, [resolve(fixture, "scripts/verify-schema.mjs")], {
    cwd: fixture, encoding: "utf8",
    env: { ...process.env, DATABASE_ADMIN_URL: "", DATABASE_URL: "", SCHEMA_CONTRACT_PATH: resolve(fixture, "alternate.json") },
  });
  function rejectedProcess(category, label) {
    const result = run();
    assert.equal(result.status, 1, label);
    assert.ok(result.stderr.includes(`schema-contract/${category}`), `${label}: ${result.stderr}`);
    assert.ok(result.stderr.includes(fixedPath), `${label}: diagnostic must identify fixed path`);
    assert.equal(result.stdout.includes("committed migration checksum(s) verified"), false, label);
    assert.equal(result.stdout.includes("exact least-privilege runtime grant matrix"), false, label);
  }
  rejectedProcess("missing", "missing fixed declaration");
  for (const [label, input, category] of failures) {
    await writeFile(fixedPath, input);
    rejectedProcess(category, label);
  }
  await writeFile(fixedPath, bytes);
  const valid = run();
  assert.equal(valid.status, 1);
  assert.match(valid.stderr, /DATABASE_ADMIN_URL is required/);
  assert.equal(valid.stderr.includes("schema-contract/"), false);

  await writeFile(fixedPath, canonical(version2));
  const v2process = run();
  assert.equal(v2process.status, 1);
  assert.match(v2process.stderr, /DATABASE_ADMIN_URL is required/, "version2 reaches actual production entrypoint after pure validation");
  assert.equal(v2process.stderr.includes("schema-contract/"), false);
  for (const [label, input, category] of v2Faults) {
    await writeFile(fixedPath, input);
    rejectedProcess(category, "version2 " + label);
  }
  await writeFile(fixedPath, bytes);

  // A deliberate returned-data fault in the real copied helper must be
  // observed by the actual consumer before any database connection. Keeping
  // runtime literal arrays while merely invoking attestation cannot pass.
  const policyPath = resolve(fixture, "scripts/schema-contract-policy.mjs");
  const policySource = await readFile(policyPath, "utf8");
  await writeFile(policyPath, policySource.replace(
    "export function attestSchemaContract(", "function originalAttestSchemaContract(",
  ) + `\nexport function attestSchemaContract(candidate, ...legacyBaseline) {
    originalAttestSchemaContract(candidate, ...legacyBaseline);
    return { ...candidate, get coreTableNames() { throw new Error("CHG101-attested-data-consumed"); } };
  }\n`);
  const consumed = run();
  assert.equal(consumed.status, 1);
  assert.match(consumed.stderr, /CHG101-attested-data-consumed/u);
  assert.equal(consumed.stderr.includes("DATABASE_ADMIN_URL is required"), false);
  assert.equal(consumed.stdout, "");
} finally {
  await rm(fixture, { recursive: true, force: true });
}

const { parseSchemaContract, attestSchemaContract } = await import("../packages/db/scripts/schema-contract-policy.mjs");
const actualBytes = await readFile(contractPath);
assert.equal(actualBytes.toString("utf8"), bytes, "shipped declaration preserves the original ordered baseline");
const declaration = parseSchemaContract(actualBytes, contractPath);
assert.deepEqual(declaration, baseline);
assert.equal(declaration.coreTableNames.length, 33);
assert.equal(attestSchemaContract(declaration), declaration, "attestation returns the same parsed declaration for consumption");
const selfApproved = parseSchemaContract(Buffer.from(changed(value => { value.coreTableNames.push("new_table"); })), contractPath);
assert.throws(() => attestSchemaContract(selfApproved, selfApproved), error => {
  assert.equal(error.category, "baseline-mismatch");
  assert.equal(error.path, contractPath);
  return true;
}, "a caller-supplied matching baseline cannot grant new declaration authority");
for (const [label, input, category] of failures) {
  assert.throws(() => {
    const candidate = parseSchemaContract(Buffer.from(input), contractPath);
    attestSchemaContract(candidate);
  }, (error) => {
    assert.equal(error.category, category, label);
    assert.equal(error.path, contractPath, label);
    assert.ok(error.message.includes(`schema-contract/${category}`), label);
    assert.ok(error.message.includes(contractPath), label);
    return true;
  }, label);
}
const v2parsed = parseSchemaContract(Buffer.from(canonical(version2)), contractPath);
const effective = attestSchemaContract(v2parsed);
assert.deepEqual(effective.coreTableNames, [...baseline.coreTableNames, "drift_episode"]);
assert.deepEqual(effective.normallyUpdateableTableNames, [...baseline.normallyUpdateableTableNames, "drift_episode"]);
assert.deepEqual(effective.expectedAppendOnlyColumnUpdates, baseline.expectedAppendOnlyColumnUpdates);
assert.deepEqual(v2parsed, version2, "effective derivation never mutates the baseline projection");
const empty2 = { ...structuredClone(baseline), schema_version: 2, newTables: [] };
assert.deepEqual(attestSchemaContract(parseSchemaContract(Buffer.from(canonical(empty2)), contractPath)).coreTableNames, baseline.coreTableNames);
for (const [label, input, category] of v2Faults) {
  assert.throws(() => attestSchemaContract(parseSchemaContract(Buffer.from(input), contractPath)), error => error.category === category && error.path === contractPath, "version2 " + label);
}
console.log(`schema contract: ${failures.length} categorized faults rejected by parser and real verifier; exact 33-table baseline admitted`);
