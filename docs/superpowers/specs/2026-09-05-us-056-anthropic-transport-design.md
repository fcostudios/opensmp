# US-056 Anthropic Transport Design

**Date:** 2026-09-05
**Status:** Approved
**Story:** `docs/stories/sprint-3/r1_misc_us_056.md`
**Readiness:** `docs/readiness/US-056.json`
**Parent design:** `docs/superpowers/specs/2026-09-05-us-018-anthropic-connector-design.md`

## Goal

Build the provider-private transport foundation for the Anthropic connector.
The transport must select the correct credential before any network activity,
apply all endpoint headers from one policy table, share deterministic
per-vendor-account request budgets across initial attempts and retries, and
never replay ambiguous invite creation.

US-056 does not register a production connector or implement the five neutral
connector operations. US-057 adds the durable observation journal, and US-058
uses both foundations to deliver and register the complete adapter.

## Chosen approach

Create a small provider package under
`packages/connectors/src/providers/anthropic/`. The package receives tagged
credential records and injected clock, sleep, transport, and observation
ports. It imports neither application modules nor Drizzle and never imports
the US-054 probe; verified probe semantics are ported into production modules.

One request executor composes the endpoint policy, credential validation,
rate-limit acquisition, header construction, network attempt, and retry
decision. The components remain independently testable, but callers cannot
bypass policy by supplying arbitrary methods, origins, headers, or credential
kinds.

Two alternatives were rejected:

1. Generic application-wide HTTP middleware would make Anthropic policy
   mutable outside the provider boundary and weaken the existing lint guard.
2. Separate Admin and Analytics clients would duplicate retry and limiter
   behavior and make it easier for their policies to drift.

## Package boundary and modules

Provider-specific production code stays exclusively under
`packages/connectors/src/providers/anthropic/`:

- `endpoints.ts` owns endpoint identifiers, origin, path, method,
  `anthropic-version`, request and response media headers, optional beta
  header, credential kind, budget families, and retry safety.
- `credentials.ts` validates and resolves tagged credential candidates for one
  vendor account without knowing how they were loaded or decrypted.
- `rate-limiter.ts` owns serialized-window accounting and concurrency-safe
  acquisition for each vendor account and budget family.
- `request.ts` owns bounded attempt execution, request construction, timeout,
  response classification, and delay selection.
- Adjacent tests exercise these modules through their public behavior.

The provider directory may expose a narrow factory subpath from the connector
package. Provider names, paths, headers, and response shapes must not be
re-exported from the vendor-neutral root barrel. No database repository,
migration, worker composition, dispatcher registration, or user interface is
part of this story.

## Endpoint policy

Callers select a closed endpoint identifier rather than supplying request
policy. The table is the only source of truth for:

- `https://api.anthropic.com` as the origin;
- the exact HTTP method and provider path;
- `anthropic-version: 2023-06-01`;
- `accept: application/json` and `content-type: application/json` only when a
  body is present;
- the endpoint-specific `anthropic-beta` value, with no global beta header;
- `admin_scoped` for User Management organization, member, and invite routes;
- `analytics` for activity, usage, and cost routes;
- User Management or Analytics rate-budget membership;
- invite-create budget membership; and
- whether the operation is retry-safe.

The transport always overwrites policy-owned headers. It does not accept an
authorization header or arbitrary provider header from a caller.

## Credential contract

The composition layer supplies candidate records containing
`vendorAccountId`, `kind`, decrypted secret, `status`, and `health`. Resolution
is scoped to the exact requested vendor account and requires exactly one
candidate of each required kind:

- `kind` is `admin_scoped` or `analytics` as declared by endpoint policy;
- `status` is exactly `active`;
- `health` is exactly `ok`;
- the selected secret is nonblank after validation; and
- the Admin and Analytics secrets are not identical.

Missing, duplicate, blank, identical, retired, unhealthy, or wrong-kind input
fails before limiter acquisition and before the transport port is called.
Duplicate validation remains defensive even though the database has a partial
unique index for active `(vendor_account_id, kind)` rows.

