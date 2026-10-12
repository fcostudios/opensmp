# US-089: Accept complete member observations atomically

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want every observation Ledger acts on to be complete, replay-safe and auditable so that a delayed or contradictory snapshot can never reopen or hide drift — this child delivers: `acceptMemberObservation` with effective capability/mapping validation, completeness from the real connector journal, the account lock, stale/replay/conflict rules, durable warnings, exact audit and event receipts, ordered transactional consumers, and its public export.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-089 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (packages) |
| Server Actions | — |
| Entities | MemberObservation (C), Vendor (R), LicenseType (R), VendorAccount (R), ConnectorCallObservation (R), AuditLog (C) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-088 |

## Acceptance Criteria

- [ ] AC1: `acceptMemberObservation` resolves each record's license from the persisted declarations and records durable warnings (null e-mail, ambiguous identity incl. duplicate provider id, normalized e-mail, unmapped license, unknown seat evidence) without creating any other entity; an inactive vendor or a capability mismatch is rejected (US-083 AC1 resolution/warnings, AC2 effective validation; DEC-SMP-043/045).
- [ ] AC2: Completeness comes from the real journal: every requested page succeeded in order with the right method and count, the provider total matches when exposed, wrong account/operation or unpaired attempts are incomplete; under the account advisory lock, older → `stale`, equal time + equal canonical hash → no-op, equal time + different hash → `conflict`, newer (including empty) → accepted (US-083 AC3; DEC-SMP-044).
- [ ] AC3: Accepted and rejected outcomes write exact audit receipts and a typed `member_observation_accepted` event with correlation; ordered consumers run in the same transaction and a failing consumer rolls back the ledger row, audits and earlier consumer effects; the root package export (`packages/db/src/index.ts` with `index.test.ts`) is owned here (US-083 AC3/AC4 ledger, AC5 accepted-observation demo).
- [ ] AC4: Demo: the full fixture produces exact counts and warning tuples; replay, stale, conflict, empty and concurrent-identical cases behave as above; a forced later-consumer failure leaves nothing committed and a retry succeeds once; the representative survivors of the failed campaign (completeness totals, inactive vendor, capability mismatch, duplicate identity, normalized e-mail, newer identical content, audit payload, event type, account lock) are killed by oracles in `member-observations.integration.test.ts`.

## Notes

- Canonical child of **US-083** (second), minted by **CHG-086** on 2026-10-12; proposal `atomic-member-observation`. Depends on US-088. Carries the acceptance work already committed on candidate `6191fe8` with its share of historical cost, plus the triaged repair (≈35 min of missing oracles, service change only where a reproduced bug warrants it). If its readiness — sunk share plus remaining — exceeds 320, it comes back to Nous; it must not be stretched.
- **US-084** (hourly worker) and **US-078** (drift diff) consume accepted observations and depend on this story.
