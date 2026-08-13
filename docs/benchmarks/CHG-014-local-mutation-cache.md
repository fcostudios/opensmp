# CHG-014 local mutation-cache benchmark

Measured on 2026-08-13 after a frozen install and a successful full
`rtk pnpm check`. The generated, uncommitted cache-schema-v2 records are:

- cold: `reports/mutation-performance/4162df06-e545-4d18-a1e0-a06d47f82ad0.json`
- warm: `reports/mutation-performance/0c8ae11e-5164-4638-b068-7965b01e8cbd.json`

## Result

The unchanged warm campaign reused both successful cold shards (100% hit
ratio) and completed in 2,269.107959 ms, below the 60-second acceptance target.
The current `mutation:benchmark:summary` command accepts the records as
comparable.

| Metric | Cold | Warm |
| --- | ---: | ---: |
| Wall-clock duration (ms) | 29669.241917 | 2269.107959 |
| Orchestration duration (ms) | 29669.241917 | 2269.107959 |
| Measured wall-clock savings (ms) | 27400.133958 | — |
| Shards | 2 | 2 |
| Executed | 2 | 0 |
| Reused | 0 | 2 |
| Rejected | 0 | 0 |
| Hit ratio | 0 | 1 |
| Estimated reused-shard savings (ms) | 0 | 27275.874667000004 |
| Outcome | passed | passed |

Measured savings are cold wall time minus warm wall time. The
27,275.874667000004 ms estimated value is only the sum of recorded cold shard
durations; it is not presented as measured wall-clock savings.

## Fixed representative campaign

The campaign ran in a detached temporary worktree at commit
`71086076dd1d2a4659798e026bcf7154ba74e9f2`, also used as the fixed
`MUTATION_BASE`. Two fixture files differed from that ref, yielding two
mutatable sources, two ranges, and two scored shards:

- DB-backed `schema-static-83efba6de5f3`:
  `packages/db/src/schema.ts:550-551`, 5 mutants, 100% score. The fixture used a
  semantics-preserving construction of the existing
  `capacity_recovery_work` table name. Its evidence key included the sanitized
  PostgreSQL 16.14 driver/server and verified 54-migration schema profile.
- Non-DB `vitest-5a7d20176b00`:
  `packages/contracts/src/capacity.ts:1-59`, 36 mutants, 88.89% score. CRLF
  fixture bytes made the already-proven full-file scope explicit without
  changing TypeScript semantics.

The hardened runner and cache implementation remained clean at the fixed ref;
their bytes were included in both evidence keys through dependency
fingerprinting. Cold and warm resolved the same keys:

- schema: `00327705ef2ff0cba96a30ef7aa169cc8169734a7841abfe7e0bcff7dbe60d1e`
- contracts: `c88bffff00c84f1d4e06d78a89f7c939a8bf588a6a70461ef6df09a452932ea9`

The committed
[`scripts/benchmarks/chg014-representative-fixture.mjs`](../../scripts/benchmarks/chg014-representative-fixture.mjs)
applies only those two byte changes. It refuses a checkout whose HEAD, clean
status, or pre-fixture hashes differ from the recorded inputs; `restore`
refuses mixed or unknown bytes and restores the exact blobs from the fixed ref.

| File | Clean SHA-256 | Applied SHA-256 |
| --- | --- | --- |
| `packages/db/src/schema.ts` | `868a7a83630164a252f83fc9ae777e500300ad086d9486b0336da537b162fe0a` | `d4dea1f15fc04df49cc39d9a487e8518cd79ef560530904dc3f280448df1c4dc` |
| `packages/contracts/src/capacity.ts` | `5385a51cc9afc577b6691f48816420586ab0fa65360a725d1a76a4eb3cdd7ca3` | `bc7aef14955d702f47be67233139e90f9bf20c667d72a731bb70b29db0d058fa` |

### Exact reproduction sequence

Start in a clean checkout containing the committed fixture script. The two
database variables must already point to a fresh, isolated PostgreSQL 16
database: `DATABASE_ADMIN_URL` authenticates as `ledger_owner`, and
`DATABASE_URL` authenticates as `ledger_app`. Do not place either value in the
worktree, command history, benchmark record, or cache. The repository's normal
PostgreSQL initialization must create those roles before this sequence.

