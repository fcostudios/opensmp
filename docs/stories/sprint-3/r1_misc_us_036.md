# US-036: Statement detail + kind-aware evidence

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to verify every line to its evidence so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-036 |
| Feature | FEAT-031, FEAT-033 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-statement-detail |
| Server Actions | — |
| Entities | StatementLine (R), CostRecord (R) |
| Business Rules | — |
| Blocked By | US-034 |

| Slice | S2 |

## Acceptance Criteria

- [ ] AC1: License lines table with period_from/to, seat-days, rate, USD amounts and notes (mandatory on adjustments); usage lines are R2.
- [ ] AC2: License-line expander traces to register assignment rows and dates; adjustment lines show notes. No CostRecord/raw API payload dependency in R1. Register-to-statement traceability reuses the built US-033 surface.
- [ ] AC3: Scoped: company roles see own company only

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S2; license-only manual path. Production acceptance belongs to finance users and the IT Director.
