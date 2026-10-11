# CHG-081 lifecycle mutation route design

Approved readiness: `docs/readiness/CHG-081.json`, digest `92d194f2cef5eaa695f0590cfbcf7a195b250056cda3098c4ebe8a946e9e89cd`, 35 minutes, six inclusive paths. Francisco delegated the controller/Astra decision and execution; the controller computed the digest after that delegation.

## Intent and scope

US-075 must select the existing PostgreSQL orchestration oracle whenever the shared domain lifecycle source changes. Add one entry to `DIRECT_TEST_ROUTES` in `scripts/mutation-scope.mjs`: `packages/domain/src/request-workflow/lifecycle.ts` maps to only `apps/web/src/modules/request-workflow/orchestration.integration.test.ts`. Existing adjacent discovery remains unchanged and continues selecting `packages/domain/src/request-workflow/lifecycle.test.ts` too. Two existing-harness assertions in `scripts/test-mutation-scope.mjs` prove exact registration and actual-file selection of both suites.

The complete inclusive inventory is the two harness files, this design, its plan at `docs/superpowers/plans/2026-10-11-chg-081-lifecycle-route-plan.md`, `docs/readiness/CHG-081.json`, and `.nous-feedback.jsonl`. No application or domain source/test, generated guidance, instrumentation, threshold, routing-gap, harness behavior, schema/model/template, prior CHG-079/080 artifact, or committed migration changes.

## Runtime proof

The existing lifecycle source is unchanged since US-064; native current diff preflight cannot establish its actual runtime route. Discover current actual source with `calculatePlannedMutationScope(["packages/domain/src/request-workflow/lifecycle.ts"])`, require exactly the lifecycle-source shard and both existing suites, and execute its actual discovered `testFiles` via the existing root `vitest.mutation.config.mjs`. Discovery alone is not proof.

A scratch launcher outside the repository runs inside stock `packages/db/src/testing/run-with-shared-postgres.ts`; require `SMP_TEST_POSTGRES_CLUSTER_URL` and reject inherited mutation database pairs before calling stock `createPostgresFixture()` with no private-container hooks/options. Migrate committed migrations; use actual `verifyMigratedSchema({databaseAdminUrl: fixture.ownerUrl, applicationUrl: fixture.appUrl})`. Pass the matching supported `US042_MUTATION_DATABASE_ADMIN_URL`/`US042_MUTATION_DATABASE_URL` pair privately to actual suite execution. Clean up only the owned fixture database; stock wrapper owns its shared cluster. Never print URLs, credentials, connection errors containing secrets, or query data. Record source/suite hashes, nonsecret schema verification identity, shard identity, exit codes, individual discovery/migrate/schema/suite and total composed-preflight seconds. Require execution proves both files and their real tests ran despite `passWithNoTests`.

This composition is genuine route/runtime verification, not native diff preflight, a Stryker campaign, synthetic runtime provider or a mutation score. A config/profile/runtime failure stops with evidence; no harness repair or historical whole campaign. Final US-075 still owes native preflight and actual cold mutation evidence.

## Evidence interpretation

Ruling: under Francisco instruction “More ruling? Nous is not a nanny, decide with astray and get to work” and independent Astra PROCEED decision, runtime proof uses existing `ac_pass`, fresh adversarial `ac_verify`, `phase` and `feedback`, with real times/identities. This narrow explicit exception changes only original allocation’s `test_report` event name. `test_report` remains reserved for actual mutation results; FEEDBACK.md requires mutation counts/score and the terminal model requires a cold attempt. If this interpretation is wrong, downstream evidence may need reconciliation; no core contract is modified. Record the exception as a postapproval deviation.

## Verification and ordering

Focused exact assertions kill deletion/wrong-path/adjacent-selection regressions without coverage-only test additions or mocks. Run them separately through actual stock imports if the known unrelated whole Node harness page fixture blocks its top-level script; disclose that baseline and do not patch or claim whole-suite green. Run ordinary own-base preflight after the task; own `.mjs` and paperwork paths produce zero TS shards and need no mutation preview. Root independently checks exact additive changes and genuine runtime logs; a fresh reviewer adversarially verifies the three ACs when the harness permits. The same CHG-081 controller session acts as sole inline implementer under forced executing-plans fallback, because existing reviewer resume and new worker dispatch failed agent-thread limit. This is recorded as a process deviation, not fabricated worker provenance.

Order: route/runtime proof, revised US-075 approved readiness, US-075 functional/legacy alert fixture fix within 20 paths, one coordinated awake green regular gate, separate CHG-079/080/081 closures, then US-075. Current shared gate is red; no CHG-081 build_pass/done until green. Gate uses existing exclusive shared lock; do not duplicate it or remove a foreign owner. Separate CHG-081 actuals records measured phase/cost provenance, zero own cold attempts/invalidations when observed eligibility is zero, and done.cost. Stop at boundaries if remaining work exceeds approved forecast.
