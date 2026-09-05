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

1. The total estimate exceeds 320 minutes.
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
- have a phase estimate totaling no more than 320 minutes and satisfy every
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
   and `actuals` (plus the legacy, optional `checkpoints`).
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

For each non-bootstrap item, `approved_by` is non-empty and the selected
decision is a `.nous-feedback.jsonl` `decision` event of this shape:

```json
{"story":"US-123","event":"decision","id":"US123-READY","text":"Decision ready for readiness payload SHA-256 <64 lowercase hex>.","reason":"Approved assessment","approved_by":"human identity","subject_work_id":"US-123","relationship":"self"}
```

Every one of those eight fields is required, and each binds something the gate
relies on:

| field | what it binds |
|---|---|
| `text` | the decision (`ready` / `partition_required` / `blocked`) **and the exact digest** — this is the tamper-evidence |
| `approved_by` | the human on record; must equal the artifact's `approval.approved_by` |
| `subject_work_id` | which work item is approved |
| `relationship` | `self`, or `controlling_change` when a CHG approves a story |
| `story`, `id`, `event`, `reason` | ledger identity and the reason on record |

**Ed25519 signing was retired by CHG-034 §1.** There is no `key_id`, no
`signature`, no `WORK_READINESS_APPROVAL_KEYS_JSON` trust map, no key
rotation/revocation policy, and no signing service. That machinery was
separation-of-duties infrastructure for a threat model this project does not
have — one human approver, no adversarial second party — and it never defended
against the failure it was meant to prevent: two unsound estimates (US-056,
US-058) both returned `ready` because the gate compares a *declared* number
against a limit and cannot know the number is wrong.

What still makes a decision tamper-evident is the digest binding, which is
unchanged: `readiness_payload_sha256` is recomputed from the artifact's own
bytes, and a decision naming a stale digest cannot authorize an edited
assessment.

**Historical records stay readable.** The ledger holds 62 `decision` events —
20 carrying the old `key_id`/`signature` fields and 42 without. Both validate:
those two fields are accepted where present and verified nowhere. No re-signing,
no migration, and no old key needs to be retained, because there is no future
signature that could ever need one.

Never commit a private key or trust an agent-authored approval field.

Cross-item approval requires a digest-covered `controlling_change` naming one
exact official CHG, `relationship: "readiness_governance"`, and a reason. The
decision event names the subject and uses `relationship:
"controlling_change"`; otherwise the relationship is `self` and the story
equals the subject. The immutable CHG-022 V2 bootstrap remains a legacy
exception exempt from the `approved_by`/`subject_work_id` binding, and retains
its exact digest, provenance, paths, and expiry.

Assessment/design/feedback-only commits may be made while approval is pending.
Implementation-class changes require every referenced work ID to be approved
and `ready`.

## Generated Nous ownership

Generated Nous paths have exactly two authorization routes:

1. A registered, immutable exact overlay may authorize historical or manual
   reconciliation. The overlay must already be registered in the parent tree
   and bind both the prior generated bytes and the exact desired bytes.
2. An atomic Nous sync envelope is the normal generated-delivery route. The
   candidate commit changes `.nous-provenance.json`, `.nous-project.json`, and
   `.nous-sync.json` together with only the generated paths they describe. The
   three closed-shape documents must agree on project, substrate revision, and
   UTC sync second. The full manifest may retain unchanged entries and other
   categories, but it authorizes changed content only under `docs/stories/`,
   `docs/sprints/`, and `docs/specs/`. Every affected entry must bind the exact
   candidate blob through its SHA-256 prefix and be new or semantically changed
   from the immutable parent manifest; envelope reformatting or timestamp
   changes alone cannot replay an unchanged entry.

