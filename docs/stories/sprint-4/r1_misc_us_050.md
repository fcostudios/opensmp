# US-050: Close usage lines from CostRecord via the register

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to charge metered usage to the right company so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-050 |
| Feature | FEAT-027 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-statement-detail |
| Server Actions | — |
| Entities | StatementLine (C usage), CostRecord (R) |
| Business Rules | BR-18 |
| Blocked By | US-034, US-026 |

## Acceptance Criteria

- [ ] AC1: Close adds kind=usage StatementLines from CostRecord mapped through register attribution (person→company at cost_date); amounts snapshot at close (30-day vendor revisions surface in Reconciliation, never mutate finals)
- [ ] AC2: Companies with no usage get no usage lines; unmatched CostRecords surface as close warnings
- [ ] AC3: Idempotent with US-034's recalc semantics (drafts only)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
