import { describe, expect, it } from "vitest";

import { readAnthropicCapacityFailure } from "./capacity-failure.js";

const exactEnvelope = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "Your organization has reached its seat limit.",
  },
};

function streamedResponse(
  body: string,
  options: Readonly<{ status?: number; contentType?: string; leaveOpen?: boolean }> = {},
): Readonly<{ response: Response; cancelled: () => boolean }> {
  const encoder = new TextEncoder();
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      if (!options.leaveOpen) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  }), {
    status: options.status ?? 400,
    headers: { "content-type": options.contentType ?? "application/json" },
  });
  return { response, cancelled: () => cancelled };
}

describe("Anthropic capacity-failure classification", () => {
  it("recognizes only the exact bounded invite seat-limit envelope", async () => {
    // Mutations killed: broadening any envelope field or retaining provider text misroutes a generic failure.
    const { response } = streamedResponse(JSON.stringify(exactEnvelope));

    await expect(readAnthropicCapacityFailure(response, "create_invite"))
      .resolves.toBe("capacity_unavailable");
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    ["duplicate envelope type", '{"type":"success","type":"error","error":{"type":"invalid_request_error","message":"Your organization has reached its seat limit."}}'],
    ["duplicate envelope error", '{"type":"error","error":{},"error":{"type":"invalid_request_error","message":"Your organization has reached its seat limit."}}'],
    ["duplicate error type", '{"type":"error","error":{"type":"authentication_error","type":"invalid_request_error","message":"Your organization has reached its seat limit."}}'],
    ["duplicate error message", '{"type":"error","error":{"type":"invalid_request_error","message":"Bad request","message":"Your organization has reached its seat limit."}}'],
    ["identical duplicate", '{"type":"error","type":"error","error":{"type":"invalid_request_error","message":"Your organization has reached its seat limit."}}'],
    ["escaped envelope key", String.raw`{"type":"success","t\u0079pe":"error","error":{"type":"invalid_request_error","message":"Your organization has reached its seat limit."}}`],
    ["escaped error key", String.raw`{"type":"error","error":{"type":"invalid_request_error","message":"Bad request","m\u0065ssage":"Your organization has reached its seat limit."}}`],
  ])("rejects %s before duplicate members can be overwritten", async (_case, body) => {
    // Mutation killed: parsing objects with last-member-wins JSON.parse misclassifies these failures.
    const { response } = streamedResponse(body);
    await expect(readAnthropicCapacityFailure(response, "create_invite")).resolves.toBeNull();
  });

  it.each([
    ["another endpoint", "members", 400, "application/json", exactEnvelope],
    ["another status", "create_invite", 401, "application/json", exactEnvelope],
    ["non-JSON media type", "create_invite", 400, "text/plain", exactEnvelope],
    ["another error type", "create_invite", 400, "application/json", {
      ...exactEnvelope,
      error: { ...exactEnvelope.error, type: "authentication_error" },
    }],
    ["message case", "create_invite", 400, "application/json", {
      ...exactEnvelope,
      error: { ...exactEnvelope.error, message: "Your Organization Has Reached Its Seat Limit." },
    }],
    ["message prefix", "create_invite", 400, "application/json", {
      ...exactEnvelope,
      error: { ...exactEnvelope.error, message: `Error: ${exactEnvelope.error.message}` },
    }],
    ["message suffix", "create_invite", 400, "application/json", {
      ...exactEnvelope,
      error: { ...exactEnvelope.error, message: `${exactEnvelope.error.message} Contact support.` },
    }],
    ["message whitespace", "create_invite", 400, "application/json", {
      ...exactEnvelope,
      error: { ...exactEnvelope.error, message: ` ${exactEnvelope.error.message}` },
    }],
    ["array envelope", "create_invite", 400, "application/json", [exactEnvelope]],
    ["missing error message", "create_invite", 400, "application/json", {
      type: "error",
      error: { type: "invalid_request_error" },
    }],
    ["extra error field", "create_invite", 400, "application/json", {
      ...exactEnvelope,
      error: { ...exactEnvelope.error, request_id: "provider-request-sentinel" },
    }],
  ] as const)("fails closed for %s", async (_case, endpoint, status, contentType, envelope) => {
    const { response } = streamedResponse(JSON.stringify(envelope), { status, contentType });

    await expect(readAnthropicCapacityFailure(response, endpoint as "create_invite"))
      .resolves.toBeNull();
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    ["malformed JSON", "{\"type\":\"error\""],
    ["trailing document", `${JSON.stringify(exactEnvelope)} {}`],
    ["trailing comma", JSON.stringify(exactEnvelope).replace('"error",', '"error",,')],
    ["non-JSON whitespace", `\v${JSON.stringify(exactEnvelope)}`],
    ["nested value instead of message", '{"type":"error","error":{"type":"invalid_request_error","message":{}}}'],
    ["escaped quote inside a value", String.raw`{"type":"error","error":{"type":"invalid_request_error","message":"\"message\":\"Your organization has reached its seat limit."}}`],
    ["invalid string escape", String.raw`{"type":"error","error":{"type":"invalid_request_error","message":"Your organization has reached its seat limit.\q"}}`],
    ["8,193-byte body", "x".repeat(8_193)],
  ])("fails closed for %s and releases the provider body", async (_case, body) => {
    const { response, cancelled } = streamedResponse(body, {
      leaveOpen: _case === "8,193-byte body",
    });

    await expect(readAnthropicCapacityFailure(response, "create_invite")).resolves.toBeNull();
    expect(response.body?.locked).toBe(false);
    expect(cancelled()).toBe(_case === "8,193-byte body");
  });

  it("accepts legal whitespace, member ordering, and equivalent string escapes", async () => {
    // Mutations killed: stripping escape handling or rejecting valid formatting loses a real capacity failure.
    const { response } = streamedResponse(String.raw` {
      "error": {"m\u0065ssage":"Your organization has reached its seat limit\u002e", "type":"invalid_request_error"},
      "t\u0079pe": "error"
    } `);
    await expect(readAnthropicCapacityFailure(response, "create_invite"))
      .resolves.toBe("capacity_unavailable");
  });
});
