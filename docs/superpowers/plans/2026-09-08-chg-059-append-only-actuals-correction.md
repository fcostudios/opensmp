**Work item:** CHG-059
**Readiness assessment:** docs/readiness/CHG-059.json
**Approved estimate:** 300 minutes

# CHG-059 Append-Only Completion Actuals Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Nous append-only actuals-correction protocol, enforce it in Ledger’s readiness gate, and definitively correct CHG-058’s effective changed-file count from 11 to 8 without rewriting immutable evidence.

**Architecture:** IMP-404 first establishes the shared schema, vocabulary, ingestion, timeline, and calibration resolver. Ledger then mirrors the closed validation semantics in one pure model resolver used by both assessment and Git-range validation. The final task appends one correction event and proves both systems resolve it while the original CHG-058 readiness bytes remain unchanged.

**Tech Stack:** Node.js ESM, JSON Schema, JSONL feedback, Python/pytest in Nous, pnpm/Vitest-style script tests, Git.

**Spec:** `docs/superpowers/specs/2026-09-08-chg-059-append-only-actuals-correction-design.md`

## Global Constraints

- Work item `CHG-059`; approved estimate 300 minutes, below the 320-minute limit.
- Do not edit `docs/readiness/CHG-058.json`, its original terminal event, or commit `4901d3b472028c2fb572e53142ccb908aba029a2`.
- Do not emit `actuals_corrected` until IMP-404 is merged, operator-verified, and its generated vocabulary/guidance is delivered.
- The event is closed to `story,event,ref,change,target_actuals_sha256,replacement_actuals,reason,evidence,ts`.
- Canonical hashes use compact recursive-key-sorted UTF-8 JSON and lowercase SHA-256.
- Replacement actuals are complete and satisfy the same arithmetic, campaign, timestamp, and lifecycle evidence rules as terminal actuals.
- Invalid corrections leave the prior effective actuals intact and produce a named failure; they are never silently ignored as valid and never coerced to zero.
- Raw actuals stay byte-identical. Approval digests are not recomputed by a completion correction.
- Tests use real files and pure owned modules; do not mock owned code or assert on source text/log output.
- The authoritative `pnpm test:mutation` campaign runs once, cold and last, after adversarial review and `pnpm check`; zero routed shards is a valid measured outcome.
- Any implementation/test commit after the authoritative campaign invalidates it and requires a reasoned second attempt.

---

### Task 1: Deliver the canonical substrate contract

**Files:**
- Create in Nous: `Nous/System/feedback_schemas/actuals_corrected.schema.json`
- Create in Nous: `Nous/System/actuals_corrections.py`
- Modify in Nous: `Nous/System/feedback_schemas/__init__.py`
- Modify in Nous: `Nous/System/nous_package.py`
- Modify in Nous: `Nous/System/package_templates/claude_md.py`
- Modify in Nous: `Nous/System/execution_shape_enrich.py`
- Modify in Nous: `Nous/System/nous_trace.py`
- Test in Nous: `Nous/System/tests/test_imp404_actuals_resolution.py`
- Test in Nous: `Nous/System/tests/test_imp404_actuals_correction_pull.py`
- Test in Nous: `Nous/System/tests/test_imp385_feedback_vocabulary_extension.py`
- Test in Nous: `Nous/System/tests/test_imp397_i02_enrichment.py`
- Test in Nous: `Nous/System/tests/test_imp374_recalibrate.py`
- Test in Nous: `Nous/System/tests/test_imp375_i02_pull_wiring.py`

**Interfaces:**
- Produces: `canonical_actuals_sha256(actuals: dict) -> str`.
- Produces: `resolve_effective_actuals(raw_actuals, correction_events, *, terminal_ts=None, valid_decisions=None) -> {raw,effective,corrections,exclusions}`.
- Produces: canonical `actuals_corrected` vocabulary/schema and full-payload annotation projection.
- Produces: timeline and target-package calibration resolution from the same helper.

- [ ] **Step 1: Execute IMP-404 I01 with TDD**

Write the resolver RED fixtures specified by the IMP sprint plan, verify they fail, implement the closed schema and pure hash-chain fold, then rerun them to GREEN. Commit only I01 paths as `IMP-404 I01: add the canonical actuals correction chain`.

- [ ] **Step 2: Execute IMP-404 I02 with TDD**

Add failing pull and emission fixtures proving validation precedes time-axis storage, full payload persistence is idempotent, and generated vocabulary/guidance exposes the contract. Implement the minimal ingestion/template changes and commit as `IMP-404 I02: validate and emit actuals corrections`.

