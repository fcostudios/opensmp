import { describe, expect, it } from "vitest";

import {
  AnthropicCredentialError,
  credentialForPolicy,
  resolveAnthropicCredentials,
  type AnthropicCredentialErrorCode,
} from "./credentials.js";
import { endpointPolicy } from "./endpoints.js";

const valid = [
  { vendorAccountId: "account-a", kind: "admin_scoped", secret: "admin-secret", status: "active", health: "ok" },
  { vendorAccountId: "account-a", kind: "analytics", secret: "analytics-secret", status: "active", health: "ok" },
] as const;

describe("Anthropic credential resolution", () => {
  it("resolves one active healthy credential for each required kind", () => {
    const resolved = resolveAnthropicCredentials(valid, "account-a");

    expect(resolved).toEqual({
      vendorAccountId: "account-a",
      admin: { kind: "admin_scoped", secret: "admin-secret" },
      analytics: { kind: "analytics", secret: "analytics-secret" },
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.admin)).toBe(true);
    expect(Object.isFrozen(resolved.analytics)).toBe(true);
  });

  it("selects a credential solely from the endpoint policy kind", () => {
    const resolved = resolveAnthropicCredentials(valid, "account-a");

    expect(credentialForPolicy(resolved, endpointPolicy("members"))).toEqual({
      kind: "admin_scoped",
      secret: "admin-secret",
    });
    expect(credentialForPolicy(resolved, endpointPolicy("cost_report"))).toEqual({
      kind: "analytics",
      secret: "analytics-secret",
    });
  });

  it.each([
    [
      "missing Admin",
      [{ vendorAccountId: "account-a", kind: "analytics", secret: "analytics-secret", status: "active", health: "ok" }],
      "account-a",
      "missing_credential",
      ["analytics-secret", "account-a"],
    ],
    [
      "missing Analytics",
      [{ vendorAccountId: "account-a", kind: "admin_scoped", secret: "admin-secret", status: "active", health: "ok" }],
      "account-a",
      "missing_credential",
      ["admin-secret", "account-a"],
    ],
    [
      "a blank secret without trimming it into acceptance",
      [
        { vendorAccountId: "account-a", kind: "admin_scoped", secret: "  \t", status: "active", health: "ok" },
        { vendorAccountId: "account-a", kind: "analytics", secret: "analytics-secret", status: "active", health: "ok" },
      ],
      "account-a",
      "blank_credential",
      ["analytics-secret", "account-a"],
    ],
    [
      "duplicate same-kind rows",
      [
        ...valid,
        { vendorAccountId: "account-a", kind: "admin_scoped", secret: "other-admin-secret", status: "active", health: "ok" },
      ],
      "account-a",
      "duplicate_credential",
      ["admin-secret", "analytics-secret", "other-admin-secret", "account-a"],
    ],
    [
      "identical cross-kind secrets",
      [
        { vendorAccountId: "account-a", kind: "admin_scoped", secret: "shared-secret", status: "active", health: "ok" },
        { vendorAccountId: "account-a", kind: "analytics", secret: "shared-secret", status: "active", health: "ok" },
      ],
      "account-a",
      "identical_credentials",
      ["shared-secret", "account-a"],
    ],
    [
      "retired credentials",
      [
        { vendorAccountId: "account-a", kind: "admin_scoped", secret: "admin-secret", status: "retired", health: "ok" },
        valid[1],
      ],
      "account-a",
      "inactive_credential",
      ["admin-secret", "analytics-secret", "account-a"],
    ],
    [
      "auth_failed credentials",
      [
        { vendorAccountId: "account-a", kind: "admin_scoped", secret: "admin-secret", status: "active", health: "auth_failed" },
        valid[1],
      ],
      "account-a",
      "unhealthy_credential",
      ["admin-secret", "analytics-secret", "account-a"],
    ],
    [
      "unverified credentials",
      [
        valid[0],
        { vendorAccountId: "account-a", kind: "analytics", secret: "analytics-secret", status: "active", health: "unverified" },
      ],
      "account-a",
      "unhealthy_credential",
      ["admin-secret", "analytics-secret", "account-a"],
    ],
    [
      "records for another vendor account",
      [
        { vendorAccountId: "account-b", kind: "admin_scoped", secret: "other-admin-secret", status: "active", health: "ok" },
        { vendorAccountId: "account-b", kind: "analytics", secret: "other-analytics-secret", status: "active", health: "ok" },
      ],
      "account-a",
      "missing_credential",
      ["other-admin-secret", "other-analytics-secret", "account-a", "account-b"],
    ],
    [
      "an unsupported kind at the runtime input boundary",
      [
        { vendorAccountId: "account-a", kind: "unsupported-kind", secret: "unsupported-secret", status: "active", health: "ok" },
        valid[1],
      ],
      "account-a",
      "wrong_credential_kind",
      ["unsupported-secret", "unsupported-kind", "analytics-secret", "account-a"],
    ],
  ] as const)("rejects %s with a safe stable error", (_case, candidates, vendorAccountId, code, sensitiveValues) => {
    let caught: unknown;
    try {
      resolveAnthropicCredentials(candidates as readonly unknown[], vendorAccountId);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AnthropicCredentialError);
    expect((caught as AnthropicCredentialError).code).toBe(code as AnthropicCredentialErrorCode);
    for (const sensitiveValue of sensitiveValues) {
      expect((caught as Error).message).not.toContain(sensitiveValue);
    }
  });

  it("rejects a blank vendor account and a malformed candidate fail-closed", () => {
    expect(() => resolveAnthropicCredentials(valid, "  ")).toThrow(
      expect.objectContaining({ code: "invalid_vendor_account" }),
    );
    expect(() => resolveAnthropicCredentials([null], "account-a")).toThrow(
      expect.objectContaining({ code: "invalid_vendor_account" }),
    );
  });

  it("rejects a resolved pair without a nonblank account before selecting", () => {
    expect(() => credentialForPolicy({
      vendorAccountId: " ",
      admin: { kind: "admin_scoped", secret: "admin-secret" },
      analytics: { kind: "analytics", secret: "analytics-secret" },
    }, endpointPolicy("members"))).toThrow(
      expect.objectContaining({ code: "invalid_vendor_account" }),
    );
  });
});
