# CHG-059 Append-Only Completion Actuals Correction Design

## Problem

CHG-058 completed with valid source, review, mutation, and terminal evidence, but
its completion artifact records `changed_files: 11`. The value came from piping
RTK's human-formatted `git diff --name-only` display into `wc -l`; raw
NUL-delimited Git output proves the immutable source cutoff changes eight unique
tracked paths. The same record calls the authority-base commit timestamp the
branch-creation timestamp. The corrected branch-creation timestamp changes the
interval from 898 to 875 seconds, but both round to 15 minutes, so total time and
variance remain 125 and -175.

The gate correctly rejects editing completion actuals after the first effective
terminal. Rewriting the evidence commit would erase audit provenance after the
events were already pulled into Nous. Existing `evidence_superseded` and
`revalidated` records project lifecycle evidence, but cannot replace the
readiness `actuals` object used by reconciliation and future estimation.

## Outcome

Introduce one canonical, append-only `actuals_corrected` feedback event. The raw
readiness actuals and terminal event remain immutable. Every consumer resolves a
single effective actuals value by folding a validated hash chain over the raw
object, and displays the correction provenance rather than pretending the first
measurement never existed.

CHG-058 receives one correction: `changed_files` becomes 8 and `root_cause`
accurately names the authority-base commit or the 07:49:43 branch-creation
reflog boundary. All other fields remain unchanged; no mutation campaign is
repeated.

## Ownership and delivery order

Nous owns the canonical event name, JSON schema, vocabulary emission, package
ingestion, database annotation payload, timeline reconciliation, and calibration
projection. Ledger owns the readiness validator, Git transition enforcement,
and the concrete CHG-058 correction event.

Delivery is ordered:

1. Nous defines and tests the canonical event and effective-actuals resolver.
2. Nous emits the refreshed vocabulary and correction guidance to Ledger.
3. Ledger registers the delivery without hand-editing generated guidance.
4. Ledger implements the matching validator projection and appends the CHG-058
   correction.
5. Pulling Ledger feedback into Nous proves the database, timeline, and
   recalibration surfaces resolve the same effective value.

The tenant must not emit an unknown local event or modify
`docs/dev-guide/feedback-vocabulary.json` by hand while step 1 is pending.

## Canonical event

The event is an annotation with this closed shape:

```json
{
  "story": "CHG-058",
  "event": "actuals_corrected",
  "ref": "CHG058-ACTUALS-1",
  "change": "CHG-059",
  "target_actuals_sha256": "<64 lowercase hex>",
  "replacement_actuals": {
    "phase_minutes": {
      "readiness": 15,
      "implementation": 58,
      "focused_verification": 0,
      "review": 38,
      "integration": 14
    },
    "total": 125,
    "changed_files": 8,
    "commits": 10,
    "review_fix_loops": 4,
    "cold_mutation_attempts": 1,
    "mutation_invalidations": 0,
    "mutation_minutes": 0,
    "mutation_shards_actual": 0,
    "estimate_variance_minutes": -175,
    "root_cause": "<corrected reproducible measurement narrative>"
  },
  "reason": "The prior count included RTK display lines; raw NUL-delimited Git reports eight unique paths.",
  "evidence": [
    "rtk proxy git diff --name-only -z authority/chg-058-base..720139931458b1cf5a59df781bd02ce03586a3fe",
    "rtk proxy git reflog show --date=iso-strict feature/tooling/chg-058-faster-child-mutation"
  ],
  "ts": "<ISO-8601 UTC>"
}
```

Required invariants:

- `story` is one completed `US-*` or `CHG-*`; `change` is one `CHG-*` with a
  prior decision event.
- `ref` is globally unique and non-empty.
- `target_actuals_sha256` is the canonical recursive-key-sorted JSON SHA-256 of
  the currently effective complete actuals immediately before this record.
- `replacement_actuals` is a complete closed actuals object and passes the same
  arithmetic, cold-attempt, invalidation, and evidence checks as terminal
  actuals.
- `reason` is non-empty; `evidence` is a non-empty array of non-empty command or
  primary-source descriptions; `ts` is valid UTC and later than the terminal or
  preceding correction.
- The event changes no readiness approval digest. Approval binds execution
  scope; completion measurement corrections are separately authorized by the
  named correcting CHG decision.

## Effective-actuals resolution

Start with the immutable raw readiness `actuals`. Select
`actuals_corrected` records for the same work item in append order. For each
record:

1. Require the work item already has an effective terminal and complete raw
   actuals.