- [ ] **Step 3: Execute IMP-404 I03 with TDD**

Add failing timeline and recalibration fixtures for raw 11/effective 8 and uncorrected compatibility. Route both target-package consumers through the shared resolver; keep `ledger_actuals` unchanged. Commit as `IMP-404 I03: resolve effective actuals in measurement consumers`.

- [ ] **Step 4: Complete IMP-404 I04 and substrate gates**

Run the synthetic end-to-end fixtures, `nous dogfood --project fcostudios__smp` to a temporary package, focused tests, mutation evidence for changed critical modules, `nous parity`, and `nous doctor --processes`. Write `IMP-404_REVIEW_PASS.md`, close review findings, and commit as `IMP-404 I04: prove append-only actuals correction end to end`.

- [ ] **Step 5: Merge and respect the operator boundary**

From the clean Nous main checkout run `python3 Nous/System/nous_dev.py imp-merge 404`. Confirm it sets `dev_done`; run `imp-close 404` and leave the human-only `verified` flip and `imp regenerate-markdown` explicitly deferred until the operator records them.

---

### Task 2: Adopt the emitted vocabulary and guidance in Ledger

**Files:**
- Modify by Nous emission only: `docs/dev-guide/feedback-vocabulary.json`
- Modify by Nous emission only: `docs/dev-guide/FEEDBACK.md`
- Modify as required by the established generated-guidance carry mechanism: `.nous-provenance.json`, `.nous-sync.json`, and the relevant CHG-059 overlay manifest/desired files only if the delivery checker requires a tenant pin

**Interfaces:**
- Consumes: IMP-404’s verified `actuals_corrected` schema and generated contract text.
- Produces: generated tenant guidance that the feedback-order checker can trust without a local vocabulary fork.

- [ ] **Step 1: Generate the delivery from verified Nous**

Run the normal agent-files/package sync for `fcostudios__smp` after IMP-404 verification. Do not hand-edit either generated dev-guide file.

- [ ] **Step 2: Inspect the exact delivery**

Assert the vocabulary class is `annotation`, the documented keys exactly match the schema, and unrelated tenant guidance is unchanged.

- [ ] **Step 3: Register provenance if required**

If `pnpm run check:generated-guidance` reports the emitted paths as unknown, add the narrow CHG-059 overlay layer using the delivered bytes and register only those paths. Do not broaden the layer.

- [ ] **Step 4: Verify and commit the adoption**

Run `pnpm run check:generated-guidance` and the focused feedback-order tests. Stage exact paths and commit `chore(CHG-059): adopt the canonical actuals correction contract`.

---

### Task 3: Resolve and validate effective actuals in Ledger

