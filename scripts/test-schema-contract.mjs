import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(root, "packages/db/schema-contract.json");
// Hand-checked original ordered privilege declaration; changes must still be
// rejected by the real release consumer while the literals remain authority.
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
} finally {
  await rm(fixture, { recursive: true, force: true });
}

const { parseSchemaContract, attestSchemaContract } = await import("../packages/db/scripts/schema-contract-policy.mjs");
const actualBytes = await readFile(contractPath);
assert.equal(actualBytes.toString("utf8"), bytes, "shipped declaration preserves the original ordered baseline");
const declaration = parseSchemaContract(actualBytes, contractPath);
assert.deepEqual(declaration, baseline);
assert.equal(declaration.coreTableNames.length, 33);
attestSchemaContract(declaration, baseline);
for (const [label, input, category] of failures) {
  assert.throws(() => {
    const candidate = parseSchemaContract(Buffer.from(input), contractPath);
    attestSchemaContract(candidate, baseline);
  }, (error) => {
    assert.equal(error.category, category, label);
    assert.equal(error.path, contractPath, label);
    assert.ok(error.message.includes(`schema-contract/${category}`), label);
    assert.ok(error.message.includes(contractPath), label);
    return true;
  }, label);
}
console.log(`schema contract: ${failures.length} categorized faults rejected by parser and real verifier; exact 33-table baseline admitted`);
