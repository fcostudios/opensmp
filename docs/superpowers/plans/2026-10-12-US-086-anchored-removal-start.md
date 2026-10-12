**Work item:** US-086
**Readiness assessment:** docs/readiness/US-086.json
**Approved estimate:** 230 minutes

# US-086 Anchored Removal Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with the supplied consolidated shape: one implementer for all tasks, one reused scoped reviewer, one fresh adversarial reviewer. Steps use checkbox syntax for tracking.

**Goal:** Deliver canonical removal start from both detail screens, including refusal without writes and effective assurance of inherited production.

**Architecture:** Retain the production intent executor, company-scoped SQL repository and shared PersonOffboarding component. Replace inherited successful start replay with canonical refusal; extend existing real-DB/UI suites for exposed mutants. Preserve separate completion and connector-worker ownership.

**Tech Stack:** Next.js16 / React19, TypeScript, Drizzle/PostgreSQL, Vitest/testing-library, next-intl, native Stryker routing.

**Spec:** `docs/superpowers/specs/2026-10-12-US-086-anchored-removal-start.md`; canonical `docs/stories/sprint-3/r1_misc_us_086.md`.

## Global constraints

- Approved readiness `9a4a88e0e8a41ef1c6848d9b4971969206a30a90a8e212b7ba269e3b0fc39f1e`;230 minutes total;15 delivery +4 bookkeeping paths only.
- `MUTATION_BASE=783d09df4467e27462dec440cc64ac4855d02e02`, `MUTATION_WORK_ID=US-086`; expected seven native shards, independently attributed three entry shards. Current entry HEAD cannot hide inherited sources.
- Read TESTING.md before test edits. Real owned services and shared CHG-067 PostgreSQL; no private containers, owned mocks, source filters or threshold changes.
- One green checkpoint per task; source commits carry US-086. Record real phase timestamps and estimated/measured costs honestly.
- Previews≤30 minutes; one per task plus final fix wave, touched shards only; slow (>5min) untouched shards once in final preview. One cache-cleared cold campaign last after AC review fixes.
- Gate holds exclusively owned `/tmp/smp-full-gate.lock` for `caffeinate -i pnpm check`; wait≥60s for foreign owner, verify token/device/inode before cleanup.

## Review focus

1. Repeated command after successful start must refuse and leave exact durable counts unchanged, not invalidate pages.
2. Two starts on the same active anchor must serialize to one winner and one refusal, while unrelated seats remain active.
3. Target discovery pending/failure must block mutation, suppress duplicate discovery and remain retryable without fake service responses.
4. Pending submission and stale authorization must preserve truthful UI/error state, not display completion or duplicate writes.
5. Default localized labels and fixed-request targeting must remain correct without supplied test-only labels or target lists.

---

### Task1: Refuse repeated start and prove the locked one-winner transaction

**Files:** Modify `apps/web/src/modules/org-registry/repository.ts`; test `apps/web/src/modules/org-registry/repository.integration.test.ts`. Service/core are retained consumers, edit only if an observed contract defect requires an in-scope repair.

**Interfaces:** Consume `executeOffboardingIntent(repository, authorization, input, occurredAt)` and repository `startOffboarding(authorization,input,occurredAt)`. Produce unchanged successful response; repeated/stale start maps to `{ok:false,globalError:"person_offboarding_unavailable"}` with `invalidationPaths:[]`.

- [ ] Write RED exact real-DB sequential replay assertion: first start succeeds; second executor call has the refusal above; durable action1/transition1/audit pair2 remains unchanged, assignment open, person active. Replace inherited replay-success assertions throughout this suite, retaining meaningful anchor-corruption assertions.
- [ ] Write RED true concurrent-start case on an initially active fresh anchor, not two calls after an already completed start. Use real PostgreSQL row-lock scheduling if needed; inject the same clock. Assert exactly one success and one refusal, one pending remove/one transition, exact audit pair, unrelated seat active and no capacity movement. Do not mock repository internals.
- [ ] Run `rtk pnpm --dir apps/web test -- src/modules/org-registry/repository.integration.test.ts`; record RED reason before production edit.
- [ ] Implement minimal canonical refusal in repository.startOffboarding: lock and require active state before writes; reject already-offboarding with existing unavailable error. Remove obsolete successful replay logic because the story now forbids it, preserving active-anchor/persisted-action/assignment validation and atomicity.
- [ ] Re-run focused suite and `rtk pnpm --dir apps/web type-check`; keep existing foreign-role/tenant/malformed/transfer/descriptor assertions green. Assert read_targets remains write-free and mutation success has exact real revalidation paths.
- [ ] Commit green checkpoint `fix(US-086): refuse repeated anchored removal starts`; provide reviewer AC1/2, diff range, actual commands/results. Launch touched repository preview only after focused green; if its previous wall exceeded5min, defer it to the final preview rather than rerun an untouched slow shard.

