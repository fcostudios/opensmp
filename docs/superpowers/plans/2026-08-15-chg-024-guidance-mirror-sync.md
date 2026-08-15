**Work item:** CHG-024
**Readiness assessment:** docs/readiness/CHG-024.json
**Approved estimate:** 75 minutes

# CHG-024 — Agent guidance mirrors track the layered CLAUDE.md

## Problem

`CODEX.md`, `.cursorrules` and `.github/copilot-instructions.md` are byte-identical
to each other (`bf6182a5…`) and differ from `CLAUDE.md` (`9c3afc56…`) by exactly
the ten-line **Work Readiness Gate** section that CHG-022 added. Codex, Cursor
and Copilot are therefore all reading guidance that omits the gate this
repository treats as mandatory.

The cause is in `infra/scripts/reconcile-sprint1-docs.py :: build_plan`:

```python
mirrored_claude = pinned["CLAUDE.md"][3]
for relative_path in MIRRORS:
    desired[path] = mirrored_claude
```

`pinned["CLAUDE.md"][3]` is the **CHG-001 baseline** text, not the layered
result. The `PINNED_PATHS` loop above already computes the fully layered
CLAUDE.md into `desired[<CLAUDE.md path>]`; the mirror loop ignores it.

This was deliberate and correctly scoped at the time — CHG-022's
`bootstrap_authorization.allowed_paths` is a closed 21-path list that excludes
all three mirrors, so CHG-022 could not legally write them. CHG-024 exists to
carry that change.

## Approach

Point the mirror loop at the layered result:

```python
claude_path = project_output_path(root, "CLAUDE.md")
mirrored_claude = desired[claude_path]
```

This makes the mirrors self-maintaining: every future layered override on
CLAUDE.md propagates to all three mirrors with no further code change. That is
the durable property, not the one-time content fix.

## The reconciler byte-pin

`scripts/work-readiness/git.mjs` pins the reconciler:

```js
const REVIEWED_RECONCILER_SHA256 = "9ab3409f90b445ae13a3663939ad6be74296995ee5ba7f8c4bc173280883d3d8";
```

`registeredOverlayLayers()` returns `[]` when the bytes do not match, which
silently disables overlay-layer ownership for `docs/stories/**` — a fail-closed
path that degrades quietly. The constant must be re-pinned to the new digest in
the same commit, and the comment above it requires that to be an explicit
reviewed act rather than a mechanical refresh.

## Acceptance criteria

- **AC1** — The reconciler writes all three mirrors from the layered CLAUDE.md;
  `sha256(CLAUDE.md)` equals each mirror's digest after reconciliation.
- **AC2** — `--check` fails when a mirror drifts from the layered CLAUDE.md, so
  the invariant is enforced rather than merely applied once.
- **AC3** — `REVIEWED_RECONCILER_SHA256` equals the post-change reconciler
  digest, so overlay ownership keeps working.

## Test plan (TDD)

Extend `infra/scripts/tests/test_reconcile_sprint1_docs.py`.

1. **RED** — a test asserting that after `build_plan`, the desired text for each
   mirror equals the desired text for `CLAUDE.md`. Expected pre-change failure:
   mirrors equal the CHG-001 baseline, which lacks the Work Readiness Gate.
2. **RED** — a test asserting `--check` reports drift when a mirror is replaced
   with the stale baseline text.
3. **GREEN** — repoint the mirror loop.
4. Re-pin `REVIEWED_RECONCILER_SHA256`, then assert in
   `scripts/test-work-readiness.mjs` that the constant matches the on-disk
   reconciler digest, so this class of drift is caught mechanically next time.

## Files (6 expected)

- `infra/scripts/reconcile-sprint1-docs.py`
- `infra/scripts/tests/test_reconcile_sprint1_docs.py`
- `scripts/work-readiness/git.mjs`
- `scripts/test-work-readiness.mjs`
- `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md` — regenerated output

Six source files plus regenerated mirrors; the readiness signal of 6 counts the
edited set, with the three mirrors as one regenerated unit.

## Verification

- `pnpm test:infra`
- `node scripts/test-work-readiness.mjs`
- `python3 infra/scripts/reconcile-sprint1-docs.py . --check`
- Byte equality of CLAUDE.md and the three mirrors

## Risks

Reconciler edits are governed by a fail-closed byte-pin. If the digest is not
re-pinned, overlay ownership degrades silently rather than failing loudly —
AC3 and the new mechanical assertion exist specifically to prevent that.
