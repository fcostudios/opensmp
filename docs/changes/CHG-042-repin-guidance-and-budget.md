# CHG-042 — Re-pin regenerated guidance and propagate the 320-minute budget

## Outcome

The reconciler accepts the reviewed 2026-09-05 Substrate outputs for
`CHANGES.md`, `CLAUDE.md`, and `testing/critical-paths.md`, while every
agent-facing readiness guide states the CHG-035 limit of 320 minutes.

## Constraints

- Add a new immutable CHG-042 migration layer; do not rewrite CHG-004 or
  CHG-022 artifacts.
- Bind every source and desired artifact with SHA-256.
- Preserve `testing/critical-paths.md` exactly as generated. CHG-040 owns the
  later canonical critical-set expansion.
- The five stale files are `AGENTS.md`, `CODEX.md`, `.cursorrules`,
  `.github/copilot-instructions.md`, and
  `docs/dev-guide/DEFINITION_OF_DONE.md`.
- `CLAUDE.md` is already the canonical 320-minute source for its three mirrors.

## Acceptance criteria

1. Both the previous reviewed artifacts and the 2026-09-05 artifacts converge
   to the new pinned desired state; unknown hashes continue to fail closed.
2. The five stale guidance files say `above 320 minutes`, all manifests match
   their artifacts, the focused reconciler suite passes, and
   `pnpm check:generated-guidance` exits zero.
