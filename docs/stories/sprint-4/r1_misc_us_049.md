# US-049: Statement PDF brand template

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to receive a document that looks official so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-049 |
| Feature | FEAT-030 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | (pdf) |
| Server Actions | — |
| Entities | Statement (R) |
| Business Rules | BR-19 |
| Blocked By | US-003 |

## Acceptance Criteria

- [ ] AC1: PDF layout: corporativo. lockup, Barlow, condensed uppercase header, mono numerals, es/en variants
- [ ] AC2: Renders joiners/leavers with dates, line notes, totals; matches SCR-statement-detail data exactly
- [ ] AC3: Golden-file test against a fixture statement

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
