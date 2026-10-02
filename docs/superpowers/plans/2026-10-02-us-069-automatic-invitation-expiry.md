**Work item:** US-069
**Readiness assessment:** docs/readiness/US-069.json
**Approved estimate:** 280 minutes

# Automatic invitation expiry — approved child design

**Spec authority:** docs/stories/sprint-3/r1_misc_us_069.md AC1..AC4; docs/readiness/US-021.json partitions[proposal_key=automatic-invite-expiry]; DEC-SMP-023. Canonical child contracts override the older delivery-plan Task8 wording. This child follows readiness → design → executable plan in successive commits of this single bounded artifact.

**Approval authority:** Francisco's “Approved, full dev cycle” authorizes this canonical outcome and routine design refinements inside the approved20paths/280-minute scope. The digest-bound ready decision US069-READY-20261002 is committed4e595c1. No separate user outcome or unresolved material design choice is introduced.

## Child design

The existing quarter-hour invitePoll runs delivery, membership acceptance, then automatic expiry. There is no new scheduler or runtime loop. The existing lifecycle notification drain delivers the durable notice through the production mailer. The new job owns one PostgreSQL pool and closes it with the other jobs.

### Configuration and eligibility

A shared runtime validator for invite_unaccepted threshold validates finite nonnegative hours and auto_withdraw_after_hours: missing legacy key or null is disabled; any set value is a finite integer strictly greater than hours. Invalid configuration never enables expiry. AlertRule contract validation exports the same validator for future US-044; generic numeric alert contracts remain intact through explicit narrowing. No US-044 screen or dependency is added.

Use pendingInvitationRows to choose latest invitation before eligibility and age from actual sent_at. Fresh candidates require active company, applicable enabled valid rule, account scope, automated delivered unresolved invitation with pinned reference, invited request and no assignment, and strict age > configured expiry. The job must recheck rule and eligibility under the shared original-action lock immediately before a NEW intent, rather than trust its earlier scan.

### Stable service interfaces and concurrency boundary

Extend createInvitationWithdrawalService dependencies with two optional vendor-neutral hooks in its existing file. beforeNewIntent(context, database) returns Promise<boolean>, runs on the same checked-out pg client after current invitation eligibility and before new intent insert, and never runs for existing-intent receipt recovery. beforeCompletionCommit(context, canonicalCommand, occurredAt, database) returns Promise<void>, runs on the same held pg client inside finalization after legal transition/action/audit work and before COMMIT. Hook failures roll back finalization; previously separately persisted valid receipt remains recoverable. Names are the design contract; exact types infer the existing Context/InvitationWithdrawalCommand/pg client shapes without new files. Manual callers omit both hooks and retain behavior.

The original invitation advisory lock remains held through provider I/O, shared with membership activation. Preparation commits before observations/provider I/O; finalization rechecks pinned/current state under row locks. Strict pending invitation-only HTTP200/matching id/type receipt is unchanged. Generic deprovision/email/member removal is forbidden. Optional production-factory sleep/transport inputs may forward the existing worker runtime dependencies, with defaults unchanged and crypto/observations on the held client. The factory already accepts the injected now clock.

### Durable automatic identity and recovery

Automatic commandId is the canonical original invitation action UUID; actorUserId is exactly null. Persist the localized system note once. Recover only automatic pending validated receipts with coherent company/request/action/command/null-actor metadata, independently of current enabled rules and using the original stored note despite locale changes. Requested-only ambiguous intents never cause blind repeated DELETE. Never reinterpret a manual pending intent or change its actor/note. Every UUID follows delivered canonical normalization.

### Notification, tenant and audit boundary

Add enqueueLifecycleInvitationExpired to existing lifecycle-notifications.ts. It uses the existing decision/deprovisioned enum representation, real same-client Drizzle transaction, explicit company/request/original-invitation/requester identity and stable dedupe key. This helper is distinct from approval-only decision enqueue. Fresh expiry requires a non-null active requester with a deliverable email, rechecked before new intent. Completion must establish a durable matching expiry notice (including an already-existing dedupe notice); absence or recipient loss throws and retains the validated receipt while lifecycle/actions/audit roll back. Legacy invitations without that recipient wait for repair or manual withdrawal; ordinary notification helpers remain unchanged. Enqueue belongs before final COMMIT, so a crash afterward cannot lose the notice; notification failure rolls back the transition while retaining the validated deletion receipt. Recovery can finalize and enqueue once without more network deletion. Existing delivery fencing/dedupe remains unchanged; no claim of mathematical exactly-once SMTP mailbox delivery after acceptance-before-journal crash.

