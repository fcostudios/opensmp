# US-092: Retire financial drift alerts and preserve historical alert readability

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want financial reconciliation to stop producing false membership-drift alerts while historical alerts stay readable, so that the current alert semantics can transition safely without losing old evidence.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-092 |
| Feature | FEAT-023 |
| Sprint | 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (packages, alert worker; existing alert-list compatibility) |
| Server Actions | — |
| Entities | AlertEvent (R), AlertRule (R) |
| Business Rules | BR-24 |
| Blocked By | US-042 |

## Acceptance Criteria

- [ ] AC1: The real production financial-reconciliation variance path stops creating new register_drift alerts. Other applicable alert types and existing financial behavior remain unchanged; do not query a future DriftEpisode table or emit fictional episodes.
- [ ] AC2: New register_drift subject validation accepts only the canonical drift_episode_id/vendor_account_id shape and refuses reconciliationId for new events. Read parsing and destination handling remain legacy-compatible for existing reconciliation-subject alerts; no new company inference or visibility widening.
- [ ] AC3: Demonstrate zero new register_drift from the real financial variance worker fixture, strict new-event subject acceptance/refusal and a historical alert rendered with its working legacy destination. This owns parent US-078 AC3 financial retirement/legacy clauses and corresponding AC5 proof only; actual episode production/rule/outbox/link/ack evidence belongs to US-093 and cannot be replaced by shape fixtures.

## Notes

- Canonically allocated by CHG-099 after Francisco selected exact B+narrowV1 packet4589abe; readiness is not approved by this allocation. Parent US-078 verifies integrated coverage rather than reimplementing children. Existing US-088/089 closed evidence/costs remain unchanged. Own current full gate, meaningful scoped/fresh final review, realDB proof and applicable own preflight/cold are required; no borrowed scores, source/tests changed or started event here.
- Existing US-084/090/091 and CHG-093/096/097/098 remain with their owners; no takeover, code scope expansion or P4(a) override. BR-24 remains non-critical, settled existing TESTING§3 guidance applies; no new guide/pin/toolchain delivery. Hard320minutes/20actualdelivery paths and all current ownership/readiness/authority rules remain.
- Proposal canonical-drift-alerts. Allocation estimate255active minutes: readiness25/implementation65/focused95/review45/integration25;9delivery paths+4bookkeeping. This independently useful outcome is assessable after canonical delivery; actual current readiness is required before implementation.
- Frozen proposed delivery inventory: packages/contracts/src/alerts.ts, packages/contracts/src/alerts.test.ts, packages/domain/src/alerts/evaluate.ts, packages/domain/src/alerts/evaluate.test.ts, packages/domain/src/alerts/types.ts, apps/worker/src/alerts/evaluate-alerts.ts, apps/worker/src/alerts/evaluate-alerts.integration.test.ts, apps/web/src/components/alerts/alert-list.test.tsx, scripts/mutation-routes.json.
- US-093 follows this outcome and consumes the strict subject contract/legacy readability behavior. Shared parentAC3/AC5 coverage is explicit; both child proofs and parent review are required, never duplicate ownership.
