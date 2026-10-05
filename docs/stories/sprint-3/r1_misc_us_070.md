# US-070: Ingest accurate daily person activity from API-enabled accounts

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to ingest per-user daily activity so that monitoring and usage views have data — this child delivers: accurate, replayable person-day activity from API-enabled vendor accounts, through the same identity matching and idempotent, source-aware persistence boundary that CSV/manual ingestion will reuse.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-070 |
| Feature | FEAT-020 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S5 |
| Screens | (jobs) |
| Server Actions | — |
| Entities | ActivityRecord (CU), VendorAccount (U ingestion_mode), Person (R) |
| Business Rules | — |
| Migration | slug=analytics_activity_ingestion |
| Blocked By | US-056, US-057, US-058, US-046 |

## Acceptance Criteria

- [ ] AC1: The daily analytics job upserts one ActivityRecord per (vendor account, person, activity_date) with documented per-user counters — never an organization summary copied into every person's row — `source=api`, `synced_at`, and an allowlisted replay payload (DEC-SMP-024: metrics, dates, provenance and the identity fields needed to replay; never request headers, credentials or unrelated user data); re-running the same account and date updates the same rows and their freshness.
- [ ] AC2: Identity is matched via Vendor.identity_matching (email) against company-scoped Person rows; unmatched or null-email identities are retained as warnings surfaced through the existing job/audit surfaces, never silently dropped.
- [ ] AC3: Only VendorAccounts with `ingestion_mode=api` are auto-synced; unconfigured accounts are backfilled to `manual` by an append-only migration and `api` is enabled explicitly per account, independent of provisioning `mode` (DEC-SMP-025); csv_import/manual accounts cause no provider calls and reach the same source-aware upsert entrypoint (the CSV import and manual-entry flows themselves stay in US-055).
- [ ] AC4: Demo: two people with different provider activity retain different counters; rerunning the same account/date updates the same rows and `synced_at`; missing identities produce visible warnings; a csv_import/manual account triggers no provider call.

## Notes

- Canonical child of **US-026** (parent AC coverage: **AC1**, activity side of **AC3/AC4**), minted by **CHG-068** on 2026-10-05 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-026.json`, proposal `daily-person-activity`, estimate 270 min). Decisions DEC-SMP-024, DEC-SMP-025.
- Vertical delivery, not separate backend/test stories: append-only schema/grant migrations (`ActivityRecord.source` + unique-key parity in the Drizzle declarations, the `VendorAccount.ingestion_mode` backfill, the narrow `ledger_app` upsert grant), contract corrections (the activity connector returns documented per-user metrics and keeps null-email identities as warning evidence), production worker execution (`analyticsSync` replaces its `dependencyNotDelivered(US-026)` stub using the existing credentials, rate limiting, sanitized observation sessions and injected dates) and their verification with real-DB rerun/concurrency/freshness and migration parity.
- This child owns the shared ingestion-mode gating, identity/warning and source-aware persistence primitives that **US-071** reuses for costs. Freshness labels stay with US-029; CSV/manual flows with US-055; no new screen.
