**Work item:** CHG-051
**Readiness assessment:** docs/readiness/CHG-051.json
**Approved estimate:** 120 minutes

# CHG-051 Overlay Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the exact eight CHG-050 guidance blobs as an immutable final overlay, preserve protected per-file provenance trailers while synchronizing mirror bodies, re-pin the reviewed reconciler, and restore the full green gate without weakening unknown-state rejection.

**Architecture:** Add `CHG-049/6466f60` after CHG-044 in the append-only overlay chain and teach the focused fixtures to resolve it. The manifest binds each latest reviewed source to an exact desired copy; mirror bodies follow layered CLAUDE.md while each file's single valid terminal emitted trailer remains its own; readiness trusts the edited reconciler only after its SHA-256 is reviewed and updated.

**Tech Stack:** Python 3 standard library, SHA-256, Node.js readiness enforcement, pnpm lint/test/build and diff-scoped mutation runner.

**Spec:** `docs/superpowers/specs/2026-09-06-chg-051-overlay-registration-design.md`

---

## File map

- `infra/scripts/overrides/CHG-049/6466f60/manifest.json`: exact source-to-desired bindings for eight paths.
- Eight desired files beneath `infra/scripts/overrides/CHG-049/6466f60/`: byte-for-byte CHG-050 carried guidance.
- `infra/scripts/reconcile-sprint1-docs.py`: registers `CHG049_PATHS` and appends the layer.
- `infra/scripts/tests/test_reconcile_sprint1_docs.py`: loads the final layer and proves body synchronization, per-file trailer preservation, and malformed-trailer rejection.
- `scripts/test-work-readiness.mjs`: proves a ready child owns a parent-named immutable overlay path without authorizing ownerless implementation.
- `scripts/work-readiness/git.mjs`: pins the reviewed reconciler SHA-256 and explains the reviewed CHG-051 delta.

### Task 1: Prove the red state and compute the manifest inputs

**Files:**

- Inspect: the eight live guidance files
- Inspect: CHG-001, CHG-042, and CHG-044 immutable layers

- [ ] **Step 1: Start CHG-051 and verify both child readiness artifacts**

Run `rtk date -u +%FT%TZ`. Append a `started` event for CHG-051 with agent `codex/chg-051-overlay-registration` and that exact ISO-8601 UTC `ts`, commit it separately, then create `rtk git branch authority/chg-051-base HEAD` and run:

```bash
rtk pnpm readiness:check -- CHG-050
rtk pnpm readiness:check -- CHG-051
```

Expected: both readiness checks are valid.

- [ ] **Step 2: Run the existing failing contract**

```bash
rtk pnpm check:generated-guidance
```

Expected RED: exit nonzero naming exactly the eight carried paths as unknown generated guidance states. Record that clearing these errors alone would still schedule the three mirrors because their valid trailers intentionally differ.

- [ ] **Step 3: Compute independent source and desired hashes**

Use `rtk shasum -a 256` on the latest immutable sources and live targets. The desired values must be:

```text
AGENTS.md                                             7aea15dc3a0144d7dd28c141d0d6112b96bdd49722de921fe3b358f96d15f899
CLAUDE.md                                             3f0905a05225b595636b0369b297c88176f764377da8543ed428df47d6f164d3
docs/dev-guide/DEFINITION_OF_DONE.md                  ae0060ef2adfe269aec8bda3e14f79b4f14db0243a99b39ab91ed5bf161f4560
docs/dev-guide/FRONTEND.md                            30cd67e73fe3593e1f1d0aba4088ebc63ecd0fd69a86db262e8f860e02e8ca4c
docs/dev-guide/SECURITY.md                            022d772834a4b78de32e5eb2baee1701878bd84d18c85564703505c0c7e3e694
docs/dev-guide/STANDARDS.md                           3347158c79e0032db6a878b9ef92a4ba6d26d783e64f2fe463e486869a066a22
docs/dev-guide/TESTING.md                             4c201f4ea67e3edc817e8edf1ff05b5d3a9ea4edff6bfb199b0120c57b902732
testing/critical-paths.md                             804fc2d39679e9b37c03a5ed1a4fa23dc21d3dd75d55688d70369c05ced155da
```

