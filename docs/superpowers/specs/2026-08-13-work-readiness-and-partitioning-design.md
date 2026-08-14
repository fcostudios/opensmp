# CHG-022 — Work readiness and outcome-based partitioning design

## Status

Approved direction for implementation. This design establishes a blocking,
repository-enforced readiness gate for every new `US-*` and `CHG-*` work item.

## Problem and measured motivation

US-025 took eleven hours from its first implementation commit to terminal
evidence. The first vertical implementation and E2E work took 3 hours 13
minutes. The remainder was dominated by mutation-tool development, repeated
cold campaigns, late review findings, and superseding evidence. The resulting
change spanned 57 files, added about 7,000 lines, and required 47 commits.

This was not a two-hour story. It combined multiple independently demonstrable
outcomes with an unrelated engineering-system change. The existing workflow
had no machine-enforced point at which an agent had to detect that fact, propose
partitions, obtain approval, and stop implementation.

## Goals

1. Block implementation of an oversized or unresolved `US-*` or `CHG-*`.
2. Make the gate independent of the agent, model, plugin, or entry point.
3. Partition by independently valuable outcomes, not by frontend/backend layers.
4. Preserve complete requirement and acceptance-criterion traceability.
5. Keep every approved implementation slice within a two-hour delivery budget.
6. Detect bypass attempts locally and in the repository verification gate.
7. Capture estimate-versus-actual evidence for calibration.
8. Provide detailed, structured feedback that Substrate can adopt upstream.

## Non-goals

- Automatically inventing official Nous work-item identifiers.
- Editing generated sprint queues or story specifications by hand.
- Replacing product prioritization or human approval.
- Treating estimates as promises when a work item is explicitly blocked.
- Grandfathering unfinished work merely because it existed before CHG-022.

## Canonical readiness artifact

Each work item has one JSON document:

`docs/readiness/<WORK-ID>.json`

The document conforms to a committed JSON Schema and contains:

```json
{
  "schema_version": 1,
  "work_id": "US-123",
  "kind": "US",
  "title": "Example outcome",
  "source": "docs/stories/sprint-N/example.md",
  "outcomes": [
    {
      "id": "O1",
      "statement": "A group administrator can perform one demonstrable job",
      "demo": "Observable end-to-end proof"
    }
  ],
  "acceptance_criteria": [
    { "id": "AC1", "outcome_ids": ["O1"] }
  ],
  "scopes": ["server", "ui"],
  "signals": {
    "routes_or_screens": 1,
    "acceptance_flows": 2,
    "expected_changed_files": 12,
    "expected_mutation_shards": 3,
    "lifecycle_or_concurrency_boundaries": 0,
    "external_integrations": 0,
    "schema_or_migration_changes": 0,
    "authorization_or_audit_boundaries": 1,
    "tooling_change": false
  },
  "estimate_minutes": {
    "readiness": 15,
    "implementation": 60,
    "focused_verification": 20,
    "review": 15,
    "integration": 10,
    "total": 120
  },
  "uncertainties": [],
  "dependencies": [],
  "decision": "ready",
  "partitions": [],
  "approval": {
    "status": "approved",
    "approved_by": "user",
    "evidence": "CHG022-READINESS-APPROVAL"
  }
}
```

The schema rejects unknown fields so misspellings cannot silently weaken the
gate. Counts must be non-negative integers. The total must equal the phase sum.
References to outcomes and acceptance criteria must resolve exactly.

## Classification algorithm

The validator produces exactly one decision:

- `ready`: approved and within every hard limit;
- `partition_required`: at least one hard sizing or cohesion limit is exceeded;
- `blocked`: a prerequisite, requirement, identifier, or material uncertainty is
  unresolved.

`ready` is invalid when any condition below is true:

1. total estimate exceeds 120 minutes;
2. more than one primary outcome exists;
3. more than three major technical scopes are touched;
4. more than two routes or screens are changed;
5. more than three independently testable acceptance flows exist;
6. expected changed files exceed 20;
7. more than one lifecycle or concurrency boundary exists;
8. functional delivery and a tooling/framework change are combined;
9. an uncertainty lacks a resolution or explicit estimate impact;
10. the implementation requires an unofficial or unresolved work-item ID.

The rules apply equally to user stories and changes. A functional `CHG-*` is
partitioned by user/business outcomes. A technical `CHG-*` is partitioned by
independently verifiable operational outcomes. The label never exempts the work.

## Partition contract

A `partition_required` assessment contains proposed children. Every child must:

- describe one outcome and one independent demo;
- map all inherited requirements and acceptance criteria;
- declare ordering and dependencies without cycles;
- contain its own phase estimate at or below 120 minutes;
- satisfy the same sizing limits;
- include implementation and verification, rather than being a horizontal
  “frontend only” or “tests later” slice;
- use an official Nous identifier before implementation begins.

All parent acceptance criteria must be covered. Duplicate coverage is allowed
only with an explicit cross-cutting rationale. Orphaned requirements and
unassigned deferred behavior are errors.

The validator may accept proposed local keys during discussion, but the parent
cannot transition to executable children until Nous supplies official IDs and
each child has its own approved readiness artifact.

## Approval and lifecycle

Approval is repository-verifiable rather than a free-form checkbox:

1. The assessment identifies an approval evidence ID.
2. `.nous-feedback.jsonl` contains a matching `decision` event for the same
   work item or controlling CHG.
3. The decision text records `ready`, `partition_required`, or `blocked` and the
   approved child identifiers when applicable.
4. An agent may author an assessment but may not claim user approval without
   the matching event.

