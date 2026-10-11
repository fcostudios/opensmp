**Work item:** US-075
**Readiness assessment:** docs/readiness/US-075.json
**Approved estimate:** 280 minutes

# Anchored removal implementation plan

**Goal:** Start one authorized anchored removal from either detail screen and finalize its confirmed checklist removal atomically, preserving Person.status.

**Architecture:** Existing web entrypoint selects a target and persists a pending remove action. The existing domain workflow module exports finalizeOffboarding; the existing web transition module supplies its caller-owned atomic transaction port. No provider dispatch or capacity refresh is delivered here.

**Tech stack:** Next.js App Router, TypeScript, Zod, Drizzle/PostgreSQL, Vitest, existing design tokens and locales.

**Spec:** docs/superpowers/specs/2026-10-11-us-075-anchored-removal-design.md (9ef6da2); reviewed in dd7fd70, approved with standing execution authorization in70826e1. Readiness digest f5aebfbc0dca0fa6496d625083e78b6fec1eefd4d4ccf662de9847259ab7d5d7. The user supplied the execution method: one consolidated implementer, one reused scoped reviewer, fresh adversarial verifier last. No additional human plan approval is required within this approved scope/budget. Root reviews this plan and freezes/records the mutation base before implementation starts.

## Global constraints

- Three scopes: domain/server/UI, two existing screens, one removal lifecycle boundary, approved18path manifest, hard20file maximum. No db/contracts/worker/connectors/package exports/dependency/generated guidance changes.
- Accepted reasons left_company/inactive; reallocated is refused with explicit BR-02 transfer message. US-028 alone owns flagged_inactive approval; ordinary starts accept active.
- Person.status unchanged. Request detail targets its own request; person detail explicitly selects an open anchored seat. Missing target inferred only for exactly one open anchored request.
- Checklist actions persist kind=remove/mode=orchestration; connector-backed actions kind=remove/mode=automated; statuspending. No transport, credentials, provider dispatch or capacity/watermark mutation.
- Shared CHG-067 Postgres fixture via SMP_TEST_POSTGRES_CLUSTER_URL, never private containers. Read TESTING.md before edits; real owned implementations, deterministic injected dates, tenant/role assertions, no print/log oracle.
- Canonical generated TESTING.md/critical-paths stay read-only. Any required registration is requested through Nous; do not quietly omit it.
- Each task gets a checkpoint commit carrying US-075 and a bounded reused review. Root owns lifecycle feedback. Stop at a task boundary and report blocked/deviation if remaining work exceeds the approved estimate.

## Review focus

1. Same request replays with a different confirmation ID: original committed date/reason/result, no extra success audit.
2. Manual not-done failureId replay: same ID+reason does not duplicate attempt; conflicting reuse rejects; later confirmed success clears failure_reason.
3. Mixed person/account/company/license anchors and non-admin identities reject without mutating a foreign row; global group-admin permission is not silently redefined.
4. Midnight Ecuador close and close-before-start rejection: ended_on derives from confirmedAt; rollback covers closure/action/transition/audit.
5. Legacy checklist/deprovision context and existing provisioning checklist: legacy removal validates original anchor; provisioning behavior is unchanged, no accidental failure transition or alert from removal.

## File responsibilities

Modify packages/domain/src/request-workflow/lifecycle.ts (portable primitive and types); apps/web/src/modules/request-workflow/transition-core.ts (atomic removal SQL port); org-registry/repository.ts (targeted start/selection/replay); org-registry/people-action-service.ts (composed target parser/revalidation); request-workflow/orchestration.ts (manual confirmation/attempt integration); request-workflow/actions/checklist-action-transaction.ts (removal branch/replay audit ownership).

Modify components/people/person-offboarding.tsx; app/(authenticated)/personas/[personId]/page.tsx; app/(authenticated)/solicitudes/[requestId]/page.tsx; messages/es-EC.json; messages/en-US.json (both screen bindings, target/reason/control presentation).

Modify org-registry/repository.integration.test.ts; request-workflow/orchestration.integration.test.ts; components/people/person-offboarding.test.tsx (strong existing-suite oracles). Readiness, design, this plan and .nous-feedback.jsonl comprise the remaining four approved paths. No new helper files or barrels are assumed.

## Task1 — Targeted audited start and pending execution selection

**Files:** repository.ts, people-action-service.ts, repository.integration.test.ts.

**Produces:** server-owned `OffboardingTargetInput = StartOffboardingInput & { readonly requestId?: string }`; repository.startOffboarding(authorization, input:OffboardingTargetInput, occurredAt?:Date) keeps its existing result. Parser composes existing startOffboardingInputSchema with optional UUIDrequestId; packages/contracts unchanged. No mutation occurs on reallocated input.

