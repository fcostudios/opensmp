# US-069: Expire stale invitations automatically and notify the requester

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to never leak seats into invite limbo so that invitations nobody acts on are reclaimed without manual work — this child delivers: the scheduled hygiene job withdraws eligible pending invitations after an explicitly enabled, configurable expiry window, releases the seat reservation and re-notifies the requester exactly once with a durable action trail.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-069 |
| Feature | FEAT-014 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S4 |
| Screens | SCR-request-detail (worker-driven) |
| Server Actions | — |
| Entities | AlertRule (R), ProvisioningAction (CU), LicenseRequest (U) |
| Business Rules | BR-13 |
| Blocked By | US-019, US-042, US-068 |

## Acceptance Criteria

- [ ] AC1: Configuration contract (DEC-SMP-023): the window is `AlertRule(type=invite_unaccepted).threshold.auto_withdraw_after_hours`; `null` (the default) means automatic expiry is DISABLED; a set value must be an integer strictly greater than `threshold.hours`, and an invalid value is rejected by a shared validator (reused by US-044 `saveAlertRules`) and never treated as enabled.
- [ ] AC2: When enabled, the scheduled hygiene job withdraws each eligible pending invitation older than the window through US-068's invitation-only service, releases the seat reservation and re-notifies the requester exactly once; accepted, foreign-company, disabled-rule and not-yet-due invitations remain untouched.
- [ ] AC3: Each automatic withdrawal is a durable ProvisioningAction visible in the request's Acciones trail, attributed to the system job.
- [ ] AC4: Demo: configure the window, advance an injected clock, run the job twice and verify one invitation-only deletion, one lifecycle transition, one requester notification and one visible action; with the window unset nothing is withdrawn.

## Notes

- Canonical child of **US-021** (parent AC coverage: **AC2** scheduled trigger, **AC3** automatic trail), minted by **CHG-063** on 2026-10-01 from the tenant's `partition_required` assessment (`docs/readiness/US-021.json`, proposal `automatic-invite-expiry`, estimate 280 min). Decision DEC-SMP-023.
- US-044 (Sprint 4) owns the `saveAlertRules` editing UI; until it lands, the window is set through the AlertRule seed/record. This child does not depend on US-044.
