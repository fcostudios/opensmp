# US-036: Statement detail + kind-aware evidence

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to verify every line to its evidence so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-036 |
| Feature | FEAT-031, FEAT-033 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-statement-detail |
| Server Actions | — |
| Entities | StatementLine (R), CostRecord (R) |
| Business Rules | — |
| Blocked By | US-050 |

## Acceptance Criteria

- [ ] AC1: Lines table with kind badges, period_from/to, mono amounts, note column (mandatory on adjustments)
- [ ] AC2: Kind-aware expander: license→register rows; usage→CostRecord table (freshness + revision caption), each row linking to a modal viewer for its stored raw API payload — completing statement→register→raw-payload (PRD §15 auditability); adjustment→note; register-row expander links back to statement lines (bidirectional with US-033)
- [ ] AC3: Scoped: company roles see own company only

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
