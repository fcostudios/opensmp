**Work item:** US-056
**Readiness assessment:** docs/readiness/US-056.json
**Approved estimate:** 104 minutes

# US-056 Anthropic Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a provider-private Anthropic request executor with strict credential routing, centralized endpoint policy, per-account rate budgets, and bounded operation-aware retry.

**Architecture:** Keep all Anthropic names and wire details below `packages/connectors/src/providers/anthropic/`. Compose four focused modules: a closed endpoint-policy table, a pure credential resolver, a concurrency-safe sliding-window limiter, and a request executor with injected transport/time/observation ports. US-056 stops below the neutral connector and database composition seams reserved for US-057 and US-058.

**Tech Stack:** TypeScript 5.7, Node `fetch`/`Response`, Vitest 4, existing `@smp/connectors` package tooling.

**Spec:** `docs/superpowers/specs/2026-09-05-us-056-anthropic-transport-design.md`

## Global Constraints

- Work only under `packages/connectors/src/providers/anthropic/`; do not modify the neutral connector contract, dispatcher, application modules, database schema, migrations, worker, or generated documentation.
- Provider code imports neither `apps/**`, `packages/db`, Drizzle, nor `scripts/probes/**`.
- Use strict TDD: each behavior test is written and observed failing for the intended missing behavior before production code is added.
- Tests exercise real Ledger policy, credential, limiter, and retry code. Only the true Anthropic network boundary is replaced by an injected deterministic transport.
- Every invalid credential configuration rejects before limiter acquisition and with zero transport calls.
- The clock and sleeper are injected; no test uses real elapsed time, fake timers, uncontrolled network, random jitter, or ordering luck.
- Initial requests and retries consume the same per-vendor-account budgets: User Management `100/60_000ms`, Analytics `60/60_000ms`, invite creation `1_200/3_600_000ms` plus User Management.
- Safe GET and idempotent DELETE requests receive at most three total attempts for HTTP 429 or 5xx. POST invite creation and network exceptions are never replayed.
- Honor valid `Retry-After`; otherwise delay `1_000ms` before attempt two and `2_000ms` before attempt three.
- No credentials, authorization header, provider exception message, request body, or response body reaches the observation port.
- Keep the package dependency-free and preserve the provider-boundary lint exemption.

---

### Task 1: Closed Endpoint Policy and Strict Credential Resolution

**Files:**
- Create: `packages/connectors/src/providers/anthropic/endpoints.ts`
- Create: `packages/connectors/src/providers/anthropic/endpoints.test.ts`
- Create: `packages/connectors/src/providers/anthropic/credentials.ts`
- Create: `packages/connectors/src/providers/anthropic/credentials.test.ts`

**Interfaces:**
- Produces:
  - `AnthropicEndpoint`
  - `AnthropicCredentialKind`
  - `AnthropicBudgetKind`
  - `AnthropicEndpointPolicy`
  - `endpointPolicy(endpoint, parameters?)`
  - `AnthropicCredentialCandidate`
  - `ResolvedAnthropicCredentials`
  - `resolveAnthropicCredentials(candidates, vendorAccountId)`
  - `credentialForPolicy(credentials, policy)`
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write failing endpoint-policy tests**

Create table-driven tests whose expected values are hand-written literals. Cover the complete closed endpoint set and prove policy-owned values cannot be supplied by callers:

```ts
import { describe, expect, it } from "vitest";

import { endpointPolicy, type AnthropicEndpoint } from "./endpoints.js";

describe("Anthropic endpoint policy", () => {
  it.each([
    ["organization", "GET", "/v1/organizations/me", "admin_scoped", ["user_management"], true],
    ["members", "GET", "/v1/organizations/users", "admin_scoped", ["user_management"], true],
    ["invites", "GET", "/v1/organizations/invites", "admin_scoped", ["user_management"], true],
    ["create_invite", "POST", "/v1/organizations/invites", "admin_scoped", ["user_management", "invite_create"], false],
    ["delete_invite", "DELETE", "/v1/organizations/invites/invite%2F1", "admin_scoped", ["user_management"], true],
    ["analytics_users", "GET", "/v1/organizations/analytics/users", "analytics", ["analytics"], true],
    ["analytics_summaries", "GET", "/v1/organizations/analytics/summaries", "analytics", ["analytics"], true],
    ["usage_report", "GET", "/v1/organizations/analytics/usage_report", "analytics", ["analytics"], true],
    ["cost_report", "GET", "/v1/organizations/analytics/cost_report", "analytics", ["analytics"], true],
  ] as const)("binds %s to its complete wire policy", (endpoint, method, path, credentialKind, budgets, retrySafe) => {
    const parameters = endpoint === "delete_invite" ? { resourceId: "invite/1" } : undefined;
    expect(endpointPolicy(endpoint as AnthropicEndpoint, parameters)).toEqual({
      origin: "https://api.anthropic.com",
      method,
      path,
      anthropicVersion: "2023-06-01",
      requestMediaType: method === "POST" ? "application/json" : null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind,
      budgets,
      retrySafe,
    });
  });

  it("requires a nonblank delete target and encodes it as one path segment", () => {
    expect(() => endpointPolicy("delete_invite")).toThrow("resourceId");
    expect(() => endpointPolicy("delete_invite", { resourceId: "   " })).toThrow("resourceId");
    expect(endpointPolicy("delete_invite", { resourceId: "../invite" }).path)
      .toBe("/v1/organizations/invites/..%2Finvite");
  });
});
```

