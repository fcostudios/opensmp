# US-052: Execute the first parallel close on real data

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to run the first real monthly close beside the manual process so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-052 |
| Feature | FEAT-027, FEAT-029 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close, SCR-reconciliation |
| Server Actions | — |
| Entities | CloseRun (C), Reconciliation (CU), ReconciliationVarianceLine (C) |
| Business Rules | — |
| Blocked By | US-034, US-038, US-053, US-094 |

| Slice | S2 |

| Gated By | OQ-SMP-1 (soft: real member export and pilot inventory; owner=Francisco), OQ-SMP-4 (soft: contracted rate and real vendor invoice; owner=Central Finance) |

| Manual Fallback | Manual register entry and a provisional rate; provisional evidence enables development and rehearsal, but never passes the real-data run or H2 reconciliation acceptance. |

## Acceptance Criteria

- [ ] AC1: On production (US-053), run the most recently completed calendar month with the real contracted rate and US-094 register backfill, corrected through US-095. No US-026 analytics or US-050 usage dependency.
- [ ] AC2: Per-company statements compared against the manual spreadsheet via the US-038 workbench; every variance triaged into ReconciliationVarianceLines or a bugfix under an existing story
- [ ] AC3: Enter the real invoice for that month; reconciliation reaches reconciled within 0.5%, or overridden with every variance explained. Record bd-3 timing and Company Finance acceptance for five pilots. An override is not a pass of H2; H2 remains pending/failed unless the real-invoice tolerance and finance acceptance hold.

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S2; license-only manual path. Production acceptance belongs to finance users and the IT Director.
