import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildConnectorCallSummary,
  createConnectorCallObservationSession,
} from "./connector-call-observation.js";
import type {
  ConnectorCallObservationAppendInput,
} from "./contracts.js";

const VENDOR_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROVISIONING_ACTION_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";

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

  it.each([
    ["vendor account", { vendorAccountId: "not-a-uuid" }],
    ["correlation", { randomId: () => "not-a-uuid" }],
    ["sync action link", { provisioningActionId: PROVISIONING_ACTION_ID }],
    ["operation", { operation: "unrecognized" as "sync_members" }],
  ] as const)("rejects an invalid %s session boundary", (_label, overrides) => {
    expect(() => createSession(overrides)).toThrowError();
  });

  it("accepts a provisioning action only for provisioning operations", () => {
    expect(() => createSession({
      operation: "provision",
      provisioningActionId: PROVISIONING_ACTION_ID,
    })).not.toThrow();
  });

  it.each([99, 600])("rejects an out-of-range terminal HTTP status %i", async (httpStatus) => {
    const session = createSession();
    const receipt = await session.requested({ endpointClass: "members", method: "GET" });

    await expect(session.succeeded(receipt, {
      endpointClass: "members",
      method: "GET",
      httpStatus,
    })).rejects.toThrowError("Invalid connector HTTP status");
  });
});

describe("connector call summary allowlist", () => {
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
