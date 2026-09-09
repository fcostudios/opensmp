import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: () => ({
    auth: async () => null,
    handlers: { GET: () => undefined, POST: () => undefined },
    signIn: () => undefined,
    signOut: () => undefined,
  }),
}));
vi.mock("next-auth/providers/keycloak", () => ({ default: () => ({}) }));

import { retryProvisioningLabels } from "./page";

describe("US-065 request-detail retry wiring", () => {
  it("binds the protected retry action and localized pending label to RequestRecord", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { retryProvisioning } from "@/modules/request-workflow/actions/retry-provisioning";');
    expect(source).toContain("retryAction={retryProvisioning}");
    expect(retryProvisioningLabels((key) => `translated:${key}`)).toEqual({
      retryProvisioning: "translated:retryProvisioning",
      retryingProvisioning: "translated:retryingProvisioning",
    });
  });
});
