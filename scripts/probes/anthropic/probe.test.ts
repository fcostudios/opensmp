import { describe, expect, test } from "vitest";
import {
  chmod,
  readFile,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  classifyHttpResult,
  adminLastId,
  collectFieldTypes,
  decimalCentsToUsd,
  inviteId,
  inspectAdminPage,
  inspectAnalyticsPage,
  inspectEndpointSchema,
  inspectOrganization,
  inspectSummaries,
  opaqueNextPage,
  organizationId,
  parseManifest,
  responseHasMore,
} from "./schemas.ts";
import {
  createSanitizedObservation,
  stableSecretHash,
} from "./redact.ts";
import {
  buildExecutionSchedule,
  buildProbeQuery,
  assertDistinctPersistencePaths,
  checkpointPathForOrganization,
  classifyInviteCanaryOutcome,
  executeProbeCli,
  inviteCanaryAuthorization,
  probeDefinitions,
  requiresManualReview,
  request,
  resolveProbeSecrets,
  runReadProbe,
  runProbe,
  runInviteCanary,
  safeJson,
  parseCli,
  utcYesterday,
  verifyProviderOrganization,
  writeSanitizedArtifact,
} from "./probe.ts";
import {
  atomicWriteSecureJson,
  createAtomicWriteSecureJson,
  type SecureWriterDependencies,
} from "./runtime.ts";

const HASH_SALT = "synthetic-test-salt-with-at-least-32-bytes";
const EXPECTED_ORG_HASH =
  "hmac-sha256:e0c94722555cc948216081cd3e15b62f6ce38755d12ee72150af8211a9e9f348";
const FIXED_NOW = new Date("2026-07-26T05:03:00Z");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "request-id": "req_synthetic_contract",
    },
  });
}

function sequencedTransport(
  responses: Response[],
  calls: Array<{ url: string; method: string }>,
): typeof fetch {
  let index = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        input instanceof Request
          ? input.url
          : input.toString(),
      method: init?.method ?? "GET",
    });
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("synthetic contract sequence exhausted");
    return response;
  }) as typeof fetch;
}

const ORGANIZATION = {
  ref: "central",
  adminKeyEnv: "CENTRAL_ADMIN",
  analyticsKeyEnv: "CENTRAL_ANALYTICS",
  expectedOrganizationIdHash: EXPECTED_ORG_HASH,
};

const AUTHORIZED_ENVIRONMENT = {
  CENTRAL_ADMIN: "admin-secret",
  CENTRAL_ANALYTICS: "analytics-secret",
  PROBE_HASH_SALT: HASH_SALT,
  PROBE_ALLOW_INVITE_MUTATION: "true",
  PROBE_CANARY_EMAIL: "canary@example.invalid",
  PROBE_CANARY_EMAIL_APPROVED: "true",
  PROBE_CONFIRMED_VENDOR_ACCOUNT_REF: "central",
  PROBE_VENDOR_ACCOUNT_CONFIRMED_AT: "2026-07-26T05:00:00Z",
};

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

