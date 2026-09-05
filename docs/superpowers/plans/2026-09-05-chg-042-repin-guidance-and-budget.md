**Work item:** CHG-042
**Readiness assessment:** docs/readiness/CHG-042.json
**Approved estimate:** 110 minutes

# CHG-042 Re-pin Guidance and Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reconciler accept the reviewed 2026-09-05 generated guidance and converge every agent-facing readiness limit to 320 minutes without changing historical override layers.

**Architecture:** Add CHG-042 as an immutable final layer in `LAYERED_OVERRIDE_SPECS`. Each entry binds a reviewed CHG-004 or CHG-022 desired artifact to the new desired bytes with SHA-256; the reconciler continues deriving `.cursorrules`, `CODEX.md`, and Copilot guidance from the fully layered `CLAUDE.md`.

**Tech Stack:** Python 3 standard library, `unittest`, SHA-256 manifests, Markdown guidance, Node.js readiness enforcement, pnpm.

**Spec:** `docs/changes/CHG-042-repin-guidance-and-budget.md`

---

## File map

- `infra/scripts/reconcile-sprint1-docs.py`: registers the append-only CHG-042 migration layer.
- `infra/scripts/overrides/CHG-042/fd7741f/manifest.json`: binds the five prior reviewed sources to the five desired artifacts.
- `infra/scripts/overrides/CHG-042/fd7741f/{AGENTS.md,CLAUDE.md,docs/dev-guide/DEFINITION_OF_DONE.md}`: stores the reviewed 320-minute guidance.
- `infra/scripts/overrides/CHG-042/fd7741f/docs/stories/CHANGES.md`: stores the reviewed regenerated change ledger.
- `infra/scripts/overrides/CHG-042/fd7741f/testing/critical-paths.md`: stores the reviewed generated critical-path artifact unchanged.
- `AGENTS.md`, `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md`, `docs/dev-guide/DEFINITION_OF_DONE.md`: replace the stale 120-minute limit with 320.
- `infra/scripts/tests/test_reconcile_sprint1_docs.py`: proves manifest integrity, layered convergence, mirror propagation, and fail-closed behavior.
- `infra/scripts/tests/run_reconcile_mutation_evidence.py`: keeps the 15 reconciler mutations attached to the current implementation anchors.
- `scripts/work-readiness/git.mjs`: records the reviewed reconciler digest required by range enforcement.

## Constraints

- Do not modify any file below `infra/scripts/overrides/CHG-004/` or `infra/scripts/overrides/CHG-022/`.
- Do not edit live `testing/critical-paths.md`; CHG-040 owns the later canonical critical-set expansion.
- Preserve the generated 2026-09-05 `CHANGES.md` and critical-path bytes exactly in the CHG-042 layer.
- Prefix every shell command with `rtk`.
- At each task boundary, stop and file a `blocked` or `deviation` feedback event if the remaining work is expected to exceed the approved 110 minutes.

### Task 1: Add a failing contract for the new immutable layer

**Files:**

- Modify: `infra/scripts/tests/test_reconcile_sprint1_docs.py`
- Test: `infra/scripts/tests/test_reconcile_sprint1_docs.py`

- [x] **Step 1: Register the new fixture root and copy it into isolated test projects**

Add the constant and make the fixture copier include the layer:

```python
REPINNED_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-042/fd7741f"

shutil.copytree(
    REPINNED_OVERRIDE_ROOT,
    data_root / "overrides/CHG-042/fd7741f",
)
```

- [x] **Step 2: Make expected guidance resolve through the newest available layer**

```python
def latest_desired_guide(relative_path: str) -> bytes:
    repinned = REPINNED_OVERRIDE_ROOT / relative_path
    if repinned.is_file():
        return repinned.read_bytes()
    readiness = READINESS_OVERRIDE_ROOT / relative_path
    if readiness.is_file():
        return readiness.read_bytes()
    return desired_guide(relative_path)
```

Replace direct reads from `READINESS_OVERRIDE_ROOT` in convergence, recovery,
mirror, and check-mode assertions with `latest_desired_guide(relative_path)`.

- [x] **Step 3: Add the exact independent manifest oracle**

