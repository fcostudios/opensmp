**Work item:** CHG-064
**Readiness assessment:** docs/readiness/CHG-064.json
**Approved estimate:** 310 minutes

# CHG-064 — fix the three unchanged-test flakes that fail the full gate — Implementation Plan

**Goal:** `pnpm check` (turbo forced, default package and file parallelism) passes ten consecutive
runs on one unchanged candidate, so the US-069 RULING-20 serial scheduling can be retired. Tests, the
testing fixture and (re-approved widening, CHG064-READY-2) the release parity tool's cleanup; no
application behaviour change.

If, at any task boundary, the remaining work will exceed the approved estimate, stop there and file a
`blocked` or `deviation` feedback event before continuing.

## Task 1 — fixture teardown drains before terminating (AC1)

**Production sources touched:** none (`packages/db/src/testing/postgres-container.ts` is excluded from
mutation by `scripts/mutation-scope.mjs` `(^|/)testing/`).

Root cause (pg-pool 3.14.0): `Pool.end()` calls `client.end()` without awaiting it and resolves once
its client list is empty. Each idle client keeps the pool's idle error listener. When the fixture's
`pg_terminate_backend` reaches a backend that has not yet processed the client's Terminate, the
backend sends FATAL `57P01`, the idle listener re-emits it on the pool, and a pool with no `error`
listener throws an uncaught exception into whichever suite tears down last.

1. RED: in `postgres-container.test.ts`, create a fixture, open a pool on `appUrl` with many
   concurrently checked-out-then-released clients, attach `pool.on("error", push)`, `await pool.end()`,
   then `await fixture.stop()` immediately; repeat; assert no pool error. Record the observed RED rate
   on the unchanged fixture (never assumed).
2. GREEN: both stop paths (container and mutation clone) wait until no `client backend` other than
   their own remains on the database (`pg_stat_activity`, `backend_type = 'client backend'`), bounded
   well below the Vitest hook timeout, before `pg_terminate_backend` — which then reaches only genuine
   leaks.

## Task 2 — reporter oracle asserts the guaranteed invariant (AC2)

`report()` returns `created` only when the creating caller also wins the delivery claim; under load a
deduplicated caller can win the claim, send, and return `deduplicated`, so 0 × `created` is legal.
The concurrent-batch assertions become: every result is `created` or `deduplicated`, at most one is
`created`, exactly one SMTP message exists immediately after the batch, and the existing single
event / single pending→claimed→succeeded delivery assertions stay. Net stronger: the delivery count is
newly pinned.

## Task 3 — dispatch build test drops the implicit deadline (AC3)

The test has no explicit timing bound; it inherits Vitest's default 5000 ms `testTimeout` while
running two synchronous `pnpm run build` processes. Passing `0` removes that implicit bound (Vitest
4.1 `withTimeout` returns the function unwrapped for `timeout <= 0`); it is not a longer timeout. The
oracle stays the artefact property (no `dist` / `.tsbuildinfo` side effects, both builds exit 0), with
`stderr` in the status assertion messages.

## Task 4 — ten consecutive full gates and RULING-20 retired (AC4)

1. `pnpm mutation:preflight` once on the committed candidate: expect zero intersecting shards; record
   zero previews; no cold campaign, no `test_report`.
2. Ten `TURBO_FORCE=true pnpm check` runs on the same committed HEAD; logs, exit codes and wall times
   in the session scratchpad; tree unchanged throughout.
3. Before: one forced RULING-20-shape gate (`pnpm run test --concurrency=1 -- --no-file-parallelism`)
   and one forced default gate on unchanged main. After: the ten candidate wall times.
4. A decision event supersedes RULING-20 (it was invocation-only; the pre-existing
   `fileParallelism: false` configs predate it and stay).

## Task 5 — parity cleanup survives autovacuum (AC5, added by CHG064-READY-2)

**Production sources touched:** `packages/db/scripts/check-migration-parity.mjs` (release tooling,
`.mjs`, not mutatable). Also fixed under AC4 during round 1: the org-registry repository test resets
its session-level `statement_timeout` before releasing the pooled client.

Root cause (reproduced on the pinned PostgreSQL 16 image): `DROP DATABASE ... WITH (FORCE)` run by the
non-superuser `ledger_owner` fails 42501 when an autovacuum worker is on the database, because FORCE
tries to terminate it. RED: a migration-release test lowers `autovacuum_naptime` as cluster admin and,
from `beforeCompare`, holds an autovacuum worker on the parity database until cleanup; the old cleanup
fails 42501. GREEN: terminate the client backends of the database (same permission semantics as before
for client sessions), then plain `DROP DATABASE IF EXISTS`, which cancels autovacuum workers itself.
Then a fresh ten-run round (Task 4) on the new candidate.

**Out of scope:** CHG-065, `WORK_READINESS.md`, `docs/dev-guide/local/CLAUDE.md`, production sources,
and the deliberate `pg_terminate_backend` callers in other tests and mutation runner scripts.
