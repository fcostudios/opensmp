# Content-Addressed Mutation Evidence Design

## Status

Approved in conversation on 2026-08-12.

## Goal

Make the local story-verification loop fast enough to use continuously without
weakening Ledger's mutation gate. Successful mutation shards and
verification-only bundles will be reused only when every input capable of
changing their result is byte-identical. The runner will also retain
reproducible local timing evidence for a later Substrate optimization proposal.

This work is a prerequisite to starting the next Sprint 3 story.

## Current evidence

The diff-scoped runner in `scripts/mutation-scope.mjs` already improves on a
whole-file campaign by producing exact changed-line ranges, accountable test
routes, one-mutant-group shards, immutable report paths, and report identity
checks. It nevertheless reruns every shard sequentially on every invocation.

Its current `runHash` includes `HEAD`, the merge base, and a hash of the whole
changed worktree. Those values prove where a run happened, but they are not all
execution inputs. A metadata-only commit or an unrelated change therefore
changes report identity even when the source, responsible tests, configuration,
dependencies, and toolchain are identical. The manifest records no shard
duration, cache decision, hit ratio, or estimated time saved.

The US-023 campaign exposed the cost of that model: after reducing an initial
3,372-mutant whole-file scope to exact hunks and 28 shards, small provenance and
verification corrections still caused complete campaign restarts. Normal
`pnpm check` verification also happened too late once, so an ordinary workspace
link issue was discovered after mutation work had already run.

## Decision

Add a fail-closed, content-addressed cache above the existing shard runner.
Keep execution provenance and reusable evidence identity separate:

- provenance answers *where and when was this gate requested?*;
- the evidence key answers *could any input to this result have changed?*.

Only a fully validated successful entry may satisfy a shard. A cache miss,
incomplete dependency closure, unknown dynamic input, version mismatch,
corrupt entry, failed result, or interrupted write causes normal execution.
The cache is an optimization and can never turn uncertainty into a pass.

Stryker's built-in incremental mode is not the primary mechanism because it
does not cover Ledger's verification-only command bundles uniformly and does
not provide the audit record required here. A precise dependency graph plus
parallel remote execution remains a possible later Substrate optimization;
this change will collect the measurements needed to evaluate it.

## Pipeline

The story completion order becomes:

```text
frozen dependency install
        ↓
focused red/green implementation tests
        ↓
pnpm check
        ↓
one diff-scoped mutation campaign
        ├── validated cache hits
        └── execute cache misses sequentially
        ↓
review → merge → post-merge smoke verification
```

Mutation is not repeatedly restarted after documentation-only commits. A final
campaign may reuse already validated evidence whose execution inputs did not
change.

## Evidence identity

Each shard receives an `evidenceKey`, a SHA-256 digest over a versioned,
canonical JSON document containing:

1. shard kind, exact mutate ranges, source paths, and source bytes;
2. responsible test paths and bytes;
3. the normalized effective Stryker/Vitest/command configuration, excluding
   only cache location, temporary paths, report paths, and current provenance;
4. the mutation runner and all verification scripts invoked by the shard;
5. `pnpm-lock.yaml`, relevant `package.json` files, TypeScript/Vitest/Next
   configuration, and committed database migrations in the dependency closure;
6. Node, pnpm, TypeScript, Vitest, Stryker core, and Stryker runner versions;
7. operating-system and CPU architecture identifiers for native/runtime
   behavior;
8. non-secret execution profiles required by the shard, including locale,
   timezone, database driver/server version, and an applied-schema fingerprint
   for DB-backed tests; and
9. a version number for the key schema and dependency resolver.

Local TypeScript/JavaScript dependencies are resolved transitively from shard
sources, tests, runner configuration, and verification scripts using the
project's TypeScript module resolution. Workspace-package imports add that
workspace's manifest and recursively resolved local files.

Resolution fails closed:

- unresolved local imports invalidate reuse;
- non-literal dynamic imports or owned runtime filesystem reads that cannot be
  resolved statically expand the fingerprint to the complete owning workspace;
- unknown workspace boundaries expand to every application/package source and
  test input used by the mutation runtime;
- third-party package code is represented by the lockfile and installed
  package version/integrity metadata, never assumed from a package name alone.

This conservative fallback can reduce the hit rate, but it cannot produce an
unsafe hit. A future Substrate implementation may replace fallback workspace
fingerprints with a more exact execution graph while retaining the same cache
contract.

The current commit, merge base, branch name, wall-clock time, and unrelated
documentation are deliberately excluded from `evidenceKey`. They remain in the
run manifest as provenance.

## Cache storage and validation

Local entries live below the repository's Git common directory, not a linked
worktree:

```text
<git-common-dir>/ledger-mutation-cache/v1/<evidenceKey>/
  entry.json
  mutation-report.json
  mutation-report.html        # when produced
  projection-evidence.json    # when produced
```

This makes evidence reusable before and after a feature worktree is merged or
removed without polluting Git status. Cache writes use a temporary sibling
directory followed by an atomic rename. Interrupted entries are ignored.

Before reuse, the runner will:

