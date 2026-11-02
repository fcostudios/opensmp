import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { expect, test } from "vitest";
import * as schema from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const inventory = JSON.parse(readFileSync(resolve(root, "testing/company-isolation.json"), "utf8")) as {
  seams: Record<string, string[]>;
  tables: Record<string, {ownership?: string; global?: string; suites: string[]}>;
};

test("US-047 every schema table has an explicit ownership decision and company columns cannot be exempted", () => {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is Table => is(value, Table));
  expect(Object.keys(inventory.tables).sort()).toEqual(tables.map(getTableName).sort());
  for (const table of tables) {
    const name = getTableName(table);
    const entry = inventory.tables[name]!;
    if ("companyId" in getTableColumns(table) || name === "company") {
      expect(entry.ownership, name).toBeTruthy();
      expect(entry.global, name).toBeUndefined();
    }
    if (entry.ownership) {
      expect(entry.suites.length, name).toBeGreaterThan(0);
      for (const suite of entry.suites) expect(inventory.seams[suite]?.length, `${name}: ${suite}`).toBeGreaterThan(0);
    } else expect(entry.global, name).toBeTruthy();
  }
});

test("US-047 enrolled oracles are real integration tests and include finance and signed-session seams", () => {
  const files = [...new Set(Object.values(inventory.seams).flat())];
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    expect(source, file).toMatch(/expect\(/);
    expect(file).toMatch(/(?:integration\.test\.(?:ts|tsx)|integrity\/register-integrity\.test\.ts|identity-access\/authorization\.test\.ts)$/);
  }
  for (const surface of ["statements/list-repository", "statements/repository", "statements/export", "close/rollup", "estados-de-cuenta/[statementId]/page", "cierre/page"]) {
    expect(files.some(file => file.includes(surface)), surface).toBe(true);
  }
  // The PDF download owns separate queries and an audit write. Keep its real
  // query-path and signed-session oracles enrolled in the required suite.
  expect(inventory.seams["statement-pdf-export"]).toEqual([
    "apps/web/src/modules/statements/export.integration.test.ts",
    "apps/web/src/app/(authenticated)/estados-de-cuenta/[statementId]/page.integration.test.tsx",
  ]);
  for (const table of ["company", "statement", "statement_line", "audit_log"]) {
    expect(inventory.tables[table].suites, table).toContain("statement-pdf-export");
  }
});
