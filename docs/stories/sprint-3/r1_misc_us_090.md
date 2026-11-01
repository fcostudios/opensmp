# US-090: Verify provisions atomically from every accepted member observation

> **Sprint 3** | **P0** | **1 SP** | **R2**

## User Story

As a Group Admin (persona_01), I want accepted membership evidence to verify my confirmed provisions through the delivered shared lifecycle so that accepted membership evidence verifies provisions before downstream drift is evaluated.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-090 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R2 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (packages, jobs) |
| Server Actions | — |
| Entities | MemberObservation (R), ProvisioningAction (U verification), LicenseRequest (U activation), LicenseAssignment (C invite activation), Person (R), AuditLog (C), AlertEvent (C), LifecycleNotification (C) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-089 |

## Acceptance Criteria

- [ ] AC1: The delivered verification decision core is extracted from the web module into packages/domain as a pure function plus repository port. One shared application service and repository implementation preserve delivered transaction, replay, state, failure-reason, audit and alert behaviour. Existing web checklist observation and US-066 invitation-poll callers delegate to that service; packages never import the web app, workflow logic is not duplicated, and neither the whole orchestration service nor provider/checkpoint polling workflow is moved (US-084 AC2; DEC-SMP-046).
- [ ] AC2: A worker-safe adapter is the mandatory first consumer inside acceptMemberObservation for every accepted source (api, csv_import, manual), before any caller-supplied diff consumer, on the same injected transaction without a nested transaction. It selects the account's applicable company-scoped actions and matches accepted normalized membership by provider_member_ref when established, else normalized e-mail, and license. Identity/license-warned members are excluded. Checklist revalidation applies only confirmed/verification_failed orchestration checklist actions on active requests with the exact linked open assignment; pending human checklists are never auto-confirmed. Sent automated invites on invited requests activate on a matching licensed member; absence leaves them sent/invited. Unmatched members proceed to the downstream diff untouched (US-084 AC3; DEC-SMP-045/046).
- [ ] AC3: DEC-SMP-047: the adapter dispatches checklist verification only when observed presence differs from current confirmed/verification_failed state. First failure and later recovery pass through the unchanged delivered service, preserving exact failure reason, company-before-global alert-rule selection, replay conflict and audit. Unchanged presence adds no verification audit or duplicate provisioning_failure alert; newer complete same-content snapshots still advance acceptance ledger/audit/freshness. Equal-time equivalent replay, stale, conflict or incomplete observations invoke no verification. The account acceptance advisory lock (83083) precedes delivered action/observation locks.
- [ ] AC4: Demo using the real database: complete API, CSV and manual observations exercise shared verification before a downstream consumer; a confirmed checklist whose licensed member is absent becomes verification_failed with its audit/alert, a later match recovers it, and unchanged presence emits no repeated verification effects. Matching sent invites create exactly one assignment, invited-to-active transition and lifecycle notice; no-match invites remain pending. Wrong account/company/license, warned identities, replay/conflict, stale observations and concurrent existing-poll/acceptance paths preserve isolation and delivered guards. A later-consumer failure rolls back observation, verification state, audits, alerts, assignment and notice together; retry succeeds once (US-084 AC5 verification/rollback/replay clauses).

## Notes

- Canonical child of US-084 (first), allocated through the Nous ledger under CHG-095 on 2026-10-14 after Francisco approved exact P1–P5. Proposal accepted-provision-verification. Owns US-084 AC2/AC3 and the verification, rollback and replay clauses of AC5; US-091 owns the hourly clauses. Shared AC5 has cross-cutting coverage because the parent verifies the complete hourly-plus-verification demo only after both children complete.
- Allocation estimate 285 minutes (readiness25, implementation105, focused verification105, review40, integration10), 14 expected delivery paths; tenant re-assesses before its own digest-bound readiness approval. Parent sunk readiness is retained once. Each child owns production delivery, tests, scoped and fresh adversarial review, full gates and its own diff-scoped cold mutation proof; no tests-only split or borrowed score.
- P4(a) integration hold: isolated implementation is allowed after this child's approved readiness, but it must not integrate to main until CHG-093 integrates or is formally closed. Rebase onto the post-CHG-093 lifecycle.ts and orchestration.ts; account honestly for reconciliation/reproof and reassess before exceeding the approved estimate or320-minute hard cap. This note is an integration constraint, not a CHG-valued Blocked By row.
- Reuse US-020 confirmed-checklist revalidation and US-066 sent-invite activation semantics without a rewrite. Checklist observations are strictly newer than action resolved_at; the delivered actionId/observationId replay key and IDEMPOTENCY_CONFLICT guard remain. Leave the standalone US-066 poll in place; retire neither polling nor encrypted checkpoints in this scope.
- BR-24 remains non-critical per CHG-086. Existing TESTING.md §3 isolation, authorization, legal-transition and entity rows cover this scope; no new guide/config/pin delivery. Normal changed-source effectiveness threshold and individual survivor review remain mandatory. US-081 owns watermark implementation; this child writes no watermark/schema and does not deliver the hourly worker.

- CHG-113 / DEC-SMP-065/066: R2; no further R1 work.
