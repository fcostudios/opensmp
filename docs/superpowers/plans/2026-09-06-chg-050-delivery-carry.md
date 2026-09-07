**Work item:** CHG-050
**Readiness assessment:** docs/readiness/CHG-050.json
**Approved estimate:** 40 minutes

# CHG-050 Delivery Carry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct the local-only sequence so the exact 2026-09-06 Nous delivery is technically owned by CHG-050 and the seven protected agent documents' IMP-393 boundary is explicit.

**Architecture:** Retain the current sequence on a recovery branch, reconstruct from pre-US-058 commit `20ba335`, and apply the 17-path delivery delta from `1d52117` without rerunning substrate tools. Change only the already-carried `WORK_READINESS.md` to add the required protection sentence.

**Tech Stack:** Git, Markdown, SHA-256, pnpm readiness tooling.

**Spec:** `docs/superpowers/specs/2026-09-06-chg-050-delivery-carry-design.md`

---

## File map

- The exact 17 files in commit `1d52117`: preserved substrate and agent-files delivery.
- `docs/dev-guide/WORK_READINESS.md`: additionally records the explicit seven-document IMP-393 protection boundary.
- `.nous-feedback.jsonl`: receives timestamped lifecycle and verification evidence in evidence-only commits, not in the 17-path implementation commit.

### Task 1: Prove and preserve the source state

**Files:**

- Inspect: commit `1d52117`
- Inspect: the current branch and `.worktrees/us-058-conformance`

- [ ] **Step 1: Verify readiness and the exact source path set**

```bash
rtk pnpm readiness:check -- CHG-050
rtk git diff-tree --no-commit-id --name-only -r 1d52117
rtk git diff-tree --no-commit-id --name-only -r 1d52117 | rtk wc -l
```

Expected: readiness is valid and the commit names exactly the 17 operator-delivered paths.

- [ ] **Step 2: Retain a recovery pointer and remove only the clean agent-created US-058 worktree**

```bash
rtk git status --short
rtk git -C .worktrees/us-058-conformance status --short
rtk git branch recovery/pre-chg049-local-sequence main
rtk git worktree remove .worktrees/us-058-conformance
rtk git branch -d feature/connectors/anthropic-conformance
```

Expected: both trees are clean before removal; the recovery branch retains all current local commits.

### Task 2: Reconstruct and commit the carry

**Files:**

- Modify: the 17 paths from `1d52117`
- Modify within that set: `docs/dev-guide/WORK_READINESS.md`

- [ ] **Step 1: Create the isolated corrected-sequence worktree**

```bash
rtk git check-ignore -q .worktrees
rtk git worktree add .worktrees/chg049-corrected -b repair/chg049-corrected 20ba335
```

Expected: the worktree starts at `20ba335` and `.worktrees` is ignored.

- [ ] **Step 2: Replay the approved governance commits before implementation**

Cherry-pick the approved readiness commit, then the recovery branch tip whose single diff contains both child designs and plans. Do not cherry-pick either US-058 commit or `1d52117`.

```bash
rtk git cherry-pick bd9b096 recovery/pre-chg049-local-sequence
```

Expected: CHG-050 readiness and its bound plan are committed before the carry begins.

- [ ] **Step 3: Emit timestamped start evidence**

Run `rtk date -u +%FT%TZ`, then append exactly one `started` event using that returned value as `ts`:

```json
{"story":"CHG-050","event":"started","agent":"codex/chg-050-delivery-carry","ts":"2026-09-06T00:00:00Z"}
```

The timestamp shown is a shape example; replace it with the command's real output. Commit the event separately as documentation evidence, then create the stable campaign authority ref with `rtk git branch authority/chg-050-base HEAD`.

- [ ] **Step 4: Apply the exact delivery delta without committing**

```bash
rtk git cherry-pick --no-commit 1d52117
rtk git diff --name-only | rtk wc -l
```

Expected: exactly 17 changed paths.

- [ ] **Step 5: Add the explicit IMP-393 protection sentence**

Immediately after the existing tenant-additions introduction in `docs/dev-guide/WORK_READINESS.md`, add:

```markdown
The seven trailer-bearing agent documents (`.cursorrules`,
`.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`,
`docs/dev-guide/SECURITY.md`, and `docs/dev-guide/STANDARDS.md`) remain
diverged-protected until IMP-393 lands; interim tenant guidance belongs in
tenant-owned files such as this one.
```

- [ ] **Step 6: Verify preservation before commit**

```bash
rtk git diff --check
rtk git diff --name-only | rtk wc -l
rtk git diff --name-only 1d52117^ 1d52117
```

Expected: no whitespace errors; the path set is still exactly the same 17 paths. Compare every path except `docs/dev-guide/WORK_READINESS.md` byte-for-byte with `1d52117`; that file differs only by the required paragraph.

- [ ] **Step 7: Commit the carry**

```bash
rtk git add .cursorrules .github/copilot-instructions.md .nous-provenance.json .nous-sync.json AGENTS.md CLAUDE.md CODEX.md docs/TEST_EFFECTIVENESS_STANDARD.md docs/dev-guide/DEFINITION_OF_DONE.md docs/dev-guide/FEEDBACK.md docs/dev-guide/FRONTEND.md docs/dev-guide/SECURITY.md docs/dev-guide/STANDARDS.md docs/dev-guide/TESTING.md docs/dev-guide/WORK_READINESS.md docs/dev-guide/feedback-vocabulary.json testing/critical-paths.md
rtk git commit -m "chore(CHG-050): carry the 2026-09-06 Nous delivery (CHG-049 partition)"
```

Expected: the implementation commit contains exactly 17 paths and no readiness artifact.

### Task 3: Verify the child without pretending the parent gate is green

**Files:**

- Review: the CHG-050 implementation commit

- [ ] **Step 1: Run child-focused verification**

```bash
rtk pnpm readiness:check -- CHG-050
rtk git diff-tree --no-commit-id --name-only -r HEAD | rtk wc -l
rtk git diff --check HEAD^
```

Expected: readiness is valid, the implementation commit contains 17 paths, and the diff is clean. `pnpm lint` is intentionally deferred until CHG-051 registers the eight generated hashes that this child carries.

- [ ] **Step 2: Stop at the approved dependency boundary**

Do not emit `done` yet. CHG-051 must register the carried bytes and make the full gate green; final CHG-050 AC/build/mutation evidence is emitted only after that combined verification.

## Self-review

- The plan retains a recovery branch and uses no reset, unstage, adopt, or sync operation.
- The implementation commit remains exactly 17 paths and does not mix US-058.
- The one intentional byte change is inside an already carried tenant-owned file and directly implements CHG-049 step 6.
- Full-gate and terminal evidence are explicitly deferred to the dependent overlay child rather than falsely claimed on the known-red intermediate baseline.
