# US-075 — Anchored removal entrypoint and atomic checklist completion

## Authority and intent

Work item: US-075, amended by CHG-076. Readiness: `docs/readiness/US-075.json`, approved payload `f22f1c08dc0f47572ad346432cb4556b5571fdc1d151b80360ad6f5253a5952a`, recorded at `e14f813`, approved whole-item estimate 315 minutes. Francisco delegated readiness, design, planning and execution decisions within this scope and budget; root reviews this revised design and plan before releasing code continuation. Historical Task 1 approval and checkpoints remain valid; no duplicate started event or implementer restart is invented.

A Group Admin selects an anchored active seat from person or request detail, starts its removal for `left_company` or `inactive`, and sees the request enter `offboarding`. A manual removal reaches `deprovisioned` only when the administrator confirms the checklist. That confirmation closes the anchored register rows, confirms the action, records the request transition and its audit atomically. Connector actions remain pending for US-082.

Canonical authority: DEC-SMP-031/032/033/040/042 and the amended US-075 ACs. AC4's connector-backed “no state change” is interpreted by the approved readiness as no completion beyond the required `active → offboarding`; the request does not remain active.

## Scope and ownership

Three explicit scopes: domain, server and UI. Two existing detail screens; one removal lifecycle/concurrency boundary from targeted start through committed finalization. No packages/db, packages/contracts, connector, worker, migration, grant, package-export or dependency edits.

US-076 owns explicit person-wide departure confirmation and its atomic Person.status update. This design preserves Person.status for every removal reason. US-028 alone authorizes `flagged_inactive → offboarding`; the ordinary entrypoint accepts only active requests. US-082 owns provider execution, claims, bounded connector retries, sanitized provider errors, “already removed” interpretation and its worker persistence port. US-077 owns overdue evaluation and consumes the original start transition. US-081 owns watermark/projection/manual refresh; the completion transition's occurred_at is its closure instant. US-068/069 retain invitation-only removal. There is no implicit capacity refresh, seat_freed recovery change or optimistic capacity mutation here.

`reallocated` is refused as a transfer reason under BR-02. The existing deferred contiguous-successor trigger stays intact. No transfer UI or successor creation is delivered.

## Entry contract and target selection

The exported server action remains `startOffboarding(input: unknown)`. Existing contracts stay unchanged. The server composes its target parser from `startOffboardingInputSchema` with optional `requestId`; base personId/endReason/note validation is reused. Parsed reallocated gets the explicit localized transfer-only rejection before writes. The repository receives the parsed base input plus the server-owned target field; there is no duplicate base schema.

Both screens submit a requestId. Request detail supplies its own record's request ID and person ID. PersonOffboarding obtains authorized target choices through the existing startOffboarding action with `{ intent: "read_targets", personId }`, labelled by vendor account and license type. The service uses the real authorized repository.detail projection and returns only currently open source-request anchors. This explicit read intent creates no action, transition or audit and performs no mutation-success revalidation. The existing person detail page remains unchanged. RequestRecord embeds the same component with its own fixed request/person IDs; the existing request detail page remains unchanged. No selection means no submission. Legacy imported rows lacking sourceRequestId are excluded and show an unavailable explanation; no source request is manufactured. No person-wide default is implied by omission of requestId: an absent target may be inferred only when exactly one open anchored request exists; multiple anchors require selection. US-076 can later invoke the shared start machinery with its explicit person-wide transaction, without changing this ordinary action's meaning.

The server resolves the request and assignments and verifies person/company/vendor-account/license-type consistency. Hidden fields and page bindings are not trusted authorization evidence. Group-admin permission follows the existing authorization model; no new company boundary for globally authorized group admins is invented. Non-admins and mismatched anchors are refused. Read and write predicates use the authoritative company_id, including replay lookup.

