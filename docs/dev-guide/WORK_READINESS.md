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

### Per-task mutation previews

Every implementation task in a new plan must name the production sources it
touches. After that task's focused tests are green, run ordinary mutation
preflight against its committed candidate, intersect the returned shards'
`sources` with the named production sources, and preview every intersecting
shard once with its exact post-task ID:

```bash
MUTATION_SHARD=<post-task-shard-id> pnpm test:mutation
```

Shard IDs are discovered after the task and are never hardcoded in the plan.
Repair every genuine survivor, but a survivor found by a preview joins the next
fix round rather than opening one; that round re-previews it. When no shard
intersects, record zero previews for the task and proceed.

**Budget: one round per task plus one final (CHG-069).** A child gets one
preview round per implementation task, after that task's focused tests are
green, plus one round after the final fix wave: `tasks + 1` rounds, targeting at
most 30 `preview_minutes`. A round beyond `tasks + 1`, or minutes beyond 30,
needs a named reason in the closure's `root_cause`, the same convention as a
whole-set re-preview below.

**Slow shards once.** A shard whose last run exceeded 5 minutes (the
database-backed and static-schema shards) is previewed once per child, in the
final round, unless a fix touched its `sources`. This is the one exception to
previewing every intersecting shard after its task.

**A routing gap is not a clean result.** When preflight prints a
`routing_gaps` entry (for example a migration in the diff with no real-DB
integration oracle for the schema-static shard), that shard's preview cannot
measure the declared change: a 0-of-N score from it is not evidence. Add or
touch the oracle, or name the gap in `root_cause`.

**A fix round re-previews only the shards it touched.** After a repair, list
the files changed since the previous preview (`git diff --name-only
<previous-preview-commit>`), rerun preflight, and preview only the shards whose
`sources` intersect that list. Shards whose sources did not change keep their
previous result. Re-previewing the whole set needs a named reason — for example
a changed shared fixture, test helper, or config every shard imports — written
in the closure's `root_cause`. A preview round is one preflight plus the
shard previews it selects, after a task or after a fix round. Record the number
of rounds as `actuals.preview_rounds` and their summed wall-clock minutes as
`actuals.preview_minutes`.

**A survivor annotation is one line.** Each survivor that is not killed gets
exactly one line in the `test_report`'s `surviving_annotated`:

```text
<mutant-id> <file>:<line> @equivalent: <reason>
<mutant-id> <file>:<line> @accepted: <reason>
```

`@equivalent:` means no test can tell the mutant from the original.
`@accepted:` is the narrow exception to "repair every genuine survivor": the
mutant is observable, but the reviewer agreed a test would not be worth it, and
the reason says why. The reviewer's sign-off that TESTING.md requires is their
review verdict on those lines. Do not write a separate signed equivalence
report or a counterfactual log. A survivor that gets killed needs no
annotation: the test that kills it is the proof.

These previews are non-authoritative: they do not clear the authoritative
cache, emit no `test_report` or mutation-performance evidence, and never
replace adversarial verification, `pnpm check`, or the one final cache-cleared,
diff-scoped cold campaign described below.

### Partition-child design inheritance

A canonical partition child may omit its own design document only when all four
conditions hold:

1. The parent partition and the official child ID are approved.
2. An approved parent design, or an approved delivery-plan design section,
   explicitly covers the child's allocated acceptance criteria, outcome, stable
   interfaces, tenant and authorization boundary, lifecycle or concurrency
   boundary, non-goals, and verification strategy.
3. The child readiness assessment cites those parent artifacts and introduces
   no unresolved material uncertainty or scope outside them.
4. The child implementation plan cites the exact parent artifact path and
   section as its `Spec` authority.

Otherwise, the child follows the normal readiness → design → plan sequence.
Inheritance is not a waiver: the child plan still contains complete executable
detail.

For US-065 and US-066, the inherited parent-design authority is the approved
US-019 partition in `docs/readiness/US-019.json`, the canonical child allocation
in DEC-SMP-021/CHG-054, their generated stories, and the US-019 section of
`docs/superpowers/plans/2026-08-02-sprint-3-delivery.md`. Each child plan's
`Spec` field must cite that authority; otherwise it requires a child design.

## Session shape

How a session runs is the largest lever on what a work item costs (CHG-065,
measured on US-067..069 and US-021).

- **One controller session per work item.** Open it at readiness and close it
  at that item's `done`. Do not carry a controller across items: the next item
  starts a fresh session from its readiness artifact, plan, and
  `.nous-feedback.jsonl`. The checkpoint and idle restarts in CLAUDE.md's agent
  session contract still apply: the restarted session resumes the same item
  from those files and is still that item's controller.
- **The controller plans, briefs, and reviews the reviewer's findings; it does
  not run the verification in its own context.** Brief a reviewer (a subagent
  or a fresh session) for adversarial AC verification and for each scoped
  review, giving it the AC list, the diff range, and the commands. The
  controller decides on the findings and records the verdicts as `ac_verify`
  events.
- **Never poll at 1 s.** Wait for a background gate, preview, or campaign with
  a blocking wait or a yield of 60 s or more. Each wake re-sends the whole
  context, so a 1 s poll loop is the most expensive way to wait.
