# CHG-039 — Make the `WR_*` code set countable: one spelling at every call site

Child 4 of **CHG-034** (`partition_required`), the
`reconcile-doc-and-schema-codes` partition — **re-scoped**, see below.

## The filed premise was wrong, and it was mine

CHG-034's execution-pass correction log claimed:

> "115 codes appear across doc+schema+implementation but only 92 are referenced
> in the implementation, so 23 are declared and unraisable."

**That is false.** `docs/dev-guide/WORK_READINESS.md` and
`work-readiness.schema.json` name **zero** `WR_*` codes as tokens — they describe
conditions in prose, and always have (verified against the tree at CHG-034's
start as well as today). The 23-code gap came from my own census accidentally
globbing `scripts/*.mjs`, which pulled in `scripts/test-work-readiness.mjs`.
There is no doc/schema code set to reconcile, so AC7 as written cannot be
satisfied by anything.

## The real defect, found by the same measurement

The census was wrong a second way, and this one matters: **codes are written two
ways.**

`fail()` normalises at throw time —
`const stableCode = code.startsWith("WR_") ? code : ${'`'}WR_${'$'}{code}${'`'};` — so a call
site may write either `fail("WR_APPROVAL_ORDER", …)` or
`fail("DECISION_MISMATCH", …)`, and both surface as `WR_*`. Measured today:

| spelling | call sites |
|---|---|
| `WR_`-prefixed | 52 codes |
| bare (prefixed at throw time) | 36 codes |
| **real distinct total** | **87** |

Every per-child figure recorded in this rollout so far (92 → 73 → 61 → 52) counted
only the prefixed subset. The **deltas are real** — each child removed exactly the
codes it named — but the absolute base was understated by 36, and the parent's
success criterion 1 ("`WR_*` code count measured and recorded in each CHG's
closure evidence") is not reliably measurable while two spellings exist.

## Outcome

Every `fail()` / `cliError()` call site spells its code with the `WR_` prefix, so
the code set is greppable and countable by anyone — including a future gate.
`stableCode` stays as a no-op safety net rather than a load-bearing translation.

No behaviour changes: every code surfaces exactly as it does today, because the
normalisation it replaces produced the same string.

## Acceptance criteria

- **AC7** — no `fail()` / `cliError()` call site raises a bare code; a source-level
  test asserts it, so the spelling cannot drift back.
- **AC5** — `check-all` returns the same verdict for all 21 artifacts, and the
  full suite passes with every existing assertion unchanged (the surfaced code
  strings are identical).
