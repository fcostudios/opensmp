**Work item:** US-075
**Readiness assessment:** docs/readiness/US-075.json
**Approved estimate:** 315 minutes

# Anchored removal implementation plan

**Goal:** Start one authorized anchored removal from either detail screen and finalize confirmed checklist removal atomically, preserving Person.status.

**Architecture:** The existing web action handles explicit target discovery and targeted start. The domain lifecycle module exports finalizeOffboarding; existing web orchestration supplies its transaction adapter. PersonOffboarding discovers authorized targets; RequestRecord supplies its fixed target. Both detail pages remain unchanged.

**Tech stack:** Next.js, TypeScript, Zod, Drizzle/PostgreSQL, Vitest, existing design tokens/locales.

**Spec:** docs/superpowers/specs/2026-10-11-us-075-anchored-removal-design.md. Readiness approval e14f813 binds f22f1c08dc0f47572ad346432cb4556b5571fdc1d151b80360ad6f5253a5952a. Francisco delegated all stages within this scope/budget; root reviews these revised documents before code continuation. One consolidated implementer, one reused scoped reviewer, a fresh adversarial verifier last. Preserve the same implementer session; no fabricated restart or repeated started event.

## Global constraints

- Three scopes: domain/server/UI; two screens; one removal boundary; exactly20 inclusive paths below. No db/contracts/worker/connector/barrel/dependency/tooling/generated-guide changes.
- Accept left_company/inactive; reallocated receives explicit BR-02 transfer refusal before mutation. US-028 retains flagged_inactive approval; ordinary start accepts active only. Preserve Person.status, stored capacity and watermarks.
- Persist kind=remove/status=pending in both execution modes. US-025 persisted automated+canDeprovision+rest descriptor selects automated; others use shipped manual payload. No provider call or fake connector facade.
- Domain source has canonical CHG-081 real-DB routing atb6e67ea, runtime proof95fac1f. Existing adjacent domain tests remain routed but unchanged. Stock seven production paths select six shards; recalculate actual IDs after changes.
- Whole-item MUTATION_BASE remains37666528d03a50e2529cad4382f2a5ae146dca63, including completedTask1. Root freezes a separate continuation entry head after document review; do not replace whole-item base with it.
- Read TESTING.md before any test edit. Use real owned implementations and deterministic dates/locks. Focused package command: rtk pnpm --dir apps/web test -- <files>; its shipped wrapper supplies one shared PG16 cluster when absent. Never direct vitest with per-fixture container fallback.
- Runtime preflight uses an untracked scratch launcher under the shipped shared wrapper: createPostgresFixture(), migrate(), privately pass exactly one paired mutation environment to the stock runner, finally stop only owned fixture. No credentials in output or source changes. Do not borrow Nous DB.
- Root owns readiness and feedback. Checkpoint commits carry US-075. Background touched previews stay within30 minutes; one final cold campaign last. New path/boundary or forecast above320 requires reassessment.

## Exact file responsibilities — 20 inclusive

1. packages/domain/src/request-workflow/lifecycle.ts: portable primitive/types.
2. apps/web/src/modules/org-registry/repository.ts: targeted audited start and authorized detail projection reuse.
3. apps/web/src/modules/org-registry/repository.integration.test.ts: actual intent/repository real-DB oracles.
4. apps/web/src/modules/org-registry/people-action-service.ts: composed parser, read_targets executor, web-owned optional response and exact mutation invalidation paths.
5. apps/web/src/modules/request-workflow/orchestration.ts: atomic SQL adapter, manual selection/confirmation/attempt integration.
6. apps/web/src/modules/request-workflow/orchestration.integration.test.ts: direct primitive/adapter real-DB oracles.
7. apps/web/src/modules/request-workflow/actions/checklist-action-transaction.ts: removal branch and replay-safe wrapper audit ownership.
8. apps/web/src/modules/request-workflow/actions/checklist-action-transaction.test.ts: real wrapper oracles.
9. apps/web/src/modules/alerts/offboarding-workflow.integration.test.ts: coherent assignment pointer and canonical remove expectation, retained alert oracle.
10. apps/web/src/components/people/person-offboarding.tsx: authorized choice discovery and fixed-target presentation.
11. apps/web/src/components/people/person-offboarding.test.tsx: selectable/fixed target and reason behavior.
12. apps/web/src/components/requests/request-record.tsx: fixed request/person embedding.
13. apps/web/src/components/requests/request-record.test.tsx: actual embedding/role/state behavior.
14. apps/web/messages/es-EC.json.
15. apps/web/messages/en-US.json.
16. docs/readiness/US-075.json (root-owned).
17. docs/superpowers/specs/2026-10-11-us-075-anchored-removal-design.md.
18. This plan.
19. docs/readiness/drafts/US-075-nous-routing-request.md (already changed).
20. .nous-feedback.jsonl (root-owned shared ledger).