### Task2: Close exposed PersonOffboarding assurance gaps through real execution

**Files:** `apps/web/src/components/people/person-offboarding.test.tsx`, component source only for observed bugs; existing `request-record.test.tsx` for fixed-request/default-label contracts. Existing executor/repository integration suite may support real scheduling cases. No new test files or harness changes.

**Interfaces:** Consume existing `PersonOffboarding({action,labels?,personId,fixedRequestId?,targets?})` and real executor/authorization repository from Task1. Any adapter delays actual execution or its actual result using controlled promises; it cannot manufacture an owned-service return value.

- [ ] Read retained cold2 person-source mutant IDs/source hashes. Select concrete survivors in loading/pending/duplicate discovery, submit guards, default translations, retained state and error rendering. Each assertion must distinguish its mutant from the current contract.
- [ ] Extend existing real-DB UI fixture with injected clock and deterministic barriers. Exercise deferred read_targets: loading caption and disabled target/confirmation; repeated open while read pending causes one actual discovery; no persistence until a valid selected start.
- [ ] Exercise actual authorization refusal/stale target: change real grants or anchor state before executor work, assert existing localized error and no writes; preserve usable note/selection. Discovery failure retries through actual executor after fixing real authorization/context, without canned results.
- [ ] Exercise pending start and duplicate form submission using held actual executor result: one durable action/transition, truthful pending status/disabled control, success navigation to pending request. Assert note/target defenses and cancel/reopen retained-state contract.
- [ ] Render without supplied labels for real locale defaults; verify person discovery and fixed request targeting, both reasons and checklist/connector descriptor combinations, unrelated-seat and capacity invariants. Retain existing request-record role/state visibility checks.
- [ ] For any exposed production defect, record a focused RED assertion then repair the minimal component/service code within the approved inventory. Do not change source guards merely to eliminate surviving mutants. Unobservable survivors require precise reviewed equivalence, not blanket labels.
- [ ] Run `rtk pnpm --dir apps/web test -- src/components/people/person-offboarding.test.tsx src/components/requests/request-record.test.tsx src/modules/org-registry/repository.integration.test.ts`; then web type-check/lint as appropriate.
- [ ] Commit green checkpoint `test(US-086): exercise pending removal and real refusal UI`; hand AC1–3/diff/commands to the same scoped reviewer. Run touched person preview plus deferred slow repository once in the final round, collect logs/minutes at review boundary. A preview fix joins the bounded final fix wave; no whole-set rerun.

### Final verification and closure (same implementer, fresh adversarial reviewer)

- [ ] Record frozen postapproval entry checkpoint separately from inherited authority base. Preserve historical parent255.0026min and existing reports/foreign workspaces.
- [ ] Under stock shared fixture, run accountability preflight and native `MUTATION_BASE=783d09df... MUTATION_WORK_ID=US-086 pnpm test:mutation --preflight`; retain exact commands, source/range hashes, all returned IDs, routing gaps and expected/actual7. No claim from a routing-gap shard. New discovery burden is reassessment, not silently lowering the expectation.
- [ ] Same scoped reviewer checks final task/fix range. Fresh reviewer adversarially verifies AC1–3 through real execution, including wrong role/company, malformed/mismatched target, reallocated/non-active/repeat refusal and concurrent one-winner; both screen/reason/descriptor combinations and unchanged person/register/capacity. Resolve own findings before cold.
- [ ] Run owned-lock awake stock `pnpm check` with inherited authority baseline and real shared fixture. Record cached versus actually executed checks, exact exit/time, migration/schema/owner/app proof and ownership cleanup. Never bypass unrelated failures.
- [ ] Cache-clear then ONE ordinary full native cold campaign last using the full inherited base and no shard selector. Keep all7 raw outputs/report identities/exit. Derive owned report from repository/service +person +request-record only; each source identity must match scored candidate. Own aggregate≥80% and every surviving/uncovered retained mutant reviewed/annotated. Foreign completion failure is named US-087 deviation, not wholecampaign-green; audit evidence remains separately owned.
- [ ] If own score fails, preserve failure/cost and reassess remaining230 envelope before repairs; scored source/test changes invalidate evidence. No additional cold run implicitly authorized as a cost-free retry.
- [ ] Controller records scoped/fresh review, per-AC verification, test_report, phases/actuals, preview_rounds/minutes and honest nonzero done.cost; role/session costs each one line. Count full native runner time once here, not again in US-087 history. Normal-hook closure and fast-forward integration only after own proof; no unapproved new path or boundary.

## Budget and self-review

25 readiness +60 implementation (20 replay/40 UI assurance) +40 focused (15 tests/25 previews) +50 all reviews +55 integration (25 full cold/10 gate/20 proof+closure) =230. Preview/cold times are subsets, not added twice. Parent history is preserved separately. Every canonical AC maps to both tasks and fresh verification; all five review-focus cases have explicit oracles. No completion/worker/calendar/departure/capacity implementation is included.
