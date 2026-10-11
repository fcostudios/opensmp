# Effectiveness-critical paths

> Generated from `nous.db` — do not hand-edit. The few areas where a silent fault is
> materially costly. Mutation testing runs on **the diff**; this set decides which
> **stories owe mutation evidence** before they can close — two separate mechanisms.
> Governed by the **Test Effectiveness Standard** §3.1.
>
> **Adding a critical path of your own?** Declare it in config — not by editing a generated file:
> `nous_trace.py config patch --project <id> --key testing.critical_paths --value '["**Your path** — what a silent fault here would cost."]'`
> Declared rows are published verbatim — under `## Operator additions` in `testing/critical-paths.md`, and in the §3 list in `docs/dev-guide/TESTING.md` — and survive every regeneration.

## Always-mandated (Standard §3.1)

- **Tenant isolation** — every path that touches tenant-scoped data (filtered by `company_id`). → explicit isolation assertions (a query for tenant A must never return tenant B's rows).
- **Authorization** — role/permission gates on commands/mutations. → integration tests for allowed vs forbidden (expect 403).
- **Money / tax / financial math** (if present) — amounts, rounding, and idempotency of charge/ledger events. → property-based + a provider contract test.

## Critical business rules

| Rule | Name | Oracle | Governed-by stories |
|------|------|--------|---------------------|
| BR-01 | Register no-overlap (one seat, one holder, one period) | exact | US-003 |
| BR-02 | Every assigned seat-day belongs to exactly one company | exact | US-003, US-034, US-047 |
| BR-03 | Audit log is append-only at the database level | exact | US-003, US-008 |
| BR-04 | Only legal state-machine transitions execute | exact | US-014 |
| BR-08 | Approval aging: reminder at 24 h, escalation at 48 h; decision target 2 business days | exact | US-015, US-017, US-046 |
| BR-11 | Low-pool alert below the per-org floor | exact | US-022 |
| BR-12 | Blocked requests are never dropped; review within 1 business day | exact | US-023 |
| BR-14 | Departure deprovisioning completes same business day | property | US-024, US-042, US-075, US-077, US-082 |
| BR-17 | Proration is daily actual/actual with exact mid-month boundaries | exact | US-034 |
| BR-18 | Close is deterministic and idempotent; finals are immutable | exact | US-034, US-035, US-047, US-050 |
| BR-20 | Reconciliation flips to reconciled ONLY within 0.5% | exact | US-038 |
| BR-22 | Company scoping is enforced server-side on every query | exact | US-005, US-047 |

## Critical entities

| Entity | Why critical | Source |
|--------|--------------|--------|
| CompanyRoleAssignment | auth-sensitive entity (name heuristic) | heuristic |
| IntegrationCredential | auth-sensitive entity (name heuristic) | heuristic |
| MemberObservation | auth-sensitive entity (name heuristic) | heuristic |
| UserAccount | auth-sensitive entity (name heuristic) | heuristic |
| VendorAccount | auth-sensitive entity (name heuristic) | heuristic |
| VendorAccountCapacity | auth-sensitive entity (name heuristic) | heuristic |

## Operator additions (`testing.critical_paths`)

- **Invitation hygiene (US-067, US-068, US-069; DEC-SMP-023)** — overdue age derives from the durable invitation sent_at, with strict configured boundaries, company-scoped current eligibility and one alert per open breach. Withdrawal targets the pinned invitation only, refuses acceptance races and releases capacity only after confirmed removal; automatic expiry reuses that contract and records its system action.
- **Daily person activity (US-070; DEC-SMP-024, DEC-SMP-025)** — identity matching is company-scoped; natural-key writes are idempotent, ignore stale or equal-equivalent observations and reject equal-time contradictions; source/API activity ingestion requires explicit opt-in; replay accepts only allowlisted activity events; unmatched or null-email identities produce durable warnings; ambiguous identities reject the batch atomically.
- **Exact revisable person costs (US-071; DEC-SMP-024, DEC-SMP-025)** — signed USD amounts use exact decimal strings and integer arithmetic; nonrepresentable precision and overflow reject before writes. The injected UTC completed-date window [D-30,D) guards every source. Company-scoped identities, account/person/day freshness, opt-in locks and atomic warning audits preserve isolation and replay; null/unmatched identities warn and conflicting equal-time payloads reject.
- **Capacity refresh watermark (US-081, US-085; DEC-SMP-031, DEC-SMP-041)** — freed seats never become free capacity optimistically: only `recordAcceptedMemberSnapshot` writes `VendorAccount.members_refreshed_at`/`members_refresh_source`, and only for a validated-complete account-wide member observation (partial/failed/stale observations, provider removal success, invitation polling and single manual entries never stamp it); the `pool-snapshots` projection counts a closed assignment as freed only when the watermark is strictly later than the closure instant (the anchoring `offboarding → deprovisioned` transition `occurred_at`, else `ended_on` end-of-day America/Guayaquil), a null watermark frees nothing, and every other closure reports `pending_refresh`; `seat_freed` recovery and purchased quantities are untouched; every pool surface reads this one projection. Oracle: property-based over generated closure/observation histories with an injected clock, plus real-DB grant/apply verification.
<!-- nous-emitted: sha256=1a8bb329503b9860 -->
