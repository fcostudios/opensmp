# Work Readiness and Outcome-Based Partitioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every agent from implementing an oversized or unresolved `US-*` or `CHG-*` by enforcing an approved, machine-readable readiness assessment and outcome-based partition before code changes begin.

**Architecture:** A Node.js CLI validates strict JSON readiness artifacts, matching Nous decision evidence, Git commit/range ownership, and completion actuals. The CLI is enforced through package scripts, the commit-message hook, the full repository gate, and durable CHG-022 overlays for generator-owned agent guidance. All historical completed work is grandfathered; unfinished and new work fails closed.

**Tech Stack:** Node.js 22 ESM and built-ins, JSON Schema, Git CLI, Bash commit hooks, Python reconciliation overlays, JSONL Nous feedback, pnpm.

**Work item:** `CHG-022`

**Readiness authority:** Policy-bootstrap approval `CHG022-READINESS-APPROVAL` in `.nous-feedback.jsonl`. This one-time bootstrap creates the gate itself; it is not an exemption available to later US or CHG work.

---

## Scope and file ownership

| File | Responsibility |
|---|---|
| `docs/dev-guide/work-readiness.schema.json` | Strict machine-readable assessment contract |
| `docs/dev-guide/WORK_READINESS.md` | Canonical policy, examples, partition rules, and operator workflow |
| `docs/readiness/README.md` | Artifact directory ownership and commands |
| `docs/readiness/CHG-022.json` | Explicit policy-bootstrap assessment and actuals |
| `scripts/work-readiness/model.mjs` | Pure assessment, partition, estimate, approval, and actuals validation |
| `scripts/work-readiness/git.mjs` | Git range/staged-file ownership and change-classification logic |
| `scripts/work-readiness.mjs` | CLI orchestration and stable human/JSON output |
| `scripts/test-work-readiness.mjs` | Real-file and temporary-Git-repository contract tests |
| `.githooks/commit-msg` | Local implementation-commit blocking gate |
| `package.json` | Public readiness commands and repository test integration |
| `infra/scripts/overrides/CHG-022/16f72c9/**` | Append-only desired guidance derived from the current generated package |
| `infra/scripts/reconcile-sprint1-docs.py` | Ordered CHG-022 overlay application and fail-closed hash checks |
| `infra/scripts/tests/test_reconcile_sprint1_docs.py` | Overlay repair, check, and tamper regressions |
| `AGENTS.md`, `CLAUDE.md` | Short mandatory agent entry-point contract |
| `docs/dev-guide/DEFINITION_OF_DONE.md` | Completion actuals and readiness rejection rules |
| `.nous-feedback.jsonl` | Approval, detailed Substrate feedback, verification, and terminal evidence |

No generated sprint queue, generated story file, navigation registry, or existing
override artifact is edited.

### Task 1: Commit the strict readiness schema, guide, and CHG-022 bootstrap artifact

**Files:**
- Create: `docs/dev-guide/work-readiness.schema.json`
- Create: `docs/dev-guide/WORK_READINESS.md`
- Create: `docs/readiness/README.md`
- Create: `docs/readiness/CHG-022.json`
- Modify: `.nous-feedback.jsonl`

- [ ] **Step 1: Write the strict JSON Schema**

