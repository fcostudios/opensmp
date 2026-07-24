# US-018: Anthropic connector client

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to talk to the vendor API safely so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-018 |
| Feature | FEAT-011, FEAT-041 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3 |
| Screens | (connector) |
| Server Actions | — |
| Entities | ProvisioningAction (C) |
| Business Rules | — |
| Blocked By | US-003, US-045 |

## Acceptance Criteria

- [ ] AC1: Client wraps User Management + Analytics APIs: rate limits (100/min UM, 60/min analytics, 1200 invites/h), retries with backoff, anthropic-version + beta header pinned in ONE module
- [ ] AC2: Every call persists ProvisioningAction/sync raw_request+raw_response
- [ ] AC3: Connector implements the Connector capability interface (US-045) — nothing Claude-specific outside it (DEC-SMP-008); capability descriptor semantics per US-025

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
