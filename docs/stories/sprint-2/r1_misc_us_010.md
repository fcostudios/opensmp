# US-010: Person records + edit + auto-create on request

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to keep people accurate (email is the vendor identity key) so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-010 |
| Feature | FEAT-002 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S1 |
| Screens | SCR-people, SCR-person-detail |
| Server Actions | createPerson, updatePerson |
| Entities | Person (CRU) |
| Business Rules | — |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: Create person; edit full_name/email/company/status ('Salió del grupo') via modal with company-move warning (closes register rows, fast-track re-request)
- [ ] AC2: Auto-create person on request submission when email is new (J1 S1)
- [ ] AC3: Person detail shows assignment history (register rows), recent activity, last-active freshness

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
