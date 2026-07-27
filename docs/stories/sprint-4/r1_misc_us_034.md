# US-034: Monthly close job + CloseRun

> **Sprint 4** | **P0** | **5 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to generate per-company draft statements by business day 3 so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-034 |
| Feature | FEAT-027 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 5 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close |
| Server Actions | runClose |
| Entities | CloseRun (CU), Statement (C), StatementLine (C) |
| Business Rules | BR-02, BR-17, BR-18 |
| Blocked By | US-032, US-033 |

## Acceptance Criteria

- [ ] AC1: `runClose` writes CloseRun (running→succeeded/failed, note) then per-company Statement + StatementLines: license lines from register seat-days × effective rates (daily actual/actual proration, mid-month splits with period_from/to); oracle test (PRD §11 Module E): a transfer effective the 10th yields a company-A line with period_to = the 9th and a company-B line with period_from = the 10th, zero gap/overlap in seat-days, and the person appears on both statements with dates
- [ ] AC2: Idempotent per period: re-run recalculates drafts, never touches finals; duration surfaced (<5 min NFR)
- [ ] AC3: Statements stamped close_run_id

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
