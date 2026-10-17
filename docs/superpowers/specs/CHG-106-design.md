# CHG-106 — Consistent IMP410 delivery snapshots

## Intent and authority

Make staged, immutable per-commit and complete linear-history consumer classification agree for genuine IMP-410 snapshots without weakening independent authorization. Policy is DEC-SMP-054, funding DEC-SMP-057. Canonical specification: Nous `a291060cc5f2298e1becc5625c6ca6a37a299305:Nous/WorkControl/fcostudios/smp/CHG-106_TECH_SPEC.md`; allocation custody Nous `943e504:Nous/WorkControl/agent-requests-2026-10-16/09_US084_CHG106_ALLOCATION_CUSTODY_RECEIPT.json`.

Approved readiness: `docs/readiness/CHG-106.json`, payload `f914d7133d9461819ab558670d11db3330c963cd649d94f61791b0c0e7f2995f`, actual approval event `CHG106-READY-f914d713-20261017` committed normally at `7485c98`. Approval records the human's actual Proceed to the displayed digest, not an invented hash-inspection claim. Ordinary readiness and normal commit hook passed before this design. Root has standing authorization to review the concrete design and plan; production work remains held until root release.

Frozen owned-code/mutation base: `563036407641bc02443a1cf9a20502130c600525` (before all owned MJS). Full CHG106 custody/branch-review base: `65d9df3009ee2f43eff68f4a37d90252c8fbe44c` (before the normal generated delivery); full history reviews use `65d9df3009ee2f43eff68f4a37d90252c8fbe44c..HEAD`, including delivery860ef94, readiness5630364, approval7485c98 and later commits. Source delivery `65d9df3009ee2f43eff68f4a37d90252c8fbe44c..860ef94ec6ee85d1b426578e25dbb4d7d18ed44d` already passed pure and strong validation. No new status sync under the old consumer.

## Goals, non-goals and failure conditions

AC1: accept cross-second identity transitions and retained identity/provenance with a fresh valid manifest in staged and immutable history paths. AC2: independently reject malformed and unauthorized delivery or execution using real Git fixtures and explicit error oracles. AC3: retain unchanged original history and original FAIL, then produce a dated separately governed classification only if original custody and original-parent independent authority are actually established; otherwise stop historical evaluation and closure.

No producer/emitter, generated TESTING, schema/threshold/critical-set, hook, application or bootstrap changes. No identity churn, retimestamping, same-second retries, clock-order requirement, source-to-composed mapping loss, old-parent rewrite or borrowed proof. DEC-SMP-051/P4 and US-090/091 dependency holds remain. Monitoring stays off.

## Bounded files

Nine delivery paths: `scripts/work-readiness/git.mjs`; `scripts/test-work-readiness.mjs`; `docs/dev-guide/WORK_READINESS.md`; `.nous-project.json`; `.nous-provenance.json`; `.nous-sync.json`; `docs/stories/CHANGES.md`; `docs/stories/SPRINT_PLAN.md`; `docs/decisions/DECISION_MATRIX.md`. The last six are normal generated delivery only, never direct edits; unchanged bytes are permitted.

Nine bookkeeping paths: `docs/readiness/CHG-106.json`; this document; `docs/superpowers/plans/CHG-106-plan.md`; `.nous-feedback.jsonl`; `docs/readiness/drafts/US-084-DEC054-funding-packet.md`; three existing `docs/readiness/drafts/US-084-DEC054-evidence/us084-optiona-{historical-readiness,scope-cost-readiness,packet-review}-20261017.md` reports; and that evidence directory's `manifest.json`. Extra tracked outputs require reassessment before editing. Task briefs, receipts and review packages belong only in this plan's ignored SDD workspace, created after plan approval.

## Consumer algorithm

