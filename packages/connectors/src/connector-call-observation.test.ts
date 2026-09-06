import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  buildConnectorCallSummary,
  createConnectorCallObservationSession,
  type ConnectorCallObservationAppendInput,
} from "./connector-call-observation.js";

const VENDOR_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROVISIONING_ACTION_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";

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
    [
      "methods",
      "connectorMethods",
      ["GET", "POST", "DELETE"],
    ],
  ] as const)("exports exact immutable connector %s", async (_label, exportName, expected) => {
    vi.resetModules();
    const actual = (await import("./connector-call-observation.js"))[exportName];

    expect(actual).toEqual(expected);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(() => (actual as unknown as string[]).push("unknown")).toThrow(TypeError);
    expect(actual).toEqual(expected);
  });
});

function clockFrom(...values: readonly string[]): () => Date {
  let index = 0;
  return () => new Date(values[index++]!);
}

function createSession(overrides: Readonly<{
  append?: (input: ConnectorCallObservationAppendInput) => Promise<void>;
  clock?: () => Date;
  operation?: "provision" | "deprovision" | "sync_members" | "sync_activity" | "sync_cost";
  provisioningActionId?: string | null;
  randomId?: () => string;
  vendorAccountId?: string;
}> = {}) {
  return createConnectorCallObservationSession({
    vendorAccountId: VENDOR_ACCOUNT_ID,
    provisioningActionId: null,
    operation: "sync_members",
    clock: clockFrom("2026-09-06T12:00:00.000Z"),
    randomId: () => CORRELATION_ID,
    append: async () => undefined,
    ...overrides,
  });
}

