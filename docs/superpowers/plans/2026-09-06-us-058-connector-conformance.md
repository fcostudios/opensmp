**Work item:** US-058
**Readiness assessment:** docs/readiness/US-058.json
**Approved estimate:** 104 minutes

# Anthropic Connector Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, with specification review followed by code-quality review before proceeding. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a dispatcher-resolved Anthropic `rest` connector whose five neutral operations are bounded, journaled, exact-decimal safe, and protected by Pact consumer contracts.

**Architecture:** A provider-local adapter composes the real US-056 request executor and US-057 observation session. Provider routes, closed query values, response parsing, pagination, and error mapping remain below `providers/anthropic`; the neutral dispatcher receives the completed connector through dependency injection, and the existing contract entry point exercises it against Pact.

**Tech Stack:** TypeScript, Vitest 4, fast-check 4, Pact JS 17, Stryker 9, native Fetch API.

**Spec:** `docs/superpowers/specs/2026-09-06-us-058-connector-conformance-design.md`

## Global Constraints

- Begin only after CHG-049, CHG-050, and CHG-051 are complete on a clean `main`; none of their delivery or overlay paths belongs to US-058.
- Preserve the neutral `VendorConnector` and generic JSON-safe `raw` contracts; the Anthropic implementation itself always returns `raw: null`.
- Provider names, paths, headers, query shapes, cursors, and response fields stay under `packages/connectors/src/providers/anthropic/`.
- Export the factory only as `@smp/connectors/providers/anthropic/connector`; never re-export it from `packages/connectors/src/index.ts`.
- Mock only the true Anthropic HTTP boundary. Tests compose the real request executor, limiter, observation bridge, and neutral observation session with an in-memory append implementation.
- Pagination permits a terminal page 100 and rejects repeated, missing, blank, malformed, or page-101 continuation before another request.
- Convert fractional cents to USD with string and `BigInt` arithmetic; never pass a cost amount through `Number`.
- Every new test must name the production mutation or contract fault it detects and must be observed failing before implementation.
- Every new `.nous-feedback.jsonl` event carries an ISO-8601 UTC `ts`.
- Adversarial AC verification, specification review, code-quality review, and every repair commit precede the sole final cold mutation campaign.
- At any task boundary, stop and file a timestamped `blocked` or `deviation` event if the remaining work is judged to exceed the approved estimate.

## Exact Story Path Budget

US-058 changes exactly these 12 paths relative to `authority/us-058-base`:

1. `.nous-feedback.jsonl`
2. `docs/readiness/US-058.json`
3. `packages/connectors/package.json`
4. `packages/connectors/src/dispatch.test.ts`
5. `packages/connectors/src/dispatch.ts`
6. `packages/connectors/src/providers/anthropic/connector.test.ts`
7. `packages/connectors/src/providers/anthropic/connector.ts`
8. `packages/connectors/src/providers/anthropic/endpoints.test.ts`
9. `packages/connectors/src/providers/anthropic/endpoints.ts`
10. `packages/connectors/src/providers/anthropic/request.test.ts`
11. `packages/connectors/src/providers/anthropic/request.ts`
12. `scripts/probes/anthropic/pact.contract.test.ts`

Do not edit either Vitest configuration. The existing Pact file is already
selected by `scripts/probes/anthropic/vitest.contract.config.ts`, and avoiding
a new config delta keeps the diff-scoped mutation router on supported adjacent
test routes.

The task estimates consume the approved envelope exactly:

| Phase | Minutes | Allocation |
|---|---:|---|
| Readiness | 8 | Existing approved assessment and plan preparation |
| Implementation | 45 | Tasks 1–5: 2 + 10 + 20 + 6 + 7 |
| Focused verification | 31 | Tasks 2–7: 3 + 7 + 2 + 4 + 5 + 10 |
| Review | 10 | Task 6 two-stage review and repair decisions |
| Integration | 10 | Task 6 full repository, schema, and tenant gates |
| **Total** | **104** | Matches `docs/readiness/US-058.json` |

## Controller Preparation After This Plan Commit

- [ ] Confirm `main` is clean and contains the completed CHG-049/050/051 sequence plus this design and plan.
- [ ] Create `authority/us-058-base` at the exact post-plan `main` commit and verify `git rev-parse authority/us-058-base` equals `git rev-parse main`.
- [ ] Use `superpowers:using-git-worktrees` to create `feature/connectors/anthropic-conformance` from that authority ref.
- [ ] In the worktree, run `pnpm readiness:check -- US-058` before the first story commit.

