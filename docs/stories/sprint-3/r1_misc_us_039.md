# US-039: Consolidated rollup + export

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to see and export the group total so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-039 |
| Feature | FEAT-028, FEAT-030 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close |
| Server Actions | exportRollupCsv, exportRollupPdf |
| Entities | Statement (R aggregate) |
| Business Rules | — |
| Blocked By | US-034, US-096 |

| Slice | S2 |

## Acceptance Criteria

- [ ] AC1: Group-total tile on SCR-close reuses US-096 SUM Statement.total_usd for the selected period.
- [ ] AC2: exportRollupCsv consolidates the five pilot company statements with company, period and USD totals. Consolidated PDF is R2.
- [ ] AC3: Rollup ties to reconciliation totals (same period source)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S2; license-only manual path. Production acceptance belongs to finance users and the IT Director.
