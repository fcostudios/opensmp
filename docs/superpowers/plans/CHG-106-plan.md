**Work item:** CHG-106
**Readiness assessment:** docs/readiness/CHG-106.json
**Approved estimate:** 315 minutes

# CHG-106 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One consolidated implementer and reused scoped reviewer per local project contract; distinct fresh adversarial final reviewer. Controller never implements.

**Goal:** Consistently classify IMP410 snapshots while proving protected guards and separately governed unchanged historical custody.

**Architecture:** Narrow correction to private `exactNousSyncOwns` in the existing Git consumer; staged and immutable validators use that same predicate. Pure canonical delivery keeps its existing adoption route, owned implementation keeps ordinary independent authority, historical interpretation independently proves every applicable original-parent guard.

**Tech Stack:** Native Node ESM, node:assert, real temporary Git repositories, existing pnpm/Turbo and shared PostgreSQL fixture. No dependency additions.

**Spec:** `docs/superpowers/specs/CHG-106-design.md`; canonical Nous `a291060cc5f2298e1becc5625c6ca6a37a299305:Nous/WorkControl/fcostudios/smp/CHG-106_TECH_SPEC.md`; DEC-SMP-054 and DEC-SMP-057.

**Binding:** Readiness digest `f914d7133d9461819ab558670d11db3330c963cd649d94f61791b0c0e7f2995f`; approval event `CHG106-READY-f914d713-20261017`; normal approval commit `7485c984ebcb244bc0cc5b2053fe53d56e2699f5`. Frozen owned-code/mutation base `563036407641bc02443a1cf9a20502130c600525` (before all owned MJS). Full CHG106 custody/branch-review base `65d9df3009ee2f43eff68f4a37d90252c8fbe44c`; full history review is `65d9df3009ee2f43eff68f4a37d90252c8fbe44c..HEAD`, including normal source delivery860ef94, readiness5630364, approval7485c98 and every later commit. Neither base may advance beyond owned work. This header's three metadata lines must remain unique and at byte zero.

## Global Constraints

- Identity continuity compares the entire identity document except **only** `generated_at`; unchanged identity/provenance may retain their bytes.
- Preserve closed shapes, strict UTC syntax, project/organization/namespace, checksum, source/provenance, exact candidate hashes, truthful new/changed semantic claims, paths, modes and immutable-parent authorization.
- Do not require same-second timestamps, monotonic or future-clock ordering, or all three envelope documents to change.
- No direct generated-file edits, shared producer/emitter changes, hook bypasses, new historical exception framework, critical-set expansion, schema/threshold changes or application-functional source edits are included.
- Pure canonical sync keeps the existing adoption route; a classifier PASS is consistency proof only. Owned implementation requires normal immediate-parent ready/digest/active/scope/unique bound plan and candidate/history checks. Historical interpretation requires ALL APPLICABLE original-parent guards; no retroactive plan requirement for pure sync, and no skipped genuine requirement or later authority backfill.
- Exact tracked output union is the design's nine delivery and nine bookkeeping paths. Extra tracked outputs stop for reassessment before edit. Plan-owned ignored workspace only for briefs/reports/packages/receipts, never a foreign workspace.
- Read `docs/dev-guide/TESTING.md` and `docs/TEST_EFFECTIVENESS_STANDARD.md` BEFORE any test edit. No owned mocks; real Git, deterministic fixed bytes/timestamps, explicit meaningful oracles and independent tenant/project controls.
- Native MJS harness runs separately from root check. Own actual mutation preflight, required awake full gate, fresh committed PostgreSQL migrations/schema verification, scoped and distinct final adversarial review remain mandatory.
- Original FAIL, original history/ledger/source map and sibling holds stay intact; historical custody or authority absence stops historical evaluation and closure.
- Total315 estimated active minutes includes every role, readiness55/implementation75/focused90/review50/integration45; no reset or sibling transfer. Design/plan/builder/root review <=15 inside implementation75.

## Review Focus

1. Unchanged identity/provenance and reordered JSON can conceal a stale semantic claim: positive retained envelope and independent replay-negative tests belong to Task1.
2. A fresh extra manifest claim can evade changed-file checks: add a one-fault incorrect newly added/changed claim control in Task1, with a passing full-manifest parent.
3. A future or nonmonotonic but valid UTC timestamp must remain legal: fixed explicit success fixtures in Task1, malformed offset/calendar fixtures fail separately.
4. Generated classification can hide authority gaps: Task1 mixed implementation fixtures and Task2 authority matrix prove applicable parent guards independently.
5. A later reverted history violation can disappear in endpoint diff: Task1 three-commit linear range must reject the bad intermediate transition; Task2 uses original complete range.

