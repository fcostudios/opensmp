import {
  credentialForPolicy,
  resolveAnthropicCredentials,
  type AnthropicCredentialCandidate,
} from "./credentials.js";
import {
  anthropicFailureRetryable,
  endpointPolicy,
  type AnthropicEndpoint,
  type AnthropicEndpointPolicy,
  type AnthropicFailureClassification,
} from "./endpoints.js";
import type {
  AnthropicClock,
  AnthropicRateLimiter,
  AnthropicSleep,
} from "./rate-limiter.js";
import {
  readAnthropicCapacityFailure,
  type AnthropicCapacityFailureCode,
} from "./capacity-failure.js";

export type AnthropicAttemptClassification =
  | "success" | AnthropicFailureClassification;

type AnthropicObservedEndpoint = Exclude<
  AnthropicEndpoint,
  "delete_member" | "user_usage_report" | "user_cost_report"
>;

export type AnthropicAttemptObservation = Readonly<{
  endpoint: AnthropicObservedEndpoint;
  method: "GET" | "POST" | "DELETE";
  attempt: number;
  phase: "requested" | "completed";
  observedAt: number;
  status: number | null;
  classification: AnthropicAttemptClassification | null;
  failureCode?: AnthropicCapacityFailureCode;
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
    failureCode?: AnthropicCapacityFailureCode;
  }>;

export type AnthropicRequestQuery = Readonly<{
  observedOn?: string;
  continuation?: Readonly<{
    kind: "after_id" | "page";
    value: string;
  }>;
}>;

