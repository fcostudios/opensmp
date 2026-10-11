**Work item:** US-074
**Readiness assessment:** docs/readiness/US-074.json
**Approved estimate:** 260 minutes

# Daily inactivity flagging implementation plan

**Status:** proposed; Francisco plan approval pending.
**Goal:** Daily, audited, tenant-scoped flagging and renewed-activity return of
open assignments' anchor requests using the shared lag-aware 30-day policy.
**Architecture:** Small DB persistence repository, thin worker adapter, existing
pg-boss schedule/runtime wiring. Shared classifier/read model remain read-only.
**Tech stack:** TypeScript, Drizzle, PostgreSQL 16, pg-boss 12.26.3, Vitest.
**Spec:** docs/superpowers/specs/2026-10-10-us-074-inactivity-flagging-design.md,
approved commit 644611a, SHA-256
83340ab759d35736f45f61cd04fc6ab84effd5c363fbf17df4e4a887a5062e85.

## Global constraints and ownership

- One consolidated implementer for all tasks; forced restart resumes the same
  implementer and is recorded. Controller briefs/reviews/decides, never implements.
- Reuse /root/us074_reviewer for scoped reviews, with AC list, exact diff range
  and commands. One fresh reviewer performs adversarial AC verification.
- Work only in /Users/fcolomas/Projects/smp-us074, branch us-074. Every commit
  includes US-074. Never commit implementation on chg-070.
- US-074 owns worker/schedule, DB request transition/audit persistence and tests.
  US-073 owns batch action/UI/proposals. Shared inactivity classifier and usage
  read model stay read-only; changing either requires deviation and coordination
  through Francisco before committing. No migration or tooling expansion.
- Read TESTING.md and TEST_EFFECTIVENESS_STANDARD before any test edit. No owned
  mocks; every test constrains an observable fault. Deterministic clocks, tenant
  isolation, real Postgres for reruns/races, no private containers.
- If at any task boundary remaining work exceeds the approved estimate, stop
  and append blocked or deviation before continuing. Outside findings are
  deviations/deferred hardening, never locally minted work items.
- All phase markers carry actual UTC ts. Phase accounting totals 260 estimated
  minutes: readiness25, implementation105, focused_verification50, review55,
  integration25. Actuals come from observed timestamps, not copied estimates.

## File map

Create packages/db/src/inactivity-flagging.ts (tenant-scoped persistence),
apps/worker/src/jobs/inactivity-flagging.ts (resource-owning adapter), and
apps/worker/src/jobs/inactivity-flagging.integration.test.ts (real-DB behavioral,
atomicity and race oracles).
Modify packages/db/package.json (./inactivity-flagging export and existing
@smp/domain workspace dependency), pnpm-lock.yaml (matching workspace importer),
packages/domain/src/jobs/schedule.ts and schedule.test.ts (schedule/daily keys),
apps/worker/src/jobs/deferred.ts and deferred.test.ts (composition),
apps/worker/src/runtime.ts and runtime.integration.test.ts (runtime registration
and execution). Existing request-transition.ts is reused without changes unless
an in-scope compatibility correction is necessary, with its relevant oracle.
Evidence paths: this plan, approved design, docs/readiness/US-074.json and
.nous-feedback.jsonl. Include a test seed helper in the integration test unless
size warrants apps/worker/src/jobs/testing/inactivity-fixture.ts. This fits the
18-file assessment; report actual count at closure. TESTING.md §3 is generated:
if critical-path declarations need changing, reconcile through Nous/config,
then inspect testing/critical-paths.md per IMP-434; never hand widen the set.

## Entry and verification procedure

- [ ] After plan approval, append approval feedback binding this exact plan's
  SHA-256 and commit with US-074. Validate readiness and feedback-order. Freeze
  the resulting HEAD as MUTATION_BASE and append a timestamped feedback record
  naming the full SHA, readiness digest, approved design/plan hashes, and
  controller/implementer/reviewer identities. Never silently move this base.