---

### Task 1: Consistent snapshots and independently killed guard faults

**Files:**
- Modify: `scripts/work-readiness/git.mjs` (`exactNousSyncOwns`, currently around883–1000; authorization entrypoints retained).
- Test/modify: `scripts/test-work-readiness.mjs` (existing `writeExactNousSyncEnvelope`, real Git helpers, IMP410 cases around4100–4600 and authority fixtures).
- Modify: `docs/dev-guide/WORK_READINESS.md` (tenant-authored consistency/independent-authority explanation only; preserve emitted blocks).

**Interfaces:**
- Consumes: existing `validateRangeOwnership({ root, base, head, message? })`, staged CLI `node scripts/work-readiness.mjs check-staged --message-file <canonical COMMIT_EDITMSG>`, real fixture helpers and private `exactNousSyncOwns({ root, base, head, changedPaths })`.
- Produces: unchanged public interfaces and stable error contracts; correct private boolean classification; real Git evidence binding exact fixture commits and code revision.

- [ ] **Step 1: Prepare the task brief and authorization boundary.** After explicit root release only, use the SDD skill's `scripts/sdd-workspace` and `scripts/task-brief` through `rtk proxy bash`, plan-owned progress ledger first line identifying this plan. Record BASE=actual HEAD; verify prior approval, committed unique bound plan and clean worktree. Read required testing standards before the first test edit. Append actual started/implementation phase when execution starts. Scope is only the two native files plus tenant guidance. No generated sync is needed for this correction.
- [ ] **Step 2: Write meaningful failing real-Git fixtures.** Add fixed success cases for valid cross-second identity transition, unchanged old identity+provenance with a new valid manifest, future UTC and nonmonotonic UTC. Each stages the true index and canonical message then commits unchanged index and checks the same transition/range. Preserve valid full-manifest unrelated entries and initial-delivery behavior. Update the old equal-UTC-second negative case to remove only its cross-second rejection. Core assertions use actual results, for example:

```js
assert.equal(validateRangeOwnership({ root, base, head }).classification, "bootstrap-documentation");
assert.equal(stagedResult.status, 0);
assert.equal(committedResult.status, 0);
```

Names/variables may follow existing helpers; every success needs its actual semantic fixture asserted, not a no-throw-only oracle. No helper or API export is required merely for tests.
- [ ] **Step 3: Record RED.** Run `rtk proxy pnpm test:work-readiness`; preserve raw failing test names and expected original all-envelope/equal-second incompatibility. Setup failures do not count as intended RED. Do not retry synchronization or manipulate identities to get a favorable result.
- [ ] **Step 4: Make the minimal consumer correction.** In `exactNousSyncOwns(...) -> boolean`, require the changed manifest, permit unchanged present identity/provenance, retain mandatory regular modes for all envelope files, compare identity semantically except ONLY `generated_at`, and remove equal-second comparison while preserving strict UTC parsing. Preserve existing bindings and all unchanged checks. Validate new/changed semantic claims and exact candidate hashes/source/mode rather than just changed path formatting; retain unchanged unrelated manifest entries. Do not refactor public ownership plumbing or introduce a policy exception framework. Keep pure sync adoption behavior and mixed implementation guards distinct per the design matrix.
- [ ] **Step 5: Add independent hostile oracles.** Start each family from a verified passing real-Git fixture, change one property, and assert intended `WorkReadinessError.code`/path or subprocess diagnostic. Example shape:

```js
assert.throws(() => validateRangeOwnership({ root, base, head }),
  error => error instanceof WorkReadinessError && error.code === "WR_GENERATED_NOUS_PATH"
    && error.path === generatedPath);
```

