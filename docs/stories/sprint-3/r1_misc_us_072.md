# US-072: Usage surface: lag-aware inactivity per person on SCR-usage

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to see 30/60/90-day inactivity per company so that reclamation candidates are visible — this child delivers: SCR-usage (`/uso`) lists per-person last activity and days inactive for my companies against a lag-aware data-through date, with company and 30/60/90 filters, active/flagged/no-data metric cards, window and state badges and the ~3-day freshness banner, gated to group_admin and isolated by company.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-072 |
| Feature | FEAT-021 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-usage |
| Server Actions | — |
| Entities | ActivityRecord (R), LicenseAssignment (R), LicenseRequest (R), Person (R), VendorAccount (R) |
| Business Rules | BR-16 |
| Blocked By | US-026 |

## Acceptance Criteria

- [ ] AC1: SCR-usage (`/uso`) lists, for the viewer's companies only, each person's last activity date and days inactive, with company and 30/60/90-day window filters, active/flagged/no-data metric cards and per-person window and state badges; a non-group_admin role is refused.
- [ ] AC2: Days inactive = `data_through − last activity_date`, where `data_through` is the latest synced `activity_date` of the person's vendor account, falling back to the evaluation date minus 3 days when the account has never synced (DEC-SMP-026); one pure domain function owns the window and lag math and is the one US-074 reuses; the ~3-day freshness banner names `data_through`.
- [ ] AC3: A person whose last activity is on the last synced day shows 0 days inactive, not 3; a person with no activity counts as no data, never as inactive; changing the window filter changes the badge set and the metric cards.
- [ ] AC4: Demo: seed two companies with activity at varied ages and a vendor account synced three days ago; `/uso` as group_admin lists only own-company people with the right days-inactive values, the 30/60/90 filter moves people between badges and cards, no-activity people show no data, and a non-group_admin role is refused.

## Notes

- Canonical child of **US-027** (parent AC coverage: **AC1** read side — filters, metric cards, last-active and badges; **AC2** display side — the lag applied to the shown windows), minted by **CHG-071** on 2026-10-07 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-027.json`, proposal `usage-surface`, estimate 260 min). Decisions DEC-SMP-026/027/028. **This is the CHG-070 session-shape experiment child.**
- Owns the shared lag-aware inactivity function (window + `data_through` math) that US-073 reads from and US-074 applies to the state flag. The batch "Proponer reclamación" action is US-073; the flag itself is US-074; approve/dismiss, dismissal suppression, `flagged_inactive → offboarding` and `/reclamaciones` stay with US-028.
- The two existing inactive-candidate queries (`pool-repository.ts:97`, `read-repository.ts:401`) keep their wall-clock evaluation dates; the divergence is recorded as a deviation for a follow-up, not fixed here.
- No schema migration; `/uso` is already in the nav map.
