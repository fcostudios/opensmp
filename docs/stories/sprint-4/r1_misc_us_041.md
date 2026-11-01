# US-041: Scoped per-company experience

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Company Finance (persona_03), I want to see my company's complete world and nothing else so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-041 |
| Feature | FEAT-033 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | all |
| Screens | SCR-company-detail, SCR-statements, SCR-my-requests |
| Server Actions | — |
| Entities | (scoped reads) |
| Business Rules | — |
| Blocked By | US-005, US-036, US-096 |

| Slice | S3 |

## Acceptance Criteria

- [ ] AC1: Company Finance, approver and viewer reach only their company statements and register evidence through SCR-statements / SCR-statement-detail; hide admin controls. Company CRUD and SCR-company-detail remain R2.
- [ ] AC2: Isolation asserted: cross-company URL access → access-denied; exports scoped
- [ ] AC3: Viewer role: read-only everywhere it has access

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S3; license-only manual path. Production acceptance belongs to finance users and the IT Director.