The authority ref, not a shell-only variable, is the reproducible base for the
12-path scope, mutation campaign, and final actuals.

---

### Task 1: Record Lifecycle Start

**Estimated phase:** implementation, 2 minutes

**Files:**
- Append: `.nous-feedback.jsonl`

**Interfaces:**
- Produces: the sole US-058 `started` lifecycle event, preceding all implementation evidence.

- [ ] **Step 1: Confirm no earlier start exists**

Run:

```bash
rg -n '"story":"US-058".*"event":"started"' .nous-feedback.jsonl
```

Expected: no match. Existing readiness decisions are not lifecycle starts.

- [ ] **Step 2: Append and validate the timestamped start**

Capture `date -u +%FT%TZ`, then append exactly one `started` object whose `ts`
is that captured value:

```jsonl
{"story":"US-058","event":"started","agent":"codex","ts":"2026-09-06T12:00:00Z"}
```

The timestamp above illustrates the required shape; use the captured execution
time rather than copying the example.

Run:

```bash
pnpm test:feedback-order
pnpm readiness:check -- US-058
```

Expected: both pass.

- [ ] **Step 3: Commit the lifecycle boundary**

```bash
git add .nous-feedback.jsonl
git commit -m "docs(US-058): record connector conformance start"
```

### Task 2: Complete Endpoint, Closed Query, and Retryability Policy

**Estimated phases:** implementation 10 minutes; focused verification 3 minutes

**Files:**
- Modify: `packages/connectors/src/providers/anthropic/endpoints.ts`
- Modify: `packages/connectors/src/providers/anthropic/endpoints.test.ts`
- Modify: `packages/connectors/src/providers/anthropic/request.ts`
- Modify: `packages/connectors/src/providers/anthropic/request.test.ts`

**Interfaces:**
- Produces endpoint policies for `delete_member`, `user_usage_report`, and `user_cost_report`.
- Extends failed `AnthropicRequestResult` with `retryable: boolean`.
- Produces this closed caller input; no arbitrary query record or URL is accepted:

```ts
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
```

- [ ] **Step 1: Write failing endpoint-policy tests**

Add literal cases proving method, encoded single-segment path, credential kind,
budget, headers, and retry safety:

```ts
expect(endpointPolicy("delete_member", { resourceId: "usr/a" })).toMatchObject({
  method: "DELETE",
  path: "/v1/organizations/users/usr%2Fa",
  credentialKind: "admin_scoped",
  budgets: ["user_management"],
  retrySafe: true,
});
expect(endpointPolicy("user_usage_report")).toMatchObject({
  path: "/v1/organizations/analytics/user_usage_report",
  credentialKind: "analytics",
  retrySafe: true,
});
expect(endpointPolicy("user_cost_report")).toMatchObject({
  path: "/v1/organizations/analytics/user_cost_report",
  credentialKind: "analytics",
  retrySafe: true,
});
```

Extend the existing dot-segment and policy-override cases to both delete
families. Mutations caught: wrong route, unencoded resource ID, wrong key
family, wrong rate budget, or unsafe replay flag.

- [ ] **Step 2: Write failing closed-query tests**

Through the real executor and deterministic transport, assert these exact
query strings:

```text
members/invites           limit=1000[&after_id=<encoded>]
analytics_users           date=2026-09-06[&page=<encoded>]
analytics_summaries       date=2026-09-06
user_usage/user_cost      starting_at=2026-09-06T00:00:00Z
                           ending_at=2026-09-07T00:00:00Z
                           bucket_width=1d&limit=1[&page=<encoded>]
```

Add table cases rejecting a date-time instead of `YYYY-MM-DD`, invalid calendar
dates, blank/control-character cursors, `after_id` on analytics, `page` on
Admin, continuation on a non-paginated endpoint, and unknown fields cast
through `unknown`. Assert observer, limiter, and transport call counts remain
zero on every rejection. Mutations caught: omitted fixed key, wrong
continuation family, permissive date, or validation after a side effect.

- [ ] **Step 3: Write failing retryability tests**

Assert the failed executor result includes:

```text
safe GET/DELETE exhausted 429 or 5xx  -> retryable true
POST create-invite 429/5xx            -> retryable false
all 4xx client/auth failures          -> retryable false
safe GET/DELETE transport ambiguity   -> retryable true
POST transport ambiguity              -> retryable false
```

