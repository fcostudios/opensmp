# US-001: Scaffold the monorepo and app skeleton

> **Sprint 1** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to have the codebase structure in place so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-001 |
| Feature | — |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | n/a (infra) |
| Server Actions | — |
| Entities | — |
| Business Rules | — |
| Blocked By | — |

## Acceptance Criteria

- [ ] AC1: Turborepo with `apps/web` (Next.js App Router, TS) + `packages/db` (Drizzle), `packages/contracts` (zod), `packages/ui`, `packages/config`
- [ ] AC2: pnpm workspaces; `turbo.json` build/dev/type-check/lint/test tasks green on empty app
- [ ] AC3: Tailwind CSS 4 configured with the corporativo. token layer stub (DEC-SMP-005)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
