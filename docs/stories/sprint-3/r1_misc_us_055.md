# US-055: API-less ingestion: member/usage CSV import + manual register upkeep

> **Sprint 3** | **P1** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to keep the register and usage data true for orgs without API access so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-055 |
| Feature | FEAT-046 |
| Sprint | Sprint 3 |
| Priority | P1 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-vendor-account-detail |
| Server Actions | importMembersCsv, importUsageCsv |
| Entities | LicenseAssignment (CU), LicenseRequest (C system), ActivityRecord (CU), CostRecord (CU), VendorAccount (U ingestion_mode), AlertEvent (C) |
| Business Rules | — |
| Blocked By | US-003, US-025, US-026, US-030 |
| Migration | slug=apiless_ingestion |

## Acceptance Criteria

- [ ] AC1: `importMembersCsv` (SCR-vendor-account-detail) parses a Console member-list export and runs the US-030 diff: verifies checklist-confirmed provisions, opens/closes LicenseAssignment rows it evidences, flags unknown members as register_drift — identical states + audit as the API member sync
- [ ] AC2: `importUsageCsv` parses Console usage/cost exports and upserts ActivityRecord/CostRecord (source=csv_import) with the US-026 idempotent semantics; unmatched identities surfaced as warnings
- [ ] AC3: On ingestion_mode=manual orgs the admin can record/close a LicenseAssignment directly (source_kind=manual, note required) — DB-level register integrity (US-003) and audit (US-008) apply unchanged
- [ ] AC4: Ingestion mode is configured per org on SCR-vendor-account-detail (Configuración); non-api orgs surface freshness from the last import/manual entry, and sync_stale alerting (US-029) keys on the same synced_at

## Notes

- ACs are copied verbatim from `08_scope.md` (DEC-SMP-018 amendment, 2026-07-26) — the scope is the single source; edit there and regenerate.
- Migration slug applies only if the core schema migration (US-003, slug=core_schema_register_integrity) already shipped without the DEC-SMP-018 columns (`VendorAccount.ingestion_mode`, `ActivityRecord.source`, `CostRecord.source`, `LicenseAssignment.source_kind` incl. `manual`); if US-003 lands after this amendment, the columns ride in the regenerated `packages/db` schema and no separate migration is needed.
- Sprint 3 milestone: Automation + monitoring: connector live, invite≤15min, hygiene, reclamation, drift, API-less ingestion (CSV import + manual upkeep, DEC-SMP-018).
