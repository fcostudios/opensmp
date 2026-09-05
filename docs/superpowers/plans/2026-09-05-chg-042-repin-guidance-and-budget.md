**Work item:** CHG-042
**Readiness assessment:** docs/readiness/CHG-042.json
**Approved estimate:** 110 minutes

# CHG-042 Re-pin Guidance and Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reconciler accept the reviewed 2026-09-05 generated guidance and converge all agent-facing readiness limits to 320 minutes.

**Architecture:** Add CHG-042 as the next immutable layer in `LAYERED_OVERRIDE_SPECS`. Its artifacts use the CHG-004/CHG-022 desired files as exact sources and the reviewed current files as exact desired states; mirrors continue to derive from the fully layered `CLAUDE.md`.

**Tech Stack:** Python 3 standard library, unittest, SHA-256 override manifests, Markdown guidance.

**Spec:** `docs/changes/CHG-042-repin-guidance-and-budget.md`

## Global Constraints

- Do not modify historical CHG-004 or CHG-022 override bytes.
- Do not edit generated `testing/critical-paths.md`.
- Every shell command is prefixed with `rtk`.
- Unknown or tampered artifacts must continue to fail before any publication.

---

### Task 1: Add and verify the CHG-042 migration layer

**Files:**
- Create: `infra/scripts/overrides/CHG-042/fd7741f/manifest.json`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/AGENTS.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/CLAUDE.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/docs/dev-guide/DEFINITION_OF_DONE.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/docs/stories/CHANGES.md`
- Create: `infra/scripts/overrides/CHG-042/fd7741f/testing/critical-paths.md`
- Modify: `infra/scripts/reconcile-sprint1-docs.py`
- Modify: `infra/scripts/tests/test_reconcile_sprint1_docs.py`
- Modify: `AGENTS.md`
- Modify: `CODEX.md`
- Modify: `.cursorrules`
- Modify: `.github/copilot-instructions.md`
- Modify: `docs/dev-guide/DEFINITION_OF_DONE.md`

**Interfaces:**
- Consumes: `load_layered_overrides()` and the CHG-004/CHG-022 desired artifacts.
- Produces: a `CHG042_PATHS` mapping and a final `("CHG-042/fd7741f", CHG042_PATHS)` layer.

- [ ] **Step 1: Write the failing migration assertions**

Extend the fixture copier to include `overrides/CHG-042/fd7741f`. Add exact
assertions that every CHG-042 manifest source hash equals its referenced prior
artifact, every desired hash equals its new artifact, and all three readiness
guides contain `above 320 minutes`. Add a convergence case starting from the
CHG-004/CHG-022 desired bytes.

- [ ] **Step 2: Confirm RED**

Run:

```bash
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
```

Expected: failure because the CHG-042 override directory and mapping do not exist.

- [ ] **Step 3: Add the immutable layer**

Define:

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
```

Append `("CHG-042/fd7741f", CHG042_PATHS)` to
`LAYERED_OVERRIDE_SPECS`. Populate desired artifacts from the reviewed current
files, changing only the two directly layered 120-minute guides; the three
assistant mirrors continue to derive from layered `CLAUDE.md`.

- [ ] **Step 4: Confirm GREEN and tamper resistance**

Run:

```bash
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
rtk pnpm check:generated-guidance
rtk pnpm test:mutation:infra
rtk pnpm readiness:check -- CHG-042
```

Expected: all reconciler tests and mutation evidence pass, check mode produces
no changes, and CHG-042 remains readiness-valid.

- [ ] **Step 5: Review and commit**

Run `rtk git diff --check`, confirm the five live guides contain 320 and no
historical override file changed, then commit:

```bash
rtk git add AGENTS.md CODEX.md .cursorrules .github/copilot-instructions.md \
  docs/dev-guide/DEFINITION_OF_DONE.md infra/scripts/reconcile-sprint1-docs.py \
  infra/scripts/overrides/CHG-042 infra/scripts/tests/test_reconcile_sprint1_docs.py
rtk git commit -m "fix(CHG-042): re-pin guidance at 320 minutes"
```

At the task boundary, stop and record a deviation if the remaining work is
expected to exceed the approved 110 minutes.
