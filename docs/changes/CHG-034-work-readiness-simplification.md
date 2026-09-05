# Work-readiness gate simplification — design

## Status

Design only. Not yet executed. Filed in `nous.db` as **CHG-034** (`kind:
technical`, per IMP-370) against `fcostudios__smp`; this document is the CHG
body. Execution follows `docs/dev-guide/WORK_READINESS.md`'s own change-control
("a separately approved CHG must...") — CHG-034's readiness assessment is
expected to partition it into one approved child per "What goes" section, in
the rollout order below. This doc does not itself change any enforced behavior.

Numbers below were re-measured on 2026-09-04 against the working tree and
`.nous-feedback.jsonl`. The first draft overstated the line count 3.6× and
attributed the supersession churn to the dual ledger; both are corrected here
(see "Problem and measured motivation" and "What goes" §3).

### Correction log — execution pass, 2026-09-05

The 2026-09-04 figures were re-verified against primary source before any code
was cut. **8,060 lines and 2-checkpoint-events-in-547 confirmed exactly.** The
115-code figure did **not** survive, and neither did two other claims.

**The canonical census, for this whole document** (established by CHG-039, which
found the earlier ones wrong): count the distinct codes **raised by enforcement**
— every `fail()` / `cliError()` call site in `scripts/work-readiness{.mjs,/}`,
with bare codes normalised the way `fail()` normalises them. On that measure the
gate had **113** codes at this CHG's start and has **87** now.

The "115" repeated below came from a different and misleading measurement: a
`WR_`-token grep across `scripts/*.mjs` **plus** the doc and schema, which swept
in `test-work-readiness.mjs` and simultaneously missed the 61 call sites that
spell their code without the prefix. Where 115 appears in the original text
below it is left as written, struck through, so the record of what was believed
stays legible — but 113 → 87 is the number.

| The design said | Primary source says | Consequence |
|---|---|---|
| "30 of the 115 `WR_*` codes (`WR_APPROVAL_ATTESTATION_*`, `WR_APPROVAL_TRUST_*`, `WR_APPROVAL_KEY_*`, `WR_BOOTSTRAP_*`) exist only to run this ceremony" | Those four prefixes total **8** codes, not 30 — and **3 of the 8 are `WR_BOOTSTRAP_*`, which are not signing codes at all**: `WR_BOOTSTRAP_EXPIRED` / `WR_BOOTSTRAP_PATH_UNAUTHORIZED` guard CHG-022's one-time authorization window and path scope (`git.mjs:1177,1193,1213`), and `WR_BOOTSTRAP_CHECKPOINT_DEVIATION_REQUIRED` belongs to the checkpoint clock (§2). | §1 removes **5** codes, not 30: `WR_APPROVAL_ATTESTATION_{INVALID,REQUIRED}`, `WR_APPROVAL_KEY_UNTRUSTED`, `WR_APPROVAL_TRUST_{INVALID,UNAVAILABLE}`. The bootstrap codes **survive** §1; removing them would break the oldest artifact in the set. |
| §1's "the verifier for new decisions simply stops requiring a signature" reads as a flag flip | `validateDecisionRecordShape` (`model.mjs:533-534`) enforces an **exact-length closed key set** — 10 keys when attestation is required, 5 when it is not. The ledger holds **62 decision events: 20 signed (10-key) and 42 legacy (5-key)**. Flipping `requireAttestation` to `false` makes all 20 signed records fail the 5-key exact match with `WR_APPROVAL_EVIDENCE_INVALID`. | §1's replacement must make the 5 attestation keys **optional-but-accepted**, not absent. A flag flip would break every one of the 17 artifacts — precisely what success criterion 3 forbids. |
| 115 codes is the implementation's surface | ~~92 codes are referenced in the implementation; the other 23 appear only in the doc/schema~~ — **this row was itself wrong; CHG-039 corrected it.** The doc and schema name **zero** `WR_*` codes as tokens, at this CHG's start or today. The 23-code gap was a census accidentally globbing `scripts/*.mjs` and picking up the TEST file. Worse: `fail()` prefixes bare codes at throw time, so 61 call sites spelled their code without `WR_`, and every count in this rollout undercounted by 36 — the real set was **113** at the start and is **87** now. | §4's child was re-scoped from "reconcile doc/schema codes" (unsatisfiable — nothing is declared to reconcile) to **normalising the spelling** so the set is countable at all. See CHG-039. |

