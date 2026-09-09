import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("exports one async audited retry action with post-audit navigation", async () => {
  const source = await readFile(new URL("./retry-provisioning.ts", import.meta.url), "utf8");

  expect(source).toContain('"use server"');
  expect(source).toContain("export async function retryProvisioning(input: FormData)");
  expect(source).toContain("retryProvisioningActionService.retryProvisioning(input)");
  expect(source).toContain('if (result.error === "forbidden") forbidden()');
  expect(source).not.toContain("export function retryProvisioningFailureDestination");
});
