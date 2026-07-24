# US-028: Reclamation proposals: approve or dismiss

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Company Approver (persona_02), I want to consent before any seat is freed so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-028 |
| Feature | FEAT-021 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-reclamation-proposals |
| Server Actions | approveReclamation, dismissReclamation |
| Entities | ReclamationProposal (U), LicenseRequest (U) |
| Business Rules | BR-15 |
| Blocked By | US-027, US-024 |

## Acceptance Criteria

- [ ] AC1: Queue cards with last-active, days, cost; 'Liberar' → approves proposal → offboarding flow; 'Mantener' → dismissed with mandatory keep-note
- [ ] AC2: Dismissal suppresses re-proposal until a new inactivity window elapses
- [ ] AC3: Decisions audit-logged; proposal state drives the pending queue + empty state

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