describe("sanitized evidence and schema boundary oracles", () => {
  test("accepts exactly 32 salt characters and rejects 31", () => {
    expect(() => stableSecretHash("secret", "")).toThrow(
      "PROBE_HASH_SALT must contain at least 32 characters",
    );
    expect(() => stableSecretHash("secret", "s".repeat(31))).toThrow(
      "PROBE_HASH_SALT must contain at least 32 characters",
    );
    expect(stableSecretHash("secret", "s".repeat(32))).toBe(
      "hmac-sha256:55ab5a1355f096bb6ee14bfa60f20305dba2e66c7fb8b829c2891947f4ecb1c8",
    );
    expect(stableSecretHash("secret", "s".repeat(33))).not.toBe(
      stableSecretHash("secret", "s".repeat(32)),
    );
  });

  test("redacts only anchored sensitive keys at every nesting depth", () => {
    const observation = createSanitizedObservation({
      endpoint: "members",
      keyKind: "admin",
      status: 200,
      headers: {},
      body: {
        data: [
          {
            id: "user-top",
            profile: {
              account_id: "account-nested",
              email_address: "nested@example.invalid",
              organization_id: 42,
              email: true,
              display_name_suffix: "not-sensitive-by-suffix",
            },
          },
        ],
        grid: "not-sensitive-by-substring",
        first_identifier: "not-sensitive-by-prefix",
        has_more: false,
        first_id: null,
        last_id: null,
      },
      hashSalt: HASH_SALT,
      sentBetaHeader: null,
    });

    expect(observation.sensitive_value_hashes).toEqual(
      [
        "user-top",
        "account-nested",
        "nested@example.invalid",
        "42",
      ]
        .map((value) => stableSecretHash(value, HASH_SALT))
        .sort(),
    );
    expect(JSON.stringify(observation)).not.toContain("not-sensitive");
  });

  test("normalizes Headers and uses request-id before x-request-id fallback", () => {
    const withPrimary = createSanitizedObservation({
      endpoint: "organization",
      keyKind: "admin",
      status: 200,
      headers: new Headers({
        "Request-Id": "primary-request",
        "X-Request-Id": "fallback-request",
        "Anthropic-Ratelimit-Requests-Limit": "100",
        "X-Anthropic-Ratelimit-Requests-Limit": "must-not-match",
        "Anthropic-Ratelimit-Invalid!": "must-not-match",
        "Anthropic-Beta": "beta-response",
      }),
      body: { type: "organization", id: "org-1", name: "Org" },
      hashSalt: HASH_SALT,
      sentBetaHeader: "beta-request",
    });
    const withFallback = createSanitizedObservation({
      endpoint: "organization",
      keyKind: "admin",
      status: 200,
      headers: { "X-Request-ID": "fallback-only" },
      body: { type: "organization", id: "org-1", name: "Org" },
      hashSalt: HASH_SALT,
      sentBetaHeader: null,
    });

    expect(withPrimary.response_headers).toEqual({
      retry_after: null,
      rate_limit: { "anthropic-ratelimit-requests-limit": "100" },
      request_id_hash: stableSecretHash("primary-request", HASH_SALT),
    });
    expect(withPrimary.beta_header).toEqual({
      sent: "beta-request",
      response: "beta-response",
    });
    expect(withFallback.response_headers.request_id_hash).toBe(
      stableSecretHash("fallback-only", HASH_SALT),
    );
  });

  test("sorts retained rate-limit headers for deterministic JSON evidence", () => {
    const observation = createSanitizedObservation({
      endpoint: "organization",
      keyKind: "admin",
      status: 200,
      headers: {
        "Anthropic-Ratelimit-Z": "last",
        "Anthropic-Ratelimit-A": "first",
      },
      body: { type: "organization", id: "org-1", name: "Org" },
      hashSalt: HASH_SALT,
      sentBetaHeader: null,
    });

    expect(Object.keys(observation.response_headers.rate_limit)).toEqual([
      "anthropic-ratelimit-a",
      "anthropic-ratelimit-z",
    ]);
    expect(JSON.stringify(observation.response_headers.rate_limit)).toBe(
      '{"anthropic-ratelimit-a":"first","anthropic-ratelimit-z":"last"}',
    );
  });

  test("validates manifest names, hashes, uniqueness, and non-empty organizations exactly", () => {
    const validOrganization = {
      ref: "central-1",
      adminKeyEnv: "CENTRAL_ADMIN_1",
      analyticsKeyEnv: "CENTRAL_ANALYTICS_1",
      expectedOrganizationIdHash: `hmac-sha256:${"a".repeat(64)}`,
    };
    expect(parseManifest({ organizations: [validOrganization] })).toEqual({
      organizations: [validOrganization],
    });

    const invalidValues: Array<[unknown, string]> = [
      [null, "manifest must contain an organizations array"],
      [{ organizations: {} }, "manifest must contain an organizations array"],
      [{ organizations: [] }, "manifest must contain at least one organization"],
      [
        { organizations: [null] },
        "organizations[0] must be an object",
      ],
      [
        { organizations: [{ ...validOrganization, ref: "Central" }] },
        "organizations[0].ref is invalid",
      ],
      [
        { organizations: [{ ...validOrganization, ref: "valid!" }] },
        "organizations[0].ref is invalid",
      ],
      [
        { organizations: [{ ...validOrganization, ref: 1 }] },
        "organizations[0].ref is invalid",
      ],
      [
        { organizations: [{ ...validOrganization, adminKeyEnv: "_ADMIN" }] },
        "organizations[0].adminKeyEnv is invalid",
      ],
      [
        { organizations: [{ ...validOrganization, adminKeyEnv: "ADMIN!" }] },
        "organizations[0].adminKeyEnv is invalid",
      ],
      [
        { organizations: [{ ...validOrganization, adminKeyEnv: null }] },
        "organizations[0].adminKeyEnv is invalid",
      ],
      [
        {
          organizations: [
            { ...validOrganization, analyticsKeyEnv: "analytics_key" },
          ],
        },
        "organizations[0].analyticsKeyEnv is invalid",
      ],
      [
        {
          organizations: [
            { ...validOrganization, analyticsKeyEnv: "ANALYTICS!" },
          ],
        },
        "organizations[0].analyticsKeyEnv is invalid",
      ],
      [
        {
          organizations: [
            { ...validOrganization, analyticsKeyEnv: null },
          ],
        },
        "organizations[0].analyticsKeyEnv is invalid",
      ],
      [
        {
          organizations: [
            { ...validOrganization, analyticsKeyEnv: "CENTRAL_ADMIN_1" },
          ],
        },
        "Admin and Analytics key environment variables must differ",
      ],
      [
        {
          organizations: [
            {
              ...validOrganization,
              expectedOrganizationIdHash: `hmac-sha256:${"A".repeat(64)}`,
            },
          ],
        },
        "organizations[0].expectedOrganizationIdHash is invalid",
      ],
      [
        {
          organizations: [
            {
              ...validOrganization,
              expectedOrganizationIdHash: `prefix-hmac-sha256:${"a".repeat(64)}`,
            },
          ],
        },
        "organizations[0].expectedOrganizationIdHash is invalid",
      ],
      [
        {
          organizations: [
            {
              ...validOrganization,
              expectedOrganizationIdHash: `hmac-sha256:${"a".repeat(64)}-suffix`,
            },
          ],
        },
        "organizations[0].expectedOrganizationIdHash is invalid",
      ],
      [
        {
          organizations: [
            { ...validOrganization, expectedOrganizationIdHash: null },
          ],
        },
        "organizations[0].expectedOrganizationIdHash is invalid",
      ],
      [
        { organizations: [validOrganization, { ...validOrganization }] },
        "duplicate organization ref: central-1",
      ],
      [
        {
          organizations: [
            validOrganization,
            {
              ...validOrganization,
              ref: "second",
              analyticsKeyEnv: "SECOND_ANALYTICS",
            },
          ],
        },
        "each organization must use distinct key variables",
      ],
    ];
    for (const [value, message] of invalidValues) {
      expect(() => parseManifest(value)).toThrow(message);
    }
  });

  test("rejects coercible objects and Symbols as manifest strings with the field error", () => {
    const validOrganization = {
      ref: "central-1",
      adminKeyEnv: "CENTRAL_ADMIN_1",
      analyticsKeyEnv: "CENTRAL_ANALYTICS_1",
      expectedOrganizationIdHash: `hmac-sha256:${"a".repeat(64)}`,
    };
    const coercibleEnvironment = {
      toString: () => "COERCED_ENV",
    };
    const coercibleHash = {
      toString: () => `hmac-sha256:${"b".repeat(64)}`,
    };

    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { ...validOrganization, adminKeyEnv: coercibleEnvironment },
        "organizations[0].adminKeyEnv is invalid",
      ],
      [
        { ...validOrganization, analyticsKeyEnv: coercibleEnvironment },
        "organizations[0].analyticsKeyEnv is invalid",
      ],
      [
        {
          ...validOrganization,
          expectedOrganizationIdHash: coercibleHash,
        },
        "organizations[0].expectedOrganizationIdHash is invalid",
      ],
      [
        { ...validOrganization, adminKeyEnv: Symbol("ADMIN") },
        "organizations[0].adminKeyEnv is invalid",
      ],
      [
        { ...validOrganization, analyticsKeyEnv: Symbol("ANALYTICS") },
        "organizations[0].analyticsKeyEnv is invalid",
      ],
      [
        {
          ...validOrganization,
          expectedOrganizationIdHash: Symbol("hash"),
        },
        "organizations[0].expectedOrganizationIdHash is invalid",
      ],
    ];

    for (const [organization, message] of cases) {
      expect(() => parseManifest({ organizations: [organization] })).toThrow(
        message,
      );
    }
  });

  test("reports a deterministic exact field-type inventory", () => {
    expect(
      collectFieldTypes({
        data: [
          { id: "one", flags: [true, false], nested: { count: 2 } },
          { id: "two", optional: null },
        ],
        empty: [],
      }),
    ).toEqual([
      "data[].flags[]:boolean",
      "data[].id:string",
      "data[].nested.count:number",
      "data[].optional:null",
      "empty[]:unknown",
    ]);
    expect(collectFieldTypes("scalar", "root")).toEqual(["root:string"]);
    expect(collectFieldTypes([], "root")).toEqual(["root[]:unknown"]);
    expect(collectFieldTypes("ignored")).toEqual([]);
    expect(
      collectFieldTypes({ middle: 1 }, "", new Set(["z:string", "a:string"])),
    ).toEqual(["a:string", "middle:number", "z:string"]);
    expect(
      collectFieldTypes({
        symbol: Symbol("opaque"),
        nested: { value: 1n },
      }),
    ).toEqual(["nested.value:bigint", "symbol:symbol"]);
  });

  test("never hashes sensitive fields whose values are Symbols or objects", () => {
    const symbolId = Symbol("sensitive-id");
    const observation = createSanitizedObservation({
      endpoint: "members",
      keyKind: "admin",
      status: 200,
      headers: {},
      body: {
        id: symbolId,
        account_id: { toString: () => "coercible-account" },
        nested: {
          email: Symbol("sensitive-email"),
          name: { value: "not-a-scalar-name" },
          organization_id: 0,
        },
      },
      hashSalt: HASH_SALT,
      sentBetaHeader: null,
    });

    expect(observation.sensitive_value_hashes).toEqual([
      stableSecretHash("0", HASH_SALT),
    ]);
  });

  test("accepts null bodies and null non-sensitive leaves without traversing them", () => {
    const observe = (body: unknown) =>
      createSanitizedObservation({
        endpoint: "members",
        keyKind: "admin",
        status: 200,
        headers: {},
        body,
        hashSalt: HASH_SALT,
        sentBetaHeader: null,
      });

    expect(observe(null).sensitive_value_hashes).toEqual([]);
    expect(
      observe({ metadata: null, nested: { harmless: null } })
        .sensitive_value_hashes,
    ).toEqual([]);
  });

  test("inspects organization and summary contracts exactly", () => {
    expect(
      inspectOrganization({
        type: "organization",
        id: "org-1",
        name: "Ledger",
      }),
    ).toEqual({
      valid: true,
      pagination: "none",
      itemCount: 1,
      hasMore: false,
      hasNextCursor: false,
      fieldTypes: ["id:string", "name:string", "type:string"],
    });
    for (const invalid of [
      null,
      { type: "wrong", id: "org-1", name: "Ledger" },
      { type: "organization", id: 1, name: "Ledger" },
      { type: "organization", id: "org-1", name: null },
    ]) {
      expect(inspectOrganization(invalid).valid).toBe(false);
    }
    expect(inspectSummaries({ summaries: [{ count: 1 }] })).toEqual({
      valid: true,
      pagination: "none",
      itemCount: 1,
      hasMore: false,
      hasNextCursor: false,
      fieldTypes: ["summaries[].count:number"],
    });
    expect(inspectSummaries({ summaries: null })).toMatchObject({
      valid: false,
      itemCount: 0,
    });
  });

  test("validates invite create and delete contracts field by field", () => {
    const create = {
      type: "invite",
      id: "invite-1",
      email: "canary@example.invalid",
      status: "pending",
    };
    expect(inspectEndpointSchema("invite_canary_create", create)).toEqual({
      valid: true,
      pagination: "none",
      itemCount: 1,
      hasMore: false,
      hasNextCursor: false,
      fieldTypes: [
        "email:string",
        "id:string",
        "status:string",
        "type:string",
      ],
    });
    for (const field of ["type", "id", "email", "status"] as const) {
      expect(
        inspectEndpointSchema("invite_canary_create", {
          ...create,
          [field]: null,
        }).valid,
      ).toBe(false);
    }
    expect(
      inspectEndpointSchema("invite_canary_delete", {
        type: "invite_deleted",
        id: "invite-1",
      }),
    ).toEqual({
      valid: true,
      pagination: "none",
      itemCount: 1,
      hasMore: false,
      hasNextCursor: false,
      fieldTypes: ["id:string", "type:string"],
    });
    expect(
      inspectEndpointSchema("invite_canary_delete", {
        type: "invite",
        id: "invite-1",
      }).valid,
    ).toBe(false);
    expect(
      inspectEndpointSchema("invite_canary_delete", {
        type: "invite_deleted",
        id: 1,
      }).valid,
    ).toBe(false);
    expect(
      inspectEndpointSchema("invite_canary_delete", null),
    ).toMatchObject({ valid: false, itemCount: 0 });
  });

  test("routes each endpoint to its exact pagination and decimal contract", () => {
    const adminPage = {
      data: [],
      has_more: false,
      first_id: null,
      last_id: null,
    };
    expect(inspectEndpointSchema("members", adminPage).pagination).toBe(
      "id_cursor",
    );
    expect(inspectEndpointSchema("invites", adminPage).pagination).toBe(
      "id_cursor",
    );
    expect(
      inspectEndpointSchema("activity_summaries", { summaries: [] }).pagination,
    ).toBe("none");
    const decimalPage = {
      data: [{ results: [{ amount: "1.25", list_amount: "-0.50" }] }],
      next_page: null,
    };
    expect(inspectEndpointSchema("cost_report", decimalPage).valid).toBe(true);
    expect(inspectEndpointSchema("user_cost_report", decimalPage).valid).toBe(
      true,
    );
    expect(
      inspectEndpointSchema("cost_report", {
        ...decimalPage,
        data: [
          ...decimalPage.data,
          { results: [{ amount: "1e2", list_amount: "1" }] },
        ],
      }).valid,
    ).toBe(false);
    expect(
      inspectEndpointSchema("user_cost_report", {
        ...decimalPage,
        data: [{ results: [{ amount: "1", list_amount: null }] }],
      }).valid,
    ).toBe(false);
    expect(
      inspectEndpointSchema("cost_report", {
        data: [{ metadata: null, results: [{ amount: "1" }] }],
        next_page: null,
      }).valid,
    ).toBe(true);
    expect(
      inspectEndpointSchema("usage_report", {
        data: [{ amount: 12 }],
        next_page: null,
      }).valid,
    ).toBe(true);
  });

  test("classifies every HTTP boundary without gaps", () => {
    expect(
      [
        199, 200, 299, 300, 400, 401, 403, 404, 409, 422, 429, 499, 500,
        599, 600,
      ].map((status) => [status, classifyHttpResult(status)]),
    ).toEqual([
      [199, "unexpected_status"],
      [200, "success"],
      [299, "success"],
      [300, "unexpected_status"],
      [400, "invalid_request"],
      [401, "authentication_failed"],
      [403, "authorization_or_key_type_mismatch"],
      [404, "route_or_header_behavior_not_available"],
      [409, "conflict"],
      [422, "invalid_request"],
      [429, "rate_limited"],
      [499, "unexpected_status"],
      [500, "provider_error"],
      [599, "provider_error"],
      [600, "unexpected_status"],
    ]);
  });

  test("extracts only string pagination, invite, and organization identifiers", () => {
    expect(opaqueNextPage({ next_page: "next" })).toBe("next");
    expect(opaqueNextPage({ next_page: 1 })).toBeNull();
    expect(adminLastId({ last_id: "last" })).toBe("last");
    expect(adminLastId({ last_id: null })).toBeNull();
    expect(adminLastId({ last_id: 1 })).toBeNull();
    expect(responseHasMore({ has_more: true })).toBe(true);
    expect(responseHasMore({ has_more: 1 })).toBe(false);
    expect(inviteId({ id: "invite-1" })).toBe("invite-1");
    expect(inviteId({ id: 1 })).toBeNull();
    expect(organizationId({ id: "org-1" })).toBe("org-1");
    expect(organizationId({ id: null })).toBeNull();
    expect(organizationId({ id: 1 })).toBeNull();
    expect(opaqueNextPage(null)).toBeNull();
    expect(adminLastId([])).toBeNull();
    expect(responseHasMore(null)).toBe(false);
    expect(inviteId([])).toBeNull();
    expect(organizationId(null)).toBeNull();
  });

  test("preserves decimal sign and scale while rejecting malformed notation", () => {
    expect(decimalCentsToUsd("-0.100")).toBe("-0.00100");
    expect(decimalCentsToUsd("-0.000")).toBe("0.00000");
    expect(decimalCentsToUsd("1")).toBe("0.01");
    expect(decimalCentsToUsd("0001.20")).toBe("0.0120");
    for (const invalid of ["", ".1", "1.", "+1", "1e2", " 1", "1 "]) {
      expect(() => decimalCentsToUsd(invalid)).toThrow(
        "decimal cents must use plain decimal notation",
      );
    }
  });

  test("distinguishes null and string cursors from missing and wrong-typed cursors", () => {
    expect(
      inspectAdminPage({
        data: [],
        has_more: false,
        first_id: null,
        last_id: null,
      }),
    ).toMatchObject({ valid: true, hasMore: false, hasNextCursor: false });
    expect(
      inspectAdminPage({
        data: [],
        has_more: true,
        first_id: null,
        last_id: "last",
      }),
    ).toMatchObject({ valid: true, hasMore: true, hasNextCursor: true });
    expect(
      inspectAdminPage({ data: [], has_more: false, first_id: null }),
    ).toMatchObject({ valid: false, hasNextCursor: false });
    for (const invalid of [
      { has_more: false, first_id: null, last_id: null },
      { data: [], has_more: 0, first_id: null, last_id: null },
      { data: "not-an-array", has_more: false, first_id: null, last_id: null },
      { data: [], has_more: false, first_id: 0, last_id: null },
      { data: [], has_more: false, first_id: null, last_id: 0 },
    ]) {
      expect(inspectAdminPage(invalid)).toMatchObject({
        valid: false,
        itemCount: Array.isArray(invalid.data) ? invalid.data.length : 0,
      });
    }
    expect(
      inspectAnalyticsPage({ data: [], next_page: null }),
    ).toMatchObject({ valid: true, hasMore: false, hasNextCursor: false });
    expect(
      inspectAnalyticsPage({ data: [], next_page: "next" }),
    ).toMatchObject({ valid: true, hasMore: true, hasNextCursor: true });
    expect(
      inspectAnalyticsPage({ data: [], next_page: 0 }),
    ).toMatchObject({ valid: false, hasMore: false, hasNextCursor: false });
    expect(
      inspectAnalyticsPage({ data: [], has_more: true, next_page: null }),
    ).toMatchObject({ valid: true, hasMore: true, hasNextCursor: false });
    expect(
      inspectAnalyticsPage({ next_page: null }),
    ).toMatchObject({ valid: false, itemCount: 0 });
  });
});

