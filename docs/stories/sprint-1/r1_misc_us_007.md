# US-007: Seed: companies CSV + go-live register backfill

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to load the 30 companies and current seat holders so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-007 |
| Feature | FEAT-001 |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | SCR-companies |
| Server Actions | importCompaniesCsv |
| Entities | Company (C), LicenseAssignment (C), LicenseRequest (C system), Vendor (C seed: Anthropic), VendorAccount (C seed per org inventory OQ-SMP-1), LicenseType (C seed: Claude tiers), IntegrationCredential (C per org), VendorAccountCapacity (C seed) |
| Business Rules | — |
| Blocked By | US-003 |
| Migration | slug=seed_companies_capacity_backfill |

## Acceptance Criteria

- [ ] AC1: `importCompaniesCsv` seeds 30 companies (code, approver, finance contact, budget, statement_language)
- [ ] AC2: Backfill imports current Anthropic members as LicenseAssignment rows (source_kind=import) each with a system-materialized LicenseRequest (state=active, justification 'importación inicial') per 04 lifecycle
- [ ] AC3: Register passes integrity constraints post-backfill; counts reconcile with the console lists
- [ ] AC4: Seeds one effective-dated VendorAccountCapacity row per (org, license type) at go-live, purchased counts reconciled with the console

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