No detail-page, transition-core, lifecycle.test, helper-file or export changes.

## Checkpoint1 — Preserve targeted start and deliver authorized discovery

**Files:** repository.ts, people-action-service.ts, repository.integration.test.ts.

**Contract:** existing startOffboarding(input:unknown) accepts explicit `{intent:"read_targets",personId}` without weakening its existing mutation parser. Export a web-owned optional response extension with targets `{requestId,label}` and a production-used intent executor using real repository/authorization/clock inputs. Existing wrapper/core and base contracts stay unchanged. Reads derive choices from authorized repository.detail and open sourceRequestId-backed assignments, exclude missing/mismatched anchors, and never invoke mutation or success invalidation. Mutation returns existing action state and exact invalidation paths for the Next cache adapter. No owned callback mock substitutes for this executor.

- [ ] Retain green Task1 checkpoints5a3f7e4/4b924d7: exact assignment-pointer guard, target parsing, one pending action/transition/audit, descriptor execution selection, Person/register/capacity preservation and concurrent/replayed starts. Do not reauthor already-green cases.
- [ ] Add real-DB executor oracles for authorized choices with two seats, absent/unanchored choices, nonadmin/foreign person, malformed read/mutation UUIDs and no writes/invalidation on reads/rejections. Execute the mutation intent through this same executor; assert one selected anchor, untouched other seat and exact successful invalidation paths.
- [ ] Run repository integration suite via package wrapper; capture missing-behavior RED. Implement minimal service intent/response composition using existing repository detail and mutation core, keeping wrapper/core unchanged.
- [ ] Run focused suite and rtk pnpm --dir apps/web type-check plus rtk pnpm --dir packages/domain type-check. Checkpoint feat(US-075): expose authorized offboarding targets. Brief reused reviewer with ACs/range/commands; launch touched preview only after both preflights route green. Slow DB previews once finally unless touched; no whole-set rerun.

## Checkpoint2 — Portable atomic finalization and replay-safe checklist

**Files:** lifecycle.ts; orchestration.ts/integration suite; checklist-action-transaction.ts/test; alert workflow integration fixture.

**Interfaces:** `finalizeOffboarding(command:OffboardingConfirmation,port:OffboardingTransactionPort):Promise<OffboardingCompletion>`. Command carries action/request/company/actor/confirmation identity and confirmedAt. Locked stored facts supply reason and exact assignment IDs. Completion returns original requestId/assignmentIds/endedOn/endReason/confirmedAt/replayed. Port.runAtomic executes one callback; locked persistence methods read evidence, close exact anchors, confirm action, transition request and audit. Existing orchestration exports finalizeOffboardingInTransaction(transaction:LedgerTransaction,authorization,command); use existing applyRequestTransitionInTransaction without changing transition-core/db. US-082 supplies its own adapter later and imports the same portable primitive.

