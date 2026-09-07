# US-058 Anthropic Connector Conformance Design

## Context

US-058 is the final CHG-045 partition. US-056 supplies the bounded Anthropic
transport, credential separation, retry policy, and rate limiting. US-057
supplies the append-only neutral connector-call observation session and the
Anthropic observation bridge. This story composes those seams into a complete
`VendorConnector` and protects its deterministic provider behavior with Pact
consumer contracts.

CHG-049, CHG-050, and CHG-051 own the 2026-09-06 guidance delivery and overlay
registration. They must be complete before US-058 starts, and none of their
paths or commits belong to US-058. The US-058 implementation branch is created
from clean `main` only after this design and its readiness-bound plan are
committed. That post-plan commit becomes the immutable
`authority/us-058-base` used for changed-file actuals and the final mutation
campaign.

Live Anthropic verification is deliberately excluded. It remains US-054 and
requires operator credentials and invite-canary authorization.

## Outcome

Given a completed Anthropic connector, the vendor-neutral dispatcher accepts
it explicitly as `createConnectorDispatcher({ rest: connector })` and resolves
it for the `rest` protocol. The connector advertises exactly five working
capabilities:

- `provision`
- `deprovision`
- `syncMembers`
- `syncActivity`
- `syncCost`

Calling `createConnectorDispatcher()` without the dependency remains
`none`-only. US-058 does not add an application-layer credential loader or make
existing default dispatcher construction silently perform provider calls.

The implementation bounds every paginated operation to 100 pages, preserves
cost decimals as exact strings, journals each provider attempt through the
US-057 seam, and returns `raw: null` from every Anthropic success or provider
failure. The neutral `ConnectorResult` contract continues to allow other
connectors to return JSON-safe `raw`; provider privacy is enforced by the
Anthropic adapter rather than by changing that shared contract.

## Chosen Approach

Create a provider-local adapter under
`packages/connectors/src/providers/anthropic/`. The adapter receives explicit
ports for account-scoped credential lookup and observation-session creation,
and composes the real US-056 request executor. It owns provider request bodies,
query construction, pagination cursors, response validation, error mapping,
and neutral result construction.

The connector package exposes the factory only through the narrow
`@smp/connectors/providers/anthropic/connector` package subpath. It is not
re-exported from the neutral root barrel. The dispatcher remains
vendor-neutral: its constructor helper accepts an optional completed `rest`
connector and registers it through the existing validation wrapper.

Pact exercises the real adapter and dispatcher against Pact's local mock
server. The only substituted production boundary is `AnthropicTransport`.
Credential selection, request execution, rate limiting, pagination, mapping,
dispatch, the observation bridge, and the neutral observation session remain
real owned code. Tests use an in-memory implementation of the append port to
inspect journal events without mocking an owned service.

## Rejected Approaches

### Carry the Nous guidance delivery as US-058

The delivery and its tenant overlay are technical provenance work owned by
CHG-050 and CHG-051. Mixing those paths into this functional story would make
its mutation diff, actuals, and ownership evidence dishonest.

### Promote the operational probe into the runtime adapter

The probe is designed for credentialed operator diagnostics and artifact
capture. Reusing it would couple production calls to CLI concerns and allow
probe-shaped data to become part of the runtime seam. Its existing Pact file
may host a second, separately named consumer suite that imports the shipped
factory; production code never imports probe code.

### Put Anthropic schemas in neutral connector modules

This would make the neutral contract depend on vendor routes and response
fields. Anthropic names, request headers, pagination tokens, and response
shapes remain below the provider directory.

### Test mapping with doubles for owned executor or journal code

That would verify the doubles rather than the adapter. Deterministic transport
responses and Pact's mock server are legitimate substitutions for the
third-party HTTP boundary; all Ledger-owned layers remain real.

## Components and Responsibilities

### Endpoint and query policy

The existing endpoint table gains `delete_member`, `user_usage_report`, and
`user_cost_report`. It remains the single source for origin, method, path,
credential kind, version and media headers, rate budgets, and retry safety.

