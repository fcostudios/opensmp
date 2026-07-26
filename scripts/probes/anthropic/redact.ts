import { createHmac } from "node:crypto";

import {
  classifyHttpResult,
  inspectEndpointSchema,
  type KeyKind,
} from "./schemas.ts";

const SENSITIVE_FIELD =
  /^(?:id|.*_id|email|email_address|name|first_id|last_id|organization_id)$/i;
const RATE_LIMIT_HEADER = /^anthropic-ratelimit-[a-z0-9-]+$/;

export interface SanitizedObservation {
  endpoint: string;
  key_kind: KeyKind;
  status: number;
  classification: ReturnType<typeof classifyHttpResult>;
  beta_header: {
    sent: string | null;
    response: string | null;
  };
  response_headers: {
    retry_after: string | null;
    rate_limit: Record<string, string>;
    request_id_hash: string | null;
  };
  schema: ReturnType<typeof inspectEndpointSchema>;
  sensitive_value_hashes: string[];
}

export function stableSecretHash(value: string, salt: string): string {
  if (salt.length < 32) {
    throw new Error("PROBE_HASH_SALT must contain at least 32 characters");
  }
  return `hmac-sha256:${createHmac("sha256", salt).update(value).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectSensitiveHashes(
  value: unknown,
  salt: string,
  output = new Set<string>(),
): string[] {
  if (Array.isArray(value)) {
    for (const child of value) collectSensitiveHashes(child, salt, output);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (
        SENSITIVE_FIELD.test(key) &&
        (typeof child === "string" || typeof child === "number")
      ) {
        output.add(stableSecretHash(String(child), salt));
      } else {
        collectSensitiveHashes(child, salt, output);
      }
    }
  }
  return [...output].sort();
}

function normalizedHeaders(
  headers: Headers | Record<string, string>,
): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

export function createSanitizedObservation(input: {
  endpoint: string;
  keyKind: KeyKind;
  status: number;
  headers: Headers | Record<string, string>;
  body: unknown;
  hashSalt: string;
  sentBetaHeader: string | null;
}): SanitizedObservation {
  const headers = normalizedHeaders(input.headers);
  const rateLimit = Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => RATE_LIMIT_HEADER.test(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const requestId = headers["request-id"] ?? headers["x-request-id"];

  return {
    endpoint: input.endpoint,
    key_kind: input.keyKind,
    status: input.status,
    classification: classifyHttpResult(input.status),
    beta_header: {
      sent: input.sentBetaHeader,
      response: headers["anthropic-beta"] ?? null,
    },
    response_headers: {
      retry_after: headers["retry-after"] ?? null,
      rate_limit: rateLimit,
      request_id_hash: requestId
        ? stableSecretHash(requestId, input.hashSalt)
        : null,
    },
    schema: inspectEndpointSchema(input.endpoint, input.body),
    sensitive_value_hashes: collectSensitiveHashes(
      input.body,
      input.hashSalt,
    ),
  };
}
