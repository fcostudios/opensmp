# Work Readiness Gate

Every new `US-*` and `CHG-*` must have an approved, machine-valid readiness
artifact before production code, migrations, runtime configuration, tests, or
executable tooling changes begin. The canonical artifact is
`docs/readiness/<WORK-ID>.json`; its contract is
`docs/dev-guide/work-readiness.schema.json`.

The same gate applies to user stories and changes. A functional `CHG-*` is
partitioned by user or business outcomes. A technical `CHG-*` is partitioned
by independently verifiable operational outcomes. Calling work “technical” or
calling it a change does not exempt it. Every parent and proposed child declares
`work_type` as `functional`, `technical`, or `mixed`; mixed work is partitioned
before execution.

## Decisions and hard failures

The validator returns exactly one decision:

- `ready`: a normal item has matching approval evidence and every hard limit is
  satisfied, or the immutable CHG-022 activation payload has its one-time
  digest-bound bootstrap approval;
- `partition_required`: a hard sizing or cohesion limit is exceeded;
- `blocked`: an identifier, prerequisite, requirement, approval, or material
  uncertainty is unresolved.

For every normal work item, a `ready` decision is invalid when any of these
conditions is true. CHG-022's exact, const-bound activation payload is the sole
non-repeatable exception; changing or copying it does not create another one.

1. The total estimate exceeds 120 minutes.
2. More than one primary outcome exists.
3. More than three major technical scopes are touched.
4. More than two routes or screens are changed.
5. More than three independently testable acceptance flows exist.
6. Expected changed files exceed 20.
7. More than one lifecycle or concurrency boundary exists.
8. Functional delivery and a tooling/framework change are combined.
9. An uncertainty lacks a resolution or explicit estimate impact.
10. The implementation requires an unofficial or unresolved work-item ID.

The phase total must equal `readiness + implementation +
focused_verification + review + integration`. Outcome and acceptance-criterion
references must resolve exactly. Missing mappings, duplicate IDs, cyclic
partition dependencies, and unknown fields fail closed.

## Vertical partition contract

Partition by independently valuable, demonstrable outcomes—not by architecture
layers. Every child must:

- have one outcome and an independent demo;
- map its inherited acceptance criteria without orphaning or silently deferring
  behavior;
- declare acyclic ordering and dependencies;
- have a phase estimate totaling no more than 120 minutes and satisfy every
  other hard limit;
- include implementation and verification in one vertical slice, never
  “frontend only,” “backend only,” or “tests later”; and
- carry one stable local `proposal_key`; and
- receive an official Nous `US-*` or `CHG-*` `work_id` and its own approved
  readiness artifact before implementation.

All parent acceptance criteria must be assigned. Duplicate coverage is allowed
only when each affected partition supplies a non-null
`cross_cutting_rationale`. Each proposal also declares `work_type`, full
`signals`, all `uncertainties`, a complete phase estimate, and `depends_on`
proposal keys. A local `proposal_key` with `work_id: null` is valid only while
the parent remains non-executable as `partition_required` or `blocked`. It is
not an official ID and cannot authorize that child. A missing official child ID
does not change a correctly classified parent from `partition_required` to
`blocked`; it only keeps the proposed child non-executable. Agents must never
invent official work IDs; request them from Nous, assign them to the proposals,
and create separately approved child artifacts before any child is executable.

## Approval evidence

Approval is digest-bound evidence, not a checkbox. Compute
`readiness_payload_sha256` from the readiness payload as follows:

1. From the top-level artifact, exclude `readiness_payload_sha256`, `approval`,
   `actuals`, and `checkpoints`.
2. Recursively order every object's keys lexicographically. Preserve array
   order exactly.
3. Serialize that value with JavaScript `JSON.stringify`, encode the result as
   UTF-8, and compute its lowercase SHA-256 hexadecimal digest.

`approval.payload_sha256` must exactly equal `readiness_payload_sha256`. The
matching `.nous-feedback.jsonl` `decision` event named by `approval.evidence`
must identify the same work item or controlling CHG, the exact digest, and the
decision `ready`, `partition_required`, or `blocked`, plus approved official
child IDs when applicable. A decision for an older digest cannot be replayed
after an assessment edit. An agent may author an assessment but cannot claim
user approval without matching digest-bound evidence.

