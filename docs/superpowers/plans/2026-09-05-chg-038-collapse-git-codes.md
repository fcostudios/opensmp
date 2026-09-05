**Work item:** CHG-038
**Readiness assessment:** docs/readiness/CHG-038.json
**Approved estimate:** 95 minutes

# CHG-038 — Collapse the git-plumbing codes

Child 3 of the work-readiness simplification.

## Task 1 — Classify before collapsing

Not every `WR_GIT_*` code means "a git command failed". Separate the ten that do
from the five that carry a distinct, actionable meaning — containment checks,
caller misuse, and range topology. Collapsing those five would lose information
a caller acts on.

## Task 2 — Collapse the ten

Rewrite each `fail("WR_GIT_<variant>", path, message)` as
`fail("WR_GIT_ERROR", path, message)`, preserving every message verbatim so no
diagnostic detail is lost — only the taxonomy above it.

**Boundary check:** if remaining work will exceed the approved estimate, stop and
file a deviation event first.

## Task 3 — Tests, doc, measure

Retarget every test asserting a collapsed code; assert the carried message rather
than the code taxonomy. Update the doc's code table. Record codes and LOC.
