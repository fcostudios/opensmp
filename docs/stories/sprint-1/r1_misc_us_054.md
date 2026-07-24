# US-054: Anthropic API probe spike

> **Sprint 1** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to probe the real APIs with real per-org keys in week 1 so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-054 |
| Feature | — |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | n/a |
| Server Actions | — |
| Entities | — |
| Business Rules | — |
| Blocked By | — |

## Acceptance Criteria

- [ ] AC1: With the OQ-SMP-1 keys: invite dry-run/member-list/analytics/cost-report calls executed per org; payload shapes, rate-limit and beta-header behavior captured
- [ ] AC2: Findings diffed against US-018 AC1 / US-026 assumptions; deltas filed as scope notes before Sprint 3 planning

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