describe("probe safety boundary", () => {
  test("classifies every invite authorization preflight boundary exactly", () => {
    const base = {
      allowMutation: "true",
      canaryEmail: "canary@example.invalid",
      canaryEmailApproved: "true",
      confirmedVendorAccountRef: "central",
      confirmedAt: "2026-07-26T05:00:00Z",
      organizationRef: "central",
      now: FIXED_NOW,
    };

    expect(
      inviteCanaryAuthorization({ ...base, canaryEmail: undefined }),
    ).toEqual({ authorized: false, reason: "canary_email_missing" });
    expect(
      inviteCanaryAuthorization({ ...base, confirmedAt: undefined }),
    ).toEqual({
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    });
    expect(
      inviteCanaryAuthorization({ ...base, confirmedAt: "not-a-date" }),
    ).toEqual({
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    });
    expect(
      inviteCanaryAuthorization({
        ...base,
        confirmedAt: "2026-07-26T05:03:00.001Z",
      }),
    ).toEqual({
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    });
    expect(
      inviteCanaryAuthorization({
        ...base,
        confirmedAt: FIXED_NOW.toISOString(),
      }),
    ).toEqual({
      authorized: true,
      reason: "all_operator_gates_confirmed",
    });
    expect(
      inviteCanaryAuthorization({
        ...base,
        confirmedAt: "2026-07-26T04:58:00Z",
      }),
    ).toEqual({
      authorized: true,
      reason: "all_operator_gates_confirmed",
    });
    expect(
      inviteCanaryAuthorization({
        ...base,
        confirmedAt: "2026-07-26T04:57:59.999Z",
      }),
    ).toEqual({
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    });
  });

  test("parses CLI defaults, overrides, and malformed boundaries exactly", () => {
    expect(utcYesterday(new Date("2026-03-01T00:00:00Z"))).toBe(
      "2026-02-28",
    );
    expect(utcYesterday(new Date("2024-03-01T23:59:59Z"))).toBe(
      "2024-02-29",
    );
    expect(parseCli([])).toMatchObject({
      manifestPath: ".env.anthropic-probe-manifest.local",
      outputPath: "docs/spikes/US-054-anthropic-api-probe.runtime.json",
      checkpointPath:
        "docs/spikes/US-054-anthropic-api-probe.checkpoint.json",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(
      parseCli([
        "--manifest",
        "manifest.json",
        "--output",
        "artifact.json",
        "--checkpoint",
        "checkpoint.json",
        "--date",
        "2026-07-24",
      ]),
    ).toEqual({
      manifestPath: "manifest.json",
      outputPath: "artifact.json",
      checkpointPath: "checkpoint.json",
      date: "2026-07-24",
    });
    for (const argv of [
      ["--manifest"],
      ["--output"],
      ["--checkpoint"],
      ["--date"],
      ["--unsupported", "value"],
    ]) {
      expect(() => parseCli(argv)).toThrow(
        `unsupported or incomplete argument: ${argv[0]}`,
      );
    }
    for (const date of [
      "2026-7-24",
      "x2026-07-24",
      "2026-07-24x",
      "",
    ]) {
      expect(() => parseCli(["--date", date])).toThrow(
        date
          ? "--date must use YYYY-MM-DD"
          : "unsupported or incomplete argument: --date",
      );
    }
  });

  test("requires both key families and the hash salt before network access", async () => {
    const manifest = parseManifest({
      organizations: [ORGANIZATION],
    });
    expect(() =>
      resolveProbeSecrets(manifest, {
        CENTRAL_ANALYTICS: "analytics-secret",
      }),
    ).toThrow(
      "required secret environment variable is unset: CENTRAL_ADMIN",
    );
    expect(() =>
      resolveProbeSecrets(manifest, {
        CENTRAL_ADMIN: "admin-secret",
      }),
    ).toThrow(
      "required secret environment variable is unset: CENTRAL_ANALYTICS",
    );

    let networkCalls = 0;
    await expect(
      runProbe(
        {
          manifestPath: "manifest.json",
          outputPath: "artifact.json",
          checkpointPath: "checkpoint.json",
          date: "2026-07-24",
        },
        {
          environment: {
            CENTRAL_ADMIN: "admin-secret",
            CENTRAL_ANALYTICS: "analytics-secret",
          },
          fetchImpl: (async () => {
            networkCalls += 1;
            throw new Error("network must not run");
          }) as typeof fetch,
          now: () => FIXED_NOW,
          readText: async () =>
            JSON.stringify({ organizations: [ORGANIZATION] }),
          writeSecureJson: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "required secret environment variable is unset: PROBE_HASH_SALT",
    );
    expect(networkCalls).toBe(0);
  });

  test("builds an exact query contract for every endpoint", () => {
    expect(
      probeDefinitions.map((definition) => [
        definition.name,
        Object.fromEntries(
          buildProbeQuery(definition, "2026-12-31").entries(),
        ),
      ]),
    ).toEqual([
      ["organization", {}],
      ["members", { limit: "1000" }],
      ["invites", { limit: "1000" }],
      ["activity_users", { date: "2026-12-31" }],
      ["activity_summaries", { date: "2026-12-31" }],
      [
        "usage_report",
        {
          starting_at: "2026-12-31T00:00:00Z",
          ending_at: "2027-01-01T00:00:00Z",
          bucket_width: "1d",
          limit: "1",
        },
      ],
      [
        "cost_report",
        {
          starting_at: "2026-12-31T00:00:00Z",
          ending_at: "2027-01-01T00:00:00Z",
          bucket_width: "1d",
          limit: "1",
        },
      ],
    ]);
  });

  test("parses only JSON responses and fixes required request headers", async () => {
    await expect(safeJson(new Response(null))).resolves.toBeNull();
    await expect(
      safeJson(
        new Response('{"ignored":true}', {
          headers: { "content-type": "text/plain" },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      safeJson(
        new Response("{invalid", {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      safeJson(
        new Response('{"ok":true}', {
          headers: { "content-type": "APPLICATION/JSON" },
        }),
      ),
    ).resolves.toEqual({ ok: true });

    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      hasSignal: boolean;
    }> = [];
    const result = await request(
      new URL("https://api.anthropic.com/v1/synthetic"),
      "correct-key",
      {
        method: "POST",
        headers: {
          "x-api-key": "wrong-key",
          accept: "text/plain",
          "x-custom": "retained",
        },
      },
      (async (input, init) => {
        calls.push({
          url: input.toString(),
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          hasSignal: init?.signal instanceof AbortSignal,
        });
        return new Response("not-json", {
          status: 202,
          headers: { "content-type": "text/plain" },
        });
      }) as typeof fetch,
    );
    expect(calls).toEqual([
      {
        url: "https://api.anthropic.com/v1/synthetic",
        method: "POST",
        headers: {
          accept: "application/json",
          "anthropic-version": "2023-06-01",
          "user-agent": "Ledger-US-054-Probe/1.0",
          "x-api-key": "correct-key",
          "x-custom": "retained",
        },
        hasSignal: true,
      },
    ]);
    expect(result.response.status).toBe(202);
    expect(result.body).toBeNull();
  });

  test("follows both pagination contracts and stops on every terminal condition", async () => {
    const members = probeDefinitions.find(({ name }) => name === "members")!;
    const activity = probeDefinitions.find(
      ({ name }) => name === "activity_users",
    )!;
    const organization = probeDefinitions.find(
      ({ name }) => name === "organization",
    )!;

    const memberUrls: string[] = [];
    const memberResponses = [
      jsonResponse(200, {
        data: [],
        has_more: true,
        first_id: "user_first",
        last_id: "user_cursor",
      }),
      jsonResponse(200, {
        data: [],
        has_more: false,
        first_id: null,
        last_id: null,
      }),
    ];
    let memberIndex = 0;
    const memberResult = await runReadProbe({
      definition: members,
      key: "admin-secret",
      date: "2026-07-24",
      hashSalt: HASH_SALT,
      expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      fetchImpl: (async (input) => {
        memberUrls.push(input.toString());
        return memberResponses[memberIndex++]!;
      }) as typeof fetch,
    });
    expect(memberUrls).toEqual([
      "https://api.anthropic.com/v1/organizations/users?limit=1000",
      "https://api.anthropic.com/v1/organizations/users?limit=1000&after_id=user_cursor",
    ]);
    expect(memberResult.observations).toHaveLength(2);
    expect(memberResult.providerTargetVerified).toBeNull();

    const activityUrls: string[] = [];
    const activityResponses = [
      jsonResponse(200, { data: [], next_page: "opaque-cursor" }),
      jsonResponse(200, { data: [], next_page: null }),
    ];
    let activityIndex = 0;
    const activityResult = await runReadProbe({
      definition: activity,
      key: "analytics-secret",
      date: "2026-07-24",
      hashSalt: HASH_SALT,
      expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      fetchImpl: (async (input) => {
        activityUrls.push(input.toString());
        return activityResponses[activityIndex++]!;
      }) as typeof fetch,
    });
    expect(activityUrls).toEqual([
      "https://api.anthropic.com/v1/organizations/analytics/users?date=2026-07-24",
      "https://api.anthropic.com/v1/organizations/analytics/users?date=2026-07-24&page=opaque-cursor",
    ]);
    expect(activityResult.observations).toHaveLength(2);

    const failedCalls: string[] = [];
    await runReadProbe({
      definition: members,
      key: "admin-secret",
      date: "2026-07-24",
      hashSalt: HASH_SALT,
      expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      fetchImpl: (async (input) => {
        failedCalls.push(input.toString());
        return jsonResponse(503, {
          data: [],
          has_more: true,
          last_id: "must-not-follow",
        });
      }) as typeof fetch,
    });
    expect(failedCalls).toHaveLength(1);

    const unpaginatedCalls: string[] = [];
    await runReadProbe({
      definition: organization,
      key: "admin-secret",
      date: "2026-07-24",
      hashSalt: HASH_SALT,
      expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      fetchImpl: (async (input) => {
        unpaginatedCalls.push(input.toString());
        return jsonResponse(200, {
          id: "org_synthetic_trusted",
          name: "Synthetic Trusted Organization",
          type: "organization",
          next_page: "must-not-follow",
        });
      }) as typeof fetch,
    });
    expect(unpaginatedCalls).toHaveLength(1);

    for (const terminalBody of [
      {
        data: [],
        has_more: false,
        first_id: "user_first",
        last_id: "must-not-follow",
      },
      {
        data: [],
        has_more: true,
        first_id: null,
        last_id: null,
      },
    ]) {
      const terminalCalls: string[] = [];
      await runReadProbe({
        definition: members,
        key: "admin-secret",
        date: "2026-07-24",
        hashSalt: HASH_SALT,
        expectedOrganizationIdHash: EXPECTED_ORG_HASH,
        fetchImpl: (async (input) => {
          terminalCalls.push(input.toString());
          return jsonResponse(200, terminalBody);
        }) as typeof fetch,
      });
      expect(terminalCalls).toHaveLength(1);
    }
  });

  test("caps a perpetually paginated endpoint at exactly one hundred requests", async () => {
    const members = probeDefinitions.find(({ name }) => name === "members")!;
    const urls: string[] = [];
    const result = await runReadProbe({
      definition: members,
      key: "admin-secret",
      date: "2026-07-24",
      hashSalt: HASH_SALT,
      expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      fetchImpl: (async (input) => {
        urls.push(input.toString());
        return jsonResponse(200, {
          data: [],
          has_more: true,
          first_id: "user_first",
          last_id: `user_cursor_${urls.length}`,
        });
      }) as typeof fetch,
    });

    expect(urls).toHaveLength(100);
    expect(urls[0]).toBe(
      "https://api.anthropic.com/v1/organizations/users?limit=1000",
    );
    expect(urls.at(-1)).toContain("after_id=user_cursor_99");
    expect(result.observations).toHaveLength(100);
  });

  test("rejects a manifest that reuses one environment variable for both key families", () => {
    expect(() =>
      parseManifest({
        organizations: [
          {
            ref: "synthetic",
            adminKeyEnv: "ANTHROPIC_SHARED_KEY",
            analyticsKeyEnv: "ANTHROPIC_SHARED_KEY",
            expectedOrganizationIdHash: EXPECTED_ORG_HASH,
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

  test("schedules every organization's read probes before any invite canary", () => {
    const organizations = [
      {
        ref: "central",
        adminKeyEnv: "CENTRAL_ADMIN",
        analyticsKeyEnv: "CENTRAL_ANALYTICS",
        expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      },
      {
        ref: "carveout",
        adminKeyEnv: "CARVEOUT_ADMIN",
        analyticsKeyEnv: "CARVEOUT_ANALYTICS",
        expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      },
    ];
    const schedule = buildExecutionSchedule(organizations);
    const firstMutation = schedule.findIndex(
      ({ phase }) => phase === "invite_canary",
    );

    expect(firstMutation).toBe(probeDefinitions.length * organizations.length);
    expect(
      schedule.slice(0, firstMutation).every(({ phase }) => phase === "read"),
    ).toBe(true);
    expect(
      schedule.slice(firstMutation).map(({ organization }) => organization.ref),
    ).toEqual(["central", "carveout"]);
  });

  test("uses a single daily bucket for usage and cost evidence", () => {
    for (const name of ["usage_report", "cost_report"]) {
      const definition = probeDefinitions.find(
        (candidate) => candidate.name === name,
      );
      expect(definition).toBeDefined();
      expect(
        Object.fromEntries(
          buildProbeQuery(definition!, "2026-07-24").entries(),
        ),
      ).toEqual({
        starting_at: "2026-07-24T00:00:00Z",
        ending_at: "2026-07-25T00:00:00Z",
        bucket_width: "1d",
        limit: "1",
      });
    }
  });

  test("rejects equal resolved Admin and Analytics secrets during preflight", () => {
    const manifest = parseManifest({
      organizations: [
        {
          ref: "central",
          adminKeyEnv: "CENTRAL_ADMIN",
          analyticsKeyEnv: "CENTRAL_ANALYTICS",
          expectedOrganizationIdHash: EXPECTED_ORG_HASH,
        },
      ],
    });
    expect(() =>
      resolveProbeSecrets(manifest, {
        CENTRAL_ADMIN: "same-secret",
        CENTRAL_ANALYTICS: "same-secret",
      }),
    ).toThrow("resolved Admin and Analytics secrets must differ");
  });

  test("marks every successful-create cleanup uncertainty for manual review", () => {
    expect(
      classifyInviteCanaryOutcome({
        createStatus: 201,
        hasInviteId: false,
        cleanupStatus: null,
        createTransportFailure: false,
        cleanupTransportFailure: false,
      }),
    ).toBe("indeterminate_manual_review_required");
    expect(
      classifyInviteCanaryOutcome({
        createStatus: 201,
        hasInviteId: true,
        cleanupStatus: null,
        createTransportFailure: false,
        cleanupTransportFailure: false,
      }),
    ).toBe("indeterminate_manual_review_required");
    const nonSuccessStatuses = Array.from(
      { length: 500 },
      (_, index) => index + 100,
    ).filter((status) => status < 200 || status >= 300);
    for (const cleanupStatus of nonSuccessStatuses) {
      expect(
        classifyInviteCanaryOutcome({
          createStatus: 201,
          hasInviteId: true,
          cleanupStatus,
          createTransportFailure: false,
          cleanupTransportFailure: false,
        }),
      ).toBe("indeterminate_manual_review_required");
    }
    expect(
      classifyInviteCanaryOutcome({
        createStatus: 201,
        hasInviteId: true,
        cleanupStatus: 200,
        createTransportFailure: false,
        cleanupTransportFailure: false,
      }),
    ).toBe("executed_and_cleaned_up");
  });

  test("aggregates manual review when any organization is indeterminate", () => {
    expect(
      requiresManualReview([
        { invite_canary: { status: "not_executed" } },
        {
          invite_canary: {
            status: "indeterminate_manual_review_required",
          },
        },
      ]),
    ).toBe(true);
    expect(
      requiresManualReview([
        { invite_canary: { status: "not_executed" } },
        { invite_canary: { status: "executed_and_cleaned_up" } },
      ]),
    ).toBe(false);
  });

  test("rejects a 31-character hash salt before network access", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    await expect(
      runProbe(
        {
          manifestPath: "synthetic-manifest.json",
          outputPath: "synthetic-artifact.json",
          checkpointPath: "synthetic-checkpoint.json",
          date: "2026-07-24",
        },
        {
          environment: {
            ...AUTHORIZED_ENVIRONMENT,
            PROBE_HASH_SALT: "x".repeat(31),
          },
          now: () => FIXED_NOW,
          readText: async () =>
            JSON.stringify({ organizations: [ORGANIZATION] }),
          fetchImpl: sequencedTransport([], calls),
          writeSecureJson: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "PROBE_HASH_SALT must contain at least 32 characters",
    );
    expect(calls).toEqual([]);
  });

  test("forces an overwritten artifact back to owner-only permissions", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-test-"),
    );
    const artifactPath = join(directory, "artifact.json");
    try {
      await writeFile(artifactPath, JSON.stringify({ old: true }));
      await chmod(artifactPath, 0o644);

      await writeSanitizedArtifact(artifactPath, {
        artifact_version: 1,
        raw_bodies_persisted: false,
      });

      expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(artifactPath, "utf8")).toBe(
        `${JSON.stringify(
          {
            artifact_version: 1,
            raw_bodies_persisted: false,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a symbolic-link artifact target", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-link-test-"),
    );
    const realPath = join(directory, "real.json");
    const linkedPath = join(directory, "linked.json");
    try {
      await writeFile(realPath, JSON.stringify({ untouched: true }));
      await symlink(realPath, linkedPath);
      await expect(
        atomicWriteSecureJson(linkedPath, { artifact_version: 1 }),
      ).rejects.toThrow("must not contain a symbolic link");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a symbolic-link parent directory", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-parent-link-test-"),
    );
    const realDirectory = join(directory, "real");
    const linkedDirectory = join(directory, "linked");
    try {
      await mkdir(realDirectory);
      await symlink(realDirectory, linkedDirectory);
      await expect(
        atomicWriteSecureJson(join(linkedDirectory, "artifact.json"), {
          artifact_version: 1,
        }),
      ).rejects.toThrow("must not contain a symbolic link");
      expect(await readdir(realDirectory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("removes its exclusive temporary file after a real rename failure", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-cleanup-test-"),
    );
    const directoryTarget = join(directory, "artifact.json");
    try {
      await mkdir(directoryTarget);
      await expect(
        atomicWriteSecureJson(directoryTarget, { artifact_version: 1 }),
      ).rejects.toThrow();
      expect(await readdir(directory)).toEqual(["artifact.json"]);
      expect(await readdir(directoryTarget)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("flushes and closes both file and directory around the atomic rename", async () => {
    const events: string[] = [];
    const outputPath = join(process.cwd(), "synthetic-artifact.json");
    const temporaryPath = join(
      process.cwd(),
      ".synthetic-artifact.json.4242.synthetic-id.tmp",
    );
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const fileHandle = {
      writeFile: async (value: string, encoding: string) => {
        events.push(`write:${encoding}:${value}`);
      },
      sync: async () => {
        events.push("file:sync");
      },
      close: async () => {
        events.push("file:close");
      },
    };
    const directoryHandle = {
      sync: async () => {
        events.push("directory:sync");
      },
      close: async () => {
        events.push("directory:close");
      },
    };
    const dependencies = {
      lstat: async (path: string) => {
        if (path === outputPath) throw missing;
        return { isSymbolicLink: () => false };
      },
      open: async (
        path: string,
        flags: "r" | "wx",
        mode?: number,
      ) => {
        events.push(`open:${path}:${flags}:${mode ?? ""}`);
        return (flags === "wx" ? fileHandle : directoryHandle) as never;
      },
      chmod: async (path: string, mode: number) => {
        events.push(`chmod:${path}:${mode.toString(8)}`);
      },
      rename: async (from: string, to: string) => {
        events.push(`rename:${from}:${to}`);
      },
      unlink: async (path: string) => {
        events.push(`unlink:${path}`);
      },
      randomId: () => "synthetic-id",
      processId: 4242,
    } satisfies SecureWriterDependencies;

    await createAtomicWriteSecureJson(dependencies)(outputPath, {
      artifact_version: 1,
    });

    expect(events).toEqual([
      `open:${temporaryPath}:wx:384`,
      `write:utf8:${JSON.stringify({ artifact_version: 1 }, null, 2)}\n`,
      "file:sync",
      "file:close",
      `chmod:${temporaryPath}:600`,
      `rename:${temporaryPath}:${outputPath}`,
      `chmod:${outputPath}:600`,
      `open:${process.cwd()}:r:`,
      "directory:sync",
      "directory:close",
    ]);
  });

  test("does not treat non-Error or intermediate ENOENT values as a missing target", async () => {
    const outputPath = join(process.cwd(), "nested", "artifact.json");
    const baseDependencies = {
      open: async () => {
        throw new Error("open must not run");
      },
      chmod: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
      randomId: () => "synthetic-id",
      processId: 4242,
    };

    for (const failure of [
      { code: "ENOENT" },
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    ]) {
      const writer = createAtomicWriteSecureJson({
        ...baseDependencies,
        lstat: async (path: string) => {
          if (path === outputPath) throw failure;
          return { isSymbolicLink: () => false };
        },
      } as SecureWriterDependencies);
      await expect(writer(outputPath, { artifact_version: 1 })).rejects.toBe(
        failure,
      );
    }

    const intermediateMissing = Object.assign(
      new Error("intermediate component missing"),
      { code: "ENOENT" },
    );
    const intermediateWriter = createAtomicWriteSecureJson({
      ...baseDependencies,
      lstat: async () => {
        throw intermediateMissing;
      },
    } as SecureWriterDependencies);
    await expect(
      intermediateWriter(outputPath, { artifact_version: 1 }),
    ).rejects.toBe(intermediateMissing);
  });

  test("preserves a directory-open failure when no directory handle exists", async () => {
    const outputPath = join(process.cwd(), "synthetic-directory-failure.json");
    const directoryFailure = new Error("synthetic directory open failure");
    const fileHandle = {
      writeFile: async () => undefined,
      sync: async () => undefined,
      close: async () => undefined,
    };
    const dependencies = {
      lstat: async () => ({ isSymbolicLink: () => false }),
      open: async (_path: string, flags: "r" | "wx") => {
        if (flags === "r") throw directoryFailure;
        return fileHandle as never;
      },
      chmod: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
      randomId: () => "synthetic-id",
      processId: 4242,
    } satisfies SecureWriterDependencies;

    await expect(
      createAtomicWriteSecureJson(dependencies)(outputPath, {
        artifact_version: 1,
      }),
    ).rejects.toBe(directoryFailure);
  });

  test("closes and unlinks an injected temporary file after write failure", async () => {
    const events: string[] = [];
    const outputPath = join(process.cwd(), "synthetic-failure.json");
    const temporaryPath = join(
      process.cwd(),
      ".synthetic-failure.json.4242.synthetic-id.tmp",
    );
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const dependencies = {
      lstat: async (path: string) => {
        if (path === outputPath) throw missing;
        return { isSymbolicLink: () => false };
      },
      open: async () =>
        ({
          writeFile: async () => {
            events.push("write:failed");
            throw new Error("synthetic write failure");
          },
          sync: async () => undefined,
          close: async () => {
            events.push("file:close");
          },
        }) as never,
      chmod: async () => undefined,
      rename: async () => undefined,
      unlink: async (path: string) => {
        events.push(`unlink:${path}`);
      },
      randomId: () => "synthetic-id",
      processId: 4242,
    } satisfies SecureWriterDependencies;

    await expect(
      createAtomicWriteSecureJson(dependencies)(outputPath, {
        artifact_version: 1,
      }),
    ).rejects.toThrow("synthetic write failure");
    expect(events).toEqual([
      "write:failed",
      "file:close",
      `unlink:${temporaryPath}`,
    ]);
  });

  test("derives isolated checkpoint filenames from safe organization hashes", () => {
    const first = stableSecretHash("central", HASH_SALT);
    const second = stableSecretHash("carveout", HASH_SALT);
    const firstPath = checkpointPathForOrganization(
      "docs/spikes/probe.checkpoint.json",
      first,
    );
    const secondPath = checkpointPathForOrganization(
      "docs/spikes/probe.checkpoint.json",
      second,
    );

    expect(firstPath).not.toBe(secondPath);
    expect(firstPath).toMatch(
      /^docs\/spikes\/probe\.checkpoint\.[a-f0-9]{64}\.json$/,
    );
    expect(firstPath).not.toContain("central");
    expect(
      checkpointPathForOrganization("docs/spikes/checkpoint", first),
    ).toMatch(/^docs\/spikes\/checkpoint\.[a-f0-9]{64}\.json$/);
    expect(() =>
      checkpointPathForOrganization(
        "docs/spikes/probe.checkpoint.json",
        `prefix-${first}`,
      ),
    ).toThrow("organization reference hash is not a safe HMAC");
    expect(() =>
      checkpointPathForOrganization(
        "docs/spikes/probe.checkpoint.json",
        `${first}-suffix`,
      ),
    ).toThrow("organization reference hash is not a safe HMAC");
    expect(() =>
      checkpointPathForOrganization(
        "docs/spikes/probe.checkpoint.json",
        "../unsafe",
      ),
    ).toThrow("organization reference hash is not a safe HMAC");
    expect(() =>
      assertDistinctPersistencePaths({
        manifestPath: "manifest.json",
        outputPath: "artifact.json",
        checkpointPaths: [firstPath, `./${firstPath}`],
      }),
    ).toThrow("probe persistence paths must be distinct");
  });

  test("rejects persistence path collisions before the first network request", async () => {
    const organizationHash = stableSecretHash("central", HASH_SALT);
    const checkpointBase = "synthetic-checkpoint.json";
    const derivedCheckpoint = checkpointPathForOrganization(
      checkpointBase,
      organizationHash,
    );
    const scenarios = [
      {
        manifestPath: "synthetic-shared.json",
        outputPath: "./synthetic-shared.json",
      },
      {
        manifestPath: "synthetic-manifest.json",
        outputPath: derivedCheckpoint,
      },
      {
        manifestPath: derivedCheckpoint,
        outputPath: "synthetic-artifact.json",
      },
    ];

    for (const scenario of scenarios) {
      let networkCalls = 0;
      let writes = 0;
      const stderr: string[] = [];
      const exitCode = await executeProbeCli({
        argv: [
          "--manifest",
          scenario.manifestPath,
          "--output",
          scenario.outputPath,
          "--checkpoint",
          checkpointBase,
          "--date",
          "2026-07-24",
        ],
        runtime: {
          environment: AUTHORIZED_ENVIRONMENT,
          now: () => FIXED_NOW,
          readText: async () =>
            JSON.stringify({ organizations: [ORGANIZATION] }),
          fetchImpl: (async () => {
            networkCalls += 1;
            throw new Error("network must not be reached");
          }) as typeof fetch,
          writeSecureJson: async () => {
            writes += 1;
          },
        },
        stdout: () => undefined,
        stderr: (message) => stderr.push(message),
      });

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([
        `${JSON.stringify({ status: "probe_failed" })}\n`,
      ]);
      expect(networkCalls).toBe(0);
      expect(writes).toBe(0);
    }
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

  test("binds the Admin response to the operator-supplied organization hash", () => {
    const trusted = {
      id: "org_synthetic_trusted",
      name: "Synthetic Trusted Organization",
      type: "organization",
    };
    expect(
      verifyProviderOrganization(200, trusted, EXPECTED_ORG_HASH, HASH_SALT),
    ).toBe(true);
    expect(
      verifyProviderOrganization(
        200,
        { ...trusted, id: "org_synthetic_wrong" },
        EXPECTED_ORG_HASH,
        HASH_SALT,
      ),
    ).toBe(false);
    expect(
      verifyProviderOrganization(
        200,
        { ...trusted, type: "user" },
        EXPECTED_ORG_HASH,
        HASH_SALT,
      ),
    ).toBe(false);
    expect(JSON.stringify(EXPECTED_ORG_HASH)).not.toContain(
      "org_synthetic_trusted",
    );
    expect(
      verifyProviderOrganization(199, trusted, EXPECTED_ORG_HASH, HASH_SALT),
    ).toBe(false);
    expect(
      verifyProviderOrganization(300, trusted, EXPECTED_ORG_HASH, HASH_SALT),
    ).toBe(false);
    expect(
      verifyProviderOrganization(
        200,
        { name: "Missing ID", type: "organization" },
        EXPECTED_ORG_HASH,
        HASH_SALT,
      ),
    ).toBe(false);
  });

  test("does not mutate or checkpoint before provider target verification", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: false,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport([], calls),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result).toEqual({
      status: "not_executed",
      reason: "provider_target_not_verified",
      checkpoint_file: "synthetic-checkpoint.json",
    });
    expect(calls).toEqual([]);
    expect(checkpoints).toEqual([]);
  });

  test("does not mutate or checkpoint without complete operator authorization", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: {
        ...AUTHORIZED_ENVIRONMENT,
        PROBE_CANARY_EMAIL_APPROVED: "false",
      },
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport([], calls),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result).toEqual({
      status: "not_executed",
      reason: "email_not_approved",
      checkpoint_file: "synthetic-checkpoint.json",
    });
    expect(calls).toEqual([]);
    expect(checkpoints).toEqual([]);
  });

  test("checkpoints authorization before create and confirms cleanup", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: BodyInit | null | undefined;
    }> = [];
    const checkpoints: Record<string, unknown>[] = [];
    const responses = [
      jsonResponse(201, {
        type: "invite",
        id: "invite_synthetic_canary",
        email: "canary@example.invalid",
        status: "pending",
        role: "user",
      }),
      jsonResponse(200, {
        type: "invite_deleted",
        id: "invite_synthetic_canary",
      }),
    ];
    let responseIndex = 0;
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        calls.push({
          url: input instanceof Request ? input.url : input.toString(),
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body: init?.body,
        });
        const response = responses[responseIndex];
        responseIndex += 1;
        if (!response) throw new Error("synthetic sequence exhausted");
        return response;
      }) as typeof fetch,
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(calls).toEqual([
      {
        url: "https://api.anthropic.com/v1/organizations/invites",
        method: "POST",
        headers: {
          accept: "application/json",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "user-agent": "Ledger-US-054-Probe/1.0",
          "x-api-key": "admin-secret",
        },
        body: JSON.stringify({
          email: "canary@example.invalid",
          role: "user",
        }),
      },
      {
        url:
          "https://api.anthropic.com/v1/organizations/invites/" +
          "invite_synthetic_canary",
        method: "DELETE",
        headers: {
          accept: "application/json",
          "anthropic-version": "2023-06-01",
          "user-agent": "Ledger-US-054-Probe/1.0",
          "x-api-key": "admin-secret",
        },
        body: undefined,
      },
    ]);
    const checkpointBase = {
      checkpoint_version: 1,
      organization_ref_hash: stableSecretHash("central", HASH_SALT),
      provider_target_verified: true,
      updated_at: FIXED_NOW.toISOString(),
    };
    expect(checkpoints).toEqual([
      {
        ...checkpointBase,
        state: "authorized_canary_pending",
        manual_review_required: true,
      },
      {
        ...checkpointBase,
        state: "invite_create_confirmed",
        manual_review_required: true,
      },
      {
        ...checkpointBase,
        state: "invite_cleanup_confirmed",
        manual_review_required: false,
      },
    ]);
    expect(result).toMatchObject({
      status: "executed_and_cleaned_up",
      checkpoint: { classification: "persisted" },
      create: {
        endpoint: "invite_canary_create",
        key_kind: "admin",
        status: 201,
      },
      cleanup: {
        endpoint: "invite_canary_delete",
        key_kind: "admin",
        status: 200,
      },
    });
    expect(JSON.stringify(checkpoints)).not.toContain(
      "invite_synthetic_canary",
    );
  });

  test("enforces create and cleanup HTTP/schema boundaries in the mutation flow", async () => {
    const runScenario = async (
      create: Response,
      cleanup?: Response,
    ): Promise<{
      result: Record<string, unknown>;
      calls: Array<{ url: string; method: string }>;
      checkpoints: Record<string, unknown>[];
    }> => {
      const calls: Array<{ url: string; method: string }> = [];
      const checkpoints: Record<string, unknown>[] = [];
      const responses = cleanup ? [create, cleanup] : [create];
      const result = await runInviteCanary({
        organization: ORGANIZATION,
        adminKey: "admin-secret",
        hashSalt: HASH_SALT,
        organizationRefHash: stableSecretHash("central", HASH_SALT),
        providerTargetVerified: true,
        checkpointPath: "synthetic-checkpoint.json",
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        fetchImpl: sequencedTransport(responses, calls),
        writeCheckpoint: async (_path, checkpoint) => {
          checkpoints.push(checkpoint);
        },
      });
      return { result, calls, checkpoints };
    };
    const validInvite = {
      type: "invite",
      id: "invite_boundary",
      email: "canary@example.invalid",
      status: "pending",
    };
    const validDelete = {
      type: "invite_deleted",
      id: "invite_boundary",
    };

    const lowerSuccess = await runScenario(
      jsonResponse(200, validInvite),
      jsonResponse(200, validDelete),
    );
    expect(lowerSuccess.calls.map(({ method }) => method)).toEqual([
      "POST",
      "DELETE",
    ]);
    expect(lowerSuccess.result.status).toBe("executed_and_cleaned_up");

    for (const status of [199, 300]) {
      const response = jsonResponse(
        status === 199 ? 200 : status,
        validInvite,
      );
      if (status === 199) {
        Object.defineProperty(response, "status", { value: 199 });
        Object.defineProperty(response, "ok", { value: false });
      }
      const rejected = await runScenario(response);
      expect(rejected.calls).toEqual([
        {
          url: "https://api.anthropic.com/v1/organizations/invites",
          method: "POST",
        },
      ]);
      expect(rejected.checkpoints.at(-1)).toMatchObject({
        state: "invite_create_rejected",
        manual_review_required: true,
      });
      expect(rejected.result).toMatchObject({
        status: "attempted_not_created",
        cleanup: null,
      });
    }

    const invalidCreate = await runScenario(
      jsonResponse(201, { ...validInvite, type: "wrong" }),
    );
    expect(invalidCreate.calls).toHaveLength(1);
    expect(invalidCreate.checkpoints.at(-1)).toMatchObject({
      state: "invite_create_indeterminate",
    });
    expect(invalidCreate.result).toMatchObject({
      status: "indeterminate_manual_review_required",
      cleanup: { status: "not_confirmed" },
    });

    const rejectedCleanup = await runScenario(
      jsonResponse(201, validInvite),
      jsonResponse(500, validDelete),
    );
    expect(rejectedCleanup.checkpoints.at(-1)).toMatchObject({
      state: "invite_cleanup_indeterminate",
      manual_review_required: true,
    });
    expect(rejectedCleanup.result.status).toBe(
      "indeterminate_manual_review_required",
    );
  });

  test("never deletes an ID returned by a non-success create response", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(400, {
            type: "invite",
            id: "invite_must_not_delete",
            email: "canary@example.invalid",
            status: "pending",
          }),
        ],
        calls,
      ),
      writeCheckpoint: async () => undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(result.status).toBe("attempted_not_created");
  });

  test("marks a 2xx create without a contract-valid ID as indeterminate", async () => {
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [jsonResponse(201, { type: "invite", status: "pending" })],
        [],
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result.status).toBe("indeterminate_manual_review_required");
    expect(checkpoints.at(-1)).toMatchObject({
      state: "invite_create_indeterminate",
      manual_review_required: true,
    });
  });

  test("persists indeterminate evidence for create transport failure", async () => {
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: (async () => {
        throw new Error("synthetic create transport failure");
      }) as typeof fetch,
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(checkpoints.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_create_indeterminate",
    ]);
    expect(checkpoints.at(-1)?.manual_review_required).toBe(true);
    expect(result).toEqual({
      status: "indeterminate_manual_review_required",
      checkpoint_file: "synthetic-checkpoint.json",
      checkpoint: { classification: "persisted" },
      create: { classification: "network_or_transport_failure" },
      cleanup: { status: "not_confirmed" },
    });
  });

  test("does not POST when the pre-mutation checkpoint cannot be persisted", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport([], calls),
      writeCheckpoint: async () => {
        throw new Error("synthetic checkpoint persistence failure");
      },
    });

    expect(calls).toEqual([]);
    expect(result).toEqual({
      status: "indeterminate_manual_review_required",
      checkpoint_file: "synthetic-checkpoint.json",
      checkpoint: { classification: "checkpoint_persistence_failure" },
      create: { status: "not_attempted" },
      cleanup: null,
    });
  });

  test("separates create checkpoint failure from transport and still cleans up", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const persisted: Record<string, unknown>[] = [];
    let writeNumber = 0;
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(201, {
            type: "invite",
            id: "invite_synthetic_canary",
            email: "canary@example.invalid",
            status: "pending",
            role: "user",
          }),
          jsonResponse(200, {
            type: "invite_deleted",
            id: "invite_synthetic_canary",
          }),
        ],
        calls,
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        writeNumber += 1;
        if (writeNumber === 2) {
          throw new Error("synthetic create-checkpoint failure");
        }
        persisted.push(checkpoint);
      },
    });

    expect(calls.map(({ method }) => method)).toEqual(["POST", "DELETE"]);
    expect(persisted.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_cleanup_confirmed",
    ]);
    expect(persisted[0]?.manual_review_required).toBe(true);
    expect(persisted[1]?.manual_review_required).toBe(false);
    expect(result).toMatchObject({
      status: "indeterminate_manual_review_required",
      checkpoint: { classification: "checkpoint_persistence_failure" },
    });
    expect(result.create).not.toEqual({
      classification: "network_or_transport_failure",
    });
  });

  test("preserves create-confirmed manual-review evidence when cleanup checkpoint fails", async () => {
    const persisted: Record<string, unknown>[] = [];
    let writeNumber = 0;
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(201, {
            type: "invite",
            id: "invite_synthetic_canary",
            email: "canary@example.invalid",
            status: "pending",
            role: "user",
          }),
          jsonResponse(200, {
            type: "invite_deleted",
            id: "invite_synthetic_canary",
          }),
        ],
        [],
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        writeNumber += 1;
        if (writeNumber === 3) {
          throw new Error("synthetic cleanup-checkpoint failure");
        }
        persisted.push(checkpoint);
      },
    });

    expect(persisted.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_create_confirmed",
    ]);
    expect(
      persisted.every(
        ({ manual_review_required }) => manual_review_required === true,
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      status: "indeterminate_manual_review_required",
      checkpoint: { classification: "checkpoint_persistence_failure" },
    });
  });

  test("persists indeterminate evidence for cleanup rejection and transport failure", async () => {
    for (const cleanupResponse of [
      jsonResponse(500, { type: "error" }),
      new Error("synthetic cleanup transport failure"),
    ]) {
      const checkpoints: Record<string, unknown>[] = [];
      let requestNumber = 0;
      const result = await runInviteCanary({
        organization: ORGANIZATION,
        adminKey: "admin-secret",
        hashSalt: HASH_SALT,
        organizationRefHash: stableSecretHash("central", HASH_SALT),
        providerTargetVerified: true,
        checkpointPath: "synthetic-checkpoint.json",
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        fetchImpl: (async () => {
          requestNumber += 1;
          if (requestNumber === 1) {
            return jsonResponse(201, {
              type: "invite",
              id: "invite_synthetic_canary",
              email: "canary@example.invalid",
              status: "pending",
              role: "user",
            });
          }
          if (cleanupResponse instanceof Error) throw cleanupResponse;
          return cleanupResponse;
        }) as typeof fetch,
        writeCheckpoint: async (_path, checkpoint) => {
          checkpoints.push(checkpoint);
        },
      });

      expect(result.status).toBe("indeterminate_manual_review_required");
      expect(checkpoints.at(-1)).toMatchObject({
        state: "invite_cleanup_indeterminate",
        manual_review_required: true,
      });
      if (cleanupResponse instanceof Error) {
        expect(result.cleanup).toEqual({
          status: "indeterminate_manual_review_required",
          classification: "network_or_transport_failure",
        });
      }
    }
  });

  test("classifies create and cleanup status boundaries exactly", () => {
    const classify = (
      createStatus: number | null,
      hasInviteId: boolean,
      cleanupStatus: number | null,
      createTransportFailure = false,
      cleanupTransportFailure = false,
    ) =>
      classifyInviteCanaryOutcome({
        createStatus,
        hasInviteId,
        cleanupStatus,
        createTransportFailure,
        cleanupTransportFailure,
      });

    expect(classify(null, false, null, true)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(null, false, null)).toBe("attempted_not_created");
    expect(classify(199, false, null)).toBe("attempted_not_created");
    expect(classify(200, false, null)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(299, true, 200)).toBe("executed_and_cleaned_up");
    expect(classify(300, true, 200)).toBe("attempted_not_created");
    expect(classify(201, true, 200, false, true)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(201, true, 199)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(201, true, 299)).toBe("executed_and_cleaned_up");
    expect(classify(201, true, 300)).toBe(
      "indeterminate_manual_review_required",
    );
  });

  test("returns non-zero CLI status for an indeterminate create", async () => {
    const writes: Array<{
      path: string;
      value: Record<string, unknown>;
    }> = [];
    const stderr: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(201, { type: "invite", status: "pending" }),
          ],
          [],
        ),
        writeSecureJson: async (path, value) => {
          writes.push({ path, value });
        },
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(stderr).toEqual([
      `${JSON.stringify({
        status: "canary_manual_review_required",
      })}\n`,
    ]);
    expect(
      writes.some(
        ({ path, value }) =>
          path.startsWith("synthetic-checkpoint.") &&
          path.endsWith(".json") &&
          value.state === "authorized_canary_pending",
      ),
    ).toBe(true);
    expect(
      writes.some(({ path }) => path === "synthetic-artifact.json"),
    ).toBe(true);
  });

  test("preserves manual-review precedence when checkpoint and artifact writes fail", async () => {
    const stderr: string[] = [];
    const writes: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
          ],
          [],
        ),
        writeSecureJson: async (path) => {
          if (path.startsWith("synthetic-checkpoint.")) {
            throw new Error("synthetic checkpoint persistence failure");
          }
          writes.push(path);
          throw new Error("synthetic artifact persistence failure");
        },
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(stderr).toEqual([
      `${JSON.stringify({
        status: "canary_manual_review_required",
        context: "artifact_write_failed",
      })}\n`,
    ]);
    expect(writes).toEqual(["synthetic-artifact.json"]);
  });

  test("keeps cleanup checkpoint evidence when artifact writing fails", async () => {
    const checkpoints: Record<string, unknown>[] = [];
    const stderr: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(201, {
              type: "invite",
              id: "invite_synthetic_canary",
              email: "canary@example.invalid",
              status: "pending",
            }),
            jsonResponse(200, {
              type: "invite_deleted",
              id: "invite_synthetic_canary",
            }),
          ],
          [],
        ),
        writeSecureJson: async (path, value) => {
          if (path === "synthetic-artifact.json") {
            throw new Error("synthetic artifact boundary failure");
          }
          checkpoints.push(value);
        },
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${JSON.stringify({ status: "probe_failed" })}\n`,
    ]);
    expect(checkpoints.at(-1)).toMatchObject({
      state: "invite_cleanup_confirmed",
      manual_review_required: false,
    });
  });

  test("returns zero and a sanitized summary when mutation is not authorized", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
    const keysUsed: string[] = [];
    const responses = [
      jsonResponse(200, {
        id: "org_synthetic_trusted",
        name: "Synthetic Trusted Organization",
        type: "organization",
      }),
      jsonResponse(200, {
        data: [],
        has_more: false,
        first_id: null,
        last_id: null,
      }),
      jsonResponse(200, {
        data: [],
        has_more: false,
        first_id: null,
        last_id: null,
      }),
      jsonResponse(200, { data: [], next_page: null }),
      jsonResponse(200, { summaries: [] }),
      jsonResponse(200, {
        data: [],
        has_more: false,
        next_page: null,
      }),
      jsonResponse(200, {
        data: [],
        has_more: false,
        next_page: null,
      }),
    ];
    let responseIndex = 0;
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: {
          ...AUTHORIZED_ENVIRONMENT,
          PROBE_ALLOW_INVITE_MUTATION: "false",
          PROBE_HASH_SALT: "x".repeat(32),
        },
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({
            organizations: [{
              ...ORGANIZATION,
              expectedOrganizationIdHash: stableSecretHash(
                "org_synthetic_trusted",
                "x".repeat(32),
              ),
            }],
          }),
        fetchImpl: (async (
          _input: string | URL | Request,
          init?: RequestInit,
        ) => {
          keysUsed.push(new Headers(init?.headers).get("x-api-key") ?? "");
          const response = responses[responseIndex];
          responseIndex += 1;
          if (!response) {
            throw new Error("synthetic contract sequence exhausted");
          }
          return response;
        }) as typeof fetch,
        writeSecureJson: async (path, value) => {
          writes.push({ path, value });
        },
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(writes.map(({ path }) => path)).toEqual([
      "synthetic-artifact.json",
    ]);
    expect(keysUsed).toEqual(
      probeDefinitions.map(({ keyKind }) =>
        keyKind === "admin" ? "admin-secret" : "analytics-secret",
      ),
    );
    expect(writes[0]?.value).toMatchObject({
      artifact_version: 1,
      requested_utc_date: "2026-07-24",
      raw_bodies_persisted: false,
      organizations: [
        {
          provider_target_verified: true,
          invite_canary: {
            status: "not_executed",
            reason: "mutation_not_enabled",
          },
        },
      ],
    });
    expect(stdout).toEqual([
      `${JSON.stringify({
        status: "sanitized_artifact_written",
        output: "synthetic-artifact.json",
        organizations: 1,
      })}\n`,
    ]);
  });

  test("maps invalid manifest JSON to a generic non-zero CLI result", async () => {
    const stderr: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () => "{invalid-json",
        fetchImpl: sequencedTransport([], []),
        writeSecureJson: async () => undefined,
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${JSON.stringify({ status: "invalid_manifest_json" })}\n`,
    ]);
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