**Baseline captured before any edit** (`node scripts/work-readiness.mjs check-all`,
with `WORK_READINESS_APPROVAL_KEYS_JSON` provisioned): **all 17 artifacts valid,
exit 0**. That is the oracle every cut below is measured against — same verdict
per artifact, or history broke.

## Problem and measured motivation

The work-readiness gate (CHG-022 and its successors) now spans:

- ~~115 distinct `WR_*` error codes~~ → **113 codes raised by enforcement** (corrected census, §0.1)
- **8,060 lines** across implementation (`scripts/work-readiness.mjs` +
  `scripts/work-readiness/`, 2,775 lines), tests (`scripts/test-work-readiness.mjs`,
  3,989 lines), docs (`docs/dev-guide/WORK_READINESS.md`, 378 lines), and schema
  (`docs/dev-guide/work-readiness.schema.json`, 918 lines)
- Ed25519 cryptographic signing with a key-trust map, rotation/revocation
  policy, and env-provisioned public keys
- Git-timestamp-derived hard checkpoints at 45 and 90 elapsed minutes
- A bijective dual-ledger requiring the readiness artifact's `checkpoints[]`
  to byte-match `.nous-feedback.jsonl` checkpoint records in both directions

Measured cost, from `.nous-feedback.jsonl` (547 events):

- **US-043 was blocked mid-implementation** not by a bad estimate but by the
  90-minute wall-clock gate about to lock, forcing a stop at the Task 2/3
  boundary and a human decision, mid-flow (`event: blocked`, story US-043,
  "the mandatory 90-minute gate... lands ~20:52:46 local, roughly 30 min away,
  with Tasks 3-5 of 5 not yet started").
- **The readiness checkpoint ledger has recorded 2 events in 547** — both
  US-043's wall-clock checkpoints. The log's 95 `evidence_superseded` +
  `revalidated` pairs are NOT readiness churn: their `ref`/`change` fields
  attribute every one of them to acceptance-gate re-implementations under
  CHG-007→CHG-013 (75 of 94 to CHG-007→009 alone, per IMP-369's contractual
  join), and only 7 touch a readiness-era item at all. That churn is a
  separate finding; no cut in this design will move it.
- The gate's own origin (CHG-022's feedback event) asked the substrate to
  "centrally enforce every normal hard limit" after one oversized, mixed-scope
  story (US-025: 11 hours, 57 files, 47 commits) — a single incident generated
  a governance system with no upper bound on its own scope, and it grew
  CHG-by-CHG with no subsequent trim.
