import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let stopDatabase: (() => Promise<void>) | undefined;
const pgEnvironmentKeys = ["DATABASE_URL", "DB_DRIVER", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;
const originalEnvironment = new Map<string, string | undefined>();

async function invokeHealthRoute() {
  vi.resetModules();
  const { GET } = await import("./route");
  const response = await GET();
  const { db } = await import("@smp/db");
  if ("end" in db.$client && typeof db.$client.end === "function") {
    await db.$client.end();
  }
  return response;
}

describe("GET /api/health", () => {
  beforeAll(async () => {
    for (const key of pgEnvironmentKeys) originalEnvironment.set(key, process.env[key]);
    // The shared fixture: the pinned PostgreSQL 16 image and its startup budget
    // (CHG-066), connected as the runtime ledger_app role. A private container,
    // because the 503 case stops the whole server (CHG-067).
    const database = await createPostgresFixture({ isolatedContainer: true });
    stopDatabase = () => database.stop();
    const appUrl = new URL(database.appUrl);
    delete process.env.DATABASE_URL;
    process.env.DB_DRIVER = "pg";
    process.env.PGHOST = appUrl.hostname;
    process.env.PGPORT = appUrl.port;
    process.env.PGUSER = decodeURIComponent(appUrl.username);
    process.env.PGPASSWORD = decodeURIComponent(appUrl.password);
    process.env.PGDATABASE = appUrl.pathname.slice(1);
  });

  afterAll(async () => {
    if (stopDatabase) await stopDatabase();
    for (const key of pgEnvironmentKeys) {
      const originalValue = originalEnvironment.get(key);
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
    }
  });

  it("returns the exact non-secret reachable response against PostgreSQL", async () => {
    const response = await invokeHealthRoute();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "reachable",
    });
  });

  it("returns 503 without database details after the real PostgreSQL endpoint stops", async () => {
    await stopDatabase?.();
    stopDatabase = undefined;
    const response = await invokeHealthRoute();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
