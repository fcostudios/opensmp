import { describe, expect, it } from "vitest";

import * as composition from "./connector-composition.js";

describe("worker provider composition seam", () => {
  it("exports only the two provider-neutral construction aliases", () => {
    expect(Object.keys(composition).sort()).toEqual([
      "createProvisioningConnector",
      "createProvisioningRateLimiter",
    ]);
    expect(composition.createProvisioningConnector).toBeTypeOf("function");
    expect(composition.createProvisioningRateLimiter).toBeTypeOf("function");
  });
});
