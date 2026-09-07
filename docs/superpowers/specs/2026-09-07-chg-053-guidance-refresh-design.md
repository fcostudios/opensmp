# CHG-053 Guidance Refresh Registration Design

## Context and outcome

The 2026-09-07 substrate refresh after IMP-393 and IMP-398 delivered seven paths: `CLAUDE.md`, `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md`, `docs/dev-guide/FRONTEND.md`, `docs/dev-guide/CONTRIBUTING-GUIDANCE.md`, and `docs/dev-guide/local/CLAUDE.md`. The four agent-guide variants are now substrate-emitted and verified. Tenant-specific guidance is inlined under `## Project additions` from `docs/dev-guide/local/CLAUDE.md`; future tenant guidance belongs only in `docs/dev-guide/local/*.md`.

CHG-053 carries those exact seven delivered files under technical ownership and teaches the tenant reconciler to recognize the two generated states it currently reports as unknown. The intentionally frozen `AGENTS.md`, `docs/dev-guide/SECURITY.md`, and `docs/dev-guide/STANDARDS.md` remain untouched pending Nous IMP-399.

## Approaches considered

1. **Append a two-file immutable layer and recognize the new emitted framing (selected).** This follows CHG-042/044/051, preserves fail-closed history, and accepts only the exact delivered bytes.
2. **Replace the CHG-049 desired files.** This is smaller but destroys the append-only transition record and makes the prior known state unverifiable.
3. **Treat all provenance-bearing output as trusted.** This would weaken the reviewed tenant boundary from exact registered states to a broad provenance exception.

## Immutable layer

The new layer is `infra/scripts/overrides/CHG-053/2dee869/`, where `2dee869` is the first seven characters of the delivered substrate revision. Its version-1 manifest contains exactly two paths:

- `CLAUDE.md` transitions from the CHG-049 desired artifact, SHA-256 `3f0905a05225b595636b0369b297c88176f764377da8543ed428df47d6f164d3`, to the delivered bytes, SHA-256 `32f30b52af12a1591e0ec0507ab7f332b5d092a45b25fb0acdba08e6b6aed94f`.
- `docs/dev-guide/FRONTEND.md` transitions from the CHG-049 desired artifact, SHA-256 `30cd67e73fe3593e1f1d0aba4088ebc63ecd0fd69a86db262e8f860e02e8ca4c`, to the delivered bytes, SHA-256 `b40ca6d396e3063a05bdfe638dc9c02cba515d410cd2d19a248433a16aa532dc`.

The desired artifacts are byte-for-byte copies of the delivered files. `CHG053_PATHS` repeats those two source paths and `("CHG-053/2dee869", CHG053_PATHS)` becomes the final layer. Unknown, malformed, incomplete, or hash-mismatched transitions remain errors.

## IMP-393 mirror framing

The three CLAUDE clones now contain two independently meaningful provenance frames: an initial `agent-sync` header identifying the CLAUDE body revision, and each file's own terminal `nous-emitted` trailer. Once the new CLAUDE state is known, reconciliation computes the expected header from the first twelve hexadecimal characters of CLAUDE's terminal emitted stamp, synchronizes only the body, and preserves each mirror's valid terminal trailer.

The framing parser is closed: the header must occur once at the beginning in the emitted format, and the trailer must occur once at the end. Missing, duplicate, stale, misplaced, or malformed frames fail before any write. This preserves byte stability for the delivered mirrors and still repairs a body that diverges between valid frames.

## Forbidden-guidance semantics

The delivered guidance contains `tenant_id` only in explicit prohibitions: “there is no `tenant_id`” and “do NOT invent `tenant_id`.” The current token-only regex misclassifies those sentences as active guidance. CHG-053 narrows this check by removing only those exact reviewed negative phrases before applying the existing forbidden-token scan.

Positive guidance such as “Use `tenant_id`,” an unrecognized negation, or a line mixing an approved negative phrase with an active instruction still fails. The exception is semantic and closed; it is not a blanket allowance for the token.

## Verification and ownership

Focused tests first demonstrate the unregistered hashes, false-positive negative guidance, and IMP-393 header drift. They then prove the exact manifest bindings, current-byte stability, body repair, closed frame rejection, negative-reference allowance, positive/mixed guidance rejection, and unknown-state failure. The final reconciler bytes are reviewed and bound by `REVIEWED_RECONCILER_SHA256`.

After adversarial verification and any fixes, `pnpm run check:generated-guidance`, `pnpm lint`, and the complete non-mutation gate must pass. One cache-cleared diff-scoped mutation campaign runs last; any subsequent implementation commit invalidates it.

## Approved scope

The implementation is thirteen paths: the seven delivered paths; the two desired artifacts and manifest; the reconciler; its focused test module; and the readiness reconciler hash pin. Readiness, design, plan, and append-only feedback evidence are governance artifacts outside that implementation census.

**Work item:** CHG-053  
**Readiness assessment:** `docs/readiness/CHG-053.json`  
**Approved estimate:** 130 minutes
