# Content-Addressed Mutation Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse only byte-identical successful local mutation evidence and record reproducible cold/warm timing data before US-025 begins.

**Architecture:** Extract deterministic evidence identity, dependency fingerprinting, cache persistence, and performance reporting into focused ES modules under `scripts/mutation-evidence/`. Keep `mutation-scope.mjs` responsible for diff routing and orchestration, but make each shard consult and validate the content-addressed store before execution. All uncertain dependency or runtime inputs fail closed to execution.

**Tech Stack:** Node.js 22 ESM, TypeScript compiler API, Stryker 9 JSON reports, Node `assert`, Git worktrees, pnpm.

---

## File map

- Create `scripts/mutation-evidence/fingerprint.mjs`: canonical serialization, execution-input collection, dependency closure, evidence-key creation.
- Create `scripts/mutation-evidence/cache.mjs`: Git-common-dir cache resolution, validated reads, atomic successful writes, narrowly scoped clearing.
- Create `scripts/mutation-evidence/performance.mjs`: monotonic run/shard measurements, JSON records, Markdown benchmark summaries.
- Create `scripts/test-mutation-evidence.mjs`: deterministic behavioral tests for the three modules using real temporary files and repositories.
- Modify `scripts/mutation-scope.mjs`: generate stable configs, calculate keys, reuse validated entries, persist successful entries, and record every decision.
- Modify `scripts/test-mutation-scope.mjs`: integration assertions for cache hit/miss, provenance independence, tamper rejection, and bypass mode.
- Create `scripts/mutation-cache.mjs`: safe `inspect` and `clear` CLI for this repository's cache only.
- Modify `package.json`: focused test, cache, and benchmark-summary commands.
- Create `docs/benchmarks/CHG-014-local-mutation-cache.md`: measured local cold/warm results and later Substrate proposal notes.

### Task 1: Deterministic execution-input fingerprints

**Files:**
- Create: `scripts/mutation-evidence/fingerprint.mjs`
- Create: `scripts/test-mutation-evidence.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing canonical-key tests**

Add assertions that a wished-for `canonicalJson()` sorts nested object keys,
that `createEvidenceKey()` ignores provenance/report paths, and that source,
test, config, lockfile, tool-version, platform-profile, and key-schema changes
each alter the SHA-256 key:

```js
assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
  '{"a":{"b":3,"y":2},"z":1}');
assert.equal(createEvidenceKey({ ...base, head: "a", reportPath: "one" }),
  createEvidenceKey({ ...base, head: "b", reportPath: "two" }));
for (const field of executionInputMutations) {
  assert.notEqual(createEvidenceKey(base), createEvidenceKey(field(base)));
}
```

- [ ] **Step 2: Run RED**

Run `rtk node scripts/test-mutation-evidence.mjs` and confirm it fails because
`fingerprint.mjs` or its exports do not exist.

- [ ] **Step 3: Implement canonical key construction**

Export these stable interfaces:

```js
export const EVIDENCE_SCHEMA_VERSION = 1;
export function canonicalJson(value) { /* recursive sorted-object JSON */ }
export function sha256(value) { /* Buffer/string SHA-256 */ }
export function createEvidenceKey(inputs) {
  const { head, base, baseRef, reportPath, jsonReportPath, ...execution } = inputs;
  return sha256(canonicalJson({ schemaVersion: EVIDENCE_SCHEMA_VERSION, ...execution }));
}
```

Reject `undefined`, functions, symbols, non-finite numbers, and cyclic values
instead of silently normalizing them.

- [ ] **Step 4: Write and verify RED dependency-closure tests**

Create a real temporary workspace with relative imports, a workspace-package
import, a package manifest, config, migration, and lockfile. Assert exact sorted
paths/hashes. Add fixtures for an unresolved local import and non-literal dynamic
import; assert a conservative owning-workspace fingerprint rather than omission.

- [ ] **Step 5: Implement dependency closure**

Export:

```js
export function collectExecutionInputs({ root, entryFiles, configurationFiles,
  migrationRoots, toolVersions, runtimeProfile }) { /* sorted path→hash map */ }
```

Use the installed TypeScript compiler API to parse imports and resolve local
modules. Recursively include local files and workspace manifests. For an
unresolved owned import, dynamic import, or owned runtime filesystem read,
include the owning workspace's source/test/config files. Always include the
root lockfile and runner module. Never include environment values.

- [ ] **Step 6: Run GREEN and wire the focused command**

Add `"test:mutation-evidence": "node scripts/test-mutation-evidence.mjs"` and
include it in the root `test` chain. Run `rtk pnpm test:mutation-evidence`; expect
all assertions to pass with no warnings.

- [ ] **Step 7: Commit**

Commit `test(tooling): fingerprint mutation evidence inputs (CHG-014)`.

### Task 2: Fail-closed content-addressed cache

**Files:**
- Create: `scripts/mutation-evidence/cache.mjs`
- Modify: `scripts/test-mutation-evidence.mjs`
- Create: `scripts/mutation-cache.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing cache-contract tests**

