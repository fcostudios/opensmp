**Work item:** CHG-029
**Readiness assessment:** docs/readiness/CHG-029.json
**Approved estimate:** 45 minutes

# CHG-029 — Allow a decision event before started

## Problem

Two repository rules were mutually unsatisfiable.

`WORK_READINESS.md:112-114` requires a signed approval decision to be emitted
**before** work begins. `check-nous-feedback-order.mjs:244` required `started`
to be the first event for a story, failing every other event that preceded it:

```
} else if (!state.started) {
  fail(line, `story ${record.story} event ${record.event} occurs before started`);
}
```

So an approval appended before work started always failed the lifecycle
checker, and `pnpm test` failed on `.nous-feedback.jsonl` lines 502-505
(CHG-023/024/025/026). Appending `started` afterwards cannot fix it: the log is
append-only and the decisions are already earlier in the file. `CHG-023` is a
partition record and is never started at all.

## Root cause

The checker contradicted its own authoritative vocabulary.
`docs/dev-guide/FEEDBACK.md` lists:

- **Lifecycle (flip story status):** `started`, `done`, `verified`
- **Decision (registered):** `decision`

`decision` is its own category. It was never in `terminalEvents` (built from
Lifecycle-minus-`started` plus deferrals) — only the blanket `!state.started`
branch caught it.

## Change

`scripts/check-nous-feedback-order.mjs` — exempt `decision` from the
started-first ordering rule, with a comment naming both governing rules.

`scripts/test-feedback-order.mjs` — three regression fixtures:

| Fixture | Expect |
| --- | --- |
| decision before started | exit 0 |
| decision with no started at all (partition record) | exit 0 |
| **non-decision event before started** | **exit 1** |

The third is the calibration fixture: the exemption must stay narrow.

## Verification

- `node scripts/check-nous-feedback-order.mjs` → `ok`, exit 0 on the real log.
- `node scripts/test-feedback-order.mjs` → `ok`.
- **Mutation calibration:** replacing the guard with an always-true condition
  makes `non-decision event before started still fails` the first failure,
  alongside 5 pre-existing ordering tests. The fixture kills the mutant.

## Scope boundary

Only the `decision` category is exempted. Every Lifecycle and Annotation event
(`done`, `verified`, `ac_pass`, `blocked`, `feedback`, …) is still required to
follow `started`, and the `build_pass`-before-terminal rule is untouched.
