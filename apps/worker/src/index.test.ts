import { describe, expect, it } from "vitest";

import {
  createEcuadorBusinessCalendar,
  createWorkerConnectionString,
} from "./index";

describe("worker lifecycle", () => {
  it("encodes libpq environment variables into a pg-boss connection string without exposing raw credentials", () => {
    const original = {
      PGDATABASE: process.env.PGDATABASE,
      PGHOST: process.env.PGHOST,
      PGPASSWORD: process.env.PGPASSWORD,
      PGPORT: process.env.PGPORT,
      PGUSER: process.env.PGUSER,
    };
    process.env.PGHOST = "postgres";
    process.env.PGPORT = "5432";
    process.env.PGUSER = "ledger_app";
    process.env.PGPASSWORD = "reserved:chars@are/fine";
    process.env.PGDATABASE = "ledger";

    try {
      const connectionString = createWorkerConnectionString();

      expect(connectionString).not.toContain("reserved:chars@are/fine");
      expect(new URL(connectionString)).toMatchObject({
        hostname: "postgres",
        password: "reserved%3Achars%40are%2Ffine",
        pathname: "/ledger",
        port: "5432",
        username: "ledger_app",
      });
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("loads the configured mainland-Ecuador holiday calendar for the close precheck", () => {
    expect(createEcuadorBusinessCalendar("2026-08-03, 2026-10-09").holidays).toEqual(
      new Set(["2026-08-03", "2026-10-09"]),
    );
    expect(() => createEcuadorBusinessCalendar("2026-8-3")).toThrow("YYYY-MM-DD");
  });

  it("fails worker startup closed when the close-precheck holiday calendar is not configured", () => {
    expect(() => createEcuadorBusinessCalendar("")).toThrow("ECUADOR_HOLIDAYS is required");
  });
});
