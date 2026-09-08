**Work item:** CHG-058
**Readiness assessment:** docs/readiness/CHG-058.json
**Approved estimate:** 300 minutes

# CHG-058 Faster Child Mutation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical partition children honestly sized and mutation-ready before their one final cold campaign.

**Architecture:** Add a pure planned-scope mode to the existing mutation router, then use its canonical output to reassess US-065 and US-066. Keep task previews as orchestration in implementation plans, align the shared PostgreSQL fixture with the router’s generic story-scoped database-pair selection, and document strict parent-design inheritance.

**Tech Stack:** Node.js ESM, TypeScript, Vitest, PostgreSQL/Testcontainers, pnpm, Stryker 9, JSON readiness evidence.

**Spec:** `docs/superpowers/specs/2026-09-08-chg-058-faster-child-mutation-workflow-design.md`

## Global Constraints

- Work item `CHG-058`; approved estimate 300 minutes, below the 320-minute limit.
- Implementation scope is exactly `scripts/mutation-scope.mjs`, `scripts/test-mutation-scope.mjs`, `packages/db/src/testing/postgres-container.ts`, `packages/db/src/testing/postgres-container.test.ts`, `docs/dev-guide/WORK_READINESS.md`, `docs/readiness/US-065.json`, and `docs/readiness/US-066.json`, except for append-only feedback and final actuals evidence.
- Planned-scope calculation reuses production mutation routing and performs no Stryker execution, runtime database probe, cache/report/performance write, or readiness mutation.
- Planned paths are unique canonical repository-relative POSIX paths; invalid, generated, missing, non-regular, duplicate, absolute, traversing, or unrouted production paths fail closed.
- Every implementation task runs previews for all post-task shards intersecting its touched production sources and repairs genuine survivors before task completion. Previews never emit `test_report` or authoritative performance evidence.
- The one cache-cleared diff-scoped campaign remains last after adversarial review and `pnpm check`; later code or test commits invalidate it.
- A partition child skips its design only through the exact parent-design inheritance contract in the spec; US-065 and US-066 cite the approved US-019/CHG-054/Sprint 3 authority.
- US-065 and US-066 each total 224 minutes and remain unexecutable until their new exact digests receive human approval.
- The database fixture accepts exactly one complete `US<digits>_MUTATION_DATABASE_{URL,ADMIN_URL}` pair and rejects incomplete or ambiguous story-scoped inputs.
- Tests exercise real owned behavior; no source-text assertions, owned-module mocks, uncontrolled network, or unasserted no-throw cases.
- At any task boundary, if remaining work is judged to exceed 300 minutes, append a timestamped `blocked` or `deviation` event before continuing.

---

### Task 1: Pure planned-scope mutation calculation

**Files:**
- Modify: `scripts/mutation-scope.mjs`
- Modify: `scripts/test-mutation-scope.mjs`

**Interfaces:**
- Produces: `calculatePlannedMutationScope(paths, dependencies?) => PlannedMutationScope` with canonical `expected_changed_files`, `expected_mutation_shards`, `files`, and closed shard summaries.
- Produces: CLI `node scripts/mutation-scope.mjs --planned-scope <path>...`.
- Consumes: existing mutatable filters, full-file target construction, accountable-test routing, exact/static classifiers, and shard grouping.

- [ ] **Step 1: Write the failing pure calculation fixture**

Create a temporary real Git repository containing two routed TypeScript sources, their real test files, and one Markdown path. Call `calculatePlannedMutationScope` with an intentionally unsorted path list and assert the literal sorted files, `expected_changed_files: 5`, `expected_mutation_shards: 2`, and exact sorted shard source/test membership. The production break named by this test is a readiness estimate that silently omits or merges a planned mutation boundary.

- [ ] **Step 2: Verify RED**

Run `rtk pnpm test:mutation-scope` and require failure because `calculatePlannedMutationScope` is not exported.

- [ ] **Step 3: Extract reusable discovery without changing campaign behavior**