export type ExecuteAnthropicRequestInput = Readonly<{
  endpoint: AnthropicEndpoint;
  vendorAccountId: string;
  credentials: readonly AnthropicCredentialCandidate[];
  parameters?: Readonly<{ resourceId?: string }>;
  query?: AnthropicRequestQuery;
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

function observedEndpoint(endpoint: AnthropicEndpoint): AnthropicObservedEndpoint {
  if (endpoint === "delete_member") return "members";
  if (endpoint === "user_usage_report") return "usage_report";
  if (endpoint === "user_cost_report") return "cost_report";
  return endpoint;
}

function requestForPolicy(
  policy: AnthropicEndpointPolicy,
  credential: Readonly<{ secret: string }>,
  body: string | undefined,
  query: URLSearchParams,
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

  const url = new URL(policy.path, policy.origin);
  url.search = query.toString();
  return new Request(url, {
    method: policy.method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
}

type AnthropicQueryKind =
  | "none"
  | "admin_page"
  | "dated"
  | "dated_page"
  | "report_page";

function queryKind(endpoint: AnthropicEndpoint): AnthropicQueryKind {
  switch (endpoint) {
    case "members":
    case "invites":
      return "admin_page";
    case "analytics_summaries":
      return "dated";
    case "analytics_users":
      return "dated_page";
    case "usage_report":
    case "user_usage_report":
    case "cost_report":
    case "user_cost_report":
      return "report_page";
    case "organization":
    case "create_invite":
    case "delete_invite":
    case "delete_member":
      return "none";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observedOn(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid Anthropic request query observedOn.");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid Anthropic request query observedOn.");
  }
  return value;
}

function followingDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const iso = date.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) {
    throw new Error("Invalid Anthropic request query exclusive next day.");
  }
  return iso.slice(0, 10);
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const following = value.charCodeAt(index + 1);
      if (following < 0xDC00 || following > 0xDFFF) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function requestQuery(
  endpoint: AnthropicEndpoint,
  candidate: AnthropicRequestQuery | undefined,
): URLSearchParams {
  const kind = queryKind(endpoint);
  if (candidate === undefined) {
    if (kind === "dated" || kind === "dated_page" || kind === "report_page") {
      throw new Error("Invalid Anthropic request query for dated endpoint.");
    }
    const query = new URLSearchParams();
    if (kind === "admin_page") query.set("limit", "1000");
    return query;
  }
  if (!isRecord(candidate) || Object.keys(candidate).some((key) =>
    key !== "observedOn" && key !== "continuation")) {
    throw new Error("Invalid Anthropic request query.");
  }
  if (kind === "none") {
    throw new Error("Invalid Anthropic request query for endpoint.");
  }

  const query = new URLSearchParams();
  if (kind === "admin_page") {
    if (candidate.observedOn !== undefined) {
      throw new Error("Invalid Anthropic request query for endpoint.");
    }
    query.set("limit", "1000");
  } else {
    const date = observedOn(candidate.observedOn);
    if (kind === "report_page") {
      query.set("starting_at", `${date}T00:00:00Z`);
      query.set("ending_at", `${followingDay(date)}T00:00:00Z`);
      query.set("bucket_width", "1d");
      query.set("limit", "1");
    } else {
      query.set("date", date);
    }
  }

  if (candidate.continuation !== undefined) {
    const continuation = candidate.continuation;
    if (
      !isRecord(continuation)
      || Object.keys(continuation).some((key) => key !== "kind" && key !== "value")
      || typeof continuation.value !== "string"
      || continuation.value.trim().length === 0
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(continuation.value)
      || !isWellFormedUtf16(continuation.value)
    ) {
      throw new Error("Invalid Anthropic request query continuation.");
    }
    const expectedKind = kind === "admin_page" ? "after_id" : "page";
    if (
      continuation.kind !== expectedKind
      || kind === "dated"
    ) {
      throw new Error("Invalid Anthropic request query continuation for endpoint.");
    }
    query.set(expectedKind, continuation.value);
  }
  return query;
}

function assertCredentialHeaderCompatibility(credentials: Readonly<{
  admin: Readonly<{ secret: string }>;
  analytics: Readonly<{ secret: string }>;
}>): void {
  try {
    for (const secret of [credentials.admin.secret, credentials.analytics.secret]) {
      const headers = new Headers({ "x-api-key": secret });
      if (headers.get("x-api-key") !== secret) {
        throw new Error("normalized credential");
      }
    }
  } catch {
    throw new Error("Anthropic credential cannot be used as a request header.");
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider-owned cancellation failures must not replace safe executor outcomes.
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

function parseImfFixdate(value: string): number | null {
  if (
    value.length !== 29
    || value[3] !== ","
    || value[4] !== " "
    || !value.endsWith(" GMT")
  ) return null;

  const epoch = Date.parse(value);
  return new Date(epoch).toUTCString() === value ? epoch : null;
}

function asctimeFromEpoch(epoch: number): string {
  const imfFixdate = new Date(epoch).toUTCString();
  const paddedDay = String(Number(imfFixdate.slice(5, 7))).padStart(2, " ");
  return `${imfFixdate.slice(0, 3)} ${imfFixdate.slice(8, 11)} ${paddedDay} ${
    imfFixdate.slice(17, 25)
  } ${imfFixdate.slice(12, 16)}`;
}

function parseAsctime(value: string): number | null {
  if (value.length !== 24 || value[3] !== " ") return null;

  const day = String(Number(value.slice(8, 10))).padStart(2, "0");
  const imfCandidate = `${value.slice(0, 3)}, ${day} ${value.slice(4, 7)} ${
    value.slice(20, 24)
  } ${value.slice(11, 19)} GMT`;
  const epoch = Date.parse(imfCandidate);
  return asctimeFromEpoch(epoch) === value ? epoch : null;
}

function rfc850FromEpoch(epoch: number): string {
  const date = new Date(epoch);
  const imfFixdate = date.toUTCString();
  const weekday = date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
  });
  return `${weekday}, ${imfFixdate.slice(5, 7)}-${imfFixdate.slice(8, 11)}-${
    imfFixdate.slice(14, 16)
  } ${imfFixdate.slice(17, 25)} GMT`;
}

function parseRfc850(value: string, now: number): number | null {
  const separator = value.indexOf(", ");
  if (
    separator < 6
    || !value.endsWith(" GMT")
    || !value.includes("-")
  ) return null;

  const weekday = value.slice(0, separator);
  const dateAndTime = value.slice(separator + 2, -4).split(" ");
  const date = dateAndTime[0]!;
  const time = dateAndTime[1];
  const twoDigitYear = Number(date.slice(-2));

  const fiftyYearsFromNow = new Date(now);
  fiftyYearsFromNow.setUTCFullYear(fiftyYearsFromNow.getUTCFullYear() + 50);
  let year = Math.floor(fiftyYearsFromNow.getUTCFullYear() / 100) * 100 + twoDigitYear;
  const imfCandidate = (candidateYear: number) => `${weekday}, ${date.slice(0, 2)} ${
    date.slice(3, 6)
  } ${candidateYear} ${time} GMT`;
  let epoch = Date.parse(imfCandidate(year));

  if (epoch > fiftyYearsFromNow.getTime()) {
    year -= 100;
    epoch = Date.parse(imfCandidate(year));
  }
  return rfc850FromEpoch(epoch) === value ? epoch : null;
}

function parseHttpDate(value: string, now: number): number | null {
  return parseImfFixdate(value) ?? parseRfc850(value, now) ?? parseAsctime(value);
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

  if (value !== undefined) {
    const retryAt = parseHttpDate(value, now);
    if (retryAt !== null && retryAt > now) return retryAt - now;
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
    const query = requestQuery(input.endpoint, input.query);
    const observationEndpoint = observedEndpoint(input.endpoint);
    const credentials = resolveAnthropicCredentials(input.credentials, input.vendorAccountId);
    assertCredentialHeaderCompatibility(credentials);
    const credential = credentialForPolicy(credentials, policy);
    const body = serializedBody(policy, input.body);

    for (let attempt = 1; ; attempt += 1) {
      await observe(Object.freeze({
        endpoint: observationEndpoint,
        method: policy.method,
        attempt,
        phase: "requested",
        observedAt: dependencies.clock.now(),
        status: null,
        classification: null,
      }));
      await dependencies.limiter.acquire(input.vendorAccountId, policy.budgets);
      const request = requestForPolicy(policy, credential, body, query);

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
      const failureCode = input.endpoint === "create_invite" && response.status === 400
        ? await readAnthropicCapacityFailure(response, input.endpoint)
        : null;
      try {
        await observe(Object.freeze({
          endpoint: observationEndpoint,
          method: policy.method,
          attempt,
          phase: "completed",
          observedAt: dependencies.clock.now(),
          status: response.status,
          classification,
          ...(failureCode === null ? {} : { failureCode }),
        }));
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }

      if (classification === "success") {
        return Object.freeze({ ok: true, response, attempts: attempt });
      }
      await cancelResponseBody(response);
      if (anthropicFailureRetryable(policy, classification) && attempt < 3) {
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
        ...(failureCode === null ? {} : { failureCode }),
      });
    }
  };
}
