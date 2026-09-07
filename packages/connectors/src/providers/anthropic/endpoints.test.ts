import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnthropicEndpoint } from "./endpoints.js";

type EndpointModule = typeof import("./endpoints.js");

let endpointPolicy: EndpointModule["endpointPolicy"];
let anthropicFailureRetryable: EndpointModule["anthropicFailureRetryable"];

describe("Anthropic endpoint policy", () => {
  beforeEach(async () => {
    // Stryker activates static mutants after collection; reload policy constants under that mutant.
    vi.resetModules();
    ({ endpointPolicy, anthropicFailureRetryable } = await import("./endpoints.js"));
  });

  it.each([
    [false, "rate_limited", false],
    [true, "rate_limited", true],
    [true, "provider_error", true],
    [true, "transport_ambiguous", true],
    [true, "client_error", false],
  ] as const)(
    "classifies retry safety=%s and failure=%s as retryable=%s",
    (retrySafe, classification, expected) => {
      expect(anthropicFailureRetryable({ retrySafe }, classification)).toBe(expected);
    },
  );

  it.each([
    ["organization", "GET", "/v1/organizations/me", "admin_scoped", ["user_management"], true],
    ["members", "GET", "/v1/organizations/users", "admin_scoped", ["user_management"], true],
    ["invites", "GET", "/v1/organizations/invites", "admin_scoped", ["user_management"], true],
    ["create_invite", "POST", "/v1/organizations/invites", "admin_scoped", ["user_management", "invite_create"], false],
    ["delete_invite", "DELETE", "/v1/organizations/invites/invite%2F1", "admin_scoped", ["user_management"], true],
    ["delete_member", "DELETE", "/v1/organizations/users/invite%2F1", "admin_scoped", ["user_management"], true],
    ["analytics_users", "GET", "/v1/organizations/analytics/users", "analytics", ["analytics"], true],
    ["analytics_summaries", "GET", "/v1/organizations/analytics/summaries", "analytics", ["analytics"], true],
    ["usage_report", "GET", "/v1/organizations/analytics/usage_report", "analytics", ["analytics"], true],
    ["user_usage_report", "GET", "/v1/organizations/analytics/user_usage_report", "analytics", ["analytics"], true],
    ["cost_report", "GET", "/v1/organizations/analytics/cost_report", "analytics", ["analytics"], true],
    ["user_cost_report", "GET", "/v1/organizations/analytics/user_cost_report", "analytics", ["analytics"], true],
  ] as const)("binds %s to its complete wire policy", (endpoint, method, path, credentialKind, budgets, retrySafe) => {
    const parameters = endpoint === "delete_invite" || endpoint === "delete_member"
      ? { resourceId: "invite/1" }
      : undefined;
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

  it.each([
    ["delete_invite", "/v1/organizations/invites/..%2Finvite"],
    ["delete_member", "/v1/organizations/users/..%2Finvite"],
  ] as const)("requires and encodes the %s target as one path segment", (endpoint, path) => {
    // Mutations killed: accepting blank IDs or omitting encoding changes the request target.
    expect(() => endpointPolicy(endpoint)).toThrow("resourceId");
    expect(() => endpointPolicy(endpoint, { resourceId: "   " })).toThrow("resourceId");
    expect(endpointPolicy(endpoint, { resourceId: "../invite" }).path).toBe(path);
  });

  it.each(["delete_invite", "delete_member"] as const)(
    "rejects dot-only %s targets before URL construction",
    (endpoint) => {
      // Mutations killed: accepting either normalized dot segment lets URL erase the target path.
      for (const resourceId of [".", "..", " . ", "\t..\n"]) {
        expect(() => endpointPolicy(endpoint, { resourceId })).toThrow("resourceId");
      }
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
