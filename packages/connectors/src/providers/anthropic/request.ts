import {
  credentialForPolicy,
  resolveAnthropicCredentials,
  type AnthropicCredentialCandidate,
} from "./credentials.js";
import {
  endpointPolicy,
  type AnthropicEndpoint,
  type AnthropicEndpointPolicy,
} from "./endpoints.js";
import type {
  AnthropicClock,
  AnthropicRateLimiter,
  AnthropicSleep,
} from "./rate-limiter.js";

export type AnthropicAttemptClassification =
  | "success" | "rate_limited" | "provider_error" | "client_error"
  | "transport_ambiguous";

export type AnthropicAttemptObservation = Readonly<{
  endpoint: AnthropicEndpoint;
  method: "GET" | "POST" | "DELETE";
  attempt: number;
  phase: "requested" | "completed";
  observedAt: number;
  status: number | null;
  classification: AnthropicAttemptClassification | null;
}>;

export type AnthropicAttemptObserver = (
  observation: AnthropicAttemptObservation,
) => Promise<void>;

export type AnthropicTransport = (request: Request) => Promise<Response>;

export type AnthropicRequestResult =
  | Readonly<{ ok: true; response: Response; attempts: number }>
  | Readonly<{
    ok: false;
    classification: Exclude<AnthropicAttemptClassification, "success">;
    status: number | null;
    attempts: number;
  }>;

export type ExecuteAnthropicRequestInput = Readonly<{
  endpoint: AnthropicEndpoint;
  vendorAccountId: string;
  credentials: readonly AnthropicCredentialCandidate[];
  parameters?: Readonly<{ resourceId?: string }>;
  body?: unknown;
}>;

export type AnthropicRequestExecutor = (
  input: ExecuteAnthropicRequestInput,
) => Promise<AnthropicRequestResult>;

function classifyStatus(status: number): AnthropicAttemptClassification {
  if (status >= 200 && status < 300) return "success";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status < 600) return "provider_error";
  return "client_error";
}

function requestForPolicy(
  policy: AnthropicEndpointPolicy,
  credential: Readonly<{ secret: string }>,
  body: string | undefined,
): Request {
  const headers = new Headers({
    accept: policy.responseMediaType,
    "anthropic-version": policy.anthropicVersion,
    "x-api-key": credential.secret,
  });
  if (policy.requestMediaType !== null) {
    headers.set("content-type", policy.requestMediaType);
  }
  if (policy.betaHeader !== null) {
    headers.set("anthropic-beta", policy.betaHeader);
  }

  return new Request(`${policy.origin}${policy.path}`, {
    method: policy.method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
}

function assertCredentialHeaderCompatibility(credentials: Readonly<{
  admin: Readonly<{ secret: string }>;
  analytics: Readonly<{ secret: string }>;
}>): void {
  try {
    for (const secret of [credentials.admin.secret, credentials.analytics.secret]) {
      new Headers({ "x-api-key": secret });
    }
  } catch {
    throw new Error("Anthropic credential cannot be used as a request header.");
  }
}

function serializedBody(policy: AnthropicEndpointPolicy, body: unknown): string | undefined {
  if (policy.requestMediaType === null) {
    if (body !== undefined) {
      throw new Error("Anthropic request body is not allowed for this endpoint.");
    }
    return undefined;
  }
  return JSON.stringify(body);
}

function hasImfFixdateEnvelope(value: string): boolean {
  return value.length === 29
    && value[3] === ","
    && value[4] === " "
    && value.endsWith(" GMT");
}

function retryDelayMilliseconds(
  response: Response,
  now: number,
  completedAttempt: number,
): number {
  const value = response.headers.get("retry-after")?.trim();
  if (value !== undefined && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    const milliseconds = Number(value) * 1_000;
    if (Number.isFinite(milliseconds)) return milliseconds;
  }

  if (value !== undefined && hasImfFixdateEnvelope(value)) {
    const retryAt = Date.parse(value);
    if (
      Number.isFinite(retryAt)
      && new Date(retryAt).toUTCString() === value
      && retryAt > now
    ) return retryAt - now;
  }

  return [1_000, 2_000][completedAttempt - 1]!;
}

export function createAnthropicRequestExecutor(dependencies: Readonly<{
  clock: AnthropicClock;
  sleep: AnthropicSleep;
  limiter: AnthropicRateLimiter;
  transport?: AnthropicTransport;
  observe?: AnthropicAttemptObserver;
}>): AnthropicRequestExecutor {
  const transport: AnthropicTransport = dependencies.transport
    ?? (async (request) => fetch(request));
  const observe: AnthropicAttemptObserver = dependencies.observe
    ?? (async () => undefined);

  return async (input) => {
    const policy = endpointPolicy(input.endpoint, input.parameters);
    const credentials = resolveAnthropicCredentials(input.credentials, input.vendorAccountId);
    assertCredentialHeaderCompatibility(credentials);
    const credential = credentialForPolicy(credentials, policy);
    const body = serializedBody(policy, input.body);

    for (let attempt = 1; ; attempt += 1) {
      await dependencies.limiter.acquire(input.vendorAccountId, policy.budgets);
      const request = requestForPolicy(policy, credential, body);
      await observe(Object.freeze({
        endpoint: input.endpoint,
        method: policy.method,
        attempt,
        phase: "requested",
        observedAt: dependencies.clock.now(),
        status: null,
        classification: null,
      }));

      let response: Response;
      try {
        response = await transport(request);
      } catch {
        return Object.freeze({
          ok: false,
          classification: "transport_ambiguous",
          status: null,
          attempts: attempt,
        });
      }

      const classification = classifyStatus(response.status);
      await observe(Object.freeze({
        endpoint: input.endpoint,
        method: policy.method,
        attempt,
        phase: "completed",
        observedAt: dependencies.clock.now(),
        status: response.status,
        classification,
      }));

      if (classification === "success") {
        return Object.freeze({ ok: true, response, attempts: attempt });
      }
      const retryableResponse = classification === "rate_limited"
        || classification === "provider_error";
      if (policy.retrySafe && retryableResponse && attempt < 3) {
        await dependencies.sleep(retryDelayMilliseconds(
          response,
          dependencies.clock.now(),
          attempt,
        ));
        continue;
      }
      return Object.freeze({
        ok: false,
        classification,
        status: response.status,
        attempts: attempt,
      });
    }
  };
}
