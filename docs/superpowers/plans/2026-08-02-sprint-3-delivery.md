# Sprint 3 Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Sprint 3's 14 stories (40 points), beginning with US-011, while preserving tenant isolation, audited privileged actions, canonical capacity/lifecycle commands, and the honest external Anthropic go-live boundary.

**Architecture:** Keep the single Next.js application and its worker split into the existing bounded modules: `identity-access` owns users and company grants; `vendor-catalog` owns vendor accounts, capabilities, and capacity; `request-workflow` owns request transitions and connector orchestration; `register` owns assignments, provisioning actions, and reclamation proposals; `telemetry` owns activity/cost ingestion; and `alerts` owns operational alerts. Third-party behavior enters only through `packages/connectors`; API and CSV ingestion converge on the same application commands. Work proceeds in dependency waves, with US-029's read-only UI track available in parallel after the telemetry read contract exists.

**Tech Stack:** TypeScript, Next.js App Router, React Server Components, Auth.js, Drizzle/PostgreSQL, Zod, Zustand where client state is required, pg-boss worker jobs, Vitest/Testcontainers, Pact, Stryker, pnpm/Turborepo.

---

## Plan review and execution rules

- `docs/stories/SPRINT_PLAN.md` remains the generated, authoritative work queue. This file is the executable delivery plan and must not change generated story semantics.
- The completed `2026-07-30-sprint3-readiness-repair.md` remains historical evidence for CHG-011; it is not a Sprint 3 delivery plan and must not be reopened.
- Start with US-011. US-023, US-025, and US-043 are also key-independent and may proceed in parallel only when separate workers and non-overlapping files are available.
- US-054 remains `blocked_external`. It is a live-provider go-live gate, not permission to call Anthropic or mutate a provider account during local development.
- Before changing a test, re-read `docs/dev-guide/TESTING.md`. Every new behavioral test must state the mutant or incorrect behavior it kills. Never mock Ledger-owned repositories, services, queues, or the database.
- Every company-scoped repository operation must accept a trusted `companyId` from server authorization and filter the real `company_id` column. Never accept company or role authority from form data or Keycloak claims.
- Every task closes with focused tests, `rtk pnpm check`, scoped mutation, generated guidance checks, lifecycle evidence, and a story-referencing commit.

## Dependency waves

| Wave | Stories | Entry condition | Exit condition |
|---|---|---|---|
| 1 | US-011, US-023, US-025, US-043 | Sprint 2 closed; CHG-013 synchronized | Identity admin, capacity, vendor capability, and alert acknowledgement contracts are green |
| 2 | US-018 | US-025 complete; connector seam and Pact gate available | Deterministic Anthropic connector passes contract tests without live credentials |
| 3 | US-019, US-021, US-024 | US-018 complete; US-023 capacity command available | Provision, stale-invite recovery, and offboarding converge on audited lifecycle commands |
| 4 | US-026, then US-027/US-029, then US-030 | Connector and lifecycle contracts stable | Telemetry, freshness, reclamation candidates, and drift detection use shared read/write models |
| 5 | US-028, US-055 | US-024, US-027, and US-030 complete | Reclamation decisions and manual imports reuse the same lifecycle/ingestion commands |

## Focused verification matrix

Run the row for the current task before its repository-wide gates. Each command must exit 0 with all listed tests passing; a skipped database suite is a failure unless the test is explicitly marked as an optional external acceptance test.

