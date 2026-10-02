**Work item:** US-068
**Readiness assessment:** docs/readiness/US-068.json
**Approved estimate:** 310 minutes

# Manual invitation withdrawal implementation plan

**Goal:** An authorized Group Admin withdraws the selected pending invitation, releases its reservation only after confirmed provider deletion, and sees actor/note in Acciones.

**Spec authority:** docs/stories/sprint-3/r1_misc_us_068.md; docs/readiness/US-021.json partitions[proposal_key=manual-invite-withdrawal]; DEC-SMP-023 in docs/decisions/DECISION_MATRIX.md. US-067 is dev_done at ba88eee.

**Architecture:** Shared DB service owns a durable withdraw_invite intent and guarded finalization under the original invitation advisory lock. A distinct optional connector method targets only its provider reference. Server action obtains trusted authorization and composes real lifecycle validation; existing exceptions table submits a required note and request action ID. Request Acciones reads scoped audit actor/note. US-069 will reuse the service with system actor context.

## Global constraints
- AC1: withdrawInvite requires Group Admin and nonempty note, targets exactly the selected pending invitation through an invitation-specific vendor-neutral connector operation pinned to its durable vendor_ref, never email member removal; invited -> deprovisioned uses the real lifecycle engine.
- AC2: Release the reservation only after confirmed provider deletion. Refuse acceptance races, preserve every active member and LicenseAssignment, and fail closed on ambiguous outcomes.
- AC3: Persist a distinct durable ProvisioningAction visible in Acciones with actor and note.
- AC4: Prove the complete exceptions-to-provider-to-freed-capacity-to-Acciones demo and acceptance-race refusal.
- Every tenant query filters company_id through the request; select the current/latest invitation before eligibility filtering. Enforce server-side authorization from auth(), not submitted company/user/role claims.
- Hold session pg_advisory_lock(hashtextextended(originalInviteActionId,0)) through preparation, provider I/O and finalization, matching membership polling. Commit intent before I/O. Do not hold request/action row locks across provider I/O: the separate observation writer must make progress through action foreign keys.
- Validate deletion receipt HTTP 200 with exact matching id and type invite_deleted. Provider pending-only contract refuses accepted/expired with 400; missing reference, 404, transport failure, malformed receipt or ambiguous evidence retains reservation. Never invoke generic deprovision or DELETE users.
- Interrupted successful durable matching DELETE receipt can finalize once without repeated remote deletion. Requested-only/ambiguous evidence refuses blind retry. Generic automated delivery selects invite/pending/provisioning and must never dispatch withdraw_invite intents.
- Real database and real shared/domain/service implementations; mocks only third-party network boundaries backed by Pact. Inject clocks and deterministic race barriers. Read TESTING.md and TEST_EFFECTIVENESS_STANDARD.md before test edits. Use strongest contract/property oracle and tenant isolation on each data path.
- Use locale files and design-system tokens. No migration, new route, expiry configuration, unrelated refactor or tooling policy change.
- If, at any task boundary, remaining work exceeds the approved estimate, stop and file blocked/deviation before continuing. Forecast includes all administrative paths; report additional required files before expanding it.

## Task 1: Deliver the complete safe manual withdrawal slice

**Production sources (11 paths):**
1. packages/connectors/src/contracts.ts — optional typed invitation-specific method, outside legacy capabilities/generic dispatch.
2. packages/connectors/src/providers/anthropic/connector.ts — paginated exact-reference pending invite lookup and pinned DELETE, strict confirmation and observed boundary.
3. packages/db/src/invitation-withdrawal.ts — reusable service, production credential/observation preparation, command validation, locking, durable intent and receipt recovery, finalization/audit.
4. packages/db/package.json — focused service export, no runtime dependency change.
5. apps/web/src/modules/request-workflow/actions/withdraw-invite.ts — authorized async server action, real production composition.
6. apps/web/src/modules/request-workflow/read-repository.ts — scoped Acciones actor/note projection.
7. apps/web/src/components/requests/request-record.tsx — Acciones actor/note rendering.
8. apps/web/src/components/exceptions/overdue-invites-table.tsx — selected invitation identity, required note, inline pending/result/error form.
9. apps/web/src/app/(authenticated)/excepciones/exceptions-view.tsx — localized form labels/composition.
10. apps/web/messages/en-US.json and apps/web/messages/es-EC.json — two locale paths (production total 11).

