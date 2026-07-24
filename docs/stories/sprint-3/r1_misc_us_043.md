# US-043: Alert log + acknowledgment

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to triage and acknowledge alerts so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-043 |
| Feature | FEAT-035 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-alerts |
| Server Actions | ackAlert |
| Entities | AlertEvent (RU) |
| Business Rules | — |
| Blocked By | US-042 |

## Acceptance Criteria

- [ ] AC1: SCR-alerts tabs (sin reconocer / todas); `ackAlert` records who/when
- [ ] AC2: Per-type subject link dispatch (request/pools/credentials/exceptions) per the TOON contract
- [ ] AC3: Alert rows display their alcance (global/compañía/org) per the TOON contract; SCR-alerts remains group_admin-only in R1 — company personas receive company-scoped alerts via email only (US-042); any in-app company alert surface requires a nav-map + screens change (open question, Step 9)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
