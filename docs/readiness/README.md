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
