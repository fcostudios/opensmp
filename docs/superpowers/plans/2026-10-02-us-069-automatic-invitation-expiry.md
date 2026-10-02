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

Add enqueueLifecycleInvitationExpired to existing lifecycle-notifications.ts. It uses the existing decision/deprovisioned enum representation, real same-client Drizzle transaction, explicit company/request/original-invitation/requester identity and stable dedupe key. This helper is distinct from approval-only decision enqueue. Enqueue belongs before final COMMIT, so a crash afterward cannot lose the notice; notification failure rolls back the transition while retaining the validated deletion receipt. Recovery can finalize and enqueue once without more network deletion. Existing delivery fencing/dedupe remains unchanged; no claim of mathematical exactly-once SMTP mailbox delivery after acceptance-before-journal crash.

The job never accepts caller tenant/actor claims. Every tenant-scoped path filters company_id; provider account scope is independent and must match. Primary lifecycle audit and durable ProvisioningAction remain atomic and system attributed. The existing request reader/Acciones renderer validates metadata and displays the null actor as system; no UI production change is needed. Catalog/locales add specialized expiry wording and stable system note while preserving ordinary approved/rejected decision text, escaping and locale fallback.

### Non-goals and verification

No migrations, dependencies, runtime/mutation policy, new schedule/queue/loop, settings UI, active member removal, new manual behavior, unrelated sync_stale fix or new source path. Exactly20paths includes readiness, this combined artifact and feedback;17source/test paths are declared by the executable plan.

Use real PostgreSQL/domain/service/auth/audit/outbox/crypto/reader implementations, actual production SMTP mailer with local server, Pact-backed third-party provider HTTP and injected clock. Tests target concrete mutants: invalid/default/exact-boundary thresholds; stale/current/foreign/account/assigned candidates; shared-lock acceptance race; real rule disable before intent and after receipt; manual conflict; real SQL notification failure and no-network replay; stable note after locale change; two-run one DELETE/transition/+1seat/notice/system trail. No owned implementation mock/no-op, fake successful connector method, fake authorization or print-only oracle. Deterministic barriers use real locks/SQL, with settled cleanup.

Independent task and fresh broad reviews, complete required scripts/fresh committed schema verification, adversarial4ACs, every ordinary discovered intersecting preview and one final cache-cleared cache-off diff campaign follow implementation. Only final campaign evidence closes the child. Forecast9shards is provisional; deviations/actuals preserve the original280estimate.

## Executable plan

Not yet authored in this design commit. No implementation has started.
