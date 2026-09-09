import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("US-065 request-detail retry wiring", () => {
  it("binds the protected retry action and localized pending label to RequestRecord", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { retryProvisioning } from "@/modules/request-workflow/actions/retry-provisioning";');
    expect(source).toContain("retryAction={retryProvisioning}");
  });
});
