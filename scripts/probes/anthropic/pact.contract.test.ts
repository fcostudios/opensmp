import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

import {
  createConnectorCallObservationSession,
  type ConnectorCallObservationAppendInput,
} from "../../../packages/connectors/src/connector-call-observation.ts";
import { createConnectorDispatcher } from "../../../packages/connectors/src/dispatch.ts";
import { createAnthropicConnector } from "../../../packages/connectors/src/providers/anthropic/connector.ts";
import type { AnthropicCredentialCandidate } from "../../../packages/connectors/src/providers/anthropic/credentials.ts";
import { createAnthropicRateLimiter } from "../../../packages/connectors/src/providers/anthropic/rate-limiter.ts";
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
const connectorPactDirectory = mkdtempSync(
  join(tmpdir(), "ledger-anthropic-connector-pacts-"),
);
const connectorContractPath = join(
  connectorPactDirectory,
  "ledger-anthropic-connector-anthropic-enterprise-api.json",
);
const vendorAccountId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const observedAt = new Date("2026-09-06T12:00:00.000Z");
const credentials: readonly AnthropicCredentialCandidate[] = Object.freeze([
  Object.freeze({
    vendorAccountId,
    kind: "admin_scoped" as const,
    secret: "contract-admin-key",
    status: "active" as const,
    health: "ok" as const,
  }),
  Object.freeze({
    vendorAccountId,
    kind: "analytics" as const,
    secret: "contract-analytics-key",
    status: "active" as const,
    health: "ok" as const,
  }),
]);

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

