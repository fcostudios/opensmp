import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnthropicEndpoint } from "./endpoints.js";

type EndpointModule = typeof import("./endpoints.js");

let endpointPolicy: EndpointModule["endpointPolicy"];

describe("Anthropic endpoint policy", () => {
  beforeEach(async () => {
    // Stryker activates static mutants after collection; reload policy constants under that mutant.
    vi.resetModules();
    ({ endpointPolicy } = await import("./endpoints.js"));
  });

  it.each([
    ["organization", "GET", "/v1/organizations/me", "admin_scoped", ["user_management"], true],
    ["members", "GET", "/v1/organizations/users", "admin_scoped", ["user_management"], true],
    ["invites", "GET", "/v1/organizations/invites", "admin_scoped", ["user_management"], true],
    ["create_invite", "POST", "/v1/organizations/invites", "admin_scoped", ["user_management", "invite_create"], false],
    ["delete_invite", "DELETE", "/v1/organizations/invites/invite%2F1", "admin_scoped", ["user_management"], true],
    ["analytics_users", "GET", "/v1/organizations/analytics/users", "analytics", ["analytics"], true],
    ["analytics_summaries", "GET", "/v1/organizations/analytics/summaries", "analytics", ["analytics"], true],
    ["usage_report", "GET", "/v1/organizations/analytics/usage_report", "analytics", ["analytics"], true],
    ["cost_report", "GET", "/v1/organizations/analytics/cost_report", "analytics", ["analytics"], true],
  ] as const)("binds %s to its complete wire policy", (endpoint, method, path, credentialKind, budgets, retrySafe) => {
    const parameters = endpoint === "delete_invite" ? { resourceId: "invite/1" } : undefined;
    expect(endpointPolicy(endpoint as AnthropicEndpoint, parameters)).toEqual({
      origin: "https://api.anthropic.com",
      method,
      path,
      anthropicVersion: "2023-06-01",
      requestMediaType: method === "POST" ? "application/json" : null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind,
      budgets,
      retrySafe,
    });
  });

  it("requires a nonblank delete target and encodes it as one path segment", () => {
    expect(() => endpointPolicy("delete_invite")).toThrow("resourceId");
    expect(() => endpointPolicy("delete_invite", { resourceId: "   " })).toThrow("resourceId");
    expect(endpointPolicy("delete_invite", { resourceId: "../invite" }).path)
      .toBe("/v1/organizations/invites/..%2Finvite");
  });

  it.each([".", "..", " . ", "\t..\n"])(
    "rejects the dot-only delete target %j before URL construction",
    (resourceId) => {
      // Mutations killed: accepting either normalized dot segment lets URL erase the target path.
      expect(() => endpointPolicy("delete_invite", { resourceId })).toThrow("resourceId");
    },
  );

  it("does not let caller parameters override the policy-owned wire values", () => {
    const policy = endpointPolicy("members", {
      resourceId: "ignored",
      origin: "https://attacker.example",
      method: "POST",
    } as never);

    expect(policy).toMatchObject({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/users",
      requestMediaType: null,
    });
  });

  it("returns independent immutable policy values", () => {
    const first = endpointPolicy("create_invite");
    const second = endpointPolicy("create_invite");

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.budgets)).toBe(true);
    expect(first).not.toBe(second);
    expect(first.budgets).not.toBe(second.budgets);
  });
});
