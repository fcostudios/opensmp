**Work item:** CHG-047
**Readiness assessment:** docs/readiness/CHG-047.json
**Approved estimate:** 265 minutes

# CHG-047 Authoritative Mutation Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one final cache-cleared diff-scoped mutation campaign authoritative, record its optional wall-clock cost, and provide opt-in 65/28 review estimate calibration.

**Architecture:** Extend the existing closed readiness object additively, keeping `mutation_minutes` optional in both validation layers. Add a contained, atomic `calibrate` operation to the existing readiness CLI; it rewrites only estimate, digest, and approval fields and introduces no validation rule. Put all review and fixes before the final mutation task so no scored input changes afterward.

**Tech Stack:** Node.js 22 ESM, JSON Schema, the repository's assertion-based Node test harness, pnpm, Git, and the existing diff-scoped Stryker orchestration.

**Spec:** `docs/superpowers/specs/2026-09-06-chg-047-authoritative-mutation-campaign-design.md`

## Global Constraints

- `mutation_minutes` is optional; historical artifacts without it stay valid.
- When present, `mutation_minutes` is an integer greater than or equal to zero and is not added to `actuals.total`.
- Calibration uses exactly `Math.ceil(implementation * 65 / 28)` and recomputes the five-phase total.
- Calibration is opt-in and creates no ratio validation rule or new error code.
- Calibration resets approval to pending and recomputes both digest fields.
- `pnpm test:mutation` is the ordinary authoritative runner; `pnpm test:mutation:core` is reserved for critical-set changes.
- The authoritative campaign runs after every adversarial review fix is committed.
- No files under `apps/` or `packages/` change.
- Before changing tests, follow `docs/dev-guide/TESTING.md`; tests exercise owned code directly and assert behavior.

---

### Task 1: Optional mutation-duration contract

**Files:**
- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/work-readiness/model.mjs`
- Modify: `docs/dev-guide/work-readiness.schema.json`

**Interfaces:**
- Consumes: `validateAssessment(value, { feedbackRecords })` and the JSON Schema `$defs.actuals` object.
- Produces: optional `actuals.mutation_minutes: number`, validated as a non-negative integer when present.

- [ ] **Step 1: Write failing model and schema tests**

Add a test beside the existing completion-actuals tests. Start from `completed()`/`normal()` fixtures and assert these exact properties:

```js
test("mutation_minutes is optional and, when present, is a non-negative integer", () => {
  const historical = completed();
  assert.equal(Object.hasOwn(historical.actuals, "mutation_minutes"), false);
  assert.equal(validateAssessment(historical, {
    feedbackRecords: [decisionFor(historical), { story: historical.work_id, event: "done" }],
  }).complete, true);

  for (const minutes of [0, 1, 137]) {
    const measured = completed();
    measured.actuals.mutation_minutes = minutes;
    assert.equal(validateAssessment(measured, {
      feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
    }).complete, true);
  }

  for (const invalid of [-1, 1.5, null, "4"]) {
    const measured = completed();
    measured.actuals.mutation_minutes = invalid;
    expectError("WR_INVALID_INTEGER", "$.actuals.mutation_minutes", () => validateAssessment(measured, {
      feedbackRecords: [decisionFor(measured), { story: measured.work_id, event: "done" }],
    }));
  }
});
```

Extend the schema-structure assertion to prove `mutation_minutes` is declared,
is not in `$defs.actuals.required`, and references the non-null non-negative
integer definition.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm test:work-readiness
```

Expected: failure because the closed runtime object rejects
`mutation_minutes` as unknown, and the schema does not declare it.

- [ ] **Step 3: Implement the minimal additive model change**

In `validateActualsShape`, add `mutation_minutes` to the allowed key list but
not the required completion list. Validate it only when present:

```js
if (Object.hasOwn(value, "mutation_minutes")) {
  integer(value.mutation_minutes, `${path}.mutation_minutes`);
}
```

Do not include it in `phaseSum`, `actuals.total`, or terminal completeness.

- [ ] **Step 4: Implement the matching JSON Schema change**

Add this property under `$defs.actuals.properties` and leave `$defs.actuals.required` unchanged:

```json
"mutation_minutes": {
  "$ref": "#/$defs/nonnegative_integer"
}
```

Use the schema's existing non-null non-negative integer definition; do not add
a parallel numeric definition.

- [ ] **Step 5: Run focused verification and confirm GREEN**

Run:

```bash
pnpm test:work-readiness
pnpm test:enforcement
```

Expected: both exit zero; all historical readiness fixtures remain unchanged.

- [ ] **Step 6: Commit the contract slice**

```bash
git add scripts/test-work-readiness.mjs scripts/work-readiness/model.mjs docs/dev-guide/work-readiness.schema.json
git commit -m "feat(CHG-047): record optional mutation duration"
```