| Task | Focused command |
|---|---|
| US-011 contract | `rtk pnpm --filter @smp/contracts test -- src/identity-access.test.ts && rtk pnpm --filter smp-web exec vitest run src/modules/identity-access/keycloak-admin.pact.test.ts` |
| US-011 feature | `rtk pnpm --filter smp-web exec vitest run src/modules/identity-access/user-admin-service.integration.test.ts src/components/users/users-roles-panel.test.tsx` |
| US-023 | `rtk pnpm --filter @smp/contracts test -- src/capacity.test.ts && rtk pnpm --filter smp-web exec vitest run src/modules/vendor-catalog/capacity-service.integration.test.ts src/components/pools && rtk pnpm --filter @smp/worker test -- src/jobs/capacity-recovery.integration.test.ts` |
| US-025 | `rtk pnpm --filter @smp/contracts test -- src/vendor-accounts.test.ts && rtk pnpm --filter smp-web exec vitest run src/modules/vendor-catalog/vendor-account-service.integration.test.ts src/components/vendors/vendor-account-form.test.tsx` |
| US-043 | `rtk pnpm --filter smp-web exec vitest run src/modules/alerts/acknowledge-alert.integration.test.ts src/components/alerts/alert-list.test.tsx` |
| US-018 | `rtk pnpm --filter @smp/connectors test && rtk pnpm test:contract && rtk pnpm test:probe && rtk pnpm lint:provider-boundary` |
| US-019 | `rtk pnpm --filter smp-web exec vitest run src/modules/request-workflow/provisioning-service.integration.test.ts && rtk pnpm --filter @smp/worker test -- src/jobs/membership-poll.integration.test.ts` |
| US-021 | `rtk pnpm --filter smp-web exec vitest run src/modules/request-workflow/provisioning-service.integration.test.ts && rtk pnpm --filter @smp/worker test -- src/jobs/stale-invite-recovery.integration.test.ts` |
| US-024 | `rtk pnpm --filter smp-web exec vitest run src/modules/register/offboarding-service.integration.test.ts src/components/people/person-offboarding.test.tsx && rtk pnpm --filter @smp/worker test -- src/jobs/offboarding-verification.integration.test.ts` |
| US-026 | `rtk pnpm --filter @smp/contracts test -- src/telemetry.test.ts && rtk pnpm --filter smp-web exec vitest run src/modules/telemetry/ingestion-service.integration.test.ts && rtk pnpm --filter @smp/worker test -- src/jobs/telemetry-sync.integration.test.ts` |
| US-027 | `rtk pnpm --filter smp-web exec vitest run src/modules/register/reclamation-service.integration.test.ts src/components/usage/usage-table.test.tsx` |
| US-029 | `rtk pnpm --filter smp-web exec vitest run src/modules/telemetry/read-repository.integration.test.ts src/components/telemetry/freshness-label.test.tsx` |
| US-030 | `rtk pnpm --filter smp-web exec vitest run src/modules/register/drift-service.integration.test.ts && rtk pnpm --filter @smp/worker test -- src/jobs/membership-drift.integration.test.ts` |
| US-028 | `rtk pnpm --filter smp-web exec vitest run src/modules/register/reclamation-decision.integration.test.ts src/components/reclamations/reclamation-queue.test.tsx` |
| US-055 | `rtk pnpm --filter @smp/contracts test -- src/imports.test.ts && rtk pnpm --filter smp-web exec vitest run src/modules/telemetry/csv-adapter.test.ts src/components/vendors/vendor-import-panel.test.tsx` |

## Shared file map

| Area | Primary files |
|---|---|
| Identity and roles | `apps/web/src/modules/identity-access/`, `apps/web/src/app/(authenticated)/usuarios/page.tsx`, `apps/web/src/components/users/` |
| Vendor accounts and capacity | `apps/web/src/modules/vendor-catalog/`, `apps/web/src/app/(authenticated)/organizaciones/`, `apps/web/src/app/(authenticated)/cupos/page.tsx`, `apps/web/src/components/pools/` |
| Connector boundary | `packages/connectors/src/`, `scripts/probes/anthropic/`, `apps/web/src/modules/request-workflow/` |
| Lifecycle/register | `apps/web/src/modules/request-workflow/`, `apps/web/src/modules/register/`, `apps/web/src/app/(authenticated)/solicitudes/`, `apps/web/src/app/(authenticated)/excepciones/page.tsx` |
| Telemetry and imports | `apps/web/src/modules/telemetry/`, `apps/worker/src/jobs/`, `apps/web/src/app/(authenticated)/uso/page.tsx`, `packages/contracts/src/imports.ts` |
| Alerts | `apps/web/src/modules/alerts/`, `apps/worker/src/alerts/`, `apps/web/src/app/(authenticated)/alertas/page.tsx` |
| Reclamation | `apps/web/src/modules/register/`, `apps/web/src/app/(authenticated)/reclamaciones/page.tsx`, `apps/web/src/components/reclamations/` |
| Schema | `packages/db/src/schema.ts`, new append-only files under `packages/db/src/migrations/`, `packages/db/scripts/verify-schema.mjs` |
| Localized copy | `apps/web/src/lib/i18n/en-US.json`, `apps/web/src/lib/i18n/es-EC.json` |