Within the audited start transaction, use a consistent request/assignment lock order, recheck active state, verify the target's currently open anchored rows and create exactly one removal action plus active→offboarding transition. A compatible offboarding replay returns the existing action IDs without another start audit; a changed reason/target or incompatible action conflicts. The reason and exact assignment IDs are captured in the immutable action context. Never select unrelated person-wide rows.

The shipped planner supplies checklist payload and execution facts. Consume US-025's persisted descriptor: account.mode=automated, Vendor.canDeprovision=true and provisioning_protocol=rest select shipped Anthropic R1 removal. Other descriptors select the planner's existing manual fallback. Do not import or introspect the provider factory; provider runtime composition belongs to US-082. Build the valid existing planner payload, then normalize kind/mode and remove checklistSteps for the selected automated execution. Normalize persistence to kind=remove in both modes: automated when the descriptor supports deprovision, orchestration otherwise. Preserve status=pending and operation=deprovision. No shared planner contract is changed. The persisted shipped descriptor selects supported REST removal independently of dispatcher registration. Unsupported protocols/capabilities fail closed into the existing manual checklist.

## Domain finalization primitive

Add exported `finalizeOffboarding` to the existing `packages/domain/src/request-workflow/lifecycle.ts`, available through its existing request-workflow and root exports. The controller approves the module placement as part of this design; no export configuration changes are needed.

The primitive takes a trusted confirmation command and a transactional persistence port. The command includes action/request/company identity, actor, confirmation identity, and confirmedAt. The immutable persisted action context supplies endReason and assignment IDs; a caller cannot substitute them during confirmation. Checklist confirmation identity uses the existing confirmationId contract. US-082 supplies a stable provider-success identity under its own design.

The port executes one atomic callback and supplies locked authoritative facts and persistence operations. Facts cover action identity/kind/mode/status, request state and ownership, immutable deprovision context, anchored assignment identities and existing completion evidence. The primitive:

1. Requires validated confirmation evidence and an accepted removal reason.
2. Requires action/request/account/company/person/license consistency and exactly the immutable anchored assignment set.
3. On a committed completion, returns its original closed date/reason/transition/result without writes. Different confirmation IDs for the same completed removal also return that committed result; neither rewrites the first confirmation identity. An attempted change to the immutable reason or anchor is a conflict.
4. Otherwise requires request=offboarding and a pending/retryable removal action, with every anchored row still open. Partial or contradictory prior closure is a conflict, never repaired by guessed dates.
5. Derives ended_on from confirmedAt in America/Guayaquil and rejects an invalid instant or a close before started_on.
6. Commands the port to close the exact rows, confirm the action, record offboarding→deprovisioned with occurred_at=confirmedAt, and persist one successful completion audit in that transaction.

The domain primitive owns the finalization decision and operation order; the persistence adapter owns SQL and locks. It is portable: US-082 can supply a worker transaction port without importing a web module. The worker may call the same primitive, but its orchestration must not bypass it with direct register/request/transition updates.

## Web transaction adapter and concurrency

Export the removal transaction adapter from existing `apps/web/src/modules/request-workflow/orchestration.ts`; keep transition-core.ts unchanged. Use the caller-owned LedgerTransaction, existing tables, ecuadorOperatingDate semantics and existing applyRequestTransitionInTransaction. Do not change packages/db. The adapter verifies authorization and authoritative company/anchor predicates before returning replay evidence or mutating rows.

Lock the request first, then its action and anchored assignments in deterministic order. Entry and finalization use the same request-before-assignment order; avoid acquiring a person-wide lock followed by requests in the reverse order. No provider call is made while these locks are held. The request lock serializes action creation and duplicate confirmation; the existing checklist unique index does not cover kind=remove, so uniqueness must not be claimed from that index. Creation checks compatible existing remove actions while holding the request lock.