- [ ] Add real-DB cases named `targets_one_anchor_and_preserves_other_seat`, `plans_pending_remove_for_shipped_rest_capability`, `reallocated_requires_transfer`, `start_replay_has_one_transition_and_audit`, `mismatched_anchor_and_nonadmin_leave_rows_unchanged`. Assert exact action kind/mode/status/rawcontext, request state, unchanged Person.status/register/capacity and audit counts for left_company/inactive. Include two competing starts with controlled database locks and persisted-count oracle.
- [ ] Run `rtk pnpm --dir apps/web exec vitest run src/modules/org-registry/repository.integration.test.ts`; establish missing-behavior failures before production edits, shared fixture env supplied. Save output to /tmp task log when large.
- [ ] Compose target parsing in service, pass the server-owned type to repository and revalidate target request after successful start. Lock authoritative request before assignments; select only its anchored rows. Missing target may resolve only one open anchored request. Preserve Person.status. Reject incompatible reason/target replay.
- [ ] Plan execution with shipped capability metadata without provider invocation; reuse manual payload and persist kindremove for both modes. Use request lock to serialize action creation, because checklist unique index does not cover remove. Replace this start method's unconditional withAudit replay with one caller-owned transaction and success audit only for a newly committed start; do not modify shared audit utility.
- [ ] Run focused suite and web/domain type checks. Commit `feat(US-075): start targeted removal with pending execution selection`. Request reused scoped review with task ACs/range/commands; implementer launches touched preview in background after focusedgreen/preflight and continues Task2. Routing gaps are review findings, not scores.

## Task2 — Portable finalization and atomic manual checklist path

**Files:** domain lifecycle.ts; web transition-core.ts, orchestration.ts, checklist-action-transaction.ts; orchestration.integration.test.ts.

**Interfaces:**

- Domain exports `finalizeOffboarding(command:OffboardingConfirmation, port:OffboardingTransactionPort): Promise<OffboardingCompletion>`. Command fields actionId/requestId/companyId/actorUserId/confirmationId/confirmedAt; authoritative stored reason/assignment IDs come from locked facts, never the confirmation caller. Completion fields requestId/assignmentIds/endedOn/endReason/confirmedAt/replayed.
- `OffboardingTransactionPort.runAtomic<T>(work:(tx:OffboardingPersistencePort)=>Promise<T>):Promise<T>` owns exactly one transaction. Persistence methods lock authoritative facts, read original completion, close exact open anchors, confirm action, transition request and write action completion audit. Domain controls decision/order. Completion facts validate kindremove or explicit legacy checklist+deprovision, request/account/company/person/license consistency and immutable anchor set.
- Existing web transition-core exports `finalizeOffboardingInTransaction(transaction:LedgerTransaction, authorization:LedgerAuthorization, command:OffboardingConfirmation):Promise<OffboardingCompletion>`. Its port executes within the existing caller transaction; SQL failure propagates to rollback. US-082 later supplies its own transaction port to the same domain primitive; no web dependency or direct workflow bypass required.

- [ ] Directly import primitive and adapter in real-DB orchestration suite. Add `confirmation_closes_exact_anchor_atomically`, `ecuador_date_is_confirmation_date`, `replay_returns_original_evidence_without_audit`, `concurrent_confirmation_has_one_completion`, `invalid_anchor_and_close_before_start_roll_back`, `audit_failure_rolls_back_every_write`. Use deterministic explicit instants either side of 05:00Z and row/audit snapshots. Different confirmationId replay returns original evidence; mutated context/reason conflicts.
- [ ] Run focused orchestration suite and inspect expected new failures. Implement domain decision and web SQL adapter in existing modules. Request→action→sortedassignment locks; validate before replay return. Row-count guarded close, actionconfirmed with resolved_at and failure_reasonNULL, existing transition helper for offboarding→deprovisioned, exactly one action completion audit. No optimistic capacity or watermark write.
- [ ] Extend pendingChecklist/confirm selection for remove+orchestration+offboarding and validated legacy checklist/deprovision. Keep provision branch separate. Caller confirmation transaction invokes adapter. Removal success bypasses unconditional server_action.confirmChecklistDone withAudit so committed replay cannot create another success audit; errors are translated outside failed atomic mutation.
- [ ] Add `not_done_is_unconfirmed_and_retryable`, `failure_id_replay_is_not_a_second_attempt`, `failure_id_conflict_rejects`, `success_clears_prior_manual_reason`, `provisioning_checklist_still_works`. Not-done removal remains pending/offboarding/registeropen, records reason and one failureId+reason audit. Same ID+reason replays; changed reason for same ID rejects; different failure ID is a distinct attempt. No provisioning_failure or offboarding→failed transition. Confirmation clears prior manual reason.
- [ ] Run both focused real-DB suites and web/domain type checks. Commit `feat(US-075): finalize checklist removal atomically through shared domain primitive`. Collect Task1 preview at review boundary, brief reused reviewer for Task2, then launch Task2 touched preview in background after focusedgreen and continue Task3. No whole-set rerun.

