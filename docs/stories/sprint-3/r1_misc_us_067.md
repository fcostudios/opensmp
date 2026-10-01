# US-067: Surface overdue invitations with configurable alerts

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to never leak seats into invite limbo so that pending invitations stop consuming seats unnoticed — this child delivers: Group Admins see only eligible unaccepted invitations older than the configured threshold, with one actionable invite_unaccepted alert per open breach.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-067 |
| Feature | FEAT-014 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S4 |
| Screens | SCR-exceptions |
| Server Actions | — |
| Entities | AlertRule (R), AlertEvent (C), ProvisioningAction (R) |
| Business Rules | BR-13 |
| Blocked By | US-019, US-042 |

## Acceptance Criteria

- [ ] AC1: The alert-eval job raises exactly one `invite_unaccepted` AlertEvent per open breach for each eligible pending invitation older than `AlertRule(type=invite_unaccepted).threshold.hours` (default 168 h); repeated evaluation deduplicates, and a disabled rule or another company's invitation never alerts.
- [ ] AC2: The breach is actionable from SCR-exceptions, showing the invitation's age and request, scoped to the viewer's company.
- [ ] AC3: Demo: evaluate invitations just below, exactly at, and above 168 hours; only the above-threshold invitation alerts, a second run adds nothing, and disabled or foreign-company rules do not alert.

## Notes

- Canonical child of **US-021** (parent AC coverage: **AC1**), minted by **CHG-063** on 2026-10-01 from the tenant's `partition_required` assessment (`docs/readiness/US-021.json`, proposal `overdue-invite-alerts`, estimate 140 min). Decision DEC-SMP-023.
- "Exactly at" 168 h does NOT alert: the rule is strictly older than the threshold (BR-13: "unaccepted > 7 days").
