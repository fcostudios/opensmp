import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createConnectorCallObservationSession,
  type ConnectorCallObservationAppendInput,
  type ConnectorOperation,
} from "../../connector-call-observation.js";
import type { ConnectorResult, VendorConnector } from "../../contracts.js";
import type { AnthropicCredentialCandidate } from "./credentials.js";
import { createAnthropicConnectorObservationBridge } from "./observation.js";
import { createAnthropicRateLimiter } from "./rate-limiter.js";
import type { AnthropicTransport } from "./request.js";
import { createAnthropicConnector } from "./connector.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const ACTION = "33333333-3333-4333-8333-333333333333";
const CORRELATION = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-09-06T12:00:00.000Z");
const credentials = [
  { vendorAccountId: ACCOUNT, kind: "admin_scoped", secret: "admin-secret", status: "active", health: "ok" },
  { vendorAccountId: ACCOUNT, kind: "analytics", secret: "analytics-secret", status: "active", health: "ok" },
] as const satisfies readonly AnthropicCredentialCandidate[];

type SessionInput = Readonly<{
  vendorAccountId: string;
  requestId: string | null;
  operation: ConnectorOperation;
}>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function idPage(data: readonly unknown[], hasMore = false, lastId: string | null = null) {
  return { data, has_more: hasMore, first_id: data.length ? "first" : null, last_id: lastId };
}

function opaquePage(data: readonly unknown[], nextPage: string | null = null) {
  return { data, next_page: nextPage };
}

function member(id: string, email: string | null) {
  return { type: "user", id, name: "Member", email };
}

function invite(id: string, email: string | null, status = "pending") {
  return { type: "invite", id, email, status };
}

function analyticsUser(id: string, email: string | null) {
  return { user_id: id, email };
}

function summary(date = "2026-09-06", activeUsers = 1, conversations = 2) {
  return { date, active_users: activeUsers, conversations };
}

function usage(id: string, email: string | null) {
  return {
    user_id: id,
    email,
    input_tokens: "10",
    output_tokens: "2",
  };
}

function cost(id: string, email: string | null, amount = "123.4567", currency = "USD") {
  return {
    user_id: id,
    email,
    results: [{ amount, list_amount: amount, currency }],
  };
}

function fixture(
  transport: AnthropicTransport,
  candidates: readonly AnthropicCredentialCandidate[] = credentials,
): Readonly<{
  connector: VendorConnector;
  journal: ConnectorCallObservationAppendInput[];
  sessions: SessionInput[];
  credentialLookups: string[];
}> {
  const journal: ConnectorCallObservationAppendInput[] = [];
  const sessions: SessionInput[] = [];
  const credentialLookups: string[] = [];
  let now = NOW.getTime();
  const clock = { now: () => now };
  const sleep = async (milliseconds: number) => { now += milliseconds; };
  const connector = createAnthropicConnector({
    credentialsFor: async (vendorAccountId) => {
      credentialLookups.push(vendorAccountId);
      return candidates;
    },
    observationSessionFor: async (input) => {
      sessions.push(input);
      return createConnectorCallObservationSession({
        vendorAccountId: input.vendorAccountId,
        provisioningActionId: input.requestId === null ? null : ACTION,
        operation: input.operation,
        clock: () => new Date(now),
        randomId: () => CORRELATION,
        append: async (event) => { journal.push(event); },
      });
    },
    requestDependencies: {
      clock,
      sleep,
      limiter: createAnthropicRateLimiter({ clock, sleep }),
      transport,
    },
  });
  return { connector, journal, sessions, credentialLookups };
}

async function successValue<T>(operation: Promise<ConnectorResult<T>>): Promise<T> {
  const result = await operation;
  expect(result).toMatchObject({ ok: true, raw: null });
  if (!result.ok) throw new Error("expected connector success");
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.value)).toBe(true);
  return result.value;
}