- [ ] Add direct primitive plus realSQL adapter tests in existing orchestration suite: both reasons; exact anchor closure with unrelated seat untouched; Ecuador05:00Z boundary; close-before-start and malformed/cross-company/account/license anchor rejection; committed same/different-ID replay preserves original date/reason; changed context conflicts; controlled concurrent confirmations yield one completion; forced completion-audit database failure rolls back every write. Snapshot action/register/request/transition/audit evidence; no timing-only oracles.
- [ ] Run focused orchestration suite to establish RED. Implement request→action→sortedassignment locking and validated canonical remove or explicit legacy checklist/deprovision facts. Validate original anchor/context before replay return; guarded row-count closure; action confirmed/resolved_at/failure_reasonNULL; offboarding→deprovisioned transition and exactly one action completion audit in the same transaction. No capacity write.
- [ ] Extend pendingChecklist and confirmation predicates for remove/orchestration/offboarding, preserving provision branch. Branch removal before unconditional confirm wrapper audit; translate errors outside failed atomic callback. Test actual wrapper with real DB authorization, not mocked operations.
- [ ] Add actual not-done wrapper tests: pending/offboarding/open-register result, one failureId+reason attempt audit, sameID+reason no duplication, conflicting reason rejects, differentID distinct attempt, confirmed success clears failure_reason. Bypass unconditional markChecklistNotDone success audit for removal too. Preserve legacy removal and existing provisioning behavior; no offboarding→failed/provisioning_failure.
- [ ] Repair older alert fixture by binding license_request.license_assignment_id after its assignment insert and expecting kind=remove. Keep same-business-day persisted-context/deadline assertions intact; no alert production edits or US-077 expansion.
- [ ] Run focused orchestration/wrapper/alert suites and web/domain type checks. Checkpoint feat(US-075): finalize checklist removal atomically. Brief reused reviewer; collect prior preview and launch only newly touched routed preview within budget.

## Checkpoint3 — Both detail screens without page edits

**Files:** PersonOffboarding component/test; RequestRecord component/test; both locales.

**Contract:** preserve existing person-page props. PersonOffboarding calls explicit read_targets and displays authorized choices; request detail embeds it inside RequestRecord with fixedrequestId/personId. Optional web-owned response type is consumed without changing action wrapper/core. Additional labels come from the component locale context, not new page props.

- [ ] Add meaningful DOM/input/role/state oracles in both existing suites: fixed request/person target, selectable target choices, unavailable unanchored state, only left_company/inactive, disabled submission until selected, pending execution rather than deprovisioned claim. Use real localized component composition; do not mock owned action services to manufacture success. Actual command persistence remains proven through the production-used executor real-DB suite.
- [ ] Run both UI suites via package wrapper to establish RED. Implement target discovery/selection and fixed-target embedding with existing tokens/accessibility; reallocated receives localized canonical transfer refusal from server. Remove automatic departure wording. Manual pending links to existing request checklist; automated pending explains execution wait.
- [ ] Run both UI suites and targeted server suite if touched, plus web/domain type checks. Inspect unchanged person-page binding and RequestRecord embedding. Checkpoint feat(US-075): expose anchored removal on both detail screens. Reused scoped review and one touched preview follow focusedgreen.

## Review focus and final handoff

- [ ] Check same/different confirmation-ID replay, failure-ID conflict, immutable context, tenant/role rejection, Ecuador close date, forced atomic rollback and preserved provisioning. Fix only within manifest/budget; one final touched preview round after final fixes.
- [ ] Run both checks with original MUTATION_BASE: rtk pnpm test:mutation:preflight (accountability/oracles/seams), then rtk pnpm test:mutation --preflight (actual shard IDs/routing_gaps). Inspect all gaps and runtime metadata; no fake mutation score from registration. Launch previews with exact returned IDs in background and collect output/minutes.
- [ ] Root dispatches fresh adversarial AC1–4 verification after scoped review closes. Neighbor provider/capacity/person/departure/approval/invitation authority stays unchanged.
- [ ] Full gate: acquire /tmp/smp-full-gate.lock with fs.openSync(path,"wx"), record owner token/inode; on EEXIST wait≥60s. Hold for caffeinate -i pnpm check; finally release only matching token+inode. Never delete another session's lock. Use committed migration apply/verify via shared fixture; never dbpush.
- [ ] After final source/tests/review settle, run ONE cache-cleared diff-scoped cold campaign last with original MUTATION_BASE. No scored edits afterwards without invalidation. Report measured scores and reviewed one-line survivors.
- [ ] Root records phase timestamps, test_report/actuals/done and integration. Implementer reports real available cost metrics or clearly estimated nonzero cost, one session, preview_rounds/minutes. No additional implementation starts before root continuation release.