- **Previews do not block the critical path (CHG-069).** Launch a task's
  preview round in the background, start the next task's RED/GREEN, and
  collect the round at that next task's review boundary. The final round is
  collected before adversarial verification.
- **Mark the boundaries.** Emit a `phase` event when entering
  `implementation`, `focused_verification`, `review`, and `integration`.

## Actuals and calibration

### Estimate calibration

Calibration is opt-in: before execution evidence, authors may run:

```bash
pnpm readiness:calibrate -- WORK-ID
```

It recalculates review with `Math.ceil(implementation * 65 / 28)`, recomputes
the phase total, and resets the artifact's digest-bound approval to pending.
Calibration is optional and resets approval; it requires a new human
digest-bound decision before execution. Authors may instead manually override
phase estimates before approval; validation does not require the 65/28 ratio.

### Authoritative cold campaign

Run `pnpm mutation:preflight` as part of `pnpm check` before the authoritative
campaign. The preflight performs diff routing and validates accountable tests,
database runtime profiles/templates, exact zero-mutant seams, adapter/config
inputs, and the calculated shard count without starting Stryker or writing
authoritative mutation-performance evidence. Set `MUTATION_WORK_ID=US-NNN` (or
`CHG-NNN`) when comparing that count with an approved artifact. A mismatch is
reported, never rejected: append a timestamped `deviation` event and record the
observed count as `actuals.mutation_shards_actual`; do not edit the approved
readiness payload.

For a non-authoritative implementation preview, set `MUTATION_SHARD` to one
exact shard id printed by preflight. A preview never emits `test_report` and
never substitutes for the complete campaign.

An authoritative cold campaign is one cache-cleared, diff-scoped mutation run:

```bash
pnpm mutation:cache:clear
MUTATION_BASE=<approved-authority-base> pnpm test:mutation
```

Run it once after adversarial review and every resulting repair is committed.
Record only evidence and terminal closure after this task; any implementation commit after this task invalidates it.
`pnpm test:mutation:core` is authoritative
only for a CHG that changes the effectiveness-critical set; ordinary stories and
changes use the diff-scoped runner above.

### Actuals

`actuals` may be `null` while work is in progress. Before the terminal `done`
event, replace it with the closed actuals object and record:

- `phase_minutes` for readiness, implementation, focused verification, review,
  and integration;
- `total`, `changed_files`, `commits`, and `review_fix_loops`;
- `cold_mutation_attempts` and `mutation_invalidations`; and
- optional `mutation_minutes`; and
- optional `mutation_shards_actual`, the non-negative count calculated by the
  final preflight/campaign; and
- optional `preview_rounds` and `preview_minutes`: the number of
  non-authoritative preview runs and their summed wall-clock minutes; and
- `estimate_variance_minutes` and a `root_cause`.

Actuals calibrate future estimates; they never retroactively legalize an
oversized assessment.

After the final campaign, commit readiness actuals and all append-only feedback
events together as one evidence commit. Those events are the detailed record;
do not create one documentation commit per event.

When present, `mutation_minutes` is the summed wall-clock time of retained and
invalidated authoritative cold campaigns. It is optional so historical artifacts
remain valid without it. `mutation_minutes` is not added to phase totals: the
campaign time is already accounted for in the phase where it occurred, so adding
it to `total` would double-count time.

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

### Closure template

Close every work item with this shape. Like `mutation_minutes`,
`preview_minutes` is not added to the phase totals.

```json
"actuals": {
  "phase_minutes": {"readiness": 0, "implementation": 0, "focused_verification": 0, "review": 0, "integration": 0},
  "total": 0, "changed_files": 0, "commits": 0, "review_fix_loops": 0,
  "cold_mutation_attempts": 0, "mutation_invalidations": 0,
  "mutation_minutes": 0, "mutation_shards_actual": 0,
  "preview_rounds": 0, "preview_minutes": 0,
  "estimate_variance_minutes": 0,
  "root_cause": "Phase boundaries from the phase markers; name the reason for any whole-set re-preview, any preview round beyond tasks + 1, preview_minutes above 30, and any gate run above 2x the median wall time."
}
```

A gate run (`pnpm check`, a preview, or a campaign) whose wall time exceeds
twice the median of that gate's recent runs is recorded in `root_cause` with
its cause (host sleep, a cold cache, an image pull), so lost time is not read as
verification cost.

```jsonl
{"story":"US-123","event":"test_report","mutation_score":92.3,"scope":"diff","killed":12,"survived":1,"surviving_annotated":["mutant41 packages/domain/src/x.ts:88 @equivalent: the caller already clamps the loop bound"],"mutation_wallclock_s":600}
{"story":"US-123","event":"feedback","title":"done.cost provenance","description":"done.cost below is measured from the harness transcript.","images":[],"ts":"<iso>"}
{"story":"US-123","event":"done","source_commit":"<sha>","ts":"<iso>","cost":{"calls":120,"context_tokens":240000,"output_tokens":38000,"model":"<model-id>","window":1000000}}
```

