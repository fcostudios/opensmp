# US-011 Identity Provider Saga Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-administration mutations durable, audited, idempotently reconcilable, and contract-consistent across Ledger and Keycloak while preserving synchronous UI behavior.

**Architecture:** Commit an audited `identity_provider_operation` intent before external work, reconcile Keycloak outside database transactions, checkpoint provider progress, and atomically finalize Ledger state with business audit and operation completion. Keep a single owned Keycloak port and import all action validation from `@smp/contracts`.

**Tech Stack:** TypeScript, Next.js Server Actions, Zod, Drizzle ORM, PostgreSQL migrations, Vitest, Testcontainers, Pact, Stryker.

---

### Task 1: Command contract parity

**Files:**
- Modify: `packages/contracts/src/identity-access.ts`
- Modify: `packages/contracts/src/identity-access.test.ts`
- Modify: `apps/web/src/modules/identity-access/actions/manage-users.ts`
- Modify: `apps/web/src/modules/identity-access/user-admin-service.integration.test.ts`

- [ ] **Step 1: Write failing contract/action tests** proving create accepts and normalizes `displayName`, `globalRole`, and `personId`; every note rejects 1,001 characters; disable ignores no client company authority; removal uses `roleAssignmentId`.
- [ ] **Step 2: Run RED** with `rtk pnpm --filter @smp/contracts test -- identity-access.test.ts` and the focused web integration test; expect schema/property failures.
- [ ] **Step 3: Extend the exported create schema** with nullable `globalRole` and `personId`, and replace action-local schemas with imports:

```ts
import {
  createUserAccountInputSchema,
  disableUserAccountInputSchema,
  grantCompanyRoleInputSchema,
  removeCompanyRoleInputSchema,
  resetTwoFactorInputSchema,
} from "@smp/contracts";
```

- [ ] **Step 4: Parse only contract fields** and map `roleAssignmentId` consistently through service/repository; derive target company from Ledger.
- [ ] **Step 5: Run GREEN** for contract and action tests, then commit with `US-011`.

### Task 2: Durable operation schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/V20260803130000__identity_provider_operation.sql`
- Create: `packages/db/src/migrations/V20260803130100__verify_identity_provider_operation.sql`
- Modify: `packages/db/src/physical-schema.test.ts`
- Modify: `packages/db/src/migration-release.integration.test.ts`
- Modify: `packages/db/scripts/verify-schema.mjs`

- [ ] **Step 1: Write failing physical/release tests** for the table, status/kind constraints, unique idempotency key, pending retry index, actor/target foreign keys, and `ledger_app` privileges.
- [ ] **Step 2: Run RED** with the focused DB schema and migration tests; expect missing table/migration failures.
- [ ] **Step 3: Add the append-only migration and Drizzle table** with `pending | provider_applied | cleanup_pending | compensated | completed | failed` status, JSON payload, provider subject, attempts, retry/failure metadata, and timestamps.
- [ ] **Step 4: Add an independent verifier migration and schema verifier checks**; grant only required SELECT/INSERT/UPDATE privileges to `ledger_app`.
- [ ] **Step 5: Run GREEN**, apply migrations to the test fixture, then commit with `US-011`.

### Task 3: Saga repository

**Files:**
- Create: `apps/web/src/modules/identity-access/provider-operation-repository.ts`
- Create: `apps/web/src/modules/identity-access/provider-operation-repository.integration.test.ts`
- Modify: `docs/dev-guide/TESTING.md`

- [ ] **Step 1: Write failing real-Postgres tests** proving requested intent plus audit are atomic, idempotency keys deduplicate, checkpoint metadata persists, completion plus business audit is atomic, cleanup failures preserve both errors, and company isolation is enforced.
- [ ] **Step 2: Run RED** and verify failures are missing repository/table behavior rather than fixture errors.
- [ ] **Step 3: Implement repository methods** `request`, `checkpointProviderApplied`, `completeCreate`, `completeDisable`, `completeReset`, `markCompensated`, and `markCleanupPending` using short transactions and row locks; none accepts a provider callback.
- [ ] **Step 4: Add deterministic retry metadata** (`attemptCount`, `lastAttemptedAt`, `nextRetryAt`) and exact serialized error fields.
- [ ] **Step 5: Run GREEN**, update the §3 critical-path matrix, then commit with `US-011`.

### Task 4: Unified Keycloak boundary

**Files:**
- Modify: `apps/web/src/modules/identity-access/keycloak-admin.ts`
- Modify: `apps/web/src/modules/identity-access/keycloak-admin.test.ts`
- Modify: `apps/web/src/modules/identity-access/keycloak-admin.pact.test.ts`
- Modify: `apps/web/src/modules/identity-access/keycloak-admin.pact.ts`

