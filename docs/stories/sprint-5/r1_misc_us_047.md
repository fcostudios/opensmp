# US-047: Company-isolation test suite

> **Sprint 5** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to prove scoping on every company-owned table so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-047 |
| Feature | FEAT-003 |
| Sprint | Sprint 5 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | (tests) |
| Server Actions | — |
| Entities | — |
| Business Rules | BR-02, BR-18, BR-22 |
| Blocked By | US-041, US-034 |

| Slice | S4 |

## Acceptance Criteria

- [ ] AC1: Automated tests: every company-owned entity query path rejects cross-company access per role
- [ ] AC2: Register integrity tests from US-003 extended: transfer contiguity, close-run determinism
- [ ] AC3: Suite runs in CI; failures block merge

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S4; license-only manual path. Production acceptance belongs to finance users and the IT Director.