Keep `exactNousSyncOwns({ root, base, head, changedPaths }) -> boolean` private, with shared use through existing staged and immutable range ownership entrypoints. Require `.nous-sync.json` to change and at least one managed generated path to change. Identity and provenance must exist as regular `100644` files even when unchanged. Retain duplicate/path-count/managed-allowlist limits and canonical path rules.

Validate exact closed envelope shapes, strict syntactically and calendrically valid UTC timestamps, schema versions, nonempty project/organization/namespace, revision lengths, project/provenance bindings and checksum format. Remove only equality of UTC seconds and the requirement that all three envelope paths changed. No monotonicity, future-clock or freshness condition is introduced.

Read parent identity as well as candidate identity. Whole-identity continuity compares all semantic fields except ONLY `generated_at`; formatting is not identity. If semantic identity is unchanged, retaining identity and provenance bytes is legal. A changed substantive identity must have candidate provenance consistent with it; provenance bytes need not change when their current values remain valid. Whole semantic identity comparison excludes only generated_at; it must not become a narrower projection or mandatory provenance-byte cochange check. Present parent identity fields that establish project/organization/namespace cannot silently switch to a different tenant through a timestamp exception. Preserve existing legitimate first delivery behavior when there is no parent identity. A builder may choose a small local comparison helper; no new public API or files.

For every changed generated path, require candidate regular mode, an exact `{hash, source}` claim, exact candidate SHA-256 prefix, allowed generated/source vocabulary, canonical absolute Nous source path, and no overlap between dirty source paths and the claimed source. Compare semantic parent claims, so reformatting an unchanged `{hash, source}` cannot launder a replay. Validate applicable new or changed semantic manifest claims rather than allowing fresh unrelated entries to be unchecked; retained unrelated entries need not falsely pretend to be newly delivered. Preserve existing bounds and unrelated full-manifest entries.

## Authorization is independent of classification

Current `validateCommitOwnership` validates feedback-prefix history, machine artifacts, actual transitions and changed bound plans before generated-sync classification, then returns before ordinary item readiness/plan checks for pure sync. A pure canonical catalog adoption is a consistency convention, not evidence that item execution authority ran. Preserve that normal adoption boundary. Mixed implementation cannot take the pure-sync branch and must continue through the existing parent-ready, active, digest, candidate continuity, bound-plan, ownership and activation/lifecycle checks. Keep those real controls exercised independently; do not claim a pure-sync positive proves them.

Historical AC3 additionally requires a read-only authority audit against every original immutable parent using existing assessment/plan/activation primitives and actual original bytes. No special historical admission or new validator framework is added. Before dispatching historical evaluation, a reviewer must establish whether every applicable independent guard actually ran or was explicitly evaluated; early-return PASS is insufficient. If available existing interfaces cannot expose an applicable guard without new scope, stop and report the concrete gap to root rather than invent an exception.

### Authority matrix and root ruling

| Transition | Required proof | What a classifier PASS does not prove |
|---|---|---|
| Pure canonical source sync | Existing delivery activation/provenance/source/claim/feedback-history controls; consistent managed snapshot | Ordinary execution approval for every ID mentioned by generated catalogs |
| Owned implementation, including CHG-106 | Normal immediate-parent ready/digest/active/scope/unique bound plan; valid candidate/lifecycle and history | Candidate self-approval or generated labels never authorize implementation |
| Historical interpretation | Same exact original transition and all guards applicable in its immutable original parent; separate present validator authority and authentic original receipt | No retroactive plan requirement for pure sync; no later replacement for a genuinely required missing plan/approval |

Root Ruling: preserve the existing pure generated-source adoption route; do not newly run ordinary item authorization for every ID mentioned by generated catalog sync. DEC-SMP-054 changes consistency classification, not global adoption authority. Require all applicable original-parent guards for historical interpretation and do not invent old plan requirements or skip genuine ones. Reason: retain normal adoption while exposing independent authorization proof explicitly. Cost if wrong: generated delivery regression or invalid historical proof, caught by the real-Git matrix and fresh review, blocking closure.

