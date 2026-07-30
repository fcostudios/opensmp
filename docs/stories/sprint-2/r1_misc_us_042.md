# US-042: Alert engine: 10 P0 types

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to get email alerts for every failure class so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-042 |
| Feature | FEAT-034 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (jobs), SCR-alerts |
| Server Actions | — |
| Entities | AlertRule (C seed/R), AlertEvent (C) |
| Business Rules | BR-14 |
| Blocked By | US-046, US-003 |

## Acceptance Criteria

- [ ] AC1: AlertRule seed: approval_aging, provisioning_failure, blocked_no_seat, low_pool, invite_unaccepted, sync_stale, credential_failure, register_drift, deprovision_overdue, close_missed (enabled, thresholds)
- [ ] AC2: 15-min evaluation job fires AlertEvent + email (sender from SystemSetting); `dedupe_key = alert_rule_id + alert stage + stable subject identity + breach-window start` is UNIQUE, and retries use insert-on-conflict/no-op so each breach stage fires once
- [ ] AC3: subject_ref carries the target for per-type link dispatch

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
