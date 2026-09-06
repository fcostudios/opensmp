# US-057 Connector-Call Journal Design

**Date:** 2026-09-06
**Status:** Approved in session
**Story:** `docs/stories/sprint-3/r1_misc_us_057.md`
**Readiness:** `docs/readiness/US-057.json`
**Parent design:** `docs/superpowers/specs/2026-09-05-us-018-anthropic-connector-design.md`

## Goal

Persist privacy-safe, provider-neutral evidence for every outbound connector
attempt. A durable `requested` event must exist before transport begins; a
known response appends one terminal event, while interruption or an ambiguous
transport outcome leaves the request unmatched for later reconciliation.

US-057 delivers the journal, its neutral persistence contract, and the bridge
from the US-056 Anthropic attempt seam. It does not register a production REST
connector, implement the five neutral connector operations, or add Pact
coverage; those remain US-058 responsibilities.

## Chosen approach

Introduce a provider-neutral observation session in `@smp/connectors` and a
PostgreSQL-backed append port in `@smp/db`. The session binds trusted operation
context once, owns correlation and attempt allocation, converts only closed
provider metadata into allowlisted summaries, and awaits each database commit.
Provider implementations never import Drizzle or application modules.

The composition layer creates one session for one logical connector operation.
The session generates an opaque correlation UUID through an injected factory,
reuses it across retries and future paginated calls, and exposes the generated
ID to connector results. Callers may supply an optional existing
`ProvisioningAction` link, but cannot choose the correlation ID or write a
company scope into an observation.

Two alternatives are rejected:

1. Enriching the Anthropic observer with workflow ownership would couple a
   provider-private executor to neutral orchestration and duplicate the same
   adaptation for later providers.
2. Wrapping raw HTTP transport would expose credential-bearing `Request`
   objects and bodies to the journal boundary while still lacking trustworthy
   operation and action ownership.

## Neutral observation session

The connector package defines closed neutral values for:

- operations: `provision`, `deprovision`, `sync_members`, `sync_activity`, and
  `sync_cost`;
- phases: `requested`, `succeeded`, and `failed`;
- one-based attempts;
- neutral classifications; and
- allowlisted request and outcome summaries.

Session construction requires a vendor account ID, neutral operation, optional
provisioning action ID, clock, UUID factory, and append port. Construction
generates the correlation ID. The session exposes that ID and two lifecycle
operations:

1. `requested` allocates the next attempt, builds the request summary, appends
   and commits the event, and returns an opaque attempt receipt.
2. `succeeded` or `failed` consumes that receipt, builds the terminal summary,
   and appends and commits exactly one terminal event.

The receipt prevents a provider adapter from inventing a terminal attempt or
completing a different session. Repeated terminal completion is rejected in
memory and independently rejected by PostgreSQL. The monotonically increasing
session counter allows later US-058 pagination to share one correlation even
when an underlying request executor's local retry counter restarts.

The existing Anthropic observer is adapted to the neutral session. A
`requested` observation opens and stores its receipt; a known `completed`
observation maps `success` to `succeeded` and every other known classification
to `failed`. A transport exception emits no completion and therefore preserves
the unmatched request.

## Sequencing and commit boundary

US-056 currently validates policy, credentials, and request bodies before any
side effect. For each valid attempt it awaits the requested observer, acquires
rate-limit admission immediately before transport, constructs the policy-owned
request, and calls the injected transport.

US-057 retains that order. The database appender uses a dedicated autocommit
statement and resolves only after PostgreSQL commits; it must not enqueue a
write, share a caller transaction, or keep the network call inside a database
transaction. A requested-persistence failure propagates before rate admission
and transport, so the provider call count remains zero.

Keeping persistence before rate admission preserves the US-056 invariant that
admission reflects the actual transport window after any database delay. A
process interruption while waiting for admission can conservatively leave an
unmatched requested intent even though transport was not reached. That false
uncertainty is safe and reconcilable; moving persistence after admission could
age multiple reservations and permit a transport burst.

After a known provider result, terminal persistence is awaited before the
result is returned. If it fails, the provider response body is cancelled and
the operational error propagates. The committed requested event remains the
honest evidence available for reconciliation.

## Database model and invariants

Add the canonical `connector_call_observation` table and its operation and
phase enums through a new append-only migration with slug
`connector_call_observation`. The Drizzle schema mirrors the canonical entity
in `docs/specs/04_er_model.md`:

- UUID primary key;
- required vendor-account foreign key;
- nullable provisioning-action foreign key;
- required correlation UUID, neutral operation, one-based attempt, phase,
  JSON object summary, and occurrence timestamp; and
- nullable classification, which is null only for `requested`.

