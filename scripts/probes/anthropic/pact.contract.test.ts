import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MatchersV3,
  PactV3,
  type TemplateHeaders,
  type V3Request,
  type V3Response,
} from "@pact-foundation/pact";
import { afterAll, describe, expect, test } from "vitest";

import { request } from "./probe.ts";
import {
  classifyHttpResult,
  decimalCentsToUsd,
  inspectEndpointSchema,
  inviteId,
} from "./schemas.ts";

const { eachLike, like, regex } = MatchersV3;
const pactDirectory = mkdtempSync(join(tmpdir(), "ledger-anthropic-pacts-"));
const contractPath = join(
  pactDirectory,
  "ledger-anthropic-probe-anthropic-enterprise-api.json",
);

type KeyKind = "admin" | "analytics";

function contractHeaders(keyKind: KeyKind): TemplateHeaders {
  return {
    accept: "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": regex(
      "^contract-(admin|analytics)-key$",
      `contract-${keyKind}-key`,
    ),
  };
}

async function executeContract(input: {
  description: string;
  keyKind: KeyKind;
  endpoint: string;
  request: V3Request;
  response: V3Response;
  verify?: (body: unknown, response: Response) => void;
}): Promise<void> {
  const provider = new PactV3({
    consumer: "ledger-anthropic-probe",
    provider: "anthropic-enterprise-api",
    dir: pactDirectory,
    logLevel: "error",
  });
  provider.addInteraction({
    uponReceiving: input.description,
    withRequest: {
      ...input.request,
      headers: {
        ...contractHeaders(input.keyKind),
        ...input.request.headers,
      },
    },
    willRespondWith: input.response,
  });

  await provider.executeTest(async (mockServer) => {
    const key = `contract-${input.keyKind}-key`;
    const init: RequestInit = { method: input.request.method };
    if (input.request.body !== undefined) {
      init.body = JSON.stringify(input.request.body);
      init.headers = { "content-type": "application/json" };
    }
    const result = await request(
      new URL(String(input.request.path), mockServer.url),
      key,
      init,
    );

    expect(result.response.status).toBe(input.response.status);
    if (input.response.status !== 204 && input.response.status !== 429) {
      expect(inspectEndpointSchema(input.endpoint, result.body).valid).toBe(
        true,
      );
    }
    input.verify?.(result.body, result.response);
  });
}

