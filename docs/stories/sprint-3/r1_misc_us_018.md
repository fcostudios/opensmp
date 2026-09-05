# US-018: Anthropic connector client

> **Sprint 3** | **P0** | **4 SP aggregate** | **R1** | **partition parent — do not execute directly**

## User Story

As a Group Admin (persona_01), I want to talk to the vendor API safely so that automation is reliable and forensically accountable.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-018 |
| Feature | FEAT-011, FEAT-041 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 4 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3 |
| Screens | (connector) |
| Server Actions | — |
| Entities | ConnectorCallObservation (C), ProvisioningAction (R/link only) |
| Business Rules | — |
| Blocked By | US-003, US-025, US-045, US-056, US-057, US-058 |
## Acceptance Criteria

- [ ] AC1: Client wraps User Management + Analytics APIs with endpoint-specific header policy, documented rate limits (100/min UM, 60/min Analytics, 1200 invites/h), and bounded retry/backoff; Admin and Analytics credentials are distinct and fail closed when routed to the wrong capability
- [ ] AC2: Every network attempt persists an append-only sanitized canonical `ConnectorCallObservation`: requested before transport and succeeded/failed when known; provisioning observations may link to the request-owned `ProvisioningAction`, while sync observations remain vendor-account scoped. Credentials, authorization headers, raw PII, full provider identifiers, and raw provider bodies are forbidden
- [ ] AC3: Connector implements the Connector capability interface (US-045) — nothing Claude-specific outside it (DEC-SMP-008); capability descriptor semantics per US-025
- [ ] AC4: Every deterministic Anthropic network fixture is backed by a passing Pact consumer contract; live credential-scope, organization-binding, pagination, rate-limit, invite-create, and invite-cleanup acceptance remains gated by the authorized US-054 provider run

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- CHG-045 corrected the aggregate to 4 SP after the journal migration was discovered. At the calibrated 104 minutes/SP this parent exceeds the 320-minute execution ceiling, so it is not execution-ready. Execute the previously approved official children in order: US-056 (1 SP), US-057 (2 SP), US-058 (1 SP).
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