## Self-review and budget

AC1 maps checkpoint1+3; AC2 checkpoint2; AC3 checkpoint2+3; AC4 allthree and fresh verification. Every rejection/replay/rollback input has a responsible oracle. Exact20 paths include existing request paperwork and alert fixture. Six stock planned shards; domain adjacent tests stay unchanged and finalizer tests execute directly with its real adapter.

Whole-item forecast40 readiness/reassessment/design/planning +150 production/ALL test authoring +45 focused/previews +45 ALLreview/adversarial/boundedrepairs +35 sharedfixture/gate/ONEcold/integration =315. CompletedTask1 counted once; previews≤30 inside focused allowance. Moderate-low confidence/five-minute headroom; additional path/boundary/materialrepair or forecast>320 requires reassessment. This documentation commit does not release code continuation; root scoped review does.


## Final verification release — delegated budget correction

Current approved readiness digest: 7a34a47724c6a0a83284f611a715753e87039c8efd0513dc159edd5308f38a62 (US075-READY-DELEGATED-20261011-V4). Root reviewed this documentary correction under Francisco's explicit Astra/controller delegation. Same20 paths, fourACs and315 total; no production/test change. Revised disjoint phase forecast55 readiness +55 implementation +10 focused +105 review +90 integration =315.

Provisional conservative nonoverlapping elapsed envelope at 2026-10-11T22:09:47.016Z: 169.767 minutes, rounded up 170. Git/recorded-ts windows [["2026-10-11T08:34:50-05:00","2026-10-11T08:45:29-05:00"],["2026-10-11T09:44:33-05:00","2026-10-11T09:59:30-05:00"],["2026-10-11T11:10:58-05:00","2026-10-11T12:27:57-05:00"],["2026-10-11T14:23:07-05:00","2026-10-11T14:30:57-05:00"],["2026-10-11T16:10:26-05:00","2026-10-11T22:09:47.016Z"]]. Anchors 11b03ad→7b26d51,00f2b15→fff48a0,bbea2f1→d3311e3,5917e1b→c04b812,95fac1f→cutoff. Gaps are evidenced pending canonical amendment/approval and separately owned technical prerequisites; no inference that Git records every read-only minute. Included windows retain technical overlap conservatively. Concurrent agent labor and commands nested inside phases count once; preview/cold minutes are subsets, not added again. Unobservable phase buckets are absorbed into their enclosing phase. Summed agent labor and unsupported 110-minute authoring estimate rejected. Remaining reserve95: gate/setup15,cold/setup55,survivor review/bounded repair15,evidence/closure10; contingency50 below315 covers reconstruction uncertainty. This is provisional reconstructed elapsed, not billing telemetry or final actuals.

This section overrides every remaining optional per-task/final mutation-preview checkbox above: omit them under an explicitly recorded bounded CHG-069 exception. Earlier invalidated preview and zero-mutant dry instrumentation remain charged (~6.7min); no unrun preview is claimed. Fresh independent adversarialAC1–4 is already PASS. Release same implementer now to owned-lock caffeinate -i pnpm check and all actual six native shards in a cache-cleared cold campaign last, original whole-item base unchanged. Threshold80 and every-survivor review stay mandatory. Failed/fixed attempts require preserved evidence and explicit invalidation; never accept a failed score to preserve an attempt count. No further policy consultation is required for this bounded release.
