import { PostgreSqlContainer } from "@testcontainers/postgresql";
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
    const database = await new PostgreSqlContainer("postgres:16-alpine").start();
    stopDatabase = async () => {
      await database.stop();
    };
    delete process.env.DATABASE_URL;
    process.env.DB_DRIVER = "pg";
    process.env.PGHOST = database.getHost();
    process.env.PGPORT = String(database.getPort());
    process.env.PGUSER = database.getUsername();
    process.env.PGPASSWORD = database.getPassword();
    process.env.PGDATABASE = database.getDatabase();
  }, 15_000);

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
