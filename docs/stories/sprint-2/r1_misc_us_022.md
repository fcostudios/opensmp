# US-022: Per-org pool tracking + low-pool alert

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to see purchased/assigned/pending/free per org so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-022 |
| Feature | FEAT-015, FEAT-016 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-pools, SCR-admin-dashboard, SCR-vendor-account-detail |
| Server Actions | — |
| Entities | VendorAccountCapacity (R), AlertEvent (C) |
| Business Rules | BR-10, BR-11 |
| Blocked By | US-007, US-042 |

## Acceptance Criteria

- [ ] AC1: Free = latest VendorAccountCapacity − open assignments − pending invites, per (org, license type); PoolGauge on SCR-pools + dashboard tiles (works on seeded capacity + backfilled register before automation exists — the pending-invite term is simply zero until US-019)
- [ ] AC2: Below `low_pool_floor` → low_pool alert + attention state
- [ ] AC3: Cross-org moves render as two operations (never a silent transfer)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