### Task 1: Start Sprint 3 and establish US-011's Keycloak admin seam

**Files:**
- Create: `packages/contracts/src/identity-access.ts`
- Create: `packages/contracts/src/identity-access.test.ts`
- Create: `apps/web/src/modules/identity-access/keycloak-admin.ts`
- Create: `apps/web/src/modules/identity-access/keycloak-admin.pact.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `.nous-feedback.jsonl`

- [ ] **Step 1: Record the story start without changing generated guidance**

Append one ordered event:

```json
{"story":"US-011","event":"started","agent":"smp-dev","notes":"Sprint 3 Wave 1 begins with the identity-access and Keycloak admin-service seam."}
```

Run `rtk pnpm test:feedback-order`; expect `ok`.

- [ ] **Step 2: Write RED contract tests**

Define Zod contracts for `CreateUserAccountInput`, `DisableUserAccountInput`, `ResetTwoFactorInput`, `GrantCompanyRoleInput`, and `RemoveCompanyRoleInput`. Assert that all privileged commands require a non-blank `note`, role is exactly `approver | finance | viewer`, and `validTo` cannot precede `validFrom`.

Run `rtk pnpm --filter @smp/contracts test -- identity-access.test.ts`; expect failure because the contracts do not exist.

- [ ] **Step 3: Implement the Keycloak port and Pact boundary**

Expose this owned port from `keycloak-admin.ts`:

```ts
export interface KeycloakAdminClient {
  createUser(input: { email: string; displayName: string }): Promise<{ idpSubject: string }>;
  disableUser(idpSubject: string): Promise<void>;
  listOtpCredentials(idpSubject: string): Promise<readonly { id: string }[]>;
  removeOtpCredential(idpSubject: string, credentialId: string): Promise<void>;
  addRequiredAction(idpSubject: string, action: "CONFIGURE_TOTP"): Promise<void>;
}
```

Back only the HTTP adapter with Pact interactions for create, disable, list/remove OTP, and required-action update. Do not mock this port in application integration tests; provide an in-memory implementation with the same contract.

Run `rtk pnpm test:contract`; expect all consumer interactions green.

- [ ] **Step 4: Commit the seam**

```bash
rtk git add .nous-feedback.jsonl packages/contracts/src apps/web/src/modules/identity-access
rtk git commit -m "feat(US-011): establish identity admin contract"
```

### Task 2: Complete US-011 user and company-role administration

**Files:**
- Create: `apps/web/src/modules/identity-access/user-admin-service.ts`
- Create: `apps/web/src/modules/identity-access/user-admin-service.integration.test.ts`
- Create: `apps/web/src/modules/identity-access/actions/manage-users.ts`
- Create: `apps/web/src/components/users/users-roles-panel.tsx`
- Create: `apps/web/src/components/users/users-roles-panel.test.tsx`
- Modify: `apps/web/src/modules/identity-access/repository.ts`
- Modify: `apps/web/src/app/(authenticated)/usuarios/page.tsx`
- Modify: `apps/web/src/lib/i18n/en-US.json`
- Modify: `apps/web/src/lib/i18n/es-EC.json`

- [ ] **Step 1: Write RED integration tests against PostgreSQL**

Cover: create persists the returned `idp_subject`; disable affects only the authorized company context; TOTP state comes from Keycloak credential lookup; reset removes every OTP credential and sets `CONFIGURE_TOTP`; grant/remove uses effective dates; each mutation writes an `AuditLog` row with actor, action, target, and the exact mandatory note; cross-company IDs are rejected.

Run `rtk pnpm --filter smp-web exec vitest run src/modules/identity-access/user-admin-service.integration.test.ts`; expect missing-service failure.

- [ ] **Step 2: Implement one transaction boundary per action**

Authorize with `requireCompanyPermission`, call the injected Keycloak port, persist through the identity repository, and audit through `withAudit`. Compensate a newly created Keycloak user if Ledger persistence fails. Never derive a grant from session claims or submitted `companyId`.

- [ ] **Step 3: Build the real SCR-users-roles screen**

Replace the scaffold with a Server Component that loads users and dated grants. Use client islands only for dialogs. Provide create, disable, reset-2FA, grant, and remove controls; require the note before submission; render Keycloak-derived 2FA state. Put all visible copy in both locale files.

- [ ] **Step 4: Verify and close**

Run:

```bash
rtk pnpm --filter smp-web exec vitest run src/modules/identity-access src/components/users
rtk pnpm lint:tests
rtk pnpm test:mutation
rtk pnpm check
```

Append `verified`, `mutation_verified`, and `done` events for US-011 with command evidence, then run `rtk pnpm test:feedback-order` and commit as `feat(US-011): deliver user and role administration`.

### Task 3: Deliver US-023 capacity management and blocked-request recovery

**Files:**
- Create: `packages/contracts/src/capacity.ts`
- Create: `packages/contracts/src/capacity.test.ts`
- Create: `apps/web/src/modules/vendor-catalog/capacity-service.ts`
- Create: `apps/web/src/modules/vendor-catalog/capacity-service.integration.test.ts`
- Create: `apps/web/src/modules/vendor-catalog/actions/manage-capacity.ts`
- Create: `apps/worker/src/jobs/capacity-recovery.ts`
- Create: `apps/worker/src/jobs/capacity-recovery.integration.test.ts`
- Modify: `apps/web/src/modules/vendor-catalog/pool-repository.ts`
- Modify: `apps/web/src/app/(authenticated)/cupos/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`
- Modify: `apps/web/src/components/pools/pool-cards.tsx`

- [ ] **Step 1: Write RED tests for BR-12 and the canonical command**

Assert that pool-empty and provider-400 paths produce one blocked request, one deduplicated alert, and one recovery job; effective-dated capacity is scoped by company/vendor/license type; adding capacity automatically resumes eligible requests exactly once; an unresolved block older than one Ecuador business day is escalated. Include an explicit cross-tenant mutation.

- [ ] **Step 2: Implement `registerPurchase`, `addCapacity`, and `saveVendorAccountCapacity`**

Route every capacity change through one `CapacityService.changeCapacity` transaction. Store effective dates, reject negative totals, and publish recovery only after commit. Return candidates or a typed `no_data` result; never manufacture zero-valued candidates.

- [ ] **Step 3: Connect pools and exceptions UI**

Show effective capacity, license type, blocked duration, escalation chip, and the add-capacity dialog. Reuse the same application action from pool and request-detail surfaces.

- [ ] **Step 4: Verify and commit**

Run focused vendor/worker/component tests, `rtk pnpm test:mutation`, and `rtk pnpm check`. Record lifecycle evidence and commit `feat(US-023): manage capacity and resume blocked requests`.

### Task 4: Deliver US-025 vendor-account capability management

**Files:**
- Create: `packages/contracts/src/vendor-accounts.ts`
- Create: `packages/contracts/src/vendor-accounts.test.ts`
- Create: `apps/web/src/modules/vendor-catalog/vendor-account-service.ts`
- Create: `apps/web/src/modules/vendor-catalog/vendor-account-service.integration.test.ts`
- Create: `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts.ts`
- Create: `apps/web/src/components/vendors/vendor-account-form.tsx`
- Create: `apps/web/src/components/vendors/vendor-account-form.test.tsx`
- Modify: `apps/web/src/app/(authenticated)/organizaciones/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/organizaciones/[vendorAccountId]/page.tsx`

- [ ] **Step 1: Specify capability semantics in RED tests**

Test the three ingestion modes (`automated`, `orchestration`, `manual`), floor/renewal dates, Anthropic-only R1 provider validation, read-only license types, and a capability descriptor that distinguishes Admin-key membership/invite routes from Analytics-key usage/cost routes. Assert tenant isolation on list/detail/update.

- [ ] **Step 2: Implement repository/service and UI**

Persist only vendor-owned settings, return a typed capability card, and route missing or unavailable capabilities to orchestration rather than pretending the API exists. Replace both organization scaffolds with list/detail Server Components and validated edit dialogs.

- [ ] **Step 3: Verify and commit**

Run focused contract, module, and component tests; run `rtk pnpm test:mutation` and `rtk pnpm check`; record lifecycle evidence; commit `feat(US-025): manage vendor account capabilities`.

### Task 5: Deliver US-043 operational alert acknowledgement

**Files:**
- Create: `packages/contracts/src/alert-actions.ts`
- Create: `apps/web/src/modules/alerts/actions/acknowledge-alert.ts`
- Create: `apps/web/src/modules/alerts/acknowledge-alert.integration.test.ts`
- Modify: `apps/web/src/modules/alerts/repository.ts`
- Modify: `apps/web/src/components/alerts/alert-list.tsx`
- Modify: `apps/web/src/components/alerts/alert-list.test.tsx`
- Modify: `apps/web/src/app/(authenticated)/alertas/page.tsx`

- [ ] **Step 1: Write RED authorization and idempotency tests**

Cover open/acknowledged tabs, `group_admin` authorization from Ledger grants, acknowledgement actor/time, repeated acknowledgement idempotency, cross-company denial, and subject links for request, vendor, person, assignment, and job targets.

- [ ] **Step 2: Implement action and screen**

Update an alert only when `company_id`, `id`, and unacknowledged state all match. Render scope, subject, severity, created time, acknowledgement metadata, and a type-safe internal link. Localize all labels.

- [ ] **Step 3: Verify and commit**

Run alert repository/component tests, mutation, and `rtk pnpm check`; append evidence and commit `feat(US-043): acknowledge operational alerts`.

### Task 6: Deliver US-018's deterministic Anthropic connector

**Files:**
- Create: `packages/connectors/src/anthropic/client.ts`
- Create: `packages/connectors/src/anthropic/client.pact.test.ts`
- Create: `packages/connectors/src/anthropic/sanitize.ts`
- Create: `packages/connectors/src/anthropic/sanitize.test.ts`
- Modify: `packages/connectors/src/contracts.ts`
- Modify: `packages/connectors/src/dispatch.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `scripts/probes/anthropic/pact.contract.test.ts`