The job never accepts caller tenant/actor claims. Every tenant-scoped path filters company_id; provider account scope is independent and must match. Primary lifecycle audit and durable ProvisioningAction remain atomic and system attributed. The existing request reader/Acciones renderer validates metadata and displays the null actor as system; no UI production change is needed. Catalog/locales add specialized expiry wording and stable system note while preserving ordinary approved/rejected decision text, escaping and locale fallback.

### Non-goals and verification

No migrations, dependencies, runtime/mutation policy, new schedule/queue/loop, settings UI, active member removal, new manual behavior, unrelated sync_stale fix or new source path. Exactly20paths includes readiness, this combined artifact and feedback;17source/test paths are declared by the executable plan.

Use real PostgreSQL/domain/service/auth/audit/outbox/crypto/reader implementations, actual production SMTP mailer with local server, Pact-backed third-party provider HTTP and injected clock. Tests target concrete mutants: invalid/default/exact-boundary thresholds; stale/current/foreign/account/assigned candidates; shared-lock acceptance race; real rule disable before intent and after receipt; manual conflict; real SQL notification failure and no-network replay; stable note after locale change; two-run one DELETE/transition/+1seat/notice/system trail. No owned implementation mock/no-op, fake successful connector method, fake authorization or print-only oracle. Deterministic barriers use real locks/SQL, with settled cleanup.

Independent task and fresh broad reviews, complete required scripts/fresh committed schema verification, adversarial4ACs, every ordinary discovered intersecting preview and one final cache-cleared cache-off diff campaign follow implementation. Only final campaign evidence closes the child. Forecast9shards is provisional; deviations/actuals preserve the original280estimate.

## Executable plan

Design section above was committed first at1ea63a0 after readiness approval4e595c1. Both canonical story and this committed child design bind the tasks below.


## Global constraints
- AC1 canonical threshold.auto_withdraw_after_hours is null/default-disabled; configured value must be finite integer strictly greater than threshold.hours. Missing legacy key normalizes disabled. Shared validator rejects invalid configuration; never reinterpret invalid as enabled. Future US-044 reuses this contract.
- AC2 use actual durable invitation sent_at and strict age > configured hours. Select latest invitation before eligibility. Restrict active company, applicable enabled rule, scheduled vendor-account scope, automated delivered unresolved pending invitation and no assignment. Accepted, foreign, disabled, malformed and not-due fixtures remain untouched.
- AC3 distinct durable withdraw_invite action is attributed to null/system actor and rendered by existing Acciones; stable localized note is persisted once.
- AC4 injected clock and two job runs prove exactly one pinned DELETE, legal transition, +1 available reservation, durable notification and visible system action; unset expiry withdraws nothing.
- Reuse shared original-invitation advisory lock through I/O and exact HTTP200/matching reference/type confirmation. Never generic deprovision/email/member removal. Commit intent before I/O; no preparation row locks across observations.
- Same-client pre-intent guard rechecks enabled applicable rule and eligibility under original lock immediately before a NEW intent. Confirmed-receipt recovery may finalize after rule disable; scan automatic receipt-bearing pending intents independently of enabled rules. Requested-only ambiguity never repeats DELETE.
- Stable automatic command identity uses original invitation action ID. Recovery reuses stored normalized note/command despite locale changes. Never reinterpret a manual intent or replace its actor/note.
- Same-client transactional completion hook enqueues requester notice before finalization COMMIT. Enqueue failure rolls back lifecycle work but retains validated receipt for no-network recovery. Postcommit crash cannot lose enqueue. Dedupe includes original invitation/requester identity.
- Existing outbox guarantees one durable enqueue plus normal delivery ledger/dedupe behavior. Do not expand SMTP architecture. Preserve approved/rejected decision wording and all other notification types.
- Real PostgreSQL, authorization/domain/service/outbox implementations; injected clock/RNG and deterministic barriers. Only true third-party network boundaries may be doubled and must be Pact-backed. Read TESTING.md and TEST_EFFECTIVENESS_STANDARD.md before changing tests. Assert tenant isolation on each path.
- Exactly20 anticipated paths including readiness, plan and feedback; no spare path. No migrations, dependency/config/mutation policy changes, new route/settings UI, schedule/queue/cron or unrelated refactor. Existing TESTING section3 already covers this contract. Report any extra path or estimate expansion before implementation.

## Task 1: Deliver the complete automatic expiry slice

Production paths9:
- packages/contracts/src/alerts.ts
- packages/domain/src/alerts/evaluate.ts
- packages/db/src/invitation-withdrawal.ts
- packages/db/src/lifecycle-notifications.ts
- apps/worker/src/jobs/automatic-invitation-expiry.ts (new)
- apps/worker/src/jobs/deferred.ts
- packages/notifications/src/catalog.ts
- packages/notifications/src/locales/en-US.json
- packages/notifications/src/locales/es-EC.json

