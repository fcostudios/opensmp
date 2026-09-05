**Work item:** CHG-039
**Readiness assessment:** docs/readiness/CHG-039.json
**Approved estimate:** 85 minutes

# CHG-039 — One spelling at every call site

Child 4 of the work-readiness simplification, re-scoped after its filed premise
measured false.

## Task 1 — Prove the premise before building on it

CHG-034's correction log says the doc and schema declare 23 unraisable codes.
Check it against the tree at CHG-034's start, not just today. If they declare
zero, AC7 as written is unsatisfiable and the child must be re-scoped or dropped.

## Task 2 — Normalise every bare code

Rewrite each `fail("X", …)` / `cliError("X", …)` whose code lacks the `WR_`
prefix to `fail("WR_X", …)`. Behaviour is unchanged by construction: `fail`
already produced that exact string. Do not touch the codes that are already
prefixed.

**Boundary check:** if remaining work will exceed the approved estimate, stop and
file a deviation event first.

## Task 3 — Lock it, and re-measure honestly

Add a source-level test that fails on any bare code, so the spelling cannot
drift back. Then re-count the code set and record the corrected totals — the
per-child deltas stand, the absolute base does not.
