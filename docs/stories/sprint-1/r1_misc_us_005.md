# US-005: Server-side RBAC + company scoping middleware

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to enforce role and company scope on every query so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-005 |
| Feature | FEAT-003, FEAT-036 |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | all scoped screens |
| Server Actions | — |
| Entities | CompanyRoleAssignment (R) |
| Business Rules | BR-22 |
| Blocked By | US-004 |

## Acceptance Criteria

- [ ] AC1: Middleware resolves permitted company_id set from CompanyRoleAssignment + global_role on every data access
- [ ] AC2: 5 platform roles + employee requester enforced; viewer = read-only company scope
- [ ] AC3: Route guards match `07c_navigation_map.json` role_based_views exactly

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