Production mutation named before writing: changing any origin, method, path,
credential family, budget membership, retry-safety branch, or path encoding
must fail a literal behavioral assertion.

- [ ] **Step 2: Run endpoint tests and verify RED**

Run:

```bash
rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic/endpoints.test.ts
```

Expected: FAIL because `endpoints.js` does not exist.

- [ ] **Step 3: Implement the closed endpoint table**

Use these exact public shapes:

```ts
export type AnthropicEndpoint =
  | "organization" | "members" | "invites" | "create_invite"
  | "delete_invite" | "analytics_users" | "analytics_summaries"
  | "usage_report" | "cost_report";
export type AnthropicCredentialKind = "admin_scoped" | "analytics";
export type AnthropicBudgetKind = "user_management" | "analytics" | "invite_create";
export type AnthropicEndpointPolicy = Readonly<{
  origin: "https://api.anthropic.com";
  method: "GET" | "POST" | "DELETE";
  path: string;
  anthropicVersion: "2023-06-01";
  requestMediaType: "application/json" | null;
  responseMediaType: "application/json";
  betaHeader: string | null;
  credentialKind: AnthropicCredentialKind;
  budgets: readonly AnthropicBudgetKind[];
  retrySafe: boolean;
}>;
export function endpointPolicy(
  endpoint: AnthropicEndpoint,
  parameters?: Readonly<{ resourceId?: string }>,
): AnthropicEndpointPolicy;
```

Keep fixed policies in one frozen record. Build only `delete_invite` from a
validated, trimmed, `encodeURIComponent`-encoded `resourceId`. Return a frozen
copy with a frozen `budgets` array so callers cannot mutate shared policy.

- [ ] **Step 4: Run endpoint tests and verify GREEN**

Run the command from Step 2. Expected: all endpoint-policy tests pass.

- [ ] **Step 5: Write failing credential-resolution tests**

Build literal candidates and a call-counting limiter/transport-free oracle.
Test the valid pair plus missing Admin, missing Analytics, blank secrets,
duplicate same-kind rows, identical cross-kind secrets, retired rows,
`auth_failed`, `unverified`, records for the wrong vendor account, and an
unsupported kind forced through `unknown` at the input boundary.

```ts
const valid = [
  { vendorAccountId: "account-a", kind: "admin_scoped", secret: "admin-secret", status: "active", health: "ok" },
  { vendorAccountId: "account-a", kind: "analytics", secret: "analytics-secret", status: "active", health: "ok" },
] as const;

expect(resolveAnthropicCredentials(valid, "account-a")).toEqual({
  vendorAccountId: "account-a",
  admin: { kind: "admin_scoped", secret: "admin-secret" },
  analytics: { kind: "analytics", secret: "analytics-secret" },
});
expect(credentialForPolicy(resolved, endpointPolicy("members"))).toEqual({
  kind: "admin_scoped",
  secret: "admin-secret",
});
expect(credentialForPolicy(resolved, endpointPolicy("cost_report"))).toEqual({
  kind: "analytics",
  secret: "analytics-secret",
});
```

For every invalid table row, assert the stable safe error code and ensure its
message contains no candidate secret. Production mutations named before
writing: accepting any non-`active`/non-`ok` record, selecting across accounts,
accepting duplicates, trimming a secret into acceptance, or permitting equal
secrets must fail.

- [ ] **Step 6: Run credential tests and verify RED**

Run:

```bash
rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic/credentials.test.ts
```

Expected: FAIL because `credentials.js` does not exist.

- [ ] **Step 7: Implement strict credential resolution**

Use these exact shapes and safe error vocabulary:

```ts
export type AnthropicCredentialCandidate = Readonly<{
  vendorAccountId: string;
  kind: AnthropicCredentialKind;
  secret: string;
  status: "active" | "retired";
  health: "ok" | "auth_failed" | "unverified";
}>;
export type ResolvedAnthropicCredentials = Readonly<{
  vendorAccountId: string;
  admin: Readonly<{ kind: "admin_scoped"; secret: string }>;
  analytics: Readonly<{ kind: "analytics"; secret: string }>;
}>;
export type AnthropicCredentialErrorCode =
  | "invalid_vendor_account" | "missing_credential" | "duplicate_credential"
  | "blank_credential" | "identical_credentials" | "inactive_credential"
  | "unhealthy_credential" | "wrong_credential_kind";
export class AnthropicCredentialError extends Error {
  readonly code: AnthropicCredentialErrorCode;
}
```

Reject malformed or unsupported runtime values fail-closed. Do not include IDs,
kind values supplied by an attacker, or secrets in error messages. Freeze the
resolved pair and tagged credentials. `credentialForPolicy` must verify that
the pair belongs to a nonblank account and select solely from
`policy.credentialKind`.

- [ ] **Step 8: Run Task 1 focused verification**

Run:

```bash
rtk pnpm --filter @smp/connectors exec vitest run \
  src/providers/anthropic/endpoints.test.ts \
  src/providers/anthropic/credentials.test.ts
rtk pnpm --filter @smp/connectors type-check
rtk pnpm lint:provider-boundary
```

Expected: all commands pass with no network access.

- [ ] **Step 9: Commit Task 1**

```bash
rtk git add packages/connectors/src/providers/anthropic/endpoints.ts \
  packages/connectors/src/providers/anthropic/endpoints.test.ts \
  packages/connectors/src/providers/anthropic/credentials.ts \
  packages/connectors/src/providers/anthropic/credentials.test.ts
rtk git commit -m "feat(US-056): bind Anthropic endpoints and credentials"
```

---

### Task 2: Concurrency-Safe Per-Account Sliding-Window Budgets

**Files:**
- Create: `packages/connectors/src/providers/anthropic/rate-limiter.ts`
- Create: `packages/connectors/src/providers/anthropic/rate-limiter.test.ts`

**Interfaces:**
- Consumes: `AnthropicBudgetKind` from Task 1.
- Produces:
  - `AnthropicClock`
  - `AnthropicSleep`
  - `AnthropicRateLimiter`
  - `createAnthropicRateLimiter({ clock, sleep })`

- [ ] **Step 1: Write failing deterministic boundary tests**

Use a manual clock whose sleeper records the exact delay and advances the same
clock. Do not use Vitest fake timers.

```ts
let now = 0;
const sleeps: number[] = [];
const limiter = createAnthropicRateLimiter({
  clock: { now: () => now },
  sleep: async (milliseconds) => { sleeps.push(milliseconds); now += milliseconds; },
});

for (let index = 0; index < 100; index += 1) {
  await limiter.acquire("account-a", ["user_management"]);
}
expect(sleeps).toEqual([]);
await limiter.acquire("account-a", ["user_management"]);
expect(sleeps).toEqual([60_000]);
```

Add equivalent literal boundary tests for Analytics `60/60_000` and invite
creation `1_200/3_600_000`. For invites, call with
`["user_management", "invite_create"]` and prove the first wait occurs at the
stricter User Management boundary. Advance time and prove exact rollover: an
attempt at `oldest + window - 1` waits one millisecond and an attempt at
`oldest + window` does not wait.

Add per-account isolation and `Promise.all` concurrency tests. Hold the sleeper
behind a controllable promise after filling 100 slots, launch two acquisitions,
then release it and assert the two calls receive distinct legal acquisition
times rather than both consuming slot 101. Name the production mutations:
wrong limit/window, global rather than account key, recording before all
budgets are available, dropping the mutex, or treating the window end as
inclusive.

- [ ] **Step 2: Run limiter tests and verify RED**

Run:

```bash
rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic/rate-limiter.test.ts
```

Expected: FAIL because `rate-limiter.js` does not exist.

- [ ] **Step 3: Implement atomic multi-budget acquisition**

Use these exact ports:

```ts
export type AnthropicClock = Readonly<{ now(): number }>;
export type AnthropicSleep = (milliseconds: number) => Promise<void>;
export interface AnthropicRateLimiter {
  acquire(vendorAccountId: string, budgets: readonly AnthropicBudgetKind[]): Promise<void>;
}
export function createAnthropicRateLimiter(input: Readonly<{
  clock: AnthropicClock;
  sleep: AnthropicSleep;
}>): AnthropicRateLimiter;
```

