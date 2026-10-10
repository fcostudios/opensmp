# CHG-073 — annotation bookkeeping and corrected historical starts

## Authority and result

Readiness: `docs/readiness/CHG-073.json`, approved by Francisco in
`650ad83`, digest
`25e58287f072d56e42300f4b3bcad9afad8b4d5275580e9e64e7e9daed2f9a9e`,
270 minutes. Scope is the complete current Nous `changes.description`, including
item 4 absorbed from cancelled CHG-072 and the last-tooling-item rule. The
generated scope amendment `62fe5e2` is carried by `a923bf5`.

The result is two valid readiness checks (CHG-070 and US-072) and a green
feedback-order checker, after one appended correction and no historical ledger
edits. This session belongs solely to CHG-073. It does not implement US-072 or
execute CHG-070's experiment. Nous delivery and the original controller's resume
remain subsequent actions.

## Chosen approach

Keep the existing validation and lifecycle projection intact, adding a narrow
start-correction validator alongside them. Derive annotation classification from
the delivered vocabulary rather than maintaining another list of annotation
names. Reuse that authority in the feedback-order checker.

Extending `revalidated` to cover starts would alter the explicitly protected
projection contract. A work-ID exception for CHG-070 would authorize an incident
rather than establish the requested constrained correction rule. Neither is
used. No generalized lifecycle rewriting subsystem is introduced.

## Annotation rules

The readiness model derives annotation names from `canonical` entries whose
class is `annotation`; tenant-local entries are annotation names too. Decision
records continue their existing shape, uniqueness and digest validation before
any class-based exemption. Explicit evidence (`build_pass`, `ac_verify`,
`test_report`) retains its preapproval execution treatment, even when the
vocabulary class is annotation. Other annotation bookkeeping is skipped in the
preapproval scan. The postapproval scan retains its existing evidence,
revocation, terminal and stale-approval behavior; this change does not authorize
execution after revocation or completion.

Unknown events remain unknown. The model recognizes registered local event names
without treating them as approvals. `lifecycle_corrected` gets explicit semantic
validation before its annotation exemption can apply.

## Append-only correction contract

The closed record shape is:

```json
{
  "story": "CHG-070",
  "event": "lifecycle_corrected",
  "target_event": "started",
  "target_ts": "2026-10-07T03:44:39Z",
  "disposition": "not_execution",
  "reason": "Historical controller bookkeeping start; no implementation evidence preceded approval.",
  "approved_by": "Francisco Lomas",
  "ts": "<actual append time in UTC>"
}
```

Validate without mutating input records. Each correction must have nonempty
reason and approver, `target_event: started`, `disposition: not_execution`, and
valid explicit UTC target and correction timestamps. Match exactly one earlier
raw start by the correction's own story, event and literal original timestamp.
Reject missing, duplicate or already-corrected targets with
`WR_CORRECTION_INVALID`. A foreign story cannot correct CHG-070's start.

The target must precede that story's first valid digest-bound `ready` approval.
The appended correction follows that approval and target in ledger order and
actual correction time; it does not invent an earlier approval. Between the
target and first approval there must be no raw `build_pass`, `ac_verify` or
`test_report` for that story. A projected or superseded event cannot erase that
raw evidence restriction. The existing approval validator still validates the
selected readiness payload and authorization intervals.

Return the corrected start indices/count as supplemental validation data. The
preapproval scan skips only those indices. The original start remains readable,
and the ordinary lifecycle checker still sees it as the original start; the
correction does not create a replacement start. No change to CHG-022's bootstrap
exception, `isProjectableEvent`, or readiness digest computation.

The readiness CLI appends `; 1 corrected start` to CHG-070's successful summary
(pluralize for other counts). Stable JSON output keeps its existing envelope and
includes this information in `summary`. Items without corrections keep their
existing summary.

## Feedback-order checker — item 4

Build `annotationEvents` beside `terminalEvents` from the same emitted
vocabulary, including registered local annotations. Keep schema/field validation
for every record. An annotation does not require a prior start/build and does
not advance or regress an execution timestamp clock. Decision keeps its
existing explanatory branch and does not create lifecycle state.

Check timestamp chronology within each story, rather than across unrelated
stories. This is needed by the canonical requirement to clear all 18 historical
violations: lines 945–954 include CHG-065's genuine start appended after another
story's later records. Global chronology cannot model that append-only parallel
history. Preserve execution timestamp order within each story, rejection of
`build_pass` before `started`, duplicate starts, and terminal-before-build.
Record this narrow global-to-story timestamp change as the item 4 deviation;
no history edits, new work item, or readiness blocker.

Projected build/terminal records retain existing projection behavior. Correction
records are recognized as local annotations, and their semantic contract is
validated with the shared real correction validator rather than duplicating it
in the checker. Current and main ledgers are each checked with the candidate
checker; main's checkout is never modified.

## Tenant-local registration and ownership

Preserve the tenant's existing `feedback.local_events` array and add only
`lifecycle_corrected` through the Nous config interface. Verify the shared
`_project_local_events` reader recognizes it for vocabulary checking and pull.
Do not mark CHG-073 delivered or pull unrelated lifecycle state as part of this
registration verification.

Obtain the generated vocabulary through the supported emitter. Generated path
changes use the existing immutable exact-overlay route when a sync envelope
cannot authorize that path: register the exact parent/desired byte binding in a
prior commit, then carry the emitted bytes. Never edit the emitted vocabulary
by hand, widen the generated-ownership gate, or amend a historical overlay.
Restore an unsolicited `testing/critical-paths.md` change if a sync produces it.

## Verification and handoff

Use real validator functions and checker processes; no owned-code mocks. The
five validator RED fixtures assert phase acceptance, preapproval build
rejection, evidence-followed-start correction rejection, missing approver
rejection, and cross-story correction rejection. Correction uniqueness and
malformed binding cases constrain the new contract rather than add coverage.

Checker fixtures assert feedback before start passes, build before start fails,
and done before build fails. Preserve the 18 original historical records as an
immutable real-ledger regression oracle, checking both the candidate ledger and
main's ledger. Assert same-story execution time regression still fails and
parallel-story append order no longer produces a false violation.

Run `pnpm test:work-readiness`, readiness checks for CHG-070/US-072 and all
artifacts, checker fixtures/current/main ledger checks, generated guidance and
ownership checks, and the full `caffeinate -i pnpm check` under exclusive
`/tmp/smp-full-gate.lock` with guaranteed cleanup. Install frozen dependencies
first without lockfile changes. Scoped/adversarial verification is delegated to
a reviewer under the repository session contract. Expected mutation shards are
zero for this mjs/JSON/docs scope; prove the actual routing with diff-scoped
preflight and retain its evidence.

Append exactly one real CHG-070 correction only after design/plan approval and
the correction fixtures are green. Compare the complete original feedback
prefix byte-for-byte with `4780ae1`; no line is retimed or reordered. Finish
review and required gates before immutable actuals and terminal closure, keeping
measured and estimated costs distinct. Any other finding is a deviation or named
deferred hardening in closure. Report the two green readiness checks and checker
to Francisco; Nous delivers CHG-073, then the original controller resumes the
already-approved US-072 plan with its one implementer and existing reviewer,
freezing its mutation base after correction and entry approvals.
