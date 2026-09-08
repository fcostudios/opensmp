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
    ["8,193-byte body", "x".repeat(8_193)],
  ])("fails closed for %s and releases the provider body", async (_case, body) => {
    const { response, cancelled } = streamedResponse(body, {
      leaveOpen: _case === "8,193-byte body",
    });

    await expect(readAnthropicCapacityFailure(response, "create_invite")).resolves.toBeNull();
    expect(response.body?.locked).toBe(false);
    expect(cancelled()).toBe(_case === "8,193-byte body");
  });
});
