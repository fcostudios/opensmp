# US-044: Operational settings

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to tune thresholds and notification identity so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-044 |
| Feature | FEAT-044 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-settings |
| Server Actions | saveAlertRules, saveNotificationSettings, saveSystemSettings |
| Entities | AlertRule (U), SystemSetting (CU) |
| Business Rules | — |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: `saveAlertRules` edits per-type enabled/thresholds (aging 24/48h, floor default, invite 7d + auto-withdraw window, staleness 48h)
- [ ] AC2: `saveNotificationSettings`/`saveSystemSettings` persist SystemSetting keys (sender, escalation, default_language); every save audit-logged with before/after
- [ ] AC3: Per-org floor override lives on VendorAccount (linked from settings)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
