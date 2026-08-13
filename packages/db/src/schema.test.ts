import { describe, expect, test } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { capacityRecoveryWork, vendor, vendorAccount } from "./schema.js";

const dialect = new PgDialect();

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
