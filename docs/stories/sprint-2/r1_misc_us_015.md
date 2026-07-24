# US-015: Approval queue: one-minute decisions

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Company Approver (persona_02), I want to approve or reject with full context inline so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-015 |
| Feature | FEAT-007, FEAT-008 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S2 |
| Screens | SCR-approval-queue, SCR-request-detail |
| Server Actions | decideRequest |
| Entities | LicenseRequest (U), RequestTransition (C) |
| Business Rules | BR-07, BR-08 |
| Blocked By | US-014 |

## Acceptance Criteria

- [ ] AC1: QueueCards show requester, company, type/org, justificación, needed-by, cost impact (RateCard; 'sin tarifa' placeholder when absent), budget headroom, aging chip (breach state at > 2 business days pending per PRD §10 decision target; business-day calendar)
- [ ] AC2: Aprobar inline; Rechazar requires comment (modal); decision recorded (decided_by/at/comment) + notifications
- [ ] AC3: Group Admin sees all companies and can decide any request (override, audit-logged)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