Assessment/design/feedback-only commits may be made while approval is pending.
Implementation-class changes require every referenced work ID to be approved
and `ready`.

## Implementation-plan binding

After CHG-022 activation, every new implementation plan begins at byte zero
with this exact, contiguous, singleton three-line header (substitute the
approved item values):

```markdown
**Work item:** US-123
**Readiness assessment:** docs/readiness/US-123.json
**Approved estimate:** 100 minutes
```

No BOM, leading whitespace/prose, duplicate metadata key, second metadata
block, or extra metadata header line is permitted. The work ID must match the plan's owned work ID, the path must be the canonical
normalized `docs/readiness/<WORK-ID>.json` path, and the plan estimate may not
exceed the artifact's approved total. The repository gate parses only this
small header block; it does not infer arbitrary Markdown semantics. A normal
implementation commit requires one previously committed, readiness-bound plan.
Generated sprint plans and story specifications remain documentation-class and
Nous-owned, but that classification does not exempt an implementation plan from
this binding before code starts.

## Checkpoints and mutation evidence

- At 45 elapsed minutes, compare progress with the approved phase estimate and
  append an `on_track` or `variance` checkpoint with evidence.
- At 90 elapsed minutes, if production implementation is incomplete, stop and
  append a `partition_required` checkpoint and return to outcome partitioning
  and approval.
- Before mutation, focused shards, dry admission, representative cold/warm
  checks, and mutation-scope review must be green.
- Run one authoritative cold mutation campaign per stable implementation SHA.
  A source change invalidates that SHA's campaign; stabilize again before the
  next authoritative cold run.

An estimate cannot be raised in a plan or during implementation. New scope,
missed boundaries, or a forecast above the approved limits returns the item to
readiness review.

Checkpoint entries are append-only, strictly ordered by `elapsed_minutes`, and
must have one exact canonical appended feedback record carrying the same
status, completion flag, and evidence in the same commit. The mapping is
bijective: artifact-only or feedback-only records, duplicates, rewrites,
deletions, and reorderings fail even in documentation-only commits. Once an
incomplete execution records elapsed time at or beyond 45 minutes, its first
checkpoint must be the exact 45-minute `on_track` or `variance` control. At 90
minutes, the latest incomplete checkpoint must be exactly 90 minutes with
`partition_required`; the classifier then returns `partition_required` and
continued implementation remains blocked until the work is partitioned and
approved under executable readiness artifacts. Work completed before a
milestone does not invent a checkpoint merely to satisfy the clock.
Checkpoint completion is determined by its explicit `implementation_complete`
boolean; provisional or mutable actual phase minutes never override `false`.
Only a valid effective terminal with complete actuals can supersede a prior
checkpoint stop once execution is no longer active.

Current-state validation also enforces this bijection in both directions: each
artifact checkpoint has exactly one canonical feedback checkpoint and each
canonical feedback checkpoint has exactly one artifact entry.
Every same-story `checkpoint` feedback record is validated before cardinality;
extra or missing fields, wrong types, invalid states, and empty evidence fail
closed instead of being filtered out.

## Actuals and calibration

`actuals` may be `null` while work is in progress. Before the terminal `done`
event, replace it with the closed actuals object and record:

- `phase_minutes` for readiness, implementation, focused verification, review,
  and integration;
- `total`, `changed_files`, `commits`, and `review_fix_loops`;
- `cold_mutation_attempts` and `mutation_invalidations`; and
- `estimate_variance_minutes` and a `root_cause`.

Actuals calibrate future estimates; they never retroactively legalize an
oversized assessment.

At completion the validator recomputes `total` from the five phase values and
recomputes variance as `actual total - approved estimate`; declared arithmetic
is never trusted. More than one authoritative cold attempt requires exactly one
pre-terminal `mutation_invalidation` reason for every invalidated attempt.
Zero cold mutation attempts are permitted only when the approved assessment has
`expected_mutation_shards: 0`; otherwise at least one authoritative cold
campaign is required. Provisional actuals remain mutable before terminal
completion. The first effective terminal requires complete valid actuals, and
after it those actuals are immutable—deletion, rewriting, or recalibration is
rejected even in documentation-only commits.

