# US-039: Consolidated rollup + export

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to see and export the group total so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-039 |
| Feature | FEAT-028, FEAT-030 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close |
| Server Actions | exportRollupCsv, exportRollupPdf |
| Entities | Statement (R aggregate) |
| Business Rules | — |
| Blocked By | US-050 |

## Acceptance Criteria

- [ ] AC1: Group-total tile on SCR-close (SUM Statement.total_usd for period)
- [ ] AC2: `exportRollupCsv`/`Pdf`: consolidated rollup across all companies
- [ ] AC3: Rollup ties to reconciliation totals (same period source)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