Database checks and indexes enforce:

- `attempt >= 1`;
- requested/classification and terminal/classification shape;
- `summary` is a JSON object;
- uniqueness of `(correlation_id, attempt, phase)`;
- at most one terminal phase for `(correlation_id, attempt)`;
- a terminal event has a matching requested event;
- correlation context cannot change vendor account, operation, or optional
  provisioning-action ownership between events;
- requested attempts increase monotonically within a correlation;
- a linked provisioning action belongs to the same vendor account; and
- sync operations have no provisioning-action link.

The application role receives `SELECT` and `INSERT` only. `UPDATE`, `DELETE`,
and other table privileges remain unavailable. A mutation trigger also rejects
owner-side update or delete attempts, matching the repository's strongest
append-only evidence pattern. A verification migration and the central schema
verifier assert the physical shape, grants, indexes, checks, and triggers.

`VendorAccount` is business data, not Ledger's application-tenant boundary.
The journal therefore does not add a caller-supplied `company_id`. Provisioning
company scope is derived only through
`ConnectorCallObservation -> ProvisioningAction -> LicenseRequest`; enforcing
the account match prevents evidence from being attributed through an unrelated
request. Sync evidence remains vendor-account scoped and never fabricates a
license request or provisioning action.

## Sanitized summaries

The summary builder constructs a fresh object from explicit fields. It never
spreads or recursively copies a provider object. The initial closed vocabulary
is limited to fields needed by the current transport, such as endpoint class,
method, bounded HTTP status or status class, bounded retry/rate hints, bounded
page/count metadata, closed schema-shape labels, and keyed correlation hashes.
Unsupported and unknown inputs are ignored rather than persisted.

The builder and persistence boundary forbid:

- credential material and authorization headers;
- email addresses and raw personal data;
- full organization, member, invitation, or other provider identifiers;
- URLs or raw provider paths that can contain identifiers;
- raw request or response bodies;
- provider exception messages; and
- arbitrary unknown fields.

Identifiers needed for matching may be represented only by a keyed hash whose
key is supplied outside the provider package. An ordinary unkeyed digest is not
an acceptable substitute because low-entropy identifiers and email addresses
are enumerable. Recursive redaction may be used only as defense in depth after
allowlist construction; it is never the primary sanitizer.

## Package boundaries

- `packages/connectors/src/contracts.ts` owns provider-neutral observation
  types and the append-port/session contract.
- A focused connector module owns session state, receipt validation, and
  allowlist construction.
- `packages/connectors/src/providers/anthropic/` owns the adapter from the
  existing Anthropic attempt observations to the neutral session.
- `packages/db/src/schema.ts` mirrors the canonical entity.
- A focused `@smp/db` module performs autocommit inserts and exports the
  database-backed append port for later web or worker composition.
- Migrations and `packages/db/scripts/verify-schema.mjs` own database-level
  enforcement.

No HTTP route, server action, UI, dispatcher registration, credential loader,
or provider-operation implementation is added by this story.

## Verification strategy

Development follows red-green-refactor and `docs/dev-guide/TESTING.md`.

1. Fixed-seed property and metamorphic tests generate nested sensitive and
   unknown inputs. They assert the exact allowed key/type vocabulary, prove
   that adding forbidden fields cannot change output, and prove that unique
   credential, header, email, identifier, body, and exception sentinels never
   survive serialization.
2. Real PostgreSQL tests run through `ledger_app` and `ledger_owner`. They
   verify exact table shape, constraints, action/account integrity, null sync
   links, runtime privileges, and update/delete rejection.
3. A real request-executor plus journal integration matrix substitutes only
   the true provider transport. It proves committed request visibility before
   transport, success and known-failure terminal rows, retry correlation and
   increasing attempts, unmatched ambiguous outcomes, zero transport calls
   after requested-persistence failure, and honest behavior after terminal
   persistence failure.
4. Provisioning fixtures from two companies prove that company attribution can
   only be derived through the matching action and request. No company-scoped
   query accepts scope from caller input.
5. Diff-scoped mutation testing covers the new connector and persistence logic
   in the one approved shard and must reach at least 80 percent with every
   surviving mutant dispositioned under the testing contract.

US-057 introduces no new third-party behavior, so it owes no new Pact contract.
US-058 will exercise the shipped five-operation adapter through Pact. Focused
tests run first, followed by schema verification, mutation verification, and
the complete `pnpm check` gate.

## Delivery boundary

US-057 is complete when all three acceptance criteria have durable evidence,
the database and connector contracts are committed, the mutation and full
gates pass, and lifecycle actuals and terminal events are emitted under the
work-readiness contract. It must not claim US-058 connector conformance or
production registration.