Define these required top-level keys with `additionalProperties: false`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ledger.local/schemas/work-readiness-v1.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "work_id", "kind", "title", "source",
    "outcomes", "acceptance_criteria", "scopes", "signals",
    "estimate_minutes", "uncertainties", "dependencies", "decision",
    "partitions", "approval", "actuals"
  ]
}
```

Define closed objects for outcomes, AC mappings, signals, phase estimates,
uncertainties, dependencies, partitions, approval, and actuals. Work IDs match
`^(US|CHG)-[0-9]{3,}$`; official child IDs use the same expression. Phase counts
are non-negative integers. Decisions are `ready`, `partition_required`, or
`blocked`.

- [ ] **Step 2: Write the canonical guide and artifact README**

The guide must state the ten hard readiness failures verbatim from the approved
design, the 45/90-minute checkpoints, vertical partition rules, approval-event
contract, bootstrap behavior, exact commands, and examples for:

```text
ready US -> implementation permitted
oversized functional CHG -> partition_required
unresolved dependency -> blocked
partition proposal -> official child IDs required before execution
```

The README must say that generated sprint/story files remain Nous-owned and
that readiness artifacts never create official IDs.

- [ ] **Step 3: Add CHG-022's explicit bootstrap assessment**

Record CHG-022 as the one policy-activation bootstrap:

```json
{
  "schema_version": 1,
  "work_id": "CHG-022",
  "kind": "CHG",
  "title": "Enforce work readiness and outcome-based partitioning",
  "source": "docs/superpowers/specs/2026-08-13-work-readiness-and-partitioning-design.md",
  "decision": "ready",
  "policy_bootstrap": true,
  "approval": {
    "status": "approved",
    "approved_by": "user",
    "evidence": "CHG022-READINESS-APPROVAL"
  }
}
```

Include the complete fields required by the schema. The assessment documents
that the bootstrap exemption is non-repeatable and does not grandfather later
CHG-022 functional expansion. Initialize actuals as `null` until Task 8.

- [ ] **Step 4: Append the approval decision if it is not already present**

Require exactly one decision with ID `CHG022-READINESS-APPROVAL`; do not append
a duplicate when the design commit already contains it.

- [ ] **Step 5: Validate and commit the policy artifacts**

```bash
rtk git add docs/dev-guide/work-readiness.schema.json \
  docs/dev-guide/WORK_READINESS.md docs/readiness \
  .nous-feedback.jsonl
rtk git commit -m "docs(CHG-022): define work readiness contract"
```

### Task 2: Implement fail-closed assessment and partition validation

**Files:**
- Create: `scripts/work-readiness/model.mjs`
- Create: `scripts/test-work-readiness.mjs`
- Test: `scripts/test-work-readiness.mjs`

- [ ] **Step 1: Expand RED tests for the complete model contract**

Use real object fixtures and exact error codes. Cover:

```js
expectFailure(ready({ total: 121 }), "WR_ESTIMATE_OVER_BUDGET");
expectFailure(ready({ outcomes: [outcome("O1"), outcome("O2")] }), "WR_MULTIPLE_OUTCOMES");
expectFailure(ready({ scopes: ["contracts", "db", "server", "ui"] }), "WR_TOO_MANY_SCOPES");
expectFailure(ready({ signals: { expected_changed_files: 21 } }), "WR_TOO_MANY_FILES");
expectFailure(ready({ signals: { tooling_change: true }, scopes: ["ui", "tooling"] }), "WR_MIXED_FUNCTIONAL_TOOLING");
expectFailure(partitioned({ partitions: [child("US-123"), child("US-123")] }), "WR_DUPLICATE_CHILD");
expectFailure(partitioned({ partitions: [child("US-123", ["AC1"])] }, ["AC1", "AC2"]), "WR_ORPHAN_AC");
expectFailure(partitioned({ dependencies: [["US-123", "US-124"], ["US-124", "US-123"]] }), "WR_DEPENDENCY_CYCLE");
expectFailure(partitioned({ partitions: [child("US-123-P1")] }), "WR_UNOFFICIAL_CHILD_ID");
```

Add a functional `CHG-*` fixture and prove it receives the same outcome and
budget enforcement as a `US-*`.

- [ ] **Step 2: Run model tests and witness RED**

Run `rtk node scripts/test-work-readiness.mjs`.

Expected: failures for missing validators/error codes.

- [ ] **Step 3: Implement stable validation results**

Export:

```js
export class WorkReadinessError extends Error {
  constructor(code, message, path = "$") {
    super(message);
    this.code = code;
    this.path = path;
  }
}

