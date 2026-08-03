# US-011 Identity Provider Saga Design

## Goal

Make privileged user administration durable across Ledger and Keycloak without changing the synchronous UI contract. Every external mutation must have a committed audited intent before it runs, and the service returns success only after Keycloak and Ledger reconcile.

## Root cause

The current service creates users before Ledger has durable evidence and performs disable/reset provider calls inside the database audit transaction. A later database rollback can therefore leave Keycloak changed without a durable Ledger audit or retry record. Compensation errors can also replace the original failure. Separately, server actions duplicate command validation, Keycloak administration is split across two drifting ports, concurrent requests can duplicate token acquisition, and the user list performs unbounded credential queries.

## Durable operation model

Add an append-only migration and Drizzle schema for `identity_provider_operation`. Each row contains:

- a UUID operation ID and unique idempotency key;
- operation kind: create user, disable user, or reset two-factor authentication;
- lifecycle status: pending, provider applied, cleanup pending, compensated, completed, or failed;
- the actor, optional target user/company, normalized command payload, and provider subject when known;
- attempt count, next retry time, last attempted time, original failure, cleanup failure, created time, and completed time.

Creating the operation and its `identity.provider_operation.requested` audit record is one transaction. Provider work never runs inside a Ledger transaction. Provider progress is checkpointed before Ledger finalization. Final Ledger state, its business audit record, and completed operation status are one transaction.

The repository exposes claims/checkpoints/finalizers suitable for immediate synchronous reconciliation and later retry. Claims use row locking and an idempotency key. Reconciliation accepts pending, provider-applied, and cleanup-pending states and is safe to repeat.

## Operation flows

### Create user

1. Authorize from Ledger, validate the target person/company, and commit the audited intent.
2. Resolve an existing Keycloak user by normalized email or create it.
3. For `group_admin` or `central_finance`, add the user to the `platform-admin` group.
4. Checkpoint the provider subject and provider-applied status.
5. Atomically create the Ledger account, write `identity.user.created`, and complete the operation.
6. If Ledger finalization fails, delete the entire Keycloak user. A successful delete marks the operation compensated. A failed delete preserves the original error and cleanup error, records `cleanup_pending`, and throws an aggregate error containing both.

Provider lookup, membership addition, and deletion are idempotent. A missing user during cleanup counts as success.

### Disable user

1. Resolve and authorize the target from Ledger and commit the audited intent.
2. Disable the Keycloak user and revoke all sessions.
3. Checkpoint provider-applied.
4. Atomically disable the Ledger account, write `identity.user.disabled`, and complete the operation.

Both provider calls are safe to repeat. If Ledger finalization fails after provider success, the provider-applied operation remains retryable.

### Reset two-factor authentication

1. Resolve and authorize the target and commit the audited intent.
2. Remove every OTP credential and ensure `CONFIGURE_TOTP` is present.
3. Checkpoint provider-applied.
4. Write `identity.user.two_factor_reset` and complete the operation atomically.

Repeated removal and required-action reconciliation are idempotent.

## Command and authorization contracts

Server actions import the exported `@smp/contracts` schemas rather than redefining Zod objects. The create contract contains normalized email, trimmed display name, nullable global role, nullable person ID, and an audit note capped at 1,000 characters. Disable contains only target user ID and note. Role removal uses `roleAssignmentId` and note. Company authorization is always derived from Ledger target data or checked against a server-loaded grant; no client-supplied company ID is treated as authority.

## Keycloak boundary and performance

Use one owned user-administration port containing user creation/resolution/deletion, platform-admin membership, disable, session revocation, OTP credential operations, and required actions. Pact tests prove both privileged global roles require platform-admin membership and disable performs both provider calls.

The shared transport keeps one in-flight token promise so concurrent callers share acquisition. A failed acquisition clears the promise for retry. User-list OTP queries use a fixed concurrency bound rather than unbounded `Promise.all`.

## Failure semantics

Actions throw until reconciliation completes. Durable rows retain exact partial state and retry metadata. Create cleanup failures use `AggregateError` with the original Ledger failure first and cleanup failure second. Failure-recording errors must not replace either provider/business error. No credential material is persisted in operation payloads or audit records.

## Verification

- Contract tests cover normalization, new fields, note maximum, trusted identifiers, and `roleAssignmentId`.
- Real Postgres tests prove intent/audit atomicity, provider-outside-transaction ordering, finalization, provider-success/DB-failure recovery, compensation, cleanup-pending metadata, idempotent retry, and tenant isolation.
- HTTP/Pact tests cover privileged membership for both roles, whole-user deletion, session revocation, and idempotent missing-user cleanup.
- Transport tests prove concurrent token coalescing and retry after token failure.
- Service tests prove bounded credential-query concurrency.
- Migration release/schema verification is updated for the new table, indexes, constraints, and runtime privileges.
- Focused mutation testing covers changed critical paths without exclusions or threshold changes.