Factor the existing target classification and shard grouping into one internal function accepting canonical changed paths plus a target provider. Keep ordinary diff preflight on Git hunks. Implement the planned provider as each current source’s complete `path:1-N` range, while preserving reviewed static target ranges. Return immutable, sorted summaries without config/report paths or runtime identities.

- [ ] **Step 4: Reach pure GREEN**

Run `rtk pnpm test:mutation-scope`; require the new fixture and every existing campaign, preflight, cache, signal, routing, and sandbox case to pass.

- [ ] **Step 5: Write failing path and side-effect CLI tests**

Add table cases for empty input, absolute path, `..`, NUL, duplicate path, directory, missing path, generated artifact, unknown flag, flag after a planned path, `--preflight` conflict, `MUTATION_SHARD` conflict, and a mutatable source without an accountable route. Add one child-process success case and assert exact JSON plus absence of `.tmp/stryker-shards`, `reports/mutation`, `reports/mutation-performance`, and mutation-cache writes.

- [ ] **Step 6: Verify CLI RED**

Run `rtk pnpm test:mutation-scope`; require the new CLI cases to fail because `--planned-scope` is unknown.

- [ ] **Step 7: Implement the closed CLI mode**

Parse `--planned-scope` only when it is the first argument, require at least one following path and no flag-shaped tail, reject conflicting environment/mode inputs, call the pure calculator, print exactly one canonical JSON object, and exit without entering `runMutationScope`.

- [ ] **Step 8: Prove grouping equivalence**

Add a fixture that feeds the same full-file targets to planned calculation and the extracted ordinary discovery boundary. Assert literal equality of shard kinds, sources, tests, and mutation targets. Rerun `rtk pnpm test:mutation-scope` and require pristine GREEN.

- [ ] **Step 9: Commit Task 1**

Stage exactly the two Task 1 files and commit `feat(CHG-058): calculate mutation shards from planned scope`.

- [ ] **Step 10: Run the Task 1 preview boundary**

Run `MUTATION_WORK_ID=CHG-058 MUTATION_BASE=authority/chg-058-base rtk pnpm mutation:preflight`. Confirm no returned shard intersects `scripts/mutation-scope.mjs` because executable JavaScript tooling is outside the TypeScript mutation surface; record the zero-preview result in the task report and emit no `test_report`.

---

### Task 2: Generic story-scoped PostgreSQL mutation fixture

**Files:**
- Modify: `packages/db/src/testing/postgres-container.ts`
- Modify: `packages/db/src/testing/postgres-container.test.ts`

**Interfaces:**
- Produces: `selectMutationDatabasePair(environment)` returning `null` or `{ prefix, appUrl, ownerUrl }`.
- Consumes: exact `US<digits>_MUTATION_DATABASE_URL` and `US<digits>_MUTATION_DATABASE_ADMIN_URL` environment keys.
- Preserves: `createPostgresFixture(options)` and its normal Testcontainers and template-clone behavior.

- [ ] **Step 1: Write failing selector tests**

Use literal environments to require: no story keys returns `null`; one complete US-065 pair returns that exact pair; one complete US-066 pair behaves identically; app-only and owner-only pairs throw an incomplete-pair error naming only the safe prefix; and simultaneous complete US-065/US-066 pairs throw ambiguity. These tests catch selection by historical US-017 names or lexicographic first match.

- [ ] **Step 2: Verify selector RED**

Run `rtk pnpm --filter @smp/db test -- src/testing/postgres-container.test.ts` and require failure because the generic selector is absent.

- [ ] **Step 3: Implement the minimal selector**

Enumerate exact matching keys, group by `US<digits>`, reject any incomplete group before selecting, return the sole complete pair, reject multiple complete pairs, and return `null` only when no story-scoped key exists. Do not read generic `DATABASE_URL` or combine prefixes.

- [ ] **Step 4: Reach selector GREEN**

Rerun the focused DB test and require every selector and existing container-cleanup assertion to pass.

- [ ] **Step 5: Write failing real clone and cleanup cases**