2. Require a prior valid decision whose `story` equals `change`.
3. Reject a duplicate `ref` anywhere in the feedback ledger.
4. Hash the current effective actuals and compare it exactly with
   `target_actuals_sha256`.
5. Validate the full replacement actuals against the original assessment and
   lifecycle evidence.
6. Make the replacement the next effective value while retaining the complete
   chain as provenance.

This optimistic hash chain rejects stale, reordered, forked, replayed, or
silently retargeted corrections. Multiple corrections are allowed only as one
linear chain; a second correction targets the first replacement's hash.

## Tenant enforcement

Ledger adds one pure resolver shared by assessment validation and Git-range
validation. Raw `actuals` remain byte-for-byte immutable after terminal
completion. Appending a correction is permitted only when the event passes the
closed shape and chain rules; changing or deleting the raw object still raises
`WR_ACTUALS_IMMUTABLE`.

The Git transition validates every work item mentioned by an appended
`actuals_corrected` event, even when its readiness JSON did not change. It
rejects corrections appended before terminal completion, corrections without a
named decision, target-hash mismatches, invalid replacement arithmetic,
duplicate refs, and replacement campaign counts inconsistent with retained
feedback evidence.

`validateCompletionActuals` returns both raw and effective values so callers do
not accidentally recalibrate from the raw object. Existing artifacts without a
correction retain byte-identical behavior.

## Nous ingestion and consumers

Nous adds `actuals_corrected` to the canonical annotation vocabulary and uses a
closed event-family schema matching this design. Package pull persists the full
validated event payload as an annotation and preserves `ts` for the execution
axis.

One pure resolver implements the same canonical JSON hash and fold semantics.
Timeline `--target` reads the tenant artifact plus correction transport, prints
both raw and effective actuals when they differ, identifies every correction
`ref` and `change`, and reconciles against the effective values.

Any estimator or recalibrator that reads readiness actuals must call this
resolver. Ledger-time calibration derived solely from `started`/`done` database
timestamps remains unchanged, but target-package actuals and future
changed-file/shard calibration must never read the raw object directly.

Unknown, malformed, or unvalidated correction events are named exclusions, not
zero values and not silently ignored successful corrections.

## CHG-058 correction

The first correction targets the SHA-256 of the exact raw CHG-058 actuals in
commit `4901d3b472028c2fb572e53142ccb908aba029a2`. Its replacement changes only:

- `changed_files`: 11 to 8; and
- `root_cause`: the changed-file command uses raw NUL-delimited Git and the
  timing language either calls 07:49:20 the authority-base plan commit or uses
  the actual branch creation at 07:49:43 with 875 seconds.

The effective total remains 125, variance remains -175, commits remain 10, the
one cold campaign remains retained, and no source/test commit follows the tested
cutoff `720139931458b1cf5a59df781bd02ce03586a3fe`.

## Failure handling

- A malformed or unauthorized correction fails before projection and leaves the
  prior effective actuals intact.
- A consumer that cannot load the correction schema or transport reports a
  named exclusion; it does not guess from prose.
- Partial cross-system delivery does not authorize emission: Ledger waits for
  the Nous vocabulary/schema delivery before appending the first event.
- Corrections never reopen implementation, invalidate a campaign, or create a
  second terminal lifecycle event.

## Verification

Tests use real feedback/readiness files and pure owned resolvers, not source-text
assertions or mocked owned modules. Required adversarial cases are:

- one valid CHG-058 correction resolves 11 to 8 while raw bytes stay unchanged;
- stale target hash, forged target hash, duplicate ref, duplicate/fork target,
  out-of-order timestamp, missing correcting decision, wrong story/change,
  pre-terminal correction, partial actuals, bad arithmetic, and campaign-count
  mismatch all fail closed;
- two valid sequential corrections form one chain and a correction targeting
  the raw hash after the first replacement is rejected;
- existing uncorrected histories retain current validation behavior;
- package pull stores the full payload once, a repeated pull is idempotent, and
  unknown/malformed events are not treated as valid corrections;
- Nous timeline displays raw 11, effective 8, the correction provenance, and no
  conformance finding; target-package recalibration consumes effective values;
- the full Ledger and Nous gates pass, and the CHG-058 original readiness and
  terminal bytes are unchanged.

CHG-059 itself uses one final cold diff-scoped campaign only if its tenant
preflight finds scored mutation shards. A zero-shard JavaScript/Python/docs
change records the observed zero and still runs the authoritative command once
under the approved readiness contract.