Documentation-only assessment commits are permitted before approval. Any
production, migration, runtime configuration, test, or executable-tooling
change requires `ready` approval for every referenced work ID.

## Enforcement layers

### Agent contract

`CLAUDE.md` and `AGENTS.md` receive a short mandatory “Work Readiness Gate”
section. It directs every agent to run the gate before planning or coding.
Because both files are generator-owned, CHG-022 is opened first and the local
override/reconciliation mechanism is updated so the guidance remains durable.

### Canonical guide and schema

- `docs/dev-guide/WORK_READINESS.md` defines the human-readable contract.
- `docs/dev-guide/work-readiness.schema.json` defines the machine contract.
- `docs/readiness/README.md` explains artifact ownership and examples.

### CLI

`scripts/work-readiness.mjs` provides:

- `init <WORK-ID>`: create a deterministic assessment skeleton without
  overwriting an existing file;
- `check <WORK-ID>`: validate one assessment, feedback approval, and decision;
- `check-range <base> [head]`: extract `US-*` and `CHG-*` references from
  commits and changed paths, classify changed files, and enforce readiness;
- `check-all`: validate every committed readiness artifact.

Machine output is stable JSON when `--json` is supplied. Human output identifies
the failed rule and remediation. Missing files, malformed JSON, unknown schema
versions, ambiguous commit IDs, and unavailable base refs fail closed.

### Commit hook

The existing commit-message enforcement calls the readiness validator.

- Assessment/design/feedback-only commits may bootstrap an unapproved item.
- Any implementation-class change requires all referenced IDs to be approved
  `ready` children.
- A commit referencing multiple work IDs must satisfy every ID.
- `--no-verify` is not treated as security; CI and `pnpm check` are backstops.

### Repository gate

Package scripts expose:

- `pnpm readiness:init -- <WORK-ID>`
- `pnpm readiness:check -- <WORK-ID>`
- `pnpm readiness:check:all`
- `pnpm test:work-readiness`

`pnpm check` runs the readiness test and range validator. CI supplies the base
ref explicitly. Locally, the validator uses the feature branch merge base; on
`main`, it validates committed artifacts and the latest non-merge commit.

### Plan contract

Every new design or implementation plan names the readiness artifact, repeats
its approved estimate, and refuses execution when the assessment is
`partition_required` or `blocked`. Plans cannot redefine the estimate upward
without returning to readiness approval.

## Historical and rollout behavior

- Completed work with a valid terminal `done` event before CHG-022 is
  grandfathered.
- Existing unfinished work is assessed before its next implementation commit.
- CHG-022 bootstrap documentation, schema, validator, tests, and guidance are
  explicitly allowed by the policy activation record.
- Generated story queues remain Nous-owned and are never hand-edited.

## Estimate calibration and hard stops

An approved assessment defines checkpoints:

- 45 minutes: compare actual progress with the estimate and record surprises;
- 90 minutes: if production implementation is incomplete, stop and partition;
- before mutation: all focused shards, dry admission, representative cold/warm,
  and mutation-scope review must be green;
- one authoritative cold mutation campaign per stable implementation SHA.

Before terminal `done`, the assessment records actuals:

- elapsed minutes by phase;
- changed file count;
- commit count;
- review-fix loops;
- cold mutation attempts and invalidations;
- estimate variance and its root cause.

Actuals cannot retroactively make an oversized assessment valid. They calibrate
future estimates and create measurable Substrate feedback.

## Anti-bypass requirements

Tests cover at least:

- missing and malformed assessments;
- `ready` above 120 minutes;
- multi-outcome US and functional CHG examples;
- mixed functional/tooling changes;
- incomplete AC mapping and cyclic partitions;
- proposed children without official IDs;
- missing or mismatched approval evidence;
- documentation-only bootstrap allowance;
- implementation commits without readiness;
- multiple work IDs where one is unready;
- historical completed-work grandfathering;
- ambiguous or missing base refs;
- the 45/90-minute checkpoint contract;
- adversarial unknown fields and path traversal.

Tests use real files and Git repositories in temporary directories. They do not
mock project-owned validator logic.

## Substrate feedback contract

CHG-022 appends a detailed `feedback` event recommending that Substrate:

1. require outcome, boundary, estimate, uncertainty, and partition fields before
   marking any US or CHG execution-ready;
2. calculate the same hard-limit decision centrally;
3. allocate official child identifiers and preserve parent requirement mapping;
4. expose approval provenance in generated dev packages;
5. emit a machine-readable readiness artifact with every package generation;
6. track estimate-versus-actual phase metrics and rework causes;
7. distinguish functional, technical, and mixed changes without exempting any;
8. recommend further partitions using historical project evidence;
9. preserve a human override only as an explicit, reasoned, auditable decision;
10. prevent oversized items from entering agent execution queues.

The feedback cites US-025’s measured eleven-hour execution, its 57-file and
47-commit footprint, the 3-hour-13-minute initial feature phase, repeated cold
mutation invalidations, and the final 72.86x unchanged-warm cache result. This
separates story-sizing failure from cache performance and gives Substrate a
concrete improvement target.

## Success criteria

CHG-022 is complete when:

1. both `US-*` and `CHG-*` fixtures are blocked when oversized;
2. a compliant approved item passes every local enforcement entry point;
3. an implementation commit cannot bypass the gate through a different agent;
4. generator-owned guidance contains the durable rule;
5. `pnpm check` remains green;
6. detailed Substrate feedback is append-only and schema-valid;
7. an independent review finds no practical bypass or ambiguous partition rule.