Keep the established in-call retry ceiling unchanged. Mutations caught: status
class or endpoint safety omitted from the later-independent-call decision.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @smp/connectors exec vitest run \
  src/providers/anthropic/endpoints.test.ts \
  src/providers/anthropic/request.test.ts
```

Expected: failures for unknown policies, missing query construction, and
missing `retryable`.

- [ ] **Step 5: Implement the minimum policy**

Add the three endpoint literals to `AnthropicEndpoint` and the policy table.
Build a fresh `URL` and `URLSearchParams` only after validating the endpoint /
query combination. Derive fixed keys from the endpoint; copy only the validated
date and continuation value. On failed requests set:

```ts
const retryable = policy.retrySafe && (
  classification === "rate_limited"
  || classification === "provider_error"
  || classification === "transport_ambiguous"
);
```

Do not change credential resolution, headers, observation ordering, limiter
acquisition, or the three-attempt ceiling.

- [ ] **Step 6: Run GREEN and commit**

Run the Task 2 command again, then:

```bash
git add packages/connectors/src/providers/anthropic/endpoints.ts \
  packages/connectors/src/providers/anthropic/endpoints.test.ts \
  packages/connectors/src/providers/anthropic/request.ts \
  packages/connectors/src/providers/anthropic/request.test.ts
git commit -m "feat(US-058): complete Anthropic operation policies"
```

### Task 3: Implement the Five-Operation Adapter With Real Owned Components

**Estimated phases:** implementation 20 minutes; focused verification 7 minutes

**Files:**
- Create: `packages/connectors/src/providers/anthropic/connector.ts`
- Create: `packages/connectors/src/providers/anthropic/connector.test.ts`

**Interfaces:**
- Consumes the `AnthropicConnectorDependencies` contract from the design.
- Produces `createAnthropicConnector(dependencies): VendorConnector`.
- Provider-private helpers use these closed page and failure shapes:

```ts
type IdPage<T> = Readonly<{
  data: readonly T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}>;
type OpaquePage<T> = Readonly<{
  data: readonly T[];
  next_page: string | null;
}>;

function providerFailure(retryable: boolean): Readonly<{
  ok: false;
  code: "provider_error";
  retryable: boolean;
  raw: null;
}>;
```

- [ ] **Step 1: Write failing closed-parser and fixed-seed money properties**

Use hand-authored valid and invalid member, invitation, analytics-user,
activity-summary, user-usage, and user-cost pages. Assert missing/extra required
shape, invalid dates/counters, duplicate identities, non-USD values, exponents,
leading plus/zero, negative zero, and unsafe-size decimals fail closed. Nullable
emails are omitted from neutral records and never stringified.

Use `fast-check` with an explicit seed and bounded unscaled `bigInt` plus scale.
For every canonical generated cents string, remove the USD decimal point from
the result and prove it equals the original unscaled integer with scale
increased by exactly two. Also prove canonical sign and zero behavior. This is
the required property oracle for money, not a coverage test.

- [ ] **Step 2: Write failing pagination tests using only a transport double**

Build a fixture helper that composes:

```ts
const session = createConnectorCallObservationSession({
  vendorAccountId: VENDOR_ACCOUNT_UUID,
  provisioningActionId,
  operation,
  clock: () => new Date("2026-09-06T12:00:00Z"),
  randomId: () => CORRELATION_UUID,
  append: async (event) => { journal.push(event); },
});
const executor = createAnthropicRequestExecutor({
  clock,
  sleep,
  limiter: createAnthropicRateLimiter({ clock, sleep }),
  transport,
  observe: createAnthropicConnectorObservationBridge(session),
});
```

The adapter must create that real executor/session path; the injected
`AnthropicTransport` returns complete real `Response` instances. Assert two-page
ID and opaque flows, terminal page 100 success, refusal before request 101,
repeated cursor refusal, and `has_more` without a usable cursor refusal. Prove
the neutral session's durable attempt numbers increase across pages.

- [ ] **Step 3: Write failing five-operation tests**

Cover exact behavior:

```text
provision     -> POST create_invite -> { vendorRef: invite.id }
deprovision   -> unique member/invite lookup -> matching DELETE -> vendorRef
syncMembers   -> members + pending invites -> { email, active }
syncActivity  -> user/activity join -> { email, activityDate, counters }
syncCost      -> user usage/cost join -> { email, costDate, amountUsd }
```

Use UUID fixture IDs required by the real observation session. Assert exactly
one credential lookup and one session per logical operation, the neutral
request ID is supplied only for provision/deprovision, sync sessions carry no
provisioning-action link, and credentials from another vendor account cannot
reach transport. Assert the frozen five-capability set, frozen results,
`raw === null`, and absence of provider-shaped keys.

- [ ] **Step 4: Write failing exact failure-table tests**

Assert:

- invalid input, credentials, or session creation rejects before transport;
- 4xx maps to non-retryable `provider_error` with requested+failed evidence;
- exhausted 429/5xx copies executor retryability and records each attempt;
- ambiguity maps endpoint-aware retryability and leaves requested unmatched;
- malformed body/cursor/page/money and ambiguous identity map to non-retryable
  `provider_error` without partial values;
- requested persistence failure prevents transport, while terminal persistence
  failure rejects and leaves the committed request visible.

- [ ] **Step 5: Run RED**

```bash
pnpm --filter @smp/connectors exec vitest run \
  src/providers/anthropic/connector.test.ts
