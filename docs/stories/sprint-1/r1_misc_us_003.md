# US-003: Core schema migration with DB-level register integrity

> **Sprint 1** | **P0** | **5 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to materialize the 26-entity schema so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-003 |
| Feature | FEAT-025 |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 5 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | n/a (infra) |
| Server Actions | — |
| Entities | ALL (C schema), SystemSetting (C seed) |
| Business Rules | BR-01, BR-02, BR-03, BR-28 |
| Blocked By | US-002 |
| Migration | slug=core_schema_register_integrity |

## Acceptance Criteria

- [ ] AC1: Drizzle schema for all 26 entities of `04_er_model.md`; migration applies clean
- [ ] AC2: Raw-SQL migration adds: `btree_gist` + EXCLUDE no-overlap constraint on LicenseAssignment; deferred transfer-contiguity trigger; partial UNIQUE on ReclamationProposal(assignment_id) WHERE pending; UNIQUE source_request_id; REVOKE DELETE on all core tables + column-level UPDATE grants on append-only tables (BR-28 lists)
- [ ] AC3: App DB role has NO UPDATE/DELETE grants on AuditLog (append-only proven by a failing test)
- [ ] AC4: Integrity tests: overlapping assignment rejected; audit UPDATE rejected; illegal-column UPDATE and DELETE attempts rejected per append-only table (DEC-SMP-009/BR-28)
- [ ] AC5: Migration seeds SystemSetting defaults: notif_sender_email, notif_escalation_email, default_language

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
