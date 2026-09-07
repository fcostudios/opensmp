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

`CHG049_PATHS` mirrors the manifest's source paths, and `("CHG-049/6466f60", CHG049_PATHS)` is appended after CHG-044 in `LAYERED_OVERRIDE_SPECS`. The reconciler's resulting SHA-256 replaces `REVIEWED_RECONCILER_SHA256`; the adjacent comment records that CHG-051 reviewed only the final eight-path registration delta.

## Verification and failure handling

The existing check is the red test: before registration, `pnpm check:generated-guidance` names all eight unknown hashes. After registration, the focused reconciler suite and generated-guidance check must pass without changing live files. Manifest integrity is independently checked by recomputing all source and desired hashes. An isolated copy with an unlisted hash must still fail, proving the overlay does not become a wildcard.

After adversarial review and every fix, run `pnpm check`, then the one cache-cleared diff-scoped mutation campaign as the last executable verification. Since CHG-051 does not alter the critical set, the whole-set campaign is forbidden. Evidence and terminal commits may follow; implementation commits may not.

## Approved scope

Francisco Lomas approved the CHG-051 readiness payload and ordered CHG-050 before CHG-051. This design is confined to the nine overlay files, the reconciler registration, and the reviewed-hash pin.
