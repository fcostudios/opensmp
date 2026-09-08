**Work item:** CHG-057
**Readiness assessment:** docs/readiness/CHG-057.json
**Approved estimate:** 260 minutes

# CHG-057 Mutation Campaign Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one diff-scoped campaign expose every shard failure, surface prerequisites in `pnpm check`, and record observed shard counts without invalidating approved readiness.

**Architecture:** Split mutation-scope into generation/preflight and execution responsibilities while preserving one public runner. Wrap sequential shard execution in per-shard failure and cleanup boundaries, aggregate closed failure records at the end, and retain exact selector-based previews as non-authoritative runs.

**Tech Stack:** Node.js ESM, native `node:test`-style assertions in the repository fixture harness, pnpm, Stryker 9, JSON readiness and mutation-performance evidence.

**Spec:** `docs/superpowers/specs/2026-09-08-chg-057-mutation-campaign-contract-design.md`

## Global Constraints

- Work item `CHG-057`; approved readiness estimate 260 minutes, below the 320-minute cap.
- The approved runner scope is `scripts/mutation-scope.mjs`, `scripts/test-mutation-scope.mjs`, `package.json`, and `docs/dev-guide/WORK_READINESS.md`; the closed actuals contract additionally requires `scripts/work-readiness/model.mjs`, `scripts/test-work-readiness.mjs`, and `docs/dev-guide/work-readiness.schema.json`, recorded as a pre-implementation deviation.
- Sequential execution is mandatory; ordinary failures aggregate, while SIGINT and SIGTERM interrupt immediately after cleanup.
- A calculated shard-count mismatch reports and becomes deviation/actuals evidence; it never rejects approved readiness and introduces no gate error code.
- `MUTATION_SHARD` is preview-only; a preview never emits `test_report` or authoritative performance evidence.
- One cold complete diff-scoped campaign runs after adversarial verification and is the last executable task. Any later implementation commit invalidates it.
- At any task boundary, if remaining work is judged to exceed the approved estimate, record a timestamped `blocked` or `deviation` event before continuing.

---

### Task 1: Define exhaustive failure and cleanup behavior

**Files:**
- Modify: `scripts/test-mutation-scope.mjs`
- Modify: `scripts/mutation-scope.mjs`

**Interfaces:**
- Consumes: `runMutationScope(options)` and injected `executeShard`, `databaseSandboxFactory`, and `verificationRunner` boundaries.
- Produces: `MutationShardFailure` records shaped as `{ shardId, stage, message, status }` and one aggregate `MutationCampaignError` with ordered `failures`.

- [ ] **Step 1: Write the failing multi-failure test**

Create two routed source shards in a temporary real Git repository. Inject an executor that returns distinct non-zero statuses and records both ids. Assert `runMutationScope` rejects only after both ids were observed, its `failures` array names both shard ids with stage `execute`, and the persisted run outcome is `failed`.

- [ ] **Step 2: Verify RED**

Run `rtk pnpm test:mutation-scope`. Require the fixture to show only the first execution under current stop-at-first behavior.

- [ ] **Step 3: Implement closed failure capture**

Add a stage-tagging helper and aggregate error type. Wrap each sequential shard in `try/catch/finally`, update shard/performance status on failure, clean its sandbox in `finally`, continue after ordinary failures, and throw the deterministic aggregate after the loop. Preserve immediate signal-return paths.

- [ ] **Step 4: Add cleanup and stage tests**

Add fixtures where sandbox creation, report freshness, threshold validation, verification, and cleanup fail. Assert later shards still run, every failure uses the correct closed stage, and each created sandbox is cleaned exactly once. Name the production regression each fixture catches in its assertion message.

- [ ] **Step 5: Reach focused GREEN**

Run `rtk pnpm test:mutation-scope`; require every existing cache, signal, report, identity, and database test plus the new aggregate cases to pass.

### Task 2: Add non-campaign preflight, count reporting, and previews