Against a real PostgreSQL template fixture, set one complete US-065 pair, call `createPostgresFixture`, assert its database name is distinct from the template, connect through both returned roles, stop it idempotently, and prove the cloned database is gone. Repeat selection with US-066 to prove the prefix is not special. Restore the process environment in `finally` so no test leaks a mutation URL.

- [ ] **Step 6: Verify integration RED**

Run `rtk pnpm --filter @smp/db test -- src/testing/postgres-container.test.ts`; require the US-065 clone case to take the normal container path or otherwise fail before the production fixture uses the selector.

- [ ] **Step 7: Wire the selector into the fixture**

Replace direct US-017 environment reads with `selectMutationDatabasePair(process.env)`. Derive a neutral `ledger_mutation_<uuid>` database name, preserve owner/app role separation and template validation, and retain the existing termination, drop, and idempotent stop behavior.

- [ ] **Step 8: Reach focused GREEN**

Run `rtk pnpm --filter @smp/db test -- src/testing/postgres-container.test.ts` and `rtk pnpm test:mutation-scope`; require pristine output.

- [ ] **Step 9: Commit Task 2**

Stage exactly the two Task 2 files and commit `fix(CHG-058): generalize mutation database fixtures`.

- [ ] **Step 10: Preview every Task 2 shard**

Run `MUTATION_WORK_ID=CHG-058 MUTATION_BASE=authority/chg-058-base rtk pnpm mutation:preflight`. Read the generated manifest, select every shard whose `sources` contains `packages/db/src/testing/postgres-container.ts`, and run each exact ID with `MUTATION_BASE=authority/chg-058-base MUTATION_SHARD=<id> rtk pnpm test:mutation`. Repair genuine survivors through RED/GREEN and rerun affected previews until each is at least 80%. Emit no `test_report`.

---

### Task 3: Planning and parent-design inheritance contract

**Files:**
- Modify: `docs/dev-guide/WORK_READINESS.md`

**Interfaces:**
- Produces: the mandatory per-task preview paragraph and the closed partition-child design-inheritance rule.
- Consumes: the existing implementation-plan header, task-boundary self-report, preflight, preview, and final campaign contracts.

- [ ] **Step 1: Add the plan-task preview contract**

Immediately after the task-boundary self-report, document that each implementation task names its production sources, runs post-task preflight, previews every intersecting shard, repairs genuine survivors before task review, and records zero when no shard intersects. State that IDs are discovered after the task and never hardcoded.

- [ ] **Step 2: Preserve the authority boundary**

State explicitly that previews are non-authoritative, do not clear the authoritative cache, emit no `test_report` or mutation-performance evidence, and never replace adversarial verification, `pnpm check`, or the final cold campaign.

- [ ] **Step 3: Add strict design inheritance**

Document the four eligibility conditions from the spec and bind US-065/US-066 to `docs/readiness/US-019.json`, DEC-SMP-021/CHG-054, their generated stories, and the US-019 section of `docs/superpowers/plans/2026-08-02-sprint-3-delivery.md`. Require the child plan’s `Spec` field to cite that authority; otherwise require a child design.

- [ ] **Step 4: Verify documentation consistency**

Run `rtk rg -n 'preview|authoritative|parent design|US-065|US-066' docs/dev-guide/WORK_READINESS.md` for review navigation, then read the surrounding sections and verify there is one final-campaign rule and no contradictory design requirement. Run `rtk git diff --check`.

- [ ] **Step 5: Commit Task 3**

Stage exactly `docs/dev-guide/WORK_READINESS.md` and commit `docs(CHG-058): require task mutation previews and design inheritance`.

- [ ] **Step 6: Record the Task 3 preview result**

Run the CHG-058 preflight from Task 2 and confirm no shard intersects the Markdown-only task. Record zero previews in the task report and emit no `test_report`.

---

### Task 4: Reassess US-065 and US-066 from planned scope

**Files:**
- Modify: `docs/readiness/US-065.json`
- Modify: `docs/readiness/US-066.json`

