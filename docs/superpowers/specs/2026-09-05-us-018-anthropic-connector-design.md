# US-018 Anthropic Connector Design

**Date:** 2026-09-05
**Status:** Approved
**Story:** `docs/stories/sprint-3/r1_misc_us_018.md`
**Readiness:** `docs/readiness/US-018.json`

## Goal

Deliver the R1 Anthropic adapter behind Ledger's vendor-neutral connector
interface. The adapter must keep Admin and Analytics credentials separate,
enforce endpoint-specific headers and declared rate budgets, apply bounded
operation-aware retry, and durably record a sanitized summary of every network
attempt. Deterministic network behavior is covered by Pact; live-provider
acceptance remains exclusively gated by US-054.

## Readiness correction required before implementation

The approved readiness artifact estimates US-018 at 310 minutes and reports no
schema or migration change. Repository inspection found that this signal cannot
support AC2:

- `ProvisioningAction.request_id` is mandatory, so a scheduled member,
  activity, or cost sync cannot use that table without fabricating a
  `LicenseRequest`.
- The runtime role cannot update `ProvisioningAction.raw_response` after a
  provider call.
- Reusing `AuditLog` would make generic audit history the canonical connector
  journal and would not represent a durable request-before-network boundary.

Before production or test changes begin, file a functional change through Nous
to introduce a connector-call observation ledger, regenerate the governed
artifacts, and rerun `pnpm readiness:check -- US-018`. If the corrected estimate
exceeds 320 minutes or another cohesion limit, execute approved vertical
children rather than bypassing the readiness gate.

## Chosen approach

Use a provider-neutral, append-only connector-call journal and inject its port
into the Anthropic adapter. Provider code remains independent of the database;
the application/worker composition layer supplies credential resolution and
journal persistence.

Two alternatives were rejected:

1. Storing sync calls in `ProvisioningAction` would invent request ownership and
   weaken the existing entity model.
2. Storing sync calls only in `AuditLog` would conflate administrative audit
   history with the operational call ledger and cannot reliably expose an
   outbound intent before the network boundary.

## Package boundaries

The neutral API remains in `packages/connectors/src/contracts.ts`. Anthropic
names, endpoint paths, headers, response shapes, and classifications exist only
under `packages/connectors/src/providers/anthropic/`, which is the existing
provider-boundary exemption. Shipped code ports relevant semantics from
`scripts/probes/anthropic/**`; it never imports probe code.

The provider implementation is split into small modules:

- endpoint and header policy;
- tagged credential validation and routing;
- rate limiting and bounded retry with injected time and sleep;
- HTTP transport, status classification, pagination, and response parsing;
- allowlist-based observation sanitization;
- the adapter implementing all five `VendorConnector` operations.

The connector package accepts ports and has no dependency on `apps/web`,
`apps/worker`, Drizzle, or the credential-encryption implementation.

## Neutral connector contract

The current `ConnectorResult.raw` member is JSON-safe but not privacy-safe. It
must not remain an untyped provider-body escape hatch. Results instead expose
owned normalized values plus a sanitized observation reference and typed error
classification. No raw request or response body crosses the provider boundary.

The adapter implements:

- `provision`: create an organization invite;
- `deprovision`: resolve the target transiently and remove the member;
- `syncMembers`: paginate and normalize user-management membership;
- `syncActivity`: paginate and normalize Analytics activity;
- `syncCost`: paginate and normalize exact decimal cost strings.

Provider email addresses and identifiers may exist transiently while parsing or
matching but are never copied into the call journal. The adapter advertises only
capabilities whose behavior and contracts are complete. The R1 dispatcher may
register Anthropic for `rest`; core consumers continue to select through the
neutral protocol and capability interface.

## Credentials and composition

Credential material originates in mounted Compose secrets, is encrypted into
the existing `IntegrationCredential` records, and is decrypted only by the
production composition layer using the mounted KEK. The runtime resolver:

- selects the active credential for the exact `vendor_account_id`;
- maps provider Admin to `admin_scoped` and Analytics to `analytics`;
- rejects missing, duplicate, blank, identical, unhealthy, or wrong-kind
  credentials before any network request;
- injects tagged values into the provider factory without logging them.

