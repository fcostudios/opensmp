**Work item:** CHG-066
**Readiness assessment:** docs/readiness/CHG-066.json
**Approved estimate:** 315 minutes

# CHG-066 — full-gate residue after CHG-064 — Implementation Plan

**Goal:** ten of ten forced default-parallel `pnpm check` runs on one unchanged candidate, started
from zero stale test containers; no container survives a failed or killed run; `pnpm check` refuses
to start over stale containers; `pnpm readiness:check:all` exits 0. Tests, testing fixtures, `.mjs`
tooling, CI env and the readiness validator only; no production behaviour change.

If, at any task boundary, the remaining work will exceed the approved estimate, stop there and file a
`blocked` or `deviation` feedback event before continuing. If the acceptance round is not ten of ten,
stop and return to Francisco with the data (CHG066-READY stop rule).

**Production sources touched:** none. Every changed source is a `*.test.ts`, a `testing/` fixture, a
`.mjs` script or config; `scripts/mutation-scope.mjs` excludes all of them.

## Task 1 — readiness validator accepts unknown decision keys (AC2)

`scripts/work-readiness/model.mjs`: the decision shape is closed only for the fields the gate reads
(`story`, `event`, `id`, `text`, `reason` required; `approved_by`, `subject_work_id`, `relationship`,
`key_id`, `signature`, `ts` typed when present). Unknown top-level keys are carried, not checked; the
IMP-417 `readiness` key must be a plain object when present. Applied to both closed-shape sites:
approval evidence (`validateDecisionRecordShape`) and correction authority
(`validCorrectionDecision`). RED fixtures in `scripts/test-work-readiness.mjs`: run-ruling keys with
their real types and a `readiness` object pass; malformed `approved_by`/`readiness` fail. Three
existing closed-shape cases flip.

Widening (CHG066-RULING-US021): opening the shape unmasked a second `check:all` failure, US-021's
informational `deviation` after its `done`. A `deviation` after the terminal event is accepted as
informational and never re-authorizes; every other implementation event after done still fails.

## Task 2 — health route on the shared fixture (AC4)

`apps/web/src/app/api/health/route.test.ts` uses `createPostgresFixture()` (pinned PG16 digest, 120 s
startup budget), connected as `ledger_app`; the `15_000` hook bound goes and the hook falls back to
the web config's `hookTimeout`. The 503 case still stops the real server (`stop()` stops the
container).

## Task 3 — Ryuk and the stale-container preflight (AC3)

- `apps/web/package.json` `test` drops `TESTCONTAINERS_RYUK_DISABLED=true`; `.github/workflows/ci.yml`
  drops it from both jobs (ubuntu-latest hosts Ryuk; restored in CI only with a comment if the first
  push shows Ryuk cannot start there).
- `keycloak-admin.integration.test.ts` starts Keycloak as a named testcontainers `GenericContainer`
  (same image, env, bind mount, command; HTTP wait on the realm with the old 120 s readiness budget),
  so Ryuk reaps it; `testcontainers@12.0.4` (already resolved transitively) becomes a direct devDep.
- `scripts/check-stale-test-containers.mjs` runs first in `pnpm check`: stale = a testcontainers
  container whose session has no running Ryuk, or a legacy unlabelled `ledger-us004-<uuid>`; prints
  the `docker rm -f` line and exits 1. Tests: `scripts/test-stale-test-containers.mjs`.
- Verification: SIGKILL a web test run mid-suite; `docker ps` shows no leftovers once Ryuk reaps.

## Task 4 — `WITH (FORCE)` audit (AC5)

One live site: `packages/db/src/testing/postgres-container.test.ts` orphan-clone cleanup, run as the
non-superuser `ledger_owner`; it takes the `check-migration-parity.mjs` pattern. `apply-migrations.mjs`
has none. The mutation-clone `backend_type` visibility limitation stays documented.

## Task 5 — ECONNRESET diagnosis (U1, AC1)

Two legs on the Task 1-4 candidate's baseline (unchanged main code): 0 stale and 20 seeded labelled
pinned-PG16 containers, five forced runs each, `docker ps -q | wc -l` before every run plus a 5 s
background sampler, failure timestamps correlated with the sample. Fix the cause the legs isolate;
budget 50 minutes; stop and return if none is isolated.

## Task 6 — acceptance round (AC1)

`/tmp/smp-full-gate.lock` held; ten forced default-parallel `pnpm check` runs on one committed
candidate from zero stale containers; per-run container count and wall time recorded; a round under
foreign container load is discarded and rerun.
