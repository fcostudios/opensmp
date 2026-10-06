# US-071 exact person cost design

Authority: `docs/stories/sprint-3/r1_misc_us_071.md`, approved readiness `docs/readiness/US-071.json` digest `5d445fb27d35c2596f666e92f738fa733e588bf5a34b17d97123cfde0b8a9bdc`. Francisco Lomas authorized the digest-covered policies and continuation until done and tested. This document records that intent; it does not claim the human reviewed this later-authored file.

## Architecture and alternatives

Use the existing connector, shared analytics ingestion module and analytics worker job. A new durable cost queue would introduce a second lifecycle; an unbounded history rewrite would violate the story. The selected one-day connector contract plus thirty completed UTC dates retains the existing resource/failure boundary and makes each account/day independently atomic and replayable.

## Exact contract

Introduce `CostIngestionRecord` with nullable `email`, nullable `providerUserId`, `costDate`, canonical decimal-string `amountUsd`, and nullable original fractional-cent `amountCents` (null for non-provider channels). `CostSnapshot.records` uses that record. Export `normalizeCostUsd(value: unknown): string` and `fractionalCentsToUsd(value: unknown): string` from existing contracts.ts. Decimal grammar permits signed ordinary base-10 digits only, normalizes trailing zeroes and negative zero. Use BigInt/string arithmetic. Reject nonzero precision beyond four USD decimals and magnitudes over 99999999.9999 before any write. Negative corrections are allowed. Exponents, NaN, Infinity, malformed input and overflow reject; no rounding. Original cents are preserved as provider text; canonical USD strings are reconstructed, never trusted blindly.

Anthropic syncCost parses documented per-user `data` items (amount fractional cents, currency USD, actor.email_address nullable and actor.user_id). Fetch only user_cost_report for the requested one-day inclusive starting_at/exclusive ending_at interval; do not join activity/usage. Bounded opaque pagination retains existing repeat-token/limit failures. Preserve null actors as records. Allowlisted returned raw data carries only version, identity, date and monetary fields; never provider headers, credentials or unknown fields. Activity parsing and endpoint stay intact.

## Shared persistence and window

Export `CostBatch`, `CostBatchResult`, `resolveCostScopes` and `ingestCostBatch` in analytics-ingestion.ts, alongside activity. CostBatch mirrors activity using `costDate` and injected `windowAt: Date` in addition to source/syncedAt. `windowAt` defines UTC today D independently of pinned observation freshness: eligible dates are [D-30,D). Dates outside the window produce ignored writes for every source, including manual/CSV. Missing provider rows neither zero nor delete costs.

Validate all records before the transaction mutates any row. Company authority comes from Person.company_id, not VendorAccount. Lowercase/trim email matching uses company scope; ambiguous identities and conflicting duplicates reject atomically, exact duplicates coalesce. Null/unmatched email warns durably with provider user id intact. Resolve trusted active company routes using the existing pattern.

Acquire shared account/vendor/company/person locks and enforce API opt-in at held commit, with the same actor audit boundary as activity. Shared API batches reject unsupported inactive vendors; CSV/manual reach the same entrypoint without automatic provider calls. Natural key is (vendor_account_id,person_id,cost_date). A newer synced_at updates amount, source and allowlisted replay payload once; stale observations ignore; equal-time exact replay ignores; equal-time contradictory payload rejects the account/day. Replay payload includes version, account/date/source, normalized identity, exact USD and original cents. JSONB equality supplies key-order-independent equivalence.

CostRecord.source uses ingestion_source with api default, and Drizzle declares its existing natural key. Add one append-only analytics_cost_revisions timestamp migration for source and narrow ledger_app UPDATE columns; do not mutate historical migrations. verify-schema verifies source, key and grants.

## Worker composition and failure boundary

Keep createAnalyticsActivityJob(options).drain({at,vendorAccountId?}) and processed result. Existing activity execution still uses D-3. Add cost execution for dates D-30 through D-1, oldest first. API active/supported account selection happens before credentials/provider calls. Preserve credential composition (analytics plus admin-scoped) and distinct observation operations/endpoints. Pin syncedAt before the provider wait; use input.at for window authority.

Each cost account/day uses a genuine Drizzle transaction around held eligibility, routed shared batches and global warning audit. Do not wrap a non-transaction Drizzle object in manual BEGIN. An error rolls back the failing day and propagates existing retryable provider classification; earlier days may remain committed and safely replay. Connections release in finally and caller close remains valid after initialization failures. No cursor/lease, new factory, dispatcher edits, screen, public API or deployment work.

## Verification and bounded delivery

Property tests assert cents conversion, signed bounds, representability, canonicalization and invalid-before-write rejection with deterministic seeds. Provider unit and Pact tests assert per-user fractional cents, nullable actors, one-day intervals and pagination; contracts are based on official provider documentation, not live credentials. Real ledger_app PostgreSQL tests assert account/company isolation, ambiguous identity, window boundaries, out-of-window preservation, stale/equal/newer replay and atomic rollback. Worker integration proves cost calls, opt-in skip, endpoint/credential distinction, retries and warning audits with real shared code.

Three implementation tasks each end with focused green tests, committed preflight, intersecting-shard previews, survivor repair/re-preview and spec/quality review. Generated TESTING critical-path rows are delivered through normal Nous config and atomic sync envelope. Final most-capable branch review adversarially verifies AC1..4, followed by pnpm check, fresh committed migration apply/verify/parity and one cache-cleared full diff campaign after every code/test fix is committed. Terminal readiness actuals and append-only feedback comprise the sole evidence commit.

The approved twenty paths are the readiness/feedback, this design/plan, five generated governance paths, connector contracts/provider/two tests, DB schema/ingestion/integration/migration/verifier, and worker job/integration. Required additional paths or remaining work exceeding the approved estimate trigger reassessment at a task boundary. No merge or push is authorized.
