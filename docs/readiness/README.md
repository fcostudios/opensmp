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
`policy_bootstrap` to `true` or claim its one-time exemption.