- [ ] Spawn the one implementer with this plan and design; do not choose fresh
  per-task implementers. Append started and implementation phase only after
  entry approvals. Readiness work is not a preapproval execution start.
- [ ] Install workspace dependencies if missing (pnpm install --frozen-lockfile).
  Use the existing CHG-067 shared-cluster runner for DB commands:

```sh
rtk pnpm exec tsx packages/db/src/testing/run-with-shared-postgres.ts pnpm --filter @smp/worker exec vitest run src/jobs/inactivity-flagging.integration.test.ts
```

If SMP_TEST_POSTGRES_CLUSTER_URL is already supplied, run the child command
against it directly. Never set isolatedContainer. Each fixture creates its own
DB on the shared cluster and uses ledger_app for runtime mutations.

- [ ] After each committed task's focused-green checks, preflight with frozen
  MUTATION_BASE and MUTATION_WORK_ID=US-074. Discover exact shard IDs, intersect
  sources with that task's named production sources, then launch selected
  caffeinate previews in the background. Collect at the next review boundary.
  No preview test_report. Database-backed/schema-static or >5min shards run
  once in the final preview unless a fix touched them. Three tasks plus at most
  one final fix-wave round, <=30 summed preview minutes. Last task/final round
  may merge. Re-preview only touched shards; explain any budget/whole-set exception.

```sh
rtk proxy env MUTATION_BASE=<recorded-sha> MUTATION_WORK_ID=US-074 pnpm mutation:preflight
rtk proxy env MUTATION_BASE=<recorded-sha> MUTATION_WORK_ID=US-074 MUTATION_SHARD=<discovered-id> caffeinate -i pnpm test:mutation
```

Angle-bracket values above are runtime outputs, not fixed shard IDs or guessed
Git authority. Persist preview logs and elapsed times outside the repository;
report actual routing count deviation without editing the approved payload.

## Task 1 — Atomic tenant-scoped flagging persistence and worker adapter

**ACs:** AC1–AC3 and rerun/tenant parts of AC4.
**Production sources:** packages/db/src/inactivity-flagging.ts,
apps/worker/src/jobs/inactivity-flagging.ts; request-transition.ts only if repaired.
**Files:** create these two modules and worker integration test; add DB export
and @smp/domain dependency to packages/db/package.json; refresh only the
corresponding pnpm-lock.yaml workspace importer with pnpm install.
**Consumes:** evaluateInactivity, hasPositiveVendorActivity,
applyRequestTransitionInTransaction; existing schema and real Drizzle transaction.
**Produces:**

```ts
createInactivityFlaggingRepository(database).runForCompany({
  companyId, evaluationDate, occurredAt,
}): Promise<number>
createInactivityFlaggingJob({ connectionString }): {
  drain(at: Date): Promise<{ processed: number }>;
  close(): Promise<void>;
}
```

- [ ] Add the existing workspace classifier dependency/export wiring as part
  of this task; no new external dependency or version upgrade.

```json
"@smp/domain": "workspace:*"
```

- [ ] Seed migrated real-DB fixtures with deterministic IDs, two companies,
  same-account observations, matching anchors/open assignments and injected at.
  Given data-through 2026-10-07, positive dates 2026-09-06, 09-07, 09-08 produce
  ages31/30/29. Assert exact state/transition/audit deltas after runForCompany(A);
  company B sentinel, proposals and provisioning actions remain unchanged.
  Run targeted test and observe the missing production export failure.

