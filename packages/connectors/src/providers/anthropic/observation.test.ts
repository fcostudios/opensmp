import { describe, expect, it } from "vitest";

import {
  createConnectorCallObservationSession,
  type ConnectorCallObservationAppendInput,
} from "../../connector-call-observation.js";
import type {
  AnthropicAttemptClassification,
  AnthropicAttemptObservation,
  AnthropicAttemptObserver,
} from "./request.js";
import { createAnthropicConnectorObservationBridge } from "./observation.js";

const VENDOR_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";

function createBridgeFixture() {
  const appended: ConnectorCallObservationAppendInput[] = [];
  const session = createConnectorCallObservationSession({
    vendorAccountId: VENDOR_ACCOUNT_ID,
    provisioningActionId: null,
    operation: "sync_members",
    clock: () => new Date("2026-09-06T12:00:00.000Z"),
    randomId: () => CORRELATION_ID,
    append: async (input) => {
      appended.push(input);
    },
  });

  const bridge: AnthropicAttemptObserver =
    createAnthropicConnectorObservationBridge(session);

  return {
    appended,
    bridge,
    session,
  };
}

function observation(
  overrides: Partial<AnthropicAttemptObservation>,
): AnthropicAttemptObservation {
  return {
    endpoint: "members",
    method: "GET",
    attempt: 1,
    phase: "requested",
    observedAt: 1_000,
    status: null,
    classification: null,
    ...overrides,
  } as AnthropicAttemptObservation;
}