Cover closed-shape and malformed UTC/calendar/offset; project/org/namespace mismatch; checksum/revision/provenance mismatch; candidate hash/source; semantic replay and reformatting; incorrect fresh extra claim; unmanaged paths; symlink/executable modes; dirty source equal/ancestor/descendant overlap. Separate ordinary mixed implementation fixtures must prove missing original parent activation/ready/approval/digest/plan/ownership, candidate self-approval, inactive lifecycle and feedback-history mutation reject with their intended existing codes. A linear history with an invalid middle commit and later endpoint restoration must still reject. Do not invent scope guards that existing authority does not have: demonstrate actual allowed-path/ownership contract and report a real gap to root.
- [ ] **Step 6: Demonstrate oracle effectiveness and GREEN.** Run isolated deliberate single-guard omissions in task-owned scratch copies and verify each reaches/kills the named oracle, with failing output and restoration evidence. No tracked fault tooling or owned mocks. Run `rtk proxy pnpm test:work-readiness`, `rtk proxy pnpm test:feedback-order:fixtures`, ordinary CHG106 readiness, and actual full CHG106 custody range from65d9df3. Native harness PASS is separate from normal root gate; retain all independent faults and any setup failures honestly. Update tenant guidance to describe the exact accepted semantics and separate authority matrix.
- [ ] **Step 7: Commit and scoped review.** Commit only authorized paths through normal hooks. Full task report includes RED/GREEN/fault commands, outcomes, wall times, changed files, exact source commit and budget actual/forecast. Controller generates review package and dispatches explicit `gpt-6.1-sol` scoped reviewer with brief/report/package + verbatim constraints. Fix material findings with consolidated implementer and scoped re-review, following skill loop caps, not controller code edits. Preserve any rulings and deferred minors in ledger.

### Task 2: Independent custody, full gates and governed integration proof

**Files:**
- Read original immutable trees and genuine custodian receipt; no edits to them.
- Modify bookkeeping only: `docs/readiness/CHG-106.json`, `.nous-feedback.jsonl`, and this plan if needed to append actual evidence. No new tracked receipt paths.

**Interfaces:**
- Consumes: Task1's committed validator revision and source hashes, actual ordinary parent authorization, scoped report and exact complete CHG106 custody range from65d9df3.
- Produces: own source-bound full-gate/native/actual-preflight evidence, independent AC1–3 verdicts, dated permitted historical evaluation or explicit STOP, normal root-coordinated integration and truthful terminal actuals only when all conditions pass.

- [ ] **Step 1: Resolve historical prerequisites before evaluation.** Root coordinates existing custodian; obtain authentic raw failed receipt SHA256 and full-range confirmation `d502a34223612c9c6178a515ca3047dbb2691adb..2af42f33403b7ea4e34670dfa588fac5fd5ef215` (U3 ten minutes within existing focused/integration). Preserve original FAIL bytes, original `cad8c2965ace0e39dd9c0f05b085a277d926e704` and parent `ae0ddfacfcc3aa2c229453fdb38ea627102b25b0`. Independently audit every applicable original-parent authority guard, including actual old plan contract applicability (U4 ten minutes within focused90). Record exact bytes/revisions and whether each guard is applicable/pass/fail. The seven/120 plan versus nine/140 readiness is not assumed pass or fail without actual governing contract. A genuine missing required guard remains FAIL. Custody or authority absence stops historical evaluation and closure; it does not authorize reconstruction or backfill. Preserve CHG104/105 rejection untouched.
- [ ] **Step 2: Record actual preflight and source-bound verification.** Append actual focused_verification phase. Run own `rtk proxy pnpm mutation:preflight` with owned-code/mutation base5630364 per supported CLI and save raw complete routing/source output; zero TS/TSX is only a forecast. Nonempty/routing-gap result follows actual policy or stops. Run own native harness separately and bind result to committed validator/source/config/dependencies. No borrowed CHG097/098/103 score or receipt. Touched-shard previews follow current round/minute rules only if applicable.
- [ ] **Step 3: Obtain own awake engineering gate and fresh DB proof.** Independent verification worker uses existing supported shared PostgreSQL fixture and exclusive token/inode lock protocol, waiting >=60seconds on foreign ownership, never deleting foreign locks or exposing secrets. Run uncached/forced normal `caffeinate -i pnpm check` per current fixture protocol and record actual type/lint/test/build results. Fresh committed migration apply then schema verifier as `ledger_owner`, runtime grants as `ledger_app`; no `drizzle-kit push`, private schema repair or guard weakening. Retain errors and named long-run causes; corrective scope changes stop. Controller does not personally run adversarial verification.
- [ ] **Step 4: Fresh adversarial AC review.** Generate full branch-review package from custody base65d9df3; distinct fresh explicit `gpt-6-astra` reviewer reads design/canonical spec, Task1 report, raw evidence and authority matrix. Try to break every AC and each independent guard, resolve every cannot-verify item and deferred minor. Reviewer reports separate AC1/2/3 results; no historical AC3 PASS without custody and applicable original authority. One consolidated final fix wave plus scoped re-review per skill. No repeat suite solely to duplicate unchanged evidence; changed proof inputs invalidate affected receipts normally.
- [ ] **Step 5: Effectiveness policy after final fixes.** Record actual integration phase. Using actual own preflight and exact approved zero-shard technical policy, either record applicable zero cold attempts/null score with no `test_report`, or clear only own applicable cache and run one required final cold campaign `rtk proxy pnpm test:mutation`. Record real attempts, invalidations, survivors and applicability; never fabricate a 100% score or native campaign. Broad critical-set campaign is excluded because no critical-set changes are authorized.
- [ ] **Step 6: Permitted historical evaluation and integration.** Only after Step1 passes, identify exact committed validator SHA/source hashes, UTC evaluation date, DEC-SMP-054 and original endpoints; evaluate unchanged original commits individually and complete original range against their immutable parents with applicable authority audit. Preserve source-to-composed map, unrelated files, old FAIL and new dated result separately. A consistency PASS alone is insufficient. Root must coordinate ordinary technical integration/current-main reconciliation; do not push/merge or operate another owner's worktree without root authority. Preserve both frozen bases and all ledger prefixes. Post-integration proof must bind exact integrated source and context; changed inputs invalidate affected evidence.
- [ ] **Step 7: Close only when complete.** Controller records independently justified `ac_verify`1–3 and actual `build_pass`, honest actuals/phase totals, source commit, preview/cold applicability and comprehensive role costs. `feedback` annotation states measured versus estimated token/call counters before `done.cost`; estimates are not billing claims. No missing-custody deferral disguised as done. Report every recorded Ruling and cost-if-wrong in final handoff. Use finishing-a-development-branch after all required proof and root-coordinated integration. Delete only this plan's ignored SDD workspace after clean final review and merged fixes, preserving durable Git/evidence pointers and unrelated workspaces.

