# CHG-035 — Re-baseline the work-readiness execution budget from 120 to 320 minutes, calibrated by IMP-374

## Status

Filed in `nous.db` as **CHG-035** (`kind: technical`, per IMP-370) against
`fcostudios__smp` on 2026-09-05; this document is the CHG body. One child is
expected — the change is a constant, its mirrors, and their tests — and its own
readiness artifact fits comfortably under either budget, so it is approvable
under the current (signed) gate. It is independent of CHG-034 and goes
**first**, so CHG-034's children can be approved without artificial partition.

## Why 320, measured

IMP-374 (nous substrate, verified 2026-09-05) added an `execution_budget`
project-shape config and a recalibrator that joins each story's design-phase
`Size` (story points, from the story file) with its readiness
`estimate_minutes.total`. On this project that join yields two usable pairs:

| item | SP | approved estimate | min/SP |
|---|---:|---:|---:|
| US-043 | 2 | 100 | 50.0 |
| US-018 | 3 | 310 | 103.3 |

The recalibrator selects the **slowest** rate, never the mean, and persists it
as an integer rounded up: **104 min/SP** (`execution_budget.minutes_per_story_point`,
set 2026-09-05 with `calibration.min_samples` lowered from 3 to 2 because only
two pairs exist — an explicit operator override, recorded in the config version
notes).

Story sizes on this project (55 stories): 34 × 3SP, 16 × 2SP, 4 × 5SP, 1 × 1SP.
The 30 unstarted: 13 × 2SP, 15 × 3SP, 2 × 5SP. What each budget would flag
among the unstarted, at 104 min/SP:

| `max_readiness_minutes` | unstarted over budget |
|---|---|
| 120 (today) | 30 of 30 |
| 240 | 17 of 30 |
| **320** | **2 of 30** — US-019 and US-034, both 5SP |

320 is the smallest round budget that fits the modal 3SP story (3 × 104 = 312).
The 120 came from one incident (US-025: 11 hours, 57 files, 47 commits) and was
never calibrated against the story-point scale the design phase uses — the
2026-08-15 retro's systemic finding. Keeping 120 means every remaining story
partitions into children with their own artifacts and approvals; that is the
churn this project is trying to end.

**The two systems currently disagree.** The substrate config already says 320
(`execution_budget.max_readiness_minutes`, 2026-09-05), so nous's ready-check 163
and `[Execution Budget Sizing]` drift pass a 300-minute story that
`pnpm readiness:check` still refuses. This CHG makes them agree.

## Scope — one number, every place it is written

| file | line | today | after |
|---|---|---|---|
| `scripts/work-readiness/model.mjs` | 305 | `total > 120`; message "Estimate exceeds 120 minutes" | `> MAX_READINESS_MINUTES`; message built from the constant |
| `docs/dev-guide/work-readiness.schema.json` | 340 | `"maximum": 120` (`estimate_minutes.total`) | 320 |
| `docs/dev-guide/work-readiness.schema.json` | 712 | `"maximum": 120` (partition child `estimate_minutes.total`) | 320 |
| `docs/dev-guide/WORK_READINESS.md` | 31, 56, 368 | "120 minutes" | 320 |
| `CLAUDE.md` | 67 | "A work item above 120 minutes" | 320 |
| `scripts/test-work-readiness.mjs` | 225, 399 | fixtures at 121 / partition child over 120 | boundary fixtures: 320 passes, 321 → `WR_ESTIMATE_OVER_BUDGET` |

Design ask, not just a find-and-replace: hoist the literal into **one exported
constant** in `model.mjs` (`MAX_READINESS_MINUTES = 320`) that the hard-limit
check and its message both read, and add one test asserting the two schema
`maximum` values equal the constant — so the next re-baseline is a one-line
edit plus schema, and a drift between doc and enforcement is a test failure.

`WR_PLAN_ESTIMATE_OVER_BUDGET` (`test-work-readiness.mjs:2799`) compares a plan
against its own approved per-item estimate, not against the ceiling — unchanged.

## Non-goals

- No gate mechanics change. Signing, the 45/90-minute checkpoints, the dual
  ledger, and the git-code sprawl are CHG-034's four cuts.
- No re-signing of the 20 historical decisions; no re-validation of any
  `dev_done` work.
- No re-planning of stories. US-019 and US-034 (5SP → 520 min at 104) still
  partition through the kept vertical-slice contract when their sprint arrives.
- Not a promise of accuracy. The two calibration pairs are **estimates**, and
  `docs/readiness/README.md:78-82` already records estimates running two to three
  times under actuals ("105 minutes was really 220"). See "Follow-through".

## Rollout

1. One readiness artifact at `docs/readiness/CHG-035.json`; its estimate is well
   under 120, so it is approvable under the gate exactly as it stands today.
2. One commit: the constant, both schema maxima, the three `WORK_READINESS.md`
   lines, the `CLAUDE.md` sentence, and the boundary tests. Doc and enforcement
   never drift mid-rollout.
3. `pnpm readiness:check` on a 320-minute single-outcome fixture passes; 321
   returns `WR_ESTIMATE_OVER_BUDGET`. The existing suite stays green.
4. nous side: `change deliver CHG-035` (this project's close gate is
   `warn-only`).

## Success criteria

- One constant. A grep for `\b120\b` across the gate's scripts, schema, and docs
  returns nothing budget-related.
- Substrate and tenant agree: nous's `[Execution Budget Sizing]` names exactly
  US-019 and US-034, and `pnpm readiness:check` accepts a 300-minute
  single-outcome estimate.
- No unstarted story of 3SP or less needs partition for budget reasons.

## Follow-through (not this CHG)

- **Record `actuals.total` on every completed item.** The field exists and is
  filled on 1 of 17 artifacts. Once at least two stories carry both a `Size`
  and `actuals.total`, point the recalibrator at actuals
  (`execution_budget.calibration.minutes_jsonpath`) and re-run. If the true rate
  is ~2× the estimate rate, 320 gets revisited — from data, in a config diff,
  not by feel.
- The partition children US-056..US-062 exist only in `docs/readiness/` and have
  no `nous.db` story, so they cannot enter calibration. The round-trip is a
  named substrate follow-up (IMP-374 REVIEW_PASS §10).
