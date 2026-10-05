# US-026: Analytics sync: activity + cost

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to ingest per-user daily activity and cost so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-026 |
| Feature | FEAT-020 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S5 |
| Screens | (jobs) |
| Server Actions | — |
| Entities | ActivityRecord (CU), CostRecord (CU) |
| Business Rules | — |
| Blocked By | US-056, US-057, US-058, US-046, US-070, US-071 |

## Acceptance Criteria

- [ ] AC1: Daily job upserts ActivityRecord (counters jsonb + allowlisted replay payload (DEC-SMP-024) + synced_at) per (org, person, date); idempotent re-runs
- [ ] AC2: Cost sync upserts CostRecord within the 30-day revision window
- [ ] AC3: Identity matched via Vendor.identity_matching (email); unmatched rows surfaced as warnings
- [ ] AC4: The job only auto-syncs orgs with ingestion_mode=api; csv_import/manual orgs reach the SAME upserts through US-055 (source=csv_import/manual) — freshness labels and sync_stale semantics (US-029) are channel-agnostic, keyed on synced_at

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22; AC1 amended by CHG-068) — the scope is the single source; edit there and regenerate.
- **CHG-068 (2026-10-05) — partitioned.** The tenant assessment (`docs/readiness/drafts/US-026.json`) sizes this parent at 510 min against the 320-minute execution budget (IMP-374), `partition_required`. Partitioned into canonical vertical children **US-070** (daily person activity: AC1 + the activity side of AC3/AC4, 270 min) → **US-071** (revisable person cost: AC2 + the cost side of AC3/AC4, 240 min). No parent AC is deferred; the CSV import and manual-entry flows stay with US-055, the freshness UI with US-029; no new screen. This parent closes by parent-level verification once both children are dev_done — it is not re-implemented.
- **DEC-SMP-024 / DEC-SMP-025 (CHG-068):** replay payloads are allowlisted (metrics, dates, provenance and the identity fields needed to replay; never request headers, credentials or unrelated user data); unconfigured VendorAccounts default to `manual` ingestion and `api` is enabled explicitly per account, independent of provisioning mode.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