## Design check and plan self-review

Fresh `gpt-6-astra` builder returned “nothing important left”, estimated2 active minutes, no code or gates. Root's explicit authority ruling is recorded in the design and must be carried to the SDD ledger verbatim at execution setup. No human reapproval loop is required; root reviews this concrete design/plan before releasing production work.

Self-review: AC1→Task1 steps2–4; AC2→Task1 steps5–7 and Task2 step4; AC3→Task2 steps1–7. All five Review Focus cases map to concrete Task1 controls. Public APIs remain unchanged; no undefined cross-task helpers. The three-line repository metadata precedes the required Superpowers header because repository binding requires byte zero. Expected tracked scope remains nine delivery+nine bookkeeping, no tests/tooling/framework/generated outputs added outside inventory.

Initial design/plan phase forecast: controller authoring/reads/ordinary checks8 + builder2 + root review/coordination up to3 =13 estimated active minutes inside implementation75, leaving62 implementation; readiness55 already allocated once. Full-outcome forecast remains <=315 including focused90/review50/integration45; counters are estimates and must be updated at actual handoff. No engineering/native/mutation/DB gate is claimed at plan stage. Root release required before Task1 production or test edits.

## Pre-execution dependency and consistency scan

| Tasks | Shared file or interface | Produces → consumes; scan result |
|---|---|---|
| Task1 → Task2 | Committed git.mjs validator, native harness report, guidance; readiness/feedback authority | Exact source SHA/hashes and scoped report → independent final/native/history proof; unchanged APIs; full custody range65d9 covers original generated delivery while mutation base563 precedes all owned code |
| Task1 | Two existing native files plus tenant guide; RED/GREEN tests versus private predicate | Success/failure matrices exercise specified semantic exception and retained guards; fixtures use real Git, code remains private, no owned mocks/new tracked file |
| Task2 | Existing readiness/feedback bookkeeping, original immutable trees, source-bound receipts | No production edits; original guard applicability audit precedes historical evaluation, missing custody/guard prevents closure; own engineering gates remain unclaimed until actually run |

Root design review/ruling estimate2 is included in initial design/plan cap, not readiness. Existing U3 lookup is root-coordinated: root1 + operator<=2 estimated within U3's existing ten-minute reserve, leaving at least7 for actual custody proof; do not duplicate the reserve or retest another owner's work. Controller will copy this scan and the full root Ruling to this plan's ignored SDD ledger only after release.