The sync provenance is consistency evidence for this repository's single-human
threat model; it is not a cryptographic signature or an independent-party
attestation. A later hand edit, a partial envelope, or a fully present but
internally inconsistent envelope fails closed and cannot reuse an earlier sync.
An affected manifest source is either the reserved non-path category
`generated` or an absolute path containing one unambiguous `/Nous/` segment.
The `generated` category remains candidate-byte-bound and does not name a dirty
source file. For absolute sources, the gate compares the normalized `Nous/...`
path with every canonical declared dirty path. Unrelated substrate dirtiness
is allowed only when those paths are disjoint from every affected absolute
source; an equal, ancestor, descendant, malformed, or otherwise uncomparable
source relationship fails closed.

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

## Task-boundary self-report

There is **no wall clock.** CHG-037 retired the git-timestamp execution anchor and
the mandatory 45- and 90-minute checkpoints, along with the artifact↔feedback
checkpoint bijection.

They were removed because a clock cannot know where a safe stopping point is. The
mechanism fired twice in this project's history, and both times it forced a stop
at a point the task structure did not choose — the 90-minute gate landing mid-task
with later tasks not yet started. A task list knows where the seams are; elapsed
git time does not.

What replaces it is one line added to the implementation-plan contract:

> **If, at any task boundary, you judge that the remaining work will exceed the
> approved estimate, stop there and file a `blocked` or `deviation` feedback event
> before continuing.**

That is the pattern two work items already used by hand, without gate support,
because the clock-based mechanism did not fit what they were doing. It is now the
supported path rather than an improvisation.

`checkpoints` is a **legacy artifact field**: accepted where history already
recorded it, never validated, and not emitted for new artifacts. One artifact
carries two real checkpoint events and stays valid as written.

Mutation evidence is unaffected — `cold_mutation_attempts` and
`mutation_invalidations` remain part of `actuals` below.

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

For a reproducible provisional measurement, bind every metric to named Git
objects and reflog timestamps. Count changed files against the item's approved
authority base and count reachable item commits from its branch point. Raw
reflog amendments are observations, not automatically review-fix loops; count a
loop only when the reviewed-task evidence supports a review-to-fix cycle.
Partition one non-overlapping
wall-clock envelope into phases using recorded boundaries; when focused checks
or integration are interleaved and lack independent timestamps, record zero for
the unobservable bucket and conservatively absorb that time into the enclosing
implementation or review bucket. Document the exact refs, timestamps, rounding
rule, and commands in `root_cause`. Before local reflogs expire, append a closed
provisional measurement-ledger event containing the cutoff, exact object IDs,
ISO-offset timestamps, interval counts, and formulas. That committed event is
the durable evidence snapshot; the raw reflog remains local, mutable-by-Git, and
expirable capture input. These values are explicitly pre-terminal and Task 9
establishes a new cutoff and recomputes them before final verification; they do
not become immutable until the first valid terminal event.

For CHG-022 specifically, `3454e2a..HEAD` is the exact 21-path authority
measurement diff, but it crosses the transition that made the bootstrap
self-binding and is not claimed as a valid range under the subsequently
activated validator. Executable range verification starts at the first exact
binding commit, `72f5e854`.

CHG-022's immutable 21-path bootstrap does not authorize updating the generated
agent mirrors `CODEX.md`, `.cursorrules`, or
`.github/copilot-instructions.md`. Their pre-existing CHG-001 mirror content is
therefore preserved, not represented as CHG-022 delivery. Extending the new
readiness text into those files is deferred and requires a separate approved,
digest-bound change; the bootstrap manifest must not be expanded retroactively.

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
verification, complete dependency ordering, and a total at or below 320
minutes. Those IDs are examples of IDs supplied by Nous, not IDs an agent may
invent; each child still needs its own matching approval and readiness artifact.

**Blocked dependency — implementation prohibited.** `US-124` declares
`US-123` as a `blocked_by` dependency, but `US-123` is not complete. The
decision is `blocked` until the dependency completes and the assessment is
approved again. Separately, a `partition_required` parent may keep proposed
children with local keys and null official IDs; the parent remains
`partition_required`, while each such child stays non-executable until Nous
issues its official ID and its separate readiness artifact is approved.
