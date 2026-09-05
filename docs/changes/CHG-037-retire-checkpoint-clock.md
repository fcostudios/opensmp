# CHG-037 — Replace the wall-clock lock with a task-boundary self-report, and collapse to one ledger

Child 2 of **CHG-034** (`partition_required`), the `retire-clock-and-dual-ledger`
partition. Parent design: `docs/changes/CHG-034-work-readiness-simplification.md`
§2 and §3, plus its execution-pass correction log.

Sections 2 and 3 are executed as ONE child, deliberately. The parent's own §3
says the artifact-side `checkpoints[]` exists only to mirror the wall clock, so
landing §2 alone would leave `validateCheckpointEvidence`,
`terminalCompletionSolelySupersedesCheckpoint` and
`hasBootstrapCheckpointDeviation` dead-but-passing — the theatre the parent's
Rollout §3 forbids.

## Outcome

No git-timestamp checkpoint can force a stop disconnected from task structure,
and the readiness artifact no longer carries a `checkpoints[]` array that must
byte-match the feedback log in both directions. One ledger, not two that
reconcile.

## Measured motivation

The checkpoint ledger has recorded **2 events in 547** — both US-043's, and both
the direct evidence for this cut: the 90-minute gate forced a stop at the Task
2/3 boundary with Tasks 3-5 not started, for no reason connected to the work. A
clock cannot know where a safe stopping point is; a task list can.

## What goes

- the git-commit-timestamp execution anchor (`findExecutionTimeline`,
  `commitEpochSeconds`, `validateElapsedCheckpoint`, `hasBootstrapElapsedDeviation`)
- the mandatory 45-minute and 90-minute checkpoints and their policy validation
  (`validateCheckpointPolicy`, `checkpointRequiresPartition`)
- the artifact↔feedback bijection (`canonicalFeedbackCheckpoint`,
  `validateCheckpointTransition`, `validateAllCheckpointTransitions`,
  `validateCheckpointEvidence`, `terminalCompletionSolelySupersedesCheckpoint`,
  `hasBootstrapCheckpointDeviation`)
- codes: `WR_EXECUTION_ANCHOR_MISSING`, `WR_GIT_TIMESTAMP_REGRESSION`,
  `WR_GIT_TIMESTAMP_INVALID`, `WR_CHECKPOINT_45_REQUIRED`,
  `WR_CHECKPOINT_PARTITION_REQUIRED`, `WR_CHECKPOINT_ORDER`,
  `WR_CHECKPOINT_STATUS_INVALID`, `WR_CHECKPOINT_EVIDENCE_INVALID`,
  `WR_CHECKPOINT_EVIDENCE_MISMATCH`, `WR_CHECKPOINT_HISTORY_MUTATED`,
  `WR_CHECKPOINT_COMPLETION_REGRESSION`,
  `WR_BOOTSTRAP_CHECKPOINT_DEVIATION_REQUIRED`

## Correction to the parent design — `WR_FEEDBACK_HISTORY_MUTATED` STAYS

The parent's §3 lists `WR_FEEDBACK_HISTORY_MUTATED` alongside
`WR_CHECKPOINT_HISTORY_MUTATED` as bijection machinery to remove. It is not.
`validateFeedbackHistoryTransition` (`git.mjs:306`) is a pure **byte-prefix
append-only guard on `.nous-feedback.jsonl`** — it never reads the artifact side.
Removing it would leave the one surviving ledger silently rewritable, which is
the opposite of §3's own stated replacement ("`.nous-feedback.jsonl` is already
append-only and **is** the existing ledger of record"). It stays, and so does the
`actuals` machinery (`WR_ACTUALS_IMMUTABLE`, `validateAllActualTransitions`),
which the parent does not propose cutting.

## Historical compatibility

`checkpoints` remains an **accepted but unvalidated** artifact key rather than
being rejected outright. US-043's artifact records two real checkpoint events;
the closed-key shape check means dropping the key from the schema would fail
that artifact. Same lesson as child 1 (CHG-036): history is preserved by
accepting the old shape, not by rewriting it. `init` stops emitting the key for
new artifacts.

## Replacement

Every implementation plan already carries the mandatory three-line header and a
task breakdown. `WORK_READINESS.md` gains one line to that contract: *if, at any
task boundary, the agent judges remaining work will exceed the approved
estimate, stop there and file a `blocked` or `deviation` feedback event before
continuing* — the pattern US-002 and US-043 both used by hand, without gate
support.

## Acceptance criteria

- **AC2** — a work item whose commits span more than 90 minutes of git time
  passes `check-staged`; no checkpoint or execution-anchor code is reachable.
- **AC3** — the artifact carries no validated `checkpoints[]`, and no code
  compares artifact checkpoints against feedback records.
- **AC5** — `check-all` returns the same verdict for all 19 artifacts as the
  pre-cut baseline.

## Note

Removing the execution anchor also retires the latent defect found while landing
CHG-036: `findExecutionTimeline` matched a decision by `story === workId`, but a
`controlling_change` decision necessarily carries `story === <parent>`, so a
controlling-change-approved item could never satisfy
`WR_EXECUTION_ANCHOR_MISSING` and could never land an implementation commit.