describe("connector call observation session", () => {
  it("appends the exact requested and succeeded lifecycle evidence", async () => {
    const appended: ConnectorCallObservationAppendInput[] = [];
    const session = createSession({
      clock: clockFrom(
        "2026-09-06T12:00:00.000Z",
        "2026-09-06T12:00:01.000Z",
      ),
      append: async (input) => {
        appended.push(input);
      },
    });

    const receipt = await session.requested({
      endpointClass: "members",
      method: "GET",
    });
    await session.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 200,
    });

    expect(appended).toEqual([
      {
        vendorAccountId: VENDOR_ACCOUNT_ID,
        provisioningActionId: null,
        correlationId: CORRELATION_ID,
        operation: "sync_members",
        attempt: 1,
        phase: "requested",
        classification: null,
        summary: { endpoint_class: "members", method: "GET" },
        occurredAt: new Date("2026-09-06T12:00:00.000Z"),
      },
      {
        vendorAccountId: VENDOR_ACCOUNT_ID,
        provisioningActionId: null,
        correlationId: CORRELATION_ID,
        operation: "sync_members",
        attempt: 1,
        phase: "succeeded",
        classification: "success",
        summary: {
          endpoint_class: "members",
          method: "GET",
          http_status: 200,
          status_class: "success",
        },
        occurredAt: new Date("2026-09-06T12:00:01.000Z"),
      },
    ]);
    expect(Object.isFrozen(appended[0]!.summary)).toBe(true);
    expect(Object.isFrozen(appended[1]!.summary)).toBe(true);
  });

  it("appends the exact failed lifecycle evidence", async () => {
    const appended: ConnectorCallObservationAppendInput[] = [];
    const session = createSession({
      append: async (input) => {
        appended.push(input);
      },
    });

    const receipt = await session.requested({ endpointClass: "members", method: "GET" });
    await session.failed(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 429,
      classification: "rate_limited",
    });

    expect(appended[1]).toEqual(expect.objectContaining({
      attempt: 1,
      phase: "failed",
      classification: "rate_limited",
      summary: {
        endpoint_class: "members",
        method: "GET",
        http_status: 429,
        status_class: "rate_limited",
      },
    }));
  });

  it("allocates increasing attempts while generating one correlation ID", async () => {
    let randomIdCalls = 0;
    const session = createSession({
      randomId: () => {
        randomIdCalls += 1;
        return CORRELATION_ID;
      },
    });

    const first = await session.requested({ endpointClass: "members", method: "GET" });
    const second = await session.requested({ endpointClass: "members", method: "GET" });

    expect(session.correlationId).toBe(CORRELATION_ID);
    expect(first).toEqual({ attempt: 1 });
    expect(second).toEqual({ attempt: 2 });
    expect(randomIdCalls).toBe(1);
  });

  it("rejects a terminal receipt issued by another session", async () => {
    const first = createSession();
    const second = createSession();
    const receipt = await first.requested({ endpointClass: "members", method: "GET" });

    await expect(second.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 200,
    })).rejects.toThrowError("Connector attempt receipt does not belong to this session");
  });

  it("rejects a second terminal completion for the same receipt", async () => {
    const session = createSession();
    const receipt = await session.requested({ endpointClass: "members", method: "GET" });
    await session.failed(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 503,
      classification: "provider_error",
    });

    await expect(session.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 200,
    })).rejects.toThrowError("Connector attempt receipt has already been completed");
  });

  it("allows only one concurrent terminal completion to append", async () => {
    const terminalAppends: ConnectorCallObservationAppendInput[] = [];
    let releaseFirstTerminalAppend: (() => void) | undefined;
    let signalFirstTerminalAppendStarted: () => void = () => undefined;
    const firstTerminalAppendStarted = new Promise<void>((resolve) => {
      signalFirstTerminalAppendStarted = resolve;
    });
    const session = createSession({
      append: async (input) => {
        if (input.phase === "requested") return;
        terminalAppends.push(input);
        if (terminalAppends.length === 1) {
          signalFirstTerminalAppendStarted();
          await new Promise<void>((release) => {
            releaseFirstTerminalAppend = release;
          });
        }
      },
    });
    const receipt = await session.requested({ endpointClass: "members", method: "GET" });
    const succeeded = session.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 200,
    });

    await firstTerminalAppendStarted;
    const failed = session.failed(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus: 503,
      classification: "provider_error",
    });
    const terminalSettlements = Promise.allSettled([succeeded, failed]);
    releaseFirstTerminalAppend?.();

    await expect(terminalSettlements).resolves.toEqual([
      { status: "fulfilled", value: undefined },
      {
        status: "rejected",
        reason: new Error("Connector attempt receipt has already been completed"),
      },
    ]);
    expect(terminalAppends).toEqual([
      expect.objectContaining({ phase: "succeeded", classification: "success" }),
    ]);
  });

  it.each([
    ["vendor account", { vendorAccountId: "not-a-uuid" }, "Invalid connector vendor account ID"],
    [
      "vendor account prefix",
      { vendorAccountId: `prefix-${VENDOR_ACCOUNT_ID}` },
      "Invalid connector vendor account ID",
    ],
    [
      "vendor account suffix",
      { vendorAccountId: `${VENDOR_ACCOUNT_ID}-suffix` },
      "Invalid connector vendor account ID",
    ],
    ["correlation", { randomId: () => "not-a-uuid" }, "Invalid connector correlation ID"],
    [
      "provisioning action",
      { operation: "provision" as const, provisioningActionId: "not-a-uuid" },
      "Invalid connector provisioning action ID",
    ],
    [
      "sync action link",
      { provisioningActionId: PROVISIONING_ACTION_ID },
      "Sync connector observations cannot link a provisioning action",
    ],
    [
      "operation",
      { operation: "unrecognized" as "sync_members" },
      "Invalid connector operation",
    ],
  ] as const)("rejects an invalid %s session boundary", (_label, overrides, message) => {
    expect(() => createSession(overrides)).toThrowError(message);
  });

  it.each(["provision", "deprovision"] as const)(
    "accepts a provisioning action for the %s operation",
    (operation) => {
    expect(() => createSession({
      operation,
      provisioningActionId: PROVISIONING_ACTION_ID,
    })).not.toThrow();
    },
  );

  it.each(["sync_members", "sync_activity", "sync_cost"] as const)(
    "rejects a provisioning action for the %s operation",
    (operation) => {
      expect(() => createSession({
        operation,
        provisioningActionId: PROVISIONING_ACTION_ID,
      })).toThrowError("Sync connector observations cannot link a provisioning action");
    },
  );

  it.each([99, 600])("rejects an out-of-range terminal HTTP status %i", async (httpStatus) => {
    const session = createSession();
    const receipt = await session.requested({ endpointClass: "members", method: "GET" });

    await expect(session.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus,
    })).rejects.toThrowError("Invalid connector HTTP status");
  });

  it.each([100, 599])("accepts the inclusive terminal HTTP status boundary %i", async (httpStatus) => {
    const session = createSession();
    const receipt = await session.requested({ endpointClass: "members", method: "GET" });

    await expect(session.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus,
    })).resolves.toBeUndefined();
  });

  it.each(["success", "unknown"] as const)(
    "rejects %s as a failed terminal classification",
    async (classification) => {
      const session = createSession();
      const receipt = await session.requested({ endpointClass: "members", method: "GET" });

      await expect(session.failed(receipt, {
        endpointClass: "members",
        method: "GET",
        httpStatus: 500,
        classification,
      } as never)).rejects.toThrowError("Invalid connector failure classification");
    },
  );

  it("returns a terminal receipt to pending when its append fails", async () => {
    const terminalPhases: string[] = [];
    let rejectFirstTerminal = true;
    const session = createSession({
      append: async (observation) => {
        if (observation.phase === "requested") return;
        terminalPhases.push(observation.phase);
        if (rejectFirstTerminal) {
          rejectFirstTerminal = false;
          throw new Error("journal unavailable");
        }
      },
    });
    const receipt = await session.requested({ endpointClass: "members", method: "GET" });
    const response = {
      endpointClass: "members" as const,
      method: "GET" as const,
      httpStatus: 200,
    };

    await expect(session.succeeded(receipt, response)).rejects.toThrowError("journal unavailable");
    await expect(session.succeeded(receipt, response)).resolves.toBeUndefined();
    expect(terminalPhases).toEqual(["succeeded", "succeeded"]);
  });
});