```python
def test_chg042_layer_binds_reviewed_sources_and_320_minute_guidance(self) -> None:
    manifest = json.loads(
        (REPINNED_OVERRIDE_ROOT / "manifest.json").read_text(encoding="utf-8")
    )
    self.assertEqual(manifest["version"], 1)
    self.assertEqual(
        set(manifest["paths"]),
        {
            "AGENTS.md",
            "CLAUDE.md",
            "docs/dev-guide/DEFINITION_OF_DONE.md",
            "docs/stories/CHANGES.md",
            "testing/critical-paths.md",
        },
    )
    for relative_path, metadata in manifest["paths"].items():
        source = SCRIPT_DATA_ROOT / metadata["source_path"]
        desired = REPINNED_OVERRIDE_ROOT / relative_path
        self.assertEqual(
            hashlib.sha256(source.read_bytes()).hexdigest(),
            metadata["source_sha256"],
            relative_path,
        )
        self.assertEqual(
            hashlib.sha256(desired.read_bytes()).hexdigest(),
            metadata["desired_sha256"],
            relative_path,
        )
    for relative_path in READINESS_GUIDES:
        self.assertIn(
            "above 320 minutes",
            (REPINNED_OVERRIDE_ROOT / relative_path).read_text(encoding="utf-8"),
            relative_path,
        )
```

- [x] **Step 4: Update assertions for the reviewed generated CHANGES format**

Use these exact current markers:

```python
"**Notes:** # CHG-001 — Reconcile Sprint 1 execution contract"
"## Required changes"
"Sprint 1 readiness review found generator-owned guidance "
"authoritative ER model and architecture."
```

- [x] **Step 5: Run the focused test and confirm RED**

```bash
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
```

Expected before Task 2: FAIL because `overrides/CHG-042/fd7741f` and its
registered layer do not exist.

### Task 2: Add the CHG-042 artifacts and layer registration

**Files:**

- Create: `infra/scripts/overrides/CHG-042/fd7741f/manifest.json`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/AGENTS.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/CLAUDE.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/docs/dev-guide/DEFINITION_OF_DONE.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/docs/stories/CHANGES.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/testing/critical-paths.md`
- Modify: `infra/scripts/reconcile-sprint1-docs.py`
- Modify: `AGENTS.md`
- Modify: `CODEX.md`
- Modify: `.cursorrules`
- Modify: `.github/copilot-instructions.md`
- Modify: `docs/dev-guide/DEFINITION_OF_DONE.md`

- [x] **Step 1: Create the exact manifest**

```json
{
  "version": 1,
  "paths": {
    "AGENTS.md": {
      "source_path": "overrides/CHG-022/16f72c9/AGENTS.md",
      "source_sha256": "842f91e9f4c4f333d5ac80267a511663e781a8c7b3a377302e4ae03aa128068f",
      "desired_sha256": "9c5ddc0ab43724ea40f15b63444ccc16f3064af52c3155cef3efc31a9ad3f075"
    },
    "CLAUDE.md": {
      "source_path": "overrides/CHG-022/16f72c9/CLAUDE.md",
      "source_sha256": "9c3afc5674204928660976df3181c28c241d1add69167077d484a229500d5b5e",
      "desired_sha256": "9cba977d283301e1b925035b9c62ee5b64ee860fb8b049adc3b075f1f3a09283"
    },
    "docs/dev-guide/DEFINITION_OF_DONE.md": {
      "source_path": "overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md",
      "source_sha256": "bd6de13018729de07323b7dc426fb69e57f060f04db9fea0d9ecc5fc997056e9",
      "desired_sha256": "bb19763d0e8ca8640635d0c8c4c11f16fa9938ed92984269f5d81826cfa92ce4"
    },
    "docs/stories/CHANGES.md": {
      "source_path": "overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md",
      "source_sha256": "646b39d559efc890db5d5ebab96dc2b0c2f78eb35ab204ef34f335a2a282c96e",
      "desired_sha256": "369ece28be1eab9cde031dd8cb8524aa9ca625164aca12eac0a15ef9c692a11b"
    },
    "testing/critical-paths.md": {
      "source_path": "overrides/CHG-004/e4b9a06/testing/critical-paths.md",
      "source_sha256": "fb0d9c5d94224dbfa96b02db67194f67f07077ecf6aae449edbd59e35364b73e",
      "desired_sha256": "e765dfe6daa2ac1c3d56024136a09a4acc459054c352534230ffe54ac49d52b7"
    }
  }
}
```

- [x] **Step 2: Store the five reviewed desired artifacts**

Copy the reviewed current bytes of `CLAUDE.md`, `docs/stories/CHANGES.md`, and
`testing/critical-paths.md`. Derive the CHG-042 `AGENTS.md` and
`docs/dev-guide/DEFINITION_OF_DONE.md` artifacts from their reviewed CHG-022
sources by replacing only:

```bash
rtk mkdir -p infra/scripts/overrides/CHG-042/fd7741f/docs/dev-guide \
  infra/scripts/overrides/CHG-042/fd7741f/docs/stories \
  infra/scripts/overrides/CHG-042/fd7741f/testing