```ts
const at = new Date('2026-10-10T10:45:00Z');
expect(await repository.runForCompany({ companyId: companyA,
  evaluationDate: '2026-10-10', occurredAt: at })).toBe(1);
const states = await owner.query(
  'SELECT id::text,state::text FROM license_request WHERE company_id=$1 ORDER BY id',
  [companyA]);
expect(states.rows.find(row => row.id === request31)?.state).toBe('flagged_inactive');
expect(states.rows.find(row => row.id === request29)?.state).toBe('active');
const audit = await owner.query(
  'SELECT action,actor_user_id,before,after FROM audit_log WHERE entity_id=$1',
  [request31]);
expect(audit.rows).toHaveLength(1);
expect(audit.rows[0].action).toBe('request.flagged_inactive');
expect(audit.rows[0].actor_user_id).toBeNull();
expect(audit.rows[0].before.state).toBe('active');
expect(audit.rows[0].after.state).toBe('flagged_inactive');
```

Test identifiers above are the seeded fixture's values, not mocks. Extend the
same fixture with exact 30-day, lag-only, no-data, renewed activity, later
zero/null observations, metadata-only activity and same-person/different-account
negative controls. A B-company query before/after supplies the isolation oracle.

- [ ] Implement discovery of scoped open anchored assignments. Per candidate,
  use one READ COMMITTED transaction and locks in this order: scoped person
  FOR NO KEY UPDATE, assignment FOR UPDATE, anchor request FOR UPDATE. Process
  one candidate transaction at a time; sort IDs. Re-read scope/open/anchor
  identities after locks; skip stale rows and other request states.

```sql
SELECT id FROM person WHERE id=$1 AND company_id=$2 FOR NO KEY UPDATE;
SELECT id FROM license_assignment
WHERE id=$1 AND company_id=$2 AND person_id=$3 AND ended_on IS NULL
FOR UPDATE;
SELECT id,state FROM license_request
WHERE id=$1 AND company_id=$2 AND person_id=$3
  AND vendor_account_id=$4 AND license_type_id=$5 FOR UPDATE;
```

- [ ] Fetch watermark and this person/account's observations in one SQL
  statement under one snapshot after locks. Watermark is account-wide MAX of
  activity_date; positive date is selected by the unchanged shared allowlist.
  Use the shared classifier with window30, never duplicate lag/threshold math.

```ts
const evaluation = evaluateInactivity({ evaluationDate, accountDataThrough,
  lastActivityDate, window: 30 });
const to = state === 'active' && evaluation.classification === 'inactive'
  ? 'flagged_inactive'
  : state === 'flagged_inactive' && evaluation.classification === 'active'
    ? 'active' : null;
if (to === null) return 0;
await applyRequestTransitionInTransaction(tx, {
  requestId, from: state, to, actorUserId: null, occurredAt,
  note: `inactivityFlagging: dataThrough=${evaluation.dataThrough}; lastActivity=${evaluation.lastActivityDate}`,
}, { expectedCompanyId: companyId });
return 1;
```

- [ ] Build adapter with owned pg Pool/Drizzle, enumerate all companies without
  status restriction, sum mutations, validate injected date, close in finally.
  It performs no provider calls, proposals, assignment ending or offboarding.
- [ ] Prove a direct rerun returns0 with unchanged evidence counts; insert new
  positive activity, verify flagged->active with one new transition/audit, and
  prove subsequent rerun0. Verify an audit insert failure rolls back state and
  transition, using real DB constraint/trigger failure and cleanup.
- [ ] Run focused real-DB suite and DB/worker type-check. Commit
  feat(US-074): add atomic lag-aware inactivity flagging. Launch applicable
  preview round (defer slow shards) and request scoped reviewer verdict.

## Task 2 — Daily schedule and runtime dispatch

**ACs:** AC1, AC2; runtime idempotency contributes AC4.
**Production sources:** packages/domain/src/jobs/schedule.ts,
apps/worker/src/jobs/deferred.ts, apps/worker/src/runtime.ts.
**Files:** these sources and their existing tests plus worker integration oracle.
**Consumes:** Task1 createInactivityFlaggingJob and the existing JobName/runtime.
**Produces:** runnable daily inactivityFlagging queue with distinct daily key.

- [ ] Add failing schedule assertions for exact cron/timezone, Ecuador display
  time and daily scheduled/manual keys. Run domain focused suite to see failure.

