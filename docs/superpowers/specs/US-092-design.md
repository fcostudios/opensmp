# US-092 design

## Outcome and authority

Stop financial reconciliation from producing new `register_drift` alerts while retaining historical readability. AC1–AC3 own only US-078 AC3's financial-retirement/legacy clauses and corresponding AC5 proof. DEC-SMP-038/048/049 and the approved story/readiness govern this work. Approval commit `b1c1d4c` binds payload `7c873d54fb1abd3fc4e989e2630cfbe319515d61e275324914e80a2755134428`; authority base is `7bc42fa74cb198677817a011fd19c3e924a19ecd`. The readiness check passed before authoring this document.

The user selected one consolidated implementer, green task commits and reused scoped review, followed by a distinct fresh final adversarial review. Standing authorization covers design/plan preparation. The controller obtains actual builder PASS before source/test changes; this document does not claim that PASS.

## Existing behavior and chosen change

`gatherFacts` in the real worker selects open reconciliations whose `variance_usd IS DISTINCT FROM 0`, emitting `{ reconciliationId }` and `drifted: true`. Retire that case by returning no facts. Keep enabled-rule iteration, scope admission, every other fact loader, outbox and financial persistence behavior. Do not substitute invalid-subject failure for successful retirement.

The new-event schema currently also supplies destination validation, which couples new subjects to old stored evidence. Separate those two contracts within the existing contracts/domain files. The production `AlertList` adapter already delegates to `alertSubjectDestination`; its production path needs no edit. Render the actual organism with a historical raw subject to demonstrate its working `/excepciones` link.

## Stable interfaces

In `packages/contracts/src/alerts.ts`:

- `alertSubjectRefSchema` / `AlertSubjectRef`: generic stored/read shape; retain strict `{ reconciliationId: nonempty string }` and all existing subjects, and admit strict `{ drift_episode_id: nonempty string, vendor_account_id: nonempty string }`.
- `alertSubjectForTypeSchema`: strict new-event discriminated `{ type, subject }` validator. Only the two canonical snake-case keys are accepted for `register_drift`; reject legacy, mixed, missing, empty, extra, non-string keys and wrong alert-type pairings. Preserve other alert-type variants.
- `NewAlertSubjectRef = z.infer<typeof alertSubjectForTypeSchema>["subject"]`: expose the new-subject type through the alerts subpath and `packages/domain/src/alerts/types.ts`; do not edit package barrel exports.
- `alertSubjectForReadTypeSchema`: typed read validator with identical existing pairings and a `register_drift` subject accepting either strict historical reconciliation or strict canonical subject. Mixed/extra/malformed subjects reject.
- `alertEvaluationSchema` retains `{ dedupeKey, subjectRef, type }` and validates its `subjectRef`/`type` pair with the strict new-event validator; its runtime boundary cannot reopen legacy event creation.

In `packages/domain/src/alerts/evaluate.ts`, keep signatures `evaluateAlertRule(rule: AlertRuleContract, facts: AlertFacts, evaluatedAt: Date): AlertEvaluation | null` and `alertSubjectDestination(type: AlertType, subject: AlertSubjectRef): string`. Evaluation uses the strict new-event schema; destination uses the read schema. Canonical shape tests prove only contract acceptance, never actual episode production. Retain the existing `/excepciones` drift destination; no new episode route is introduced. `AlertFacts` remains compatible with generic subject inputs because runtime validation owns type/subject pairing.

In the worker, keep `createAlertEvaluationJob(options): AlertEvaluationJob`, its `run(at)` result and external options unchanged. Remove the reconciliation fact production; any now-dead reconciliation-only helper arm may be removed within this same worker file without disturbing remaining callers.

## Scope and constraints

Exactly nine permitted delivery paths:

1. `packages/contracts/src/alerts.ts`
2. `packages/contracts/src/alerts.test.ts`
3. `packages/domain/src/alerts/evaluate.ts`
4. `packages/domain/src/alerts/evaluate.test.ts`
5. `packages/domain/src/alerts/types.ts`
6. `apps/worker/src/alerts/evaluate-alerts.ts`
7. `apps/worker/src/alerts/evaluate-alerts.integration.test.ts`
8. `apps/web/src/components/alerts/alert-list.test.tsx`
9. `scripts/mutation-routes.json`

