# CHG-050 Delivery Carry Design

## Context and outcome

The 2026-09-06 Nous adopt and agent-files sync delivered 17 paths, but the local-only commit `1d52117` attributed those technical generator and guidance changes to functional story US-058. CHG-050 preserves the delivered tree while moving ownership to the technical CHG-049 partition. It also makes the already re-homed tenant-guidance section explicit about the seven protected agent documents remaining diverged-protected until IMP-393.

## Approaches considered

1. **Reconstruct the local-only sequence from the pre-US-058 base (recommended).** Create a recovery branch, apply the exact 17-path tree change without committing, add the required sentence inside the already changed `WORK_READINESS.md`, then commit under CHG-050. This produces truthful history and retains a recovery pointer.
2. **Revert and recommit on the existing sequence.** This preserves every commit but leaves a false US-058 carry in reachable main history and makes later attribution harder to audit.
3. **Interactive-rebase the carry commit in place.** This can reword and reorder the commit, but mixing reorder, content amendment, and later overlay insertion is less reviewable than building the corrected sequence beside a backup.

## Design

The source of truth for delivered bytes is commit `1d52117`, whose diff from its first parent contains the exact 17 named delivery paths. A recovery branch retains the current local sequence. A corrected branch starts from `20ba335`, receives the approved CHG-049/050/051 readiness evidence and CHG-050 plan, then applies only the `1d52117` tree delta.

`docs/dev-guide/WORK_READINESS.md` is already one of the delivered paths, so the required protection sentence does not expand the 17-path implementation scope. The sentence names `.cursorrules`, `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/dev-guide/SECURITY.md`, and `docs/dev-guide/STANDARDS.md`; it directs interim tenant guidance to tenant-owned files until IMP-393 supplies the extension seam.

No application behavior or executable logic changes. The correctness oracle is structural: exact path-set comparison, byte comparison for the other 16 paths, an expected one-section delta for `WORK_READINESS.md`, provenance-trailer inspection, and readiness validation. Because this is a Git-history and documentation carry rather than behavior, no new test is added; the child has zero expected mutation shards.

## Failure handling and recovery

The recovery branch is kept until the corrected main sequence and full CHG-051 gates are verified. No reset, unstage, adopt, or sync command is used. If the reconstructed diff contains an unexpected path or byte, stop before committing and compare it to `1d52117` rather than normalizing the delivery.

## Approved scope

Francisco Lomas approved the ID-bound CHG-049 partition and the CHG-050 readiness payload. This design is the direct implementation of that approved outcome and introduces no additional product decision.
