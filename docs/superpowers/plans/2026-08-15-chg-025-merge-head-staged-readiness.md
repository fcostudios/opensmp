**Work item:** CHG-025
**Readiness assessment:** docs/readiness/CHG-025.json
**Approved estimate:** 70 minutes

# CHG-025 — Staged readiness validates a merge HEAD against its first parent

## Problem

`scripts/work-readiness.mjs :: checkStaged` refuses any merge `HEAD`:

```js
const headLine = git(root, ["rev-list", "--parents", "-n", "1", head]).split(/\s+/u);
if (headLine.length > 2) cliError("WR_GIT_TOPOLOGY_UNSUPPORTED", "Staged readiness does not support a merge HEAD", "$.head");
```

The `commit-msg` hook calls `check-staged`, and there is deliberately no
readiness bypass. So the first commit after **any** merge is ungateable: a
branch created from the merge has the same `HEAD`, so the condition cannot be
escaped by branching. Observed on `09d5266`, which blocked every commit in the
repository until an operator cleared it out of band.

## Why the guard is unnecessary

`checkStaged` does not validate `HEAD` itself. It builds an ephemeral commit
from the staged tree with exactly one parent and validates that range:

```js
const commit = git(root, ["commit-tree", tree, "-p", head, "-F", "-"], { input: message });
const result = validateRangeOwnership({ root, base: head, head: commit });
```

`validateRangeOwnership` → `linearCommits` walks `base..head` and requires each
commit to have exactly one parent equal to the expected predecessor. The
ephemeral commit satisfies this by construction regardless of how many parents
`HEAD` has, because its own first and only parent **is** `HEAD`. The range
therefore contains exactly the staged diff, which is precisely what the gate
must inspect.

The guard rejects a topology the downstream validator already handles.

## Approach

Delete the merge refusal. Keep every other precondition — `HEAD` must still
resolve to one full commit, so an unborn `HEAD` still fails closed via
`WR_GIT_COMMAND_FAILED`.

Ownership strength is unchanged: side-branch commits were gated on their own
branch when they were made, and `linearCommits` still rejects any non-linear
range presented to `check-range`. This changes only which *starting points*
`check-staged` accepts, never what it permits to pass.

## Acceptance criteria

- **AC1** — With a two-parent `HEAD`, `check-staged` validates the staged tree
  against the ephemeral commit's first parent and succeeds for an owned change.
- **AC2** — With a two-parent `HEAD`, an unowned staged implementation path is
  still rejected, and an unborn `HEAD` still fails closed.

## Test plan (TDD)

Extend `scripts/test-work-readiness.mjs`. The existing test
`"CLI check-staged fails closed for unborn and merge HEAD states"` asserts the
behavior being removed and must be re-pointed, not deleted — its unborn half is
still correct and still required by AC2.

1. **RED** — new test: on a merge `HEAD`, a staged
   `docs/readiness/README.md` change (bootstrap-documentation) exits 0.
   Expected failure before the change: `WR_GIT_TOPOLOGY_UNSUPPORTED`.
2. **RED** — new test: on a merge `HEAD`, a staged implementation path with no
   owning work ID exits non-zero with `WR_WORK_ID_MISSING`, proving the gate
   still bites rather than being disabled.
3. **GREEN** — remove the two guard lines.
4. Re-point the existing merge assertion; keep the unborn assertion verbatim.

## Files (2 expected)

- `scripts/work-readiness.mjs` — remove the guard
- `scripts/test-work-readiness.mjs` — new tests, re-pointed assertion

## Verification

- `node scripts/test-work-readiness.mjs`
- `pnpm readiness:check -- CHG-025` and `pnpm readiness:check:all`
- Live proof: stage this work and let the real `commit-msg` hook gate it

## Risks

The guard may have been protecting an unstated invariant. Mitigated by AC2:
the negative test proves ownership still fails closed on the same topology. If
a reviewer identifies a concrete escape this reasoning misses, stop and
re-partition rather than weakening the range validator.
