# US-053: Production environment + first deploy

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to a running production stack so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-053 |
| Feature | — |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | n/a (infra) |
| Server Actions | — |
| Entities | — |
| Business Rules | — |
| Blocked By | US-002 |

| Slice | S0 |

| Gated By | OQ-SMP-7 (soft: Docker host DNS and deployment access; owner=IT Director) |

| Manual Fallback | IT Director deploys the documented Docker Compose stack manually on the approved host when CI credentials are unavailable; production access is still required for acceptance. |

## Acceptance Criteria

- [ ] AC1: Deploy the production Docker Compose stack on the approved host with Caddy TLS/DNS and healthchecks; IT Director verifies login and runtime health (DEC-SMP-066). Use the actual app and declared infrastructure services; no separate backend service.
- [ ] AC2: Production Keycloak realm imported; KEK + secrets placed per ADR-13; nightly backup job live
- [ ] AC3: Deploy runbook documented; first deploy from CI verified

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S0; license-only manual path. Production acceptance belongs to finance users and the IT Director. Docker now; twelve-factor images/config keep the later Azure Container Apps move free of code changes. Azure is a separate change.
