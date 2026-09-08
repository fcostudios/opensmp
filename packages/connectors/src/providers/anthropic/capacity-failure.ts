import type { AnthropicEndpoint } from "./endpoints.js";

export type AnthropicCapacityFailureCode = "capacity_unavailable";

export const anthropicCapacityFailureMessages = Object.freeze([
  "Your organization has reached its seat limit.",
] as const);

const maximumBodyBytes = 8_192;

/** Parse only the object/string grammar used by the closed two-level error envelope.
 * The caller bounds input to 8 KiB; depth is bounded independently. Decode string
 * tokens with the native JSON parser, but never let it erase duplicate object
 * members. Decoded-key comparison also rejects Unicode-escaped duplicates.
 */
function parseUniqueEnvelope(text: string): unknown {
  let offset = 0;
  function invalid(): never {
    throw new Error("INVALID_CAPACITY_ENVELOPE");
  }
  function whitespace(): void {
    while (" \t\r\n".includes(text[offset] ?? "\0")) offset += 1;
  }
  function consume(token: string): void {
    whitespace();
    if (text[offset] !== token) invalid();
    offset += 1;
  }
  function string(): string {
    whitespace();
    const start = offset;
    consume('"');
    while (offset < text.length) {
      const token = text[offset];
      offset += 1;
      if (token === '"') return JSON.parse(text.slice(start, offset)) as string;
      // Skip exactly one escaped character; JSON.parse validates escape syntax,
      // Unicode digits, control characters, and string termination.
      if (token === "\\") offset += 1;
    }
    return invalid();
  }
  function value(depth: number): unknown {
    whitespace();
    if (text[offset] === '"') return string();
    if (depth >= 2) invalid();
    consume("{");
    const object: Record<string, unknown> = Object.create(null);
    whitespace();
    if (text[offset] !== "}") {
      for (;;) {
        const key = string();
        if (Object.hasOwn(object, key)) invalid();
        consume(":");
        object[key] = value(depth + 1);
        whitespace();
        if (text[offset] === "}") break;
        consume(",");
      }
    }
    consume("}");
    return object;
  }
  const result = value(0);
  whitespace();
  if (offset !== text.length) invalid();
  return result;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
  ) return null;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isJsonMediaType(response: Response): boolean {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    === "application/json";
}

async function cancel(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel();
  } catch {
    // Provider-owned cancellation failures cannot alter a safe semantic result.
  }
}

async function readBoundedUtf8(body: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined || length + value.byteLength > maximumBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
      length += value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function readAnthropicCapacityFailure(
  response: Response,
  endpoint: AnthropicEndpoint,
): Promise<AnthropicCapacityFailureCode | null> {
  if (
    endpoint !== "create_invite"
    || response.status !== 400
    || !isJsonMediaType(response)
    || response.body === null
  ) {
    if (response.body !== null) await cancel(response.body);
    return null;
  }

  const text = await readBoundedUtf8(response.body);
  if (text === null) return null;
  try {
    const envelope = exactRecord(parseUniqueEnvelope(text), ["type", "error"]);
    if (envelope === null) return null;
    const error = exactRecord(envelope.error, ["type", "message"]);
    if (error === null) return null;
    if (
      envelope.type === "error"
      && error.type === "invalid_request_error"
      && anthropicCapacityFailureMessages.includes(
        error.message as (typeof anthropicCapacityFailureMessages)[number],
      )
    ) {
      return "capacity_unavailable";
    }
  } catch {
    // Provider-controlled parser failures remain generic provider errors.
  }
  return null;
}
