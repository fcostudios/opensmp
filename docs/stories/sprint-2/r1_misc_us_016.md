# US-016: Lifecycle notifications (email)

> **Sprint 2** | **P0** | **2 SP** | **R1**

## User Story

As a End User (persona_05), I want to be notified at each transition so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-016 |
| Feature | FEAT-009 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 |
| Screens | (email) |
| Server Actions | — |
| Entities | SystemSetting (R) |
| Business Rules | — |
| Blocked By | US-012, US-003 |

## Acceptance Criteria

- [ ] AC1: Emails: submission confirmation; new-request to approver; decision to requester; provisioning-complete with getting-started note
- [ ] AC2: Sender = SystemSetting `notif_sender_email`; templates bilingual per recipient's ui_language (fallback es); templates render from the shared next-intl es-EC (tú, vocabulary lock) / en-US catalogs (US-006); approver/finance templates use the 12-chip vocabulary, no vendor jargon or API internals
- [ ] AC3: Deep links land on the scoped screen (request detail / queue card)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