If any desired value differs, stop: the carried delivery changed and the approved manifest inputs are stale.

### Task 2: Add failing final-layer and protected-trailer contracts

**Files:**

- Modify: `infra/scripts/tests/test_reconcile_sprint1_docs.py`

- [ ] **Step 1: Make isolated fixtures load the new final layer**

Add `CHG049_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-049/6466f60"`, consult it first in `latest_desired_guide`, and copy it after CHG-044 inside `copy_reconciler_data`.

- [ ] **Step 2: Add a body/trailer test helper**

Define a test-only helper that requires exactly one terminal line matching:

```python
r"<!-- nous-emitted: sha256=[0-9a-f]{16} -->\n?\Z"
```

It returns the bytes before that match and the matched trailer bytes.

- [ ] **Step 3: Write the failing distinct-trailer contract**

Create a project whose CLAUDE and three mirror bodies are identical but whose mirror trailers are valid and distinct. Run check mode and assert success plus byte-for-byte stability. Also change the body of one mirror while retaining its trailer, run reconciliation, and assert only the body converges while that trailer remains exact.

- [ ] **Step 4: Write failing malformed-trailer cases**

For missing, duplicate, non-terminal, and non-hex mirror trailers, assert reconciliation exits nonzero, names the mirror, and writes nothing.

- [ ] **Step 5: Run the focused suite and verify RED**

```bash
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
```

Expected: the new protected-trailer tests fail because current CHG-024 logic replaces whole mirror files or accepts malformed trailer state.

### Task 3: Add the immutable layer and implement the narrowed mirror invariant

**Files:**

- Create: `infra/scripts/overrides/CHG-049/6466f60/manifest.json`
- Create: eight desired copies under `infra/scripts/overrides/CHG-049/6466f60/`
- Modify: `infra/scripts/reconcile-sprint1-docs.py`

- [ ] **Step 1: Store the exact desired blobs**

Create the required subdirectories and mechanically copy each of the eight live files into the matching relative path under `infra/scripts/overrides/CHG-049/6466f60/`. Do not transform line endings or content.

- [ ] **Step 2: Create the closed manifest**

Write version 1 with exactly this closed manifest:

```json
{
  "version": 1,
  "paths": {
    "AGENTS.md": {
      "source_path": "overrides/CHG-042/fd7741f/AGENTS.md",
      "source_sha256": "9c5ddc0ab43724ea40f15b63444ccc16f3064af52c3155cef3efc31a9ad3f075",
      "desired_sha256": "7aea15dc3a0144d7dd28c141d0d6112b96bdd49722de921fe3b358f96d15f899"
    },
    "CLAUDE.md": {
      "source_path": "overrides/CHG-042/fd7741f/CLAUDE.md",
      "source_sha256": "9cba977d283301e1b925035b9c62ee5b64ee860fb8b049adc3b075f1f3a09283",
      "desired_sha256": "3f0905a05225b595636b0369b297c88176f764377da8543ed428df47d6f164d3"
    },
    "docs/dev-guide/DEFINITION_OF_DONE.md": {
      "source_path": "overrides/CHG-042/fd7741f/docs/dev-guide/DEFINITION_OF_DONE.md",
      "source_sha256": "bb19763d0e8ca8640635d0c8c4c11f16fa9938ed92984269f5d81826cfa92ce4",
      "desired_sha256": "ae0060ef2adfe269aec8bda3e14f79b4f14db0243a99b39ab91ed5bf161f4560"
    },
    "docs/dev-guide/FRONTEND.md": {
      "source_path": "overrides/CHG-001/825e882/docs/dev-guide/FRONTEND.md",
      "source_sha256": "56f88f133a16818fdfb04657ecaa95067c87f07257c4506f78bc1852143afc9f",
      "desired_sha256": "30cd67e73fe3593e1f1d0aba4088ebc63ecd0fd69a86db262e8f860e02e8ca4c"
    },
    "docs/dev-guide/SECURITY.md": {
      "source_path": "overrides/CHG-001/825e882/docs/dev-guide/SECURITY.md",
      "source_sha256": "1763ca67252b66a65e2dfce6b6e88664b2fe5e8f6dbd89d6802de1500ad4b967",
      "desired_sha256": "022d772834a4b78de32e5eb2baee1701878bd84d18c85564703505c0c7e3e694"
    },
    "docs/dev-guide/STANDARDS.md": {
      "source_path": "overrides/CHG-001/825e882/docs/dev-guide/STANDARDS.md",
      "source_sha256": "a9ca2719450f411227839d79b14a680c7462e2c67e40211b1707ee2ef5d7fa61",
      "desired_sha256": "3347158c79e0032db6a878b9ef92a4ba6d26d783e64f2fe463e486869a066a22"
    },
    "docs/dev-guide/TESTING.md": {
      "source_path": "overrides/CHG-001/825e882/docs/dev-guide/TESTING.md",
      "source_sha256": "e5c00acf265c253f4c43d34bb4ce6d151102ee2e18a2bfe9ee702d5f4829c50a",
      "desired_sha256": "4c201f4ea67e3edc817e8edf1ff05b5d3a9ea4edff6bfb199b0120c57b902732"
    },
    "testing/critical-paths.md": {
      "source_path": "overrides/CHG-044/2d93300/testing/critical-paths.md",
      "source_sha256": "2a3c897772877acdd9f0f97d521e692beb8b77f9c4e756dbbe93d81feb7f4f67",
      "desired_sha256": "804fc2d39679e9b37c03a5ed1a4fa23dc21d3dd75d55688d70369c05ced155da"
    }
  }
}
```