---

### Task 2: Review calibration command

**Files:**
- Modify: `scripts/test-work-readiness.mjs`
- Modify: `scripts/work-readiness.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `calibrate CHG-047`, an existing readiness artifact, repository feedback, `computeReadinessPayloadSha256`, and the CLI's contained-path helpers.
- Produces: `calibrateAssessmentFile({ root, workId, feedbackRecords, fsOps? })` and the generic `readiness:calibrate` package command.

- [ ] **Step 1: Write failing pure calibration assertions**

Export the intended function name from the test import before it exists, then
add table-driven cases whose implementation values discriminate numerator,
denominator, and ceiling mutants:

```js
for (const [implementation, review] of [[0, 0], [1, 3], [28, 65], [29, 68], [60, 140]]) {
  test(`calibration maps ${implementation} implementation minutes to ${review} review minutes`, () => {
    const value = normal();
    value.estimate_minutes = {
      readiness: 7,
      implementation,
      focused_verification: 11,
      review: 999,
      integration: 5,
      total: 1022 + implementation,
    };
    const calibrated = calibrateAssessment(value);
    assert.deepEqual(calibrated.estimate_minutes, {
      readiness: 7,
      implementation,
      focused_verification: 11,
      review,
      integration: 5,
      total: 23 + implementation + review,
    });
  });
}
```

Assert the input object is not mutated, approval becomes exactly pending,
unrelated fields are preserved, and both digest fields equal a freshly
computed digest.

- [ ] **Step 2: Run the test and confirm RED**

Run `pnpm test:work-readiness`.

Expected: module import failure because `calibrateAssessment` is not exported.

- [ ] **Step 3: Implement pure calibration**

In `scripts/work-readiness.mjs`, export:

```js
export function calibrateAssessment(value) {
  const calibrated = structuredClone(value);
  const implementation = calibrated.estimate_minutes?.implementation;
  if (!Number.isInteger(implementation) || implementation < 0) {
    cliError("WR_INVALID_INTEGER", "Implementation estimate must be a non-negative integer", "$.estimate_minutes.implementation");
  }
  calibrated.estimate_minutes.review = Math.ceil(implementation * 65 / 28);
  calibrated.estimate_minutes.total = [
    "readiness", "implementation", "focused_verification", "review", "integration",
  ].reduce((sum, key) => sum + calibrated.estimate_minutes[key], 0);
  calibrated.approval = {
    status: "pending",
    approved_by: null,
    evidence: null,
    payload_sha256: "0".repeat(64),
  };
  const digest = computeReadinessPayloadSha256(calibrated);
  calibrated.readiness_payload_sha256 = digest;
  calibrated.approval.payload_sha256 = digest;
  return calibrated;
}
```

Validate the other four phase values with the same existing integer category
before summing them; never allow string concatenation or `NaN`.

- [ ] **Step 4: Run pure tests and confirm GREEN**

Run `pnpm test:work-readiness`.

Expected: the exact rounding, preservation, approval reset, and digest tests pass.

- [ ] **Step 5: Write failing real-filesystem command tests**

Using the existing disposable Git repository and real filesystem helpers, add
tests that:

- write a valid unstarted approved artifact, invoke the CLI as
  `calibrate US-123`, and assert the parsed file has the exact calibrated
  estimate, pending approval, and matching digest;
- retain the original bytes when an injected short write or rename failure
  occurs;
- reject a symlinked/out-of-repository artifact through `WR_FILE_INVALID` or
  `WR_PATH_ESCAPE`;
- reject a completed artifact through `WR_APPROVAL_INACTIVE`;
- reject an artifact with post-approval `started` evidence through the existing
  `WR_APPROVAL_ORDER` category.

Every test asserts exact bytes or exact structured state; no test merely checks
that execution does not throw.

- [ ] **Step 6: Run command tests and confirm RED**

Run `pnpm test:work-readiness`.

Expected: `calibrate` is not a recognized command and no atomic replacement API exists.

- [ ] **Step 7: Implement lifecycle guard and atomic replacement**

Add `calibrateAssessmentFile({ root, workId, feedbackRecords, fsOps = {} })`.
It must:

1. resolve the existing artifact with `safeRepoPath`;
2. parse and validate the current artifact and approval history;
3. reject `!validated.active` with `WR_APPROVAL_INACTIVE`;
4. find the selected approval event and reject any later execution evidence,
   including `started`, with `WR_APPROVAL_ORDER`;
5. call `calibrateAssessment`;
6. write complete bytes to an exclusive temporary file in `docs/readiness`;
7. fsync and close the temporary file;
8. atomically rename it over the original and fsync the directory;
9. remove the temporary file on every failure while preserving the original.

Reuse the existing execution-event vocabulary from `model.mjs` by exporting a
single predicate rather than copying its event set into the CLI.

- [ ] **Step 8: Wire CLI and package entry points**

Add `calibrate` beside `init`, `check`, `check-all`, `check-range`, and
`check-staged`. Require exactly one normalized work ID and return:

```text
Calibrated docs/readiness/US-123.json; review=140, total=235; approval reset to pending
```

Add to `package.json`:

```json
"readiness:calibrate": "node scripts/work-readiness.mjs calibrate"
```

- [ ] **Step 9: Run focused verification and confirm GREEN**

Run:

```bash
pnpm test:work-readiness
pnpm test:enforcement
```

Expected: both exit zero, including atomic-failure and lifecycle-negative cases.

- [ ] **Step 10: Commit the command slice**

```bash
git add scripts/test-work-readiness.mjs scripts/work-readiness.mjs scripts/work-readiness/model.mjs package.json
git commit -m "feat(CHG-047): calibrate readiness review estimates"
```

---

### Task 3: Canonical workflow guidance

**Files:**
- Modify: `docs/dev-guide/WORK_READINESS.md`
- Modify: `scripts/test-work-readiness.mjs`

**Interfaces:**
- Consumes: existing mutation commands and the optional `actuals.mutation_minutes` contract.
- Produces: one canonical definition and plan-ordering rule used by future assessments and implementation plans.

- [ ] **Step 1: Write failing documentation contract assertions**

Extend the test harness's `workReadinessGuide` assertions to require all of
these exact concepts:

```js
assert.match(workReadinessGuide, /pnpm mutation:cache:clear/u);
assert.match(workReadinessGuide, /MUTATION_BASE_REF=/u);
assert.match(workReadinessGuide, /pnpm test:mutation/u);
assert.match(workReadinessGuide, /test:mutation:core/u);
assert.match(workReadinessGuide, /mutation_minutes/u);
assert.match(workReadinessGuide, /Math\.ceil\(implementation \* 65 \/ 28\)/u);
assert.match(workReadinessGuide, /any implementation commit after this task invalidates it/u);
```

Also assert the guide says `mutation_minutes` is not added to phase totals and
that calibration is optional and resets approval.

- [ ] **Step 2: Run the test and confirm RED**

Run `pnpm test:work-readiness`.

Expected: the new guide assertions fail.

- [ ] **Step 3: Write the canonical guidance**

Update `WORK_READINESS.md` with three focused subsections:

1. **Estimate calibration:** document
   the generic `pnpm readiness:calibrate -- WORK-ID` invocation, the exact
   `Math.ceil(implementation * 65 / 28)` formula, opt-in behavior, approval
   reset, and manual override support.
2. **Authoritative cold campaign:** document cache clear, exact diff-scoped
   command, once-after-review ordering, and the sentence
   “any implementation commit after this task invalidates it.”
3. **Actuals:** document optional `mutation_minutes`, summed invalidated and
   retained authoritative campaign time, and non-addition to phase totals.

State explicitly that `test:mutation:core` is authoritative only for a CHG
that changes the effectiveness-critical set.

- [ ] **Step 4: Run focused verification and confirm GREEN**

Run:

```bash
pnpm test:work-readiness
pnpm test:enforcement
```

Expected: both exit zero and no generated guidance file changes.

- [ ] **Step 5: Commit the guidance slice**

```bash
git add docs/dev-guide/WORK_READINESS.md scripts/test-work-readiness.mjs
git commit -m "docs(CHG-047): define authoritative mutation workflow"
```

---

### Task 4: Integrated verification before review

**Files:**
- Modify only if a failing gate exposes a CHG-047 defect in one of the six implementation files.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a clean candidate ready for independent review.

- [ ] **Step 1: Run the focused acceptance gates**

```bash
pnpm test:work-readiness
pnpm test:enforcement
pnpm readiness:check -- CHG-047
```

Expected: all exit zero.

- [ ] **Step 2: Run the repository Definition of Done before review**

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all exit zero. Do not run the authoritative cold mutation campaign yet.

- [ ] **Step 3: Commit only a demonstrated repair, if required**

If a command fails because of CHG-047, reproduce it with the smallest focused
assertion, implement the minimal repair, rerun the focused and full gates, and
commit with:

```bash
git add docs/dev-guide/WORK_READINESS.md docs/dev-guide/work-readiness.schema.json scripts/work-readiness/model.mjs scripts/work-readiness.mjs scripts/test-work-readiness.mjs package.json
git commit -m "fix(CHG-047): repair integrated readiness behavior"
```

If all commands pass, make no empty commit.

---

### Task 5: Independent specification and quality review

**Files:**
- Modify only for a verified CHG-047 finding.

**Interfaces:**
- Consumes: the approved readiness artifact, design, plan, implementation diff, and test evidence.
- Produces: reviewed final source bytes; every accepted finding has a failing reproduction and committed fix.

- [ ] **Step 1: Perform an independent specification review**

Map every CHG-047 item and design requirement to an exact implementation line
and test oracle. Verify optional compatibility, arithmetic, approval reset,
atomic replacement, lifecycle refusal, command wiring, and workflow wording.

- [ ] **Step 2: Perform an independent quality and security review**

Review path containment, symlink handling, temporary-file cleanup, partial
writes, integer edge cases, overflow/unsafe-number behavior, digest freshness,
prototype/inherited-property safety, and whether test assertions discriminate
plausible mutants.

- [ ] **Step 3: Reproduce every accepted finding before editing**

For each finding, add or identify the smallest failing assertion. Reject style
preferences and speculative changes that have no observable failure.

- [ ] **Step 4: Fix accepted findings and rerun gates**

After each repair, run `pnpm test:work-readiness` and
`pnpm test:enforcement`. After the final repair, rerun:

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

- [ ] **Step 5: Commit all review repairs**

Use one commit per coherent review-fix loop:

```bash
git add docs/dev-guide/WORK_READINESS.md docs/dev-guide/work-readiness.schema.json scripts/work-readiness/model.mjs scripts/work-readiness.mjs scripts/test-work-readiness.mjs package.json
git commit -m "fix(CHG-047): repair reviewed readiness behavior"
```

The final review-fix commit is the source cutoff. No implementation change is
permitted after the next task begins.

---

### Task 6: Final authoritative cold mutation campaign

**Files:**
- Do not modify implementation, tests, dependencies, configuration, runners, or tooling after this task begins.

**Interfaces:**
- Consumes: committed, reviewed CHG-047 source cutoff and its approved authority base.
- Produces: the sole retained cache-cleared diff-scoped mutation result and measured wall-clock minutes.

- [ ] **Step 1: Confirm the worktree and source cutoff**

```bash
git status --short
git rev-parse HEAD
```

Expected: clean worktree and a recorded final review-fix/source-cutoff commit.

- [ ] **Step 2: Clear the cache**

```bash
pnpm mutation:cache:clear
```

Expected: only the repository-owned mutation cache is removed.

- [ ] **Step 3: Run exactly one authoritative diff-scoped campaign and time it**

```bash
MUTATION_BASE_REF=547aa97 time pnpm test:mutation
```

Expected: every selected shard meets the repository threshold. Record the
nearest whole wall-clock minute as `mutation_minutes`. Do not run
`test:mutation:core`; CHG-047 does not change the critical set.

- [ ] **Step 4: Preserve the result**

Any implementation commit after this task invalidates it. If the campaign
finds a real survivor, return to Task 5, add a failing oracle, fix and commit,
then begin Task 6 again; record the superseded attempt with its real
`mutation_invalidation` reason.

---

### Task 7: Evidence and terminal closure

**Files:**
- Modify: `docs/readiness/CHG-047.json`
- Modify: `.nous-feedback.jsonl`

**Interfaces:**
- Consumes: committed source cutoff, full gate evidence, independent reviews, and final campaign duration/result.
- Produces: complete actuals, AC evidence, build evidence, and terminal `done`.

- [ ] **Step 1: Record exact closure actuals**

Populate all required actual fields from named Git objects and timestamps. Add
`mutation_minutes` with the summed duration of every authoritative attempt.
Set `cold_mutation_attempts` and `mutation_invalidations` consistently and name
every invalidated attempt's reason before terminal evidence.

- [ ] **Step 2: Append ordered feedback evidence**

Append one `ac_verify` per acceptance criterion, one `build_pass` bound to the
source cutoff, and any required `mutation_invalidation`. Do not append `done`
until the non-terminal evidence and actuals are committed. Preserve the file
byte-for-byte before every appended record.

- [ ] **Step 3: Validate closure**

```bash
pnpm test:feedback-order
pnpm readiness:check -- CHG-047
git diff --check
```

Expected: all exit zero.

- [ ] **Step 4: Commit governance-only closure**

Commit provisional actuals and non-terminal evidence while authorization is
active, then commit `done` separately because the terminal event deactivates
candidate authorization:

```bash
git add docs/readiness/CHG-047.json .nous-feedback.jsonl
git commit -m "docs(CHG-047): record delivery evidence"
## Append the single CHG-047 done record after the prior commit succeeds.
git add .nous-feedback.jsonl
git commit -m "docs(CHG-047): record terminal closure"
```

These governance-only records do not alter the source bytes scored by Task 6.