- [ ] **Step 1: Write failing boundary tests** for user lookup by normalized email, platform-admin add/remove, session revocation, idempotent delete-on-404, and both privileged roles.
- [ ] **Step 2: Run RED** for HTTP and Pact tests; expect missing owned-port methods/interactions.
- [ ] **Step 3: Extend the single owned port** with `findUserByEmail`, `addUserToPlatformAdmin`, `removeUserFromPlatformAdmin`, and `revokeSessions`; preserve strict provider response validation.
- [ ] **Step 4: Make delete cleanup idempotent** only for an exact provider 404 while retaining other failures.
- [ ] **Step 5: Run GREEN** for in-memory, HTTP, and Pact suites, then commit with `US-011`.

### Task 5: Synchronous idempotent reconciler

**Files:**
- Create: `apps/web/src/modules/identity-access/provider-operation-reconciler.ts`
- Create: `apps/web/src/modules/identity-access/provider-operation-reconciler.integration.test.ts`
- Modify: `apps/web/src/modules/identity-access/user-admin-service.ts`
- Modify: `apps/web/src/modules/identity-access/user-admin-service.integration.test.ts`

- [ ] **Step 1: Write failing tests** for intent-before-provider ordering; both privileged role memberships; disable plus session revoke; provider-success/finalize-failure retry; create whole-user compensation; cleanup-pending `AggregateError`; idempotent reconciliation; and reset behavior.
- [ ] **Step 2: Run RED** and capture exact missing ordering/retry assertions.
- [ ] **Step 3: Implement the reconciler** so every provider call occurs after `request`, provider progress is checkpointed, and completion uses repository finalizers.
- [ ] **Step 4: Implement create compensation** that deletes the whole provider user, marks compensated on success, or records `cleanup_pending` and throws `new AggregateError([original, cleanup], ...)` on cleanup failure.
- [ ] **Step 5: Route service methods through request plus immediate reconcile**, map target/authorization errors, and return only on completion.
- [ ] **Step 6: Run GREEN** for real boundary and real PostgreSQL integration tests, then commit with `US-011`.

### Task 6: Token coalescing and bounded reads

**Files:**
- Modify: `apps/web/src/lib/auth/keycloak-admin-transport.ts`
- Modify: `apps/web/src/lib/auth/keycloak-admin-transport.test.ts`
- Modify: `apps/web/src/modules/identity-access/user-admin-service.ts`
- Modify: `apps/web/src/modules/identity-access/user-admin-service.integration.test.ts`

- [ ] **Step 1: Write failing concurrency tests** proving simultaneous admin calls issue one token request, a failed token promise is cleared, and OTP credential reads never exceed eight concurrent calls.
- [ ] **Step 2: Run RED** and verify duplicate token/max-concurrency assertions fail.
- [ ] **Step 3: Add one shared in-flight token promise** cleared in `finally`, with forced-refresh callers coalesced independently after a 401.
- [ ] **Step 4: Add a small `mapWithConcurrency` helper** and use a fixed limit of eight for list-user OTP reads.
- [ ] **Step 5: Run GREEN** and commit with `US-011`.

### Task 7: UI/action contract alignment

**Files:**
- Modify: `apps/web/src/components/users/users-roles-panel.tsx`
- Modify: `apps/web/src/components/users/users-roles-panel.test.tsx`
- Modify: `apps/web/messages/es-EC.json`
- Modify: `apps/web/messages/en-US.json`
- Modify: `apps/web/src/lib/i18n/catalogs.test.ts`

- [ ] **Step 1: Write failing tests** for the display-name form field, absence of client company scope on disable/removal, and `roleAssignmentId` form naming.
- [ ] **Step 2: Run RED** and confirm exact control/name failures.
- [ ] **Step 3: Align the form fields** while preserving dialog, pending, success, focus, and refresh semantics.
- [ ] **Step 4: Run GREEN** for panel and catalog tests, then commit with `US-011`.

### Task 8: Final verification and mutation

**Files:**
- Verify all files changed above.

- [ ] **Step 1: Run focused suites** for contracts, migration/schema, repository, reconciler, Keycloak HTTP/Pact, transport, actions, panel, and catalogs.
- [ ] **Step 2: Run policy/static gates**: `rtk pnpm lint:tests`, `rtk pnpm type-check`, `rtk pnpm lint`, and `rtk pnpm build`.
- [ ] **Step 3: Apply and verify schema** with the repository-defined database commands and `packages/db/scripts/verify-schema.mjs`.
- [ ] **Step 4: Run focused mutation** over the saga repository, reconciler, service, transport, and action parsing with the existing threshold unchanged.
- [ ] **Step 5: Run `rtk pnpm check`**, inspect `rtk git diff --check`, remove generated reports/temp sandboxes, and commit final verification adjustments with `US-011`.
