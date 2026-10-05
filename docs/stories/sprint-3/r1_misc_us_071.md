# US-071: Synchronize exact person costs within the 30-day revision window

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to ingest per-user daily cost so that usage charges have exact data — this child delivers: exact person-day costs from API-enabled vendor accounts that incorporate vendor revisions within the 30-day window without overwriting older costs, through the ingestion boundary US-070 establishes.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-071 |
| Feature | FEAT-020 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S5 |
| Screens | (jobs) |
| Server Actions | — |
| Entities | CostRecord (CU), VendorAccount (R), Person (R) |
| Business Rules | — |
| Migration | slug=analytics_cost_revisions |
| Blocked By | US-056, US-057, US-058, US-046, US-070 |

## Acceptance Criteria

- [ ] AC1: The cost sync upserts one CostRecord per (vendor account, person, cost_date) with the vendor's exact decimal amount preserved through `amount_usd decimal(12,4)` — no floating-point money arithmetic; precision, rounding, negative corrections and invalid/overflow rejection are specified in the design and property-tested — with `source=api`, `synced_at` and the allowlisted replay payload (DEC-SMP-024); within an injected UTC 30-day completed-date window, revised values update the matching rows exactly once and rows outside the window stay unchanged.
- [ ] AC2: Identity is matched via Vendor.identity_matching (email) on company-scoped Person rows; unmatched or null-email users are retained as warnings, never dropped.
- [ ] AC3: Only `ingestion_mode=api` accounts are auto-synced (DEC-SMP-025); csv_import/manual accounts cause no provider calls and reach the same source-aware upsert entrypoint; freshness keyed on `synced_at` stays channel-agnostic (US-029).
- [ ] AC4: Demo: resync revised fractional-cent costs at the revision-window boundary — eligible rows change once, older rows stay unchanged, unmatched users warn, and other accounts and companies remain isolated under repeated and concurrent runs.

## Notes

- Canonical child of **US-026** (parent AC coverage: **AC2**, cost side of **AC3/AC4**), minted by **CHG-068** on 2026-10-05 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-026.json`, proposal `revisable-person-cost`, estimate 240 min). Decisions DEC-SMP-024, DEC-SMP-025. Depends on US-070's shared ingestion boundary (`Blocked By`).
- Vertical delivery, not separate backend/test stories: the cost-specific append-only migration (`CostRecord.source` + unique-key parity in the Drizzle declarations, the narrow `ledger_app` upsert grant), contract corrections (exact decimal strings end to end; `raw:null` replaced by the allowlisted payload), production worker execution (one-day `SyncInput` extended to the injected window; failure/retry behaviour specified) and verification of oldest-eligible versus excluded dates, repeated/concurrent runs, changed costs and foreign-account/company isolation with real-DB fixtures.
- Reuses US-070's ingestion-mode gating, company-scoped Person identity, warning surfaces and worker orchestration; adds nothing to US-055 or US-029.
