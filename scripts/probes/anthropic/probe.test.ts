import { describe, expect, test } from "vitest";

import {
  classifyHttpResult,
  decimalCentsToUsd,
  inspectAdminPage,
  inspectAnalyticsPage,
  inspectEndpointSchema,
  parseManifest,
} from "./schemas.ts";
import {
  createSanitizedObservation,
  stableSecretHash,
} from "./redact.ts";
import {
  inviteCanaryAuthorization,
  probeDefinitions,
} from "./probe.ts";

const HASH_SALT = "synthetic-test-salt-with-at-least-32-bytes";

describe("public Anthropic contract fixtures", () => {
  test("classifies Admin member pagination as ID-based without retaining IDs", () => {
    const fixture = {
      data: [
        {
          type: "user",
          id: "user_synthetic_001",
          email: "alex@example.invalid",
          name: "Synthetic User",
          role: "user",
          added_at: "2026-07-01T00:00:00Z",
        },
      ],
      has_more: true,
      first_id: "user_synthetic_001",
      last_id: "user_synthetic_001",
    };

    expect(inspectAdminPage(fixture)).toEqual({
      valid: true,
      pagination: "id_cursor",
      itemCount: 1,
      hasMore: true,
      hasNextCursor: true,
      fieldTypes: expect.arrayContaining([
        "data[].email:string",
        "data[].id:string",
        "first_id:string",
        "has_more:boolean",
      ]),
    });
    expect(JSON.stringify(inspectAdminPage(fixture))).not.toContain(
      "user_synthetic_001",
    );
  });

  test("classifies Analytics pagination as an opaque page token", () => {
    const fixture = {
      data: [
        {
          user: {
            id: "user_synthetic_002",
            email_address: "sam@example.invalid",
          },
          date: "2026-07-01",
          chat_metrics: { conversation_count: 2 },
        },
      ],
      next_page: "page_synthetic_opaque",
    };

    expect(inspectAnalyticsPage(fixture)).toMatchObject({
      valid: true,
      pagination: "opaque_page",
      itemCount: 1,
      hasMore: true,
      hasNextCursor: true,
    });
  });

  test("keeps fractional cents exact without binary floating point", () => {
    expect(decimalCentsToUsd("41280.000000")).toBe("412.80000000");
    expect(decimalCentsToUsd("0.100000")).toBe("0.00100000");
    expect(() => decimalCentsToUsd("1e3")).toThrow(
      "decimal cents must use plain decimal notation",
    );
  });

  test("rejects a cost fixture whose amount is not a plain decimal string", () => {
    const validFixture = {
      data: [
        {
          starting_at: "2026-07-01T00:00:00Z",
          ending_at: "2026-07-02T00:00:00Z",
          results: [
            {
              amount: "41280.000000",
              list_amount: "50000.000000",
              currency: "USD",
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };
    expect(
      inspectEndpointSchema("cost_report", validFixture).valid,
    ).toBe(true);
    expect(
      inspectEndpointSchema("cost_report", {
        ...validFixture,
        data: [
          {
            ...validFixture.data[0],
            results: [{ amount: 41280, currency: "USD" }],
          },
        ],
      }).valid,
    ).toBe(false);
  });
});

describe("probe safety boundary", () => {
  test("rejects a manifest that reuses one environment variable for both key families", () => {
    expect(() =>
      parseManifest({
        organizations: [
          {
            ref: "synthetic",
            adminKeyEnv: "ANTHROPIC_SHARED_KEY",
            analyticsKeyEnv: "ANTHROPIC_SHARED_KEY",
          },
        ],
      }),
    ).toThrow("Admin and Analytics key environment variables must differ");
  });

  test("binds every endpoint to the documented key family and sends no beta header", () => {
    expect(
      probeDefinitions.map(({ name, keyKind, path, betaHeader }) => ({
        name,
        keyKind,
        path,
        betaHeader,
      })),
    ).toEqual([
      {
        name: "organization",
        keyKind: "admin",
        path: "/v1/organizations/me",
        betaHeader: null,
      },
      {
        name: "members",
        keyKind: "admin",
        path: "/v1/organizations/users",
        betaHeader: null,
      },
      {
        name: "invites",
        keyKind: "admin",
        path: "/v1/organizations/invites",
        betaHeader: null,
      },
      {
        name: "activity_users",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/users",
        betaHeader: null,
      },
      {
        name: "activity_summaries",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/summaries",
        betaHeader: null,
      },
      {
        name: "usage_report",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/usage_report",
        betaHeader: null,
      },
      {
        name: "cost_report",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/cost_report",
        betaHeader: null,
      },
    ]);
  });

  test("requires every invite mutation authorization signal for the same org", () => {
    const base = {
      allowMutation: "true",
      canaryEmail: "canary@example.invalid",
      canaryEmailApproved: "true",
      confirmedVendorAccountRef: "central",
      confirmedAt: "2026-07-26T05:00:00Z",
      organizationRef: "central",
      now: new Date("2026-07-26T05:03:00Z"),
    };

    expect(inviteCanaryAuthorization(base)).toEqual({
      authorized: true,
      reason: "all_operator_gates_confirmed",
    });
    expect(
      inviteCanaryAuthorization({ ...base, allowMutation: "false" }),
    ).toMatchObject({ authorized: false, reason: "mutation_not_enabled" });
    expect(
      inviteCanaryAuthorization({ ...base, canaryEmailApproved: "false" }),
    ).toMatchObject({ authorized: false, reason: "email_not_approved" });
    expect(
      inviteCanaryAuthorization({
        ...base,
        confirmedVendorAccountRef: "another-org",
      }),
    ).toMatchObject({
      authorized: false,
      reason: "vendor_account_not_confirmed",
    });
    expect(
      inviteCanaryAuthorization({
        ...base,
        now: new Date("2026-07-26T05:06:00Z"),
      }),
    ).toMatchObject({
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    });
  });

  test("emits only allowlisted metadata and salted hashes", () => {
    const body = {
      data: [
        {
          id: "user_private_123",
          email: "private@example.com",
          name: "Private Person",
          role: "user",
        },
      ],
      has_more: false,
      first_id: "user_private_123",
      last_id: "user_private_123",
      unrecognized_secret: "must-not-survive",
    };
    const observation = createSanitizedObservation({
      endpoint: "members",
      keyKind: "admin",
      status: 200,
      headers: {
        "request-id": "req_private_123",
        "retry-after": "2",
        "anthropic-ratelimit-requests-remaining": "58",
        authorization: "Bearer should-never-survive",
        "x-api-key": "sk-ant-private",
        "set-cookie": "private-cookie",
      },
      body,
      hashSalt: HASH_SALT,
      sentBetaHeader: null,
    });
    const serialized = JSON.stringify(observation);

    expect(observation).toMatchObject({
      endpoint: "members",
      key_kind: "admin",
      status: 200,
      classification: "success",
      response_headers: {
        retry_after: "2",
        rate_limit: {
          "anthropic-ratelimit-requests-remaining": "58",
        },
        request_id_hash: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
      },
      schema: {
        valid: true,
        pagination: "id_cursor",
        itemCount: 1,
      },
    });
    // Repeated cursor IDs collapse to the same stable hash.
    expect(observation.sensitive_value_hashes).toHaveLength(3);
    for (const forbidden of [
      "user_private_123",
      "private@example.com",
      "Private Person",
      "must-not-survive",
      "Bearer",
      "sk-ant",
      "private-cookie",
      "req_private_123",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("uses deterministic HMAC hashes scoped by the supplied salt", () => {
    const first = stableSecretHash("same-private-id", HASH_SALT);
    expect(stableSecretHash("same-private-id", HASH_SALT)).toBe(first);
    expect(
      stableSecretHash(
        "same-private-id",
        "different-synthetic-salt-with-32-bytes",
      ),
    ).not.toBe(first);
    expect(first).not.toContain("same-private-id");
  });

  test("classifies key-family and rate-limit failures without retaining a body", () => {
    expect(classifyHttpResult(403)).toBe(
      "authorization_or_key_type_mismatch",
    );
    expect(classifyHttpResult(429)).toBe("rate_limited");
    expect(classifyHttpResult(404)).toBe(
      "route_or_header_behavior_not_available",
    );
  });
});