```ts
expect(JOB_SCHEDULES.inactivityFlagging).toEqual({
  cron: '45 10 * * *', queue: 'inactivity-flagging', timeZone: 'UTC',
});
expect(createScheduledJobIdempotencyKey('inactivityFlagging', {
  at: new Date('2026-10-10T10:45:00Z'),
})).toBe('inactivity-flagging:2026-10-10');
```

- [ ] Add JOB_SCHEDULES entry, SCHEDULE_TIME_DOCUMENTATION counterpart
  45 5 * * *, explicit createJobIdempotencyKey branch, runtime two-day window.
  Compose deferred handler with the Task1 adapter and successfulJob(processed),
  preserving dependency-not-delivered behavior without services and pool cleanup.

```ts
inactivityFlagging: async ({ at }) => {
  if (!services) return dependencyNotDelivered('US-074');
  const job = createInactivityFlaggingJob({
    connectionString: services.connectionString,
  });
  try { return successfulJob((await job.drain(at)).processed); }
  finally { await job.close(); }
},
```

- [ ] Extend real pg-boss runtime integration fixture to assert persisted daily
  schedule and enqueue/dispatch through the actual handler to seeded requests;
  verify completed execution plus state/transition/audit evidence. Replay daily
  key returns processed0 and no duplicate evidence. No handler/service mocks.
  Keep connector/network boundaries unused by this job. Update existing exact
  schedule/queue-count expectations for the new entry.
- [ ] Run domain schedule test, worker deferred test, affected runtime real-DB
  tests under shared-cluster runner, then domain/worker type-check. Commit
  feat(US-074): schedule daily inactivity flagging after analytics sync. Launch
  touched-shard preview round and request reused reviewer with prior..new SHA.

## Task 3 — Deterministic concurrency proof and final repair wave

**ACs:** AC4 plus protection of AC1/AC3 during assignment changes.
**Production sources:** Task1 DB/worker modules only if a proved fault requires
repair; otherwise no production change and route previews via affected tests.
**Files:** worker integration test, optional scoped repairs in Task1 modules.
**Consumes:** actual repository/job and shared Postgres two-connection fixture.
**Produces:** real-DB race/rollback proofs for both directions without timers.

- [ ] Before edits, read testing guidance again if not retained. Add deterministic
  blocker transactions and inspect pg_blocking_pids to establish the actual
  wait boundary. Query this condition until observed under a bounded timeout;
  yield/poll >=60s for controller jobs, never controller 1s polling. The test
  synchronizes with database locks rather than guessing timing with sleeps.

```sql
SELECT pg_blocking_pids(pid) FROM pg_stat_activity
WHERE application_name=$1;
```

- [ ] Manual-wins case: manual client locks request, applies active->offboarding
  and commits while job waits; job then skips, preserves offboarding, and adds
  no flag audit/transition. Job-wins case: block job at audit via a real DB lock,
  start manual expected-active transition, release blocker; flag commits once
  and manual rejects expected-state conflict cleanly. Assert final state and
  complete evidence for winner; no partial loser writes. Repeat relevant state
  race for renewed-activity flagged->active.
- [ ] Hold assignment or person locks on independent connections, close assignment
  or transfer person before releasing; job must recheck and skip. Verify the
  FOR NO KEY UPDATE choice permits cross-org FK KEY SHARE acquisition without
  a person/assignment deadlock. Restore fixture state after each independent
  proof. Account/person/anchor mismatch cases must never write across tenants.
- [ ] Collect prior previews. Repair genuine survivors and review findings in
  this checkpoint wave. Re-preview only touched shards; run slow DB shards
  once now. Keep one-line equivalent/accepted annotations for reviewer sign-off.
- [ ] Focused-green race suite plus affected compatibility tests. Commit
  test(US-074): prove rerun and concurrent transition safety. Reused reviewer
  reviews AC1–AC4, diff since prior checkpoint, commands, survivor annotations.
  Do not expand work into unrelated hardening.

