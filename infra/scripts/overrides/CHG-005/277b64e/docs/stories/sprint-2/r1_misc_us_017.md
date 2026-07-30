# US-017: Approval aging: reminder + escalation job

> **Sprint 2** | **P0** | **2 SP** | **R1**

## User Story

As a Company Approver (persona_02), I want to get nudged before I block my company so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-017 |
| Feature | FEAT-010 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S2 |
| Screens | (email), SCR-alerts |
| Server Actions | — |
| Entities | AlertEvent (C) |
| Business Rules | BR-08 |
| Blocked By | US-015, US-042, US-046 |

## Acceptance Criteria

- [ ] AC1: The 15-min alert-eval job (US-046) evaluates the approver reminder at 24h pending and the Group-Admin escalation at 48h (thresholds from AlertRule), on the first run after each threshold. Concurrent workers create exactly one AlertEvent/delivery stream per breach stage. SMTP delivery is at-least-once across an SMTP-success/DB-crash ambiguity and uses a stable Message-ID so the provider can deduplicate retries; it is not falsely described as exactly-once.
- [ ] AC2: Escalation email names request, company, approver; AlertEvent logged; reminder/escalation emails use the same catalogs and voice constraint as US-016
- [ ] AC3: Escalation target = SystemSetting `notif_escalation_email`

## Notes

- AC1 is reconciled by CHG-005 with the actual SMTP/outbox crash semantics; edit the canonical source and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
