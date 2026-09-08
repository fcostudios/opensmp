import { describe, expect, it } from "vitest";

import * as composition from "./connector-composition.js";

describe("worker provider composition seam", () => {
  it("registers the shipped REST capabilities for dependency-free planning", () => {
    // Mutations killed: removing the factory body or REST registration leaves
    // recovery planning without an automated invitation capability.
    const dispatcher = composition.createProvisioningPlanningDispatcher();

    expect([...dispatcher.forProtocol("rest").capabilities()]).toEqual([
      "provision",
      "deprovision",
      "syncMembers",
      "syncActivity",
      "syncCost",
    ]);
    expect([...dispatcher.forProtocol("none").capabilities()]).toEqual([]);
  });

  it("allows capability-only construction but rejects execution without runtime dependencies", async () => {
    // Mutation killed: missing execution guard leaks a TypeError or permits an unconfigured call.
    const connector = composition.createProvisioningConnector();
    expect(connector.capabilities().has("provision")).toBe(true);
    await expect(connector.provision({
      requestId: "23100000-0000-4000-8000-000000000001",
      vendorAccountId: "23100000-0000-4000-8000-000000000002",
      personEmail: "member@example.test",
      licenseTypeName: "Seat",
    })).rejects.toThrow("ANTHROPIC_EXECUTION_NOT_CONFIGURED");
  });
});
