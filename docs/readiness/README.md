# Readiness artifacts

This directory contains the repository-owned readiness assessment for each
executable `US-*` and `CHG-*` work item. The canonical path is
`docs/readiness/<WORK-ID>.json`, and every artifact must conform to
[`work-readiness.schema.json`](../dev-guide/work-readiness.schema.json). The
human contract and commands are in
[`WORK_READINESS.md`](../dev-guide/WORK_READINESS.md).

Developers and agents own these assessment artifacts, their estimates,
evidence references, and actuals. They may update an artifact as evidence is
approved or actuals become known, while preserving the work item's official
Nous ID and append-only approval history in `.nous-feedback.jsonl`. Readiness
content is approved by its canonical `readiness_payload_sha256`; changed content
requires new matching decision evidence and cannot replay an older approval.

Nous continues to own generated sprint queues and story specifications,
including `docs/stories/SPRINT_PLAN.md`, `docs/stories/INDEX.md`, and generated
story files. Do not hand-edit generated files to create IDs, repartition work,
change acceptance criteria, or manufacture approval. Ask Nous for official
child IDs, then add separate readiness artifacts for those children.
Local partition `proposal_key` values may organize a non-executable proposal,
but they never create official work IDs or permit implementation.

CHG-022 is the only policy-activation bootstrap. No later artifact may set
`policy_bootstrap` to `true` or claim its one-time exemption. Its authorization
begins at the matching digest-bound decision and expires at CHG-022's first
valid terminal `done`; later implementation cannot reuse it.

## Verify assumptions against source before declaring an estimate

Before declaring `ready`, verify every assumption the estimate rests on against
the code that must satisfy it, and record each one as an entry in
`uncertainties` with an explicit `estimate_impact_minutes`. An assumption you
did not check is an unresolved uncertainty whether or not you wrote it down.

This is the one scoping control the gate cannot supply. `classifyAssessment`
compares the **declared** estimate against the limit; it has no way to know the
declared number is wrong. It does reject an artifact whose `uncertainties`
contain an entry that is `unresolved`, or has a null `resolution`, or a null
`estimate_impact_minutes` — so an assumption that is *written down* and open
already forces `blocked`. An assumption that was never written down is invisible
by construction, and no gate can detect it.

Two 2026-08-15 items were declared `ready` on assumptions that were never
recorded, and both were caught only when the implementation plan was scoped:

- **US-056** assumed the Anthropic probe supplied portable rate-limit and retry
  semantics. It does not — `probe.ts` sets headers and calls `fetch` with no
  limiter, `classifyHttpResult` maps 429 but nothing acts on it, and
  `packages/connectors` declares zero runtime dependencies. 115 minutes was
  really 160.
- **US-058** left it ambiguous how many of `VendorConnector`'s six methods must
  be functional versus conformant-but-unsupported. The two readings differ by
  roughly a factor of three. 105 minutes was really 220.

Neither was a gate failure. Both would have been caught at authoring time by
opening the file the estimate depended on.

Where an ambiguity is a scope or product question rather than a technical one,
do not derive your way past it. Record it as `unresolved` and let the item sit
at `blocked` until a human answers. If you resolve it by derivation from other
committed artifacts, cite them and state the falsifier in the `resolution`, so a
reader can see what would void it.

## Parse structured data; never grep it

`.nous-feedback.jsonl` and the readiness artifacts are JSON. Read them with a
parser and compare fields. A grep pattern over serialized JSON tests a guess
about whitespace and key order, not the data.

Both 2026-08-15 near-misses were verification steps that returned a *confident
wrong answer*, which is worse than an error:

- `'"story":"US-043","event":"checkpoint"'` matched zero lines against a file
  written with `"story": "US-043"`. Read as "no checkpoint exists", it nearly
  produced a duplicate 45-minute checkpoint and broken the exactly-one bijection.
- A UTF-8 sequence made `grep` treat a stream as binary and silently truncate a
  listing.

The same rule covers commands whose failure output looks like success:
`git rev-parse HEAD^2` prints its own argument on a non-merge commit, so
`[ -n "$(git rev-parse HEAD^2)" ]` reports every commit as a merge. Count
parents with `rev-list --parents` instead.

Before believing a negative result, confirm the check can produce a positive
one. A fixture that cannot observe the condition proves nothing about it.

## The 90-minute control is the checkpoint, not the clock

Re-approving a work item under a new decision id re-anchors the elapsed-time
window, because `findExecutionTimeline` selects the first implementation commit
after the approval named in `approval.evidence`. That is intended, and it is not
a way around the wall.

The wall is enforced by `checkpointRequiresPartition`: an artifact whose last
checkpoint is `elapsed_minutes: 90`, `status: partition_required`, and
`implementation_complete: false` classifies as `partition_required` no matter
what it declares. Verified: adding the exact 45-then-90 checkpoint sequence to a
`ready` artifact flips `classifyAssessment` to `partition_required`, and a
`ready` decision can no longer be signed for it because declared no longer
equals computed. Checkpoints are excluded from the payload digest, so this
cannot be dodged by re-signing either.

So re-approval resets the clock; it cannot clear a recorded 90-minute stop. The
real weakness is that **appending the checkpoint is voluntary** — an implementer
who stops early, or simply never records it, leaves nothing for the gate to act
on. That is the same failure mode as an unrecorded assumption: the gate cannot
see what was never written down.
