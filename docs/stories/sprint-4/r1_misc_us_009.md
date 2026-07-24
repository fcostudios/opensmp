# US-009: Company registry CRUD + company record

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to manage companies and their configuration so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-009 |
| Feature | FEAT-001, FEAT-033 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | SCR-companies, SCR-company-detail |
| Server Actions | createCompany, updateCompany |
| Entities | Company (CRU) |
| Business Rules | — |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: Create/edit company (code unique, type, status, budget, finance contact, statement_language es/en)
- [ ] AC2: SCR-company-detail tabs; admin tabs (Roles/Configuración) gated group_admin; company roles see their own company read-scoped (Module F P0)
- [ ] AC3: Deactivating a company blocks new requests but preserves history

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
