import { describe, expect, it, vi } from "vitest";

describe("connector call closed vocabularies", () => {
  it.each([
    [
      "operations",
      "connectorOperations",
      ["provision", "deprovision", "sync_members", "sync_activity", "sync_cost"],
    ],
    [
      "phases",
      "connectorCallPhases",
      ["requested", "succeeded", "failed"],
    ],
    [
      "classifications",
      "connectorCallClassifications",
      ["success", "rate_limited", "provider_error", "client_error"],
    ],
    [
      "endpoint classes",
      "connectorEndpointClasses",
      ["organization", "members", "invitations", "activity", "usage", "cost"],
    ],
  ] as const)("exports exact immutable connector %s", async (_label, exportName, expected) => {
    vi.resetModules();
    const actual = (await import("./contracts.js"))[exportName];

    expect(actual).toEqual(expected);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(() => (actual as unknown as string[]).push("unknown")).toThrow(TypeError);
    expect(actual).toEqual(expected);
  });
});
