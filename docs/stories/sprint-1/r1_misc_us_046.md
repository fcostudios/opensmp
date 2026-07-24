# US-046: Job runner + schedules

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to run all periodic work reliably so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-046 |
| Feature | — |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | (worker) |
| Server Actions | — |
| Entities | — |
| Business Rules | BR-08, BR-27 |
| Blocked By | US-002 |

## Acceptance Criteria

- [ ] AC1: pg-boss (Postgres-only) with schedules: analytics daily, member sync hourly, invite polling 15min, alert eval 15min (incl. aging reminders/escalations + missed-run watchdogs, ADR-04/BR-08/BR-27), close monthly bd-3
- [ ] AC2: Every job idempotent + re-runnable; failure → credential_failure/sync_stale alert path; no silent death
- [ ] AC3: Job runs visible in logs with duration

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