```

Expected: module-not-found for `connector.ts`.

- [ ] **Step 6: Implement minimally**

Implement closed type guards, bounded pagination, exact decimal shifting,
operation methods, and `createAnthropicConnector` in `connector.ts`. Create the
observation session once per logical operation and a real executor bound to its
bridge. Parse each successful `Response` body once; cancel unread bodies on
local failure. Return only cloned/frozen neutral data and `raw: null`.

- [ ] **Step 7: Run GREEN and commit**

```bash
pnpm --filter @smp/connectors exec vitest run \
  src/providers/anthropic/endpoints.test.ts \
  src/providers/anthropic/request.test.ts \
  src/providers/anthropic/connector.test.ts
git add packages/connectors/src/providers/anthropic/connector.ts \
  packages/connectors/src/providers/anthropic/connector.test.ts
git commit -m "feat(US-058): implement Anthropic neutral connector"
```

### Task 4: Register and Export the Concrete REST Connector

**Estimated phases:** implementation 6 minutes; focused verification 2 minutes

**Files:**
- Modify: `packages/connectors/src/dispatch.ts`
- Modify: `packages/connectors/src/dispatch.test.ts`
- Modify: `packages/connectors/package.json`

**Interfaces:**
- Produces `createConnectorDispatcher(input?: Readonly<{ rest?: VendorConnector }>): ConnectorDispatcher`.
- Produces package export `./providers/anthropic/connector` mapped to `./src/providers/anthropic/connector.ts`.

- [ ] **Step 1: Write failing dispatch tests**

Assert omission remains `none`-only. Pass a real `createAnthropicConnector(...)`
as `{ rest }`, resolve `forProtocol("rest")`, and prove the wrapper freezes its
exact five capabilities and all Anthropic success/failure results retain
`raw: null`. Keep existing tests that generic connectors may return JSON-safe
non-null `raw`; do not claim the dispatcher can infer implementation from an
arbitrary capability declaration.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @smp/connectors exec vitest run src/dispatch.test.ts
```

Expected: `createConnectorDispatcher({ rest })` does not type-check or register
`rest`.

- [ ] **Step 3: Implement constructor injection and the narrow export**

```ts
export function createConnectorDispatcher(
  input: Readonly<{ rest?: VendorConnector }> = {},
): ConnectorDispatcher {
  const dispatcher = new ConnectorDispatcher();
  if (input.rest) dispatcher.register("rest", input.rest);
  return dispatcher;
}
```

Add this package export without changing `src/index.ts`:

```json
"./providers/anthropic/connector": "./src/providers/anthropic/connector.ts"
```

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @smp/connectors exec vitest run \
  src/dispatch.test.ts src/providers/anthropic/connector.test.ts
pnpm lint:provider-boundary
pnpm --filter @smp/connectors type-check
git add packages/connectors/src/dispatch.ts \
  packages/connectors/src/dispatch.test.ts packages/connectors/package.json
git commit -m "feat(US-058): register injected Anthropic REST connector"
```

### Task 5: Exercise the Real Adapter Through the Existing Pact Entry Point

**Estimated phases:** implementation 7 minutes; focused verification 4 minutes

**Files:**
- Modify: `scripts/probes/anthropic/pact.contract.test.ts`

**Interfaces:**
- Preserves the existing `ledger-anthropic-probe` consumer and its exact 12 interactions.
- Adds a separate temporary `ledger-anthropic-connector` consumer exercising the exported factory through `createConnectorDispatcher({ rest })`.

- [ ] **Step 1: Write the failing real-adapter Pact harness**

Add a helper that registers all interactions for one operation before
`executeTest`. Its transport receives the executor-built
`https://api.anthropic.com` request, creates a new URL with only the origin
replaced by `mockServer.url`, and calls real `fetch` with the original method,
query, headers, and body. Compose real credentials, limiter, executor,
observation bridge, session, and an in-memory append implementation.