Source paths are CHG-042 for AGENTS/CLAUDE/DoD, CHG-044 for critical-paths, and CHG-001 for FRONTEND/SECURITY/STANDARDS/TESTING.

- [ ] **Step 3: Register the exact final layer**

Add `CHG049_PATHS` with the same eight source paths as the manifest, then append:

```python
("CHG-049/6466f60", CHG049_PATHS),
```

after the CHG-044 tuple in `LAYERED_OVERRIDE_SPECS`.

- [ ] **Step 4: Preserve one strict terminal trailer per protected mirror**

Add one compiled pattern for a terminal emitted trailer. Split layered CLAUDE.md into body and trailer; for each mirror, require exactly one well-formed terminal trailer in its current text, then set desired content to the layered CLAUDE body plus that exact mirror trailer. A missing, duplicate, misplaced, or malformed marker appends a path-specific reconciliation error and schedules no write.

- [ ] **Step 5: Verify GREEN and byte stability**

```bash
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
rtk pnpm check:generated-guidance
rtk git diff --exit-code -- AGENTS.md CLAUDE.md docs/dev-guide/DEFINITION_OF_DONE.md docs/dev-guide/FRONTEND.md docs/dev-guide/SECURITY.md docs/dev-guide/STANDARDS.md docs/dev-guide/TESTING.md testing/critical-paths.md
```

Expected: the focused suite and check pass; no live target changes.

### Task 4: Make parent-named overlay storage ownership-neutral

**Files:**

- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/work-readiness/git.mjs`

- [ ] **Step 1: Write the failing ownership regression**

Create approved fixtures for partition-required parent CHG-049 with official child CHG-051 and ready CHG-051. Commit an implementation file plus `infra/scripts/overrides/CHG-049/6466f60/manifest.json` with a `fix(CHG-051)` message. Assert the range's work IDs are exactly `["CHG-051"]`. In the same fixture, prove a commit with no message work ID still raises `WR_WORK_ID_MISSING`; keep the existing ordinary path/message union test unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
rtk node --test --test-name-pattern="parent-named overlay storage" scripts/test-work-readiness.mjs
```

Expected: the CHG-051 commit fails with `WR_WORK_NOT_READY` for CHG-049 before the fix.

- [ ] **Step 3: Implement the smallest ownership correction**

When deriving `pathWorkIds` inside `validateCommitOwnership`, exclude paths matching the strict immutable storage prefix `infra/scripts/overrides/CHG-[0-9]{3,}/[a-z0-9]{7,64}/`. Do not change `extractWorkIds`, ordinary path ownership, `exactOverlayOwns`, or generated-target authorization.