function connectorContractHeaders(keyKind: KeyKind): TemplateHeaders {
  const key = `contract-${keyKind}-key`;
  return {
    accept: "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": regex(`^${key}$`, key),
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

type ConnectorInteraction = Readonly<{
  description: string;
  keyKind: KeyKind;
  request: V3Request;
  response: V3Response;
}>;

function inspectThenCleanup(
  directories: readonly string[],
  inspect: () => void,
): void {
  try {
    inspect();
  } finally {
    for (const directory of directories) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function connectorInteraction(
  provider: PactV3,
  interaction: ConnectorInteraction,
): void {
  const responseHeaders = Object.fromEntries(
    Object.entries(interaction.response.headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== "content-type",
    ),
  );
  provider.addInteraction({
    uponReceiving: interaction.description,
    withRequest: {
      ...interaction.request,
      headers: {
        ...connectorContractHeaders(interaction.keyKind),
        ...interaction.request.headers,
      },
    },
    willRespondWith: {
      ...interaction.response,
      headers: responseHeaders,
    },
  });
}

async function executeConnectorContract<T>(input: Readonly<{
  interactions: readonly ConnectorInteraction[];
  invoke(connector: ReturnType<typeof createAnthropicConnector>): Promise<T>;
  verify(result: T, observations: readonly ConnectorCallObservationAppendInput[]): void;
}>): Promise<void> {
  const provider = new PactV3({
    consumer: "ledger-anthropic-connector",
    provider: "anthropic-enterprise-api",
    dir: connectorPactDirectory,
    logLevel: "error",
  });
  input.interactions.forEach((interaction) => connectorInteraction(provider, interaction));

  await provider.executeTest(async (mockServer) => {
    const observations: ConnectorCallObservationAppendInput[] = [];
    let clock = observedAt.getTime();
    let correlationSequence = 0;
    const limiter = createAnthropicRateLimiter({
      clock: { now: () => clock },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });
    const implementation = createAnthropicConnector({
      credentialsFor: async () => credentials,
      observationSessionFor: async ({ operation, requestId: linkedRequestId }) =>
        createConnectorCallObservationSession({
          vendorAccountId,
          provisioningActionId: linkedRequestId,
          operation,
          clock: () => new Date(clock),
          randomId: () => {
            correlationSequence += 1;
            return `33333333-3333-4333-8333-${String(correlationSequence).padStart(12, "0")}`;
          },
          append: async (observation) => {
            observations.push(observation);
          },
        }),
      requestDependencies: {
        clock: { now: () => clock },
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
        limiter,
        transport: async (providerRequest) => {
          const providerUrl = new URL(providerRequest.url);
          expect(providerUrl.origin).toBe("https://api.anthropic.com");
          const pactUrl = new URL(`${providerUrl.pathname}${providerUrl.search}`, mockServer.url);
          return fetch(new Request(pactUrl, providerRequest));
        },
      },
    });
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");
    const result = await input.invoke(connector as ReturnType<typeof createAnthropicConnector>);

    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("contract-admin-key");
    expect(JSON.stringify(result)).not.toContain("contract-analytics-key");
    for (const observation of observations) {
      expect(Object.keys(observation.summary).sort()).toEqual(
        observation.phase === "requested"
          ? ["endpoint_class", "method"]
          : ["endpoint_class", "http_status", "method", "status_class"],
      );
    }
    input.verify(result, observations);
  });
}

function expectJournal(
  observations: readonly ConnectorCallObservationAppendInput[],
  terminalClassifications: readonly (
    | "success"
    | "rate_limited"
    | "provider_error"
    | "client_error"
  )[],
): void {
  expect(observations).toHaveLength(terminalClassifications.length * 2);
  expect(observations.map(({ attempt, phase, classification }) => ({
    attempt,
    phase,
    classification,
  }))).toEqual(terminalClassifications.flatMap((classification, index) => [
    {
      attempt: index + 1,
      phase: "requested",
      classification: null,
    },
    {
      attempt: index + 1,
      phase: classification === "success" ? "succeeded" : "failed",
      classification,
    },
  ]));
  expect(new Set(observations.map(({ correlationId }) => correlationId)).size).toBe(1);
}

describe("Anthropic connector consumer contract", () => {
  test("removes every Pact directory when artifact inspection fails", () => {
    const first = mkdtempSync(join(tmpdir(), "ledger-pact-cleanup-first-"));
    const second = mkdtempSync(join(tmpdir(), "ledger-pact-cleanup-second-"));

    expect(() => inspectThenCleanup([first, second], () => {
      throw new Error("invalid Pact artifact");
    })).toThrowError("invalid Pact artifact");
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  test("provisions through the dispatcher without leaking provider data", async () => {
    await executeConnectorContract({
      interactions: [{
        description: "connector creates an organization invite",
        keyKind: "admin",
        request: {
          method: "POST",
          path: "/v1/organizations/invites",
          headers: { "content-type": "application/json" },
          body: { email: "member@example.invalid", role: "user" },
        },
        response: {
          status: 201,
          headers: { "content-type": "application/json" },
          body: {
            type: "invite",
            id: "invite/contract",
            email: "member@example.invalid",
            status: "pending",
          },
        },
      }],
      invoke: (connector) => connector.provision({
        requestId,
        vendorAccountId,
        personEmail: "member@example.invalid",
        licenseTypeName: "Enterprise",
      }),
      verify: (result, observations) => {
        expect(result).toEqual({
          ok: true,
          value: { vendorRef: "invite/contract" },
          raw: null,
        });
        if (!result.ok) throw new Error("expected connector success");
        expect(Object.isFrozen(result.value)).toBe(true);
        expectJournal(observations, ["success"]);
      },
    });
  });

  test("deprovisions a member after ID-cursor pagination and encodes its provider ID", async () => {
    await executeConnectorContract({
      interactions: [
        {
          description: "connector reads the first member page",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/users",
            query: { limit: "1000" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [{
                type: "user",
                id: "member/contract",
                name: "Member Contract",
                email: "member@example.invalid",
              }],
              has_more: true,
              first_id: "member/contract",
              last_id: "members-page-1",
            },
          },
        },
        {
          description: "connector follows the member after ID",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/users",
            query: { limit: "1000", after_id: "members-page-1" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], has_more: false, first_id: null, last_id: null },
          },
        },
        {
          description: "connector confirms no matching invitation",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/invites",
            query: { limit: "1000" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], has_more: false, first_id: null, last_id: null },
          },
        },
        {
          description: "connector deletes the encoded member ID",
          keyKind: "admin",
          request: { method: "DELETE", path: "/v1/organizations/users/member%2Fcontract" },
          response: { status: 204 },
        },
      ],
      invoke: (connector) => connector.deprovision({
        requestId,
        vendorAccountId,
        personEmail: "MEMBER@example.invalid",
        licenseTypeName: "Enterprise",
      }),
      verify: (result, observations) => {
        expect(result).toEqual({
          ok: true,
          value: { vendorRef: "member/contract" },
          raw: null,
        });
        expectJournal(observations, ["success", "success", "success", "success"]);
      },
    });
  });

  test("deprovisions an invitation after ID-cursor pagination and encodes its provider ID", async () => {
    await executeConnectorContract({
      interactions: [
        {
          description: "connector confirms no matching member",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/users",
            query: { limit: "1000" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], has_more: false, first_id: null, last_id: null },
          },
        },
        {
          description: "connector reads the first invitation page",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/invites",
            query: { limit: "1000" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [{
                type: "invite",
                id: "invite/contract",
                email: "member@example.invalid",
                status: "pending",
              }],
              has_more: true,
              first_id: "invite/contract",
              last_id: "invites-page-1",
            },
          },
        },
        {
          description: "connector follows the invitation after ID",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/invites",
            query: { limit: "1000", after_id: "invites-page-1" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], has_more: false, first_id: null, last_id: null },
          },
        },
        {
          description: "connector deletes the encoded invitation ID",
          keyKind: "admin",
          request: { method: "DELETE", path: "/v1/organizations/invites/invite%2Fcontract" },
          response: { status: 204 },
        },
      ],
      invoke: (connector) => connector.deprovision({
        requestId,
        vendorAccountId,
        personEmail: "member@example.invalid",
        licenseTypeName: "Enterprise",
      }),
      verify: (result, observations) => {
        expect(result).toEqual({
          ok: true,
          value: { vendorRef: "invite/contract" },
          raw: null,
        });
        expectJournal(observations, ["success", "success", "success", "success"]);
      },
    });
  });

  test("syncs members while omitting nullable provider emails", async () => {
    await executeConnectorContract({
      interactions: [
        {
          description: "connector reads members including a nullable email",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/users",
            query: { limit: "1000" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [
                { type: "user", id: "member-null", name: "No Email", email: null },
                { type: "user", id: "member-known", name: "Known", email: "active@example.invalid" },
              ],
              has_more: true,
              first_id: "member-null",
              last_id: "members-sync-page-1",
            },
          },
        },
        {
          description: "connector follows member sync pagination",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/users",
            query: { limit: "1000", after_id: "members-sync-page-1" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], has_more: false, first_id: null, last_id: null },
          },
        },
        {
          description: "connector reads pending invitations for member sync",
          keyKind: "admin",
          request: {
            method: "GET",
            path: "/v1/organizations/invites",
            query: { limit: "1000" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [{
                type: "invite",
                id: "invite-pending",
                email: "pending@example.invalid",
                status: "pending",
              }],
              has_more: false,
              first_id: "invite-pending",
              last_id: "invite-pending",
            },
          },
        },
      ],
      invoke: (connector) => connector.syncMembers({ vendorAccountId, observedAt }),
      verify: (result, observations) => {
        expect(result).toEqual({
          ok: true,
          value: {
            members: [
              { email: "active@example.invalid", active: true },
              { email: "pending@example.invalid", active: false },
            ],
          },
          raw: null,
        });
        expectJournal(observations, ["success", "success", "success"]);
      },
    });
  });

  test("syncs activity through dated opaque pagination and exact neutral counters", async () => {
    await executeConnectorContract({
      interactions: [
        {
          description: "connector reads the first dated analytics user page",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/users",
            query: { date: "2026-09-06" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [
                { user_id: "analytics-null", email: null },
                { user_id: "analytics-known", email: "active@example.invalid" },
              ],
              next_page: "analytics-page-1",
            },
          },
        },
        {
          description: "connector follows the analytics opaque page",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/users",
            query: { date: "2026-09-06", page: "analytics-page-1" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], next_page: null },
          },
        },
        {
          description: "connector reads dated activity summaries",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/summaries",
            query: { date: "2026-09-06" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              summaries: [{ date: "2026-09-06", active_users: 3, conversations: 12 }],
            },
          },
        },
      ],
      invoke: (connector) => connector.syncActivity({ vendorAccountId, observedAt }),
      verify: (result, observations) => {
        expect(result).toEqual({
          ok: true,
          value: {
            records: [{
              email: "active@example.invalid",
              activityDate: "2026-09-06",
              counters: { activeUsers: 3, conversations: 12 },
            }],
          },
          raw: null,
        });
        expectJournal(observations, ["success", "success", "success"]);
      },
    });
  });

  test("syncs exact fractional-cent cost through dated report pagination", async () => {
    const reportQuery = {
      starting_at: "2026-09-06T00:00:00Z",
      ending_at: "2026-09-07T00:00:00Z",
      bucket_width: "1d",
      limit: "1",
    };
    await executeConnectorContract({
      interactions: [
        {
          description: "connector reads the first dated user usage page",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/user_usage_report",
            query: reportQuery,
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [
                { user_id: "cost-null", email: null, input_tokens: "1", output_tokens: "2" },
                { user_id: "cost-known", email: "cost@example.invalid", input_tokens: "10.5", output_tokens: "2.25" },
              ],
              next_page: "usage-page-1",
            },
          },
        },
        {
          description: "connector follows the user usage opaque page",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/user_usage_report",
            query: { ...reportQuery, page: "usage-page-1" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], next_page: null },
          },
        },
        {
          description: "connector reads the first dated user cost page",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/user_cost_report",
            query: reportQuery,
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              data: [
                {
                  user_id: "cost-null",
                  email: null,
                  results: [{ amount: "1.0000", list_amount: "1.0000", currency: "USD" }],
                },
                {
                  user_id: "cost-known",
                  email: "cost@example.invalid",
                  results: [
                    { amount: "123.4567", list_amount: "125.0000", currency: "USD" },
                    { amount: "0.0001", list_amount: "0.0001", currency: "USD" },
                  ],
                },
              ],
              next_page: "cost-page-1",
            },
          },
        },
        {
          description: "connector follows the user cost opaque page",
          keyKind: "analytics",
          request: {
            method: "GET",
            path: "/v1/organizations/analytics/user_cost_report",
            query: { ...reportQuery, page: "cost-page-1" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { data: [], next_page: null },
          },
        },
      ],
      invoke: (connector) => connector.syncCost({ vendorAccountId, observedAt }),
      verify: (result, observations) => {
        expect(result).toEqual({
          ok: true,
          value: {
            records: [{
              email: "cost@example.invalid",
              costDate: "2026-09-06",
              amountUsd: "1.234568",
            }],
          },
          raw: null,
        });
        expectJournal(observations, ["success", "success", "success", "success"]);
      },
    });
  });

  test.each([
    [401, "client_error", false, {}],
    [503, "provider_error", false, {}],
    [429, "rate_limited", false, { "retry-after": "2", "anthropic-ratelimit-requests-remaining": "0" }],
  ] as const)(
    "classifies terminal HTTP %i as %s without exposing the provider response",
    async (status, classification, retryable, responseHeaders) => {
      await executeConnectorContract({
        interactions: [{
          description: `connector receives terminal ${status}`,
          keyKind: "admin",
          request: {
            method: "POST",
            path: "/v1/organizations/invites",
            headers: { "content-type": "application/json" },
            body: { email: "member@example.invalid", role: "user" },
          },
          response: {
            status,
            headers: { "content-type": "application/json", ...responseHeaders },
            body: {
              type: "error",
              error: { type: classification, message: `contract ${status}` },
            },
          },
        }],
        invoke: (connector) => connector.provision({
          requestId,
          vendorAccountId,
          personEmail: "member@example.invalid",
          licenseTypeName: "Enterprise",
        }),
        verify: (result, observations) => {
          expect(result).toEqual({
            ok: false,
            code: "provider_error",
            retryable,
            raw: null,
          });
          expect(observations.at(-1)).toMatchObject({
            phase: "failed",
            classification,
            summary: { http_status: status, status_class: classification },
          });
          expectJournal(observations, [classification]);
        },
      });
    },
  );
});

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

afterAll(() => inspectThenCleanup(
  [pactDirectory, connectorPactDirectory],
  () => {
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
      interactions?: Array<{ description?: string }>;
    };
    expect(contract.interactions).toHaveLength(12);
    expect(
      new Set(contract.interactions?.map(({ description }) => description)).size,
    ).toBe(12);
    expect(JSON.stringify(contract)).toContain(
      "^contract-(admin|analytics)-key$",
    );
    const connectorContract = JSON.parse(
      readFileSync(connectorContractPath, "utf8"),
    ) as { interactions?: Array<{ description?: string }> };
    expect(connectorContract.interactions).toHaveLength(22);
    expect(
      new Set(
        connectorContract.interactions?.map(({ description }) => description),
      ).size,
    ).toBe(22);
    const connectorContractJson = JSON.stringify(connectorContract);
    expect(connectorContractJson).toContain("^contract-admin-key$");
    expect(connectorContractJson).toContain("^contract-analytics-key$");
    expect(connectorContractJson).not.toContain(
      "^contract-(admin|analytics)-key$",
    );
  },
));