Closure writes have ended_on IS NULL and exact anchor predicates, with affected-row counts checked. Completion rechecks status and updates status/resolved_at; transition goes through the existing helper. Its built-in request.deprovisioned audit is retained. Add one removal-action completion audit containing the immutable assignment IDs, confirmedAt, endedOn, reason and first confirmation identity. Replay returns those committed facts and adds neither action nor transition audit.

All writes share the transaction, including action completion and both canonical success audit records. Any closure, action, transition or audit failure rolls back the entire operation. The adapter must not swallow SQL errors inside the transaction and commit a partially completed unit. Error translation occurs outside the atomic callback.

Existing ended_on/end_reason and action status/resolved_at/failure_reason grants suffice. Immutability is enforced by the locked command and replay rules; this design does not claim the database grants alone prohibit another application path from rewriting permitted columns. A required new database invariant or grant is a readiness scope change, not an unrecorded patch.

## Checklist confirmation and unconfirmed removal

Extend pendingChecklist and confirmation predicates for canonical remove/orchestration/offboarding, while leaving provisioning checklist and invitation flows separate. The existing ChecklistPanel and localized removal steps are reused. On request detail the pending checklist remains visible after start; person detail links the selected request so the same confirmation path is reachable. Confirmation does not immediately imply a provider observation or a capacity refresh.

For removal, the confirm action invokes the domain primitive through the web adapter. Branch before the existing withAudit success wrapper so replay does not append server_action.confirmChecklistDone again: the finalizer owns the successful removal audit. Rejections retain an authorization/invalid-command audit where appropriate, but must occur outside a rolled-back mutation callback. Existing provisioning confirmation behavior remains unchanged.

Administrator “not done” is an unconfirmed checklist attempt, not a provider failure. Proposed builder choice: keep the removal action pending and request offboarding, record its failure reason and one attempt audit, and allow confirmation after the administrator retries the vendor steps. This keeps the existing panel's pending/sent contract and avoids inventing a provider retry mechanism or an exceptions-screen delivery in US-075. No provisioning_failure, provisioning→failed or offboarding→failed transition is emitted. US-082's confirmed transport/provider failure does mark its automated action failed as DEC-SMP-042 specifies. The reused reviewer checks this distinction against the canonical failure clauses. The stored attempt audit binds failureId to reason: same ID and reason replays without another audit; conflicting reuse rejects; a different ID is a distinct attempt. Removal not-done bypasses the unconditional wrapper success audit, and later confirmation clears failure_reason.

For pre-amendment orchestration actions already stored as kind=checklist with operation=deprovision, recognize them as legacy removal facts if their complete immutable anchor/reason context validates. Do not rewrite kind/raw_request or claim they are canonical new actions. New starts always create kind=remove. Legacy compatibility has the same locked finalization and replay invariants; incompatible or incomplete contexts are refused.

## UI and presentation

Reuse PersonOffboarding on both screens. The component loads authorized choices with read_targets on person detail; RequestRecord supplies a fixed request target on request detail. Keep both detail page files unchanged. Define an optional web-owned response extension in people-action-service.ts for target choices; the existing action wrapper, core and packages/contracts remain unchanged. The production-used intent executor accepts real repository/authorization/clock inputs, handles both read and mutation intents, and exposes the exact mutation invalidation paths for the production Next cache adapter. Test the executor directly with the real repository; do not replace owned services with fake callbacks. Existing labels remain accepted; additional localized target/reason/pending strings are read inside the shared component, so page labels need no edits. Keep current design tokens and accessibility behavior. Expose only left_company/inactive choices; server-side reallocated submissions receive the explicit BR-02 error. Existing person departure text must describe seat removal without claiming automatic person departure. All additions go to es-EC/en-US locale catalogs.

Successful start displays offboarding and links/revalidates the target request; it does not display deprovisioned. Checklist success comes only from the committed finalizer. Connector-backed pending removal gets an execution-pending explanation and no checklist. Capacity is not incremented or refreshed by this action; authoritative stale projection remains US-081. AC4 capacity evidence here is unchanged stored capacity and no refresh invocation, not a claim that the pre-US-081 calendar-derived projection is already repaired.

