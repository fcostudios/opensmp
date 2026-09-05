**Work item:** CHG-046
**Readiness assessment:** docs/readiness/CHG-046.json
**Approved estimate:** 120 minutes

# Generated Nous Sync Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit an exact Nous-generated documentation sync to land from its delivered provenance envelope while preserving fail-closed rejection of hand edits and forged metadata.

**Architecture:** Add a candidate-tree provenance validator beside the existing exact-overlay validator in `git.mjs`. It recognizes only a complete three-file sync envelope and a narrow documentation path allowlist, cross-binds project/revision/time/source metadata, and verifies each changed document against the manifest's truncated SHA-256; the registered-overlay path remains the fallback. An exact provenance-owned sync is documentation-class, while any extra implementation path continues through normal readiness and plan enforcement.

**Tech Stack:** Node.js ESM, built-in `crypto`/`fs`/`child_process`, real temporary Git repositories, `node:test`-style repository harness.

**Spec:** `docs/readiness/CHG-046.json`

## Global Constraints

- Preserve `exactOverlayOwns` and all historical overlay fixtures unchanged as the fallback authorization route.
- Accept provenance only when `.nous-provenance.json`, `.nous-project.json`, and `.nous-sync.json` all change in the same candidate commit and use closed schemas.
- Accept managed content only under `docs/stories/`, `docs/sprints/`, or `docs/specs/`; never let a manifest classify application, database, infrastructure, or arbitrary repository paths as generated documentation.
- Require one non-empty `project_id`; a 12-character lowercase hexadecimal provenance `git_sha`; an 8-character `.nous-project.json` `substrate_commit` equal to its prefix; and `.nous-project.json.generated_at` equal to `.nous-sync.json.synced_at` at UTC-second precision.
- Require every changed managed path to be a regular non-symlink candidate blob with an exact `.nous-sync.json.files[path]` entry and `hash === sha256(candidateBytes).slice(0, 16)`; its manifest entry must be new or changed from the immutable parent.
- A dirty provenance stamp may authorize only source entries disjoint from every normalized `dirty_paths` entry. Ambiguous, malformed, affected, or path-escaping source mappings fail closed; the current `Nous/System/IMP_SESSION_PLAYBOOK.md` dirtiness is disjoint from the affected `Nous/Specs/**` sources.
- A provenance-owned commit may contain only the three envelope files and managed documentation. Any additional path follows the ordinary work-readiness rules.
- Tests exercise the real Git validator with disposable repositories, literal hashes, and exact observable pass/fail results. No owned-code mocks, print oracle, live network, clock dependency, or coverage-only test.
- If, at any task boundary, you judge that the remaining work will exceed the approved estimate, stop there and file a `blocked` or `deviation` feedback event before continuing.

---

### Task 1: Recognize an exact sync-shaped candidate

**Files:**

- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/work-readiness/git.mjs`

**Interfaces:**

- Consumes: existing `readRevisionFile`, `readRevisionBytes`, `revisionMode`, `parseJson`, `validateRelativePath`, `classifyChangedPath`, and `validateCommitOwnership` helpers.
- Produces: private `exactNousSyncOwns({ root, base, head, changedPaths }) -> boolean`; no new public export.
- Preserves: `exactOverlayOwns({ root, base, head, workIds, generatedPath }) -> boolean` as the fallback.

- [ ] **Step 1: Add one positive real-Git fixture before production code**

  Add a small test-only writer next to `makeGitRepo` that derives literal candidate manifest hashes with Node's independent `createHash` boundary, then add this behavior test near the existing generated-Nous fixtures:

  ```js
  test("an exact Nous sync envelope authorizes generated documentation", () => {
    const { root, base } = makeGitRepo();
    try {
      const generatedPath = "docs/stories/SPRINT_PLAN.md";
      const generated = "# Sprint plan from Nous\n";
      writeRepoFile(root, generatedPath, generated);
      writeRepoFile(root, ".nous-provenance.json", `${JSON.stringify({
        schema_version: 1,
        project_id: "fixture__ledger",
        git_sha: "d246c6ff15d4",
        dirty: false,
        dirty_paths: [],
      }, null, 2)}\n`);
      writeRepoFile(root, ".nous-project.json", `${JSON.stringify({
        schema_version: 1,
        project_id: "fixture__ledger",
        organization: "org_fixture",
        nous_namespace: "fixture/ledger",
        generated_at: "2026-09-05T21:40:53Z",
        substrate_commit: "d246c6ff",
        checksum: "82f3e0de92a5834b",
      }, null, 2)}\n`);
      writeRepoFile(root, ".nous-sync.json", `${JSON.stringify({
        synced_at: "2026-09-05T21:40:53.665778+00:00",
        project_id: "fixture__ledger",
        files: {
          [generatedPath]: {
            hash: createHash("sha256").update(generated).digest("hex").slice(0, 16),
            source: "generated",
          },
        },
      }, null, 2)}\n`);
      const head = commitRepo(root, "docs(CHG-045): sync generated sprint", [
        generatedPath, ".nous-provenance.json", ".nous-project.json", ".nous-sync.json",
      ]);

      assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  ```

  The production change this catches is removal or breakage of the provenance authorization branch. Its literal outcome is that a CHG-045 sync without a local CHG-045 readiness artifact is accepted as documentation, not implementation.

- [ ] **Step 2: Run the positive fixture and verify RED**

  Run: `rtk pnpm test:work-readiness`

  Expected: FAIL in `an exact Nous sync envelope authorizes generated documentation` with `WR_GENERATED_NOUS_PATH` (or `WR_READINESS_MISSING` before the early documentation classification exists).

- [ ] **Step 3: Implement the minimum candidate-tree provenance branch**

  In `scripts/work-readiness/git.mjs`, introduce these private constants and helper boundaries:

  ```js
  const NOUS_SYNC_ENVELOPE_PATHS = new Set([
    ".nous-project.json",
    ".nous-provenance.json",
    ".nous-sync.json",
  ]);
  const PROVENANCE_MANAGED_PATHS = [
    /^docs\/stories\//u,
    /^docs\/sprints\//u,
    /^docs\/specs\//u,
  ];

  function exactNousSyncOwns({ root, base, head, changedPaths }) {
    // Return false, never throw a new provenance-specific error, when any
    // closed-shape, cross-field, path, mode, source, or byte binding fails.
    // This lets the existing WR_GENERATED_NOUS_PATH/readiness diagnostics own
    // the public failure contract.
  }
  ```

  Implement only enough closed-shape parsing, project/revision/time binding, changed-entry detection, mode checking, and raw-byte SHA-256 checking to make the positive fixture pass. Call it once in `validateCommitOwnership`; when it owns the complete commit, return the existing `bootstrap-documentation` result before local work-ID readiness lookup. Otherwise continue through `exactOverlayOwns` and the existing implementation path.

- [ ] **Step 4: Run the focused suite and verify GREEN**

  Run: `rtk pnpm test:work-readiness`

  Expected: all work-readiness tests pass, including the new positive fixture and every historical exact-overlay fixture.

- [ ] **Step 5: Commit the positive slice**

  ```bash
  rtk git add scripts/work-readiness/git.mjs scripts/test-work-readiness.mjs
  rtk git commit -m "feat(CHG-046): accept exact Nous sync provenance"
  ```

### Task 2: Prove hand edits and forged provenance fail closed

**Files:**

- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/work-readiness/git.mjs`
- Modify: `docs/dev-guide/WORK_READINESS.md`

**Interfaces:**

- Consumes: Task 1's private `exactNousSyncOwns` branch through public `validateRangeOwnership` behavior.
- Produces: the final closed-schema and dirty-source validation behavior; human guidance for the two generated-file authorization routes.

- [ ] **Step 1: Add the post-sync hand-edit fixture**

  Reuse the sync-shaped fixture setup to commit an accepted sync first. In a second commit, change only `docs/stories/SPRINT_PLAN.md` and assert:

  ```js
  assert.throws(
    () => validateRangeOwnership({ root, base: synced, head: edited }),
    (error) => error.code === "WR_GENERATED_NOUS_PATH"
      && error.path === "docs/stories/SPRINT_PLAN.md",
  );
  ```

  The production mutation this kills is accepting a previously delivered manifest entry without requiring a changed atomic envelope and an exact candidate-byte hash.

- [ ] **Step 2: Run the hand-edit fixture and verify RED against the minimum implementation**

  Run: `rtk pnpm test:work-readiness`

  Expected: FAIL only if Task 1's minimum branch incorrectly reuses stale provenance; if it already rejects this exact case, mutate the fixture by changing the generated file together with `.nous-sync.json` but omitting the other two envelope files, and verify that partial-envelope case fails before retaining the test.

- [ ] **Step 3: Add a table-driven forged-provenance fixture**

  Starting from the same valid sync-shaped candidate, independently mutate these literal fields one case at a time and require `WR_GENERATED_NOUS_PATH` or ordinary readiness rejection:

  ```js
  const forgeries = [
    ["project mismatch", ({ provenance }) => { provenance.project_id = "other__project"; }],
    ["revision mismatch", ({ project }) => { project.substrate_commit = "00000000"; }],
    ["stale blob hash", ({ sync }) => { sync.files[generatedPath].hash = "0".repeat(16); }],
    ["affected dirty source", ({ provenance, sync }) => {
      provenance.dirty = true;
      provenance.dirty_paths = ["Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md"];
      sync.files[generatedPath].source = "/fixture/Nous/Specs/fixture/ledger/v1/stories/SPRINT_PLAN.md";
    }],
    ["extra provenance field", ({ provenance }) => { provenance.forged = true; }],
  ];
  ```

  Also retain one positive dirty-source case with `dirty_paths: ["Nous/System/IMP_SESSION_PLAYBOOK.md"]` and a `Nous/Specs/**` source so the supplied CHG-045 envelope is not rejected merely because an unrelated substrate file was dirty.

  The production mutations these tests kill are dropping any cross-field equality, hash, closed-key, or source-cleanliness guard.

- [ ] **Step 4: Run the forged fixtures and verify RED**

  Run: `rtk pnpm test:work-readiness`

  Expected: at least the affected-dirty-source or extra-field case fails because the Task 1 implementation is not yet fully hardened. If every case already passes, temporarily remove the corresponding production guard, observe the named fixture fail, restore the guard, and record that mutation check in the implementation report.

- [ ] **Step 5: Complete the fail-closed validator**

  Tighten `exactNousSyncOwns` so all three JSON documents use exact key sets, arrays/objects are bounded and plain, paths are canonical repository-relative strings, candidate files are regular blobs, timestamps are valid and second-aligned, manifest entries have exact `{hash, source}` keys, and dirty-source comparisons normalize only an absolute source containing one unambiguous `/Nous/` segment. Return `false` for every ambiguity. Keep the helper pure over Git candidate bytes; do not access the live working tree or a separate Nous checkout.

- [ ] **Step 6: Rewrite the generated-file ownership guidance**

  In `docs/dev-guide/WORK_READINESS.md`, replace the single overlay-only implication with two explicit routes:

  1. a registered, immutable exact overlay for historical/manual reconciliation; or
  2. an atomic, candidate-byte-bound Nous sync envelope for normal generated delivery.

  State that provenance is consistency evidence in this repository's single-human threat model, not a cryptographic signature; a hand edit or fully/partially inconsistent envelope still fails closed; unrelated declared substrate dirtiness is allowed only when its normalized paths are disjoint from every affected source.

- [ ] **Step 7: Verify focused behavior and mutation sensitivity**

  Run:

  ```bash
  rtk pnpm test:work-readiness
  rtk pnpm readiness:check -- CHG-046
  rtk pnpm test:mutation -- --base HEAD~1 --dry-run
  ```

  Expected: work-readiness suite green; CHG-046 remains valid; mutation scope routes the changed `git.mjs` logic to `scripts/test-work-readiness.mjs` without an unrouted critical-path error.

- [ ] **Step 8: Commit the hardening and documentation**

  ```bash
  rtk git add scripts/work-readiness/git.mjs scripts/test-work-readiness.mjs docs/dev-guide/WORK_READINESS.md
  rtk git commit -m "test(CHG-046): reject forged generated sync provenance"
  ```

### Task 3: Verify the complete change and the waiting CHG-045 sync

**Files:**

- Verify only: `docs/readiness/CHG-046.json`
- Verify only: `scripts/work-readiness/git.mjs`
- Verify only: `scripts/test-work-readiness.mjs`
- Verify only: `docs/dev-guide/WORK_READINESS.md`

**Interfaces:**

- Consumes: the final branch and the unstaged CHG-045 sync in the primary checkout.
- Produces: review evidence that CHG-046 is safe to merge and that the real sync is accepted by provenance before it is committed separately.

- [ ] **Step 1: Run the full repository gate in the isolated worktree**

  Run: `rtk pnpm check`

  Expected: type-check, lint, tests, generated checks, and build all pass.

- [ ] **Step 2: Run the CHG-046 ownership range check**

  Run: `rtk node scripts/work-readiness.mjs check-range $(rtk git merge-base main HEAD) HEAD`

  Expected: the CHG-046 implementation range is valid and references the already approved readiness and plan from its parent history.

- [ ] **Step 3: Review the real sync without committing it**

  After CHG-046 is integrated into the primary checkout, stage only the previously waiting CHG-045 sync, write `docs(CHG-045): sync connector partition from Nous` to a temporary commit-message file, and run:

  ```bash
  rtk node scripts/work-readiness.mjs check-staged --message-file <temporary-message-file>
  ```

  Expected: the exact CHG-045 generated sync passes through the provenance route. Remove only the temporary message file; keep the sync staged for its separate commit.

- [ ] **Step 4: Commit no additional CHG-046 files**

  Confirm `rtk git status --short` shows no uncommitted CHG-046 implementation files. The next commit belongs solely to CHG-045 and must use the message from Step 3.

---

## Self-Review Record

- Spec coverage: Task 1 covers the sync-shaped pass; Task 2 covers hand-edit rejection, forged-provenance rejection, unrelated dirty-source handling, the fallback, and the documentation rewrite; Task 3 covers full integration and the real waiting sync.
- Placeholder scan: no deferred implementation or unnamed error-handling step remains.
- Type consistency: the only new interface is the private boolean `exactNousSyncOwns({ root, base, head, changedPaths })`; every caller and test observes behavior through the existing `validateRangeOwnership` API.
