# US-057: Append-only sanitized connector-call journal

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to retain durable, privacy-safe evidence for every connector attempt so that known and uncertain provider outcomes can be reconciled without leaking secrets or fabricating requests.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-057 |
| Feature | FEAT-011 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3 |
| Screens | (connector evidence) |
| Server Actions | — |
| Entities | ConnectorCallObservation (C), ProvisioningAction (R/link only), VendorAccount (R) |
| Business Rules | — |
| Blocked By | US-056 |
| Migration | slug=connector_call_observation |

## Acceptance Criteria

- [ ] AC1: Migration `slug=connector_call_observation` creates the provider-neutral append-only journal, uniqueness/check constraints, optional ProvisioningAction link, and runtime INSERT/SELECT privileges with UPDATE/DELETE denied
- [ ] AC2: Each attempted call commits `requested` before transport and appends `succeeded` or `failed` when known; retries share a correlation and increment attempt, while interruption or ambiguous outcome leaves the unmatched requested event intact
- [ ] AC3: Summaries are built from an explicit allowlist and property-tested to exclude credentials, authorization headers, email addresses, raw PII, full provider identifiers, and raw provider bodies; persistence failure before transport prevents the call

## Notes

- Official US-018 journal child approved previously as `US018-PARTITION`; CHG-045 adds the migration and the provider-neutral entity that the old readiness assessment omitted.
- ACs are copied verbatim from `08_scope.md`; edit the scope source and regenerate.