## Task3 — Both detail-screen bindings and removal presentation

**Files:** PersonOffboarding component/test, both detailpages, es-EC/en-US catalogs; service only if target revalidation correction is required.

**Produces:** PersonOffboarding retains existing action/labels/personId props plus optional fixedrequestId or anchored choices `{requestId,label}`. Person detail passes open sourceRequestId-backed choices; requestdetail binds its record request/person IDs. New labels stay in existing catalogs. The component submits requestId alongside the existing baseinput; no shared contract edit.

- [ ] Update existing UI suite for visible anchored target choices and fixed target, two allowed reasons, unavailable/disabled unanchored state, accessibility and no deprovisioned claim after start. Assert DOM/input behavior that kills targeting/reason mutants. Do not add fake implementations of owned services to produce success; submit-path persistence is proven in the real-DB suites. Retire or adapt existing mocked-owned action assertions according to TESTING.md.
- [ ] Run `rtk pnpm --dir apps/web exec vitest run src/components/people/person-offboarding.test.tsx` and verify missing targeting/reason behavior fails. Update component, pages and locale text. Manual actions link to target request for existing checklistconfirmation; automated actions explain pendingexecution without checklist. Preserve tokens, focus/error behavior and role gating. Remove automatic-departure wording and reallocated selectable option; server remains explicit refusal authority.
- [ ] Run three focused suites and web/domain type checks. Inspect both screen action bindings in scoped review; assert mismatched hidden target still rejects in server suite. Commit `feat(US-075): expose anchored removal on person and request detail`. Collect Task2 preview; brief reusedreviewer, launch Task3 touched preview after focusedgreen. Preview slow DB shards once at finalround unless touched; totalpreviewminutes≤30.

## Final review, fix wave and closure handoff

- [ ] Fix scopedreview findings within approvedmanifest/budget. Check final failureId handling, clears, replay-audit bypass and original reason/date immutability. Commit each meaningful fixwave with US-075; one touched-shard finalpreview permitted. Record rounds/minutes and one-line survivor disposition with reviewer verdict. Exceeding previews requires named reason.
- [ ] Run preflight `MUTATION_BASE=<frozen-sha> rtk pnpm test:mutation:preflight` (root package script: node scripts/mutation-preflight.mjs) with the recorded base; inspect every routing gap and actual shard count. Preview launches use exact shard IDs emitted by preflight with `MUTATION_SHARD=<id> pnpm test:mutation`, in background, rooted in this worktree. Never fabricate domain coverage from imports alone; kill meaningful domain mutants with persisted oracles.
- [ ] Root dispatches fresh adversarial AC1–4 review after reused scopedreview closes. AC1 targets+auth+pendingselection; AC2 atomicclose/date/reason/rollback/replay; AC3 manualconfirmation vs providerpending; AC4 bothscreens/reasons/refusals/unconfirmed/unchangedcapacity. Capacity claim is no write/refresh at start; pending-refresh projection belongs US-081.
- [ ] Fullgate uses shared CHG-067 fixture. Acquire the shared regular file /tmp/smp-full-gate.lock atomically using fs.openSync(path, 'wx') (O_EXCL), record a unique owner token and the acquired file inode, wait≥60s on EEXIST while another session owns it, and release in finally only when both the current owner token and inode still match this acquisition. Never use mkdir for this regular-file protocol or delete a foreign/replaced lock. While held run `caffeinate -i pnpm check`; committed migration freshapply/verify evidence comes from sharedfixture/applier/verifier, no dbpush. Gate output stays in /tmp summary logs.
- [ ] After final review/source/tests settle, run exactly one cache-cleared diffscopedcold mutation campaign with frozen MUTATION_BASE. No edits to scored source/tests/config/dependencies afterwards without invalidation. Report score/killed/survived and one-line reviewed survivor dispositions to root.
- [ ] Root emits buildpass/acverify/testreport/actuals/done in protocol order, phase ts markers and real measured or clearly estimated cost. Implementer gives one-line cost/sessioncount and previewrounds/minutes. Actuals/final paperwork stay in readiness/feedback paths. Root integrates sequentially and reports any non-fast-forward rather than forcing it.

## Self-review and budget

AC1 maps Task1+3; AC2 Task2; AC3 Task2+3; AC4 allthree+freshadversarial review. Each ReviewFocus case is pinned to Task1 or2 test steps. Interfaces preserve unchanged basecontracts and existing moduleexports. Domain persistenceport and caller transaction share one lifecycle boundary; no second queue claim boundary is introduced.

Budget remains readiness30 +implementation115 +focusedverification55 +review55 +integration25 =280minutes. Preview budget≤30minutes is tracked separately as actuals inside verification allowance. Additional requiredpaths/scopes are reported at taskboundary before mutation. Planapprovalreview/freeze are the only outstanding entry steps; this plan itself starts no execution.