**Files:**
- Modify: `scripts/test-mutation-scope.mjs`
- Modify: `scripts/mutation-scope.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: generated shard manifest and `runMutationScope({ mode, shardSelector })` options derived from CLI `--preflight` and `MUTATION_SHARD`.
- Produces: preflight result `{ mutation_shards_actual, expected_mutation_shards, mismatch, shards }`; preview result marked `authoritative: false`.

- [ ] **Step 1: Write failing preflight tests**

Exercise real fixture repositories whose accountable route, database template, zero-mutant eligibility, or adapter/config input is invalid. Assert `--preflight` returns non-zero for each defect and creates neither `reports/mutation-performance` nor a Stryker report.

- [ ] **Step 2: Write the report-not-reject test**

Supply an approved readiness fixture with `expected_mutation_shards: 1` and a diff generating two shards. Assert preflight exits zero, reports `mutation_shards_actual: 2`, `mismatch: true`, and does not edit the readiness file.

- [ ] **Step 3: Verify RED**

Run `rtk pnpm test:mutation-scope`; require failures because preflight and selectors do not yet exist.

- [ ] **Step 4: Implement preflight mode**

Separate shard discovery/configuration and prerequisite validation from campaign evidence creation. Parse only `--preflight`; reject unknown CLI arguments. Print one canonical JSON summary after validation, never create performance/cache/report artifacts, and never reject solely for count mismatch.

- [ ] **Step 5: Implement exact preview selection**

Filter the generated set by exact `MUTATION_SHARD`. Reject zero or multiple matches before execution. Mark selected execution non-authoritative and suppress performance evidence while retaining report validation and cleanup. With no selector, keep the full set.

- [ ] **Step 6: Wire the repository check**

Add `mutation:preflight` as `node scripts/mutation-scope.mjs --preflight` and place `pnpm mutation:preflight` at the start of `pnpm check`. Do not add a second mutation campaign command.

- [ ] **Step 7: Reach focused GREEN**

Run `rtk pnpm test:mutation-scope` and an explicit `rtk pnpm mutation:preflight`. Require all fixtures green and no authoritative campaign evidence from preflight or preview.

### Task 3: Document actuals and single evidence commit semantics

**Files:**
- Modify: `docs/dev-guide/WORK_READINESS.md`
- Modify: `docs/dev-guide/work-readiness.schema.json`
- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/work-readiness/model.mjs`

**Interfaces:**
- Consumes: existing closed actuals validation.
- Produces: optional non-negative integer `actuals.mutation_shards_actual` and documented one-evidence-commit closure.

- [ ] **Step 1: Write the failing actuals contract test**

Add a complete actuals fixture containing `mutation_shards_actual: 2`; assert validation accepts it. Add negative and fractional fixtures and assert closed-shape validation rejects them without introducing a shard-mismatch error.

- [ ] **Step 2: Verify RED**

Run `rtk pnpm test:work-readiness`; require the valid fixture to fail because the current actuals shape does not accept the field.

- [ ] **Step 3: Implement and document the field**

Accept optional `mutation_shards_actual` as a non-negative integer in completed actuals. Document that preflight count mismatch is recorded as a timestamped deviation, actual count calibrates estimates, readiness remains immutable, and all post-campaign evidence lands in one final evidence commit.

- [ ] **Step 4: Reach focused GREEN**

Run `rtk pnpm test:work-readiness` and `rtk pnpm readiness:check -- CHG-057`.

### Task 4: Review, integrate, and commit implementation

**Files:**
- Commit: the production and test paths changed by Tasks 1–3.

**Interfaces:**
- Consumes: focused-green implementation.
- Produces: one reviewed CHG-057 implementation commit before the authoritative campaign.

- [ ] **Step 1: Adversarially verify failure ordering**

Exercise simultaneous execution, verification, and cleanup failures; confirm deterministic ordering, all later shards run, failed shards never enter cache, and signals still stop immediately.

- [ ] **Step 2: Adversarially verify preflight and preview boundaries**

Confirm preflight does not spawn Stryker or write evidence, an unknown selector fails closed, a selector cannot claim authority, and an unselected campaign runs every generated shard.

- [ ] **Step 3: Run all non-mutation gates**

Run `rtk pnpm check` and `rtk pnpm readiness:check -- CHG-057`. Fix every finding and rerun before committing.

- [ ] **Step 4: Commit the reviewed implementation**

Stage explicit CHG-057 implementation paths and commit `fix(CHG-057): run every mutation shard before reporting failures`. Do not modify implementation afterward.

### Task 5: Run the authoritative campaign and close once

**Files:**
- Modify after executable verification only: `.nous-feedback.jsonl`
- Modify after executable verification only: `docs/readiness/CHG-057.json`

**Interfaces:**
- Consumes: reviewed implementation commit and the CHG-057 authority base.
- Produces: one final `test_report`, measured actuals including `mutation_shards_actual`, and terminal evidence.

- [ ] **Step 1: Run one cold complete campaign LAST**

Run `rtk pnpm mutation:cache:clear`, then `MUTATION_BASE=authority/chg-057-base rtk pnpm test:mutation` with no selector. Record every selected shard, aggregate score, killed/survived counts, and wall clock. Do not emit a report for previews.

- [ ] **Step 2: Record actuals and timestamped lifecycle evidence**

Fill actuals from Git and measured output, including `mutation_shards_actual`; if it differs from the approved expectation, append a timestamped `deviation`. Append timestamped `ac_verify`, `build_pass`, one `test_report`, and `done` events.

- [ ] **Step 3: Make the one evidence commit**

Commit only `.nous-feedback.jsonl` and `docs/readiness/CHG-057.json` as `docs(CHG-057): record mutation campaign evidence`. No executable verification or implementation commit follows.

## Self-review

- Every approved outcome maps to an executable task and observable verification.
- Count mismatch reports but never rejects or mutates the approved payload.
- Full campaigns remain sequential and exhaustive; preview selection is exact and non-authoritative.
- Signal and database cleanup semantics stay fail-closed.
- The final campaign is cold, complete, and last; only one evidence commit follows.
