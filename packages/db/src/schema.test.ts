import { describe, expect, test } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { capacityRecoveryWork, connectorCallObservation, vendor, vendorAccount } from "./schema.js";

const dialect = new PgDialect();

test("US-057 exposes the canonical journal persistence contract", () => {
  const config = getTableConfig(connectorCallObservation);
  expect(config.columns.map((column) => [column.name, column.getSQLType(), column.notNull, column.hasDefault])).toEqual([
    ["id", "uuid", true, true], ["vendor_account_id", "uuid", true, false],
    ["provisioning_action_id", "uuid", false, false], ["correlation_id", "uuid", true, false],
    ["operation", "connector_call_operation_enum", true, false], ["attempt", "integer", true, false],
    ["phase", "connector_call_phase_enum", true, false], ["classification", "text", false, false],
    ["summary", "jsonb", true, false], ["occurred_at", "timestamp with time zone", true, false],
  ]);
  expect(config.foreignKeys.map((key) => [key.reference().columns.map(({ name }) => name), getTableName(key.reference().foreignTable)])).toEqual([
    [["vendor_account_id"], "vendor_account"], [["provisioning_action_id"], "provisioning_action"],
  ]);
  expect(config.uniqueConstraints.map(({ columns, name }) => [name, columns.map((column) => column.name)])).toEqual([
    ["uq_connector_call_phase", ["correlation_id", "attempt", "phase"]],
  ]);
  const journalSql = (value: Parameters<typeof renderSql>[0]) => renderSql(value)
    .replaceAll('"connector_call_observation".', "").replaceAll('"', "").replace(/\s+/g, " ").trim();
  expect(config.checks.map(({ name, value }) => [name, journalSql(value)])).toEqual([
    ["connector_call_attempt_check", "attempt >= 1"],
    ["connector_call_summary_check", "jsonb_typeof(summary) = 'object'"],
    ["connector_call_classification_check", "(phase = 'requested' AND classification IS NULL) OR (phase = 'succeeded' AND classification IS NOT NULL AND classification = 'success') OR (phase = 'failed' AND classification IS NOT NULL AND classification IN ('rate_limited', 'provider_error', 'client_error'))"],
    ["connector_call_sync_action_check", "operation IN ('provision', 'deprovision') OR provisioning_action_id IS NULL"],
  ]);
  expect(config.indexes.map(({ config: index }) => [index.name,
    index.columns.map((column) => "name" in column ? column.name : undefined),
    index.unique, index.where ? journalSql(index.where) : null])).toEqual([
    ["uq_connector_call_terminal", ["correlation_id", "attempt"], true, "phase IN ('succeeded', 'failed')"],
    ["idx_connector_call_vendor_account", ["vendor_account_id"], false, null],
    ["idx_connector_call_action", ["provisioning_action_id"], false, null],
    ["idx_connector_call_correlation", ["correlation_id"], false, null],
    ["idx_connector_call_operation", ["operation"], false, null],
    ["idx_connector_call_occurred_at", ["occurred_at"], false, null],
  ]);
  expect(connectorCallObservation.operation.enumValues).toEqual(["provision", "deprovision", "sync_members", "sync_activity", "sync_cost"]);
  expect(connectorCallObservation.phase.enumValues).toEqual(["requested", "succeeded", "failed"]);
});

function renderSql(value: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return dialect.sqlToQuery(value).sql;
}

describe("US-023 capacity recovery Drizzle contract", () => {
  test("describes the durable recovery identity, lease, and XOR invariant exactly", () => {
    const config = getTableConfig(capacityRecoveryWork);

    expect(config.name).toBe("capacity_recovery_work");
    expect(
      config.columns.map((column) => ({
        hasDefault: column.hasDefault,
        name: column.name,
        notNull: column.notNull,
        type: column.getSQLType(),
      })),
    ).toEqual([
      { hasDefault: true, name: "id", notNull: true, type: "uuid" },
      { hasDefault: false, name: "idempotency_key", notNull: true, type: "text" },
      { hasDefault: false, name: "capacity_id", notNull: false, type: "uuid" },
      { hasDefault: false, name: "vendor_account_id", notNull: true, type: "uuid" },
      { hasDefault: false, name: "license_type_id", notNull: true, type: "uuid" },
      { hasDefault: false, name: "effective_from", notNull: true, type: "date" },
      { hasDefault: false, name: "available_at", notNull: true, type: "timestamp with time zone" },
      { hasDefault: false, name: "source", notNull: true, type: "text" },
      { hasDefault: true, name: "status", notNull: true, type: "text" },
      { hasDefault: true, name: "attempt_count", notNull: true, type: "integer" },
      { hasDefault: false, name: "lease_token", notNull: false, type: "uuid" },
      { hasDefault: false, name: "lease_expires_at", notNull: false, type: "timestamp with time zone" },
      { hasDefault: false, name: "last_error", notNull: false, type: "text" },
      { hasDefault: false, name: "completed_at", notNull: false, type: "timestamp with time zone" },
      { hasDefault: true, name: "created_at", notNull: true, type: "timestamp with time zone" },
      { hasDefault: false, name: "release_event_id", notNull: false, type: "uuid" },
    ]);
    expect(
      config.foreignKeys.map((foreignKey) => ({
        columns: foreignKey.reference().columns.map(({ name }) => name),
        foreignColumns: foreignKey.reference().foreignColumns.map(({ name }) => name),
        foreignTable: getTableName(foreignKey.reference().foreignTable),
      })),
    ).toEqual([
      { columns: ["capacity_id"], foreignColumns: ["id"], foreignTable: "vendor_account_capacity" },
      { columns: ["vendor_account_id"], foreignColumns: ["id"], foreignTable: "vendor_account" },
      { columns: ["license_type_id"], foreignColumns: ["id"], foreignTable: "license_type" },
    ]);
    const idempotencyKey = config.columns.find(({ name }) => name === "idempotency_key");
    expect(idempotencyKey?.isUnique).toBe(true);
    expect(idempotencyKey?.uniqueName).toBe("capacity_recovery_work_idempotency_key_unique");
    expect(config.checks.map(({ name, value }) => ({ name, sql: renderSql(value) }))).toEqual([
      {
        name: "capacity_recovery_identity_xor_check",
        sql: "(\n      (\"capacity_recovery_work\".\"source\" = 'seat_freed' AND \"capacity_recovery_work\".\"release_event_id\" IS NOT NULL AND \"capacity_recovery_work\".\"capacity_id\" IS NULL)\n      OR\n      (\"capacity_recovery_work\".\"source\" = 'capacity_change' AND \"capacity_recovery_work\".\"capacity_id\" IS NOT NULL AND \"capacity_recovery_work\".\"release_event_id\" IS NULL)\n    )",
      },
    ]);
  });
});

describe("US-025 vendor-account uniqueness Drizzle contract", () => {
  test("names vendors globally and vendor accounts within their vendor exactly once", () => {
    const vendorConfig = getTableConfig(vendor);
    const accountConfig = getTableConfig(vendorAccount);

    expect(
      vendorConfig.uniqueConstraints.map(({ columns, name }) => ({
        columns: columns.map((column) => column.name),
        name,
      })),
    ).toEqual([{ columns: ["name"], name: "uq_vendor_name" }]);
    expect(
      accountConfig.uniqueConstraints.map(({ columns, name }) => ({
        columns: columns.map((column) => column.name),
        name,
      })),
    ).toContainEqual({
      columns: ["vendor_id", "name"],
      name: "uq_vendor_account_vendor_id_name",
    });
  });
});
