import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("US-023 exceptions page composition contract", () => {
  it("passes capacity identity and localized action labels to blocked requests", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("vendorAccountId: request.vendorAccountId");
    expect(source).toContain("licenseTypeId: request.licenseTypeId");
    expect(source).toContain('addCapacity: t("blocked.addCapacity")');
    expect(source).toContain('saveCapacity: t("blocked.saveCapacity")');
  });
});
