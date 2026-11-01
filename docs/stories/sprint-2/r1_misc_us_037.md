# US-037: Statement exports (CSV/PDF, per-company language)

> **Sprint 2** | **P0** | **2 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to hand my finance team a defensible document so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-037 |
| Feature | FEAT-030 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-statement-detail |
| Server Actions | exportStatementCsv, exportStatementPdf |
| Entities | Statement (R) |
| Business Rules | BR-19 |
| Blocked By | US-034, US-096 |

| Slice | S1 |

## Acceptance Criteria

- [ ] AC1: S1: exportStatementCsv per draft/final statement from the statements list (US-096), scoped by company and using localized labels. S3: exportStatementPdf in Company.statement_language (DEC-SMP-011) using US-049 and US-036; the CSV half does not wait on PDF/detail.
- [ ] AC2: S3 PDF footer: period, generated stamp and integrity note; PDF half depends on US-036 and US-049.
- [ ] AC3: Exports audit-logged

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S1; license-only manual path. Production acceptance belongs to finance users and the IT Director. 2 SP total: S1 CSV 1 SP; S3 PDF 1 SP. S3 PDF additionally waits on US-036 and US-049; keep whole-story verification pending until then.
