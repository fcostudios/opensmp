import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createConnectorCallObservationSession,
  type ConnectorCallObservationAppendInput,
  type ConnectorOperation,
} from "../../connector-call-observation.js";
import { fractionalCentsToUsd, normalizeCostUsd } from "../../contracts.js";
import type { ConnectorResult, VendorConnector } from "../../contracts.js";
import { createConnectorDispatcher } from "../../dispatch.js";
import type { AnthropicCredentialCandidate } from "./credentials.js";
import { createAnthropicConnectorObservationBridge } from "./observation.js";
import { createAnthropicRateLimiter } from "./rate-limiter.js";
import type { AnthropicTransport } from "./request.js";
import { createAnthropicConnector } from "@smp/connectors/providers/anthropic/connector";

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
  return data.length === 0 || data.some(item => item !== null && typeof item === "object" && "user" in item)
    ? {data,has_more:nextPage !== null,next_page:nextPage} : {data,next_page:nextPage};
}

function member(id: string, email: string | null) {
  return { type: "user", id, name: "Member", email };
}

function invite(id: string, email: string | null, status = "pending") {
  return { type: "invite", id, email, status };
}

function analyticsUser(id: string, email: string | null) {
  return { user: {type: "user", id, email_address: email}, chat_metrics: {message_count:2} };
}

function summary(date = "2026-09-06", activeUsers = 1, conversations = 2) {
  return { date, active_users: activeUsers, conversations };
}

// Documented per-user cost report: https://platform.claude.com/docs/en/api/http/beta/organization/analytics/user_cost_report/list
function cost(id: string, email: string | null, amount = "123.45", currency = "USD") {
  return {
    actor: { type: "user_actor", deleted: email === null, email, email_address: email, name: email === null ? "Deleted User" : "Member", user_id: id },
    amount, list_amount: amount, currency,
    starting_at: "2026-09-06T00:00:00Z", ending_at: "2026-09-07T00:00:00Z", model: null, product: null, requests: 1,
    cost_type: null, context_window: null, inference_geo: null, rbac_group_id: null,
    slack_channel_id: null, speed: null, token_type: null, claude_tag_category: null, claude_tag_user_id: null,
  };
}

function costPage(data: readonly unknown[], nextPage: string | null = null) {
  return {data, has_more: nextPage !== null, next_page: nextPage, organization_id: "org-contract", data_refreshed_at: "2026-09-06T12:00:00Z"};
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

async function successValue<T>(operation: Promise<ConnectorResult<T>>, raw: unknown = null): Promise<T> {
  const result = await operation;
  expect(result).toMatchObject({ ok: true, raw });
  if (!result.ok) throw new Error("expected connector success");
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.value)).toBe(true);
  return result.value;
}

function legacySnapshot<T extends { records?: unknown; evidence?: unknown }>(value: T): Omit<T, "records" | "evidence"> {
  const { records: _records, evidence: _evidence, ...legacy } = value;
  return legacy;
}

async function legacyMemberValue<T extends { members: readonly unknown[]; records?: unknown; evidence?: unknown }>(operation: Promise<ConnectorResult<T>>) {
  return legacySnapshot(await successValue(operation));
}


