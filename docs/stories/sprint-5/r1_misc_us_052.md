# US-052: Execute the first parallel close on real data

> **Sprint 5** | **P0** | **3 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to run the first real monthly close beside the manual process so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-052 |
| Feature | FEAT-027, FEAT-029 |
| Sprint | Sprint 5 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close, SCR-reconciliation |
| Server Actions | — |
| Entities | CloseRun (C), Reconciliation (CU), ReconciliationVarianceLine (C) |
| Business Rules | — |
| Blocked By | US-034, US-038, US-050, US-053 |

## Acceptance Criteria

- [ ] AC1: Close runs for the most recently completed calendar month (calendar anchor per 10_plan SEC1) with contracted rates (OQ-SMP-4) against the US-007 backfill + US-026 synced data, in the production environment (US-053)
- [ ] AC2: Per-company statements compared against the manual spreadsheet via the US-038 workbench; every variance triaged into ReconciliationVarianceLines or a bugfix under an existing story
- [ ] AC3: Invoice amount entered; reconciliation reaches reconciled/overridden; G3 metric (statements bd-3) measured and recorded

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 5 milestone: Hardening + FIRST PARALLEL CLOSE (US-052, on production): dashboards/perf fixture, scoped views, isolation suite. Go-live gate.