**Interfaces:**
- Consumes: Task 1 planned-scope canonical JSON and the approved inherited parent design.
- Produces: two pending-approval `ready` assessments totaling 224 minutes with calculated file and shard signals.

- [ ] **Step 1: Calculate US-065 planned scope**

Run planned-scope calculation over this exact existing-path set:

```text
apps/worker/src/jobs/automated-invite-delivery.ts
apps/worker/src/jobs/automated-invite-delivery.integration.test.ts
apps/worker/src/alerts/report-job-failure.ts
apps/worker/src/alerts/report-job-failure.integration.test.ts
packages/db/src/provisioning-routing.ts
packages/db/src/provisioning-routing.test.ts
packages/domain/src/request-workflow/lifecycle.ts
packages/domain/src/request-workflow/lifecycle.test.ts
apps/web/src/modules/request-workflow/actions/checklist.ts
apps/web/src/modules/request-workflow/actions/checklist-action-production-dependencies.ts
apps/web/src/modules/request-workflow/actions/checklist-action-transaction.ts
apps/web/src/modules/request-workflow/actions/checklist-action-transaction.test.ts
apps/web/src/components/requests/checklist-exceptions-list.tsx
apps/web/src/components/requests/checklist-exceptions-list.test.tsx
apps/web/src/app/(authenticated)/excepciones/page.tsx
apps/web/messages/en-US.json
apps/web/messages/es-EC.json
```

Capture the canonical output. Do not delete a path to lower the count; a later implementation may narrow scope only with a recorded reason.

- [ ] **Step 2: Reassess US-065**

Set `signals.expected_changed_files` and `signals.expected_mutation_shards` to the calculated integers. Resolve U1 with US-063 and US-064 terminal evidence, include both as completed dependencies, set `decision: "ready"`, and set phases to readiness 10, implementation 90, focused verification 35, review 65, integration 24, total 224. Reset approval to pending with the new computed payload digest and leave actuals null.

- [ ] **Step 3: Calculate US-066 planned scope**

Run planned-scope calculation over this exact existing-path set:

```text
apps/worker/src/index.ts
apps/worker/src/index.test.ts
apps/worker/src/runtime.ts
apps/worker/src/runtime.integration.test.ts
apps/worker/src/jobs/deferred.ts
apps/worker/src/jobs/deferred.test.ts
apps/worker/src/connector-composition.ts
apps/worker/src/connector-composition.test.ts
packages/connectors/src/providers/anthropic/connector.ts
packages/connectors/src/providers/anthropic/connector.test.ts
packages/connectors/src/providers/anthropic/request.ts
packages/connectors/src/providers/anthropic/request.test.ts
packages/db/src/provisioning-routing.ts
packages/db/src/provisioning-routing.test.ts
packages/domain/src/request-workflow/lifecycle.ts
packages/domain/src/request-workflow/lifecycle.test.ts
```

Capture the canonical output under the same no-undercount rule.

- [ ] **Step 4: Reassess US-066**

Set both signal counts from the calculation. Resolve U1 with US-063 terminal evidence, retain its completed dependency, set `decision: "ready"`, and use the same 10/90/35/65/24 phase allocation totaling 224. Reset approval to pending with the new computed digest and leave actuals null.

- [ ] **Step 5: Validate candidate assessments**

Run the readiness model against both files and require the only expected execution blocker to be pending human approval. Verify each canonical digest independently and print both exact SHA-256 values for Francisco.

- [ ] **Step 6: Record human decisions**

After Francisco approves both exact digests, append closed-shape decisions `US065-READY-CHG058` and `US066-READY-CHG058`, fill each approval object with the matching digest, and run `rtk pnpm readiness:check -- US-065`, `rtk pnpm readiness:check -- US-066`, and `rtk pnpm test:feedback-order`.

- [ ] **Step 7: Commit Task 4**

Stage exactly both readiness files and `.nous-feedback.jsonl`; commit `docs(CHG-058): reassess US-065 and US-066 from planned scope`.

- [ ] **Step 8: Record the Task 4 preview result**

