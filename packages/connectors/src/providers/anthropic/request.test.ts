import { describe, expect, it, vi } from "vitest";

import type { AnthropicCredentialCandidate } from "./credentials.js";
import type { AnthropicEndpoint } from "./endpoints.js";
import { createAnthropicRateLimiter } from "./rate-limiter.js";
import {
  createAnthropicRequestExecutor,
  type AnthropicAttemptObservation,
} from "./request.js";

const validCredentials = [
  {
    vendorAccountId: "account-a",
    kind: "admin_scoped",
    secret: "admin-secret",
    status: "active",
    health: "ok",
  },
  {
    vendorAccountId: "account-a",
    kind: "analytics",
    secret: "analytics-secret",
    status: "active",
    health: "ok",
  },
] as const satisfies readonly AnthropicCredentialCandidate[];

function inertLimiter() {
  return createAnthropicRateLimiter({
    clock: { now: () => 1_000 },
    sleep: async () => undefined,
  });
}

describe("Anthropic policy-bound request execution", () => {
  it("constructs the Admin request solely from the endpoint policy", async () => {
    // Mutations killed: wrong origin/path/method/credential or global policy headers change the real request.
    const requests: Request[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 1_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      transport: async (request) => {
        requests.push(request);
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await execute({
      endpoint: "members",
      vendorAccountId: "account-a",
      credentials: validCredentials,
      headers: { authorization: "Bearer caller-secret", "anthropic-beta": "caller-beta" },
      method: "POST",
      origin: "https://attacker.example",
      path: "/stolen",
    } as never);

    expect(result).toMatchObject({ ok: true, attempts: 1 });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe("https://api.anthropic.com/v1/organizations/users");
    expect(request.method).toBe("GET");
    expect(Object.fromEntries(request.headers.entries())).toEqual({
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "admin-secret",
    });
  });

  it("routes an Analytics endpoint only through the Analytics credential", async () => {
    // Mutation killed: selecting Admin credentials for Analytics changes the policy-derived x-api-key.
    const requests: Request[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 1_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      transport: async (request) => {
        requests.push(request);
        return new Response("{}", { status: 200 });
      },
    });

    await execute({
      endpoint: "cost_report",
      vendorAccountId: "account-a",
      credentials: validCredentials,
    });

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]!.headers.entries())).toEqual({
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "analytics-secret",
    });
  });

  it("serializes an invite body and applies its exact media policy", async () => {
    // Mutation killed: omitting JSON serialization or content-type changes the request observed by Anthropic.
    const requests: Request[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 1_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      transport: async (request) => {
        requests.push(request);
        return new Response("{}", { status: 200 });
      },
    });

    await execute({
      endpoint: "create_invite",
      vendorAccountId: "account-a",
      credentials: validCredentials,
      body: { email: "member@example.com", role: "user" },
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe("https://api.anthropic.com/v1/organizations/invites");
    expect(request.method).toBe("POST");
    expect(Object.fromEntries(request.headers.entries())).toEqual({
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": "admin-secret",
    });
    expect(await request.text()).toBe('{"email":"member@example.com","role":"user"}');
  });

  it.each([
    ["GET", { endpoint: "members", body: { forbidden: true } }],
    ["DELETE", { endpoint: "delete_invite", parameters: { resourceId: "invite/1" }, body: "forbidden" }],
  ] as const)("rejects a caller body for a policy-owned %s before any attempt", async (_method, requestInput) => {
    // Mutation killed: passing a caller body into a GET or DELETE reaches the limiter or network.
    let acquisitions = 0;
    let transports = 0;
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 1_000 },
      sleep: async () => undefined,
      limiter: { acquire: async () => { acquisitions += 1; } },
      transport: async () => {
        transports += 1;
        return new Response("{}", { status: 200 });
      },
    });

    await expect(execute({
      ...requestInput,
      vendorAccountId: "account-a",
      credentials: validCredentials,
    })).rejects.toThrow("body");
    expect(acquisitions).toBe(0);
    expect(transports).toBe(0);
  });

  it("creates every network attempt with a fresh 30 second timeout signal", async () => {
    // Mutation killed: omitting or changing the timeout means the platform timeout factory sees the wrong value.
    const timeoutSignals: number[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      timeoutSignals.push(milliseconds);
      return new AbortController().signal;
    });
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 1_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      transport: async (request) => {
        expect(request.signal).toBeInstanceOf(AbortSignal);
        return new Response("{}", { status: 200 });
      },
    });

    try {
      await execute({
        endpoint: "members",
        vendorAccountId: "account-a",
        credentials: validCredentials,
      });
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(timeoutSignals).toEqual([30_000]);
  });

  it.each([
    ["missing Admin", [validCredentials[1]]],
    ["missing Analytics", [validCredentials[0]]],
    ["blank secret", [{ ...validCredentials[0], secret: "  " }, validCredentials[1]]],
    ["duplicate kind", [...validCredentials, { ...validCredentials[0], secret: "other-admin" }]],
    ["identical secrets", [validCredentials[0], { ...validCredentials[1], secret: "admin-secret" }]],
    ["retired", [{ ...validCredentials[0], status: "retired" }, validCredentials[1]]],
    ["auth failed", [{ ...validCredentials[0], health: "auth_failed" }, validCredentials[1]]],
    ["unverified", [validCredentials[0], { ...validCredentials[1], health: "unverified" }]],
    [
      "wrong account",
      [
        { ...validCredentials[0], vendorAccountId: "account-b" },
        { ...validCredentials[1], vendorAccountId: "account-b" },
      ],
    ],
    ["unsupported kind", [{ ...validCredentials[0], kind: "unsupported" }, validCredentials[1]]],
  ] as const)("fails closed for %s credentials before limiter, observation, or transport", async (_case, credentials) => {
    // Mutation killed: deferring complete credential validation permits an observable attempt side effect.
    let acquisitions = 0;
    let transports = 0;
    const observations: AnthropicAttemptObservation[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 1_000 },
      sleep: async () => undefined,
      limiter: { acquire: async () => { acquisitions += 1; } },
      transport: async () => {
        transports += 1;
        return new Response("{}", { status: 200 });
      },
      observe: async (observation) => { observations.push(observation); },
    });

    await expect(execute({
      endpoint: "members",
      vendorAccountId: "account-a",
      credentials: credentials as readonly AnthropicCredentialCandidate[],
    })).rejects.toThrow();
    expect(acquisitions).toBe(0);
    expect(observations).toEqual([]);
    expect(transports).toBe(0);
  });
});