describe("Anthropic neutral connector", () => {
  it("advertises exactly five immutable implemented capabilities", () => {
    // Mutations killed: omitting/adding a capability or returning a mutable set changes observable dispatch behavior.
    const { connector, credentialLookups, sessions } = fixture(async () => json({}));
    const capabilities = connector.capabilities();
    expect([...capabilities]).toEqual(["provision", "deprovision", "syncMembers", "syncActivity", "syncCost"]);
    expect(Object.isFrozen(connector)).toBe(true);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.size).toBe(5);
    expect(capabilities.has("syncCost")).toBe(true);
    expect([...capabilities.keys()]).toEqual([...capabilities.values()]);
    expect([...capabilities.entries()][0]).toEqual(["provision", "provision"]);
    expect(() => Set.prototype.add.call(capabilities, "forged")).toThrow(TypeError);
    expect(() => Set.prototype.clear.call(capabilities)).toThrow(TypeError);
    expect([...capabilities]).toEqual(["provision", "deprovision", "syncMembers", "syncActivity", "syncCost"]);
    expect(credentialLookups).toEqual([]);
    expect(sessions).toEqual([]);
  });

  it("implements all five operations through neutral frozen results and one account/session lookup", async () => {
    // Mutations killed: wrong route/body/join/state/request link/raw value changes literal outputs or captured requests.
    const requests: Request[] = [];
    const { connector, sessions, credentialLookups } = fixture(async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === "POST") return json(invite("inv-1", "member@example.test"), 201);
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/users") && !url.pathname.includes("analytics")) {
        return json(idPage([member("usr-1", "member@example.test"), member("usr-null", null)]));
      }
      if (url.pathname.endsWith("/invites")) return json(idPage([invite("inv-1", "pending@example.test")]));
      if (url.pathname.endsWith("/analytics/users")) return json(opaquePage([analyticsUser("usr-1", "member@example.test")]));
      if (url.pathname.endsWith("/summaries")) return json({ summaries: [summary()] });
      if (url.pathname.endsWith("/user_usage_report")) return json(opaquePage([usage("usr-1", "member@example.test")]));
      if (url.pathname.endsWith("/user_cost_report")) return json(opaquePage([cost("usr-1", null)]));
      throw new Error(`unexpected transport request ${request.method} ${url.pathname}`);
    });

    expect(await successValue(connector.provision({ requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "new@example.test", licenseTypeName: "Claude" })))
      .toEqual({ vendorRef: "inv-1" });
    expect(await successValue(connector.deprovision({ requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "member@example.test", licenseTypeName: "Claude" })))
      .toEqual({ vendorRef: "usr-1" });
    expect(await successValue(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      members: [
        { email: "member@example.test", active: true },
        { email: "pending@example.test", active: false },
      ],
    });
    expect(await successValue(connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      records: [{ email: "member@example.test", activityDate: "2026-09-06", counters: { activeUsers: 1, conversations: 2 } }],
    });
    expect(await successValue(connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      records: [{ email: "member@example.test", costDate: "2026-09-06", amountUsd: "1.234567" }],
    });

    expect(credentialLookups).toEqual(Array(5).fill(ACCOUNT));
    expect(sessions).toEqual([
      { vendorAccountId: ACCOUNT, requestId: REQUEST, operation: "provision" },
      { vendorAccountId: ACCOUNT, requestId: REQUEST, operation: "deprovision" },
      { vendorAccountId: ACCOUNT, requestId: null, operation: "sync_members" },
      { vendorAccountId: ACCOUNT, requestId: null, operation: "sync_activity" },
      { vendorAccountId: ACCOUNT, requestId: null, operation: "sync_cost" },
    ]);
    expect(requests.find(({ method }) => method === "POST") && await requests.find(({ method }) => method === "POST")!.clone().json())
      .toEqual({ email: "new@example.test", role: "user" });
    expect(requests.some(({ method, url }) => method === "DELETE" && url.endsWith("/users/usr-1"))).toBe(true);
  });

  it.each([
    ["member leading whitespace", "member", " usr-1"],
    ["member trailing whitespace", "member", "usr-1 "],
    ["member control", "member", "usr\n1"],
    ["member lone high surrogate", "member", "usr\uD800"],
    ["invite lone low surrogate", "invite", "inv\uDC00"],
    ["member dot segment", "member", "."],
    ["invite parent-dot segment", "invite", ".."],
  ] as const)("rejects %s before any deprovision DELETE", async (_case, kind, providerId) => {
    // Mutations killed: trimming or lossy URL encoding turns a malformed provider ID into a destructive target.
    const methods: string[] = [];
    const { connector } = fixture(async (request) => {
      methods.push(request.method);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/users")) {
        return json(idPage(kind === "member" ? [member(providerId, "target@example.test")] : []));
      }
      if (path.endsWith("/invites")) {
        return json(idPage(kind === "invite" ? [invite(providerId, "target@example.test")] : []));
      }
      return new Response(null, { status: 204 });
    });
    expect(await connector.deprovision({
      requestId: REQUEST,
      vendorAccountId: ACCOUNT,
      personEmail: "target@example.test",
      licenseTypeName: "Claude",
    })).toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(methods).toEqual(kind === "member" ? ["GET"] : ["GET", "GET"]);
    expect(methods).not.toContain("DELETE");
  });

  it("paginates both cursor families and preserves durable attempt numbering across pages", async () => {
    // Mutations killed: wrong continuation or recreated session repeats the durable attempt number.
    const seen: string[] = [];
    const { connector, journal } = fixture(async (request) => {
      const url = new URL(request.url);
      seen.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (url.pathname.endsWith("/analytics/users")) {
        return json(opaquePage(
          [analyticsUser(url.searchParams.has("page") ? "u2" : "u1", url.searchParams.has("page") ? "b@example.test" : "a@example.test")],
          url.searchParams.has("page") ? null : "opaque-2",
        ));
      }
      return json({ summaries: [summary()] });
    });

    await successValue(connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }));
    expect(seen).toEqual([
      "/v1/organizations/analytics/users?date=2026-09-06",
      "/v1/organizations/analytics/users?date=2026-09-06&page=opaque-2",
      "/v1/organizations/analytics/summaries?date=2026-09-06",
    ]);
    expect(journal.filter(({ phase }) => phase === "requested").map(({ attempt }) => attempt)).toEqual([1, 2, 3]);
  });

  it("permits terminal ID page 100 but refuses request 101", async () => {
    // Mutations killed: off-by-one page bounds make 100 fail or issue a 101st member request.
    let memberCalls = 0;
    const { connector } = fixture(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/users")) {
        memberCalls += 1;
        return json(idPage([], memberCalls <= 100, `cursor-${memberCalls}`));
      }
      return json(idPage([]));
    });
    const result = await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW });
    expect(result).toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(memberCalls).toBe(100);
  });

  it("accepts a terminal ID page 100 and then proceeds to invitations", async () => {
    // Mutations killed: a `>= 100` guard rejects the allowed terminal page.
    let memberCalls = 0;
    let inviteCalls = 0;
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/users")) {
        memberCalls += 1;
        return json(idPage([], memberCalls < 100, memberCalls < 100 ? `cursor-${memberCalls}` : null));
      }
      inviteCalls += 1;
      return json(idPage([]));
    });
    expect(await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toMatchObject({ ok: true, raw: null });
    expect({ memberCalls, inviteCalls }).toEqual({ memberCalls: 100, inviteCalls: 1 });
  });

  it.each([
    ["repeated", "same", 2],
    ["missing", "", 1],
  ] as const)("fails closed for a %s opaque cursor", async (_case, cursor, expectedCalls) => {
    // Mutations killed: accepting a repeated/blank opaque token loops or consumes another rate slot.
    let calls = 0;
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/analytics/users")) {
        calls += 1;
        return json(opaquePage([], cursor));
      }
      return json({ summaries: [] });
    });
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(expectedCalls);
  });

  it("refuses opaque page 101 after recording exactly 100 successful pages", async () => {
    // Mutations killed: an off-by-one opaque bound issues a 101st Analytics request.
    let calls = 0;
    const { connector, journal } = fixture(async () => {
      calls += 1;
      return json(opaquePage([], `page-${calls}`));
    });
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(100);
    expect(journal.filter(({ phase }) => phase === "requested")).toHaveLength(100);
  });

  it.each([
    ["repeated ID cursor", () => idPage([], true, "same")],
    ["missing ID cursor", () => idPage([], true, null)],
  ] as const)("fails closed for a %s without a partial member snapshot", async (_case, page) => {
    // Mutations killed: accepting missing/repeated cursors either loops or returns partial data.
    let calls = 0;
    const { connector } = fixture(async () => { calls += 1; return json(page()); });
    expect(await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(_case.startsWith("repeated") ? 2 : 1);
  });

  it.each([
    ["malformed member", idPage([{ type: "user", id: "u", name: "N" }])],
    ["extra member field", idPage([{ ...member("u", "a@example.test"), secret: "leak" }])],
    ["duplicate activity identity", opaquePage([analyticsUser("u", "a@example.test"), analyticsUser("u", "b@example.test")])],
  ] as const)("maps %s success bodies to a private non-retryable failure", async (_case, body) => {
    // Mutations killed: permissive parsing exposes partial or ambiguous provider data.
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      if (_case.includes("activity") && path.endsWith("/analytics/users")) return json(body);
      if (_case.includes("activity")) return json({ summaries: [] });
      return json(body);
    });
    const result = _case.includes("activity")
      ? await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW })
      : await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW });
    expect(result).toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects a malformed invitation page without returning valid members", async () => {
    // Mutations killed: permissive invitation parsing would return a partial member snapshot.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/users")
      ? json(idPage([member("u", "active@example.test")]))
      : json(idPage([{ type: "invite", id: "i", email: "pending@example.test" }])));
    expect(await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it.each([
    ["invalid date", summary("2026-02-30")],
    ["negative counter", summary("2026-09-06", -1)],
    ["extra field", { ...summary(), provider_total: 3 }],
  ] as const)("rejects an activity summary with %s", async (_case, invalidSummary) => {
    // Mutations killed: weakening the closed date/counter/field checks exposes malformed analytics.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/analytics/users")
      ? json(opaquePage([analyticsUser("u", "a@example.test")]))
      : json({ summaries: [invalidSummary] }));
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("applies one organization summary to every uniquely identified analytics user", async () => {
    // Mutations killed: treating the organization summary as user-shaped drops or misattributes activity.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/analytics/users")
      ? json(opaquePage([
        analyticsUser("u1", "a@example.test"),
        analyticsUser("u2", "b@example.test"),
        analyticsUser("deleted", null),
      ]))
      : json({ summaries: [summary("2026-09-06", 7, 11)] }));
    expect(await successValue(connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      records: [
        { email: "a@example.test", activityDate: "2026-09-06", counters: { activeUsers: 7, conversations: 11 } },
        { email: "b@example.test", activityDate: "2026-09-06", counters: { activeUsers: 7, conversations: 11 } },
      ],
    });
  });

  it.each([
    ["wrong date", [summary("2026-09-05")]],
    ["duplicate requested date", [summary(), summary()]],
    ["missing requested date", []],
  ] as const)("rejects an activity envelope with %s", async (_case, summaries) => {
    // Mutations killed: selecting by order or accepting no exact-date summary makes activity ambiguous.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/analytics/users")
      ? json(opaquePage([analyticsUser("u", "a@example.test")]))
      : json({ summaries }));
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("rejects duplicate normalized analytics emails across distinct provider IDs", async () => {
    // Mutations killed: checking only provider IDs silently duplicates one person's activity.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/analytics/users")
      ? json(opaquePage([
        analyticsUser("u1", "Person@Example.test"),
        analyticsUser("u2", "person@example.test"),
      ]))
      : json({ summaries: [summary()] }));
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("rejects a malformed analytics user ID", async () => {
    // Mutations killed: accepting lossy opaque IDs lets ambiguous provider identities enter joins.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/analytics/users")
      ? json(opaquePage([analyticsUser("user\uD800", "a@example.test")]))
      : json({ summaries: [summary()] }));
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("rejects a malformed usage identity before requesting cost", async () => {
    // Mutations killed: skipping the usage parser allows an ungrounded cost identity to pass.
    let costCalls = 0;
    const { connector } = fixture(async (request) => {
      if (new URL(request.url).pathname.endsWith("/user_cost_report")) costCalls += 1;
      return json(opaquePage([{ ...usage("u", "a@example.test"), input_tokens: "1e3" }]));
    });
    expect(await connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(costCalls).toBe(0);
  });

  it.each([
    ["duplicate usage IDs", [usage("u", "a@example.test"), usage("u", "a@example.test")], [cost("u", null)]],
    ["duplicate usage emails", [usage("u1", "Same@Example.test"), usage("u2", "same@example.test")], [cost("u1", null)]],
    ["duplicate cost IDs", [usage("u", "a@example.test")], [cost("u", null), cost("u", null)]],
    ["duplicate cost emails", [usage("u1", "a@example.test"), usage("u2", "b@example.test")], [cost("u1", "same@example.test"), cost("u2", "same@example.test")]],
    ["cost actor absent from usage", [usage("u1", "a@example.test")], [cost("u2", "b@example.test")]],
    ["non-null email disagreement", [usage("u", "a@example.test")], [cost("u", "b@example.test")]],
    ["standalone cost email", [usage("u", null)], [cost("u", "a@example.test")]],
  ] as const)("rejects %s in the strict usage/cost identity join", async (_case, usages, costs) => {
    // Mutations killed: order-based or preferential email joins misattribute financial records.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/user_usage_report")
      ? json(opaquePage(usages))
      : json(opaquePage(costs)));
    expect(await connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("resolves a nullable cost email only from the matching usage actor", async () => {
    // Mutations killed: dropping the ID join loses a valid nullable-email cost actor.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/user_usage_report")
      ? json(opaquePage([usage("u", "a@example.test")]))
      : json(opaquePage([cost("u", null, "100")])));
    expect(await successValue(connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      records: [{ email: "a@example.test", costDate: "2026-09-06", amountUsd: "1.00" }],
    });
  });

  it("rejects malformed matching IDs across usage and cost", async () => {
    // Mutations killed: treating opaque IDs as merely nonblank allows control-bearing actors to join.
    const malformed = "user\u0000id";
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/user_usage_report")
      ? json(opaquePage([usage(malformed, "a@example.test")]))
      : json(opaquePage([cost(malformed, null)])));
    expect(await connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("maps aggregate money overflow to a private non-retryable failure", async () => {
    // Mutations killed: allowing BigInt aggregation to throw escapes the stable connector failure contract.
    const amount = "9".repeat(80);
    const aggregated = { ...cost("u", null, amount), results: [
      { amount, list_amount: amount, currency: "USD" },
      { amount, list_amount: amount, currency: "USD" },
    ] };
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/user_usage_report")
      ? json(opaquePage([usage("u", "a@example.test")]))
      : json(opaquePage([aggregated])));
    await expect(connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW })).resolves.toEqual({
      ok: false, code: "provider_error", retryable: false, raw: null,
    });
  });

  it.each([
    [["1.2", "3.45"], "0.0465"],
    [["99.9", "0.1"], "1.000"],
    [["10.25", "-0.25"], "0.1000"],
    [["1.00", "-1.00"], "0.0000"],
    [["999.99", "0.01", "-500.00"], "5.0000"],
  ] as const)("aggregates differing-scale signed fractional cents %j exactly", async (amounts, amountUsd) => {
    // Mutations killed: first/last-only, wrong scale, missing carry, or lost sign changes the literal total.
    const row = {
      ...cost("u", null, amounts[0]),
      results: amounts.map((amount) => ({ amount, list_amount: amount, currency: "USD" })),
    };
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/user_usage_report")
      ? json(opaquePage([usage("u", "a@example.test")]))
      : json(opaquePage([row])));
    expect(await successValue(connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      records: [{ email: "a@example.test", costDate: "2026-09-06", amountUsd }],
    });
  });

  it.each([
    ["1e3", "USD"], ["+1", "USD"], ["01", "USD"], ["-0.00", "USD"],
    ["1", "EUR"], [`1${"0".repeat(100)}`, "USD"],
  ] as const)("rejects unsafe cost amount %s %s without a partial result", async (amount, currency) => {
    // Mutations killed: Number conversion, permissive decimal syntax, or ignored currency returns an incorrect amount.
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      return path.endsWith("/user_usage_report")
        ? json(opaquePage([usage("u", "a@example.test")]))
        : json(opaquePage([cost("u", null, amount, currency)]));
    });
    expect(await connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("preserves exact fractional cents with a fixed-seed money property", async () => {
    // Mutations killed: changing sign, scale, decimal position, or using binary floating point breaks the invariant.
    await fc.assert(fc.asyncProperty(
      fc.bigInt({ min: -999_999_999_999_999n, max: 999_999_999_999_999n }),
      fc.integer({ min: 0, max: 8 }),
      async (unscaled, scale) => {
        const negative = unscaled < 0n;
        const digits = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, "0");
        const cents = scale === 0
          ? `${negative ? "-" : ""}${digits}`
          : `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
        const { connector } = fixture(async (request) => {
          const path = new URL(request.url).pathname;
          return path.endsWith("/user_usage_report")
            ? json(opaquePage([usage("u", "a@example.test")]))
            : json(opaquePage([cost("u", null, cents)]));
        });
        const result = await connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const usd = result.value.records[0]!.amountUsd;
        const normalized = usd.replace(".", "");
        expect(BigInt(normalized)).toBe(unscaled);
        expect(usd.split(".")[1]).toHaveLength(scale + 2);
        expect(usd.startsWith("-")).toBe(unscaled < 0n);
      },
    ), { seed: 58_058, numRuns: 40 });
  });

  it.each([
    ["client", "provision", 400, false, 1],
    ["unsafe rate limit", "provision", 429, false, 1],
    ["unsafe provider", "provision", 503, false, 1],
    ["safe rate limit", "syncMembers", 429, true, 3],
    ["safe provider", "syncMembers", 503, true, 3],
  ] as const)("maps exact %s failure metadata and evidence", async (_case, operation, status, retryable, attempts) => {
    // Mutations killed: wrong endpoint safety/class/status or lost retry attempts changes result/evidence.
    let calls = 0;
    const { connector, journal } = fixture(async () => { calls += 1; return json({ type: "error" }, status); });
    const result = operation === "provision"
      ? await connector.provision({ requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "a@example.test", licenseTypeName: "Claude" })
      : await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW });
    expect(result).toEqual({ ok: false, code: "provider_error", retryable, raw: null });
    expect(calls).toBe(attempts);
    expect(journal.filter(({ phase }) => phase === "requested")).toHaveLength(attempts);
    expect(journal.filter(({ phase }) => phase === "failed")).toHaveLength(attempts);
  });

  it.each([
    ["provision", false], ["syncMembers", true],
  ] as const)("maps ambiguous %s transport with endpoint-aware retryability", async (operation, retryable) => {
    // Mutations killed: treating an unsafe ambiguous POST as replayable or a safe read as terminal changes recovery semantics.
    const { connector, journal } = fixture(async () => { throw new Error("provider secret"); });
    const result = operation === "provision"
      ? await connector.provision({ requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "a@example.test", licenseTypeName: "Claude" })
      : await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW });
    expect(result).toEqual({ ok: false, code: "provider_error", retryable, raw: null });
    expect(journal.map(({ phase }) => phase)).toEqual(["requested"]);
  });

  it("fails cross-account credentials before transport", async () => {
    // Mutations killed: skipping account binding allows another tenant's credential to reach Anthropic.
    let transports = 0;
    const foreign: readonly AnthropicCredentialCandidate[] = credentials.map((candidate) => ({
      ...candidate,
      vendorAccountId: "55555555-5555-4555-8555-555555555555",
    }));
    const { connector } = fixture(async () => { transports += 1; return json({}); }, foreign);
    await expect(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })).rejects.toThrow("credential");
    expect(transports).toBe(0);
  });

  it("rejects invalid neutral input and session creation before transport", async () => {
    // Mutations killed: validation after dependency effects or swallowing session failure reaches Anthropic.
    let transports = 0;
    let credentialLookups = 0;
    const sessionFailure = new Error("session failed");
    const clock = { now: () => NOW.getTime() };
    const sleep = async () => undefined;
    const connector = createAnthropicConnector({
      credentialsFor: async () => { credentialLookups += 1; return credentials; },
      observationSessionFor: async () => { throw sessionFailure; },
      requestDependencies: {
        clock, sleep, limiter: createAnthropicRateLimiter({ clock, sleep }),
        transport: async () => { transports += 1; return json({}); },
      },
    });
    await expect(connector.provision({
      requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "not-an-email", licenseTypeName: "Claude",
    })).rejects.toThrow("personEmail");
    expect(credentialLookups).toBe(0);
    await expect(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })).rejects.toBe(sessionFailure);
    expect(transports).toBe(0);
  });

  it("accepts case-insensitive JSON media essence with parameters", async () => {
    // Mutations killed: comparing the whole header instead of its normalized essence rejects valid provider JSON.
    const { connector } = fixture(async () => new Response(JSON.stringify(invite("i", "a@example.test")), {
      status: 201,
      headers: { "content-type": "Application/JSON; Charset=UTF-8" },
    }));
    expect(await successValue(connector.provision({
      requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "a@example.test", licenseTypeName: "Claude",
    }))).toEqual({ vendorRef: "i" });
  });

  it.each(["application/jsonp", "text/plain;note=application/json"])(
    "rejects non-JSON media type %s and cancels its unread body",
    async (contentType) => {
      // Mutations killed: substring matching accepts JSON-like tokens outside the media-type essence.
      let cancellations = 0;
      const { connector } = fixture(async () => new Response(new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(invite("i", "a@example.test"))));
          controller.close();
        },
        cancel() { cancellations += 1; },
      }), { status: 200, headers: { "content-type": contentType } }));
      expect(await connector.provision({
        requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "a@example.test", licenseTypeName: "Claude",
      })).toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
      expect(cancellations).toBe(1);
    },
  );

  it("prevents transport when requested evidence fails and propagates terminal evidence failure", async () => {
    // Mutations killed: transport-before-request or swallowing terminal persistence errors violates the durable boundary.
    let transports = 0;
    const persistenceFailure = new Error("persistence failed");
    const clock = { now: () => NOW.getTime() };
    const sleep = async () => undefined;
    const requestedFailure = createAnthropicConnector({
      credentialsFor: async () => credentials,
      observationSessionFor: async (input) => createConnectorCallObservationSession({
        vendorAccountId: input.vendorAccountId, provisioningActionId: null, operation: input.operation,
        clock: () => NOW, randomId: () => CORRELATION, append: async () => { throw persistenceFailure; },
      }),
      requestDependencies: { clock, sleep, limiter: createAnthropicRateLimiter({ clock, sleep }), transport: async () => { transports += 1; return json(idPage([])); } },
    });
    await expect(requestedFailure.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })).rejects.toBe(persistenceFailure);
    expect(transports).toBe(0);

    const phases: string[] = [];
    const terminalFailure = createAnthropicConnector({
      credentialsFor: async () => credentials,
      observationSessionFor: async (input) => createConnectorCallObservationSession({
        vendorAccountId: input.vendorAccountId, provisioningActionId: null, operation: input.operation,
        clock: () => NOW, randomId: () => CORRELATION, append: async (event) => {
          phases.push(event.phase);
          if (event.phase !== "requested") throw persistenceFailure;
        },
      }),
      requestDependencies: { clock, sleep, limiter: createAnthropicRateLimiter({ clock, sleep }), transport: async () => json(idPage([])) },
    });
    await expect(terminalFailure.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })).rejects.toBe(persistenceFailure);
    expect(phases).toEqual(["requested", "succeeded"]);
  });
});