- The existing retro (`smp-approval-session-retro-2026-08-15.md`, "The
  systemic finding") already established: **"the gate validates arithmetic,
  not honesty."** Two unsound estimates (US-056, US-058) both returned `ready`
  because the classifier compares the *declared* number against the limit and
  cannot know the number is wrong. Neither the crypto layer nor the checkpoint
  clock catches what the gate exists to catch; a human re-reading source
  during implementation scoping caught both.

Companion pipeline-side fix: `IMP-374` (nous workspace) recalibrates Step 10
story sizing — where `estimate_points` is actually authored and copied into
each story's `Size` row — against a project's execution budget, and adds a
substrate-owned budget-ceiling ready-check over `story_points`. That should
sharply reduce how often this gate's partition path needs to fire at all. This
design is independent of IMP-374 — it simplifies the gate's own machinery
regardless of how often it fires.

## Goals

- Keep every check that has actually caught something, or that closes a real
  gap the retro identified (tamper-evidence, a real human decision on record,
  a partition contract for the residual cases that are still oversized).
- Cut every mechanism that exists because CHG-022's original ask was
  open-ended, not because a specific failure mode demanded it.
- Remove the bijective dual-ledger because it is a second append-only log that
  must byte-agree with the first, in support of a mechanism (the wall clock)
  that has fired twice — not because it drives any measured churn (it does
  not; see above).
- Preserve historical verifiability of the 20 already-signed decision events
  (16 work items, 17 readiness artifacts) without carrying their verification
  machinery forward as a tax on every future item.

## Non-goals

- Not re-litigating any `done`/`verified` story. Validation scope narrows to
  current and future work; nothing here reopens closed work.
- Not solving the sizing-vs-budget mismatch — that's IMP-374's job, on the
  pipeline side.
- Not designing a multi-approver or adversarial-trust model. This project has
  one human approver and no compromised-insider threat model to defend
  against; if that ever changes, that is a new design, not a reversion to this
  one.

## What stays

1. **One canonical readiness artifact per work item**
   (`docs/readiness/<WORK-ID>.json`), validated against a schema. Unchanged
   contract.
2. **Digest recomputed from the artifact's own bytes before any approval
   counts.** `readiness_payload_sha256` computed the same way as today
   (exclude `approval`/`actuals`/`checkpoints`, lexicographic key order,
   canonical JSON, SHA-256). This is the one check that could have caught
   drift across all 14 historical signings, even though it never needed to.
   Kept as-is.
3. **An explicit, recorded human decision before implementation starts.**
   `WORK_READINESS.md:112-115`'s refusal to sign before the human decision
   exists is kept in full — this is the actual epistemic content of the gate,
   not its ceremony.
4. **The vertical-slice partition contract** (one outcome, own demo, full AC
   mapping, no "frontend only/tests later") for the — now rarer, thanks to
   IMP-374 — cases that are still oversized at readiness time. Unchanged.
5. **A budget-ceiling check** (`total estimate > max_readiness_minutes`) as a
   backstop against whatever IMP-374's design-time split misses. Once IMP-374's
   substrate ready-check lands and is enabled for this project, this local copy
   becomes redundant and is a candidate for retirement in a later technical CHG.

## What goes, and why

### 1. Ed25519 signing → plain digest-bound decision record

**Cut:** the full signing ceremony — `approved_by`/`key_id`/`relationship`
Ed25519 attestation, `WORK_READINESS_APPROVAL_KEYS_JSON` trust map, key
rotation/revocation policy, "the repo CLI must never possess the signer"
separation of duties, the append-only-trust-set-forever requirement.

**Why:** this is separation-of-duties infrastructure for a threat model that
does not exist here. There is one human approver and no adversarial second
party the signature is protecting the decision from. It also does not defend
against the thing that actually went wrong (unsound estimates) — the retro
says so directly. Key management is pure overhead: ~~30 of the 115~~ **5 of the 113** `WR_*` codes
(`WR_APPROVAL_ATTESTATION_*`, `WR_APPROVAL_TRUST_*`, `WR_APPROVAL_KEY_*`,
`WR_BOOTSTRAP_*`) exist only to run this ceremony.

**Replacement:** a `.nous-feedback.jsonl` `decision` event carrying
`{story, event: "decision", digest: "<sha256>", decision: "ready" |
"partition_required" | "blocked", approved_by: "<name>"}` — no signature, no
key. The digest binding (item 2 above) still makes the decision tamper-evident
against artifact drift; it is simply no longer additionally attested by an
asymmetric signature nobody is defending against a second party for.

**Historical compatibility:** the 14 existing signed decisions remain valid
history as-is — they are not re-verified going forward, and the verifier for
new decisions simply stops requiring a signature. No migration of old records
is needed; `WORK_READINESS.md`'s "old keys must remain available forever"
requirement is retired because there is no future signature to ever need an
old key for.

### 2. Hard 45/90-minute wall-clock lock → task-boundary self-report

**Cut:** the git-commit-timestamp-derived execution-anchor clock, the
mandatory 45-minute `on_track`/`variance` checkpoint, the mandatory 90-minute
`partition_required` hard stop, `WR_EXECUTION_ANCHOR_MISSING`,
`WR_GIT_TIMESTAMP_REGRESSION`, and the checkpoint-ordering codes.

**Why:** US-043 is the direct evidence — the clock forced a stop at an
arbitrary point (Task 2/3 boundary) that had nothing to do with task
structure, purely because 90 minutes of git-timestamp had elapsed with Tasks
3-5 not yet started. A clock cannot know where a safe stopping point is; a
task list can.

**Replacement:** every implementation plan already has the mandatory
three-line header (work item / readiness path / approved estimate) plus a
task breakdown. Add one line to that contract: *if, at any task boundary, the
agent judges remaining work will exceed the approved estimate, stop there and
file a `blocked` or `deviation` feedback event before continuing* — exactly
the pattern already used successfully for US-002 (external blocker) and
US-043 itself (used this pattern by hand, without gate support, because the
clock-based mechanism didn't fit). This makes explicit and supported what an
agent already had to improvise once.

### 3. Bijective dual-ledger → single ledger

**Cut:** the requirement that artifact-side `checkpoints[]` byte-match
feedback-side checkpoint records in both directions, with strict
`elapsed_minutes` ordering and append-only mutation detection
(`WR_CHECKPOINT_HISTORY_MUTATED`, `WR_FEEDBACK_HISTORY_MUTATED`, and the
matching cardinality-validation codes).

**Why:** the artifact-side `checkpoints[]` exists only to mirror the
wall-clock checkpoints cut in §2, and the whole mechanism has produced 2
feedback events in the project's history (both US-043). Once the clock is gone
there is nothing left for the artifact side to mirror, and the bijection codes
(`WR_CHECKPOINT_HISTORY_MUTATED`, `WR_FEEDBACK_HISTORY_MUTATED`, the
cardinality codes) guard an empty set. The first draft of this design blamed
the dual ledger for the 88% supersession rate; that was wrong — the 95 pairs
are CHG-007→013 acceptance-gate re-implementations with no readiness
involvement (see "Problem and measured motivation"). The cut stands on
simplicity alone.

**Replacement:** `.nous-feedback.jsonl` is already append-only and is the
existing ledger of record for `ac_verify`/`evidence_superseded`/`revalidated`
events. Drop the artifact-side `checkpoints[]` array entirely; the readiness
artifact records only the approved estimate and (per item 5 above) the
budget-ceiling inputs. There is one ledger, not two that must reconcile.

### 4. Fine-grained git-plumbing codes → collapsed

**Cut:** 12+ `WR_GIT_*` variants (`WR_GIT_REF_AMBIGUOUS`, `WR_GIT_REF_INVALID`,
`WR_GIT_ROOT_INVALID`, `WR_GIT_TOPOLOGY_UNSUPPORTED`, etc.) distinguishing
fine shades of "a git command needed by the checker failed."

**Why:** these were substantially in support of the timestamp-derived clock
(item 2). With that clock removed, most git-plumbing failure modes go away
because the checker no longer needs to walk git history to find an execution
anchor — it only needs to read the artifact and the feedback log.

**Replacement:** a single `WR_GIT_ERROR` (message-carrying) for the residual
git operations the checker still performs (e.g. resolving a diff range for
`check-range`, if that command is kept).

## Net expected shape

From ~~115~~ **113** codes / 8,060 lines (2,775 implementation) to an estimated
15–20 codes / low hundreds of implementation lines. This is a design-time
estimate, not a delivery promise — and it was **not met**: see "Rollout — as
executed" for what actually landed (113 → 87 codes, 8,060 → 7,483 lines) and why
the remainder is the artifact contract's own shape-validation vocabulary rather
than ceremony. The actual
number is measured when the technical CHG(s) executing this design land, and
`docs/dev-guide/WORK_READINESS.md` is rewritten to describe only what remains.

## Rollout — as executed

All four children landed 2026-09-05, in the design's order.

**Divergence from the plan below: CHG-035 did NOT land first.** The plan sequences
the budget re-baseline (120 → 320) ahead of this CHG so its children can be
approved "without artificial partition". That was not needed — CHG-034 totals 495
minutes, so it partitions under either budget, and each child was sized under 120
independently. CHG-035 remains `accepted` and unstarted. Had it landed first, the
four children could have been re-partitioned into fewer, larger ones.

| child | scope | codes removed | commit |
|---|---|---:|---|
| **CHG-036** | retire Ed25519 signing | 5 | `fbfbe06` |
| **CHG-037** | retire the wall clock + collapse the dual ledger | 12 | `526b483` |
| **CHG-038** | collapse ten git-plumbing codes into `WR_GIT_ERROR` | 9 net | `ef780ce` |
| **CHG-039** | one code spelling, so the set is countable (re-scoped) | 0 | `3f622fc` |

**Measured** (canonical census per §0.1 — codes raised by enforcement, both
spellings normalised):

| | start | end |
|---|---:|---:|
| codes raised by enforcement | 113 | **87** |
| total subsystem LOC | 8,060 | **7,483** |
| implementation LOC | 2,775 | **2,484** |
| behavioural tests | 188 | **175** |

The "Net expected shape" target above (15–20 codes, low hundreds of
implementation lines) was **not** met, and was not reachable by these four cuts.
Most of the remaining 87 codes are the artifact contract's own shape-validation
vocabulary — `WR_MISSING_PROPERTY`, `WR_INVALID_TYPE`, `WR_UNKNOWN_PROPERTY` and
their kin — not ceremony. What the cuts removed is exactly what the design
identified: signing, the clock, the bijection, and a redundant error taxonomy.
The estimate was made before anyone had counted what the remainder consisted of.

### Original plan

1. **CHG-035 lands first** (budget re-baseline 120 → 320, calibrated by
   IMP-374; filed 2026-09-05) so this CHG's children can be approved without
   artificial partition. CHG-034 is the filed umbrella (`change create --kind
   technical`, 2026-09-04). Its readiness assessment partitions it into one
   approved child per "What goes" section, executed in order —
   signing removal first (self-contained, no dependency on the others),
   then the checkpoint-clock removal, then the dual-ledger collapse, then the
   error-code cleanup (mechanical, does last so it reflects the final code
   shape rather than an intermediate one).
2. Each CHG updates `WORK_READINESS.md`, `work-readiness.schema.json`, and the
   relevant portion of `scripts/work-readiness.mjs` /
   `scripts/work-readiness/` in the same change — doc and enforcement never
   drift from each other mid-rollout.
3. `scripts/test-work-readiness.mjs` loses the tests for every removed code
   path in the same CHG that removes the path — a passing test suite that
   still exercises deleted machinery is exactly the kind of theatre `TESTING.md`
   warns against.
4. No grace period / dual-mode: per the goals, this is a simplification, not a
   migration — there is no reason to run the old and new gates side by side
   once a CHG lands, since the old gate was never catching the thing that
   actually mattered (unsound estimates) in the first place.

## Success criteria

- `WR_*` code count and total readiness-subsystem LOC measured and recorded in
  each CHG's closure evidence, trending down each time.
- No `blocked` feedback event of the US-043 shape (wall-clock-forced stop
  disconnected from task structure) after the checkpoint-clock removal lands.
- Historical decisions (the 20 already-signed decision events across 17
  readiness artifacts) remain readable and their digests remain verifiable; no
  re-signing, no re-validation, no code deleted out from under them before
  confirming nothing currently reads it for verification of *past* work.
