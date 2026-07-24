# US-035: Statement finalization

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to flip drafts to immutable finals so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-035 |
| Feature | FEAT-027 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close, SCR-statement-detail |
| Server Actions | finalizeStatements, finalizeStatement |
| Entities | Statement (U status) |
| Business Rules | BR-18 |
| Blocked By | US-050 |

## Acceptance Criteria

- [ ] AC1: `finalizeStatements` (period) + `finalizeStatement` (single) with confirm; finals immutable (adjustments = new lines next draft)
- [ ] AC2: Locks consumed RateCard rows; status chips update across screens
- [ ] AC3: Only central_finance/group_admin may finalize

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
