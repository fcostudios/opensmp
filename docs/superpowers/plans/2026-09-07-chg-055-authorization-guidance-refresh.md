**Work item:** CHG-055
**Readiness assessment:** docs/readiness/CHG-055.json
**Approved estimate:** 120 minutes

# CHG-055 Authorization Guidance Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the exact five-file IMP-397/399 refresh and register its three new emitted guidance states immutably.

**Architecture:** Append a closed three-file CHG-055 layer after CHG-053, using the CHG-049 desired artifacts as immutable predecessors. Preserve emitted and local-extension bytes exactly, then bind the reviewed reconciler hash.

**Tech Stack:** Python 3 standard library and unittest, SHA-256 overlay manifests, Node.js readiness enforcement, pnpm verification, Stryker diff routing.

**Spec:** `docs/superpowers/specs/2026-09-07-chg-055-authorization-guidance-refresh-design.md`

## Global Constraints

- Preserve the five delivered paths byte-for-byte.
- Tenant guidance is edited only in `docs/dev-guide/local/*.md`; never edit an emitted target after this carry.
- Leave `AGENTS.md` untouched.
- Stage exact named paths only; never use `git add -A`.
- Run adversarial verification before one cache-cleared diff-scoped mutation campaign, which is the final executable task.
- At each task boundary, stop and file a deviation if the remaining work will exceed 120 minutes.

---

### Task 1: Establish lifecycle and failing overlay contracts

**Files:**
- Modify: `.nous-feedback.jsonl`
- Modify: `infra/scripts/tests/test_reconcile_sprint1_docs.py`

**Interfaces:**
- Consumes: approved CHG-055 readiness and the CHG-049 predecessor artifacts.
- Produces: failing exact-transition tests for `CHG055_PATHS` and `CHG-055/e240d85`.

- [ ] Append a timestamped CHG-055 `started` event, commit it alone, and tag that commit `authority/chg-055-base`.
- [ ] Add a fixture constant for `infra/scripts/overrides/CHG-055/e240d85` and copy it after CHG-053 in isolated reconciler fixtures.
- [ ] Add a test asserting exactly the three source paths and six approved hashes from the design.
- [ ] Add tests proving all three delivered current blobs are byte-stable and an unknown or tampered blob fails without writes.
- [ ] Run `python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v`; require the new tests to fail because CHG-055 is not registered.
- [ ] Commit only the lifecycle event and red contracts with exact path staging.

### Task 2: Append the immutable layer and reach focused green

**Files:**
- Create: `infra/scripts/overrides/CHG-055/e240d85/manifest.json`
- Create: `infra/scripts/overrides/CHG-055/e240d85/docs/dev-guide/DEFINITION_OF_DONE.md`
- Create: `infra/scripts/overrides/CHG-055/e240d85/docs/dev-guide/SECURITY.md`
- Create: `infra/scripts/overrides/CHG-055/e240d85/docs/dev-guide/STANDARDS.md`
- Modify: `infra/scripts/reconcile-sprint1-docs.py`
- Modify: `scripts/work-readiness/git.mjs`

**Interfaces:**
- Consumes: Task 1 red contracts and exact delivered blobs.
- Produces: a final closed overlay layer recognized by the reconciler and readiness ownership parser.

- [ ] Store byte-for-byte desired copies of the three emitted targets under the layer directory.
- [ ] Create a version-1 manifest containing exactly `source_path`, `source_sha256`, and `desired_sha256` for each approved transition.
- [ ] Add literal `CHG055_PATHS` and append `("CHG-055/e240d85", CHG055_PATHS)` after CHG-053 without changing prior layers.
- [ ] Run the focused unittest module and require all reconciliation tests to pass.
- [ ] Compute SHA-256 over the final raw reconciler bytes and update `REVIEWED_RECONCILER_SHA256` with a CHG-055 delta comment.
- [ ] Run the focused suite, `pnpm test:work-readiness`, and `pnpm run check:generated-guidance`.

### Task 3: Review and commit the exact technical carry

**Files:**
- Commit: the twelve approved implementation paths only.

**Interfaces:**
- Consumes: the focused-green immutable layer.
- Produces: one CHG-055 carry commit with no generated-story or product implementation paths.

- [ ] Recompute every manifest digest and confirm the source artifacts equal the pre-delivery repository blobs.
- [ ] Exercise tampered-source, tampered-desired, unknown-current-state, incomplete-manifest, and reordered-layer cases; require fail-closed behavior without writes.
- [ ] Confirm `SECURITY.md` and `STANDARDS.md` retain database-grant authorization language, their local extensions are exact, and `AGENTS.md` is unchanged.
- [ ] Run `pnpm run check:generated-guidance`, `pnpm lint`, `pnpm check`, and `pnpm readiness:check -- CHG-055`.
- [ ] Stage the five delivery files, four overlay files, reconciler, focused tests, and hash pin explicitly; commit `chore(CHG-055): register the 2026-09-07 PM authorization-guidance refresh`.

### Task 4: Run the sole authoritative campaign and close

**Files:**
- Modify after executable verification only: `.nous-feedback.jsonl`
- Modify after executable verification only: `docs/readiness/CHG-055.json`

**Interfaces:**
- Consumes: final reviewed implementation commit and `authority/chg-055-base`.
- Produces: exactly one `test_report`, complete actuals, and a terminal done event.

- [ ] Run `pnpm mutation:cache:clear`.
- [ ] Run `MUTATION_BASE=authority/chg-055-base pnpm test:mutation` once, last; record every selected shard and wall-clock result.
- [ ] Append timestamped AC verification, build-pass, exactly one test-report, and done events.
- [ ] Fill actuals from the committed Git range and measured campaign; commit only readiness and feedback evidence.

## Self-review

- Every design requirement maps to a task.
- The final implementation census is twelve paths and contains no product code.
- The plan contains no deferred placeholders.
- The mutation campaign is the final executable task; evidence-only changes follow it.