- [ ] **Step 1: Write RED Pact and classification tests**

Cover organization identity, members, invites, analytics, pagination, endpoint-specific headers, distinct Admin/Analytics credentials, rate-limit metadata, retryable 429/5xx, non-retryable authentication/validation failures, and exact decimal cost strings. Assert sanitized summaries exclude credentials, raw bodies, provider IDs, email addresses, and other PII.

- [ ] **Step 2: Implement the adapter behind the existing connector port**

Inject clock, transport, and retry policy. Keep all provider imports under `packages/connectors`; return owned discriminated unions to callers. Never read live credentials in tests and do not execute US-054.

- [ ] **Step 3: Verify and commit**

Run `rtk pnpm test:contract`, connector tests, probe tests, mutation, source-boundary lint, and `rtk pnpm check`. Record US-018 as implemented with live acceptance still explicitly deferred to US-054. Commit `feat(US-018): add Anthropic connector adapter`.

### Task 7: Deliver US-019 provisioning and membership confirmation

**Files:**
- Create: `apps/web/src/modules/request-workflow/provisioning-service.ts`
- Create: `apps/web/src/modules/request-workflow/provisioning-service.integration.test.ts`
- Create: `apps/worker/src/jobs/membership-poll.ts`
- Create: `apps/worker/src/jobs/membership-poll.integration.test.ts`
- Create: `apps/web/src/modules/request-workflow/actions/retry-provisioning.ts`
- Modify: `apps/web/src/modules/request-workflow/orchestration.ts`
- Modify: `apps/web/src/modules/register/repository.ts`
- Modify: `apps/web/src/app/(authenticated)/solicitudes/[requestId]/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`