export function validateAssessment(value, { feedbackRecords = [] } = {}) {}
export function classifyAssessment(value) {}
export function validatePartitionGraph(value) {}
export function validateApproval(value, feedbackRecords) {}
export function validateCompletionActuals(value, feedbackRecords) {}
```

Parse untrusted JSON as closed objects with own-property checks. Recompute phase
totals rather than trusting `total`. Recompute all hard-limit decisions. Never
accept `ready` because the file merely declares it.

- [ ] **Step 4: Implement requirement and partition traceability**

Build sets for outcome IDs, AC IDs, and official child IDs. Reject missing,
duplicate, or unresolved references. Use a depth-first color map to reject
dependency cycles. Require every child to contain one outcome/demo, a complete
estimate, and both implementation and verification scopes.

- [ ] **Step 5: Implement approval and actuals lifecycle checks**

Approval passes only when `.nous-feedback.jsonl` has one earlier matching
`decision` for the same work item or controlling CHG. Terminal `done` requires
non-null actuals with phase minutes, changed files, commits, review loops, cold
attempts, invalidations, variance, and root cause.

- [ ] **Step 6: Run focused tests**

```bash
rtk node scripts/test-work-readiness.mjs
```

Expected: all model/partition tests pass and print
`[work-readiness test] model ok`.

- [ ] **Step 7: Commit**

```bash
rtk git add scripts/work-readiness/model.mjs scripts/test-work-readiness.mjs
rtk git commit -m "feat(CHG-022): validate work readiness models"
```

### Task 3: Implement real-Git ownership and change classification

**Files:**
- Create: `scripts/work-readiness/git.mjs`
- Modify: `scripts/test-work-readiness.mjs`
- Test: `scripts/test-work-readiness.mjs`

- [ ] **Step 1: Add temporary-repository RED tests**

Create actual temporary Git repositories using `mkdtempSync` and `spawnSync`.
Do not mock Git. Test:

- documentation-only bootstrap with an unapproved assessment passes;
- a production file with missing readiness fails;
- a production commit naming two IDs fails when one is unready;
- a test or executable-tooling file is implementation-class;
- a generated sprint-plan edit is rejected;
- an already-completed historical story is grandfathered;
- a missing or ambiguous base ref fails closed;
- paths containing `..`, symlinks escaping the repository, and NUL input fail.

- [ ] **Step 2: Run and witness RED**

Run `rtk node scripts/test-work-readiness.mjs`.

Expected: `ERR_MODULE_NOT_FOUND` for `scripts/work-readiness/git.mjs`.

- [ ] **Step 3: Implement Git primitives**

Export:

```js
export function extractWorkIds(message) {}
export function listChangedPaths({ root, base, head = "HEAD", staged = false }) {}
export function classifyChangedPath(path) {}
export function resolveDefaultBase(root, env = process.env) {}
export function validateRangeOwnership({ root, base, head, message }) {}
```

Invoke Git with argument arrays and `shell: false`. Reject non-zero exit, output
larger than a bounded maximum, unexpected status records, absolute paths, and
paths resolving outside the repository.

- [ ] **Step 4: Define the closed change classes**

Only these paths are bootstrap documentation:

```text
docs/readiness/**
docs/superpowers/specs/**
docs/superpowers/plans/**
.nous-feedback.jsonl
```

All other changed paths are implementation-class, including tests, scripts,
hooks, migrations, runtime configuration, and generated guidance. Generated
Nous-owned story/sprint files are always rejected unless an explicit reconciler
overlay owns the exact path.

- [ ] **Step 5: Prove grandfathering is terminal-evidence based**

Historical exemption requires a valid `done` event earlier than the CHG-022
activation decision. A backlog/in-progress story never becomes exempt merely
because its file predates the policy.

- [ ] **Step 6: Run tests and commit**

```bash
rtk node scripts/test-work-readiness.mjs
rtk git add scripts/work-readiness/git.mjs scripts/test-work-readiness.mjs
rtk git commit -m "feat(CHG-022): classify readiness-owned Git changes"
```

### Task 4: Build the CLI and stable operator output

**Files:**
- Create: `scripts/work-readiness.mjs`
- Modify: `scripts/test-work-readiness.mjs`
- Modify: `package.json`
- Test: `scripts/test-work-readiness.mjs`

- [ ] **Step 1: Add CLI RED tests**

Run the CLI as a real subprocess for:

```text
init CHG-123
check CHG-022
check-all
check-range --base 1111111111111111111111111111111111111111 --head HEAD
check-staged --message-file /tmp/chg022-fixture/COMMIT_EDITMSG
```

Assert exact exit codes: `0` pass, `1` readiness rejection, `2` invocation or
environment error. Assert `--json` emits one object with `ok`, `command`,
`work_ids`, `errors`, and `summary`.

- [ ] **Step 2: Run and witness RED**

Expected: CLI module missing.

- [ ] **Step 3: Implement the CLI dispatcher**

Use this command table:

```js
const commands = new Map([
  ["init", initAssessment],
  ["check", checkAssessment],
  ["check-all", checkAllAssessments],
  ["check-range", checkRange],
  ["check-staged", checkStaged],
]);
```

`init` uses exclusive creation and refuses overwrites. It normalizes IDs to
uppercase but never invents an ID. All commands load `.nous-feedback.jsonl`
from the resolved repository root.

- [ ] **Step 4: Wire package commands**

Add:

```json
"readiness:init": "node scripts/work-readiness.mjs init",
"readiness:check": "node scripts/work-readiness.mjs check",
"readiness:check:all": "node scripts/work-readiness.mjs check-all",
"readiness:check:range": "node scripts/work-readiness.mjs check-range",
"test:work-readiness": "node scripts/test-work-readiness.mjs"
```

Prepend `pnpm run test:work-readiness` to the root `test` command so
`pnpm check` always exercises the gate.

- [ ] **Step 5: Run commands and commit**

```bash
rtk pnpm test:work-readiness
rtk pnpm readiness:check -- CHG-022
rtk pnpm readiness:check:all
rtk git add scripts/work-readiness.mjs scripts/test-work-readiness.mjs package.json
rtk git commit -m "feat(CHG-022): expose work readiness CLI"
```

### Task 5: Enforce readiness in the commit hook and repository range gate

**Files:**
- Modify: `.githooks/commit-msg`
- Modify: `docs/dev-guide/COMMITS.md`
- Modify: `scripts/test-work-readiness.mjs`
- Test: `scripts/test-work-readiness.mjs`

- [ ] **Step 1: Add hook RED tests using a real temporary repository**

Install the repository hook into the fixture. Assert:

- `feat: code (US-123)` is rejected without an assessment;
- the same commit is rejected for `partition_required`;
- it passes for approved `ready` with matching decision evidence;
- docs-only readiness bootstrap passes before approval;
- multiple IDs require all assessments;
- `COMMIT_MSG_NO_US=1` does not create readiness approval and the subsequent
  range check rejects the bypassed implementation commit;
- merge/revert/release exemptions preserve traceability behavior but range
  verification still checks implementation commits introduced by the range.

- [ ] **Step 2: Run and witness RED**

Run `rtk pnpm test:work-readiness`.

Expected: unready implementation commit currently passes the old hook.

- [ ] **Step 3: Call the staged readiness gate after ID extraction**

After the existing traceability check succeeds, invoke:

```bash
node scripts/work-readiness.mjs check-staged --message-file "$COMMIT_MSG_FILE"
```

Keep the emergency traceability bypass, but print that it does not bypass the
server/range readiness gate. There is no readiness-specific bypass variable.

- [ ] **Step 4: Document enforcement and recovery**

Update `COMMITS.md` with assessment bootstrap examples, rejected implementation
examples, multiple-ID behavior, and the command to fix an unready commit.

- [ ] **Step 5: Run hook tests and commit**

```bash
rtk pnpm test:work-readiness
rtk git add .githooks/commit-msg docs/dev-guide/COMMITS.md scripts/test-work-readiness.mjs
rtk git commit -m "feat(CHG-022): block unready implementation commits"
```

### Task 6: Make agent and DoD guidance durable through a CHG-022 overlay

**Files:**
- Create: `infra/scripts/overrides/CHG-022/16f72c9/manifest.json`
- Create: `infra/scripts/overrides/CHG-022/16f72c9/AGENTS.md`
- Create: `infra/scripts/overrides/CHG-022/16f72c9/CLAUDE.md`
- Create: `infra/scripts/overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md`
- Modify: `infra/scripts/reconcile-sprint1-docs.py`
- Modify: `infra/scripts/tests/test_reconcile_sprint1_docs.py`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/dev-guide/DEFINITION_OF_DONE.md`
- Test: `infra/scripts/tests/test_reconcile_sprint1_docs.py`

- [ ] **Step 1: Add overlay RED tests**

Add tests that:

- current CHG-001 desired guidance upgrades to CHG-022 desired guidance;
- `--check` reports drift without writing;
- sync repairs all three governed files atomically;
- altered CHG-022 source or desired bytes fail hash verification before writes;
- an unknown post-CHG-022 file state fails closed;
- the reconciled `CLAUDE.md` mirrors remain exact;
- all three desired files contain `pnpm readiness:check` and the two-hour rule.

- [ ] **Step 2: Run the focused Python tests and witness RED**

```bash
rtk python3 -B -m unittest \
  infra.scripts.tests.test_reconcile_sprint1_docs -v
```

Expected: CHG-022 overlay support missing.

- [ ] **Step 3: Generalize ordered append-only overlays**

Replace the single “latest” overlay assumption with an ordered list:

```python
LAYERED_OVERRIDE_SPECS = (
    ("CHG-004/e4b9a06", CHG004_PATHS),
    ("CHG-022/16f72c9", CHG022_PATHS),
)
```

Each layer declares exact `source_path`, `source_sha256`, and
`desired_sha256`. Apply layers in order; a candidate must match that layer's
source or desired hash. Never modify CHG-001/004/005 artifacts.

- [ ] **Step 4: Add concise mandatory guidance**

Insert this invariant in both agent entry points and the DoD:

```text
Before writing a design, implementation plan, production code, test, migration,
or executable tooling for any US-* or CHG-*, run its approved readiness
assessment. A work item above 120 minutes or any cohesion limit is not
execution-ready; partition it into official, approved vertical children first.
```

Link to `WORK_READINESS.md` and show the exact CLI. Do not duplicate the full
guide in generated files.

- [ ] **Step 5: Produce and hash the overlay artifacts**

Source paths point to the current CHG-001 desired artifacts for `AGENTS.md`,
`CLAUDE.md`, and `DEFINITION_OF_DONE.md`. Desired artifacts contain only the
reviewed CHG-022 additions. Generate the manifest hashes with `rtk sha256sum`
and copy literal hashes into `manifest.json`.

- [ ] **Step 6: Apply and verify reconciliation**

```bash
rtk python3 infra/scripts/reconcile-sprint1-docs.py .
rtk python3 infra/scripts/reconcile-sprint1-docs.py . --check
rtk python3 -B -m unittest infra.scripts.tests.test_reconcile_sprint1_docs -v
```

Expected: first command applies the overlay; second is a no-op; all tests pass.

- [ ] **Step 7: Commit**

```bash
rtk git add AGENTS.md CLAUDE.md docs/dev-guide/DEFINITION_OF_DONE.md \
  infra/scripts/reconcile-sprint1-docs.py infra/scripts/tests/test_reconcile_sprint1_docs.py \
  infra/scripts/overrides/CHG-022
rtk git commit -m "docs(CHG-022): enforce durable agent readiness guidance"
```

### Task 7: Enforce execution-plan binding and completion calibration

**Files:**
- Modify: `docs/dev-guide/WORK_READINESS.md`
- Modify: `scripts/work-readiness/model.mjs`
- Modify: `scripts/work-readiness/git.mjs`
- Modify: `scripts/test-work-readiness.mjs`
- Test: `scripts/test-work-readiness.mjs`

- [ ] **Step 1: Add RED tests for plan drift and completion actuals**

Test that:

- a new implementation plan without `Readiness assessment: docs/readiness/US-123.json` fails;
- a plan estimate larger than its approved assessment fails;
- execution begins for `partition_required` and fails;
- a 45-minute checkpoint can record on-track or variance evidence;
- an incomplete implementation at 90 minutes becomes `partition_required`;
- terminal `done` without actuals fails;
- actual phase totals and variance are recomputed;
- more than one authoritative cold attempt requires an invalidation reason.

- [ ] **Step 2: Run and witness RED**

Run `rtk pnpm test:work-readiness`.

- [ ] **Step 3: Implement plan binding**

Parse only a small required plan header block:

```markdown
**Work item:** US-123
**Readiness assessment:** docs/readiness/US-123.json
**Approved estimate:** 115 minutes
```

Do not parse arbitrary Markdown semantics. Verify exact work ID, normalized
path, and estimate against the approved JSON.

- [ ] **Step 4: Implement checkpoint and actuals enforcement**

Assessments record append-only checkpoint entries. At 90 minutes with
incomplete implementation, the classifier rejects continued implementation
until a new approved partition decision exists. Completed work must record
actuals before its `done` event passes `check-all`.

- [ ] **Step 5: Run focused tests and commit**

```bash
rtk pnpm test:work-readiness
rtk pnpm readiness:check -- CHG-022
rtk git add docs/dev-guide/WORK_READINESS.md docs/dev-guide/DEFINITION_OF_DONE.md \
  scripts/work-readiness scripts/test-work-readiness.mjs
rtk git commit -m "feat(CHG-022): enforce plan budgets and actuals"
```

### Task 8: Record detailed Substrate feedback and provisional CHG-022 actuals

**Files:**
- Modify: `.nous-feedback.jsonl`
- Modify: `docs/readiness/CHG-022.json`
- Modify: `docs/dev-guide/WORK_READINESS.md`

- [ ] **Step 1: Compute actual metrics from Git and execution records**

Use the CHG-022 first/current implementation commit timestamps, diff stat,
commit count, review loops, and test runs. Write exact provisional values into
`actuals`; do not use an estimate or conversational recollection. Task 9
recomputes them after all review fixes.

- [ ] **Step 2: Append detailed Substrate feedback**

Append one canonical event:

```json
{
  "story": "CHG-022",
  "event": "feedback",
  "title": "Substrate: enforce outcome-based work partitioning before agent execution",
  "description": "US-025 required eleven hours, 57 changed files, and 47 commits because an oversized functional story entered execution together with mutation-tool hardening. Its final unchanged warm mutation campaign was 72.86x faster, proving cache performance was not the sizing failure. Substrate should require outcome, boundary, phase-estimate, uncertainty, approval, and partition fields before any US or CHG becomes execution-ready; enforce the same two-hour and cohesion limits; allocate official child IDs with complete parent AC mapping; emit approval provenance and machine-readable readiness artifacts in generated packages; enforce 45/90-minute controls; and learn from actual phase time, changed files, commits, review loops, cold attempts, invalidations, variance, and root causes. Functional and technical changes must use the same gate, with vertical user outcomes for functional work and independently verifiable operational outcomes for technical work. Human overrides must be explicit, reasoned, and auditable.",
  "images": [],
  "pass": true
}
```

The description must include US-025's 11-hour/57-file/47-commit evidence, the
distinction between sizing failure and the 72.86x warm cache, the readiness
schema fields, hard limits, official child-ID workflow, approval provenance,
45/90-minute controls, actuals/calibration fields, and recommendations for
Substrate-generated partitions and further historical optimization.

- [ ] **Step 3: Append AC and verification evidence without terminal events**

Record separate evidence for:

1. oversized US and functional CHG blocking;
2. every-agent/commit/range enforcement;
3. durable generated guidance and Substrate feedback.

- [ ] **Step 4: Validate and commit**

```bash
rtk jq -e . .nous-feedback.jsonl >/dev/null
rtk pnpm test:feedback-order
rtk pnpm test:work-readiness
rtk git diff --check
rtk git add .nous-feedback.jsonl docs/readiness/CHG-022.json docs/dev-guide/WORK_READINESS.md
rtk git commit -m "docs(CHG-022): record readiness and Substrate evidence"
```

### Task 9: Run independent reviews and the full delivery gate

**Files:**
- Modify only when a review finding has a RED reproduction
- Modify last: `.nous-feedback.jsonl`

- [ ] **Step 1: Run focused adversarial checks**

```bash
rtk pnpm test:work-readiness
rtk pnpm readiness:check -- CHG-022
rtk pnpm readiness:check:all
rtk python3 infra/scripts/reconcile-sprint1-docs.py . --check
rtk pnpm test:feedback-order
rtk git diff --check
```

- [ ] **Step 2: Run the full repository gate**

```bash
rtk pnpm check
```

Expected: type-check, lint/reconciliation, all tests, and production build pass.

- [ ] **Step 3: Perform an independent specification review**

The reviewer maps every approved design requirement to implementation and
tests, checks both US and functional CHG fixtures, and attempts to bypass the
gate through docs-only classification, multiple IDs, emergency hook bypass,
historical completion, plan drift, path traversal, and generated guidance.

- [ ] **Step 4: Perform an independent quality/security review**

The reviewer checks command execution, repository containment, bounded output,
symlink behavior, JSON parsing, approval forgery, time/checkpoint arithmetic,
overlay immutability, error clarity, and absence of owned-code mocks.

- [ ] **Step 5: Resolve every finding RED-first and rerun affected gates**

No finding is waived merely because CHG-022 is process tooling.

- [ ] **Step 6: Append terminal evidence bound to the tested implementation SHA**

First recompute CHG-022 actuals from the final implementation range after all
review fixes. Amend `docs/readiness/CHG-022.json` with the exact final phase
times, changed files, commit count, review loops, mutation attempts,
invalidations, variance, and root cause. Rerun `readiness:check` before
appending terminal evidence.

Resolve the tested implementation commit with `rtk git rev-parse HEAD`. Use
`apply_patch` to append three literal JSON lines containing that exact
40-character value: `build_pass` with the readiness/reconciliation/full-gate
results, `verified` with both independent approvals, and `done`. Do not bind
terminal evidence to the later evidence-only commit.

- [ ] **Step 7: Validate and commit terminal evidence**

```bash
rtk pnpm test:feedback-order
rtk pnpm readiness:check -- CHG-022
rtk git diff --check
rtk git add .nous-feedback.jsonl docs/readiness/CHG-022.json
rtk git commit -m "docs(CHG-022): record completion evidence"
```

### Task 10: Prepare integration without disturbing local main state

**Files:** None unless verification exposes a defect.

- [ ] **Step 1: Confirm branch cleanliness and provenance**

```bash
rtk git status --short
rtk git log -1 --oneline
rtk git merge-base HEAD main
```

Expected: clean CHG-022 worktree; branch descends from the main commit that
already contains US-025.

- [ ] **Step 2: Use the finishing-a-development-branch workflow**

Do not merge, push, delete the worktree, or alter the three pre-existing dirty
files in the primary checkout without explicit user choice.