it("keeps distinct documented person counters without summaries", async () => {
  const requests: Request[] = [];
  const { connector } = fixture(async request => { requests.push(request); return json({data:[
    {user:{type:"user",id:"u-a",email_address:"ALICE@example.test"},chat_metrics:{message_count:2,thinking_message_count:null},unrelated:{authorization:"must-not-persist"}},
    {user:{type:"user",id:"u-b",email_address:"bob@example.test"},chat_metrics:{message_count:7}},
    {user:null,chat_metrics:{message_count:3}},
  ],has_more:false,next_page:null}); });
  const result = await connector.syncActivity({vendorAccountId:ACCOUNT,observedAt:new Date("2026-10-03T00:00:00Z")});
  expect(result.ok).toBe(true);
  if(!result.ok) throw new Error("expected activity success");
  expect(result.value.records.map(row=>row.counters)).toEqual([{chat_metrics:{message_count:2,thinking_message_count:null}},{chat_metrics:{message_count:7}},{chat_metrics:{message_count:3}}]);
  expect(result.value.records[2]!.email).toBeNull();
  expect(result.value.records.every(row=>row.activityDate === "2026-10-03")).toBe(true);
  expect(requests.map(request=>new URL(request.url).pathname)).toEqual(["/v1/organizations/analytics/users"]);
});

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
    const { connector: implementation, sessions, credentialLookups } = fixture(async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === "POST") return json(invite("inv-1", "new@example.test"), 201);
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/users") && !url.pathname.includes("analytics")) {
        return json(idPage([member("usr-1", "member@example.test"), member("usr-null", null)]));
      }
      if (url.pathname.endsWith("/invites")) return json(idPage([invite("inv-1", "pending@example.test")]));
      if (url.pathname.endsWith("/analytics/users")) return json(opaquePage([analyticsUser("usr-1", "member@example.test")]));
      if (url.pathname.endsWith("/summaries")) return json({ summaries: [summary()] });
      if (url.pathname.endsWith("/user_cost_report")) return json(costPage([cost("usr-1", "member@example.test")]));
      throw new Error(`unexpected transport request ${request.method} ${url.pathname}`);
    });
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");
    const dispatchedCapabilities = connector.capabilities();
    expect([...dispatchedCapabilities]).toEqual([
      "provision", "deprovision", "syncMembers", "syncActivity", "syncCost",
    ]);
    expect(Object.isFrozen(dispatchedCapabilities)).toBe(true);
    expect(() => (dispatchedCapabilities as Set<string>).add("forged")).toThrow(TypeError);

    expect(await successValue(connector.provision({ requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "new@example.test", licenseTypeName: "Claude" })))
      .toEqual({ vendorRef: "inv-1" });
    expect(await successValue(connector.deprovision({ requestId: REQUEST, vendorAccountId: ACCOUNT, personEmail: "member@example.test", licenseTypeName: "Claude" })))
      .toEqual({ vendorRef: "usr-1" });
    expect(await legacyMemberValue(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      members: [
        { email: "member@example.test", active: true },
        { email: "pending@example.test", active: false },
      ],
    });
    expect(await successValue(connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      records: [{ email: "member@example.test", providerUserId: "usr-1", activityDate: "2026-09-06", counters: { chat_metrics: {message_count:2} } }],
    });
    expect(await successValue(connector.syncCost({ vendorAccountId: ACCOUNT, observedAt: NOW }), {
      version: 1, records: [{identity:{email:"member@example.test",providerUserId:"usr-1"},costDate:"2026-09-06",amountUsd:"1.2345",amountCents:"123.45"}],
    })).toEqual({
      records: [{ email: "member@example.test", providerUserId: "usr-1", costDate: "2026-09-06", amountUsd: "1.2345", amountCents: "123.45" }],
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

  it("preserves an exact frozen provider failure through rest dispatch", async () => {
    // Mutations killed: bypassing dispatch validation or changing provider failure
    // retryability/raw containment changes the exact result.
    const { connector: implementation } = fixture(async () => json({
      type: "error",
      error: { type: "authentication_error" },
    }, 401));
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");

    const result = await connector.provision({
      requestId: REQUEST,
      vendorAccountId: ACCOUNT,
      personEmail: "member@example.test",
      licenseTypeName: "Claude",
    });

    expect(result).toEqual({
      ok: false,
      code: "provider_error",
      retryable: false,
      raw: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("maps the exact invite seat-limit response to frozen sanitized recovery evidence", async () => {
    // Mutations killed: losing exact no-seat classification or leaking provider fields routes capacity exhaustion as a generic failure.
    const providerMessage = "Your organization has reached its seat limit.";
    const { connector: implementation, journal } = fixture(async () => json({
      type: "error",
      error: { type: "invalid_request_error", message: providerMessage },
    }, 400));
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");

    const result = await connector.provision({
      requestId: REQUEST,
      vendorAccountId: ACCOUNT,
      personEmail: "member@example.test",
      licenseTypeName: "Claude",
    });

    expect(result).toEqual({
      ok: false,
      code: "capacity_unavailable",
      retryable: false,
      raw: { failure_code: "capacity_unavailable" },
    });
    if (result.ok || result.code !== "capacity_unavailable") {
      throw new Error("expected capacity-unavailable result");
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.raw)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(providerMessage);
    expect(journal.at(-1)).toMatchObject({
      phase: "failed",
      classification: "client_error",
      summary: {
        endpoint_class: "invitations",
        method: "POST",
        http_status: 400,
        status_class: "client_error",
        failure_code: "capacity_unavailable",
      },
    });
  });

  it.each(["other@example.test", null])(
    "rejects a provision response whose recipient is %s",
    async (email) => {
      // Mutations killed: accepting an unrelated/null response recipient binds
      // a provider reference to the wrong provisioning action.
      const { connector } = fixture(async () => json(invite("inv-wrong", email), 201));
      await expect(connector.provision({
        requestId: REQUEST,
        vendorAccountId: ACCOUNT,
        personEmail: "member@example.test",
        licenseTypeName: "Claude",
      })).resolves.toEqual({
        ok: false,
        code: "provider_error",
        retryable: false,
        raw: null,
      });
    },
  );

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

  it.each([
    [200, false],
    [202, true],
  ] as const)("releases an unused successful DELETE %i body when cancellation rejects=%s", async (status, rejects) => {
    // Mutations killed: discarding the executor response leaks a provider stream; propagating cancel failure loses success.
    let cancellations = 0;
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/users")) return json(idPage([member("member-1", "target@example.test")]));
      if (path.endsWith("/invites")) return json(idPage([]));
      return new Response(new ReadableStream({
        cancel() {
          cancellations += 1;
          if (rejects) throw new Error("provider body cancellation failed");
        },
      }), { status });
    });

    expect(await connector.deprovision({
      requestId: REQUEST,
      vendorAccountId: ACCOUNT,
      personEmail: "target@example.test",
      licenseTypeName: "Claude",
    })).toEqual({ ok: true, value: { vendorRef: "member-1" }, raw: null });
    expect(cancellations).toBe(1);
  });

  it("deprovisions exactly one matching invitation through the invite endpoint", async () => {
    // Mutations killed: selecting the member branch or dropping the invitation match targets the wrong resource.
    const seen: string[] = [];
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      seen.push(`${request.method} ${path}`);
      if (path.endsWith("/users")) return json(idPage([]));
      if (path.endsWith("/invites")) return json(idPage([invite("invite-1", "target@example.test")]));
      return new Response(null, { status: 204 });
    });

    expect(await successValue(connector.deprovision({
      requestId: REQUEST,
      vendorAccountId: ACCOUNT,
      personEmail: "target@example.test",
      licenseTypeName: "Claude",
    }))).toEqual({ vendorRef: "invite-1" });
    expect(seen).toEqual([
      "GET /v1/organizations/users",
      "GET /v1/organizations/invites",
      "DELETE /v1/organizations/invites/invite-1",
    ]);
  });

  it("rejects a provider ID collision before destructive or sync consumption through dispatch", async () => {
    // Mutations killed: checking only email uniqueness lets one provider identity map to conflicting actors or DELETE.
    const methods: string[] = [];
    const { connector: implementation } = fixture(async (request) => {
      methods.push(request.method);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/users")) {
        return json(idPage([member("shared-id", "target@example.test")]));
      }
      if (path.endsWith("/invites")) {
        return json(idPage([invite("shared-id", "different@example.test")]));
      }
      return new Response(null, { status: 204 });
    });
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");
    const expected = { ok: false, code: "provider_error", retryable: false, raw: null } as const;

    expect(await connector.deprovision({
      requestId: REQUEST,
      vendorAccountId: ACCOUNT,
      personEmail: "target@example.test",
      licenseTypeName: "Claude",
    })).toEqual(expected);
    expect(methods).toEqual(["GET", "GET"]);
    expect(methods).not.toContain("DELETE");

    expect(await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })).toEqual(expected);
    expect(methods).toEqual(["GET", "GET", "GET", "GET"]);
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
    ]);
    expect(journal.filter(({ phase }) => phase === "requested").map(({ attempt }) => attempt)).toEqual([1, 2]);
  });

  it.each([
    ["ID", idPage([], true, "next\npage"), "members"],
    ["opaque", opaquePage([], "next\u0000page"), "activity"],
  ] as const)("maps a malformed nonblank %s provider cursor after one successful attempt", async (_case, body, operation) => {
    // Mutations killed: deferring provider-cursor validation to request construction rejects the public promise.
    let transports = 0;
    const { connector, journal } = fixture(async () => {
      transports += 1;
      return json(body);
    });
    const result = operation === "members"
      ? connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })
      : connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW });

    await expect(result).resolves.toEqual({
      ok: false,
      code: "provider_error",
      retryable: false,
      raw: null,
    });
    expect(transports).toBe(1);
    expect(journal.map(({ phase, attempt, classification }) => ({ phase, attempt, classification }))).toEqual([
      { phase: "requested", attempt: 1, classification: null },
      { phase: "succeeded", attempt: 1, classification: "success" },
    ]);
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

  it("fails at the total page budget before publishing an exhausted invitations continuation", async () => {
    // The total 100-page bound cannot produce a resumable invitations cursor at count 100.
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
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect({ memberCalls, inviteCalls }).toEqual({ memberCalls: 100, inviteCalls: 0 });
  });

  it("rejects a page-100 members continuation but permits a terminal invitations page through both connector boundaries", async () => {
    for (const dispatched of [false, true]) {
      const { connector: implementation } = fixture(async () => json(idPage([])));
      const connector = dispatched ? createConnectorDispatcher({ rest: implementation }).forProtocol("rest") : implementation;
      for (const stream of ["members", "invitations"] as const) {
        const result = await connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW,
          cursor: { stream, pageCount: 99, memberSetSize: 0 },
          resume: { vendorAccountId: ACCOUNT, stream, continuation: "page99", seenContinuations: ["page99"], pageCount: 99, memberSetSize: 0 } });
        expect(result.ok ? { ...result, value: legacySnapshot(result.value) } : result).toEqual(stream === "members"
          ? { ok: false, code: "provider_error", retryable: false, raw: null }
          : { ok: true, raw: null, value: { members: [], cursor: null, resume: null, pageCount: 100, memberSetSize: 0, complete: true } });
      }
    }
  });

  it("uses each provider ID cursor and combines only terminal member pages", async () => {
    // Mutations killed: dropping either cursor or page data loses provider members without surfacing a failure.
    const seen: string[] = [];
    const { connector } = fixture(async (request) => {
      const url = new URL(request.url);
      seen.push(`${url.pathname}?${url.searchParams.toString()}`);
      const afterId = url.searchParams.get("after_id");
      if (url.pathname.endsWith("/users")) {
        return afterId === null
          ? json(idPage([member("u1", "a@example.test")], true, "member-next"))
          : json(idPage([member("u2", "b@example.test")]));
      }
      return afterId === null
        ? json(idPage([invite("i1", "c@example.test")], true, "invite-next"))
        : json(idPage([invite("i2", "d@example.test")]));
    });

    expect(await legacyMemberValue(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      members: [
        { email: "a@example.test", active: true },
        { email: "b@example.test", active: true },
        { email: "c@example.test", active: false },
        { email: "d@example.test", active: false },
      ],
    });
    expect(seen).toEqual([
      "/v1/organizations/users?limit=1000",
      "/v1/organizations/users?limit=1000&after_id=member-next",
      "/v1/organizations/invites?limit=1000",
      "/v1/organizations/invites?limit=1000&after_id=invite-next",
    ]);
  });

  it.each([
    ["null pending email", [invite("i1", null)], [], 0],
    ["two distinct emails", [invite("i1", "A@example.test"), invite("i2", "b@example.test")], [{ email: "a@example.test", active: false }, { email: "b@example.test", active: false }], 2],
  ])("maps invitation page members independently: %s", async (_name, data, members, memberSetSize) => {
    const { connector } = fixture(async () => json(idPage(data as never)));
    const result = await connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW,
      cursor: { stream: "invitations", pageCount: 1, memberSetSize: 0 },
      resume: { vendorAccountId: ACCOUNT, stream: "invitations", continuation: null, seenContinuations: [], pageCount: 1, memberSetSize: 0 } });
    expect(result.ok ? { ...result, value: legacySnapshot(result.value) } : result)
      .toEqual({ ok: true, raw: null, value: { members, cursor: null, resume: null, pageCount: 2, memberSetSize, complete: true } });
  });

  it("retains ambiguous authoritative evidence and excludes it from legacy polling page", async () => {
    const { connector } = fixture(async () => json(idPage([member("u1", "A@example.test"), member("u2", "a@example.test")])));
    const result = await connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW, cursor: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("expected lossless ambiguous evidence");
    expect(result.value.members).toEqual([]);
    expect(result.value.records?.map(record => record.email)).toEqual(["a@example.test", "a@example.test"]);
  });

  it.each(["x".repeat(513), "x\u202ey"])("rejects unsafe direct page tokens before transport: %j", async (token) => {
    let calls = 0;
    const { connector } = fixture(async () => { calls += 1; return json(idPage([])); });
    expect(await connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW,
      cursor: { stream: "members", pageCount: 1, memberSetSize: 0 },
      resume: { vendorAccountId: ACCOUNT, stream: "members", continuation: token, seenContinuations: [token], pageCount: 1, memberSetSize: 0 } }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(0);
  });

  it.each(["x".repeat(513), "x\u202ey"])("does not publish an unusable provider continuation: %j", async (token) => {
    const { connector } = fixture(async () => json(idPage([], true, token)));
    expect(await connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW, cursor: null }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("rejects malformed direct checkpoints independently of the detached-pair guard", async () => {
    let calls = 0;
    const { connector } = fixture(async () => { calls += 1; return json(idPage([])); });
    const cursor = { stream: "members", pageCount: 1, memberSetSize: 1 };
    const resume = { vendorAccountId: ACCOUNT, stream: "members", continuation: "next", seenContinuations: ["next"], pageCount: 1, memberSetSize: 1 };
    for (const pair of [
      { cursor: undefined, resume: undefined },
      { cursor: { ...cursor, extra: true }, resume },
      { cursor: Object.assign([], cursor), resume },
      { cursor: Object.assign(() => undefined, cursor), resume },
      { cursor, resume: { ...resume, extra: true } },
      { cursor, resume: Object.assign([], resume) },
      { cursor, resume: Object.assign(() => undefined, resume) },
      { cursor, resume: { ...resume, seenContinuations: ["next", "next"] } },
      { cursor, resume: { ...resume, continuation: undefined } },
      { cursor, resume: { ...resume, memberSetSize: 2 } },
      { cursor: { ...cursor, pageCount: 0 }, resume: { ...resume, pageCount: 0 } },
    ]) {
      await expect(connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW, ...pair } as never))
        .resolves.toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    }
    expect(calls).toBe(0);
  });

  it("accepts an explicit null initial resume without rejecting the first page", async () => {
    const { connector } = fixture(async () => json(idPage([member("u1", "a@example.test")])));
    const page = await legacyMemberValue(connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW, cursor: null, resume: null }));
    expect(page.members).toEqual([{ email: "a@example.test", active: true }]);
    expect(page.pageCount).toBe(1);
  });

  it("returns immutable member pages that resume members then invitations without refetching a completed page", async () => {
    // Mutations killed: losing a continuation, resetting page totals, or fetching a completed stream causes a different request trace or evidence.
    const seen: string[] = [];
    const { connector: implementation } = fixture(async (request) => {
      const url = new URL(request.url);
      seen.push(`${url.pathname}?${url.searchParams.toString()}`);
      const afterId = url.searchParams.get("after_id");
      if (url.pathname.endsWith("/users")) {
        return afterId === null
          ? json(idPage([member("u1", "first@example.test")], true, "member-next"))
          : json(idPage([member("u2", "second@example.test")]));
      }
      return json(idPage([invite("i1", "pending@example.test")]));
    });
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");
    const input = { vendorAccountId: ACCOUNT, observedAt: NOW };

    const first = await legacyMemberValue(connector.syncMemberPage({ ...input, cursor: null }));
    expect(first).toEqual({
      members: [{ email: "first@example.test", active: true }],
      cursor: { stream: "members", pageCount: 1, memberSetSize: 1 },
      resume: { vendorAccountId: ACCOUNT, stream: "members", continuation: "member-next", seenContinuations: ["member-next"], pageCount: 1, memberSetSize: 1 },
      pageCount: 1,
      memberSetSize: 1,
      complete: false,
    });
    expect(Object.isFrozen(first.cursor!)).toBe(true);
    expect(JSON.stringify(first.cursor)).not.toContain("member-next");
    expect(JSON.stringify(first.cursor)).not.toContain("u1");
    expect(JSON.stringify(first.cursor)).not.toContain("first@example.test");

    const second = await legacyMemberValue(connector.syncMemberPage({ ...input, cursor: first.cursor, resume: first.resume }));
    expect(second).toEqual({
      members: [{ email: "second@example.test", active: true }],
      cursor: { stream: "invitations", pageCount: 2, memberSetSize: 2 },
      resume: { vendorAccountId: ACCOUNT, stream: "invitations", continuation: null, seenContinuations: [], pageCount: 2, memberSetSize: 2 },
      pageCount: 2,
      memberSetSize: 2,
      complete: false,
    });

    const terminal = await legacyMemberValue(connector.syncMemberPage({ ...input, cursor: second.cursor, resume: second.resume }));
    expect(terminal).toEqual({
      members: [{ email: "pending@example.test", active: false }],
      cursor: null,
      resume: null,
      pageCount: 3,
      memberSetSize: 3,
      complete: true,
    });
    expect(seen).toEqual([
      "/v1/organizations/users?limit=1000",
      "/v1/organizations/users?limit=1000&after_id=member-next",
      "/v1/organizations/invites?limit=1000",
    ]);
  });

  it("rejects detached or recombined member-page evidence before a provider request", async () => {
    // A public checkpoint and account-bound resume are one atomic continuation; fragments must not re-fetch page one.
    let calls = 0;
    const { connector } = fixture(async () => {
      calls += 1;
      return calls === 1
        ? json(idPage([member("u1", "first@example.test")], true, "member-next"))
        : json(idPage([member("u2", "second@example.test")]));
    });
    const input = { vendorAccountId: ACCOUNT, observedAt: NOW };
    const first = await legacyMemberValue(connector.syncMemberPage({ ...input, cursor: null }));

    for (const fragment of [
      { cursor: first.cursor },
      { cursor: null, resume: first.resume },
      { cursor: { ...first.cursor!, stream: "invitations" as const }, resume: first.resume },
      { cursor: { ...first.cursor!, pageCount: first.pageCount + 1 }, resume: first.resume },
      { cursor: first.cursor, resume: { ...first.resume!, vendorAccountId: "55555555-5555-4555-8555-555555555555" } },
    ]) {
      await expect(connector.syncMemberPage({ ...input, ...fragment } as never))
        .resolves.toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    }
    expect(calls).toBe(1);
  });

  it("fails the legacy full snapshot at the first non-adjacent page cycle", async () => {
    // Mutations killed: retaining only an adjacent-cycle guard issues provider calls until the 100-page bound.
    let calls = 0;
    const { connector } = fixture(async (request) => {
      if (!new URL(request.url).pathname.endsWith("/users")) return json(idPage([]));
      calls += 1;
      return calls === 1
        ? json(idPage([], true, "cursor-a"))
        : calls === 2
          ? json(idPage([], true, "cursor-b"))
          : json(idPage([], true, "cursor-a"));
    });
    await expect(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .resolves.toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(3);
  });

  it.each([
    ["an array", []],
    ["the wrong number of fields", { stream: "members", pageCount: 1 }],
    ["an unknown stream", { stream: "other", pageCount: 1, memberSetSize: 1 }],
    ["a negative page count", { stream: "members", pageCount: -1, memberSetSize: 1 }],
    ["a fractional page count", { stream: "members", pageCount: 1.5, memberSetSize: 1 }],
    ["the page limit", { stream: "members", pageCount: 100, memberSetSize: 1 }],
    ["a negative member total", { stream: "members", pageCount: 1, memberSetSize: -1 }],
  ] as const)("rejects a direct page request with %s public evidence before contacting Anthropic", async (_case, cursor) => {
    // Mutations killed: accepting malformed public evidence can reissue pages or bypass the bounded resumable protocol.
    let calls = 0;
    const { connector } = fixture(async () => { calls += 1; return json(idPage([])); });

    await expect(connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW, cursor: cursor as never }))
      .resolves.toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(0);
  });

  it.each([
    ["an array", []],
    ["the wrong number of fields", { vendorAccountId: ACCOUNT, stream: "members", continuation: "next" }],
    ["another vendor account", { vendorAccountId: "55555555-5555-4555-8555-555555555555", stream: "members", continuation: "next", seenContinuations: ["next"], pageCount: 1, memberSetSize: 1 }],
    ["an unknown stream", { vendorAccountId: ACCOUNT, stream: "other", continuation: "next", seenContinuations: ["next"], pageCount: 1, memberSetSize: 1 }],
    ["a control character token", { vendorAccountId: ACCOUNT, stream: "members", continuation: "next\n", seenContinuations: ["next"], pageCount: 1, memberSetSize: 1 }],
    ["an invalid seen token", { vendorAccountId: ACCOUNT, stream: "members", continuation: "next", seenContinuations: ["next\n"], pageCount: 1, memberSetSize: 1 }],
    ["a duplicate seen token", { vendorAccountId: ACCOUNT, stream: "members", continuation: "next", seenContinuations: ["next", "next"], pageCount: 1, memberSetSize: 1 }],
  ] as const)("rejects a direct page request with %s sensitive continuation before contacting Anthropic", async (_case, resume) => {
    // Mutations killed: accepting foreign, malformed, or repeated provider state breaks the secure account-bound resume boundary.
    let calls = 0;
    const { connector } = fixture(async () => { calls += 1; return json(idPage([])); });

    await expect(connector.syncMemberPage({ vendorAccountId: ACCOUNT, observedAt: NOW, cursor: null, resume: resume as never }))
      .resolves.toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(calls).toBe(0);
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

  it("excludes non-pending invitations from the neutral member snapshot", async () => {
    // Mutations killed: weakening the pending-state conjunction registers accepted or expired invitations as members.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/users")
      ? json(idPage([]))
      : json(idPage([
        invite("pending", "pending@example.test"),
        { ...invite("accepted", "accepted@example.test"), status: "accepted" },
      ])));
    expect(await legacyMemberValue(connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW }))).toEqual({
      members: [{ email: "pending@example.test", active: false }],
    });
  });

  it("retains ambiguous authoritative evidence and excludes it from legacy polling snapshot", async () => {
    // Preserve ambiguity for acceptance warnings while refusing that identity to legacy polling.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/users")
      ? json(idPage([member("u", "Person@Example.test")]))
      : json(idPage([invite("i", "person@example.test")])));
    const result = await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("expected lossless ambiguous evidence");
    expect(result.value.members).toEqual([]);
    expect(result.value.records?.map(record => record.email)).toEqual(["person@example.test", "person@example.test"]);
  });

  it.each([
    {
      name: "null ID-page envelope",
      operation: "members",
      stage: "members",
      body: null,
      expectedPaths: ["/v1/organizations/users"],
    },
    {
      name: "whitespace-only member name",
      operation: "members",
      stage: "members",
      body: idPage([{ ...member("u", "a@example.test"), name: "  " }]),
      expectedPaths: ["/v1/organizations/users"],
    },
    {
      name: "null user envelope",
      operation: "activity",
      stage: "analytics",
      body: null,
      expectedPaths: ["/v1/organizations/analytics/users"],
    },
    {
      name: "null opaque-page envelope",
      operation: "activity",
      stage: "analytics",
      body: null,
      expectedPaths: ["/v1/organizations/analytics/users"],
    },
    {
      name: "malformed member email",
      operation: "members",
      stage: "members",
      body: idPage([member("u", "not-an-email")]),
      expectedPaths: ["/v1/organizations/users"],
    },
    {
      name: "numeric member name",
      operation: "members",
      stage: "members",
      body: idPage([{ ...member("u", "a@example.test"), name: 7 }]),
      expectedPaths: ["/v1/organizations/users"],
    },
    {
      name: "wrong member type", operation: "members", stage: "members",
      body: idPage([{ ...member("u", "a@example.test"), type: "invite" }]),
      expectedPaths: ["/v1/organizations/users"],
    },
    {
      name: "numeric member role", operation: "members", stage: "members",
      body: idPage([{ ...member("u", "a@example.test"), role: 7 }]),
      expectedPaths: ["/v1/organizations/users"],
    },
    {
      name: "wrong invitation type", operation: "members", stage: "invitations",
      body: idPage([{ ...invite("i", "a@example.test"), type: "user" }]),
      expectedPaths: ["/v1/organizations/users", "/v1/organizations/invites"],
    },
    {
      name: "numeric invitation role", operation: "members", stage: "invitations",
      body: idPage([{ ...invite("i", "a@example.test"), role: 7 }]),
      expectedPaths: ["/v1/organizations/users", "/v1/organizations/invites"],
    },
    {
      name: "malformed invitation email", operation: "members", stage: "invitations",
      body: idPage([invite("i", "not-an-email")]),
      expectedPaths: ["/v1/organizations/users", "/v1/organizations/invites"],
    },
  ] as const)("contains malformed provider success: $name", async ({ operation, stage, body, expectedPaths }) => {
    // Mutations killed: weakening closed-shape/type guards exposes partial provider data or reaches a later endpoint.
    const seen: string[] = [];
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      seen.push(path);
      if (path.endsWith("/users") && !path.includes("analytics")) {
        return json(stage === "members" ? body : idPage([]));
      }
      if (path.endsWith("/invites")) return json(stage === "invitations" ? body : idPage([]));
      if (path.endsWith("/analytics/users")) {
        return json(stage === "analytics" ? body : opaquePage([analyticsUser("u", "a@example.test")]));
      }
      throw new Error(`unexpected transport request ${request.method} ${path}`);
    });
    const result = operation === "members"
      ? connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW })
      : connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW });

    await expect(result).resolves.toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(seen).toEqual(expectedPaths);
  });

  it.each([
    ["wrong date", {date:"2026-09-05"}],
    ["invalid date", {date:"2026-02-30"}],
    ["negative count", {chat_metrics:{message_count:-1}}],
    ["wrong count type", {chat_metrics:{message_count:"2"}}],
    ["wrong user type", {user:3}],
  ])("rejects malformed person activity: %s", async (_case, fields) => {
    const {connector} = fixture(async()=>json(opaquePage([{...analyticsUser("u","a@example.test"),...fields}])));
    expect(await connector.syncActivity({vendorAccountId:ACCOUNT,observedAt:NOW})).toEqual({ok:false,code:"provider_error",retryable:false,raw:null});
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

  it("rejects a duplicate analytics ID before requesting a summary", async () => {
    // Mutations killed: allowing a duplicate provider actor reaches summary retrieval with an ambiguous identity map.
    let summaryCalls = 0;
    const { connector } = fixture(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/analytics/users")) {
        return json(opaquePage([
          analyticsUser("duplicate", "a@example.test"),
          analyticsUser("duplicate", "b@example.test"),
        ]));
      }
      summaryCalls += 1;
      return json({ summaries: [summary()] });
    });
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
    expect(summaryCalls).toBe(0);
  });

  it("rejects a malformed analytics user ID", async () => {
    // Mutations killed: accepting lossy opaque IDs lets ambiguous provider identities enter joins.
    const { connector } = fixture(async (request) => new URL(request.url).pathname.endsWith("/analytics/users")
      ? json(opaquePage([analyticsUser("user\uD800", "a@example.test")]))
      : json({ summaries: [summary()] }));
    expect(await connector.syncActivity({ vendorAccountId: ACCOUNT, observedAt: NOW }))
      .toEqual({ ok: false, code: "provider_error", retryable: false, raw: null });
  });

  it("reads only per-user cost across one exact UTC day and preserves nullable identities", async () => {
    // Kills usage joins, lost nullable actors, wrong date bounds and leaking unknown fields.
    const calls: string[] = [];
    const {connector} = fixture(async request => {
      const url = new URL(request.url); calls.push(url.pathname + "?" + url.searchParams.toString());
      expect(request.headers.get("X-Api-Key")).toBe("analytics-secret");
      return json(costPage(url.searchParams.has("page")
        ? [cost("deleted", null, "-123.4500"), {...cost("none", null, "0.000000"), actor: null}]
        : [{...cost("u", "A@example.test"), unknown: {authorization:"must-not-persist"}}], url.searchParams.has("page") ? null : "opaque /+="));
    });
    const result = await connector.syncCost({vendorAccountId:ACCOUNT,observedAt:NOW});
    expect(result).toEqual({ok:true,value:{records:[
      {email:"a@example.test",providerUserId:"u",costDate:"2026-09-06",amountUsd:"1.2345",amountCents:"123.45"},
      {email:null,providerUserId:"deleted",costDate:"2026-09-06",amountUsd:"-1.2345",amountCents:"-123.4500"},
      {email:null,providerUserId:null,costDate:"2026-09-06",amountUsd:"0",amountCents:"0.000000"},
    ]},raw:{version:1,records:[
      {identity:{email:"a@example.test",providerUserId:"u"},costDate:"2026-09-06",amountUsd:"1.2345",amountCents:"123.45"},
      {identity:{email:null,providerUserId:"deleted"},costDate:"2026-09-06",amountUsd:"-1.2345",amountCents:"-123.4500"},
      {identity:{email:null,providerUserId:null},costDate:"2026-09-06",amountUsd:"0",amountCents:"0.000000"},
    ]}});
    expect(calls).toEqual([
      "/v1/organizations/analytics/user_cost_report?starting_at=2026-09-06T00%3A00%3A00Z&ending_at=2026-09-07T00%3A00%3A00Z&bucket_width=1d&limit=1",
      "/v1/organizations/analytics/user_cost_report?starting_at=2026-09-06T00%3A00%3A00Z&ending_at=2026-09-07T00%3A00%3A00Z&bucket_width=1d&limit=1&page=opaque+%2F%2B%3D",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/must-not-persist|authorization|secret|unknown|organization_id|data_refreshed_at|starting_at|ending_at|currency|list_amount|headers|vendorAccountId|source/);
  });

  it.each([
    ["non USD", {...cost("u",null),currency:"EUR"}],
    ["numeric amount", {...cost("u",null),amount:123}],
    ["unrepresentable fraction", cost("u",null,"0.001")],
    ["overflow", cost("u",null,"10000000000")],
    ["exponent", cost("u",null,"1e3")],
    ["malformed actor", {...cost("u",null),actor:3}],
    ["missing actor type", {...cost("u",null),actor:{email_address:null,user_id:"u"}}],
    ["wrong actor type", {...cost("u",null),actor:{...cost("u",null).actor,type:"organization"}}],
    ["malformed id", cost("bad\u0000id",null)],
    ["malformed email", cost("u","invalid")],
  ])("rejects malformed cost atomically: %s", async (_name,row) => {
    const {connector} = fixture(async()=>json(costPage([cost("valid","a@example.test"),row])));
    expect(await connector.syncCost({vendorAccountId:ACCOUNT,observedAt:NOW})).toEqual({ok:false,code:"provider_error",retryable:false,raw:null});
  });

  it.each(["repeat", "bound", "has_more mismatch"])("contains cost paging failure: %s", async mode => {
    let calls = 0;
    const {connector} = fixture(async()=>{
      calls++;
      const body = costPage([], mode === "repeat" ? "repeat" : String(calls));
      return json(mode === "has_more mismatch" ? {...body,has_more:false} : body);
    });
    expect(await connector.syncCost({vendorAccountId:ACCOUNT,observedAt:NOW})).toEqual({ok:false,code:"provider_error",retryable:false,raw:null});
    expect(calls).toBe(mode === "repeat" ? 2 : mode === "bound" ? 100 : 1);
  });

  it.each([
    ["100","1"], ["0","0"], ["-100","-1"],
    ["123.45","1.2345"], ["-123.45","-1.2345"], ["9999999999.99","99999999.9999"],
    ["-9999999999.99","-99999999.9999"], ["100.000000","1"], ["-0.0000","0"], ["+00123.4500","1.2345"],
  ])("converts exact fractional cents %s", (cents,usd)=>expect(fractionalCentsToUsd(cents)).toBe(usd));

  it.each(["0.001", "-0.001", "9999999999.991", "10000000000", "-10000000000", "1e3", "NaN", "Infinity", "", " 1", "1.", ".1", 1, null])("rejects invalid fractional cents %s", value=>expect(()=>fractionalCentsToUsd(value)).toThrow());

  it.each([
    ["123","123"], ["0","0"], ["-123","-123"],
    ["1.23000","1.23"], ["+001.2300","1.23"], ["-0.000000","0"], ["99999999.9999000","99999999.9999"], ["-99999999.9999","-99999999.9999"],
  ])("normalizes exact USD %s", (input,want)=>expect(normalizeCostUsd(input)).toBe(want));

  it.each(["0.00001", "-0.00001", "100000000", "-100000000", "1e2", "NaN", "Infinity", "", "1.2.3", 1, undefined, Object("1.23")])("rejects invalid USD %s", value=>expect(()=>normalizeCostUsd(value)).toThrow());

  it("round-trips signed integer ten-thousandths using an independent seeded money oracle", () => {
    // Kills incorrect scale, sign, precision, normalization and floating-point conversion.
    fc.assert(fc.property(fc.bigInt({min:-999_999_999_999n,max:999_999_999_999n}), units => {
      const negative = units < 0n;
      const absolute = negative ? -units : units;
      const centsDigits = absolute.toString().padStart(3,"0");
      const cents = `${negative ? "-" : ""}${centsDigits.slice(0,-2)}.${centsDigits.slice(-2)}0000`;
      const usd = fractionalCentsToUsd(cents);
      const [whole,fraction=""] = usd.replace("-","").split(".");
      const decoded = (BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4,"0"))) * (usd.startsWith("-") ? -1n : 1n);
      expect(decoded).toBe(units);
      expect(normalizeCostUsd(usd)).toBe(usd);
      expect(usd).toMatch(/^-?(?:0|[1-9]\d*)(?:\.\d{0,3}[1-9])?$/);
      expect(usd).not.toBe("-0");
    }),{seed:71_071,numRuns:200});
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


it.each([
  ["email conflict", {user:{type:"user",id:"u-a",email_address:"other@example.test"},chat_metrics:{message_count:2}}],
  ["metric conflict", {user:{type:"user",id:"u-a",email_address:"a@example.test"},chat_metrics:{message_count:7}}],
])("rejects a cross-page %s without partial records",async(_case,second)=>{
  let calls=0;
  const {connector}=fixture(async()=>json(opaquePage([calls++ ? second : analyticsUser("u-a","a@example.test")],calls === 1 ? "next" : null)));
  expect(await connector.syncActivity({vendorAccountId:ACCOUNT,observedAt:NOW})).toEqual({ok:false,code:"provider_error",retryable:false,raw:null});
  expect(calls).toBe(2);
});

it("preserves missing and null metric groups and collapses equivalent repeated identities",async()=>{
  const {connector,journal}=fixture(async()=>json(opaquePage([
    {user:{id:null,email_address:null},chat_metrics:null},
    {user:{id:"u-a",email_address:"A@example.test"}},
    {user:{id:"u-a",email_address:"a@example.test"},unknown:{secret:"do-not-retain"}},
  ])));
  const result=await connector.syncActivity({vendorAccountId:ACCOUNT,observedAt:NOW});
  expect(result).toEqual({ok:true,raw:null,value:{records:[
    {email:null,providerUserId:null,activityDate:"2026-09-06",counters:{chat_metrics:null}},
    {email:"a@example.test",providerUserId:"u-a",activityDate:"2026-09-06",counters:{}},
  ]}});
  expect(JSON.stringify([result,journal])).not.toContain("do-not-retain");
});


describe("documented activity identity and page contracts", () => {
  const failure = { ok: false, code: "provider_error", retryable: false, raw: null };
  const input = { vendorAccountId: ACCOUNT, observedAt: NOW };
  it.each([
    ["null row", null],
    ["nonobject row", 3],
    ["wrong nested user type", { user: { type: "invite", id: "u-a", email_address: "a@example.test" } }],
    ["malformed nested email", { user: { type: "user", id: "u-a", email_address: "not-an-email" } }],
  ])("sanitizes %s to the exact provider failure", async (_case, row) => {
    const { connector } = fixture(async () => json({ data: [row], next_page: null }));
    await expect(connector.syncActivity(input)).resolves.toEqual(failure);
  });
  it("accepts an explicit requested day with the documented optional flag omitted", async () => {
    const { connector } = fixture(async () => json({
      data: [{ ...analyticsUser("u-a", "A@example.test"), date: "2026-09-06" }], next_page: null,
    }));
    await expect(connector.syncActivity(input)).resolves.toEqual({ ok: true, raw: null, value: { records: [{
      email: "a@example.test", providerUserId: "u-a", activityDate: "2026-09-06",
      counters: { chat_metrics: { message_count: 2 } },
    }] } });
  });
  it.each([
    ["claims more without cursor", true, null],
    ["claims complete with cursor", false, "next"],
  ])("rejects a boolean page disagreement: %s", async (_case, hasMore, nextPage) => {
    let calls = 0;
    const { connector } = fixture(async () => {
      calls += 1;
      return json({ data: [analyticsUser("u-a", "a@example.test")], has_more: hasMore, next_page: nextPage });
    });
    await expect(connector.syncActivity(input)).resolves.toEqual(failure);
    expect(calls).toBe(1);
  });
});

describe("US-083 authoritative member evidence", () => {
  it("retains null identity/name and reported role beside the legacy polling projection", async () => {
    const { connector: real } = fixture(async request => new URL(request.url).pathname.endsWith("/users")
      ? json(idPage([{ ...member("u-null", null), name: null, role: "admin" }, member("u-a", "A@example.test")]))
      : json(idPage([{ ...invite("i-a", "invited@example.test"), role: "user" }, { ...invite("i-null", null), role: null }])));
    const connector = createConnectorDispatcher({ rest: real }).forProtocol("rest");
    const result = await connector.syncMembers({ vendorAccountId: ACCOUNT, observedAt: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected complete authoritative observation");
    const value = result.value as unknown as {records: Record<string, unknown>[]; evidence: unknown; members: unknown};
    expect(value.evidence).toEqual({ member_seat_evidence: "all_members_licensed", member_license_identity: "none" });
    // Cold survivors: preserve every identity/name/role/provenance atom, including optional invitation roles.
    expect(value.records).toEqual([
      {provider_member_ref:"u-null",email:null,display_name:null,membership_status:"member",reported_role:"admin",seat_evidence:"licensed",seat_evidence_provenance:"capability:all_members_licensed",provider_license_ref:null},
      {provider_member_ref:"u-a",email:"a@example.test",display_name:"Member",membership_status:"member",reported_role:null,seat_evidence:"licensed",seat_evidence_provenance:"capability:all_members_licensed",provider_license_ref:null},
      {provider_member_ref:"i-a",email:"invited@example.test",display_name:null,membership_status:"invited",reported_role:"user",seat_evidence:"unlicensed",seat_evidence_provenance:null,provider_license_ref:null},
      {provider_member_ref:"i-null",email:null,display_name:null,membership_status:"invited",reported_role:null,seat_evidence:"unlicensed",seat_evidence_provenance:null,provider_license_ref:null},
    ]);
    expect(value.members).toEqual([{email:"a@example.test",active:true},{email:"invited@example.test",active:false}]);
    expect(Object.isFrozen(value.records[0])).toBe(true);
  });
});
