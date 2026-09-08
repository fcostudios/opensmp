# CHG-057 Mutation Campaign Contract Design

## Context and outcome

US-063 needed nine cold campaigns because `scripts/mutation-scope.mjs` lets the first shard-level exception escape to its campaign-level catch. Accountable-route gaps, database-template availability, invalid zero-mutant seams, adapter/config mistakes, and threshold failures therefore surfaced one at a time. CHG-057 makes one campaign exhaustive without weakening any shard: execute sequentially, isolate cleanup, collect ordinary failures, then return one deterministic non-zero aggregate.

The approved operational outcome also moves prerequisites into `pnpm check`, treats shard-count differences as calibration evidence instead of readiness rejection, and reduces story closure to one evidence commit. US-064 is the acceptance measurement: no more than two cold campaigns and review time no greater than implementation time.

## Campaign execution

Each selected shard owns a `try/catch/finally` boundary. Its catch records a closed failure entry containing shard id, failure stage, message, and status; its finally cleans that shard's database sandbox. Ordinary shard failures do not stop later shards. SIGINT and SIGTERM remain immediate campaign interruptions, await all active sandbox cleanup, persist interrupted performance evidence, and never continue to another shard.

Failure stages are closed and operational: `runtime-profile`, `cache`, `database-sandbox`, `execute`, `report`, `identity`, `threshold`, `verification`, and `cleanup`. The final summary sorts failures by shard id and stage, prints each once, marks the performance run failed, and exits non-zero using the first explicit child status or `1`. A successful shard may populate the cache; failed shards never do.

## Preflight and shard-count reporting

`node scripts/mutation-scope.mjs --preflight` performs scope discovery, hunk routing, shard/config generation, runtime-profile and database-template validation, zero-mutant eligibility checks that can be decided statically, and adapter/config verification. It does not spawn Stryker, create campaign performance evidence, consume mutation cache entries, or emit `test_report`. `pnpm mutation:preflight` exposes the mode and `pnpm check` invokes it before the existing type/lint/test/build sequence.

Preflight prints a machine-readable final summary with `mutation_shards_actual`. It may read the active work item's approved readiness artifact when supplied, but an `expected_mutation_shards` mismatch is informational: it is printed for the agent to record as a timestamped `deviation`, never returned as an error and never changes the immutable readiness payload. Completion actuals record `mutation_shards_actual`; the readiness schema and validator accept that field without treating it as retroactive authorization.

## Preview selection

`MUTATION_SHARD=<exact shard id>` selects one generated shard for a developer preview. An unknown or ambiguous selector fails before execution. A selected preview is explicitly non-authoritative, retains normal shard validation, writes no authoritative performance record, and never justifies a `test_report`. With no selector, the cold campaign always runs the complete calculated shard set.

## Evidence workflow

Story implementation and review fixes land before the cold campaign. The final complete campaign is last among executable verification steps. Afterward, one evidence commit may update only readiness actuals and append-only feedback. Timestamped `deviation`, `ac_verify`, `build_pass`, `test_report`, and `done` events are the detailed record; preview runs emit no `test_report`.

The decision-event timestamp inconsistency is not expanded into CHG-057: the current readiness validator enforces a closed historical decision shape that excludes `ts`. CHG-057 changes campaign and completion evidence only.

## Verification

Focused tests use real temporary repositories and injected shard executors. They first fail against stop-at-first behavior, then prove two broken shards both execute and appear in the aggregate with distinct stages, database cleanup happens per shard, signals still interrupt, preflight defects fail without campaign artifacts, count mismatches report but pass, exact preview selection runs one shard, and an unselected campaign runs all shards. Existing cache, identity, report freshness, database, and signal tests remain green.

The approved four-path runner scope is `scripts/mutation-scope.mjs`, `scripts/test-mutation-scope.mjs`, `package.json`, and `docs/dev-guide/WORK_READINESS.md`. Structured `mutation_shards_actual` also requires the existing readiness consumer trio—`scripts/work-readiness/model.mjs`, `scripts/test-work-readiness.mjs`, and `docs/dev-guide/work-readiness.schema.json`—because its actuals object is closed. This planning-time scope discovery is recorded as a deviation before implementation; it adds no product, route, schema, authorization, or second lifecycle scope. The expected count is one runner-contract shard at approval time; the implemented preflight reports the observed value and any mismatch as deviation evidence.

**Work item:** CHG-057  
**Readiness assessment:** `docs/readiness/CHG-057.json`  
**Approved estimate:** 260 minutes