**Test paths (6):** packages/connectors/src/providers/anthropic/invitation-withdrawal.pact.test.ts; packages/db/src/invitation-withdrawal.integration.test.ts; apps/web/src/modules/request-workflow/actions/withdraw-invite.integration.test.ts; apps/web/src/modules/request-workflow/read-repository.integration.test.ts; apps/web/src/components/requests/request-record.test.tsx; apps/web/src/components/exceptions/overdue-invites-table.test.tsx.

**Administrative paths (3):** docs/readiness/US-068.json; this plan; .nous-feedback.jsonl. Total 20 paths. Existing connector.test and exceptions-view.test stay applicable; run them. TESTING section 3 already canonically covers the entire pinned/race/release contract and remains accurate; no duplicate documentation edit.

**Interfaces:** Add optional VendorConnector.withdrawInvitation(input: {requestId: string; vendorAccountId: string; vendorRef: string}) with a typed success/refusal result retaining matching vendorRef/receipt. Shared service command includes trusted companyId, requestId, original invite actionId, durable command identity, actorUserId (nullable for later system call), required note, injected clock; dependencies include real DB/pool, connector loader/observer, and REQUIRED assertLegalTransition callback. Production web composition passes domain assertLegalTransition. Do not add domain runtime dependency to DB or replace lifecycle engine with inline state assignment. Export a non-server internal authorization/service seam from the shared module if needed for real integration tests; the server action exports only async server-safe entrypoints and never accepts trusted context from callers.

- [ ] Read scoped story, readiness, provider transport/observation, schema, pending-invitations, membership-poll, request transition, authorization, read repository and UI. Confirm existing dispatcher excludes withdraw_invite. Escalate any new file or boundary requirement before expanding.
- [ ] Write Pact RED evidence for paginated invitation lookup and DELETE pinned invite, pending eligibility, exact receipt ID/type, accepted/expired refusal, missing reference, malformed/mismatched success and ambiguous failure. Assert no users DELETE. Run the new provider contract test; retain failure before adding optional method.
- [ ] Implement the minimal optional connector method using existing credential/transport/observer. Preserve existing capabilities and generic methods. Reuse existing paginated invites/idPages to select exactly the pinned reference, including later pages; reject duplicate/malformed/no matching identity. Never filter by email or enumerate members; DELETE only the pinned pending invite. Validate confirmation.
- [ ] Write real-PostgreSQL RED tests for withdrawal durable intent + note/actor, original invitation status, legal request transition, precise one-seat availability change after success, and unchanged reservations/assignments on foreign tenant, stale action, acceptance, unsupported provider and ambiguity. Use real connector with Pact-backed local provider boundary; no owned-service mocks.
- [ ] Implement preparation transaction under original action session lock. Scope and lock request/current invitation, verify invited/unassigned/current/sent/unresolved/ref. Commit distinct withdraw_invite intent before observed network I/O, retaining reservation. Use a stable command identity with idempotent existing intent handling. Release preparation row locks before I/O.
- [ ] Implement strict matching-success finalization transaction with current state/action/reference/company/account/intent revalidation, mandatory real lifecycle validator, applyRequestTransitionInTransaction, original invite withdrawn, distinct action completed/withdrawn, and actor/note audit linked to action. Release session lock in finally. No assignment removal occurs.
- [ ] Add deterministic real DB barriers proving original advisory lock excludes membership polling, receipt writes do not deadlock on action FK, state changes after I/O refuse finalization, failed transactions release locks, and durable matching success recovery finalizes once without another DELETE. Requested-only receipt refuses retry and keeps reservation.
- [ ] Add real authorization/action-boundary RED evidence for non-Group-Admin, foreign-company request, required-note rejection and trusted user attribution. Exercise shared authorized execution seam with real LedgerAuthorization/service/domain/database; use AST composition evidence if invoking actual auth() requires request context rather than mocking owned auth. Compose production action with auth() trusted context and inline serializable outcomes.
- [ ] Add rendered UI RED assertions: each form carries selected request/action identity and required note, inline result/errors are localized, pending submission cannot duplicate, actor/note are visible in Acciones. Extend scoped reader integration assertion for exact actor/note without joining another company's audit. Implement table, labels and action projection/rendering. User strings remain in locales.
- [ ] Run affected connector, DB, server, reader and component suites plus existing exceptions-view and connector suites; type-check/lint. Self-review every AC, tenant filter, lifecycle, lock/FK ordering, fail-closed confirmation/recovery and dispatch isolation. Commit US-068 candidate.
- [ ] Run ordinary mutation preflight against committed candidate with authority/us-068-base. Preview every returned shard intersecting named production sources once; repair genuine survivors, report unverified gaps honestly, do not emit test_report. Report exact commands/RED/GREEN, commits, paths, preview shards and task-boundary remaining estimate.

