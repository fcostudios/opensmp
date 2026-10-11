# US-078: Detect shared member drift and list it on the Deriva tab

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to catch console bypass within an hour so that the register stays the truth — this child delivers: one shared, source-aware complete-member-snapshot diff in packages, durable deduplicated drift episodes with durable identity warnings, `register_drift` alerts about member episodes through the existing outbox, real hourly production execution for API-opted-in accounts only, and the authorized Deriva listing and count on the existing exceptions screen.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-078 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-exceptions, (jobs) |
| Server Actions | — |
| Entities | DriftEpisode (CU), AlertEvent (C), ConnectorCallObservation (C), LicenseAssignment (R), VendorAccount (R), Person (R) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042 |
| Migration | slug=drift_episodes |

## Acceptance Criteria

- [ ] AC1: One shared complete-snapshot diff lives in packages (no UI module dependency) and is the single entrypoint for `api`, `csv_import` and `manual` snapshots. An unknown member is an active, licensed console member of a validated COMPLETE snapshot with no open LicenseAssignment for the same normalized identity, vendor account and license type at the observation date, evaluated after the existing confirmed-provision verification; pending invitations are never seats; a member with no Person stays unassigned drift; detection never creates an assignment, never infers a company from an email domain, and turns ambiguous or null-email identities into durable warnings rather than guessed matches (DEC-SMP-034). It reuses the US-070/US-071 ingestion identity, timestamp, provenance and warning patterns.
- [ ] AC2: Drift is persisted as DriftEpisode rows: one open episode per (vendor account, member identity, license type) enforced by a unique-open constraint, with a stable `first_seen_at`, `observed_at` = the latest complete observation, the observing `source`, and `resolved_at`/`resolution_reason`. A newer complete snapshot in which the member is absent resolves the episode as `disappeared` without deleting alerts or closing any register row; reappearance opens a new episode; partial, failed or stale snapshots never resolve anything; repeated and racing runs never multiply episodes (DEC-SMP-035). The append-only migration (`slug=drift_episodes`) ships the table, the unique-open constraint, RLS and application-role grants, with fresh-database apply and parity verification in this child.
- [ ] AC3: The `register_drift` AlertRule fires about member drift: `subject_ref` = `{"drift_episode_id", "vendor_account_id"}`, one AlertEvent per enabled applicable rule and episode through the US-067 stable `dedupe_key`, delivered by the existing notification outbox with a tenant-safe link target; acknowledgement never resolves an episode. The financial-variance `register_drift` facts, validation and `reconciliationId` subject are retired for new events; historical reconciliation-subject AlertEvents stay readable as legacy evidence (DEC-SMP-038).
- [ ] AC4: The deferred `memberSync` job is replaced by production composition over the delivered US-056/US-057/US-058 connector capabilities — credential-safe, paginated, journaled in ConnectorCallObservation — on the existing hourly schedule, processing only `ingestion_mode = api` vendor accounts; csv_import/manual accounts are never polled and reach the same diff through US-055's import (BR-24).
- [ ] AC5: `/excepciones?tab=drift` (SCR-exceptions, Deriva) lists open episodes — member identity, account, license type, first seen, last observed, source, warnings — with a real tab count and badge replacing the placeholder zero, visible only to authenticated Group Admin; unattributed members are never attributed to a company by VendorAccount or domain, other tenants' rows never leak, and no navigation entry is added. Existing blocked/failed/invite and pool behaviour is preserved.
- [ ] AC6: Demo: equivalent complete `api`, `csv_import` and `manual` snapshots fed to the shared entrypoint produce the same single episode and alert per unknown seat, while known open assignments, pending invitations and checklist-confirmed provisions produce nothing; a repeated run and a raced run add no episode or alert; a failed or incomplete page clears no drift; a newer complete snapshot without the member resolves it as `disappeared` with the alert still readable; the real hourly worker processes only API-opted-in accounts; the Deriva tab shows the open episodes and count to a Group Admin and refuses other roles.

## Notes

- Canonical child of **US-030** (parent AC coverage: **AC1**), minted by **CHG-075** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-030.json`, proposal `detect-members`, estimate 270 min). Decisions DEC-SMP-034, DEC-SMP-035, DEC-SMP-038. First child; no sibling dependency. **US-079** (claim) and **US-080** (metric) build on the episode evidence this child delivers.
- Owns the shared diff/upsert contract that **US-055** calls on every successful `importMembersCsv` for csv_import/manual accounts; US-055 implements no second drift algorithm and keeps CSV parsing, upload, manual register upkeep and its own integrated import proof (US-055 AC1). This child verifies the identical diff with all three source fixtures now.
- **CHG-076 / DEC-SMP-041 (2026-10-11):** when the hourly sync accepts a validated COMPLETE member snapshot it also stamps the account's capacity-refresh watermark through US-081's `recordAcceptedMemberSnapshot` entrypoint (`source = api`); if US-081 has not integrated yet when this story closes, the call is a named deferred-integration item for whichever of the two integrates second — no other scope moves here.
- Vertical delivery: migration + grants, packages contract, worker composition, alert contract correction (the narrow existing-alert amendment is part of this child's server interface), Deriva listing, locales, verification, review, integration. Falsifiers that require repartition through Nous rather than a stretched estimate: a wider independent contract repair, grant/schema work beyond the episode table, or a file inventory above 20.
