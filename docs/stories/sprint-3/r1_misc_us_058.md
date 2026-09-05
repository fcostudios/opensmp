# US-058: Anthropic connector conformance and Pact contracts

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to use Anthropic through Ledger's neutral connector contract so that provisioning and sync consumers stay vendor-independent.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-058 |
| Feature | FEAT-011, FEAT-041 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3 |
| Screens | (connector) |
| Server Actions | — |
| Entities | ConnectorCallObservation (C), ProvisioningAction (R/link only), VendorAccount (R) |
| Business Rules | — |
| Blocked By | US-056, US-057 |

## Acceptance Criteria

- [ ] AC1: The adapter implements provision, deprovision, syncMembers, syncActivity, and syncCost; pagination is bounded to 100 pages and cost decimals remain exact strings
- [ ] AC2: The `rest` dispatcher resolves Anthropic and advertises only implemented capabilities; Anthropic names, routes, headers, and provider response shapes remain under the provider directory, and no raw provider body crosses the connector result seam
- [ ] AC3: Every deterministic User Management and Analytics fixture is exercised by passing Pact consumer contracts covering headers, pagination, nullability, error classes, and rate-limit responses; live-provider acceptance remains exclusively US-054

## Notes

- Official US-018 conformance child approved previously as `US018-PARTITION`; restored by CHG-045.
- ACs are copied verbatim from `08_scope.md`; edit the scope source and regenerate.
