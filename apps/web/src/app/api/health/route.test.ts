import { describe, expect, it } from "vitest";

import { createHealthResponse } from "./health";

describe("GET /api/health", () => {
  it("returns the exact non-secret reachable response after the database check succeeds", async () => {
    const response = await createHealthResponse(async () => undefined);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "reachable",
    });
  });

  it("returns 503 without database details when the database check fails", async () => {
    const response = await createHealthResponse(async () => {
      throw new Error("connection refused");
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