Name the new consumer `ledger-anthropic-connector`, use valid deterministic
UUIDs, and give it a distinct contract path/cleanup block. Do not change the
probe consumer's existing interaction count assertion.

- [ ] **Step 2: Add deterministic interactions and neutral assertions**

Cover:

- provision invite creation body and Admin header;
- member and invitation lookup plus encoded member/invite deletes;
- two-page `after_id` member/invitation flows;
- Analytics `page` continuation and date/report query keys;
- nullable email omission, activity counters, and exact fractional-cent cost;
- 401, terminal 503 behavior, and 429 with `Retry-After`.

Invoke the dispatcher-resolved connector, not parser helpers. Assert only
neutral frozen outputs and allowlisted journal summaries. Each test names the
adapter mutation or wire-contract fault it catches; no live Anthropic origin is
contacted.

- [ ] **Step 3: Run RED, then complete fixtures and run GREEN**

Observe at least one missing-interaction or wrong-neutral-result failure before
completing the interaction set. Then run:

```bash
pnpm test:contract
pnpm --filter @smp/connectors test
pnpm lint:provider-boundary
pnpm --filter @smp/connectors type-check
```

Expected: all pass; both temporary contracts are inspected and removed.

- [ ] **Step 4: Commit contract coverage**

```bash
git add scripts/probes/anthropic/pact.contract.test.ts
git commit -m "test(US-058): contract Anthropic connector fixtures"
```

### Task 6: Adversarial Verification, Two-Stage Review, and All Repairs

**Estimated phases:** review 10 minutes; integration 10 minutes; remaining focused verification 5 minutes

**Files:**
- Modify only the already-listed implementation/test paths required by a reproduced defect.
- Append: `.nous-feedback.jsonl`

**Interfaces:**
- Produces the final reviewed implementation commit before mutation.

- [ ] **Step 1: Dispatch specification-compliance review**

Give a fresh reviewer the story, design, readiness artifact, exact 12-path
budget, and `authority/us-058-base..HEAD`. Require an AC1/AC2/AC3 verdict with
file/line evidence. Fix every confirmed gap with a failing regression, focused
green run, and `fix(US-058): ...` commit; send the exact repair back for
re-review until approved.

- [ ] **Step 2: Dispatch code-quality review**

After specification approval, give a different fresh reviewer the same diff
plus `TESTING.md`. Require explicit judgments on provider leakage, owned-code
doubles, account isolation, response-body lifecycle, pagination bounds,
determinism, money properties, and test-to-mutation value. Repair and re-review
until approved.

- [ ] **Step 3: Attack AC1 directly**

Try page 101, repeated/missing/blank cursors, cross-account credentials,
ambiguous and case-conflicting identities, null emails, malformed dates and
counters, exponent/oversize/negative-zero costs, non-USD values, wrong DELETE
target, and persistence failure. Each reproduced defect receives RED, minimal
fix, focused GREEN, and its own repair commit.

- [ ] **Step 4: Attack AC2 directly**

Attempt omission or forgery of Anthropic capabilities, wrong protocol
registration, mutable results, provider-body leakage, raw header/URL leakage,
wrong key family, a provider import through the neutral barrel, and default
dispatcher network activation.

- [ ] **Step 5: Attack AC3 directly**

Prove Pact invokes the dispatcher-resolved real adapter; covers both credential
headers, both pagination styles, nullable data, 4xx/5xx/rate-limit
classification, and exact cost; preserves the original probe contract; and
cannot contact the live Anthropic origin.

- [ ] **Step 6: Run every pre-campaign gate**

Run the focused suites, then:

```bash
pnpm check

# Emitted DoD step 5, against a reachable disposable DATABASE_URL:
(cd packages/db && pnpm drizzle-kit push && node scripts/verify-schema.mjs)

# Tenant T1, with DATABASE_ADMIN_URL=ledger_owner and DATABASE_URL=ledger_app:
pnpm --filter @smp/db db:migrate
pnpm --filter @smp/db db:verify
pnpm --filter @smp/db db:parity
```

