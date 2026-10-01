**Work item:** CHG-061
**Readiness assessment:** docs/readiness/CHG-061.json
**Approved estimate:** 25 minutes

# CHG-061 — commit-msg accepts a pure Nous sync (IMP-410) — Implementation Plan

**Goal:** a commit that is exactly a Nous sync no longer needs a "register the sync" CHG.

**Change:** one guarded block in `.githooks/commit-msg`, placed before the traceability check: when
`scripts/nous-sync-owns.mjs` (substrate-owned, provenance-stamped, delivered by sync) exists and
`node scripts/nous-sync-owns.mjs --staged` exits 0, the hook exits 0. Output is silenced so ordinary
commits are unchanged. Any violation falls through to today's traceability + `check-staged` path.

**What the script authorizes (and nothing else):** `.nous-sync.json` changed; `.nous-project.json` and
`.nous-provenance.json` present and consistent; every other staged path claimed in `.nous-sync.json` at
its delivered hash under the substrate-managed allowlist; provenance not dirty; deletions only of paths
the previous manifest claimed. It is a convention gate over the package's own tree, not proof of authorship.

**Verification:**
- AC1 — the 2026-10-01 sync commit `86d1ba8` passes `node scripts/nous-sync-owns.mjs HEAD~1 HEAD`
  (exit 0, 21 claimed paths) and was accepted by the hook with no work id.
- AC2 — a staged non-sync change with a message lacking a work id is rejected by the hook (exit 1,
  traceability error); `check-staged` still runs for every non-sync commit.