describe("Anthropic enterprise API consumer contract", () => {
  test("current organization", async () => {
    await executeContract({
      description: "returns the current organization",
      keyKind: "admin",
      endpoint: "organization",
      request: { method: "GET", path: "/v1/organizations/me" },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          type: "organization",
          id: like("org_contract"),
          name: like("Ledger Contract"),
        },
      },
    });
  });

  test("members", async () => {
    await executeContract({
      description: "lists organization members with ID pagination",
      keyKind: "admin",
      endpoint: "members",
      request: { method: "GET", path: "/v1/organizations/users" },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: [
            {
              type: "user",
              id: like("user_contract_null_email"),
              name: like("Contract Member"),
              email: null,
            },
            {
              type: "user",
              id: like("user_contract_email"),
              name: like("Contract Member Two"),
              email: like("member@example.invalid"),
            },
          ],
          has_more: like(true),
          first_id: like("user_contract_null_email"),
          last_id: like("user_contract_email"),
        },
      },
    });
  });

  test("invites", async () => {
    await executeContract({
      description: "lists organization invites with ID pagination",
      keyKind: "admin",
      endpoint: "invites",
      request: { method: "GET", path: "/v1/organizations/invites" },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: eachLike({
            type: "invite",
            id: like("inv_contract"),
            email: like("canary@example.invalid"),
            status: like("pending"),
          }),
          has_more: like(false),
          first_id: like("inv_contract"),
          last_id: like("inv_contract"),
        },
      },
    });
  });

  test("create invite", async () => {
    await executeContract({
      description: "creates an organization invite",
      keyKind: "admin",
      endpoint: "invite_canary_create",
      request: {
        method: "POST",
        path: "/v1/organizations/invites",
        headers: { "content-type": "application/json" },
        body: { email: "canary@example.invalid", role: "user" },
      },
      response: {
        status: 201,
        headers: { "content-type": "application/json" },
        body: {
          type: "invite",
          id: like("inv_contract"),
          email: like("canary@example.invalid"),
          status: like("pending"),
        },
      },
      verify: (body) => {
        expect(inviteId(body)).toBe("inv_contract");
      },
    });
  });

  test("withdraw invite", async () => {
    await executeContract({
      description: "withdraws an organization invite",
      keyKind: "admin",
      endpoint: "invite_canary_delete",
      request: {
        method: "DELETE",
        path: "/v1/organizations/invites/inv_contract",
      },
      response: { status: 204 },
      verify: (body, response) => {
        expect(body).toBeNull();
        expect(classifyHttpResult(response.status)).toBe("success");
      },
    });
  });

  test("analytics users", async () => {
    await executeContract({
      description: "lists analytics users with an opaque next page",
      keyKind: "analytics",
      endpoint: "activity_users",
      request: {
        method: "GET",
        path: "/v1/organizations/analytics/users",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: eachLike({
            user_id: like("user_contract"),
            email: like("member@example.invalid"),
          }),
          next_page: like("opaque_contract_page"),
        },
      },
    });
  });

  test("analytics summaries", async () => {
    await executeContract({
      description: "returns analytics summary counters",
      keyKind: "analytics",
      endpoint: "activity_summaries",
      request: {
        method: "GET",
        path: "/v1/organizations/analytics/summaries",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          summaries: eachLike({
            date: like("2026-07-30"),
            active_users: like(3),
            conversations: like(12),
          }),
        },
      },
    });
  });

  test("usage report", async () => {
    await executeContract({
      description: "returns the organization usage report",
      keyKind: "analytics",
      endpoint: "usage_report",
      request: {
        method: "GET",
        path: "/v1/organizations/analytics/usage_report",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: eachLike({
            starting_at: like("2026-07-30T00:00:00Z"),
            ending_at: like("2026-07-31T00:00:00Z"),
            input_tokens: like("123.4567"),
            output_tokens: like("42.0000"),
          }),
          next_page: null,
        },
      },
    });
  });

  test("user usage report", async () => {
    await executeContract({
      description: "returns user usage with a nullable email",
      keyKind: "analytics",
      endpoint: "user_usage_report",
      request: {
        method: "GET",
        path: "/v1/organizations/analytics/user_usage_report",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: [
            {
              user_id: like("user_contract"),
              email: null,
              input_tokens: like("10.5"),
              output_tokens: like("2.25"),
            },
          ],
          next_page: null,
        },
      },
    });
  });

  test("cost report", async () => {
    await executeContract({
      description: "returns exact fractional-cent organization costs",
      keyKind: "analytics",
      endpoint: "cost_report",
      request: {
        method: "GET",
        path: "/v1/organizations/analytics/cost_report",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: eachLike({
            results: eachLike({
              amount: like("123.4567"),
              list_amount: like("125.0000"),
              currency: like("USD"),
            }),
          }),
          next_page: null,
        },
      },
      verify: () => {
        expect(decimalCentsToUsd("123.4567")).toBe("1.234567");
      },
    });
  });

  test("user cost report", async () => {
    await executeContract({
      description: "returns exact fractional-cent user costs",
      keyKind: "analytics",
      endpoint: "user_cost_report",
      request: {
        method: "GET",
        path: "/v1/organizations/analytics/user_cost_report",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: eachLike({
            user_id: like("user_contract"),
            email: null,
            results: eachLike({
              amount: like("123.4567"),
              list_amount: like("125.0000"),
              currency: like("USD"),
            }),
          }),
          next_page: null,
        },
      },
      verify: () => {
        expect(decimalCentsToUsd("123.4567")).toBe("1.234567");
      },
    });
  });

  test("rate limited", async () => {
    await executeContract({
      description: "classifies an Anthropic rate limit response",
      keyKind: "admin",
      endpoint: "organization",
      request: { method: "GET", path: "/v1/organizations/me" },
      response: {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "2",
        },
        body: {
          type: "error",
          error: {
            type: "rate_limit_error",
            message: like("Rate limit exceeded"),
          },
        },
      },
      verify: (_body, response) => {
        expect(response.headers.get("retry-after")).toBe("2");
        expect(classifyHttpResult(response.status)).toBe("rate_limited");
      },
    });
  });
});

afterAll(() => {
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
    interactions?: Array<{ description?: string }>;
  };
  expect(contract.interactions).toHaveLength(12);
  expect(
    new Set(contract.interactions?.map(({ description }) => description)).size,
  ).toBe(12);
  rmSync(pactDirectory, { recursive: true, force: true });
});
