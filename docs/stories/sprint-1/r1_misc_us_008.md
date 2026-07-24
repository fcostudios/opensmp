# US-008: Immutable audit trail + viewer

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to see who did what with before/after so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-008 |
| Feature | FEAT-038 |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | all |
| Screens | SCR-audit |
| Server Actions | — |
| Entities | AuditLog (C/R) |
| Business Rules | BR-03 |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: Every server action writes AuditLog (actor, action, entity, before/after jsonb, note when supplied)
- [ ] AC2: SCR-audit: filterable table + diff modal incl. the actor `note` field
- [ ] AC3: Append-only verified (grants from US-003); company scope hint populated where derivable

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
