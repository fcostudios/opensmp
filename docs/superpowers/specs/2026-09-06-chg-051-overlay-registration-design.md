# CHG-051 Overlay Registration Design

## Context and outcome

CHG-050 carries eight generated guidance files whose current SHA-256 values are unknown to `reconcile-sprint1-docs.py`. Because the reconciler runs inside lint, the red state blocks every subsequent story. CHG-051 registers those exact bytes as a new immutable final overlay at `infra/scripts/overrides/CHG-049/6466f60/`; the suffix is the first seven characters of the delivery's `.nous-provenance.json` `git_sha`.

## Approaches considered

1. **Append one immutable final overlay (recommended).** Bind the latest reviewed source for each of the eight paths to the CHG-050 bytes, register the layer last, and re-pin the reviewed reconciler hash. This matches CHG-042/044 and preserves fail-closed history.
2. **Edit an existing overlay.** Fewer new files, but it destroys the append-only migration trail and makes old known states unverifiable.
3. **Extend provenance authorization to agent guidance.** This would broaden CHG-046's tightly scoped generated-story/spec envelope and weaken the tenant-owned review boundary; it is a new policy change, not a pin.

## Layer architecture

The new manifest has version 1 and exactly eight entries. Each entry names the latest immutable desired artifact that precedes CHG-049:

- AGENTS.md, CLAUDE.md, and DEFINITION_OF_DONE.md source from CHG-042.
- testing/critical-paths.md sources from CHG-044.
- FRONTEND.md, SECURITY.md, STANDARDS.md, and TESTING.md source from the original CHG-001 layer because no later registered layer contains them.

Each `source_sha256` is computed from that named immutable source. Each `desired_sha256` is computed from the post-CHG-050 live blob. The eight desired files stored beside the manifest are byte-for-byte copies of those live blobs. No live generated file is edited in CHG-051.

`CHG049_PATHS` mirrors the manifest's source paths, and `("CHG-049/6466f60", CHG049_PATHS)` is appended after CHG-044 in `LAYERED_OVERRIDE_SPECS`. The focused fixture loader copies and resolves that new final layer.

The delivery gives `CLAUDE.md` trailer `775530…` while `CODEX.md`, `.cursorrules`, and Copilot guidance each retain trailer `d39549…`. Their bodies are equal. CHG-024 currently replaces each whole mirror with the complete CLAUDE.md bytes, so clearing the eight pinned errors would create three protected mirror diffs. CHG-051 therefore narrows the mirror invariant to the intended semantic contract: the body before the single terminal `nous-emitted` trailer must match layered CLAUDE.md, while each mirror's own well-formed trailer is preserved exactly. Missing, duplicate, non-terminal, or malformed trailers fail closed. Focused tests first reproduce the three false diffs, then prove body convergence, trailer preservation, and malformed-trailer rejection.

The reconciler's resulting SHA-256 replaces `REVIEWED_RECONCILER_SHA256`; the adjacent comment records both reviewed deltas: one closed eight-path final layer and strict per-file trailer preservation. No other reconciliation behavior changes.

## Commit ownership

The immutable layer is intentionally named for parent CHG-049, while implementation authority belongs to official ready child CHG-051. Current ownership extraction unions work IDs found anywhere in changed paths with IDs from the commit message. That makes the storage path `infra/scripts/overrides/CHG-049/6466f60/…` falsely require executable readiness from the `partition_required` parent and makes a normal child commit impossible.

Overlay-storage identifiers are provenance coordinates, not implementation-owner claims. CHG-051 excludes work IDs found only beneath `infra/scripts/overrides/<CHG>/<layer>/` from the path-derived owner set. The commit message still must provide a ready work ID, ordinary work-ID-bearing paths retain union ownership, and `exactOverlayOwns` remains unchanged for later generated-target transitions. A focused Git fixture proves a CHG-051 message can carry a CHG-049-named overlay and that omitting the ready message owner still fails.

## Verification and failure handling

The existing check is the first red test: before registration, `pnpm check:generated-guidance` names all eight unknown hashes. A focused mirror fixture with equal bodies and distinct valid trailers is the second red test: the old whole-file mirror rule incorrectly schedules all three mirrors for replacement. After registration and the narrowed invariant, the focused suite and generated-guidance check must pass without changing live files. Manifest integrity is independently checked by recomputing all source and desired hashes. Isolated copies with an unlisted hash or malformed trailer must still fail, proving neither the overlay nor trailer handling becomes a wildcard.

After adversarial review and every fix, run `pnpm check`, then the one cache-cleared diff-scoped mutation campaign as the last executable verification. Since CHG-051 does not alter the critical set, the whole-set campaign is forbidden. Evidence and terminal commits may follow; implementation commits may not.

## Approved scope

Independent review exposed the masked mirror and fixture-loader requirements before the first implementation pass. The normal commit hook then exposed the parent-path ownership defect before any bypass was used. The final corrected design is confined to the nine overlay files, the reconciler registration and mirror invariant, the focused reconciler test file, the work-readiness ownership regression, and the reviewed-hash pin: thirteen implementation paths total.
