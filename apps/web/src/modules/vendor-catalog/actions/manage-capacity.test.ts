import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("US-023 capacity server-action composition contract", () => {
  it("routes every entry point through the canonical CapacityService without company input", async () => {
    const source = await readFile(new URL("./manage-capacity.ts", import.meta.url), "utf8");
    expect(source).toContain("service.changeCapacity(authorization, actionInput(input, reason))");
    expect(source).toContain('await execute(input, "purchase")');
    expect(source).toContain('await execute(input, "correction")');
    expect(source).not.toContain('input.get("companyId")');
  });
});