The substrate contract keeps `cost` optional, but this project's closure
requires it on every `done`, with `calls`, `context_tokens`, `output_tokens`,
`model`, and `window`. Neither `cost` nor `done` accepts any other key (the
gate's `validDone` and the delivered DoD are closed), so the sentence saying
whether the numbers are measured (read from the harness transcript or usage
report) or estimated goes in a `feedback` annotation emitted just before
`done`. The `integration` phase marker stays at the start of integration.
Omit `test_report` when the work has zero mutation
shards.

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

Run a local gate with the host kept awake, so a sleep cannot stretch it (US-070
lost 997 s of one `pnpm check` to a host thermal sleep):

```bash
caffeinate -i pnpm check                        # macOS
systemd-inhibit --what=idle:sleep pnpm check    # Linux
```

Wrap previews and campaigns the same way (`caffeinate -i pnpm test:mutation`).
CI runners need no wrapper, and `scripts.check` stays wrapper-free.

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

## Tenant additions carried from emitted docs (2026-09-06)

These sections were authored by the smp team inside substrate-emitted files
(`DEFINITION_OF_DONE.md`, `FEEDBACK.md`). Those files were refreshed to the
current substrate emission on 2026-09-06 (IMP-386 `adopt --refresh`) so the
corrected Definition of Done (IMP-369/387) and the feedback contract (IMP-375/385/387)
reach this package. The tenant content lives here, in a tenant-owned file, until
IMP-393 gives emitted docs a `docs/dev-guide/local/` extension seam. Source:
`git show 20ba335:docs/dev-guide/DEFINITION_OF_DONE.md` and `…/FEEDBACK.md`.

The seven trailer-bearing agent documents (`.cursorrules`,
`.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`,
`docs/dev-guide/SECURITY.md`, and `docs/dev-guide/STANDARDS.md`) remain
diverged-protected until IMP-393 lands; interim tenant guidance belongs in
tenant-owned files such as this one.

### Additional tenant Definition-of-Done gates (after emitted step 7, before emitted step 8)

Run these tenant gates after emitted step 7's adversarial verification and every
resulting fix, but before emitted step 8's final mutation campaign; emitted step
9 remains the terminal lifecycle `done` event. Emitted step 5's
`drizzle-kit push` is the bootstrap/schema-setup check; tenant gate T1's
committed-migration apply, verification, and parity checks are the release/runtime
acceptance gate.

**T1 — Committed migrations apply on a fresh database (and parity is verified):**
   - **Prerequisite:** `DATABASE_ADMIN_URL` connects as `ledger_owner` and has
     permission to create the two disposable parity databases. `DATABASE_URL`
     connects as the lower-privilege `ledger_app` for runtime grant checks.
   ```bash
   pnpm --filter @smp/db db:migrate
   pnpm --filter @smp/db db:verify
   pnpm --filter @smp/db db:parity
   ```
   - `db:migrate` applies only sorted, committed `V<timestamp>__<slug>.sql` files,
     under the migration advisory lock, and rejects changed checksums.
   - `db:verify` verifies the migration ledger and the committed integrity objects.
   - `db:parity` compares committed migrations with a fresh `drizzle-kit push`
     across tables, columns, normalized types, nullability, and foreign keys.
   - Once applied, a migration file is immutable — add a new one; never edit it.
   - The release path applies committed migrations using the `ledger_owner`
     connection. It then starts the application using the lower-privilege
     `ledger_app` connection; application runtime must not use the owner role.

**T2 — Authentication evidence passes for US-004:**
   - Auth.js redirects OIDC to Keycloak; Ledger renders no password or TOTP
     fields.
   - Keycloak realm event retention is configured, and an integration or
     operational verification proves an authorized operator can query retained
     password/TOTP failure events.
   - Ledger `AuditLog` contains only the OIDC/session linking, callback, and
     authorization outcomes Ledger observes; no Keycloak-event ingestion
     adapter is required in Sprint 1.
   - The Keycloak admin-service seam is tested for `platform-admin`
     synchronization; the complete user-management UI remains US-011.

**T3 — R1 deployment target is verified for release/infrastructure stories:**
   Docker Compose on a VPS (or an equivalent CI Compose environment) starts
   the Next.js app and declared infrastructure services with health checks
   passing.

### Append-only evidence correction

Never edit an earlier evidence record to make its chronology look newer. Append
`evidence_superseded` with a unique `ref` and a `target` containing `story`,
`event`, and `ac` when the target is an AC. The target must identify exactly one
earlier event. Then append exactly one `revalidated` record using that `ref`
after both the supersession and a `decision` on the named `change`.

To supersede evidence that was itself projected by an earlier revalidation,
use `target: {"ref":"THE-EARLIER-REVALIDATION-REF"}`. The referenced
revalidation must exist uniquely, precede the new supersession, and not already
be superseded.

The validator projects the revalidation as `as_event`; the superseded raw
record remains audit history but is excluded from the canonical lifecycle.
Superseded build and terminal evidence must therefore be revalidated in order:
replacement `build_pass`, then replacement terminal event. Missing, duplicate,
ambiguous, out-of-order, or event-kind-mismatched references fail closed.