## Historical and activation policy

Completed work with a valid terminal `done` event before CHG-022 is
grandfathered only for implementation commits that also precede the exact V2
activation marker. Once that marker exists in a commit's parent history, every
new implementation commit requires a current approved artifact and bound plan,
even when its work ID completed before activation. Existing unfinished work is
not grandfathered and must pass this gate before its next implementation
commit.

CHG-022 is the single, immutable, non-repeatable activation bootstrap. Its
technical work honestly estimates 360 minutes, exceeds the file and outcome
limits, and has no official child items because a gate cannot require its own
not-yet-existing gate to allocate and approve those children. Its `ready`
decision is therefore authorized only by `policy_bootstrap: true`, the
digest-bound `CHG022-READINESS-V2-APPROVAL` decision, and the closed
`bootstrap_authorization` object tied to the approved design and plan commits.
This is not normal two-hour compliance.

The bootstrap authorizes only the ordered exact `allowed_paths` manifest in the
CHG-022 artifact. A changed path outside that manifest is rejected. Any later
scope or readiness-content change alters the canonical digest and requires a
new explicit approval; it never silently inherits the activation approval.
No other item may set the bootstrap flag, reuse its rationale, copy its
authorization, or claim a similar exception. Later CHG-022 functional expansion
must use the normal gate and official child workflow.

The one-time bootstrap interval begins at the matching digest-bound V2 approval
decision in `.nous-feedback.jsonl` and ends at CHG-022's first valid terminal
`done` event, as declared by `bootstrap_authorization.expires_on_event`. The
validator must reject every later CHG-022 implementation commit; neither the
same payload nor any old approval can reopen or reuse the expired bootstrap.

Generated sprint plans and story specifications remain Nous-owned and must not
be hand-edited to create, rename, repartition, or approve work.

## Commands

Create an artifact without overwriting an existing one:

```bash
pnpm readiness:init -- <WORK-ID>
```

Validate one item, all artifacts, the test suite, or the current change range:

```bash
pnpm readiness:check -- <WORK-ID>
pnpm readiness:check:all
pnpm test:work-readiness
pnpm check
node scripts/work-readiness.mjs check-range <base> [head]
```

Use stable JSON output for automation:

```bash
node scripts/work-readiness.mjs check <WORK-ID> --json
node scripts/work-readiness.mjs check-all --json
node scripts/work-readiness.mjs check-range <base> [head] --json
```

The range check fails closed for missing or malformed artifacts, unknown schema
versions, unavailable or ambiguous base refs, missing approval evidence, and
unready referenced IDs. `--no-verify` is not an exemption; `pnpm check` and CI
enforce the same contract.

## Decision examples

**Ready US — implementation permitted.** An approved `US-123` has one primary
outcome, two scopes, one route, two acceptance flows, 12 expected files, a
110-minute phase sum, no unresolved uncertainty, empty partitions, and matching
decision evidence. Its decision is `ready`, so implementation may begin within
the approved scope and estimate.

**Oversized functional CHG — partition required.** A functional `CHG-123` has
two independent business outcomes or 24 expected files. Its decision is
`partition_required`, so implementation is not permitted. A valid proposal
maps all acceptance criteria into vertical children such as official Nous IDs
`CHG-124` and `CHG-125`, each with an independent demo, implementation and
verification, complete dependency ordering, and a total at or below 120
minutes. Those IDs are examples of IDs supplied by Nous, not IDs an agent may
invent; each child still needs its own matching approval and readiness artifact.

**Blocked dependency — implementation prohibited.** `US-124` declares
`US-123` as a `blocked_by` dependency, but `US-123` is not complete. The
decision is `blocked` until the dependency completes and the assessment is
approved again. Separately, a `partition_required` parent may keep proposed
children with local keys and null official IDs; the parent remains
`partition_required`, while each such child stays non-executable until Nous
issues its official ID and its separate readiness artifact is approved.
