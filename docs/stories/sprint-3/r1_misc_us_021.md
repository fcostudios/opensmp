# US-021: Invite hygiene

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to never leak seats into invite limbo so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-021 |
| Feature | FEAT-014 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S4 |
| Screens | SCR-exceptions |
| Server Actions | withdrawInvite |
| Entities | ProvisioningAction (U), AlertEvent (C) |
| Business Rules | BR-13 |
| Blocked By | US-019, US-042 |

## Acceptance Criteria

- [ ] AC1: Invites unaccepted >7d raise invite_unaccepted alert (threshold configurable)
- [ ] AC2: Auto-withdraw after configurable window frees the seat + re-notifies requester; manual `withdrawInvite` with note from exceptions tab
- [ ] AC3: Withdrawn invites visible in request Acciones trail

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