Using a real temporary Git repository, assert that `cacheRoot()` resolves below
`git rev-parse --git-common-dir`, a successful entry survives a linked-worktree
path change, and failed/pending/partial/tampered/wrong-schema/wrong-key entries
return structured misses. Assert persisted JSON contains none of supplied
secret sentinels.

- [ ] **Step 2: Run RED**

Run `rtk pnpm test:mutation-evidence`; confirm missing cache exports cause the
expected failure.

- [ ] **Step 3: Implement cache storage and validation**

Export:

```js
export function cacheRoot(repoRoot, runGit) {}
export function readCacheEntry({ root, evidenceKey, validateArtifacts }) {
  // { hit: true, entry, artifacts } or { hit: false, reason }
}
export function writeSuccessfulCacheEntry({ root, evidenceKey, entry, artifacts }) {}
export function clearMutationCache({ repoRoot, runGit }) {}
```

Require `entry.result === "passed"`, validate all artifact hashes, invoke the
caller's existing report/audit validator, and atomically rename a temporary
sibling directory. Resolve and realpath-check deletion targets so clearing can
only remove `<git-common-dir>/ledger-mutation-cache/v1`.

- [ ] **Step 4: Implement safe CLI and package scripts**

Support only `inspect` and `clear`, with `clear` printing the resolved cache path
and number of entries removed. Add `mutation:cache:inspect` and
`mutation:cache:clear` scripts. Do not accept an arbitrary filesystem path.

- [ ] **Step 5: Run GREEN and adversarial checks**

Run `rtk pnpm test:mutation-evidence`; then manually place a truncated entry in
the temporary fixture and confirm it reports a miss without deleting anything.

- [ ] **Step 6: Commit**

Commit `feat(tooling): add fail-closed mutation cache (CHG-014)`.

### Task 3: Performance evidence and benchmark summary