type RetryRun = Readonly<{
  calls: number;
  result: Awaited<ReturnType<ReturnType<typeof createAnthropicRequestExecutor>>>;
  sleeps: number[];
}>;

async function runStatuses(
  statuses: readonly number[],
  options: Readonly<{
    endpoint?: AnthropicEndpoint;
    parameters?: Readonly<{ resourceId?: string }>;
    retryAfter?: string;
    initialNow?: number;
  }> = {},
): Promise<RetryRun> {
  let now = options.initialNow ?? 10_000;
  let calls = 0;
  const sleeps: number[] = [];
  const execute = createAnthropicRequestExecutor({
    clock: { now: () => now },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    limiter: createAnthropicRateLimiter({
      clock: { now: () => now },
      sleep: async (milliseconds) => { now += milliseconds; },
    }),
    transport: async () => {
      const status = statuses[Math.min(calls, statuses.length - 1)]!;
      calls += 1;
      return new Response(status === 204 ? null : "{}", {
        status,
        headers: options.retryAfter === undefined
          ? undefined
          : { "retry-after": options.retryAfter },
      });
    },
  });

  const result = await execute({
    endpoint: options.endpoint ?? "members",
    vendorAccountId: "account-a",
    credentials: validCredentials,
    parameters: options.parameters,
  });
  return { calls, result, sleeps };
}

