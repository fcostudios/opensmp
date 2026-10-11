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
- **CHG-068 / DEC-SMP-025:** unconfigured VendorAccounts default to `manual` ingestion (append-only backfill delivered by US-070) and `api` is enabled explicitly per account; the CSV import and manual-entry flows here reuse the source-aware persistence entrypoint and the identity/warning contract US-070 establishes (US-071 for costs).
- **CHG-075 (2026-10-11):** the US-030 diff this story's AC1 runs is the shared complete-snapshot entrypoint delivered by **US-078** (packages, source-aware, no UI dependency); this story wires `importMembersCsv` to it on every successful import for csv_import/manual accounts and keeps its own integrated import proof — it implements no second drift algorithm, and drift episodes, `register_drift` alerts and the Deriva tab are US-078's. Unknown members in an import become DriftEpisode rows; the claim stays with US-079 (DEC-SMP-034, DEC-SMP-035).
- **CHG-077 (2026-10-11):** the member CSV is parsed into US-083's normalized member record (provider ref when the export carries one, nullable e-mail, invited vs member, seat evidence per the vendor's declared capability, license via `LicenseType.provider_ref` or the account's `default_license_type_id`) and submitted through `acceptMemberObservation(source = csv_import, observed_at = export timestamp supplied by the admin, default upload time)` — stale/conflict rules apply (DEC-SMP-044) — before US-078's diff runs. **AC4's Configuración form also carries `VendorAccount.default_license_type_id`**, required before `api` is enabled for a vendor declaring no per-member license identity (DEC-SMP-043); that field is this story's only scope addition from CHG-077.
- **CHG-076 / DEC-SMP-041:** a successful complete `importMembersCsv` also stamps the account's capacity-refresh watermark through US-081's `recordAcceptedMemberSnapshot` (`source = csv_import`); a single manual register entry (AC3) never stamps it — the explicit "Confirmar cupos actuales" refresh is US-081's.