## Real regression and adversarial proof

Use existing temporary real Git repositories and actual validators; no owned mocks. Fixed bytes/timestamps, no live network. Positive controls cover cross-second transition, byte-identical old identity/provenance with changed manifest, future and nonmonotonic valid UTC values, and unchanged unrelated manifest entries. Run each relevant fixture staged and committed, including a linear multi-commit full-history range.

Independently vary one guard from a passing fixture: malformed UTC/calendar/offset/shape; changed project/org/namespace or inconsistent provenance/checksum/revision; incorrect hash/source; semantic replay; extra unverified new/changed claim; unmanaged path; symlink/executable mode; dirty source ancestor/descendant overlap. Separate real implementation fixtures assert missing parent activation, approval, digest, scope/ownership, plan, self-approval and lifecycle/history rejection. Each rejection must assert its intended stable code/path or equivalent explicit contract, and each parent positive must pass before its fault is introduced. Deliberate isolated guard omissions must be killed by these oracles, preserving raw RED/GREEN evidence.

## Historical custody and stop boundary

Original commit `cad8c2965ace0e39dd9c0f05b085a277d926e704`, parent `ae0ddfacfcc3aa2c229453fdb38ea627102b25b0`; original range `d502a34223612c9c6178a515ca3047dbb2691adb..2af42f33403b7ea4e34670dfa588fac5fd5ef215`. Preserve raw failure and source-to-composed map bytes. Existing custodian must supply authentic receipt SHA-256 and confirm complete endpoints before a new historical evaluation. Root coordinates that owner; this controller does not take over or message the custodian without authority.

Original parent evidence includes ready digest `e08a95ad8295972a7350da97452f2cefdf366a0018360cbec5d38d3379924f6d`, raw decision row1652, nine-path scope and activation. Original plan/design seven paths/120 versus readiness nine/140 is unproved binding, not a repaired historical fact. Prove actual applicable original-parent plan rules using original bytes; if a genuine guard is absent, original FAIL stands and closure stops. Later approval supplies no old authority. U3 and U4 reserve ten minutes each within existing focused90/integration45.

A permitted new evaluation records actual committed validator SHA plus source hashes, UTC date, DEC-SMP-054, exact endpoints, independent original-parent guard evidence and results alongside the preserved old FAIL. No current approval is substituted for original authority. The CHG104/105 `af62..ce690` rejection remains unchanged and outside repair scope.

## Delivery and cost

One consolidated implementer, reused scoped reviewer, distinct fresh adversarial/final reviewer; controller only plans and coordinates. Use full Superpowers briefs, plan-owned ignored ledger, review packages and bounded repair loops after root release. Builder/design and final architecture reviews use explicit `gpt-6-astra`; implementation and scoped review use explicit `gpt-6.1-sol` unless risk requires escalation.

Actual preflight must establish zero/nonzero native routing. Run own `pnpm test:work-readiness` separately from root check. Run own awake `caffeinate -i pnpm check`, supported shared PostgreSQL fixture with existing token/inode ownership lock protocol, fresh committed migrations as `ledger_owner` and verifier/runtime grants as `ledger_app`, without secret output. Follow applicable zero-attempt technical policy only when actual preflight meets it, record null score and omit fabricated `test_report`; otherwise run actual required cold campaign. Final proof binds exact source/config/dependency inputs. Current-main reconciliation and normal root-coordinated integration are required before done.

315 cumulative = readiness55 + implementation75 + focused90 + review50 + integration45. At handoff, prior readiness52 plus root approval coordination1 plus binding2 exhaust readiness55; unused preparation is never billed as spent. Initial design/plan/builder/root review is bounded to15 estimated active minutes inside implementation75. All role costs and actual gates are recorded honestly, not billing claims. Stop before scope or full-outcome forecast exceeds the approved ceiling; no borrowing or reset.
