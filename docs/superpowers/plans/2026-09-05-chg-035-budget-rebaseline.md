**Work item:** CHG-035
**Readiness assessment:** docs/readiness/CHG-035.json
**Approved estimate:** 80 minutes

# CHG-035 — Re-baseline the execution budget to 320

## Task 1 — Verify both premises before editing

Confirm the substrate really enforces 320 (read `execution_budget` from
`project_configs`, and run the `[Execution Budget Sizing]` section), and
re-locate every budget-related `120`. The scope table was written before the
four preceding cuts landed, so its line numbers are stale by construction — the
sites are what matter.

## Task 2 — Hoist the literal into one constant

The CHG asks for a design change, not a find-and-replace: export
`MAX_READINESS_MINUTES` from `model.mjs` and have both the hard-limit comparison
and its message read it. A future re-baseline then edits one line plus the
schema.

**Boundary check:** if the remaining work will exceed 80 minutes, stop here and
file a `deviation` event before continuing.

## Task 3 — The sites the constant cannot reach

Both schema `maximum` values, the three `WORK_READINESS.md` lines, and the
`CLAUDE.md` sentence are data or prose, not code. Update them in this same
commit so doc and enforcement never drift mid-rollout.

## Task 4 — Bind the schema to the constant with a test

A constant the schema does not track is two sources of truth again. Add a test
asserting both schema maxima equal `MAX_READINESS_MINUTES`, so the next
re-baseline fails loudly if it updates one and not the other.

## Task 5 — Boundary fixtures and the grep

Move the two `121` fixtures to the new boundary: 320 passes, 321 raises
`WR_ESTIMATE_OVER_BUDGET`. Then run the CHG's own success criterion — a grep for
a budget-related `120` across scripts, schema and docs returns nothing.

`WR_PLAN_ESTIMATE_OVER_BUDGET` compares a plan against its own approved per-item
estimate, not against the ceiling. Leave it alone.
