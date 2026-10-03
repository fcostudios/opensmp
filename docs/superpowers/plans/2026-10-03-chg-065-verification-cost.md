**Work item:** CHG-065
**Readiness assessment:** docs/readiness/CHG-065.json
**Approved estimate:** 250 minutes

# CHG-065 — verification cost: touched-shard previews, one-line survivors, session shape, done.cost — Implementation Plan

**Goal:** cut the process part of `focused_verification` measured on US-067..069: whole-set
re-previews, survivor ceremony no rule asks for, one long-lived controller that polls at 1 s, and
`done` without `cost`. Write the contract, make the gate accept the new actuals, and make it reach
Codex through `AGENTS.md`.

At any task boundary, if the remaining work will exceed the approved estimate, stop and file a
`blocked` or `deviation` feedback event before continuing.

**Task 1 — contract text.** Production sources: none (documentation).
`docs/dev-guide/WORK_READINESS.md`: §Per-task mutation previews gets the fix-round scope rule
(intersect changed files since the previous preview with preflight's shard → `sources`; a whole-set
re-preview needs a named closure reason) and the one-line survivor annotation; a new §Session shape;
§Actuals lists `preview_rounds` / `preview_minutes`; a new §Closure template requires `cost` on
`done` with a `notes` sentence saying measured or estimated (`cost` itself stays closed-key).
`docs/dev-guide/local/CLAUDE.md`: the short form of all four.

**Task 2 — register the CHG-065 guidance layer.** Production sources:
`infra/scripts/reconcile-sprint1-docs.py`, `scripts/work-readiness/git.mjs` (digest re-pin only).
New `infra/scripts/overrides/CHG-065/7817e94/` with `manifest.json` and desired bytes for
`AGENTS.md` (delivered bytes + one link line), `CLAUDE.md`, `docs/dev-guide/DEFINITION_OF_DONE.md`,
`docs/dev-guide/TESTING.md`, `testing/critical-paths.md` (delivered bytes). Each source is that
path's latest pinned desired file. Add AGENTS.md's "not `tenant_id`" to the approved negative
phrases. Re-pin `REVIEWED_RECONCILER_SHA256`; extend `infra/scripts/tests/test_reconcile_sprint1_docs.py`.
Commit, then `node scripts/work-readiness.mjs check-range main HEAD`.

**Task 3 — the AGENTS.md link.** Separate commit (the overlay must be in the parent tree).
`pnpm check:generated-guidance` exits 0; `check-range main HEAD` passes.

**Task 4 — gate accepts preview actuals (after CHG-066 merges and chg-065 is rebased).**
Production sources: `scripts/work-readiness/model.mjs` (`validateActualsShape` optional keys +
two `integer()` checks), `docs/dev-guide/work-readiness.schema.json` (two properties next to
`mutation_minutes`). Tests in one block at the end of `scripts/test-work-readiness.mjs`: valid with
both keys; rejected for a string and for -1; an artifact without them still valid.

**Mutation:** one `pnpm mutation:preflight` on the candidate; expected zero shards (no mutatable
`.ts`/`.tsx`), so no previews, no cold campaign, no `test_report`.

**Verification:** inner loop `pnpm test:work-readiness`, `pnpm lint`, `pnpm check:generated-guidance`,
`pnpm readiness:check -- CHG-065`; reviewer-briefed adversarial AC verification; one `pnpm check`
at closure when `/tmp/smp-full-gate.lock` is absent.

**Out of scope:** CHG-066, the 80 % threshold, the DoD order, parallel-safe siblings (CHG-060).
