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
| Entities | LicenseAssignment (C), LicenseRequest (C system), AlertEvent (C) |
| Business Rules | BR-24 |
| Blocked By | US-018, US-046, US-042 |

## Acceptance Criteria

- [ ] AC1: Hourly member sync diffs console vs register; unknown members → register_drift alert + Deriva tab entry
- [ ] AC2: `claimDriftMember` assigns company retroactively: creates LicenseAssignment (source_kind=reconciliation, note=comentario) + system-materialized request
- [ ] AC3: Drift metric on dashboard trends to zero (PRD §17)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