Four bookkeeping paths: `docs/readiness/US-092.json`, this design, `docs/superpowers/plans/US-092-plan.md`, `.nous-feedback.jsonl`. No hidden delivery/report path. Raw receipts stay ignored under Git-common `.git/agent-evidence/US-092`.

No new DriftEpisode table/query, fictional episode, migration, company inference, visibility widening, financial math, auth, notification implementation, UI production, generated guide, toolchain or configuration changes. Company remains the tenant; VendorAccount is not a tenant. Existing rule scope and tenant enforcement remain unchanged. US-093 owns actual episode production/rule/outbox/link/ack evidence. US-084/090/091 and CHG-093/096/097/098 retain their owners; the DEC-SMP-048 hourly obligation is not reassigned.

## Demonstration and failure oracles

Contract/domain tests accept canonical new drift subjects, reject every legacy/malformed new subject and wrong pairing, and preserve historical typed read parsing and destination behavior. Keep existing all-type evaluation/destination matrices, updating only new drift input. Exact output/dedupe assertions constrain canonical key ordering and enabled/threshold behavior.

The existing worker integration suite uses `createPostgresFixture` through the official CHG-067 shared PostgreSQL runner and a real local SMTP server. Add a deterministic open, nonzero reconciliation with enabled applicable global and account drift rules. Invoke actual `job.run` as the application role. Require success, exact zero new drift events, zero drift outbox/delivery records and zero drift SMTP messages. Include a valid low-pool breach as a positive control with its expected persisted delivery and SMTP subject; preserve existing other-type tests. Snapshot/query financial status, variance and relevant fixture financial rows before/after and assert unchanged. Exercise global/account and company-negative scopes without changing authorization or deriving a reconciliation company. All tenant-scoped controls explicitly distinguish company A from company B. Fixed IDs and injected times prevent ordering or wall-clock dependence.

Render `AlertList` using its existing `renderToStaticMarkup` pattern with historical raw `{ reconciliationId }` / `register_drift`; assert visible subject and `href="/excepciones"` from the actual organism, and retain malformed/other-type checks. This is historical presentation evidence, not a live episode claim.

## Delivery, verification and cost custody

Two implementation tasks: contracts/domain, then worker retirement/render proof. Each has RED→GREEN, a green commit and the existing scoped reviewer through the controller; no new implementer or delegated task. Builder review precedes both. Each task lists production sources; after green committed source, actual preflight determines touched shard IDs. The earlier three-shard planner result is forecast only. Preserve all existing route keys and ordered values; add changed `types.ts`→existing `evaluate.test.ts`, and append existing `evaluate-alerts.integration.test.ts` to the worker's existing route retaining `overdue-invitations.integration.test.ts` first.

Preview only intersecting touched shards, at most tasks+1 rounds/30 minutes; database-backed or previously >5-minute shards run once in the final round unless their sources changed. Collect background work at review boundaries. Routing gaps are not evidence. Use owner-aware locks, never delete another actor's cache. Keep host awake for the full uncached gate; apply/verify/parity committed migrations with actual owner/app roles. Final adversarial review and every repair precede one own native diff-scoped cache-cleared cold campaign, last; score >=80 and one-line reviewer-approved survivors. No source/test change after cold.

Approved all-actor total 255 minutes = readiness25 + implementation65 + focused95 + review45 + integration25. Controller reports readiness23 consumed, leaving232 across all actors; allocations remain unchanged, not reset. Implementer owns implementation45/focused70/integration8 including design/plan; other actors retain the remaining phase allocations recorded in readiness U8. Active minutes are estimates; unavailable role/token telemetry is disclosed. Do not import historical item costs. At each task boundary reassess sunk+remaining all-actor forecast; stop for amendment if it exceeds255 or an extra path/coupling is needed. Above320 minutes or20 delivery paths is a hard failure requiring official partitioning. No readiness actuals/terminal completion claim is made at design time.