describe("Anthropic connector observation bridge", () => {
  it.each([
    ["organization", "organization", "GET"],
    ["members", "members", "GET"],
    ["invites", "invitations", "GET"],
    ["create_invite", "invitations", "POST"],
    ["delete_invite", "invitations", "DELETE"],
    ["analytics_users", "activity", "GET"],
    ["analytics_summaries", "activity", "GET"],
    ["usage_report", "usage", "GET"],
    ["cost_report", "cost", "GET"],
  ] as const)(
    "maps Anthropic %s observations to the neutral %s endpoint class",
    async (endpoint, endpointClass, method) => {
      const { appended, bridge } = createBridgeFixture();

      await bridge(observation({ endpoint, method }));
      await bridge(observation({
        endpoint,
        method,
        phase: "completed",
        status: 200,
        classification: "success",
      }));

      expect(appended.map(({ attempt, phase, classification, summary }) => ({
        attempt,
        phase,
        classification,
        summary,
      }))).toEqual([
        {
          attempt: 1,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: endpointClass, method },
        },
        {
          attempt: 1,
          phase: "succeeded",
          classification: "success",
          summary: {
            endpoint_class: endpointClass,
            method,
            http_status: 200,
            status_class: "success",
          },
        },
      ]);
    },
  );

  it.each([
    [429, "rate_limited"],
    [503, "provider_error"],
    [404, "client_error"],
  ] as const)(
    "maps completed HTTP %i/%s to a neutral failed outcome",
    async (status, classification) => {
      const { appended, bridge } = createBridgeFixture();
      await bridge(observation({}));

      await bridge(observation({
        phase: "completed",
        status,
        classification,
      }));

      expect(appended[1]).toMatchObject({
        attempt: 1,
        phase: "failed",
        classification,
        summary: {
          endpoint_class: "members",
          method: "GET",
          http_status: status,
          status_class: classification,
        },
      });
    },
  );

  it("keeps one correlation while allocating increasing neutral attempts after a local restart", async () => {
    const { appended, bridge, session } = createBridgeFixture();

    for (const status of [503, 200]) {
      await bridge(observation({ attempt: 1 }));
      await bridge(observation({
        attempt: 1,
        phase: "completed",
        status,
        classification: status === 200 ? "success" : "provider_error",
      }));
    }

    expect(session.correlationId).toBe(CORRELATION_ID);
    expect(appended.map(({ correlationId, attempt, phase }) => ({
      correlationId,
      attempt,
      phase,
    }))).toEqual([
      { correlationId: CORRELATION_ID, attempt: 1, phase: "requested" },
      { correlationId: CORRELATION_ID, attempt: 1, phase: "failed" },
      { correlationId: CORRELATION_ID, attempt: 2, phase: "requested" },
      { correlationId: CORRELATION_ID, attempt: 2, phase: "succeeded" },
    ]);
  });

  it("rejects an overlapping duplicate local attempt before it can misattribute terminal evidence", async () => {
    const appended: ConnectorCallObservationAppendInput[] = [];
    let releaseFirstPersistence!: () => void;
    const firstPersistence = new Promise<void>((resolve) => {
      releaseFirstPersistence = resolve;
    });
    let requestedAppends = 0;
    const session = createConnectorCallObservationSession({
      vendorAccountId: VENDOR_ACCOUNT_ID,
      provisioningActionId: null,
      operation: "sync_members",
      clock: () => new Date("2026-09-06T12:00:00.000Z"),
      randomId: () => CORRELATION_ID,
      append: async (input) => {
        if (input.phase === "requested" && requestedAppends++ === 0) {
          await firstPersistence;
        }
        appended.push(input);
      },
    });
    const bridge: AnthropicAttemptObserver =
      createAnthropicConnectorObservationBridge(session);

    const firstRequest = bridge(observation({ endpoint: "members", method: "GET" }));
    const conflictingRequest = expect(bridge(observation({
      endpoint: "cost_report",
      method: "GET",
    }))).rejects.toThrowError(
      "Anthropic requested observation conflicts with an in-flight attempt",
    );
    const prematureCompletion = expect(bridge(observation({
      endpoint: "members",
      method: "GET",
      phase: "completed",
      status: 200,
      classification: "success",
    }))).rejects.toThrowError(
      "Anthropic completed observation has no matching requested attempt",
    );
    releaseFirstPersistence();

    await firstRequest;
    await conflictingRequest;
    await prematureCompletion;
    await bridge(observation({
      endpoint: "members",
      method: "GET",
      phase: "completed",
      status: 200,
      classification: "success",
    }));

    expect(appended.map(({ attempt, phase, summary }) => ({
      attempt,
      phase,
      summary,
    }))).toEqual([
      {
        attempt: 1,
        phase: "requested",
        summary: { endpoint_class: "members", method: "GET" },
      },
      {
        attempt: 1,
        phase: "succeeded",
        summary: {
          endpoint_class: "members",
          method: "GET",
          http_status: 200,
          status_class: "success",
        },
      },
    ]);
  });

  it("releases a local-attempt reservation when requested persistence rejects", async () => {
    const appended: ConnectorCallObservationAppendInput[] = [];
    let rejectRequestedPersistence = true;
    const session = createConnectorCallObservationSession({
      vendorAccountId: VENDOR_ACCOUNT_ID,
      provisioningActionId: null,
      operation: "sync_members",
      clock: () => new Date("2026-09-06T12:00:00.000Z"),
      randomId: () => CORRELATION_ID,
      append: async (input) => {
        if (input.phase === "requested" && rejectRequestedPersistence) {
          rejectRequestedPersistence = false;
          throw new Error("requested persistence unavailable");
        }
        appended.push(input);
      },
    });
    const bridge: AnthropicAttemptObserver =
      createAnthropicConnectorObservationBridge(session);

    await expect(bridge(observation({}))).rejects.toThrowError(
      "requested persistence unavailable",
    );
    await bridge(observation({}));
    await bridge(observation({
      phase: "completed",
      status: 200,
      classification: "success",
    }));

    expect(appended.map(({ attempt, phase }) => ({ attempt, phase }))).toEqual([
      { attempt: 2, phase: "requested" },
      { attempt: 2, phase: "succeeded" },
    ]);
  });

  it("rejects a completed observation without its matching requested receipt", async () => {
    const { bridge } = createBridgeFixture();

    await expect(bridge(observation({
      phase: "completed",
      status: 200,
      classification: "success",
    }))).rejects.toThrowError(
      "Anthropic completed observation has no matching requested attempt",
    );
  });

  it.each([
    ["endpoint", { endpoint: "cost_report" }],
    ["method", { method: "POST" }],
  ] as const)(
    "rejects a completed observation with a mismatched %s without consuming the requested receipt",
    async (_identityField, mismatch) => {
      const { appended, bridge } = createBridgeFixture();
      await bridge(observation({ endpoint: "members", method: "GET" }));

      await expect(bridge(observation({
        ...mismatch,
        phase: "completed",
        status: 200,
        classification: "success",
      }))).rejects.toThrowError(
        "Anthropic completed observation does not match its requested endpoint and method",
      );
      expect(appended).toHaveLength(1);

      await bridge(observation({
        endpoint: "members",
        method: "GET",
        phase: "completed",
        status: 200,
        classification: "success",
      }));
      expect(appended[1]).toMatchObject({
        attempt: 1,
        phase: "succeeded",
        summary: {
          endpoint_class: "members",
          method: "GET",
          http_status: 200,
          status_class: "success",
        },
      });
    },
  );

  it("constructs a neutral allowlisted summary without retaining provider-only fields", async () => {
    const { appended, bridge } = createBridgeFixture();
    const providerOnly = {
      authorization: "credential-sentinel",
      email: "member@example.test",
      body: { secret: "body-sentinel" },
    };

    await bridge({
      ...observation({}),
      providerOnly,
    } as AnthropicAttemptObservation & { providerOnly: typeof providerOnly });

    expect(appended[0]!.summary).toEqual({
      endpoint_class: "members",
      method: "GET",
    });
    expect(JSON.stringify(appended[0])).not.toContain("sentinel");
    expect(JSON.stringify(appended[0])).not.toContain("member@example.test");
  });

  it("rejects a completed transport ambiguity instead of fabricating a terminal response", async () => {
    const { appended, bridge } = createBridgeFixture();
    await bridge(observation({}));

    await expect(bridge(observation({
      phase: "completed",
      status: 520,
      classification: "transport_ambiguous" as AnthropicAttemptClassification,
    }))).rejects.toThrowError("Anthropic completed observation requires a known response");
    expect(appended).toHaveLength(1);
  });

  it.each([
    [null, "success"],
    [200, null],
  ] as const)(
    "rejects completed metadata with status %s and classification %s",
    async (status, classification) => {
      const { appended, bridge } = createBridgeFixture();
      await bridge(observation({}));

      await expect(bridge(observation({
        phase: "completed",
        status,
        classification,
      }))).rejects.toThrowError(
        "Anthropic completed observation requires a known response",
      );
      expect(appended).toHaveLength(1);
    },
  );
});
