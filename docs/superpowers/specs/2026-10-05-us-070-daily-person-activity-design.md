# US-070 — Daily person activity ingestion

**Status:** approved by Francisco Lomas in this conversation ("Approve and continue", 2026-10-05); implementation follows the readiness-bound plan.
**Readiness:** `docs/readiness/US-070.json` (270 minutes).
**Authority:** CHG-068, canonical `docs/stories/sprint-3/r1_misc_us_070.md`, DEC-SMP-024 and DEC-SMP-025.

## Outcome and approach

The daily worker ingests actual person-day activity for explicitly API-enabled
VendorAccounts. Reruns update the same natural-key rows and their freshness.
Unknown identities remain visible in persisted audit warnings. CSV/manual
callers reuse the same source-aware persistence boundary; their entry flows
remain US-055. Cost revisions remain US-071 and freshness UI remains US-029.

Use three small units: a provider adapter, a shared database ingestion boundary,
and the existing worker's analytics handler. This fits the approved contract/db/
server scope and creates the shared seam needed by both following stories.

Alternatives considered: placing matching and writes directly in the worker
would make CSV/manual callers duplicate them; introducing a durable ingestion
queue or payload store would add a new lifecycle and migration scope. The shared
database boundary is the recommended approach.

## Provider contract

Keep `syncActivity({vendorAccountId, observedAt})`, with `observedAt` identifying
the queried UTC day. Return dated records with nullable normalized email,
minimal provider identity, validated JSON counters and an allowlisted replay
payload. The adapter does not resolve Ledger Person IDs or companies.

Anthropic's documented users endpoint returns per-user metric groups and a
nested `user` identity; the existing `user_id/email` parser and duplicated
organization summary are replaced. Preserve per-user chat, Claude Code and
Cowork metric groups as distinct counter namespaces, with explicit metric-field
allowlists and numeric validation. Unknown provider fields are ignored rather
than copied into persisted JSON. Missing/nullable metrics are preserved as
unknown, never invented as zero. Other metric products are outside this child.

No summaries request is needed to derive person counters. Retain the existing
bounded opaque pagination, repeated-cursor rejection, credential separation,
rate limiter, endpoint-specific request policy and sanitized observation bridge.
Confirm the documented nested identity/header shapes in the contract fixtures.
Invalid envelopes or conflicting duplicate identities fail the account fetch;
null identities produce warning candidates instead of disappearing. Full
provider bodies, request headers and credentials are never persisted.

