# US-056: Anthropic transport with separated credentials and bounded retry

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to reach each Anthropic API with the correct credential and bounded transport policy so that later connector operations fail closed and cannot amplify provider load.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-056 |
| Feature | FEAT-011 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3 |
| Screens | (connector) |
| Server Actions | — |
| Entities | IntegrationCredential (R), VendorAccount (R) |
| Business Rules | — |
| Blocked By | US-003, US-025, US-045 |

## Acceptance Criteria

- [ ] AC1: A single endpoint-policy module owns origin, method, `anthropic-version`, media headers, endpoint-specific beta header, and required credential kind for User Management and Analytics routes
- [ ] AC2: Initial attempts and retries share per-vendor-account budgets of 100/min User Management, 60/min Analytics, and 1200 invites/h; safe reads and idempotent deletes retry only bounded 429/5xx classes, while ambiguous invite creation is not replayed automatically
- [ ] AC3: Missing, blank, duplicate, identical, unhealthy, or wrong-kind Admin/Analytics credentials fail before transport; tests assert zero network calls for every fail-closed path

## Notes

- Official US-018 transport child approved previously as `US018-PARTITION`; restored by CHG-045 when the connector-call journal migration invalidated the consolidated parent's 310-minute estimate.
- ACs are copied verbatim from `08_scope.md`; edit the scope source and regenerate.