rtk cp CLAUDE.md infra/scripts/overrides/CHG-042/fd7741f/CLAUDE.md
rtk cp docs/stories/CHANGES.md \
  infra/scripts/overrides/CHG-042/fd7741f/docs/stories/CHANGES.md
rtk cp testing/critical-paths.md \
  infra/scripts/overrides/CHG-042/fd7741f/testing/critical-paths.md
rtk cp infra/scripts/overrides/CHG-022/16f72c9/AGENTS.md \
  infra/scripts/overrides/CHG-042/fd7741f/AGENTS.md
rtk cp infra/scripts/overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md \
  infra/scripts/overrides/CHG-042/fd7741f/docs/dev-guide/DEFINITION_OF_DONE.md
```

Apply this exact one-line replacement to the copied `AGENTS.md` and
`DEFINITION_OF_DONE.md` artifacts:

```text
above 120 minutes
```

with:

```text
above 320 minutes
```

Verify the artifacts against the hashes in Step 1:

```bash
rtk shasum -a 256 infra/scripts/overrides/CHG-042/fd7741f/AGENTS.md \
  infra/scripts/overrides/CHG-042/fd7741f/CLAUDE.md \
  infra/scripts/overrides/CHG-042/fd7741f/docs/dev-guide/DEFINITION_OF_DONE.md \
  infra/scripts/overrides/CHG-042/fd7741f/docs/stories/CHANGES.md \
  infra/scripts/overrides/CHG-042/fd7741f/testing/critical-paths.md
```

Expected hashes, in order:

```text
9c5ddc0ab43724ea40f15b63444ccc16f3064af52c3155cef3efc31a9ad3f075
9cba977d283301e1b925035b9c62ee5b64ee860fb8b049adc3b075f1f3a09283
bb19763d0e8ca8640635d0c8c4c11f16fa9938ed92984269f5d81826cfa92ce4
369ece28be1eab9cde031dd8cb8524aa9ca625164aca12eac0a15ef9c692a11b
e765dfe6daa2ac1c3d56024136a09a4acc459054c352534230ffe54ac49d52b7
```

- [x] **Step 3: Register CHG-042 after CHG-022**

Add this mapping and tuple to `infra/scripts/reconcile-sprint1-docs.py`:

```python
CHG042_PATHS = {
    "AGENTS.md": "overrides/CHG-022/16f72c9/AGENTS.md",
    "CLAUDE.md": "overrides/CHG-022/16f72c9/CLAUDE.md",
    "docs/dev-guide/DEFINITION_OF_DONE.md": (
        "overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md"
    ),
    "docs/stories/CHANGES.md": (
        "overrides/CHG-004/e4b9a06/docs/stories/CHANGES.md"
    ),
    "testing/critical-paths.md": (
        "overrides/CHG-004/e4b9a06/testing/critical-paths.md"
    ),
}
LAYERED_OVERRIDE_SPECS = (
    ("CHG-004/e4b9a06", CHG004_PATHS),
    ("CHG-022/16f72c9", CHG022_PATHS),
    ("CHG-042/fd7741f", CHG042_PATHS),
)
```

- [x] **Step 4: Propagate 320 to the five stale live guides**

In each listed live file, replace the single sentence fragment exactly:

```text
A work item above 120 minutes or any cohesion limit is not
```

with:

```text
A work item above 320 minutes or any cohesion limit is not
```

The five files are `AGENTS.md`, `CODEX.md`, `.cursorrules`,
`.github/copilot-instructions.md`, and
`docs/dev-guide/DEFINITION_OF_DONE.md`. Do not change live `CLAUDE.md`; it
already contains 320.

- [x] **Step 5: Run the focused suite and confirm GREEN**

```bash
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
rtk pnpm check:generated-guidance
```

Expected: all reconciliation tests pass and generated-guidance check mode exits
zero without modifying the worktree.

### Task 3: Re-anchor mutation and readiness enforcement to the layered reconciler

**Files:**

- Modify: `infra/scripts/tests/run_reconcile_mutation_evidence.py`
- Modify: `scripts/work-readiness/git.mjs`
- Test: `infra/scripts/tests/run_reconcile_mutation_evidence.py`
- Test: `scripts/test-work-readiness.mjs`

- [x] **Step 1: Update stale mutation anchors without weakening campaigns**

Apply these exact anchor changes while retaining mutation IDs M01–M15 and their
existing killing tests:

```python
# M01: current layered source-hash branch
"""        completed_layer = -1
        if current_hash == source_hash:
            candidate = desired_text
"""

