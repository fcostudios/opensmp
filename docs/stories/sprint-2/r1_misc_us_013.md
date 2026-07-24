# US-013: My requests + request detail record

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a End User (persona_05), I want to track my request's state without chasing so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-013 |
| Feature | FEAT-045 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 |
| Screens | SCR-my-requests, SCR-request-detail |
| Server Actions | — |
| Entities | LicenseRequest (R), RequestTransition (R) |
| Business Rules | — |
| Blocked By | US-012 |

## Acceptance Criteria

- [ ] AC1: SCR-my-requests scoped list with 12-chip states; SCR-request-detail record with metric cards, conditional callouts (Blocked/Failed), tabs (Acciones/Asignación/Auditoría)
- [ ] AC2: State timeline renders every RequestTransition with actor + note
- [ ] AC3: Blocked callout shows requester copy + group_admin 'Ver cupos' action

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
