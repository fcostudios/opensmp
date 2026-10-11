**Work item:** CHG-081
**Readiness assessment:** docs/readiness/CHG-081.json
**Approved estimate:** 35 minutes

# Lifecycle mutation route implementation plan

> Use executing-plans fallback: the same CHG-081 session is sole inline implementer because worker/reviewer dispatch returned agent thread limit. Root independently reviews design/plan and implementation; fresh adversarial AC review stays pending until an actual fresh context is available. No fabricated delegation or review.

**Goal:** Select and execute both existing lifecycle oracles for the actual source without altering harness semantics.
**Architecture:** One additive direct route plus two exact assertions; stock current-source shard discovery, existing shared PostgreSQL fixture and root Vitest config compose real runtime verification.
**Tech Stack:** Node ESM, TypeScript/tsx, Vitest, PostgreSQL 16.
**Spec:** docs/superpowers/specs/2026-10-11-chg-081-lifecycle-route-design.md

## Global Constraints

- 35 active minutes, six inclusive paths; two harness implementation paths only.
- Source `packages/domain/src/request-workflow/lifecycle.ts`; direct oracle only `apps/web/src/modules/request-workflow/orchestration.integration.test.ts`; adjacent oracle `packages/domain/src/request-workflow/lifecycle.test.ts` remains selected.
- No instrumentation, threshold, routing-gap, harness behavior, schema/model/template, generated/source/application-test or prior technical artifact changes.
- Runtime composition uses actual current files, stock shared cluster fixture with owned DB, committed migrations, real owner/app schema verification and both discovered suites through existing root Vitest mutation config.
- No private container hooks, user credentials, synthetic runtime provider, historical campaign, fabricated score/count/cold attempt or parser-only runtime GREEN.
- Genuine route evidence uses existing ac_pass/ac_verify/phase/feedback under the delegated event-name exception; own expected TS mutation shards zero; no done before shared green gate.

## Review Focus

Deletion/wrong direct route must fail exact map assertion; loss of adjacent suite must fail real-files assertion. Actual runtime proof must execute both discovered files despite passWithNoTests. Owner/app pair must match the migrated fixture, remain private, and cleanup must drop only its DB. Known whole Node harness baseline and failed shared global gate must remain disclosed. These checks belong to Task 1 evidence or Task 2 adversarial review; no shallow tests added.

### Task 1: Add and prove the responsible lifecycle route

**Files:** Modify `scripts/mutation-scope.mjs` and `scripts/test-mutation-scope.mjs`; scratch launcher/report only outside repository.
**Interfaces:** Consumes actual `DIRECT_TEST_ROUTES`, `routedTestFiles(changed, mutate, existsSync)`, `calculatePlannedMutationScope(paths)`, stock `createPostgresFixture()` ownerUrl/appUrl/migrate/stop, and real `verifyMigratedSchema({databaseAdminUrl, applicationUrl})`. Produces committed two-file additive diff and actual runtime evidence.
**Production sources touched:** none; harness route map only, source named above remains unchanged.

- [ ] Read RTK/AGENTS/local testing instructions and TESTING.md before test edit; check committed readiness is ready.
- [ ] Extend existing exact assertions: map equals `["apps/web/src/modules/request-workflow/orchestration.integration.test.ts"]`; real-file routedTestFiles for changed/mutate lifecycle source equals sorted `["apps/web/src/modules/request-workflow/orchestration.integration.test.ts", "packages/domain/src/request-workflow/lifecycle.test.ts"]`. Prove red before additive entry without invoking unrelated whole Node fixture.
- [ ] Add only bounded DIRECT_TEST_ROUTES entry; prove both assertions green. Whole Node harness known obsolete page fixture remains unchanged/disclosed; no false whole-harness green.
- [ ] Run stock actual-source planned discovery, assert actual lifecycle-source shard includes exactly both existing testFiles, then composed real runtime verification as specified in design. Use scratch `.ts` file beside repository tooling only in `/tmp` with absolute imports and stock tsx, or other outside-repo path that stock dependencies resolve; no committed launcher. Require shared cluster env before stock fixture, migrate, actual schema verification, private supported pair, actual root Vitest execution and owned cleanup. Capture both test files/counts and exits, source/suite/schema identities, separate discovery/migrate/schema/suite/total walls; sanitize secrets.
- [ ] Run own frozen-base ordinary preflight; observed zero TS shards means zero mutation preview rounds, not runtime proof.
- [ ] Self-review and commit only two harness files with CHG-081 message; save report with exact commit/base and genuine execution evidence. No started/lifecycle/feedback edits by worker.

### Task 2: Review, evidence handoff and coordinated closure

**Files:** `.nous-feedback.jsonl`, `docs/readiness/CHG-081.json` only. Controller coordinates, reviewers read.
**Interfaces:** Consumes Task 1 commit/report/diff; produces scoped quality/spec and fresh AC verdicts, real operational evidence, later exact six-path closure.
**Production sources touched:** none.

- [ ] Root independently reviews scoped spec compliance and quality using brief/report/full bounded diff package because actual Astra/worker resumes failed at harness thread limit. Sole inline implementer fixes bounded findings; root checks the fix diff.
- [ ] Fresh adversarial reviewer checks AC1 exact additive direct map, AC2 both existing real files selected, AC3 actual current-source runtime composition plus cost and shared-gate state. Do not claim AC3 terminal gate pass before green.
- [ ] Append measured actual route/runtime evidence using ac_pass/ac_verify/feedback/phase and postapproval deviation for delegated event-name exception. Return route/runtime results promptly for US-075 controller resume. No test_report or mutation score for zero TS eligibility.
- [ ] Wait for US-075 approved functional fixture repair and one coordinated awake normal gate under existing exclusive shared lock. No independent duplicate gate. If gate remains red, keep closure pending and report exact blocker.
- [ ] After green gate/review and final own-base zero-shard ordinary eligibility command, update actuals from measured phase envelopes and attributable shared evidence, explicit token/call estimates versus measurements, zero cold attempts/invalidations when eligible. Commit evidence and done.cost together; check own full range and six-path inventory. No source implementation after final mutation eligibility.

## Controller decisions

Ruling: delegated runtime event-name exception permits genuine runtime-only proof in existing ac_pass/adversarial ac_verify/phase/feedback, reserving mutation test_report. Wrong interpretation costs downstream evidence reconciliation; no model/schema is changed. Readiness approval reason explicitly says controller/Astra computed the hash after human delegation, not that Francisco typed or inspected it.

Ruling: forced inline role continuation preserves one CHG-081 session because both existing reviewer resume and fresh worker dispatch failed agent-thread limit. Root remains independent reviewer and does not implement. Wrong fallback costs reduced task-review independence; fresh AC review and green gate are still required for closure.