1. recompute the complete evidence key;
2. verify the entry schema, key, successful classification, and tool identity;
3. hash every stored artifact;
4. run the existing report identity checks against current source bytes,
   mutate ranges, and a deterministically regenerated config;
5. reapply nonzero-mutant/static-shard requirements; and
6. reject verification-only evidence unless its command list, audit
   classification, dependency fingerprint, and optional projection evidence
   all validate.

Failed, pending, zero-mutant scored, below-threshold, manually edited, or
legacy unversioned entries are never reusable. A cache-disable environment
flag forces execution for diagnosis. A cache-clear command targets only the
validated Git-common-directory cache path and reports what it removed.

No environment value, database URL, password, token, provider response, or
other secret is written to an entry. Environment-sensitive behavior must be
represented by a non-secret profile identifier; an unrecognized required
environment input disables reuse for that shard. For a DB-backed shard, the
runner obtains a sanitized database profile through the existing schema
verification seam. It contains the driver, server version, and applied
migration/schema fingerprint but no host, port, database name, role, URL, or
data. Failure to obtain or validate that profile is a cache miss.

## Run manifest and measurements

Every invocation writes its ordinary generated manifest plus a separate
machine-readable performance record under:

```text
reports/mutation-performance/<run-id>.json
```

The record contains no secrets and includes:

- current commit/base provenance and campaign key;
- cache schema and enabled/bypass mode;
- OS, architecture, logical CPU count, memory, and tool versions;
- total orchestration and wall-clock duration;
- per-shard evidence key, classification, `executed`/`reused`/`rejected`
  decision, rejection reason, duration, prior recorded duration, and result;
- executed and reused counts, hit ratio, and summed estimated milliseconds
  saved; and
- final campaign outcome.

Durations use a monotonic clock. The manifest is updated after every shard so
an interrupted campaign retains diagnostic timing but never records incomplete
evidence as successful.

A Markdown summary generated from the JSON record will capture the local
benchmark for later Substrate discussion. Machine information is recorded so
comparisons are not presented as cross-machine absolutes.

## Local benchmark protocol

The primary benchmark is local and reproducible on the same machine:

1. run the runner's focused correctness suite;
2. clear or bypass only this repository's mutation cache;
3. execute one fixed historical diff campaign as the cold run;
4. rerun the identical campaign as the warm run;
5. exercise a controlled source, test, configuration, dependency, and
   metadata-only change through isolated fixtures to prove selective
   invalidation behavior;
6. restore the fixture and prove the original entry is reusable; and
7. generate a cold-versus-warm Markdown summary from the JSON records.

The historical base/head pair, repository state, commands, and machine profile
will be recorded. If the full historical campaign is operationally too large,
the record must say so and use a fixed representative DB-backed shard plus a
non-DB or verification-only shard; estimated savings may not be presented as
measured wall-clock savings.

Initial acceptance targets are:

- an unchanged warm campaign reuses 100% of successful cold-run shards;
- a metadata-only commit does not invalidate evidence;
- changes to source, responsible tests, resolved local dependencies,
  configuration, lockfile, runner code, verification commands, or tool versions
  invalidate the affected evidence;
- warm mutation orchestration finishes in less than 60 seconds, excluding the
  prerequisite `pnpm check`;
- the JSON and Markdown totals agree exactly; and
- no stale, failed, incomplete, or tampered entry can produce a green gate.

## Testing strategy

Before modifying tests, implementation will read and follow
`docs/dev-guide/TESTING.md`. Development follows red/green/refactor.

Focused deterministic tests will establish:

- canonical key stability across object order, commit changes, and report-path
  changes;
- key invalidation for every declared execution input;
- transitive workspace dependency inclusion and conservative fallback;
- atomic successful writes and rejection of partial/corrupt/failed entries;
- report revalidation on cache hits;
- verification-only evidence validation;
- monotonic duration aggregation and exact benchmark summary totals;
- cache bypass and narrowly scoped cache clearing; and
- secret values are absent from persisted evidence.

Tests use temporary repositories/directories and owned real implementations.
They do not mock Ledger code or assert only that execution does not throw.

## Rollout and compatibility

The first rollout is local-only. Existing CI mutation slices and thresholds are
unchanged. The runner emits cache-format and timing data in a form that CI or a
Substrate artifact store can consume later, but this change does not make a
developer-machine cache authoritative outside that machine.

The cache can be disabled instantly without changing mutation semantics. Cache
schema upgrades use a new version directory; no migration of trusted evidence
is attempted. Old entries can be pruned after benchmark evidence is retained.

## Definition of done

This prerequisite is complete when:

1. the cache safety and measurement tests pass;
2. `pnpm check` passes before the final mutation campaign;
3. a cold and unchanged warm local campaign produce validated JSON records;
4. the warm run meets the reuse and under-60-second targets, or the evidence
   identifies a specific remaining bottleneck without misreporting success;
5. the human-readable benchmark summary is committed for the future Substrate
   proposal; and
6. the work is reviewed, merged to local `main`, and pushed before US-025 starts.
