# US-027: Inactivity flags + usage surface

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to see 30/60/90-day inactivity per company so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-027 |
| Feature | FEAT-021 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-usage |
| Server Actions | proposeReclamations |
| Entities | ReclamationProposal (C), LicenseRequest (U) |
| Business Rules | BR-16 |
| Blocked By | US-026 |

## Acceptance Criteria

- [ ] AC1: SCR-usage: filters, metric cards, last-active + badge per person; batch 'Proponer reclamación' creates pending ReclamationProposals with note
- [ ] AC2: Flags respect the ~3-day analytics lag (windows unaffected)
- [ ] AC3: State flagged_inactive set on the anchor request when window trips

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