describe("connector call summary allowlist", () => {
  it.each([
    ["phase", "Invalid connector phase", {
      phase: "unknown",
      endpointClass: "members",
      method: "GET",
    }],
    ["endpoint class", "Invalid connector endpoint class", {
      phase: "requested",
      endpointClass: "unknown",
      method: "GET",
    }],
    ["classification", "Invalid connector classification", {
      phase: "failed",
      endpointClass: "members",
      method: "GET",
      httpStatus: 500,
      classification: "unknown",
    }],
    ["missing classification", "Invalid connector classification", {
      phase: "failed",
      endpointClass: "members",
      method: "GET",
      httpStatus: 500,
    }],
  ] as const)("rejects an input outside the closed connector %s vocabulary", (
    _label,
    message,
    input,
  ) => {
    expect(() => buildConnectorCallSummary(
      input as never,
    )).toThrowError(message);
  });

  it.each([
    ["hostile string", "authorization-sentinel"],
    ["hostile object", { body: "body-sentinel" }],
  ] as const)("rejects a %s in the allowlisted method field", (_label, method) => {
    expect(() => buildConnectorCallSummary({
      phase: "requested",
      endpointClass: "members",
      method,
    } as never)).toThrowError("Invalid connector method");
  });

  it.each([
    ["hostile string", "email-sentinel"],
    ["hostile object", { authorization: "authorization-sentinel" }],
    ["fractional number", 200.5],
    ["below-range number", 99],
    ["above-range number", 600],
  ] as const)(
    "rejects a %s in the allowlisted HTTP status field",
    (_label, httpStatus) => {
      expect(() => buildConnectorCallSummary({
        phase: "succeeded",
        endpointClass: "members",
        method: "GET",
        httpStatus,
        classification: "success",
      } as never)).toThrowError("Invalid connector HTTP status");
    },
  );

  it.each([
    [
      {
        phase: "requested" as const,
        endpointClass: "members" as const,
        method: "GET" as const,
      },
      ["endpoint_class", "method"],
    ],
    [
      {
        phase: "succeeded" as const,
        endpointClass: "members" as const,
        method: "GET" as const,
        httpStatus: 200,
        classification: "success" as const,
      },
      ["endpoint_class", "http_status", "method", "status_class"],
    ],
    [
      {
        phase: "failed" as const,
        endpointClass: "members" as const,
        method: "GET" as const,
        httpStatus: 429,
        classification: "rate_limited" as const,
      },
      ["endpoint_class", "http_status", "method", "status_class"],
    ],
  ] as const)("discards nested sensitive and unknown fields for %s summaries", (
    valid,
    allowedKeysForPhase,
  ) => {
    const forbiddenSentinels = [
      "credential-sentinel",
      "authorization-sentinel",
      "email-sentinel",
      "pii-sentinel",
      "provider-id-sentinel",
      "url-sentinel",
      "body-sentinel",
      "exception-sentinel",
      "unknown-field-sentinel",
    ] as const;
    const sensitiveValue = fc.oneof(
      ...forbiddenSentinels.map((sentinel) => fc.constant(sentinel)),
      fc.array(fc.constantFrom(...forbiddenSentinels), { minLength: 1, maxLength: 3 }),
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...forbiddenSentinels),
        { minKeys: 1, maxKeys: 3 },
      ),
    );
    const arbitrarySensitiveFields = fc.record({
      credentials: sensitiveValue,
      authorization: sensitiveValue,
      email: sensitiveValue,
      pii: sensitiveValue,
      providerId: sensitiveValue,
      url: sensitiveValue,
      body: sensitiveValue,
      exception: sensitiveValue,
      unknownField: sensitiveValue,
    });

    fc.assert(
      fc.property(arbitrarySensitiveFields, (unknownFields) => {
        const buildSummary = (input: unknown) =>
          buildConnectorCallSummary(input as Parameters<typeof buildConnectorCallSummary>[0]);
        const summary = buildSummary({ ...valid, ...unknownFields });

        expect(Object.keys(summary).sort()).toEqual(allowedKeysForPhase);
        for (const forbiddenSentinel of forbiddenSentinels) {
          expect(JSON.stringify(summary)).not.toContain(forbiddenSentinel);
        }
        expect(buildSummary({ ...valid, ...unknownFields })).toEqual(buildSummary(valid));
      }),
      { seed: 57001, numRuns: 100 },
    );
  });
});