Represent each window as `{ limit, windowMilliseconds }`. Validate the account
ID and reject an empty, duplicate, or unknown budget list. Maintain timestamps
per account and budget. Serialize each account through a promise tail that
recovers after rejection so one failed sleeper cannot poison later callers.

Inside the account lock, repeatedly prune timestamps where
`timestamp <= now - windowMilliseconds`, compute the maximum wait required by
all requested budgets, sleep outside no accounting mutation, then retry. Only
when every budget has capacity append the same acquisition timestamp to every
requested budget. This prevents an invite from consuming User Management
capacity while still blocked by its hourly budget.

- [ ] **Step 4: Run limiter tests and verify GREEN**

Run the command from Step 2. Expected: all limiter tests pass deterministically.

- [ ] **Step 5: Run Task 2 focused verification**

```bash
rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic
rtk pnpm --filter @smp/connectors type-check
```

Expected: all provider tests and type-check pass.

- [ ] **Step 6: Commit Task 2**

```bash
rtk git add packages/connectors/src/providers/anthropic/rate-limiter.ts \
  packages/connectors/src/providers/anthropic/rate-limiter.test.ts
rtk git commit -m "feat(US-056): enforce Anthropic request budgets"
```

---

### Task 3: Policy-Bound Request Execution and Bounded Retry

**Files:**
- Create: `packages/connectors/src/providers/anthropic/request.ts`
- Create: `packages/connectors/src/providers/anthropic/request.test.ts`

**Interfaces:**
- Consumes:
  - `endpointPolicy`, `AnthropicEndpoint`, and `AnthropicEndpointPolicy` from Task 1.
  - `resolveAnthropicCredentials` and `credentialForPolicy` from Task 1.
  - `AnthropicClock`, `AnthropicSleep`, and `AnthropicRateLimiter` from Task 2.
- Produces:
  - `AnthropicAttemptObservation`
  - `AnthropicAttemptObserver`
  - `AnthropicTransport`
  - `AnthropicRequestExecutor`
  - `createAnthropicRequestExecutor(dependencies)`

- [ ] **Step 1: Write failing fail-closed and wire-policy tests**

Build the executor from the real credential resolver and limiter with a
call-counting transport. For the valid case, inspect the real `Request` passed
to the port:

```ts
const requests: Request[] = [];
const execute = createAnthropicRequestExecutor({
  clock,
  sleep,
  limiter,
  transport: async (request) => {
    requests.push(request);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  },
});

await execute({ endpoint: "members", vendorAccountId: "account-a", credentials: valid });
expect(requests).toHaveLength(1);
expect(requests[0]!.url).toBe("https://api.anthropic.com/v1/organizations/users");
expect(requests[0]!.method).toBe("GET");
expect(requests[0]!.headers.get("x-api-key")).toBe("admin-secret");
expect(requests[0]!.headers.get("anthropic-version")).toBe("2023-06-01");
expect(requests[0]!.headers.get("accept")).toBe("application/json");
expect(requests[0]!.headers.has("anthropic-beta")).toBe(false);
expect(requests[0]!.headers.has("authorization")).toBe(false);
```

Repeat with an Analytics endpoint and assert only the Analytics secret is used.
For `create_invite`, assert exact JSON media type and serialized caller body;
for every GET/DELETE, reject a supplied body. Repeat every invalid credential
fixture from Task 1 through the executor and assert transport calls and
observations both remain zero.

Named mutations: selecting the wrong credential, omitting or globally adding a
header, accepting caller-controlled policy headers, constructing the wrong URL,
or validating after transport must fail.

- [ ] **Step 2: Run request tests and verify RED**

Run:

```bash
rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic/request.test.ts
```

Expected: FAIL because `request.js` does not exist.

- [ ] **Step 3: Implement the request/observation ports and one-attempt path**

Use these exact public shapes:

```ts
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
export type AnthropicAttemptObserver = (observation: AnthropicAttemptObservation) => Promise<void>;
export type AnthropicTransport = (request: Request) => Promise<Response>;
export type AnthropicRequestResult =
  | Readonly<{ ok: true; response: Response; attempts: number }>
  | Readonly<{ ok: false; classification: Exclude<AnthropicAttemptClassification, "success">; status: number | null; attempts: number }>;
export type ExecuteAnthropicRequestInput = Readonly<{
  endpoint: AnthropicEndpoint;
  vendorAccountId: string;
  credentials: readonly AnthropicCredentialCandidate[];
  parameters?: Readonly<{ resourceId?: string }>;
  body?: unknown;
}>;
export type AnthropicRequestExecutor = (input: ExecuteAnthropicRequestInput) => Promise<AnthropicRequestResult>;
export function createAnthropicRequestExecutor(dependencies: Readonly<{
  clock: AnthropicClock;
  sleep: AnthropicSleep;
  limiter: AnthropicRateLimiter;
  transport?: AnthropicTransport;
  observe?: AnthropicAttemptObserver;
}>): AnthropicRequestExecutor;
```