- [ ] **Step 1: Write RED given/when/then lifecycle tests**

Given an approved request, when provisioning succeeds, assert invite creation within the 15-minute service objective, a sanitized `ProvisioningAction`, polling until active membership, one assignment, and the terminal request state. Assert retryable failures create an alert/action and can be retried idempotently. Assert provider no-seat delegates to US-023's capacity command and never creates an assignment.

- [ ] **Step 2: Implement one orchestration transaction per observed result**

Use the connector dispatcher and canonical capacity/lifecycle ports. Keep external calls outside database transactions, persist observations with idempotency keys, and enqueue the next poll after commit.

- [ ] **Step 3: Connect request detail and exception actions**

Render action history, sanitized failure, next retry, and retry control. The action must authorize from the DB and reject stale or cross-company requests.

- [ ] **Step 4: Verify and commit**

Run request-workflow/register/worker integration tests, contract tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-019): provision approved requests`.

### Task 8: Deliver US-021 stale-invite withdrawal

**Files:**
- Create: `apps/worker/src/jobs/stale-invite-recovery.ts`
- Create: `apps/worker/src/jobs/stale-invite-recovery.integration.test.ts`
- Create: `apps/web/src/modules/request-workflow/actions/withdraw-invite.ts`
- Modify: `apps/web/src/modules/request-workflow/provisioning-service.ts`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`

