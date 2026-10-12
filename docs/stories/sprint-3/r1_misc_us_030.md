# US-030: Drift detection + retroactive claim

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to catch console bypass within an hour so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-030 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-exceptions |
| Server Actions | claimDriftMember |
| Entities | MemberObservation (C), DriftEpisode (CU), LicenseAssignment (C), LicenseRequest (C system), AlertEvent (C) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-078, US-079, US-080, US-083, US-084, US-088, US-089 |

## Acceptance Criteria

- [ ] AC1: Hourly member sync diffs console vs register (ingestion_mode=api orgs); for csv_import/manual orgs the SAME diff runs on every `importMembersCsv` (US-055) — unknown members → register_drift alert + Deriva tab entry either way. Unknown = active licensed console member of a validated complete snapshot with no open LicenseAssignment for the same normalized identity/account/license type; invitations are not seats; persisted as one open DriftEpisode per identity (DEC-SMP-034, DEC-SMP-035); `register_drift` is about member episodes, never financial variance (DEC-SMP-038)
- [ ] AC2: `claimDriftMember` assigns company retroactively: creates LicenseAssignment (source_kind=reconciliation, note=comentario) + system-materialized request. Group Admin only, with `company:write` on a server-resolved company scope (DEC-SMP-036); `started_on` ≤ claim date, never intersecting a finalized statement; one transaction, replay-safe (DEC-SMP-039)
- [ ] AC3: Drift metric on dashboard trends to zero (PRD §17): current = unresolved distinct episodes, trend = end-of-day counts over the trailing 30 completed America/Guayaquil dates derived from episode lifetimes (DEC-SMP-037)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- **CHG-077 (2026-10-11) — US-078 repartitioned** after the tenant's blocked readiness (540 min / 38 files / 2 boundaries; the connector exposed `{email, active}` only): **US-083** (lossless member contract + Pact, license mapping, `MemberObservation` ledger with replay/conflict rules, warnings; ≈220) → **US-084** (hourly API worker, confirmed-provision composition, watermark stamp; ≈200) ∥ **US-078** (drift diff, episodes, alerts, Deriva + warnings; ≈260; subject to file-boundary review, otherwise US-084 first) → US-079 → US-080. Parent AC1 is owned collectively by US-083 + US-084 + US-078. Rulings DEC-SMP-043 (observation contract + capability limits), DEC-SMP-044 (completeness, replay, ledger), DEC-SMP-045 (warnings excluded from episodes/claims), DEC-SMP-046 (confirmed-provision composition).
- **Partitioned by CHG-075 (2026-10-11)** from the tenant's `partition_required` assessment (780 min bottom-up vs the 320-minute budget) into three canonical 1-SP children, sequential: **US-078** (AC1, proposal `detect-members`) → **US-079** (AC2, `claim-member`) → **US-080** (AC3, `drift-metric`). This parent closes by parent-level verification once the three are dev_done; it is not amended beyond the decision references above. Rulings: DEC-SMP-034 (unknown member), DEC-SMP-035 (episodes + alert dedupe), DEC-SMP-036 (claim authorization + note), DEC-SMP-037 (metric + window), DEC-SMP-038 (`register_drift` subject correction), DEC-SMP-039 (retroactive date + atomic claim).
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
