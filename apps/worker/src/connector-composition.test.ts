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

  it("constructs the membership poll connector from the supplied runtime boundary", async () => {
    // Mutations killed: an empty poll-composition factory hides a missing connector until a scheduled poll runs.
    const connector = composition.createMembershipPollingConnector({
      credentialsFor: async () => [],
      observationSessionFor: async () => {
        throw new Error("observation must not start without a configured request");
      },
      requestDependencies: {
        clock: { now: () => 0 },
        limiter: { acquire: async () => undefined },
        sleep: async () => undefined,
        transport: async () => new Response("{}", { status: 500 }),
      },
    });
    expect(connector.capabilities().has("syncMembers")).toBe(true);
    await expect(connector.syncMemberPage({
      vendorAccountId: "23100000-0000-4000-8000-000000000002",
      observedAt: new Date("2026-09-09T00:00:00.000Z"),
      cursor: null,
    })).rejects.toThrow("observation must not start without a configured request");
  });
});