**Files:**
- Modify: `scripts/work-readiness/model.mjs`
- Modify: `scripts/work-readiness/git.mjs`
- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/check-nous-feedback-order.mjs`
- Modify: `scripts/test-feedback-order.mjs`

**Interfaces:**
- Produces: `canonicalActualsSha256(actuals) -> string`.
- Produces: `resolveEffectiveActuals(rawActuals, feedbackRecords, context) -> {raw,effective,corrections,errors}`.
- Consumes: the existing complete-actuals validator, assessment, lifecycle events, decision records, and Git-range feedback records.
- Produces: correction-only Git commits accepted only when the appended event validates; raw edits still raise `WR_ACTUALS_IMMUTABLE`.

- [ ] **Step 1: Write resolver RED fixtures**

Use temporary readiness and JSONL files to assert a valid correction leaves raw `changed_files: 11` and returns effective `8`. Add literal failures for stale and forged hashes, duplicate ref, fork/replay, invalid timestamp, missing prior decision, wrong story/change, pre-terminal use, partial replacement, bad total arithmetic, and campaign-count mismatch.

- [ ] **Step 2: Verify RED**

Run `rtk pnpm test:work-readiness` and require failure because the resolver/export does not exist and correction-only transitions are unknown.

- [ ] **Step 3: Extract complete-actuals validation and implement the fold**

Factor the terminal actuals content checks into one pure helper callable for both raw and replacement objects. Implement canonical hashing and ordered resolution without mutating either input. Return every accepted correction and exact error codes/messages for excluded entries.

- [ ] **Step 4: Reach resolver GREEN**

Run `rtk pnpm test:work-readiness`; require valid, adversarial, two-link, and uncorrected compatibility fixtures to pass.

- [ ] **Step 5: Write Git transition and feedback-order RED fixtures**

Create a correction-only commit fixture where only `.nous-feedback.jsonl` changes. Assert the Git validator includes the target work item even though its readiness JSON is unchanged, accepts a valid append, and still rejects raw actuals edits/deletions. Assert the feedback-order checker accepts the canonical event only after terminal + correcting decision and rejects every invalid order/shape.

- [ ] **Step 6: Implement shared transition validation**

Extend `validateAllActualTransitions` to union readiness-changed IDs with stories named by appended corrections and call the pure resolver. Extend the feedback-order checker from the emitted vocabulary/schema contract; do not add a tenant-local event exception.

- [ ] **Step 7: Prove Task 3 GREEN and commit**

Run `rtk pnpm test:work-readiness`, `rtk pnpm test:feedback-order`, and `rtk pnpm readiness:check -- CHG-059`. Stage the five Task 3 files and commit `feat(CHG-059): validate append-only actuals corrections`.

---

### Task 4: Adversarial verification before the authoritative campaign

**Files:**
- Review: all CHG-059 tenant paths
- Append evidence only: `.nous-feedback.jsonl`

**Interfaces:**
- Consumes: Tasks 2–3 complete implementation.
- Produces: reviewed source cutoff with no unresolved correctness finding.

- [ ] **Step 1: Run independent spec-compliance review**

Check every design invariant against the diff, especially raw immutability, full replacements, global ref uniqueness, correction-only Git discovery, and generated-vocabulary ownership. Fix all material findings.

- [ ] **Step 2: Run adversarial quality review**

Attempt stale/fork/replay/partial/arithmetic/timestamp/decision/campaign attacks using the public interfaces. Fix every reproducible issue and rerun focused tests after each fix.

- [ ] **Step 3: Run the complete non-mutation gate**

Run `rtk pnpm check` and both readiness checks for CHG-059. Record a timestamped `build_pass` only after GREEN.

- [ ] **Step 4: Freeze the source cutoff**

Commit all review fixes before the campaign. Record the cutoff SHA; no code, test, plan, or generated-contract commit may follow it before the authoritative result.

---

### Task 5: Run the last campaign and definitively correct CHG-058

**Files:**
- Append: `.nous-feedback.jsonl`
- Fill once: `docs/readiness/CHG-059.json` actuals only
- Do not modify: `docs/readiness/CHG-058.json`

**Interfaces:**
- Produces: canonical event ref `CHG058-ACTUALS-1` targeting `dd232b1b4d60216c6ae8b4bb54ab9997b84db9868183ccd28839ba1faefce6d7`.
- Produces: effective CHG-058 actuals with `changed_files: 8`, `total: 125`, `estimate_variance_minutes: -175`, `commits: 10`, and the original single cold campaign retained.

- [ ] **Step 1: Run the one authoritative campaign**

Clear the mutation cache using the repository command and run `rtk pnpm test:mutation` exactly once. If the preflight finds zero routed shards, record zero shards and the observed wall clock; do not invent a score. Do not emit preview `test_report` evidence.

- [ ] **Step 2: Append the concrete correction**

Append one JSON line whose exact fields and replacement object match the approved design. Use the current UTC timestamp, the verified raw hash, the raw NUL-delimited Git command, and the branch reflog as evidence. Do not alter the original CHG-058 artifact or event.

- [ ] **Step 3: Prove the tenant projection**

Run work-readiness and feedback-order tests plus `pnpm readiness:check -- CHG-059`. Assert the raw CHG-058 file hash equals its pre-task value and the resolver reports raw 11/effective 8 with one correction.

- [ ] **Step 4: Pull and prove the Nous projection**

Run the normal package pull for `fcostudios__smp`, then `story timeline CHG-058 --target <ledger-path>` and the target-package recalibration command. Require the timeline to show raw 11, effective 8, `CHG058-ACTUALS-1`, and `CHG-059`, with calibration consuming effective values and repeated pull remaining idempotent.

- [ ] **Step 5: Record CHG-059 completion evidence**

Fill CHG-059 actuals from primary sources, append its timestamped `ac_verify`, authoritative `test_report` only when a scored shard exists, and single `done` event under the current feedback contract. Run verification-before-completion checks without changing implementation afterward.

- [ ] **Step 6: Commit and finish the branch**

Stage exactly `.nous-feedback.jsonl` and `docs/readiness/CHG-059.json` plus any required immutable evidence artifact. Commit `docs(CHG-059): record the definitive CHG-058 actuals correction`. Use the finishing-a-development-branch workflow to merge the clean verified branch without discarding unrelated main-tree work.
