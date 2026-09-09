import { expect, it } from "vitest";

import { retryProvisioningLabels } from "./retry-labels";

it("maps both retry labels through the request translation boundary", () => {
  expect(retryProvisioningLabels((key) => `translated:${key}`)).toEqual({
    retryProvisioning: "translated:retryProvisioning",
    retryingProvisioning: "translated:retryingProvisioning",
  });
});