## Final verification, campaign and closure

- [ ] Collect all previews and reviewer repairs, record preview_rounds/minutes.
  Stop scored changes only after review passes. Append review phase with ts.
- [ ] Implementer acquires /tmp/smp-full-gate.lock atomically using O_EXCL;
  if it exists, wait >=60s and retry without deleting it. Write owner identity
  and release only the lock this process owns in finally. Launch one final
  caffeinate -i pnpm check with MUTATION_BASE and MUTATION_WORK_ID=US-074.
  Include committed-migration apply, verify and parity against disposable DBs
  on the shared Postgres cluster (ledger_owner DDL, ledger_app runtime).
  Persist logs/duration; controller yields >=60s. Record build_pass only on
  genuine success. A failure is repaired and relevant gates rerun.
- [ ] Append focused_verification phase with ts; brief one fresh adversarial
  reviewer with canonical story, AC1–AC4, frozen-base..HEAD, exact focused/runtime
  commands and fixture paths. Require attempts to break threshold/lag/no-data,
  unflag, other states, rerun, manual race and tenant isolation. Record one
  passing ac_verify per AC after actual proofs; any repair returns to reused
  reviewer and appropriate focused checks before campaign.
- [ ] Resolve sibling integration before authoritative campaign if a rebase
  affects scored files. First sibling closes normally and fast-forwards only after its terminal
  evidence commit; if the other sibling has already closed, second rebases onto new
  chg-070 without rewriting sibling commits. Preserve both ledger sides in ts
  order, append deviation mapping every old/new item SHA and approved authority
  base correspondence, run feedback-order/readiness and affected gate. Never
  silently discard evidence or a sibling decision. Source changes from rebase
  require review/gates before campaign.
- [ ] Append integration phase. Run final preflight, then clear mutation cache
  and run ONE diff-scoped cold campaign with frozen approved authority base.
  No implementation commit after it. If scored inputs change, append one named
  mutation_invalidation per discarded attempt; retain honest attempt counts.

```sh
rtk pnpm mutation:cache:clear
rtk proxy env MUTATION_BASE=<recorded-sha> MUTATION_WORK_ID=US-074 caffeinate -i pnpm test:mutation
```

- [ ] Require score>=80%, all survivors one-line annotated with reviewer verdict;
  append test_report with score/killed/survived/scope/wallclock. Record phase
  minutes, total, actual changed files/commits, review_fix_loops, cold attempts,
  invalidations, mutation minutes/shards, preview rounds/minutes and variance.
  root_cause names any preview exception and >2x median gate duration, then
  includes one implementer cost line and one reviewer cost line with session
  counts/restarts plus fresh adversarial session cost. Harness measured numbers
  when available, explicit nonzero estimates otherwise; include controller cost.
- [ ] Append cost-provenance feedback, then done with source_commit, ts and
  cost.calls/context_tokens/output_tokens/model/window. Commit readiness actuals
  and append-only events together as docs(US-074): close verified inactivity
  flagging. Validate readiness, feedback-order and clean state. Fast-forward
  integration under the sibling protocol after evidence is complete.
- [ ] Tell Francisco US-074 is ready for Nous pull/sync; when US-073 is also done,
  US-027 closes by verification. After any sync inspect testing/critical-paths.md
  and restore it if US-074 did not change its source configuration.

## Plan self-review

AC1 covered by Tasks1/2, AC2 by Task1 classifier/no-side-effect controls, AC3 by
Task1 renewed-activity evidence, AC4 by Tasks1/3 and runtime replay in Task2.
All production source scopes are named; DB -> domain is an acyclic workspace
dependency (domain depends only on contracts). No new migration, provider integration,
UI or proposal work. Shared-cluster command compensates for worker config's
lack of globalSetup. Task checkpoint commits and preview budgets are explicit.
Function signatures are consistent across tasks; runtime values are discovered
rather than hardcoded. Readiness estimate and payload remain unchanged.
