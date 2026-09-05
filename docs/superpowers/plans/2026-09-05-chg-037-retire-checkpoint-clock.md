**Work item:** CHG-037
**Readiness assessment:** docs/readiness/CHG-037.json
**Approved estimate:** 120 minutes

# CHG-037 — Retire the checkpoint clock, collapse to one ledger

Child 2 of the work-readiness simplification. Sections 2 and 3 of the parent
design, executed together because the artifact side mirrors the clock.

## Task 1 — Re-baseline

`check-all` before touching anything. Same verdict per artifact afterwards, or
history broke. 20 artifacts today.

## Task 2 — Separate the append-only guard from the bijection

The parent design lists `WR_FEEDBACK_HISTORY_MUTATED` as bijection machinery.
Read `validateFeedbackHistoryTransition` before believing it — if it never
touches the artifact side, it is the append-only guard on the ledger that
survives the collapse, and cutting it would be the opposite of the intent.

## Task 3 — Remove the clock

`git.mjs`: `findExecutionTimeline`, `commitEpochSeconds`,
`validateElapsedCheckpoint`, `hasBootstrapElapsedDeviation`, and the
execution-anchor call site in `validateCommitOwnership`.

**Boundary check:** if the remaining work looks like it will exceed the approved
estimate, stop here and file a `deviation` or `blocked` event before continuing.

## Task 4 — Remove the bijection

`git.mjs`: `canonicalFeedbackCheckpoint`, `validateCheckpointTransition`,
`validateAllCheckpointTransitions` and its call site.
`model.mjs`: `validateCheckpointPolicy`, `checkpointRequiresPartition`,
`validateCheckpointEvidence`, `terminalCompletionSolelySupersedesCheckpoint`,
`hasBootstrapCheckpointDeviation`, and the `checkpoint` branches in the
pre/post-approval history walks.

`checkpoints` stays an ACCEPTED but unvalidated artifact key — one artifact
records two real checkpoint events, and the closed-key shape check would reject
it otherwise. `init` stops emitting the key.

## Task 5 — Doc, schema, tests, measure

Replace the clock section of `WORK_READINESS.md` with the task-boundary
self-report. Drop `checkpoints` from the schema's required/validated set. Delete
every test exercising a removed path in this same commit; add the contract that
a long-elapsed item now passes. Record codes and LOC before/after.
