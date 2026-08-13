# CHG-014 local mutation-cache benchmark

Measured on 2026-08-12/13 after a frozen install and a successful full
`rtk pnpm check`. The benchmark records are generated artifacts and are not
committed:

- cold: `reports/mutation-performance/74c3f41a-6ce8-4bad-a697-05716531f556.json`
- warm: `reports/mutation-performance/bf4728a5-f33e-481c-b064-5437f82e6066.json`

## Result

The unchanged warm campaign reused both successful cold shards (100% hit
ratio) and completed in 174.906083 ms, below the 60-second acceptance target.

| Metric | Cold | Warm |
| --- | ---: | ---: |
| Wall-clock duration (ms) | 24375.058792 | 174.90608300000002 |
| Orchestration duration (ms) | 24375.058792 | 174.90608300000002 |
| Measured wall-clock savings (ms) | 24200.152708999998 | — |
| Shards | 2 | 2 |
| Executed | 2 | 0 |
| Reused | 0 | 2 |
| Rejected | 0 | 0 |
| Hit ratio | 0 | 1 |
| Estimated reused-shard savings (ms) | 0 | 24192.749084 |
| Outcome | passed | passed |

Measured savings are cold wall time minus warm wall time. The
24,192.749084 ms estimated value is only the sum of the cold shard durations;
it is not presented as measured wall-clock savings.

## Fixed representative campaign

The campaign ran in a detached temporary worktree at commit
`35b5c3f5119ff124c3546e00b3ff17c4521996da`, with the same commit as its fixed
`MUTATION_BASE`. Three fixture files differed from that ref, yielding two
mutatable sources, two ranges, and two shards:

- DB-backed `schema-static-83efba6de5f3`:
  `packages/db/src/schema.ts:550-551`, 5 mutants, 100% score. The fixture used a
  semantics-preserving construction of the existing
  `capacity_recovery_work` table name. Its evidence key included the sanitized
  PostgreSQL 16.14 driver/server and verified 54-migration schema profile.
- Non-DB `vitest-5a7d20176b00`:
  `packages/contracts/src/capacity.ts:1-59`, 36 mutants, 88.89% score. CRLF
  fixture bytes made the already-proven full file scope explicit without
  changing TypeScript semantics.
- `scripts/mutation-evidence/fingerprint.mjs` contained the pending one-line
  `.tmp` exclusion fix. It is not a mutatable source in the campaign, but its
  exact bytes are part of both evidence keys. Fixture SHA-256 values were
  `d4dea1f15fc04df49cc39d9a487e8518cd79ef560530904dc3f280448df1c4dc`
  (schema),
  `bc7aef14955d702f47be67233139e90f9bf20c667d72a731bb70b29db0d058fa`
  (contracts), and
  `2647ad5f735c5622b98d8b210eb66d6654b5e6eb237c3c890a49563293972161`
  (fingerprint runner).

The cache was cleared immediately before the final cold run with
`rtk pnpm mutation:cache:clear`. Cold and warm used the identical command:

```sh
set -a
. /Users/fcolomas/Projects/smp/.env
set +a
export DATABASE_ADMIN_URL="postgresql://ledger_owner:${LEDGER_OWNER_PASSWORD}@127.0.0.1:25432/ledger"
export DATABASE_URL="postgresql://ledger_app:${LEDGER_APP_PASSWORD}@127.0.0.1:25432/ledger"
export MUTATION_BASE=35b5c3f5119ff124c3546e00b3ff17c4521996da
rtk pnpm test:mutation
```

The isolated `ledger-chg014` database was created on local port 25432. All 54
committed migrations were applied as `ledger_owner`, then
`packages/db/scripts/verify-schema.mjs` verified 54 checksums, 31 application
tables, four append-only triggers, and the exact `ledger_app` grant matrix.
URLs and credentials are absent from the performance records and cache.

## Historical US-023 diagnostic and limitation

The preferred historical campaign was attempted from US-023's pre-story base
`e91b9df5f2672f97d5392569c6104960e5bcd634` to CHG-014 head
`35b5c3f5119ff124c3546e00b3ff17c4521996da`. It resolved 89 changed files, 32
mutatable sources, 93 ranges, 28 shards (26 Vitest, one schema-static, one
Vitest-config-static), and 26 accountable tests.

It was stopped after 9 of 28 shards had completed successfully because only
three were cacheable. Five passed fail-closed with
`environment-runtime-input`, and one passed fail-closed with
`computed-child-execution-input`; a warm run therefore could not meet the 100%
reuse target. The interrupted tenth shard and shutdown brought diagnostic wall
time to 766513.098875 ms. This is not a cold baseline and no savings are
inferred from it. Its retained diagnostic record is
`reports/mutation-performance/0442f489-58e6-4e44-8faa-9911d75ceeaf.json`.

The historical head includes CHG-014 commits after the US-023 work, so it is a
reproduction of the original US-023 diff scope with the new runner, not a
checkout of the original final US-023 tree. This and the non-cacheable legacy
execution inputs are why the approved representative fallback is the reported
comparison.

## Verification and observed bottlenecks

`rtk pnpm test:mutation-evidence` and `rtk pnpm test:mutation-scope` passed.
Their real temporary fixtures prove metadata-only reuse; invalidation for
source, responsible test, local dependency, configuration, lockfile, runner,
tool, and DB-profile changes; and reuse again after restoration. The benchmark
also exposed that interrupted Stryker sandboxes under `.tmp` were entering a
fallback workspace fingerprint. A strict failing regression reproduced that
state dependence; the walker now excludes the runner's generated `.tmp`
directory, and the focused suites plus a second full `rtk pnpm check` pass.

Cold time is dominated by two sequential Stryker startups. Each scans and
copies roughly 950 repository files, and repeatedly attempts to preprocess
unrelated generated screen HTML that emits parse warnings. The warm path avoids
Stryker entirely; its remaining 174.906083 ms is dependency/profile hashing,
cache validation, report rehydration, and manifest/performance I/O.

For a later Substrate implementation, retain the same fail-closed evidence-key
and artifact-validation contract, but build a precise execution dependency
graph so unrelated workspaces, generated HTML, and unsupported legacy inputs do
not force broad fallbacks. Execute independent cache misses as parallel remote
shards, keyed by that graph plus tool/runtime/DB-schema profiles, and return the
same signed or hashed shard artifacts for local validation. The representative
result demonstrates reuse latency; the incomplete historical diagnostic shows
that graph precision and parallel execution, not weaker validation, are the
next useful optimizations.

## Machine profile

- macOS Darwin 25.5.0, arm64, Apple M4
- 10 logical CPUs, 25,769,803,776 bytes memory
- locale `en-US`, timezone `America/Guayaquil`
- Node 26.5.0, pnpm 9.15.0, TypeScript 5.9.3, Vitest 4.1.10,
  Stryker 9.6.1
- PostgreSQL 16.14 in the isolated local Docker database described above

These are same-machine local measurements and must not be treated as
cross-machine performance guarantees.
