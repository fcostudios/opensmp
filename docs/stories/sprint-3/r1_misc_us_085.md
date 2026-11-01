# US-085: Show pending-refresh capacity on the pools and dashboard overview

> **Sprint 3** | **P0** | **1 SP** | **R2**

## User Story

As a Group Admin (persona_01), I want the pools overview and my dashboard to tell me how many freed seats are still waiting for the next membership observation so that I never plan on capacity the vendor has not confirmed — this child delivers: the SCR-pools PoolGauges and the SCR-admin-dashboard "Licencias del grupo" tiles consuming US-081's shared capacity projection, with pending counts, as-of and never-observed state, their production queries, authorization and rendered-projection verification.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-085 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R2 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-pools, SCR-admin-dashboard |
| Server Actions | — |
| Entities | VendorAccount (R members_refreshed_at), VendorAccountCapacity (R), LicenseAssignment (R) |
| Business Rules | — |
| Blocked By | US-019, US-020, US-081 |

## Acceptance Criteria

- [ ] AC1: SCR-pools PoolGauges read US-081's shared projection contract (no second computation) and show, per vendor account and license type, the pending-refresh count beside purchased / assigned / pending invites / free, the watermark as-of, and "sin observación" with attention styling for a never-observed account; free never includes a pending seat (DEC-SMP-041).
- [ ] AC2: The SCR-admin-dashboard "Licencias del grupo" tiles read the same projection: disponibles excludes pending seats and states the pending count; the cross-org totals and the per-org breakdown link agree with SCR-pools to the seat.
- [ ] AC3: Both surfaces use their existing group_admin read authorization through production queries (no client-side recomputation); other companies' and other tenants' rows never leak; no new screen, navigation entry or persisted metric.
- [ ] AC4: Demo (overview): with one API account carrying a closure after its watermark and one never-observed manual account, SCR-pools shows "1 pendiente de actualización" on the first gauge and "sin observación" on the second, the dashboard disponibles tile shows the same pending count, and after an accepted observation dated after the closure both surfaces move together; a non-group_admin request is refused on both routes.

## Notes

- Canonical child of **US-024** (parent AC coverage: **AC2** "pool increments next sync" — the overview share, with US-081), minted by **CHG-078** on 2026-10-11 from the tenant's screen-limit finding on US-081 (three screens against WORK_READINESS.md hard limit 4). Cross-cutting rationale: US-081's former AC5 pools/dashboard share and the overview half of its former AC6 live here; the projection, the watermark, the producer entrypoint and the manual refresh stay in US-081 and are consumed read-only. Decisions DEC-SMP-031, DEC-SMP-041. Depends on US-081 (`Blocked By`). Nous allocation target ≈ 90 min; the tenant re-assesses independently.
- Not frontend-only: each surface includes its production query, authorization and rendered-projection verification (the gauge and tile values are asserted against the projection oracle, not against fixture strings). US-022 (origin of the PoolGauge and tiles) is not amended.
- Vertical delivery: two screen surfaces over the shared read contract, locales, verification, review, integration. No migration.

- CHG-113 / DEC-SMP-065/066: R2; no further R1 work.
