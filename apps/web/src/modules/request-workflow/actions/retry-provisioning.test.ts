import { expect, it } from "vitest";

import { retryProvisioningFailureDestination } from "./retry-provisioning";

it("maps retry failures to localized destinations and a real Next 403 interrupt", () => {
  expect(retryProvisioningFailureDestination("conflict"))
    .toBe("/excepciones?tab=failed&retryError=conflict");
  expect(retryProvisioningFailureDestination("invalid"))
    .toBe("/excepciones?tab=failed&retryError=invalid");
  const priorAuthInterrupts = process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS;
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
  let forbiddenError: unknown;
  try {
    retryProvisioningFailureDestination("forbidden");
  } catch (error) {
    forbiddenError = error;
  } finally {
    if (priorAuthInterrupts === undefined) {
      delete process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS;
    } else {
      process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = priorAuthInterrupts;
    }
  }
  expect(forbiddenError).toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    message: "NEXT_HTTP_ERROR_FALLBACK;403",
  });
});
