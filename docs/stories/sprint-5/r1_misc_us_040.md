# US-040: Cross-company admin dashboard

> **Sprint 5** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to see pools, states, inactivity and alerts at a glance so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-040 |
| Feature | FEAT-032 |
| Sprint | Sprint 5 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-admin-dashboard |
| Server Actions | — |
| Entities | (aggregates R) |
| Business Rules | — |
| Blocked By | US-022, US-042 |

## Acceptance Criteria

- [ ] AC1: Tiles: purchased/assigned/pending/free (cross-org), in-flight by state, inactive 30+, unacked alerts — each tile navigates
- [ ] AC2: Recent requests table (all companies) + staleness banner when any sync >48h
- [ ] AC3: Numbers match their source screens (pool math, alert counts)
- [ ] AC4: Perf fixture in CI (50 companies, ~1,000 people, 2 years of daily ActivityRecord/CostRecord rows); SCR-admin-dashboard server-renders < 3 s against it (PRD §15); fixture reused for SCR-pools/SCR-usage aggregates

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 5 milestone: Hardening + FIRST PARALLEL CLOSE (US-052, on production): dashboards/perf fixture, scoped views, isolation suite. Go-live gate.
