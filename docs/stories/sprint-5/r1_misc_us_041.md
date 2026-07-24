# US-041: Scoped per-company experience

> **Sprint 5** | **P0** | **2 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to see my company's complete world and nothing else so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-041 |
| Feature | FEAT-033 |
| Sprint | Sprint 5 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | all |
| Screens | SCR-company-detail, SCR-statements, SCR-my-requests |
| Server Actions | — |
| Entities | (scoped reads) |
| Business Rules | — |
| Blocked By | US-009, US-005 |

## Acceptance Criteria

- [ ] AC1: approver/company_finance/viewer reach SCR-company-detail scoped to their company (admin tabs hidden)
- [ ] AC2: Isolation asserted: cross-company URL access → access-denied; exports scoped
- [ ] AC3: Viewer role: read-only everywhere it has access

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 5 milestone: Hardening + FIRST PARALLEL CLOSE (US-052, on production): dashboards/perf fixture, scoped views, isolation suite. Go-live gate.