- [ ] **Step 4: Verify GREEN and regression boundaries**

```bash
rtk node --test --test-name-pattern="parent-named overlay storage|ownership is the union" scripts/test-work-readiness.mjs
rtk pnpm test:work-readiness
```

Expected: the new ready-child and ownerless cases pass, the ordinary union case passes, and the full readiness suite is green.

### Task 5: Re-pin the reviewed reconciler and adversarially review

**Files:**

- Modify: `scripts/work-readiness/git.mjs`
- Review: all thirteen CHG-051 implementation paths

- [ ] **Step 1: Compute and install the reviewed reconciler hash**

```bash
rtk shasum -a 256 infra/scripts/reconcile-sprint1-docs.py
```

Set `REVIEWED_RECONCILER_SHA256` to that exact digest. Replace the adjacent stale delta description with a CHG-051 comment stating that the reviewed change adds one closed eight-path layer after CHG-044 and preserves one strict terminal emitted trailer per mirror while synchronizing bodies.

- [ ] **Step 2: Run focused readiness and reconciliation tests**

```bash
rtk pnpm test:work-readiness
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
rtk pnpm check:generated-guidance
```

Expected: all pass.

- [ ] **Step 3: Perform adversarial AC verification before the campaign**

Verify independently that:

1. manifest keys equal the eight approved paths;
2. every source/desired digest recomputes exactly;
3. CHG-049 is last in the layer sequence;
4. mirror bodies equal CLAUDE.md's body and their original valid trailers remain byte-exact;
5. missing, duplicate, misplaced, and malformed trailers fail without writing;
6. removing one manifest entry or substituting an unknown live hash in an isolated fixture fails closed;
7. live target bytes are unchanged by check mode;
8. no historical overlay file changed.

Repair every finding before proceeding.

- [ ] **Step 4: Commit the implementation after review fixes**

```bash
rtk git add infra/scripts/overrides/CHG-049/6466f60 infra/scripts/reconcile-sprint1-docs.py infra/scripts/tests/test_reconcile_sprint1_docs.py scripts/work-readiness/git.mjs
rtk git commit -m "fix(CHG-051): register the CHG-049 guidance overlay"
```

Expected: exactly thirteen implementation paths are committed normally; the commit message names CHG-051 only and uses no hook bypass.

### Task 6: Run final gates and the authoritative campaigns

**Files:**

- Verify: the corrected CHG-050/051 branch
- Append later: `.nous-feedback.jsonl`

- [ ] **Step 1: Run the complete non-mutation gate**

```bash
rtk pnpm check
rtk pnpm readiness:check -- CHG-049
rtk pnpm readiness:check -- CHG-050
rtk pnpm readiness:check -- CHG-051
```

Expected: all commands exit zero.

- [ ] **Step 2: Run one cold diff-scoped campaign per executable child, last**

After all adversarial review fixes and implementation commits:

```bash
rtk pnpm mutation:cache:clear
MUTATION_BASE=authority/chg-050-base rtk pnpm test:mutation
rtk pnpm mutation:cache:clear
MUTATION_BASE=authority/chg-051-base rtk pnpm test:mutation
```

Expected: CHG-050 reports no mutatable implementation or a passing selected shard; CHG-051's diff-scoped selected shard passes with no unannotated survivors. Do not run `test:mutation:core`, because the critical set is unchanged.

- [ ] **Step 3: Emit contract-complete evidence**

Append timestamped `ac_verify`, `build_pass`, and `test_report` events for each child. Each `test_report` uses `scope: "diff"` and records actual killed, survived, mutation score, and `mutation_wallclock_s`. Record actuals in both readiness artifacts, commit evidence only, then append timestamped `done` events in the terminal evidence commit. No implementation commit may follow the campaigns.

## Self-review

- The layer is append-only, closed to exactly eight paths, and sources only immutable predecessor artifacts.
- Existing tests provide a real RED before the data/registration change and GREEN afterward; no redundant test is added.
- The reviewed reconciler pin changes only after the exact registration and strict-trailer deltas are known.
- Adversarial verification and every fix precede the one final cache-cleared diff-scoped campaign; no whole-set campaign is scheduled.