Contract examples for exact oracles (adapt to actual fixture API, preserve properties):
```ts
expect(providerCalls.filter(c => c.method === "DELETE").map(c => c.path))
  .toEqual([`/v1/organizations/invites/${pinnedVendorRef}`]);
expect(after.request.state).toBe("deprovisioned");
expect(after.availableSeats - before.availableSeats).toBe(1);
expect(after.action.actorUserId).toBe(groupAdminUserId);
expect(after.action.note).toBe(requiredNote);
// For accepted, foreign, stale or ambiguous cases:
expect(after.request.state).toBe(before.request.state);
expect(after.availableSeats).toBe(before.availableSeats);
expect(after.assignments).toEqual(before.assignments);
```

Provider references: https://platform.claude.com/docs/en/api/beta/organization/invites/delete and https://platform.claude.com/docs/en/manage-claude/user-management (Members and invites; Withdraw an invite).

## Task 2: Independent review and authoritative closure

**Production sources:** Task 1 sources only; any required repair is reported against estimate/file forecast.
- [ ] Fresh reviewer reads story, readiness, task brief/report and complete diff; verify spec compliance and quality, particularly provider confirmation, acceptance race, lock ordering, receipt recovery, trusted authorization, precise seat release, durable actor/note and generic dispatcher isolation. Resolve material findings via implementer and scoped re-review.
- [ ] Run final full pnpm check with disposable committed-migration PostgreSQL runtime, bounded VITEST_MAX_WORKERS=1; fresh apply/verify/parity must pass. Verify each AC independently and record source-bound evidence.
- [ ] After all reviews and repairs, clear cache and run exactly one authoritative cold diff mutation campaign, MUTATION_WORK_ID=US-068 with authority/us-068-base; no selected shard and no cache reuse. Record final complete scores only; source changes invalidate evidence.
- [ ] Record reproducible actuals, raw changed paths and reachable commits from authority base; append build_pass/ac_verify/test_report/done in required order, validate readiness and feedback ordering, commit closure. Sync canonical dev_done through Nous after closure. Do not merge or publish.

## Controller implementation ruling
Reuse the existing complete paginated invitations endpoint and match exactly vendorRef rather than adding a direct get_invite endpoint. The existing endpoint, request query and observation types lack that endpoint, which would add three paths without changing the demonstrable outcome. Selection remains pinned, rejects duplicates/malformed/missing identity, and never uses email or member removal. Cost if wrong: extra pagination latency or refusal on malformed unrelated rows; unsafe partial selection is prohibited. Generic completed HTTP200 observation precedes body validation and cannot authorize recovery; persist a validated matching id/type receipt in the shared service before finalize-only recovery.

Production composition refinement: the shared DB service stays vendor-neutral. The web action may reuse existing neutral createProvisioningConnector/createProvisioningRateLimiter exports from the already approved apps/worker/src/connector-composition.ts. Use bundler-visible literal loading with explicit neutral factory types if static TypeScript traversal conflicts with the web target; prove the actual Next standalone bundle contains and executes the provider constructor. Do not use native runtime-resolved TS import, webpackIgnore, new provider allowlists or compiler/gate suppression. Cost if wrong is package/build coupling; failed build or absent provider bundle blocks acceptance. No dependency on worker runtime inside DB.
