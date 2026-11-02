import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import * as schema from "./schema";
import { createPostgresFixture } from "./testing/postgres-container";

test("Drizzle persists explicit contracted evidence and defaults manual rows to provisional", async () => {
  const fixture = await createPostgresFixture();
  await fixture.migrate();
  const app = await fixture.connectAsApp();
  const database = drizzle(app, { schema });
  const actor = "00000000-0000-0000-0000-000000000001";
  const createdAt = new Date("2026-11-01T00:00:00Z");
  try {
    const provisionalDefault = (await app.query(`SELECT pg_get_expr(d.adbin,d.adrelid) AS expression
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.rate_card'::regclass AND a.attname='provisional'`)).rows[0].expression;
    const migratedDefault = (await app.query(`SELECT (${provisionalDefault}) AS value`)).rows[0].value;
    expect(schema.rateCard.provisional.default).toBe(migratedDefault);
    const checks = getTableConfig(schema.rateCard).checks;
    const persisted = await app.query(`SELECT conname AS name, pg_get_expr(conbin,conrelid) AS expression
      FROM pg_constraint WHERE conrelid='public.rate_card'::regclass AND contype='c' ORDER BY conname`);
    expect(checks.map(constraint => constraint.name).sort()).toEqual(["rate_card_nonnegative", "rate_card_valid_period"]);
    expect(persisted.rows.map(row => row.name)).toEqual(["rate_card_nonnegative", "rate_card_valid_period"]);
    // Evaluate Drizzle's authored CHECK and the independently migrated CHECK on
    // the same boundary rows: catches wrong operators, missing checks or columns.
    for (const constraint of checks) {
      const metadataSql = new PgDialect().sqlToQuery(constraint.value).sql;
      const persistedSql = persisted.rows.find(row => row.name === constraint.name)!.expression;
      for (const [amount, from, to, nonnegative, validPeriod] of [
        ["-0.01", "2026-01-01", "2026-01-31", false, true],
        ["0", "2026-01-01", null, true, true],
        ["62", "2026-01-31", "2026-01-01", true, false],
        ["62", "2026-01-01", "2026-01-01", true, true],
      ] as const) {
        const expected = constraint.name === "rate_card_nonnegative" ? nonnegative : validPeriod;
        const result = await app.query(`WITH rate_card AS (SELECT $1::numeric AS monthly_rate_usd,
          $2::date AS effective_from,$3::date AS effective_to)
          SELECT (${metadataSql}) AS metadata, (${persistedSql}) AS persisted FROM rate_card`, [amount, from, to]);
        expect(result.rows).toEqual([{ metadata: expected, persisted: expected }]);
      }
    }
    const [vendor] = await database.insert(schema.vendor).values({ name: "Rate schema", connectorType: "manual", provisioningProtocol: "none", canProvision: false, canDeprovision: false, hasUsageData: false, hasCostData: false, identityMatching: "email", status: "active", createdAt, createdBy: actor }).returning();
    const [account] = await database.insert(schema.vendorAccount).values({ vendorId: vendor.id, name: "Rate org", mode: "orchestration", status: "active", lowPoolFloor: 0, createdAt, createdBy: actor }).returning();
    const [license] = await database.insert(schema.licenseType).values({ vendorId: vendor.id, name: "Seat", unit: "seat", status: "active", createdAt, createdBy: actor }).returning();
    const common = { vendorAccountId: account.id, licenseTypeId: license.id, monthlyRateUsd: "62.00", createdAt, createdBy: actor };
    await database.insert(schema.rateCard).values([
      { ...common, effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31", provisional: false },
      { ...common, effectiveFrom: "2026-02-01" },
    ]);
    const rows = await database.select().from(schema.rateCard).where(eq(schema.rateCard.vendorAccountId, account.id)).orderBy(schema.rateCard.effectiveFrom);
    expect(rows.map(row => row.provisional)).toEqual([false, true]);
    expect(rows.map(row => row.monthlyRateUsd)).toEqual(["62.00", "62.00"]);
    expect(rows.map(row => row.effectiveTo)).toEqual(["2026-01-31", null]);
  } finally { await app.end(); await fixture.stop(); }
}, 120_000);