Test paths8:
- packages/contracts/src/alerts.test.ts
- packages/domain/src/alerts/evaluate.test.ts
- packages/db/src/invitation-withdrawal.integration.test.ts
- packages/db/src/lifecycle-notifications.integration.test.ts
- apps/worker/src/jobs/automatic-invitation-expiry.integration.test.ts (new)
- apps/worker/src/jobs/deferred.test.ts
- packages/notifications/src/catalog.test.ts
- apps/web/src/components/requests/request-record.test.tsx

Administrative paths3: docs/readiness/US-069.json; this plan; .nous-feedback.jsonl.

- [ ] Re-read delivered US-068 service and existing pending read model, alert contract/evaluator, deferred composition, lifecycle outbox/catalog and adjacent tests. No worker delegation.
- [ ] RED exact legacy/default/null/invalid/equality/below/above configuration cases, preserving approval and other rule contracts. Implement shared expiry validator and existing alert contract normalization; narrow numeric evaluator access without unrelated sync_stale fix. Avoid frozen module-init mutation blind spots by executing new validation at runtime.
- [ ] RED realDB same-client pre-intent rule-disable/current-eligibility races and transactional notification rollback/recovery. Add the design-named optional beforeNewIntent and beforeCompletionCommit hooks to shared service. Manual behavior remains unchanged. Add optional injected clock/sleep/transport to existing production connector composition if required, retaining defaults and same held client for crypto/observations.
- [ ] RED dedicated expiry enqueue dedupe/tenant/recipient/state evidence. Implement helper using decision/deprovisioned existing outbox representation; never incorrectly call approval-only helper. Transactional enqueue once per original invitation/requester.
- [ ] RED real worker integrated candidate matrix and two-run demo using actual encrypted credentials/provider composition and US-068 Pact-backed withdrawal HTTP contract. Implement scheduled job with active company/enabled applicable valid rule and strict age. Guard fresh intent under lock. Recover automatic validated receipts without enabled rule and without new DELETE; reuse persisted note. Refuse manual pending intent conflicts.
- [ ] Compose after delivery/membership in existing invitePoll, include processed totals and close every real job. Use the existing runtime lifecycle-notification drain for delivery; no mailer loop or schedule change. Integrated job test may drain the real dispatcher against a local real SMTP server through the production mailer to verify one delivery after two runs. Real deferred tests verify route/account/clock ordering and no-service semantics.
- [ ] RED localized expiry notice and system trail. Add catalog/locales specialized decision/deprovisioned wording plus stable localized automatic note; retain ordinary decision messages/escaping. Existing request-record production already supports system action; test actual durable automatic metadata without new UI source.
- [ ] Prove injected below/exact/above expiry boundaries, default-disabled, valid/invalid config, foreign company/account/latest invitation, accepted/assigned, unsupported/ambiguous provider, acceptance lock race, manual conflict, enabled-rule change before intent, disabled after durable receipt, notification rollback/replay, unchanged excluded capacity and one durable system trail/notification. Use strongest exact/property oracles and real service/domain/outbox; no owned mocks.
- [ ] Run affected adjacent suites, type/lint/boundary/test lint; self-review all ACs and commit candidate. Ordinary preflight against authority/us-069-base discovers shards; preview every intersecting returned shard once on each changed candidate. Repair genuine gaps; no authoritative test_report for previews. Report exact RED/GREEN, commands/output, commit, changed paths and remaining estimate.

## Task 2: Independent review and authoritative closure
- [ ] Task spec/quality review then fresh broad whole-branch review, bounded fixes and scoped re-review. Inspect invalid/default config, strict sent_at boundary, guarded rule race, shared acceptance locking, receipt recovery after disable, manual identity conflicts, transactional notification/dedupe, tenant/account scope and system trail.
- [ ] Full unchanged required scripts (complete package-serial test scheduling may address recorded host contention, without exclusions/timeout/config changes) and fresh committed migrations apply/verify/parity on disposable real PostgreSQL. Controller adversarially verifies each AC with source-bound evidence.
- [ ] After reviews/repairs close, clear cache and run one authoritative cold diff campaign with MUTATION_WORK_ID=US-069/MUTATION_BASE=authority/us-069-base/cache off/no selected shard. Record final complete results; any scored code/test/config/dependency change invalidates campaign.
- [ ] Record reproducible actuals and raw changed paths/commits, append required build_pass/ac_verify/test_report/done in order, validate readiness/feedback, commit closure and sync canonical status through Nous. No merge/publish.