```sh
repo_root="$(rtk git rev-parse --show-toplevel)"
fixture_script="$repo_root/scripts/benchmarks/chg014-representative-fixture.mjs"
fixture_root="$(rtk mktemp -d /tmp/ledger-chg014-repro.XXXXXX)"
record_root="$(rtk mktemp -d /tmp/ledger-chg014-records.XXXXXX)"

rtk git worktree add --detach "$fixture_root" 71086076dd1d2a4659798e026bcf7154ba74e9f2
rtk pnpm --dir "$fixture_root" install --frozen-lockfile
rtk node "$fixture_script" check clean --root "$fixture_root"
rtk node "$fixture_script" apply applied --root "$fixture_root"

rtk sh -c 'test -n "${DATABASE_ADMIN_URL:-}" && test -n "${DATABASE_URL:-}"'
rtk pnpm --dir "$fixture_root/packages/db" db:migrate
rtk pnpm --dir "$fixture_root/packages/db" db:verify
rtk pnpm --dir "$fixture_root" mutation:cache:clear

MUTATION_BASE=71086076dd1d2a4659798e026bcf7154ba74e9f2 rtk pnpm --dir "$fixture_root" test:mutation
cold_record="$(rtk sh -c 'ls -t "$1"/reports/mutation-performance/*.json | head -n 1' -- "$fixture_root")"
rtk cp "$cold_record" "$record_root/cold.json"

MUTATION_BASE=71086076dd1d2a4659798e026bcf7154ba74e9f2 rtk pnpm --dir "$fixture_root" test:mutation
warm_record="$(rtk sh -c 'ls -t "$1"/reports/mutation-performance/*.json | head -n 1' -- "$fixture_root")"
rtk cp "$warm_record" "$record_root/warm.json"
rtk pnpm --dir "$fixture_root" mutation:benchmark:summary "$record_root/cold.json" "$record_root/warm.json"

rtk sh -c 'find "$1/reports" -type f -delete && find "$1/reports" -depth -type d -empty -delete' -- "$fixture_root"
rtk node "$fixture_script" restore clean --root "$fixture_root"
rtk node "$fixture_script" check clean --root "$fixture_root"
rtk git -C "$fixture_root" status --short
rtk git worktree remove "$fixture_root"
```

The final `status --short` output is empty. The two copied JSON records remain
in `record_root` after the detached worktree is removed; their UUID filenames
may differ from this report. Running the fixture script with `instructions`
prints the database validation and cold/warm command core without connection
values.

For this run, the isolated `ledger-chg014-v2` database used PostgreSQL 16.14.
All 54 committed migrations were applied as `ledger_owner`, then
`packages/db/scripts/verify-schema.mjs` verified 54 checksums, 31 application
tables, four append-only triggers, and the exact `ledger_app` grant matrix.
Connection values and credentials are absent from the performance records and
cache.

## Verification and observed bottlenecks

`rtk pnpm test:mutation-evidence`, `rtk pnpm test:mutation-scope`, and the full
`rtk pnpm check` passed. The v2 rerun exposed and fixed fail-closed resolver
gaps for manifest-only, path-resolved, and non-root installed packages. It also
found cache metadata validation incorrectly rejecting dependency-hash paths
containing sensitive word fragments even though their values are constrained
SHA-256 digests. Strict regressions cover each behavior without weakening
metadata-value or artifact validation.

Cold time remains dominated by two sequential Stryker startups. Each scans and
copies roughly 950 repository files and repeatedly attempts to preprocess
unrelated generated screen HTML that emits parse warnings. The warm path avoids
Stryker entirely; its remaining 2,269.107959 ms is dominated by the hardened
installed-package closure and DB-schema profile hashing, followed by cache
validation, report rehydration, and manifest/performance I/O. This is
2,094.201876 ms slower than the earlier cache-v1 warm measurement, an expected
cost increase from the broader evidence contract, while remaining well inside
the 60-second requirement.

For a later Substrate implementation, retain the same fail-closed evidence-key
and artifact-validation contract, but build a precise execution dependency
graph so unrelated workspaces, generated HTML, and unsupported legacy inputs
do not force broad fallbacks. Execute independent cache misses as parallel
remote shards, keyed by that graph plus tool/runtime/DB-schema profiles, and
return the same hashed shard artifacts for local validation.

## Machine profile

- macOS Darwin 25.5.0, arm64, Apple M4
- 10 logical CPUs, 25,769,803,776 bytes memory
- locale `en-US`, timezone `America/Guayaquil`
- Node 26.5.0, pnpm 9.15.0, TypeScript 5.9.3, Vitest 4.1.10,
  Stryker 9.6.1
- PostgreSQL 16.14 in the isolated local Docker database described above

These are same-machine local measurements and must not be treated as
cross-machine performance guarantees.

## US-025 production campaign — 2026-08-13

US-025 exercised the production diff rather than the two-shard representative
fixture. The authoritative comparable pair is uncommitted generated evidence:

- cold: `reports/mutation-performance/7a7ca1bb-e618-4d5b-8f28-ae3bcb8dcedf.json`
- warm: `reports/mutation-performance/5d925abb-de46-46a2-8439-ebab582cefeb.json`

Both records bind campaign key
`ce2845d69b3ca7fdca2c3a1aae9e0cfdf4370238fb84bca6fcfd69d848fca809`,
HEAD `25801d7997eecb89f957d8e45f1dcf4c5024b5b9`, immutable base and baseRef
`a91bc3bac76e11a9e0c8c7a3cef59992b0797cde`, and cache schema v2. The runner
consumes `MUTATION_BASE`; `MUTATION_BASE_REF` was also set to the identical
commit so the requested and recorded provenance cannot diverge.

| Metric | Cold | Warm |
| --- | ---: | ---: |
| Wall/orchestration duration (ms) | 907833.457458 | 15903.4085 |
| Measured savings (ms) | 891930.048958 | — |
| Shards | 14 | 14 |
| Executed | 14 | 0 |
| Reused | 0 | 14 |
| Rejected | 0 | 0 |
| Hit ratio | 0 | 1 |
| Estimated reused-shard savings (ms) | 0 | 893473.4615020001 |
| Outcome | passed | passed |

The unchanged warm replay was 57.0842 times faster and reduced measured wall
time by 98.2482%, completing in 15.903 seconds—comfortably below 60 seconds.
It emitted no Stryker, project-reader, dry-run, or mutation-score output. This
production result is materially larger than the fixed representative pair
(29,669.241917 ms cold, 2,269.107959 ms warm, 27,400.133958 ms measured and
27,275.874667 ms estimated savings across two shards), while preserving a 100%
warm hit ratio.

The cold campaign executed 13 scored shards plus one exact verification-only
bundle. Every scored shard met the 80% gate; focused mutation results retained
for the principal US-025 surfaces were form/dialog 80.65%, table 96.30%, tabs
93.91%, contracts 81.58%, schema 100%, and navigation 85.71%. Static App Router
boundary evidence ran separately and passed 5/5 because bracketed route paths
are excluded from Stryker's fast-glob boundary; this exclusion is explicit,
not counted as cached scored mutation evidence.

Cold time was dominated by server actions/service composition (292,923.010917
ms), the vendor-account repository (192,837.086417 ms), the final form/dialog
bundle (146,207.374333 ms), and tab/detail integration (139,555.516417 ms).
Repeated parsing attempts against unrelated prototype HTML also added noisy
cold startup overhead. Warm time is instead dependency/runtime-profile hashing,
cache validation, report rehydration, and record I/O.

### Defects exposed before the authoritative pair

Earlier generated records are diagnostic only and are not compared above.
They exposed fail-closed defects that were fixed with regressions before the
cache was cleared for the authoritative cold run:

- database harness selection now recognizes app-URL references and binds URLs
  only through a verified PostgreSQL schema profile;
- empty and ISO-date-list `ECUADOR_HOLIDAYS` values are deterministic hashed
  inputs, while malformed values still reject reuse;
- pnpm dependency aliases hash the nearest installed package bytes by actual
  manifest identity;
- each database-backed shard runs in a unique UUID-named clone of the verified
  template, terminates sessions, and drops the clone in cleanup/finally;
- production `DATABASE_URL` reads classify a closure as DB-backed even when its
  test filename is not `.integration.test.ts`;
- cache fingerprints the exact controlled child environment, so parent-only
  Keycloak secrets neither reach tests nor create false cache dependencies;
- literal `readFile(new URL(..., import.meta.url))` calls hash the exact static
  file, while dynamic filesystem access remains conservatively non-cacheable;
- integration fixtures that require empty business tables explicitly truncate
  their owned rows instead of assuming an empty schema template.

After the cold campaign, schema verification again proved 54 committed
migration checksums across 31 application tables, four append-only triggers,
and the exact `ledger_app` grant matrix; zero `ledger_mutation_*` databases
remained. No credentials or connection values appear in records or cache.

For Substrate, keep these fail-closed evidence, controlled-environment,
schema-profile, artifact-validation, and isolated-database contracts. Improve
cold performance by building a precise dependency graph that excludes unrelated
prototype HTML and by scheduling independent cache misses concurrently. The
local result proves content-addressed shard reuse is effective; a remote system
must not trade away the provenance and cleanup properties that made it safe.

Machine profile: Darwin 25.5.0 arm64 Apple M4, 10 logical CPUs,
25,769,803,776 bytes memory; Node 26.7.0, pnpm 9.15.0, TypeScript 5.9.3,
Vitest 4.1.10, Stryker 9.6.1, and PostgreSQL 16 Alpine using the committed
digest/profile. These remain same-machine measurements.