- [ ] **Step 1: Write RED time-bound tests**

With an injected clock, assert an invite older than seven days creates one alert; configured automatic withdrawal cancels it, frees capacity, returns the request to the correct actionable state, and re-notifies once; manual withdrawal requires a note. Assert every attempt is visible in `ProvisioningAction` history.

- [ ] **Step 2: Implement recovery through existing ports**

Reuse connector withdrawal, capacity, notification, and transition commands. Use stable job/action idempotency keys and never compare wall-clock time in tests.

- [ ] **Step 3: Verify and commit**

Run focused worker/request tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-021): recover stale invitations`.

### Task 9: Deliver US-024 offboarding completion

**Files:**
- Create: `apps/web/src/modules/register/offboarding-service.ts`
- Create: `apps/web/src/modules/register/offboarding-service.integration.test.ts`
- Create: `apps/web/src/modules/register/actions/start-offboarding.ts`
- Create: `apps/worker/src/jobs/offboarding-verification.ts`
- Create: `apps/worker/src/jobs/offboarding-verification.integration.test.ts`
- Modify: `apps/web/src/components/people/person-offboarding.tsx`
- Modify: `apps/web/src/app/(authenticated)/personas/[personId]/page.tsx`

- [ ] **Step 1: Write RED aggregate/lifecycle tests**

Assert connector and checklist paths both close the assignment, record the action, return capacity, and mark the person departure status; overdue work at the same Ecuador business-day boundary produces one alert. Assert repeated completion and cross-company input cannot double-free capacity.

- [ ] **Step 2: Implement the canonical offboarding command**

Keep assignment close, request transition, pool return, and audit in one database transaction after the connector/checklist observation. Use the existing Ecuador calendar and alert repository.

- [ ] **Step 3: Verify and commit**

Run register/person/worker tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-024): complete assignment offboarding`.

### Task 10: Deliver US-026 idempotent telemetry ingestion

**Files:**
- Create: `packages/contracts/src/telemetry.ts`
- Create: `packages/contracts/src/telemetry.test.ts`
- Create: `apps/web/src/modules/telemetry/ingestion-service.ts`
- Create: `apps/web/src/modules/telemetry/ingestion-service.integration.test.ts`
- Create: `apps/worker/src/jobs/telemetry-sync.ts`
- Create: `apps/worker/src/jobs/telemetry-sync.integration.test.ts`
- Modify: `apps/worker/src/runtime.ts`

- [ ] **Step 1: Write RED property and integration tests**

Assert daily activity upserts are idempotent by company/vendor/member/day, costs retain the 30-day window with exact decimal arithmetic, known email identities map to people/assignments, unmatched identities remain explicitly unmatched, and duplicate/out-of-order pages converge to the same database state. Assert freshness comes from the completed ingestion observation, independent of API or later CSV channel.

- [ ] **Step 2: Implement a channel-neutral ingestion command**

Expose `ingestMembers` and `ingestUsage` application commands accepting normalized connector records plus source metadata. The worker adapter fetches pages and passes them to these commands; it does not write tables directly.

- [ ] **Step 3: Verify and commit**

Run telemetry/worker property and integration tests, contract tests, mutation, and `rtk pnpm check`; update TESTING §3 if telemetry is newly critical; record evidence and commit `feat(US-026): ingest activity and cost telemetry`.

### Task 11: Deliver US-027 reclamation candidate generation

**Files:**
- Create: `apps/web/src/modules/register/reclamation-service.ts`
- Create: `apps/web/src/modules/register/reclamation-service.integration.test.ts`
- Create: `apps/web/src/modules/register/actions/propose-reclamations.ts`
- Modify: `apps/web/src/app/(authenticated)/uso/page.tsx`
- Create: `apps/web/src/components/usage/usage-table.tsx`
- Create: `apps/web/src/components/usage/usage-table.test.tsx`

- [ ] **Step 1: Write RED scoring-window tests**

Use property tests for date-window boundaries and given/when/then tests for proposal emission. Assert the three-day telemetry lag is excluded, filters do not alter eligibility, batch proposal requires a note, and each selected assignment creates one deduplicated proposal and transitions to `flagged_inactive`.