Secrets are opaque tagged values. They are placed only in the provider's
`x-api-key` request header and are never returned, logged, serialized into an
error, or exposed to the observation port.

## Rate-limit topology

The limiter uses deterministic sliding windows keyed by vendor account. Each
network attempt, including a retry, acquires capacity immediately before the
transport call:

- User Management: 100 attempts in 60,000 milliseconds;
- Analytics: 60 attempts in 60,000 milliseconds;
- invite creation: 1,200 attempts in 3,600,000 milliseconds.

An invite-create attempt acquires both the User Management and invite budgets.
Other User Management operations acquire only the User Management budget.
Analytics operations acquire only the Analytics budget. Accounts never share
budget state.

When capacity is unavailable, the executor sleeps until the oldest relevant
attempt leaves its window and then acquires again. Multiple concurrent callers
for the same account and budget are serialized through the limiter so none can
observe and consume the same slot. Clock and sleep are injected; tests advance
a deterministic clock and never rely on real elapsed time or fake timers.

## Retry and failure policy

Every operation receives at most three total network attempts. Only safe GETs
and idempotent DELETEs retry HTTP 429 or any 5xx response. Authentication,
authorization, validation, other 4xx responses, and successful responses are
terminal. Network exceptions are classified as ambiguous and are not retried
in US-056 because the canonical AC names only known 429 and 5xx responses.

Invite creation is a POST and always receives exactly one attempt, including
when it returns 429 or 5xx or throws. This avoids replay when the provider may
have accepted a request without returning a known result.

A valid `Retry-After` delay is honored. Delta-seconds are accepted as a
non-negative decimal number, and a future HTTP-date is measured against the
injected clock. Invalid, negative, or past values fall back to deterministic
delays of 1,000 milliseconds before attempt two and 2,000 milliseconds before
attempt three. There is no jitter because no random source is required by the
story and deterministic operation is mandatory.

Rate-limit acquisition occurs after any retry delay. Consequently every retry
consumes the same account budget as its initial attempt and cannot amplify
provider load outside the declared windows.

The executor returns a provider-private normalized outcome containing status,
safe classification, response headers needed for policy, and an opaque body
available only inside the provider directory for later parsing. It never
crosses the neutral `VendorConnector` result seam in US-056. Raw response
bodies, credentials, and provider exception messages are never sent to the
observation port.

## Observation seam

US-056 defines an injected attempt-observation port but no database-backed
implementation. It can receive provider-private, allowlisted attempt metadata
such as endpoint identifier, neutral method class, attempt number, timestamps,
HTTP status, and safe classification. The port receives neither credentials
nor raw request or response bodies.

US-057 will bind this seam to the append-only `ConnectorCallObservation`
journal and establish request-before-network durability. Until then the
default observer is inert, and US-056 makes no persistence or durability
claim.

## Verification strategy

Implementation follows strict red-green-refactor cycles. Tests use the real
policy, credential resolver, limiter, and retry executor. Only the true
third-party network boundary is substituted with an injected deterministic
transport.

Behavioral tests prove:

- exact origin, method, version, media, beta, and credential routing for each
  endpoint family;
- zero transport calls for every fail-closed credential case;
- 100/minute, 60/minute, and 1,200/hour boundaries at the last allowed
  attempt, first delayed attempt, and window rollover;
- per-account isolation and concurrency-safe acquisition;
- retry ceilings, status classes, `Retry-After`, fallback delays, and budget
  consumption by retries; and
- exactly one invite-create call for responses or exceptions whose outcome may
  be ambiguous.

The repository's existing US-054 Pact contracts supply current contract-backed
third-party fixtures for the endpoint families. US-058 remains responsible for
Pact tests that exercise the shipped five-operation adapter itself; US-056 does
not claim connector conformance or live-provider acceptance.

The focused connector suite, provider-boundary lint, type-check, diff-scoped
mutation gate, and full `pnpm check` must pass before integration. Live API
calls and credential-scope assertions remain exclusively in US-054.