describe("Anthropic bounded retry policy", () => {
  it.each([
    ["GET 429", "members", undefined, 429, "rate_limited"],
    ["GET 500", "members", undefined, 500, "provider_error"],
    ["GET 503", "members", undefined, 503, "provider_error"],
    ["GET 599", "members", undefined, 599, "provider_error"],
    ["DELETE 429", "delete_invite", { resourceId: "invite/1" }, 429, "rate_limited"],
    ["DELETE 503", "delete_invite", { resourceId: "invite/1" }, 503, "provider_error"],
  ] as const)(
    "limits retry-safe %s responses to three attempts",
    async (_case, endpoint, parameters, status, classification) => {
      // Mutations killed: a fourth attempt, wrong status classification, or missing safe retry changes literals.
      const run = await runStatuses([status, status, status, 200], { endpoint, parameters });

      expect(run.result).toEqual({
        ok: false,
        classification,
        status,
        attempts: 3,
      });
      expect(run.calls).toBe(3);
      expect(run.sleeps).toEqual([1_000, 2_000]);
    },
  );

  it.each([300, 400, 401, 403, 404, 409, 422])(
    "treats client status %i as terminal",
    async (status) => {
      // Mutation killed: retrying any non-429 4xx produces another transport call and sleep.
      const run = await runStatuses([status, 200]);

      expect(run.result).toEqual({
        ok: false,
        classification: "client_error",
        status,
        attempts: 1,
      });
      expect(run.calls).toBe(1);
      expect(run.sleeps).toEqual([]);
    },
  );

  it.each([200, 204, 299])("treats successful status %i as terminal", async (status) => {
    // Mutation killed: retrying a success changes the terminal attempt count.
    const run = await runStatuses([status, 503]);

    expect(run.result).toMatchObject({ ok: true, attempts: 1 });
    expect(run.calls).toBe(1);
    expect(run.sleeps).toEqual([]);
  });

  it("honors decimal delta-seconds Retry-After before the next attempt", async () => {
    // Mutation killed: ignoring a valid delta or rounding it differently changes the exact sleep.
    const run = await runStatuses([429, 200], { retryAfter: "2.5" });

    expect(run.result).toMatchObject({ ok: true, attempts: 2 });
    expect(run.sleeps).toEqual([2_500]);
  });

  it("uses deterministic fallback delays indexed by the completed attempt", async () => {
    // Mutation killed: constant, off-by-one, or jittered fallback delays change this sequence.
    const run = await runStatuses([503, 503, 200]);

    expect(run.result).toMatchObject({ ok: true, attempts: 3 });
    expect(run.sleeps).toEqual([1_000, 2_000]);
  });

  it("honors a future HTTP-date against the injected clock", async () => {
    // Mutation killed: measuring HTTP-date against wall time instead of the injected epoch changes the delay.
    const epoch = Date.UTC(2026, 8, 5, 12, 0, 0);
    const run = await runStatuses([503, 200], {
      initialNow: epoch,
      retryAfter: new Date(epoch + 5_000).toUTCString(),
    });

    expect(run.result).toMatchObject({ ok: true, attempts: 2 });
    expect(run.sleeps).toEqual([5_000]);
  });

  it.each([
    ["past HTTP-date", new Date(Date.UTC(2026, 8, 5, 11, 59, 59)).toUTCString()],
    ["negative delta", "-1"],
    ["non-finite delta", "Infinity"],
    ["malformed value", "eventually"],
  ] as const)("falls back for a %s Retry-After", async (_case, retryAfter) => {
    // Mutation killed: accepting invalid or non-future values bypasses the fallback.
    const run = await runStatuses([503, 200], {
      initialNow: Date.UTC(2026, 8, 5, 12, 0, 0),
      retryAfter,
    });

    expect(run.result).toMatchObject({ ok: true, attempts: 2 });
    expect(run.sleeps).toEqual([1_000]);
  });

  it("honors zero delta-seconds and falls back when Retry-After is missing", async () => {
    // Mutation killed: treating zero as absent or missing as zero swaps these literal delays.
    const zero = await runStatuses([429, 200], { retryAfter: "0" });
    const missing = await runStatuses([429, 200]);

    expect(zero.sleeps).toEqual([0]);
    expect(missing.sleeps).toEqual([1_000]);
  });

  it("sleeps before acquiring capacity for each actual retry attempt", async () => {
    // Mutations killed: skipped acquisition or acquiring before retry sleep changes the ordered trace.
    const events: string[] = [];
    let attempts = 0;
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 10_000 },
      sleep: async (milliseconds) => { events.push(`sleep:${milliseconds}`); },
      limiter: {
        acquire: async (account, budgets) => {
          events.push(`acquire:${account}:${budgets.join("+")}`);
        },
      },
      observe: async (observation) => {
        events.push(`observe:${observation.phase}:${observation.attempt}`);
      },
      transport: async () => {
        attempts += 1;
        events.push(`transport:${attempts}`);
        return new Response("{}", { status: attempts < 3 ? 503 : 200 });
      },
    });

    await execute({
      endpoint: "members",
      vendorAccountId: "account-a",
      credentials: validCredentials,
    });

    expect(events).toEqual([
      "acquire:account-a:user_management",
      "observe:requested:1",
      "transport:1",
      "observe:completed:1",
      "sleep:1000",
      "acquire:account-a:user_management",
      "observe:requested:2",
      "transport:2",
      "observe:completed:2",
      "sleep:2000",
      "acquire:account-a:user_management",
      "observe:requested:3",
      "transport:3",
      "observe:completed:3",
    ]);
  });

  it("charges a real user-management budget for a retry", async () => {
    // Mutation killed: bypassing the limiter for retries permits an unbudgeted 101st call.
    let now = 0;
    const sleeps: number[] = [];
    const sleep = async (milliseconds: number) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    };
    const limiter = createAnthropicRateLimiter({ clock: { now: () => now }, sleep });
    for (let index = 0; index < 99; index += 1) {
      await limiter.acquire("account-a", ["user_management"]);
    }
    let attempts = 0;
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => now },
      sleep,
      limiter,
      transport: async () => {
        attempts += 1;
        return new Response("{}", { status: attempts === 1 ? 503 : 200 });
      },
    });

    const result = await execute({
      endpoint: "members",
      vendorAccountId: "account-a",
      credentials: validCredentials,
    });

    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1_000, 59_000]);
  });

  it.each([429, 500])("never retries invite creation after status %i", async (status) => {
    // Mutation killed: retrying a non-idempotent POST changes call and sleep counts.
    let calls = 0;
    const sleeps: number[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 10_000 },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      limiter: inertLimiter(),
      transport: async () => {
        calls += 1;
        return new Response("{}", { status });
      },
    });

    const result = await execute({
      endpoint: "create_invite",
      vendorAccountId: "account-a",
      credentials: validCredentials,
      body: { email: "member@example.com" },
    });

    expect(result).toEqual({
      ok: false,
      classification: status === 429 ? "rate_limited" : "provider_error",
      status,
      attempts: 1,
    });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it.each([
    ["create_invite", { body: { email: "member@example.com" } }],
    ["members", {}],
  ] as const)("never retries a transport exception for %s", async (endpoint, extra) => {
    // Mutation killed: retrying an ambiguous exception adds calls or a retry delay.
    let calls = 0;
    const sleeps: number[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 10_000 },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      limiter: inertLimiter(),
      transport: async () => {
        calls += 1;
        throw new Error("provider exception secret");
      },
    });

    const result = await execute({
      endpoint,
      vendorAccountId: "account-a",
      credentials: validCredentials,
      ...extra,
    });

    expect(result).toEqual({
      ok: false,
      classification: "transport_ambiguous",
      status: null,
      attempts: 1,
    });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("creates a fresh 30 second timeout signal for every retry", async () => {
    // Mutation killed: reusing one Request or signal across retries yields fewer timeout factory calls.
    const timeouts: number[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    });
    let attempts = 0;
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 10_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      transport: async () => {
        attempts += 1;
        return new Response("{}", { status: attempts < 3 ? 503 : 200 });
      },
    });

    try {
      await execute({
        endpoint: "members",
        vendorAccountId: "account-a",
        credentials: validCredentials,
      });
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(timeouts).toEqual([30_000, 30_000, 30_000]);
  });

  it("observes only exact allowlisted requested and completed metadata", async () => {
    // Mutation killed: adding request/response/body/error fields changes the exact observation objects.
    const observations: AnthropicAttemptObservation[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 42_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      observe: async (observation) => { observations.push(observation); },
      transport: async () => new Response("provider response secret", { status: 500 }),
    });

    await execute({
      endpoint: "create_invite",
      vendorAccountId: "account-a",
      credentials: validCredentials,
      body: { email: "sensitive-body@example.com" },
    });

    expect(observations).toEqual([
      {
        endpoint: "create_invite",
        method: "POST",
        attempt: 1,
        phase: "requested",
        observedAt: 42_000,
        status: null,
        classification: null,
      },
      {
        endpoint: "create_invite",
        method: "POST",
        attempt: 1,
        phase: "completed",
        observedAt: 42_000,
        status: 500,
        classification: "provider_error",
      },
    ]);
    const serialized = JSON.stringify(observations);
    for (const forbidden of [
      "admin-secret",
      "analytics-secret",
      "sensitive-body@example.com",
      "authorization",
      "provider response secret",
      "arbitrary",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("emits only requested metadata when transport throws", async () => {
    // Mutation killed: exposing an exception or fabricating a completed response changes the exact sequence.
    const observations: AnthropicAttemptObservation[] = [];
    const execute = createAnthropicRequestExecutor({
      clock: { now: () => 43_000 },
      sleep: async () => undefined,
      limiter: inertLimiter(),
      observe: async (observation) => { observations.push(observation); },
      transport: async () => { throw new Error("provider exception secret"); },
    });

    await execute({
      endpoint: "members",
      vendorAccountId: "account-a",
      credentials: validCredentials,
    });

    expect(observations).toEqual([{
      endpoint: "members",
      method: "GET",
      attempt: 1,
      phase: "requested",
      observedAt: 43_000,
      status: null,
      classification: null,
    }]);
    expect(JSON.stringify(observations)).not.toContain("provider exception secret");
  });
});
