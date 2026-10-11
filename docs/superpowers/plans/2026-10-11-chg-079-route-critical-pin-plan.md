**Work item:** CHG-079
**Readiness assessment:** docs/readiness/CHG-079.json
**Approved estimate:** 45 minutes

# CHG-079 accountable route and canonical pin implementation plan

**Goal:** Deliver the bounded US-075 technical prerequisite without changing functional behavior.
**Architecture:** One explicit source-to-suite route and one final immutable reconciler layer, following existing mechanisms.
**Tech Stack:** Node mjs, Python unittest, existing Vitest shared PostgreSQL fixture.
**Spec:** docs/superpowers/specs/2026-10-11-chg-079-route-critical-pin-design.md

## Global Constraints

- Exactly ten inclusive readiness-manifest paths; six implementation paths named below.
- Read TESTING.md before test edits. No owned-code mocks or application changes.
- Preserve testing/critical-paths.md bytes at SHA256 9aa63e45047cfa887a40d08d484d5e4b1cb5eb8f0eef492d1252728ddfd65467.
- Only exact route registration and immutable layer/pin fixture wiring. Preserve instrumentation, thresholds and routing-gap rejection. Harness behavior/template needs stop as a substrate issue.
- PostgreSQL runs through CHG-067 shared wrapper only; full gate uses caffeinate and regular exclusive owner/inode lock; never remove a foreign lock, wait at least 60 seconds.
- Task-boundary forecast overrun requires deviation or blocked evidence before continuing.

## Review Focus

Missing real suite, duplicate/unrelated suite, source/desired hash corruption, unknown canonical bytes, and changes beyond registration are the five failure modes; both tasks below pin these through real-file route and manifest/unknown-state assertions plus scoped diff review.

### Task 1: Accountable people-action route

**Files:** scripts/mutation-scope.mjs; scripts/test-mutation-scope.mjs.
**Production sources:** scripts/mutation-scope.mjs (mjs tooling; no ordinary TS shard).
**Interfaces:** DIRECT_TEST_ROUTES source entry and routedTestFiles(changed, mutate, fileExists).
- [ ] Read testing contract; add direct assertion that the people-action-service route equals only org-registry/repository.integration.test.ts and real-file routedTestFiles assertion. Run existing suite and observe RED for missing route.
- [ ] Add exactly that direct map entry; run rtk proxy pnpm test:mutation-scope and obtain GREEN; commit normal CHG-079 checkpoint.
- [ ] Preflight the existing people-action service delta using original US-075 base 3766652 as diagnostic only; confirm accountable repository suite and run it with CHG-067 wrapper. No US-075 mutation score or source edits. Read script usage to choose executable existing commands, never an import/parser relay.
- [ ] Run technical frozen-base ordinary preflight; preview intersecting shards once if any; if none record zero previews.

### Task 2: Immutable canonical critical pin

**Files:** infra/scripts/overrides/CHG-079/c8f3317/manifest.json; infra/scripts/overrides/CHG-079/c8f3317/testing/critical-paths.md; infra/scripts/reconcile-sprint1-docs.py; infra/scripts/tests/test_reconcile_sprint1_docs.py.
**Production sources:** infra/scripts/reconcile-sprint1-docs.py (registration only; no ordinary TS shard).
**Interfaces:** CHG079_PATHS + final LAYERED_OVERRIDE_SPECS tuple; existing latest_desired_guide/copy_reconciler_data helpers.
- [ ] Confirm canonical check currently rejects unknown desired SHA256; pin exact manifest source path/hash and desired hash in a focused existing test, covering unknown bytes rejection through existing real reconciler fixtures.
- [ ] Copy delivered canonical bytes unchanged into the new artifact; bind CHG-069 source to desired in manifest; register final layer only and update latest fixture/wiring. Run rtk proxy pnpm check:generated-guidance and rtk proxy python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs; obtain GREEN and commit checkpoint.
- [ ] Run technical ordinary preflight; preview only intersecting shards once, recording zero when none. Do not patch immutable validator/template hashes or any loader behavior.

### Verification and closure

- [ ] Reused scoped reviewer reviews each checkpoint using exact diff packages and reported tests; implementer handles any bounded repairs.
- [ ] Fresh reviewer adversarially verifies AC1/2/3 against technical frozen base and final candidate; controller appends verdicts.
- [ ] Implementer executes one regular caffeinate -i pnpm check under exclusive /tmp/smp-full-gate.lock, owner/inode cleanup and >=60s foreign-owner waits, reporting measured evidence. Keep source tree stable after final review; any repair gets scoped re-review before final campaign.
- [ ] Run ordinary final technical diff-scoped mutation command with the separate frozen base; record observed zero shard/no-mutatable result or actual campaign results. Preserve generated-file hash; range/readiness checks pass.
- [ ] Controller records build_pass, test_report only if truthful schema-valid evidence is available, cost provenance annotation and complete actuals before done; no invented score. Root coordinates US-075 reassessment/integration, no push/merge here.