# M06: current mirror variable
"""        desired[path] = mirrored_claude
"""

# M08: current plan type
"""def preview_plan(plan: dict[Path, PlanEntry], root: Path) -> None:
    if not plan:
"""

# M09: substitute original bytes for the validated desired bytes
"""                plan_entry.desired_text.encode("utf-8"),
"""

# M11: generalized layer manifest path-set guard
"""        if set(entries) != set(allowed_paths):
            raise ReconciliationError(
                f"{change_id} override manifest paths do not match the allowed path set"
            )
"""

# M13: generalized layer source-path guard
"""            if source_path != allowed_paths[relative_path]:
                raise ReconciliationError(
                    f"{relative_path}: invalid {change_id} source path"
                )
"""
```

- [x] **Step 2: Run the cold reconciler mutation evidence**

```bash
rtk pnpm test:mutation:infra
```

Expected: all 15 reconciler mutants and all 15 API-reconciliation mutants are
killed.

- [x] **Step 3: Bind readiness range enforcement to the reviewed reconciler**

Set the exact digest in `scripts/work-readiness/git.mjs`:

```javascript
const REVIEWED_RECONCILER_SHA256 = "889a9d0a4f69f8c1491d2221d8072815ae735e7d17488f8165c5ccc2d3356d60";
```

- [x] **Step 4: Verify readiness and the implementation range**

```bash
rtk pnpm readiness:check -- CHG-042
rtk pnpm test:work-readiness
rtk pnpm readiness:check:range
```

Expected: CHG-042 is `ready`, 177 work-readiness behavioral tests pass, and the
current implementation range is accepted.

### Task 4: Review, integrate, and commit

**Files:**

- Review: all files listed in the file map
- Verify: repository-wide gates

- [x] **Step 1: Check scope and immutable-history guarantees**

```bash
rtk git diff --check
rtk git diff -- infra/scripts/overrides/CHG-004 infra/scripts/overrides/CHG-022
rtk rg -n "above (120|320) minutes" AGENTS.md CODEX.md .cursorrules \
  .github/copilot-instructions.md docs/dev-guide/DEFINITION_OF_DONE.md CLAUDE.md
```

Expected: no whitespace errors; no historical override diff; all six live
guides report 320 and none reports 120.

- [x] **Step 2: Run the complete repository gate**

```bash
rtk pnpm check
```

Expected: type-check, lint, readiness checks, tests, mutation evidence, and
production build all pass. The database package reports 171/171 passing tests.

- [x] **Step 3: Commit the implementation**

```bash
rtk git add .cursorrules .github/copilot-instructions.md AGENTS.md CODEX.md \
  docs/changes/CHG-042-repin-guidance-and-budget.md \
  docs/dev-guide/DEFINITION_OF_DONE.md infra/scripts/reconcile-sprint1-docs.py \
  infra/scripts/overrides/CHG-042 \
  infra/scripts/tests/run_reconcile_mutation_evidence.py \
  infra/scripts/tests/test_reconcile_sprint1_docs.py scripts/work-readiness/git.mjs
rtk git commit -m "fix(CHG-042): re-pin guidance at 320 minutes"
```

Expected commit: `ad2af90`.

## Self-review

- Spec AC1 is covered by Tasks 1–2: prior reviewed states converge through an
  append-only layer and unknown/tampered artifacts continue failing closed.
- Spec AC2 is covered by Tasks 2–4: five stale mirrors move to 320, manifests
  bind exact bytes, focused and mutation suites pass, and generated-guidance
  check mode is clean.
- `testing/critical-paths.md` remains generator-owned and unedited; its reviewed
  bytes exist only as a CHG-042 desired artifact.
- No placeholders remain, and every changed implementation or test file is
  named in the file map and a task.
- Implementation was completed and verified in `ad2af90`; no execution handoff
  remains for CHG-042.
