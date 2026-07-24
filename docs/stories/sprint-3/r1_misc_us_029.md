# US-029: Freshness labels + staleness alert

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to know how fresh every synced figure is so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-029 |
| Feature | FEAT-022, FEAT-024 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | all usage/statement screens |
| Server Actions | — |
| Entities | AlertEvent (C) |
| Business Rules | BR-23 |
| Blocked By | US-026, US-042 |

## Acceptance Criteria

- [ ] AC1: FreshnessLabel bound to synced_at on usage/cost figures across screens ('datos al 19-jul')
- [ ] AC2: Sync >48h behind → sync_stale alert + attention styling
- [ ] AC3: Staleness surfacing is read-only and distinguishes cause: 'sin datos' vs 'credencial con fallo de autenticación', reading IntegrationCredential.health maintained by US-031 (FEAT-024)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