## Verification and acceptance evidence

Read TESTING.md before test edits. Use the shared CHG-067 Postgres fixture and ledger_app runtime; no private containers or mocks of owned services. Add strong real-DB oracles to the existing repository and orchestration integration suites and targeting/reason assertions to the existing person-offboarding UI suite.

Repository cases cover both reasons, explicit single-anchor selection with another untouched seat, active→offboarding, connector pending versus checklist execution, no Person.status/capacity mutation, reallocated refusal, wrong role, foreign/mismatched anchor, repeated start and concurrent start. The unchanged person page binding and modified RequestRecord embedding are inspected in scoped review; both existing component suites exercise fixed and selectable targets without mocking owned actions. Service oracles execute the actual production-used intent executor, assert authorized read choices and absence of writes, and assert exact invalidation paths only on successful mutation.

Orchestration cases directly execute finalizeOffboarding and its real transaction adapter. CHG-081 at b6e67ea canonically routes lifecycle.ts to this real-DB suite; the stock domain shard also retains existing adjacent lifecycle.test.ts, which stays unchanged. Registration runtime proof at95fac1f is prerequisite evidence, not US-075 feature evidence. They assert exact persisted assignment/action/request/transition/audit facts: Ecuador midnight boundary, successful both reasons, unrelated anchored rows untouched, unconfirmed attempt, first confirmation, replay with same/different confirmation IDs, conflicting context, controlled concurrent confirmation, and forced database failure before completion audit proving complete rollback. The concurrency oracle observes committed row and audit counts, not timing. Existing provisioning behavior remains covered by its current suite.

The reused reviewer reviews the scoped diff and commands. A fresh adversarial reviewer exercises AC1–4 only after implementation reviews close. Previews follow CHG-069 touched-shard rules, one round per task plus one final fix round, total≤30 minutes, slow shards once finally unless touched. Actual shard routing is established by preflight; routing gaps invalidate score claims. One cold diff campaign is last, after adversarial verification and final source/test changes.

Full gates use caffeinate -i pnpm check with /tmp/smp-full-gate.lock owned throughout; never remove another session's lock. No execution phase, started, mutation-base freeze or gate is authorized by this document alone. Continuation begins after root reviews the revised design and bound plan and records its entry head under the existing delegated authority.

## Surface and estimate

The exact inclusive 20-path manifest is:

- packages/domain/src/request-workflow/lifecycle.ts.
- apps/web/src/modules/org-registry/repository.ts, repository.integration.test.ts, people-action-service.ts.
- apps/web/src/modules/request-workflow/orchestration.ts, orchestration.integration.test.ts, actions/checklist-action-transaction.ts, actions/checklist-action-transaction.test.ts.
- apps/web/src/modules/alerts/offboarding-workflow.integration.test.ts.
- apps/web/src/components/people/person-offboarding.tsx, person-offboarding.test.tsx.
- apps/web/src/components/requests/request-record.tsx, request-record.test.tsx.
- apps/web/messages/es-EC.json, en-US.json.
- docs/readiness/US-075.json, this design, docs/superpowers/plans/2026-10-11-us-075-anchored-removal.md, docs/readiness/drafts/US-075-nous-routing-request.md, .nous-feedback.jsonl.

The older alert fixture must bind license_request.license_assignment_id to its actual source-request assignment and expect canonical kind=remove. Preserve its real persisted-context and same-business-day alert oracle; no US-077 delivery is added. Generated guides and canonical prerequisite files remain read-only. No domain adjacent-test, transition-core, detail-page, barrel or tooling edit is included.

Stock planned-scope selection at95fac1f produces six shards: person UI, request record UI, merged repository/service, checklist wrapper, orchestration, and domain with both adjacent and real-DB suites. Actual IDs are recomputed after implementation; imports alone are not effectiveness evidence.

