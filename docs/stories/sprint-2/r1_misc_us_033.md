# US-033: The register surface + export

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to inspect and export the attribution truth so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-033 |
| Feature | FEAT-025, FEAT-031 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-register |
| Server Actions | exportRegisterCsv |
| Entities | LicenseAssignment (R) |
| Business Rules | — |
| Blocked By | US-007 |

## Acceptance Criteria

- [ ] AC1: SCR-register: filters, open/closed rows, end_reason chips, source links (request_no), note for import/reconciliation rows
- [ ] AC2: Row expander: source request trace
- [ ] AC3: `exportRegisterCsv` respects filters; integrity banner states the DB-level guarantees

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