- [ ] **Step 2: Implement candidate query and proposal command**

Compute candidates from normalized telemetry and active assignments, return an explicit `no_data` state when freshness is insufficient, and audit the batch note with selected IDs.

- [ ] **Step 3: Build the initial usage screen and commit**

Replace the scaffold with filters, summary cards, candidate selection, and batch proposal dialog. Run focused tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-027): propose inactive license reclamations`.

### Task 12: Deliver US-029 freshness and failure presentation

**Files:**
- Create: `apps/web/src/modules/telemetry/read-repository.ts`
- Create: `apps/web/src/modules/telemetry/read-repository.integration.test.ts`
- Create: `apps/web/src/components/telemetry/freshness-label.tsx`
- Create: `apps/web/src/components/telemetry/freshness-label.test.tsx`
- Modify: `apps/web/src/app/(authenticated)/uso/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/estados-de-cuenta/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/estados-de-cuenta/[statementId]/page.tsx`

- [ ] **Step 1: Write RED presentation-boundary tests**

Assert `synced_at` is rendered with a semantic `<time>` value; older than 48 hours produces `sync_stale` and attention styling; empty successful ingestion is `no_data`; credential/authentication failure is an error and not `no_data`; links to credential health follow the US-031 contract without exposing secrets.

- [ ] **Step 2: Implement one shared freshness presenter**

Load freshness and failure classification from the telemetry read model. Reuse `FreshnessLabel` on usage and both statement screens; do not duplicate threshold logic in pages.

- [ ] **Step 3: Verify and commit**

Run telemetry/component tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-029): show telemetry freshness and failures`.

### Task 13: Deliver US-030 membership drift detection and claim

**Files:**
- Create: `apps/web/src/modules/register/drift-service.ts`
- Create: `apps/web/src/modules/register/drift-service.integration.test.ts`
- Create: `apps/web/src/modules/register/actions/claim-drift-member.ts`
- Create: `apps/worker/src/jobs/membership-drift.ts`
- Create: `apps/worker/src/jobs/membership-drift.integration.test.ts`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/panel/page.tsx`

- [ ] **Step 1: Write RED differential tests**

Feed identical normalized member snapshots through API and CSV adapters and assert the same drift set. Assert hourly reruns deduplicate alerts, drift entries appear in exceptions, retroactive claim requires a note and creates both an assignment and system request, and the dashboard count is company-scoped.

- [ ] **Step 2: Implement drift as a pure diff plus application command**

Keep the set difference pure and mutation-free. Persist observations, alerts, claims, and audit through register-owned repositories. Reuse US-026 identity matching and freshness metadata.

- [ ] **Step 3: Verify and commit**

Run drift/worker/dashboard tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-030): detect and claim membership drift`.

### Task 14: Deliver US-028 reclamation decisions

**Files:**
- Create: `apps/web/src/modules/register/actions/decide-reclamation.ts`
- Create: `apps/web/src/modules/register/reclamation-decision.integration.test.ts`
- Create: `apps/web/src/components/reclamations/reclamation-queue.tsx`
- Create: `apps/web/src/components/reclamations/reclamation-queue.test.tsx`
- Modify: `apps/web/src/app/(authenticated)/reclamaciones/page.tsx`

- [ ] **Step 1: Write RED decision tests**

Given an open proposal, approve must transition it once and start the US-024 offboarding path; dismiss/keep must require a note and suppress the same candidate until a genuinely new activity window exists. Assert audit history, empty queue, stale decision rejection, and tenant isolation.

- [ ] **Step 2: Implement decisions through existing lifecycle ports**

Do not close assignments directly from the UI action. Invoke the offboarding service for approve and store the telemetry-window fingerprint for dismiss suppression.

- [ ] **Step 3: Build queue, verify, and commit**

