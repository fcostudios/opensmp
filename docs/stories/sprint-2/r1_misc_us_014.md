# US-014: Lifecycle state machine engine

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to have one legal-transition engine for the 12 states so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-014 |
| Feature | FEAT-040 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1/J2 |
| Screens | (engine) |
| Server Actions | — |
| Entities | LicenseRequest (U), RequestTransition (C) |
| Business Rules | BR-04 |
| Blocked By | US-003 |

## Acceptance Criteria

- [ ] AC1: Transition function enforces the §10 graph (incl. provisioning→failed→provisioning retry); illegal transitions rejected + tested
- [ ] AC2: Every transition persists RequestTransition (from/to/actor/note/occurred_at) + AuditLog
- [ ] AC3: SLA timers derivable: submitted_at, pending_since for aging (US-017)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