Run the CHG-058 preflight and confirm the JSON/readiness-only task intersects no mutation shard. Record zero previews and emit no `test_report`.

---

### Task 5: Adversarial verification and immutable source commit

**Files:**
- Commit: the seven implementation paths from Tasks 1–4 plus append-only feedback already introduced by Task 4.

**Interfaces:**
- Consumes: all reviewed tasks and their preview results.
- Produces: one immutable CHG-058 source cutoff before the final campaign.

- [ ] **Step 1: Adversarially verify planned scope**

Exercise reordered paths, duplicate aliases, missing routes, generated outputs, conflicting flags, static targets, non-mutatable-only sets, and a two-shard set. Require deterministic JSON and zero report/cache/performance side effects.

- [ ] **Step 2: Adversarially verify fixture selection**

Exercise US-017, US-065, and US-066 as ordinary complete pairs; incomplete and ambiguous environments; template-name rejection; bootstrap failure; concurrent stop; and cleanup failure. Require no secret URL in diagnostics and no leaked database/container.

- [ ] **Step 3: Run the complete repository gate**

Run `rtk pnpm check` from a fresh PostgreSQL runtime profile. Require mutation preflight, type-check, lint, every test suite, schema verification, and all production builds to pass.

- [ ] **Step 4: Run independent whole-branch review**

Review the complete range from `authority/chg-058-base` for exact spec coverage, fail-closed path handling, zero planning-mode side effects, test quality, fixture cleanup, readiness arithmetic, and documentation consistency. Repair every Critical or Important finding through RED/GREEN, rerun its task preview, and repeat the complete gate after the final repair.

- [ ] **Step 5: Commit the final reviewed source if repairs exist**

Stage only reviewed implementation/test paths and commit `fix(CHG-058): close adversarial workflow gaps`. If no tracked repair exists, retain the last task commit as the immutable source cutoff.

---

### Task 6: One final cold campaign and evidence closure

**Files:**
- Modify: `.nous-feedback.jsonl`
- Modify: `docs/readiness/CHG-058.json`

**Interfaces:**
- Consumes: immutable reviewed source cutoff and `authority/chg-058-base`.
- Produces: exactly one authoritative `test_report`, complete actuals, and terminal `done` evidence.

- [ ] **Step 1: Append pre-campaign evidence**

Append timestamped `started`, three `ac_verify` events covering the four outcomes, any honest deviations, and one `build_pass` naming the immutable source commit. Do not emit `test_report` yet.

- [ ] **Step 2: Clear mutation caches**

Run `rtk pnpm mutation:cache:clear` and record the cleared-entry count in the eventual report notes.

- [ ] **Step 3: Run the sole authoritative campaign LAST**

Run `MUTATION_WORK_ID=CHG-058 MUTATION_BASE=authority/chg-058-base rtk pnpm test:mutation` without `MUTATION_SHARD`. Require every calculated shard to complete and every scored shard to meet 80%. If a real code/test fix is required, append `mutation_invalidation`, repair through TDD and review, rerun `pnpm check`, clear caches, and run at most one replacement cold campaign.

- [ ] **Step 4: Record actuals and terminal events**

Populate CHG-058 actuals with reproducible phase minutes, total, changed files, commits, review loops, cold attempts, invalidations, summed mutation minutes, actual shard count, estimate variance, and exact Git/time formulas. Append exactly one timestamped `test_report` for the retained campaign and a later timestamped `done` event naming the immutable tested source commit.

- [ ] **Step 5: Verify closure**

Run `rtk pnpm readiness:check -- CHG-058`, `rtk pnpm readiness:check -- US-065`, `rtk pnpm readiness:check -- US-066`, `rtk pnpm test:feedback-order`, `rtk git diff --check`, and the Nous CHG-058 timeline/status surfaces after pulling feedback. Require no conformance findings.

- [ ] **Step 6: Commit evidence only**

Stage exactly `.nous-feedback.jsonl` and `docs/readiness/CHG-058.json`; commit `docs(CHG-058): record faster child mutation evidence`. This evidence-only commit does not invalidate the campaign.