Admin credentials are used only for organization, member, and invite routes.
Analytics credentials are used only for activity, usage, and cost routes.

## Endpoint and retry policy

One endpoint table owns the API origin, `anthropic-version`, media headers,
credential kind, and optional beta header. There is no global beta header; the
currently verified member and invite endpoints send none.

Rate limiting is per vendor account and uses shared budgets for initial attempts
and retries:

- User Management: 100 requests per minute;
- Analytics: 60 requests per minute;
- invite creation: 1,200 requests per hour.

The limiter, clock, sleeper, timeout, and transport are injected. Pagination is
bounded to 100 pages. Admin pagination uses `after_id`; Analytics returns an
opaque `next_page` token that is echoed as `page` within the same query.

Retry is operation-aware and bounded. Safe reads and idempotent deletes may
retry classified 429 and provider failures while honoring valid `Retry-After`
metadata. Authentication, authorization, validation, and capability-routing
failures are terminal. Invite creation is not automatically replayed after an
ambiguous timeout or server failure because the provider offers no proven
idempotency contract; the journal preserves that uncertainty for later
reconciliation.

## Append-only connector-call journal

Add a provider-neutral `ConnectorCallObservation` table and verification
migration. Each outbound attempt has a stable correlation ID and produces:

1. a `requested` event committed before `fetch`;
2. a `succeeded` or `failed` event after a known result.

If the process dies or the outcome is ambiguous, the unmatched `requested`
event remains visible rather than being rewritten as a known failure. Retries
create new attempt events under the same operation correlation. The runtime role
receives narrowly scoped insert privileges; prior events are never updated or
deleted.

Each event identifies the vendor account, neutral operation, attempt number,
phase, classification, timestamps, and sanitized request or response summary.
Provisioning attempts may reference their `ProvisioningAction`; sync attempts
remain vendor-account scoped and do not fabricate a license request. Company
scope for provisioning evidence is derived through the linked request, never
accepted from a caller.

Summaries are built from an explicit allowlist. They may include method,
endpoint class, HTTP status classification, page/count metadata, rate-limit and
retry hints, schema shape, and keyed hashes used for correlation. They forbid
credentials, authorization headers, email addresses, raw PII, raw bodies, and
full provider identifiers. Generic recursive redaction is defense-in-depth, not
the sanitizer.

## Failure semantics

Credential and capability failures occur before a journaled network request
because no provider call is attempted. Once a request event is committed, every
known outcome is classified and appended. Callers receive neutral error codes,
retryability, and the observation correlation ID; they do not receive provider
bodies.

Persistence failure before the request prevents the network call. Persistence
failure after a known provider result returns an operational error and leaves
the requested event available for reconciliation. Later workflow stories own
business-state transitions, polling, alerts, and telemetry ingestion.

## Verification strategy

Implementation follows test-driven development and the repository testing
standard:

- Unit and property-based tests cover endpoint routing, strict credential
  separation, sanitizer leakage invariants, status classification, exact
  decimal values, pagination, limiter budgets, and bounded retry.
- Every fail-closed credential/capability test asserts that zero network calls
  occurred.
- Production connector Pact tests exercise shipped connector code, not only the
  US-054 probe. They cover all deterministic Admin and Analytics fixtures,
  headers, pagination, nullability, error classes, and rate-limit responses.
- Real PostgreSQL integration tests cover append-only journal behavior, runtime
  privileges, request-before-network ordering, known and ambiguous outcomes,
  provisioning links, and company derivation/isolation.
- Mutation verification covers the new critical connector and audit paths, then
  the full `pnpm check` gate runs.

No test uses live credentials or the live Anthropic API. Organization binding,
real credential scopes, real pagination, real rate enforcement, invite creation,
and invite cleanup remain US-054 acceptance work.

## Delivery sequence

1. Reconcile the migration requirement through Nous and obtain a valid approved
   readiness artifact.
2. Implement the append-only neutral journal and its runtime persistence port.
3. Replace the unsafe raw result seam with sanitized neutral observations.
4. Implement endpoint policy, credentials, limiter/retry, transport, schemas,
   and all five Anthropic operations.
5. Register production composition and credential resolution.
6. Add Pact, property, integration, mutation, and full-gate evidence.

