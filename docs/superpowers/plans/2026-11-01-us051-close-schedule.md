# US-051 close schedule implementation plan

> Execute inline with the executing-plans skill; the user authorized implementation of the existing specification.

**Goal:** Run the monthly license close on bd-3 and independently alert on missing or failed scheduled runs.
**Architecture:** Share close persistence in packages/db with injected domain calculation policy; preserve the manual action. Keep the watchdog in the 15-minute alert evaluator, independent of the close queue.
**Spec:** docs/stories/sprint-5/r1_misc_us_051.md; 08_scope.md AC1–AC4; BR-27.
**Constraints:** America/Guayaquil calendar, holidays included; append-only migrations; only this worktree and branch; merge main before final gate.

## Review focus
- Earlier no-op prechecks must not consume bd-3: distinct daily execution keys.
- Weekend after bd-3 must alert at local midnight, not on bd-4.
- Scheduled failures with no statements must be visible to finance.
- In-flight close must be committed before calculation waits on locks.
- Scheduled actor must not gain interactive privileges.

## Tasks
1. Write failing calendar/key tests; implement local-date daily precheck keys and completed-business-day watchdog boundary; run domain tests.
2. Write real-PostgreSQL close scheduling tests; extract shared close repository with calculation policy, durable running record and scoped reads; wire worker, system actor guard migration and failure facts; run seam tests and mutation preflight.
3. Write UI tests for actor, duration, NFR and tiles; bind persisted readouts using locale messages; preserve manual run and latest failure state.
4. Commit implementation, merge main and resolve shared close-screen changes. Run type-check, lint, build, full tests, committed migrations plus verifier. Emit build_pass, adversarial AC evidence, then run one final diff mutation campaign and emit test_report and done. Commit evidence and report SHA.
