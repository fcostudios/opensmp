**Work item:** CHG-067
**Readiness assessment:** docs/readiness/CHG-067.json
**Approved estimate:** 210 minutes

# CHG-067 — full-gate container-start burst and expiry lock-wait oracle — Implementation Plan

**Goal:** ten of ten forced default-parallel `pnpm check` runs on one unchanged candidate from zero
stale test containers (partition child of CHG-066, which closes after this by verification only).
Tests and the testing fixture only; no production behaviour change; zero mutation shards.

Stop rule (CHG067-READY): if the round is not ten of ten, stop and return to Francisco; the
per-worker shared container is the larger alternative and needs re-approval.

## Task 1 — expiry lock-wait oracle (AC2)

`apps/worker/src/jobs/automatic-invitation-expiry.integration.test.ts` "holds the applicable rule
through preparation commit" waits for the updater pid to be `state='active'` and then asserts
`pg_blocking_pids` non-empty. A backend is `active` from query start, before it reaches the lock, so
under load the assertion can run first. The wait predicate becomes `wait_event_type = 'Lock'` on that
pid, the condition the assertion means; the 10 s deadline is unchanged. RED evidence: a backend
running `pg_sleep` satisfies the old predicate while holding no lock wait, and does not satisfy the
new one.

## Task 2 — container-start lock in the fixture (AC3)

testcontainers 12.0.4 waits a hardcoded 10 s for Docker to publish a new container's ports; CHG-066
saw it exceeded when up to 13 fixture containers start together. `createPostgresFixture` starts its
container inside a cross-process lock (an atomic `mkdir` lock directory in the OS temp dir, holder pid
recorded, a lock whose holder is no longer alive is taken over), released as soon as `start()`
returns, before role bootstrap and before any test runs. Tests stay file- and package-parallel.
Tests (no Docker): concurrent in-process and cross-process holders never overlap; a dead holder's
lock is taken over; the lock is released when the body throws.

## Task 3 — acceptance round (AC1) and CHG-066 re-verification

`/tmp/smp-full-gate.lock` held; ten forced default-parallel `pnpm check` runs on one committed
candidate from zero stale containers, per-run container count and wall time recorded. In closure,
re-verify CHG-066 AC2-AC5 (`readiness:check:all` exit 0; a killed run leaves no containers).

## Task 4 — one shared cluster for the parallel web suite (CHG067-WAIVER-320)

Rounds 1 (one start slot, peak 11 containers, 9/10) and 2 (three slots, peak 13, 8/10) showed that
limiting concurrent starts does not reduce concurrently running containers. `apps/web` (the only
file-parallel suite; db and worker are file-serial) now runs `vitest run` through
`packages/db/src/testing/run-with-shared-postgres.ts`: one pinned PG16 container with
`max_connections=400` and the owner/app roles bootstrapped once; `createPostgresFixture` creates and
drops only its own database on it. Bootstrap-hooked or `isolatedContainer` fixtures (the health route,
whose 503 case stops the server) keep a private container; mutation runs keep their clone pair. The
wrapper, not `apps/web/vitest.config.ts`, carries the setup, because that config is a scored static
mutation target. One cluster-wide `pg_locks` read (org-registry) is scoped to its database. Full web
suite: peak 3 test containers. Also fixed on the way: the checklist-panel oracle asserted re-enabled
controls in the same commit as the alert (a test-oracle race seen once under load).
