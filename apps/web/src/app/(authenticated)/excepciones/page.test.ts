import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("US-023 exceptions page wiring", () => {
  it("binds typed request and label composers to BlockedRequestsTable", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("blocked.items.map(toBlockedRequestItem)");
    expect(source).toContain("createBlockedRequestsLabels(t)");
    expect(source).toContain('from "./labels";');
  });

  it("binds US-065 retry feedback and the protected action to failed rows", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { retryProvisioning } from "@/modules/request-workflow/actions/retry-provisioning";');
    expect(source).toContain('retryAction={retryProvisioning}');
    expect(source).toContain('role="alert"');
    expect(source).toContain('orchestration(query.retryError === "conflict" ? "retryConflict" : "retryInvalid")');
  });
});