These database prerequisites are mandatory even though US-058 adds no
migration. T2 authentication evidence and T3 Compose release verification do
not apply. Do not classify tenant `db:parity` as a substrate-only diagnostic.

- [ ] **Step 7: Dry-check mutation routing without running the campaign**

```bash
MUTATION_BASE=authority/us-058-base MUTATION_SCOPE_DRY=1 pnpm test:mutation
```

Inspect the generated manifest: the mutatable source set is exactly the changed
Anthropic and dispatcher `.ts` files, and every source has a responsible test
route. This dry run is configuration inspection, not mutation evidence.

- [ ] **Step 8: Record and commit pre-campaign evidence**

Append timestamped `ac_verify` events for AC1, AC2, and AC3 plus a timestamped
`build_pass`, each naming the final reviewed source commit and concrete
adversarial method. Validate and commit:

```bash
pnpm test:feedback-order
git add .nous-feedback.jsonl
git commit -m "docs(US-058): record adversarial verification"
```

- [ ] **Step 9: Confirm the exact final implementation tree**

```bash
git diff --name-only authority/us-058-base..HEAD
git status --short
```

Expected: exactly the 11 paths already used at this point (all of the declared
12 except `docs/readiness/US-058.json`) and a clean worktree. All review repairs
are committed. No implementation or verification command may follow the cold
campaign in Task 7.

### Task 7: Run One Cold Diff-Scoped Mutation Campaign, Last

**Estimated phase:** focused verification, 10 minutes; total story estimate remains 104 minutes

**Files:**
- Modify after campaign only: `docs/readiness/US-058.json`
- Append after campaign only: `.nous-feedback.jsonl`

**Interfaces:**
- Consumes `authority/us-058-base` and the final reviewed implementation commit.
- Produces one retained campaign, closed actuals, one `test_report`, and terminal `done` evidence.

- [ ] **Step 1: Clear the cache and run the only authoritative campaign**

Capture start/end UTC timestamps and elapsed seconds around exactly:

```bash
pnpm mutation:cache:clear
MUTATION_BASE=authority/us-058-base pnpm test:mutation
```

This is the final implementation command. Any later implementation commit
requires a timestamped `mutation_invalidation` and another cold campaign.

- [ ] **Step 2: Record exact actuals**

Read the generated manifest and reports. Set `docs/readiness/US-058.json`
`actuals` with five non-overlapping phase-minute values, their sum, exactly 12
changed files, reachable US-058 commits from the authority ref, evidenced
review-fix loops, `cold_mutation_attempts: 1`,
`mutation_invalidations: 0`, rounded `mutation_minutes`, recomputed variance
from 104 minutes, and a `root_cause` naming refs, timestamps, commands, cutoff,
and rounding formula. Do not change the approved payload or approval digest.

- [ ] **Step 3: Append terminal mutation and lifecycle evidence**

Capture a fresh UTC timestamp for each record and append `test_report` with the
exact generated score/count/duration values, followed by `done`. For example,
the final objects have this shape:

```jsonl
{"story":"US-058","event":"test_report","ts":"2026-09-06T13:00:00Z","scope":"diff","mutation_score":84.2,"killed":32,"survived":6,"surviving_annotated":[],"mutation_wallclock_s":720}
{"story":"US-058","event":"done","ts":"2026-09-06T13:01:00Z"}
```

The objects above illustrate field shape only; use the captured times and
measured report values. Do not emit a scoreless report. Annotate every retained
survivor with reviewer-approved `@equivalent: <reason>` evidence.

- [ ] **Step 4: Validate evidence only and commit closure**

No implementation suite runs now. Validate only the readiness/evidence shape:

```bash
pnpm readiness:check -- US-058
pnpm test:feedback-order
git diff --name-only authority/us-058-base..HEAD
```

Expected: readiness and ordering pass; the diff now equals the declared exact
12-path list. Commit only evidence files:

```bash
git add docs/readiness/US-058.json .nous-feedback.jsonl
git commit -m "docs(US-058): record mutation evidence and closure"
```

- [ ] **Step 5: Finish without invalidating the campaign**

Use `superpowers:finishing-a-development-branch` to inspect the exact committed
tree and present integration options. Do not rerun `pnpm check`, focused tests,
Pact, build, lint, type-check, or mutation after the authoritative campaign;
their pre-campaign evidence already binds the unchanged implementation tree.
