import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("US-023 pools page composition contract", () => {
  it("passes every localized capacity-management label to PoolCards", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const key of [
      "addCapacity",
      "effectiveFrom",
      "effectiveFromField",
      "escalated",
      "noUsageData",
      "prorationNote",
      "purchasedQty",
      "saveCapacity",
    ]) {
      expect(source).toContain(`${key}: t(\"${key}\")`);
    }
  });
});