Reference inspected 2026-10-05:
[Anthropic List User Activity](https://platform.claude.com/docs/en/api/beta/organization/analytics/users/list).
This supports the adapter shape; public documentation and Pact fixtures do not
claim an authenticated live-provider run.

## Shared ingestion interface and tenant boundary

Place the reusable boundary in `packages/db`, accepting an existing Drizzle
database/transaction supplied by composition. It must not create a second
application database connection. The worker follows its existing pool/Drizzle
composition; request-side callers may supply the shared application client.

The activity batch contract carries an explicitly authorized company scope,
vendor account ID, observation date, source (`api`, `csv_import`, `manual`), sync
instant, and records. Its result reports written/ignored counts and structured
identity warnings. Shared source, identity and warning types belong in packages;
cost-specific writes are implemented later by US-071 rather than fabricated now.

Resolve email case-insensitively against `Person` with a real `company_id`
predicate. Account IDs constrain the account/date natural key and do not grant
company authority. A caller cannot write another company's Person row. Global
scheduled execution enumerates trusted database company scopes and matches
each provider identity once; an identity outside a particular company is not
reported as globally unmatched if another authorized company matched it.
Company-specific entrypoints never search foreign companies to return their
identity details. Unsupported identity-matching modes fail explicitly rather
than silently falling back to email.

Do not require an active LicenseAssignment to match a Person: activity can exist
before drift reconciliation, which is owned by another story. Do not infer
historical financial attribution from Person.company_id; US-071/US-050 retain
their own cost/register responsibilities.

Persist one row per `(vendor_account_id, person_id, activity_date)`. Use a database
conflict upsert that updates counters, replay payload, source and `synced_at`,
preserving row ID. Validate the full batch before writing. Keep company batch
writes and their audit summary in one transaction. Reject conflicting duplicate
natural keys within a batch. Do not remove existing rows absent from a response.
Do not overwrite a row with an older sync instant; newer reruns refresh it.
Equal-instant equivalent retries are safe. Contradictory values at an equal
instant must fail rather than make worker scheduling determine the data.

The shared entrypoint validates date/source/counters/replay fields, resolves
identity, checks scope and performs writes for every channel. It is an internal
authorized service seam, not a public endpoint or a replacement for future
Auth.js permission checks on US-055 commands.

## Schema and migration

Add one timestamped, append-only `analytics_activity_ingestion` migration:

- Declare a common `api/csv_import/manual` ingestion enum and add
  `vendor_account.ingestion_mode NOT NULL DEFAULT manual`, backfilling existing
  accounts to manual independently of their provisioning mode.
- Add `activity_record.source NOT NULL DEFAULT api`; existing telemetry was
  generated before multi-channel flows existed, so the default preserves its
  original interpretation. New shared writes always provide an explicit source.
- Represent the already-committed activity natural-key uniqueness in Drizzle;
  do not create a duplicate database constraint.
- Grant `ledger_app` only the activity-column UPDATE privileges needed by the
  upsert. Preserve immutable key columns and the absence of DELETE privileges.

Explicit API opt-in is an operator configuration update through the existing
database administration path, not a new settings screen. US-055 owns later
entry/configuration flows. Cost fields/grants remain US-071.

## Worker flow, dates and failures

Replace the deferred analytics handler with the activity job. Keep the existing
daily UTC schedule. For scheduled `at`, the observed activity day is the UTC
calendar date minus three days, matching the approved conservative lag policy.
The connector receives that day while `synced_at` records the injected actual
sync instant. No date-range rollup or zero-filled activity is substituted for
one-day provider data. Same-account/day reruns use the same upsert boundary;
historical backfill scheduling is outside this child.

Select active accounts with `ingestion_mode=api`, an active supported vendor,
email identity matching and usage-data capability. Provisioning mode does not
restrict analytics: an orchestration-provisioned account may still have API
ingestion. Manual/CSV accounts are excluded before credential reads and provider
calls, including explicitly targeted worker runs.

Fetch one account snapshot, match it within trusted company scopes, and persist
it through the shared boundary. Revalidate ingestion mode before committing an
API batch so disabling an account during a fetch prevents a stale write. An
external call already in flight cannot be undone. Natural-key conflicts and
sync-instant checks govern overlapping executions; there is no new lease table.

Provider, credential or schema errors use the existing worker retry/failure
reporter. A partially failed run reports failure, with committed earlier company
batches remaining safe to replay. Unmatched identities are warnings and do not
discard successfully matched rows. Always release database clients and close
observation resources in `finally`. Mode-excluded accounts succeed with zero
processed rows and make no remote calls.

## Warning and replay evidence

Replay payloads contain a version, account/date/source, necessary provider
identity and the allowlisted counters. Reconstruct them from validated fields,
never from a shallow copy of the response. Persist only the identity information
needed to locate the row or explain why matching failed.

Write job-level `analytics_activity_sync` audit summaries, company-scoped for
matched batches. Retain each globally unmatched or null-identity warning as a
separate `analytics_identity_warning` audit entry with account/date, reason and
necessary identity evidence. Unattributable warning entries have no company
assignment and use the existing globally authorized audit surface. Do not
assign them to an arbitrary company or truncate them silently. Existing audit
queries enumerate actions dynamically and expose note/after data; the summary
note identifies warning counts so operators can find the detail entries without
a new screen. Future source-aware callers retain their verified actor identity;
worker entries identify system execution.

Audit warnings may recur on reruns because they record attempts; telemetry row
identity remains idempotent. Warning persistence failure fails the run so
unmatched data is never silently lost.

## Verification and measurement

Use real database fixtures under `ledger_app` for distinct per-user counters,
stable IDs and row counts after reruns, refreshed timestamps, stale retry
protection, concurrent natural-key writes, company/account isolation, source
channels and mode changes. Assert exact warning records and rollback when audit
persistence fails. Contract-backed provider fixtures exercise documented metrics,
null identities, pagination, malformed responses and excluded secret fields.

Worker integration proves manual/CSV zero-call behavior, API ingestion regardless
of provisioning mode, injected UTC midnight/leap-day observation dates, persisted
warning visibility, retry behavior and cleanup. Each assertion constrains an AC
or named mutant; no owned-code mocks or coverage-only tests are introduced.

Run committed-migration apply/verify/parity, type-check, lint, tests and build.
At each implementation task, preview only the preflight shards intersecting that
task's production sources. A separate reviewer adversarially checks all four
ACs and the scoped diff; after fixes, run one authoritative cold diff campaign
and annotate any survivors in the required one-line format. Changes to the
critical-path declaration follow the Nous-owned testing-config route, not a
hand edit to generated testing guidance.

Record US-070's own readiness/design/implementation/check/review/integration
phase boundaries, previews, fix loops and final cost provenance. Parent
assessment effort is separate. The 270-minute estimate remains the task-boundary
control: scope growth or an estimate overrun triggers reassessment before more
implementation. This design creates no executable tooling, new screen or
US-071 cost behavior.
