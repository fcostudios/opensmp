# US-053: Production environment + first deploy

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to a running production stack so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-053 |
| Feature | — |
| Sprint | Sprint 4 |
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

## Acceptance Criteria

- [ ] AC1: VPS provisioned (GATE: hosting root, OQ-SMP-7); Caddy TLS + DNS; production Compose stack up (app/worker/postgres/keycloak/smtp-relay) with healthchecks
- [ ] AC2: Production Keycloak realm imported; KEK + secrets placed per ADR-13; nightly backup job live
- [ ] AC3: Deploy runbook documented; first deploy from CI verified

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
