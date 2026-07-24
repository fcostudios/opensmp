import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let databaseUrl = "";
let stopDatabase: (() => Promise<void>) | undefined;
let originalDatabaseUrl: string | undefined;

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
    originalDatabaseUrl = process.env.DATABASE_URL;
    const database = await new PostgreSqlContainer("postgres:16-alpine").start();
    databaseUrl = `${database.getConnectionUri()}?connect_timeout=1`;
    stopDatabase = async () => {
      await database.stop();
    };
    process.env.DATABASE_URL = databaseUrl;
    process.env.DB_DRIVER = "pg";
  }, 15_000);

  afterAll(async () => {
    if (stopDatabase) await stopDatabase();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    delete process.env.DB_DRIVER;
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