Default `transport` to `fetch(request)` and `observe` to an async inert
function. Resolve the complete credential pair before acquiring any budget.
Build headers only from endpoint policy and the selected tagged secret. Create
a real `Request`; do not accept caller headers, method, origin, path, or signal.
Use `AbortSignal.timeout(30_000)` on each network attempt. Await the requested
observation immediately before calling transport. Emit completed metadata only
after a known `Response`; do not expose bodies or exception messages.

- [ ] **Step 4: Run one-attempt tests and verify GREEN**

Run the command from Step 2. Expected: the fail-closed and wire-policy tests pass.

- [ ] **Step 5: Write failing retry-policy tests**

Use sequenced literal `Response` fixtures. Prove GET and DELETE retry 429 and
representative 500/503/599 responses with exactly three total calls, while
400/401/403/404/409/422 and 2xx are terminal. Assert the result status,
classification, and exact attempt count.

Assert these exact delay cases:

```ts
expect(await runStatuses([429, 200], { "retry-after": "2.5" })).toMatchObject({ ok: true, attempts: 2 });
expect(sleeps).toEqual([2_500]);

expect(await runStatuses([503, 503, 200])).toMatchObject({ ok: true, attempts: 3 });
expect(sleeps).toEqual([1_000, 2_000]);
```

Add future HTTP-date, past HTTP-date, negative, malformed, and missing
`Retry-After` cases against the injected epoch clock. Prove limiter
`acquire(account, policy.budgets)` runs once per actual network attempt after
the retry delay. Use the real limiter in at least one test: prefill 99 User
Management slots, execute a retrying GET, and assert its second attempt waits
for the window instead of becoming an unbudgeted 101st call.

For `create_invite`, return 429, 500, and throw a synthetic error in separate
cases; each must produce exactly one transport call and no retry sleep. For a
retry-safe GET transport exception, also assert one call and
`transport_ambiguous`. Observation tests assert the exact requested/completed
sequence for known responses and only requested for an exception, with no
secret, body, `authorization`, provider error message, or arbitrary field
present after JSON serialization.

Named mutations: fourth attempt, retrying a POST/exception/client response,
skipping a limiter acquisition, sleeping after rather than before acquire,
wrong `Retry-After` precedence, or leaking request/response data must fail.

- [ ] **Step 6: Run retry tests and verify RED**

Run the command from Step 2. Expected: new retry assertions fail because the
one-attempt implementation returns after the first response.

- [ ] **Step 7: Implement minimal bounded retry**

Classify 2xx as `success`, 429 as `rate_limited`, 5xx as `provider_error`, all
other HTTP statuses as `client_error`, and exceptions as
`transport_ambiguous`. Retry only when `policy.retrySafe` is true and the known
classification is rate-limited/provider-error. Stop after attempt three.

Parse `Retry-After` without leaking response data. Accept a finite,
non-negative decimal delta-seconds value or a future HTTP-date. Otherwise use
the fallback indexed by the completed attempt: `[1_000, 2_000]`. Await retry
sleep, then begin the next loop iteration so limiter acquisition remains
immediately before the next attempted call.

- [ ] **Step 8: Run Task 3 focused verification**

```bash
rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic
rtk pnpm --filter @smp/connectors type-check
rtk pnpm lint:provider-boundary
```

Expected: all provider tests, type-check, and the provider boundary pass.

- [ ] **Step 9: Run story and repository gates**

```bash
rtk pnpm readiness:check -- US-056
rtk pnpm --filter @smp/connectors test
rtk pnpm test:mutation
rtk pnpm check
```

Expected: approved readiness remains valid; connector tests, diff-scoped
mutation, and the complete repository gate pass.

- [ ] **Step 10: Commit Task 3**

```bash
rtk git add packages/connectors/src/providers/anthropic/request.ts \
  packages/connectors/src/providers/anthropic/request.test.ts
rtk git commit -m "feat(US-056): execute bounded Anthropic requests"
```

---

## Completion Evidence

The implementation is complete only when the branch contains exactly the
provider-private US-056 production/tests plus this previously committed plan
and spec, all task reviews are clean, the final whole-branch review is clean,
`pnpm check` passes, and the worktree contains no uncommitted files. Do not mark
US-057, US-058, or parent US-018 complete.
