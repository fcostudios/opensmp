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

- [ ] AC1: The 15-min alert-eval job (US-046) sends the approver reminder at 24h pending and the Group-Admin escalation at 48h (thresholds from AlertRule); each fires exactly once per breach (dedupe), on the first run after threshold
- [ ] AC2: Escalation email names request, company, approver; AlertEvent logged; reminder/escalation emails use the same catalogs and voice constraint as US-016
- [ ] AC3: Escalation target = SystemSetting `notif_escalation_email`

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