Callers cannot provide arbitrary query keys or a URL. The request input accepts
a closed provider-local query value whose fields are derived from the selected
operation:

- member and invitation pages use `limit=1000` and optional `after_id`;
- analytics identity and summary requests use the validated observation date;
- usage and cost reports use UTC `starting_at`, exclusive next-day `ending_at`,
  `bucket_width=1d`, and their fixed limit;
- analytics continuation echoes an opaque `next_page` value as `page`.

Unknown fields, control characters, blank continuations, and conflicting
operation/query combinations fail before observation, rate admission, or
transport. `URLSearchParams` performs the only wire encoding.

### Provider response parsers and exact money

Provider-local parsers validate closed response shapes before mapping them.
They reject malformed collections, cursors, dates, counters, costs, and
required identifiers. Records without a usable email do not become neutral
member, activity, or cost records. Duplicate or ambiguous identities fail
closed rather than selecting by order.

Cost conversion never passes through JavaScript floating-point arithmetic.
Canonical plain-decimal fractional cents are shifted two decimal places with
string and `BigInt` operations into exact USD strings. Exponents,
non-canonical decimals, negative zero, unsafe sizes, and non-USD currencies are
rejected. Fixed-seed property tests prove scale shifting, sign/canonicalization,
and round-trip invariants; Pact supplies the provider-contract oracle.

### Pagination runner

A provider-local pagination helper executes ID-cursor and opaque-page flows.
It stops when the provider reports no next page, permits a terminal page 100,
and refuses to request page 101. A `has_more` response without a usable cursor,
a blank or malformed token, and any repeated cursor fail closed before another
request consumes rate budget.

### Anthropic connector factory

The factory returns a frozen `VendorConnector` with the exact five-capability
set. Its dependency boundary separates the neutral caller's request ID from the
US-057 persistence link:

```ts
export type AnthropicConnectorDependencies = Readonly<{
  credentialsFor(
    vendorAccountId: string,
  ): Promise<readonly AnthropicCredentialCandidate[]>;
  observationSessionFor(input: Readonly<{
    vendorAccountId: string;
    requestId: string | null;
    operation: ConnectorOperation;
  }>): Promise<ConnectorCallObservationSession>;
  requestDependencies: Readonly<{
    clock: AnthropicClock;
    sleep: AnthropicSleep;
    limiter: AnthropicRateLimiter;
    transport: AnthropicTransport;
  }>;
}>;
```

For provision and deprovision, the application-supplied
`observationSessionFor` port resolves the neutral `requestId` to the trusted
`ProvisioningAction` ID before it creates
`createConnectorCallObservationSession({ provisioningActionId, ... })`. Sync
operations pass `requestId: null`, and their sessions must have
`provisioningActionId: null`. US-058 neither treats the two IDs as
interchangeable nor adds a database lookup to the provider package.

Each method validates neutral input, obtains account-scoped credential
candidates once, creates one observation session for the whole logical
operation, constructs a real request executor with the session bridge, and
maps provider-local success into frozen neutral values. Pagination requests
and retries share the session correlation; the neutral session assigns durable
monotonic attempt receipts even when an executor's local retry count restarts
for a later page.

Provision creates an organization invite and returns its provider reference.
Deprovision transiently locates the unique matching member or invitation,
calls the corresponding delete endpoint, and returns the removed provider
reference. Member sync combines active members and pending invitations into
neutral member snapshots. Activity sync joins provider analytics identities
and summaries into dated neutral counters. Cost sync maps per-user usage/cost
rows to dated exact-string USD amounts.

### Failure contract

All failures preserve provider privacy:

| Failure | Neutral behavior | Journal behavior |
|---|---|---|
| Invalid input, missing/wrong account credentials, or session creation failure | Reject before provider transport | No provider attempt |
| Provider 4xx client/auth response | `provider_error`, `retryable: false`, `raw: null` | Requested + failed |
| Exhausted 429 or 5xx response | `provider_error`, with retryability copied from the endpoint-aware executor, `raw: null` | Requested + failed for every attempt |
| Transport ambiguity | `provider_error`, endpoint-aware retryability, `raw: null` | Requested remains unmatched |
| Malformed success body, invalid/repeated cursor, page overflow, ambiguous identity, or invalid money | `provider_error`, `retryable: false`, `raw: null` | Network attempt retains its known success observation; no partial neutral result |
| Observation persistence failure | Reject the operation | Request is prevented, or the committed requested event remains unmatched when terminal persistence fails |

Provider exception text, headers, URLs, credentials, full identifiers, and raw
bodies never enter neutral results or connector-call observation payloads.

### Dispatcher composition

`createConnectorDispatcher({ rest?: VendorConnector } = {})` registers the
supplied connector once and preserves the existing `none` behavior when it is
omitted. Tests prove that the real Anthropic factory advertises exactly its
five methods and that every Anthropic success/failure returns `raw: null`.
They do not claim the generic dispatcher can infer whether an arbitrary
connector's advertised methods are implemented or reject otherwise-valid
JSON-safe raw values.

### Pact consumer suite

The existing `scripts/probes/anthropic/pact.contract.test.ts` remains the one
contract entry point already selected by the repository contract config. It
keeps the existing 12 probe interactions unchanged and adds a separately named
`ledger-anthropic-connector` consumer suite for the shipped factory. No Vitest
configuration file changes.

The connector suite covers exact Admin and Analytics headers, create/delete
bodies and encoded identifiers, both pagination styles, nullable email,
activity and user-cost shapes, exact fractional cents, client and provider
errors, and 429 with `Retry-After`. It invokes the dispatcher-resolved real
connector and asserts neutral outputs plus allowlisted in-memory journal
events. Generated Pact files are temporary test artifacts and are cleaned up
after their assertions.

## Verification Strategy

Development follows strict red-green-refactor cycles. Every new behavioral
test names the production mutation it catches. Adapter tests compose real
owned components and deterministic valid UUIDs; only the provider transport is
substituted. Focused suites cover closed queries and responses, pagination,
fixed-seed money properties, all five adapter methods, observation sequencing,
dispatch, neutral-result containment, and Pact interactions.

After implementation, independent adversarial review attempts to break every
story AC, including page 101, repeated/missing cursors, cross-account
credentials, nullable identities, ambiguous matches, malformed decimals,
forged capability advertisement, Anthropic-body leakage, wrong key headers,
classified errors, and 429 responses. Every resulting regression test and
repair is committed before the effectiveness gate.

The complete pre-campaign gate includes `pnpm check`, the emitted fresh-schema
push plus verifier, and tenant gate T1 (`db:migrate`, `db:verify`, and
`db:parity`) with the required owner and application URLs. Authentication gate
T2 and deployment gate T3 do not apply to this connector-only story.

After all reviews and repairs are closed, the final implementation command
clears the mutation cache and runs exactly one diff-scoped
`MUTATION_BASE=authority/us-058-base pnpm test:mutation` campaign. No
implementation test or verification command runs afterward. Only readiness
and feedback validation, evidence recording, terminal closure, and integration
administration may follow; an implementation commit invalidates the campaign.

## Evidence and Actuals

The feature branch's first commit records a timestamped `started` event before
any test or production edit. Every new feedback event carries an ISO-8601 UTC
`ts`. Pre-campaign evidence contains one adversarial `ac_verify` for each AC
and a `build_pass` bound to the reviewed source commit.

The sole terminal `test_report` records `scope: "diff"`, mutation score,
killed and survived counts, survivor annotations, and
`mutation_wallclock_s`. US-058 actuals count changed paths and reachable story
commits from `authority/us-058-base`, record one cold attempt unless an
explicitly reasoned `mutation_invalidation` is required, and include
`mutation_minutes` without double-counting it in the five-phase total.
