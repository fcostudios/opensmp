**Work item:** CHG-069
**Readiness assessment:** docs/readiness/CHG-069.json
**Approved estimate:** 135 minutes

# CHG-069 — preview budget, slow shards once, schema-shard routing, host awake — Implementation Plan

**Goal:** cut the preview share of `focused_verification` measured on US-070/071 (105 of 459
minutes against ≤ 30 per child): budget preview rounds, take previews off the critical path,
preview slow shards once, stop the schema-static shard from scoring 0 of N silently, and keep the
host awake during gates.

At any task boundary, if the remaining work will exceed the approved estimate, stop and file a
`blocked` or `deviation` feedback event before continuing.

**Task 1 — contract text (items 1, 2, 3, 5).** Production sources: none (documentation).
`docs/dev-guide/WORK_READINESS.md`, inside existing headings only:
- §Per-task mutation previews: the budget (one round per task after its focused tests are green,
  plus one after the final fix wave; ≤ 30 `preview_minutes` per child; a round beyond `tasks + 1`
  or minutes beyond 30 needs a named `root_cause` reason); slow shards (last run > 5 min) once per
  child at the final round unless a fix touched their sources — an explicit carve-out from
  "preview every intersecting shard once"; replace "repair every genuine survivor and rerun its
  affected preview before task review" with survivors joining the next fix round; a 0-of-N
  preview with a reported routing gap is not evidence.
- §Session shape: the wait shape next to "Never poll at 1 s" — launch the round in the background,
  start the next task's RED/GREEN, collect at that task's review boundary.
- §Closure template: `root_cause` guidance names the budget overrun reasons and any gate run above
  2× the median wall time with its cause.
- §Commands: `caffeinate -i pnpm check` (macOS), `systemd-inhibit --what=idle:sleep pnpm check`
  (Linux). `scripts.check` is unchanged.
`docs/dev-guide/local/CLAUDE.md` §Verification cost: the short form.

**Task 2 — schema-shard routing (item 4).** Production sources: `scripts/mutation-scope.mjs`
(tooling, not a scored source).
- RED first in `scripts/test-mutation-scope.mjs`: the US-071 Task 2 path set from bd0397b
  (`packages/db/src/schema.ts`, `packages/db/src/migrations/V20261006131500__analytics_cost_revisions.sql`,
  `packages/db/src/analytics-ingestion.ts`, `packages/db/src/analytics-ingestion.integration.test.ts`,
  `packages/db/scripts/verify-schema.mjs`) through `discoverMutationShardSummaries` must give the
  schema-static shard the integration test, and its generated Stryker command must run it. Run it
  against the unmodified script and record the failure.
- Trigger: a changed path under `packages/db/src/migrations/` while schema.ts carries mutants.
  Select the changed, mutation-compatible `packages/db/**/*.integration.test.ts` files
  (`MUTATION_INCOMPATIBLE_TESTS` excluded) in addition to `schema.test.ts`.
- The schema-static command is built from `spec.testFiles` (relative to `packages/db`).
- No oracle selected → a named routing gap: preflight JSON gains `routing_gaps` and stderr says
  the schema-static preview cannot measure the declared schema change. Non-fatal (reported, never
  rejected, like a shard-count mismatch). Without a migration in the diff, output is unchanged.

**Verification.** `pnpm test:mutation-scope`, `pnpm test:work-readiness`, `pnpm lint`,
`pnpm check:generated-guidance`, `pnpm readiness:check -- CHG-069`, one `pnpm mutation:preflight`
(expect 0 intersecting shards), one `caffeinate -i pnpm check`; reviewer subagent for adversarial
AC1–AC5 verification and the scoped review.
