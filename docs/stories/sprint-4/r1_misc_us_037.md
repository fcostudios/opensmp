# US-037: Statement exports (CSV/PDF, per-company language)

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to hand my finance team a defensible document so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-037 |
| Feature | FEAT-030 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-statement-detail |
| Server Actions | exportStatementCsv, exportStatementPdf |
| Entities | Statement (R) |
| Business Rules | BR-19 |
| Blocked By | US-036, US-049 |

## Acceptance Criteria

- [ ] AC1: `exportStatementCsv`/`Pdf` per statement; PDF in Company.statement_language (DEC-SMP-011) using the US-049 brand template
- [ ] AC2: PDF footer: period, generated stamp, integrity note
- [ ] AC3: Exports audit-logged

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