Disjoint whole-item forecast: readiness/design/planning/reassessment40, production and all test authoring150, focused verification/previews45, all review/fresh AC verification/bounded repairs45, shared fixture/full gate/one cold campaign/integration35 =315 minutes. Completed Task1 is counted once; technical prerequisites are separate items. Five minutes of headroom is not permission to exceed320. New paths, boundaries or a forecast above320 require reassessment. Preserve whole-item MUTATION_BASE37666528d03a50e2529cad4382f2a5ae146dca63; root records a new continuation head after this document review without discarding Task1 from mutation scope.

## Builder choices requiring reviewer scrutiny

The proposed manual not-done pending interpretation, legacy checklist removal compatibility, request-before-action/assignment lock order, replay across different confirmation IDs, and no optimistic capacity claim are concrete builder choices. They do not supersede canonical decisions. Material objections are returned to root before code continuation. Delegated human authority is already bound to the revised readiness digest; root scoped review and continuation release are required, not another human approval question.

Execution ruling (controller/reused reviewer): persisted US-025 Vendor capability flags and protocol, not a provider-factory import, are the production planning authority. This preserves the approved scopes/outcome/budget. The upstream provider ESNext ReadonlySet structural mismatch exposed by factory import is named deferred compatibility; no connector source, suppression or dynamic import is added here.


## Final verification release — delegated budget correction

Current approved readiness digest: 7a34a47724c6a0a83284f611a715753e87039c8efd0513dc159edd5308f38a62 (US075-READY-DELEGATED-20261011-V4). Root reviewed this documentary correction under Francisco's explicit Astra/controller delegation. Same20 paths, fourACs and315 total; no production/test change. Revised disjoint phase forecast55 readiness +55 implementation +10 focused +105 review +90 integration =315.

Provisional conservative nonoverlapping elapsed envelope at 2026-10-11T22:09:47.016Z: 169.767 minutes, rounded up 170. Git/recorded-ts windows [["2026-10-11T08:34:50-05:00","2026-10-11T08:45:29-05:00"],["2026-10-11T09:44:33-05:00","2026-10-11T09:59:30-05:00"],["2026-10-11T11:10:58-05:00","2026-10-11T12:27:57-05:00"],["2026-10-11T14:23:07-05:00","2026-10-11T14:30:57-05:00"],["2026-10-11T16:10:26-05:00","2026-10-11T22:09:47.016Z"]]. Anchors 11b03ad→7b26d51,00f2b15→fff48a0,bbea2f1→d3311e3,5917e1b→c04b812,95fac1f→cutoff. Gaps are evidenced pending canonical amendment/approval and separately owned technical prerequisites; no inference that Git records every read-only minute. Included windows retain technical overlap conservatively. Concurrent agent labor and commands nested inside phases count once; preview/cold minutes are subsets, not added again. Unobservable phase buckets are absorbed into their enclosing phase. Summed agent labor and unsupported 110-minute authoring estimate rejected. Remaining reserve95: gate/setup15,cold/setup55,survivor review/bounded repair15,evidence/closure10; contingency50 below315 covers reconstruction uncertainty. This is provisional reconstructed elapsed, not billing telemetry or final actuals.

This section overrides every remaining optional per-task/final mutation-preview checkbox above: omit them under an explicitly recorded bounded CHG-069 exception. Earlier invalidated preview and zero-mutant dry instrumentation remain charged (~6.7min); no unrun preview is claimed. Fresh independent adversarialAC1–4 is already PASS. Release same implementer now to owned-lock caffeinate -i pnpm check and all actual six native shards in a cache-cleared cold campaign last, original whole-item base unchanged. Threshold80 and every-survivor review stay mandatory. Failed/fixed attempts require preserved evidence and explicit invalidation; never accept a failed score to preserve an attempt count. No further policy consultation is required for this bounded release.