Replace the scaffold with proposal cards, approve/dismiss dialogs, audited history, and empty state. Run focused tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-028): decide reclamation proposals`.

### Task 15: Deliver US-055 CSV member and usage imports

**Files:**
- Modify: `packages/contracts/src/imports.ts`
- Modify: `packages/contracts/src/imports.test.ts`
- Create: `apps/web/src/modules/telemetry/csv-adapter.ts`
- Create: `apps/web/src/modules/telemetry/csv-adapter.test.ts`
- Create: `apps/web/src/modules/vendor-catalog/actions/import-vendor-data.ts`
- Create: `apps/web/src/components/vendors/vendor-import-panel.tsx`
- Create: `apps/web/src/components/vendors/vendor-import-panel.test.tsx`
- Modify: `apps/web/src/app/(authenticated)/organizaciones/[vendorAccountId]/page.tsx`

- [ ] **Step 1: Write RED metamorphic tests**

For the same normalized records, assert CSV import and API ingestion yield the same membership drift, assignments, system requests, activity/cost upserts, unmatched identities, and freshness value. Assert malformed rows are rejected with row-safe diagnostics, manual assignment requires a note, ingestion mode is per vendor account, and reruns are idempotent.

- [ ] **Step 2: Implement adapters that call shared commands**

CSV code parses and normalizes only. It must call US-026 ingestion and US-030 drift commands, never write their tables directly. Verify checklist integrity before member claims and audit import hash/counts without storing raw file contents.

- [ ] **Step 3: Add vendor-detail import UI**

Show the configured ingestion mode, member/usage upload controls, validation summary, unmatched count, last successful sync, and safe error messages. Keep uploaded file state in the client island only as long as needed to submit.

- [ ] **Step 4: Verify and commit**

Run imports/telemetry/drift/component tests, mutation, and `rtk pnpm check`; record evidence and commit `feat(US-055): import vendor members and usage`.

### Task 16: Close Sprint 3 with cross-story acceptance

**Files:**
- Modify: `.nous-feedback.jsonl`
- Modify only if required by a canonical Nous change: generated files listed by `infra/scripts/sync-from-nous.py`

- [ ] **Step 1: Run every repository gate**

```bash
rtk pnpm check
rtk pnpm test:contract
rtk pnpm test:mutation
rtk pnpm test:infra:integration
rtk pnpm validate:routes
rtk pnpm validate:sidebar
rtk pnpm check:generated-guidance
```

Expected: every command exits 0. `test:mutation` must select all changed critical-path files; it must not report a false green caused by an empty diff.

- [ ] **Step 2: Verify schema and deployment behavior**

If any migration was added, start the test database and run:

```bash
rtk pnpm --dir packages/db drizzle-kit push
rtk node packages/db/scripts/verify-schema.mjs
```

Expected: a fresh schema and an upgraded schema both match the verifier; runtime queries continue to use `ledger_app`, while migrations use `ledger_owner`.

- [ ] **Step 3: Perform the acceptance matrix**

Verify each story's ACs against its generated story file and screen spec. In particular, prove: privileged-note auditing; tenant isolation; no duplicate capacity, assignment, alert, or action rows under retry; API/CSV convergence; sanitized provider evidence; Ecuador business-day boundaries; and explicit `no_data` versus failure states.

- [ ] **Step 4: Record terminal evidence honestly**

Append per-story `verified`, `mutation_verified`, and `done` events only for stories whose ACs and gates passed. Keep US-054 `blocked_external` unless the operator separately supplies credentials, canary, authorization, and confirmation. Append a Sprint 3 terminal event only when all non-deferred stories are done, then run both feedback-order suites.

- [ ] **Step 5: Commit final evidence**

```bash
rtk git add .nous-feedback.jsonl
rtk git commit -m "docs(US-055): record Sprint 3 acceptance evidence"
rtk git status --short
```

Expected: a clean working tree. Do not push, merge, or execute live-provider acceptance without explicit authorization.

## Self-review checklist

- [ ] Every Sprint 3 story in `docs/stories/SPRINT_PLAN.md` appears exactly once in an implementation task.
- [ ] Dependencies match the generated queue: US-025 precedes US-018; US-018 precedes provisioning/telemetry/drift; US-024 and US-027 precede US-028; US-030 precedes US-055.
- [ ] Every test names a property or contract and kills a plausible incorrect behavior.
- [ ] Every third-party mock is Pact-backed; owned modules use real repositories/in-memory implementations or Testcontainers.
- [ ] Every company-scoped read/write has a tenant-isolation assertion.
- [ ] Every privileged/manual action has mandatory-note and audit assertions.
- [ ] Every time-based rule uses an injected clock and Ecuador business-day semantics where specified.
- [ ] All file paths are concrete, all shell commands use `rtk`, and no unresolved implementation choice or speculative live-provider action remains.
