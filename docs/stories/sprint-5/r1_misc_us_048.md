# US-048: Ops runbooks + backup/restore drill

> **Sprint 5** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to operate the three critical procedures so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-048 |
| Feature | — |
| Sprint | Sprint 5 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | docs |
| Server Actions | — |
| Entities | — |
| Business Rules | — |
| Blocked By | US-002, US-053 |

| Slice | S4 |

## Acceptance Criteria

- [ ] AC1: Runbooks cover manual register upkeep, Docker/Compose-secret rotation per ADR-13, encrypted backup-key retrieval and restore, and Keycloak outage recovery by restarting or restoring Keycloak (break-glass is R2, FEAT-R2-13, DEC-SMP-067). No managed credentials UI dependency.
- [ ] AC2: Nightly encrypted backup verified by an actual restore drill pre-go-live
- [ ] AC3: Runbooks are accessible from the deployed operations documentation; IT Director completes the recovery journey without needing SCR-credentials.

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S4; license-only manual path. Production acceptance belongs to finance users and the IT Director.
