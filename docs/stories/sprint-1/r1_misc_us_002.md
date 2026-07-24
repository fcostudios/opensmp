# US-002: Docker Compose runtime + CI pipeline

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to run app + Postgres + worker locally and in CI so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-002 |
| Feature | — |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | n/a (infra) |
| Server Actions | — |
| Entities | — |
| Business Rules | — |
| Blocked By | US-001 |

## Acceptance Criteria

- [ ] AC1: `docker compose up` boots app + Postgres + worker; healthchecks pass
- [ ] AC2: CI runs type-check/lint/test + `drizzle-kit` migration apply against a throwaway DB
- [ ] AC3: Nightly encrypted backup job stub with restore command documented

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