**Files:**
- Create: `scripts/mutation-evidence/performance.mjs`
- Modify: `scripts/test-mutation-evidence.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing measurement tests**

Inject a monotonic clock sequence and assert exact shard durations, executed /
reused / rejected counts, hit ratio, estimated milliseconds saved, campaign
outcome, and JSON/Markdown total agreement. Assert machine records contain OS,
architecture, CPU count, memory, and tool versions but no environment object.

- [ ] **Step 2: Run RED**

Run `rtk pnpm test:mutation-evidence`; confirm the missing performance exports
are the reason for failure.

- [ ] **Step 3: Implement measurements**

Export:

```js
export function createPerformanceRun({ provenance, cacheMode, machine, now }) {}
export function startShard(run, shard, now) {}
export function finishShard(run, token, decision, details, now) {}
export function finishPerformanceRun(run, outcome, now) {}
export function writePerformanceRecord(root, run) {}
export function renderBenchmarkSummary(cold, warm) {}
```

Use `performance.now()` for durations and UTC timestamps only for labels.
Write records atomically under `reports/mutation-performance/`. The summary
must distinguish measured wall-clock savings from estimates.

- [ ] **Step 4: Add summary CLI**

Add `mutation:benchmark:summary` accepting exactly two JSON record paths and
writing Markdown to stdout. Reject records from different machine profiles or
campaign keys unless `--allow-incomparable` is explicitly supplied; label such
output incomparable.

- [ ] **Step 5: Run GREEN and commit**

Run `rtk pnpm test:mutation-evidence`, then commit
`feat(tooling): measure mutation cache performance (CHG-014)`.

### Task 4: Integrate cache decisions into the diff-scoped runner

**Files:**
- Modify: `scripts/mutation-scope.mjs`
- Modify: `scripts/test-mutation-scope.mjs`

- [ ] **Step 1: Write failing integration tests**

Extend the existing real temporary Git fixture and use an injectable shard
executor so the first run produces validated evidence, the unchanged second run
does not invoke the executor, a commit-only provenance change remains a hit,
and source/test/config/dependency/lockfile/runner/tool-profile mutations cause
misses. Assert corrupt report content, failed evidence, and
`MUTATION_CACHE=off` execute rather than pass.

- [ ] **Step 2: Run RED**

Run `rtk pnpm test:mutation-scope`; confirm failures describe missing evidence
keys/cache decisions rather than fixture errors.

- [ ] **Step 3: Separate stable config from run-specific paths**

Generate a normalized config identity with deterministic placeholder report and
temp paths for hashing. Keep actual unique run paths in the executed config.
Add `evidenceKey`, `dependencyHashes`, `cacheDecision`, `durationMs`, and
`priorDurationMs` to manifest shards; keep `head`, base, and worktree hash only
under provenance.

- [ ] **Step 4: Add lookup, validation, execution, and storage**

For each shard, create the performance token, compute inputs/key, and attempt a
cache read. On a hit, copy/link cached reports to the current unique report
paths, run `validateMutationReportIdentity()` plus classification/static checks,
mark `reused`, and continue. On any miss/rejection, run the existing Stryker and
verification-only flow unchanged; only after all checks pass atomically store
the entry and mark `executed`.

- [ ] **Step 5: Add DB/runtime-profile fail-closed behavior**

Detect DB-backed accountable tests. Obtain only driver/server version and
applied migration/schema fingerprint through the existing schema verification
seam. If unavailable, set `cacheDecision: "rejected"` with
`reason: "runtime-profile-unavailable"` and execute without storing reusable
evidence. Include locale/timezone names, never their surrounding environment.

- [ ] **Step 6: Persist interruption-safe manifests and performance records**

Update both records after every shard. On signals or exceptions, finalize the
run as failed/interrupted while leaving pending shards non-reusable. Support
`MUTATION_CACHE=off` as explicit bypass and keep `MUTATION_SCOPE_DRY=1`
side-effect-free except generated configs/manifests.

- [ ] **Step 7: Run GREEN and regression tests**

Run `rtk pnpm test:mutation-evidence` and `rtk pnpm test:mutation-scope`; expect
all old routing/report assertions and new cache assertions to pass.

- [ ] **Step 8: Commit**

Commit `feat(tooling): reuse validated mutation shards (CHG-014)`.

### Task 5: Full verification and reproducible local benchmark

**Files:**
- Create: `docs/benchmarks/CHG-014-local-mutation-cache.md`
- Modify only if evidence exposes a bug: files from Tasks 1–4, with a new RED test first

- [ ] **Step 1: Establish the final prerequisite baseline**

Run `rtk pnpm install --frozen-lockfile`, then `rtk pnpm check`. Stop and fix any
new failure with a reproducing test; do not begin the expensive campaign until
the full check is green.

- [ ] **Step 2: Select and record the fixed campaign**

Use the US-023 merge-base/head pair if it remains runnable. Otherwise use a
fixed representative campaign containing at least one DB-backed shard and one
non-DB or verification-only shard. Record exact refs, commands, machine profile,
scope count, and any limitation before running.

- [ ] **Step 3: Execute the cold run**

Clear only the CHG-014 cache with `rtk pnpm mutation:cache:clear`, execute the
fixed campaign, and retain its JSON performance record. Require every shard to
pass; a partial run is diagnostic evidence, not a cold baseline.

- [ ] **Step 4: Execute the unchanged warm run**

Run the exact campaign again without source or environment changes. Require
100% reuse of successful cold shards and mutation orchestration under 60
seconds, excluding `pnpm check`.

- [ ] **Step 5: Verify selective invalidation fixtures**

Run the focused tests proving metadata-only reuse and invalidation on source,
test, dependency, config, lockfile, runner, tool, and DB-profile changes. Restore
the fixture and prove its original entry is reusable.

- [ ] **Step 6: Generate and review the proposal evidence**

Generate `docs/benchmarks/CHG-014-local-mutation-cache.md` from the two JSON
records. Include cold/warm wall time, hit ratio, executed/reused counts,
measured savings, remaining bottlenecks, machine profile, limitations, and the
future Substrate option of exact dependency graphs plus parallel remote shards.
Never present estimated time as measured time.

- [ ] **Step 7: Final review and commit**

Run `rtk git diff --check`, the two focused suites, and `rtk pnpm check` if code
changed after Step 1. Commit `docs(tooling): record mutation cache benchmark (CHG-014)`.

### Task 6: Integration and delivery

**Files:**
- Review all CHG-014 files against the approved design.

- [ ] **Step 1: Dispatch final whole-change review**

Require the reviewer to check safety invariants, secret exclusion, fail-closed
paths, test effectiveness, exact benchmark claims, and backwards compatibility.
Resolve every important finding with the same TDD/re-review loop.

- [ ] **Step 2: Verify final branch**

Run `rtk pnpm test:mutation-evidence`, `rtk pnpm test:mutation-scope`, and
`rtk pnpm check`; inspect `rtk git status --short` and the commit range.

- [ ] **Step 3: Finish the development branch**

Use `superpowers:finishing-a-development-branch`. Because the user requested
this prerequisite before the next story, merge it into local `main`, run the
post-merge focused smoke checks, and push only after all checks succeed.
