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
