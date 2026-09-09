**Work item:** US-065
**Readiness assessment:** docs/readiness/US-065.json
**Approved estimate:** 224 minutes

# US-065 Provisioning Failure Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn a generic automated invitation failure into safe tenant-visible evidence and one provisioning alert, then let an authorized operator create exactly one new retry attempt without reissuing an unresolved provider call.

**Architecture:** The invitation worker consumes the connector's provider-neutral failure result and its durable terminal observation, then atomically closes the pending action and transitions the request to `failed` with a fixed safe reason and a request-scoped alert. Retry is a server action backed by the existing provisioning router: it locks the tenant-scoped failed request, refuses any unresolved live action, re-enters `provisioning` through the lifecycle engine, and creates a fresh pending `ProvisioningAction`. The exceptions UI submits the failed action identity and renders localized success/error states; authorization is derived only from the database-backed `LedgerAuthorization` company scope.

**Tech Stack:** TypeScript, Next.js server actions, React, Vitest, Drizzle SQL, PostgreSQL/Testcontainers, pnpm, Stryker

**Spec authority:** Approved US-019 partition in `docs/readiness/US-019.json`; DEC-SMP-021/CHG-054 canonical allocation in `docs/stories/CHANGES.md`; generated child `docs/stories/sprint-3/r1_misc_us_065.md`; and `docs/superpowers/plans/2026-08-02-sprint-3-delivery.md`, section **Task 7: Deliver US-019 provisioning and membership confirmation**.

## Readiness

- `work_id`: `US-065`
- Readiness artifact: `docs/readiness/US-065.json`
- Approved payload: `38ea00196264b1bcdca52f24e8916cf0c8ca0a58c6c1bfcf9aecbe1a2c1d132e`
- Estimate: 224 minutes, within the 320-minute limit
- Planned scope: 17 files and 8 mutation shards, calculated under CHG-058

## Global constraints

- Preserve only fixed, provider-neutral failure metadata. Never persist or render credentials, headers, transport exception text, provider response bodies, provider IDs, or person PII as `failure_reason`.
- A generic known failure changes only the exact pending automated invite action and its same-company provisioning request. The action close, request transition, alert event, transition evidence, and audit evidence are atomic.
- `capacity_unavailable` remains owned by US-064 and must not enter this generic path.
- An unresolved action is any live `pending` or `sent` provisioning action or any action whose connector-call journal has `requested` without a terminal `succeeded`/`failed` observation. Retry must not create or dispatch another invitation in that condition.
- Retry creates a new action; failed historical actions and connector observations remain immutable.
- Retry authorization comes from the trusted DB-backed `LedgerAuthorization`, requires the operator capability, and binds the request's real `company_id` to `authorization.companyIds`. Cross-company input returns the sanitized forbidden result and records denial evidence.
- Tests use real owned code and real PostgreSQL. Only the Anthropic HTTP transport boundary is faked, under the existing Pact-backed seam.
- Every feedback event after `started` carries ISO-8601 UTC `ts`; previews emit no `test_report`; exactly one authoritative final `test_report` is emitted.
- If the remaining work at a task boundary appears likely to exceed 224 minutes, append a timestamped `deviation` or `blocked` event before continuing.

---

### Task 1: Atomically finalize and alert a generic invitation failure

**Production sources:**
- Modify: `apps/worker/src/jobs/automated-invite-delivery.ts`

**Tests:**
- Modify: `apps/worker/src/jobs/automated-invite-delivery.integration.test.ts`

**Produces:** A generic, known connector failure closes one pending action with a fixed safe reason, transitions its exact request `provisioning -> failed`, and inserts one request-scoped `provisioning_failure` alert in the same transaction.

- [ ] **Step 1: Write RED real-PostgreSQL lifecycle tests**

Add cases for representative non-capacity 400/401/403/409/422 and retry-exhausted 429/503 results. Assert one failed action, one safe fixed `failure_reason`, one `provisioning -> failed` transition, one audit record, and one alert whose subject contains only the request/company/action identity required by the owned contract. Assert raw provider body, headers, credentials, email, provider request ID, and transport message never appear in persisted or returned data. Assert the exact US-064 capacity result still follows `blocked_no_seat`. Add duplicate/concurrent drains, another-company rows, and trigger-induced rollback assertions.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @smp/worker test -- src/jobs/automated-invite-delivery.integration.test.ts`; require failure because generic results currently return without finalization.

- [ ] **Step 3: Implement the minimal generic failure finalizer**

Add a transaction beside `finalizeNoSeat()` that locks the exact action/request/vendor/company tuple, requires its matching durable terminal failed observation and excludes `capacity_unavailable`, updates only that pending action to failed/resolved with a constant reason, applies the legal lifecycle transition, inserts the enabled company/global `provisioning_failure` alert with a stable dedupe key, and commits atomically. Stale candidates return false; missing alert rules and persistence failures roll back.

- [ ] **Step 4: Reach GREEN**

Rerun the worker integration suite and the domain lifecycle suite.

- [ ] **Step 5: Commit Task 1**

Commit `feat(US-065): persist generic provisioning failures`.

- [ ] **Step 6: Preview every touched shard**

Run `MUTATION_WORK_ID=US-065 MUTATION_BASE=authority/us-065-base pnpm mutation:preflight`, select every generated shard whose `sources` intersects `apps/worker/src/jobs/automated-invite-delivery.ts`, and run each exact ID with `MUTATION_SHARD=<id>`. Repair genuine survivors through RED/GREEN and rerun affected previews to at least 80%. Emit no `test_report`.

---

### Task 2: Add tenant-authorized idempotent retry through the provisioning engine

**Production sources:**
- Modify: `packages/db/src/provisioning-routing.ts`
- Create: `apps/web/src/modules/request-workflow/provisioning-service.ts`
- Create: `apps/web/src/modules/request-workflow/actions/retry-provisioning.ts`
- Create: `apps/web/src/modules/request-workflow/actions/retry-provisioning-production-dependencies.ts`

**Tests:**
- Modify: `packages/db/src/provisioning-routing.test.ts`
- Create: `apps/web/src/modules/request-workflow/provisioning-service.integration.test.ts`

**Produces:** `retryProvisioning(input)` and a testable service returning `{ok:true,requestId}` or sanitized `forbidden | invalid | conflict`, with one fresh action on a legal retry.

- [ ] **Step 1: Write RED routing and action tests**

Use real PostgreSQL to prove: a failed request with a terminal known-failure action transitions through the existing engine and creates one new pending action; the failed action remains unchanged; replay returns the same live action instead of creating another; requested-only, pending, sent, or otherwise unresolved outcomes reject retry; invalid input rejects before mutation; missing authorization, insufficient role, and a company absent from `authorization.companyIds` return forbidden and write sanitized denial audit evidence. Assert another tenant's request/action rows are unchanged.

- [ ] **Step 2: Verify RED**

Run the focused DB routing and real-PostgreSQL provisioning-service suites; require failure because failed-state routing and the retry service do not exist. The existing exhaustive lifecycle table already pins `failed -> provisioning`, so no lifecycle source change is needed.

- [ ] **Step 3: Extend the existing router and implement the action service**

Allow `routeProvisioningActionInTransaction` to consume `expectedState: "failed"` while retaining its pending-action reuse fence. Before routing, lock and validate the historical automated invite outcome: only a terminal failed observation/action is retryable; unresolved evidence yields a conflict. Implement a strict UUID input parser, DB authorization loader, tenant-scope check, transactional call to the router, server-action audit envelope, and redirect only after a successful commit.

- [ ] **Step 4: Reach GREEN**

Rerun all focused suites and require the exact action count, transition, audit, and tenant isolation assertions to pass.

- [ ] **Step 5: Commit Task 2**

Commit `feat(US-065): retry failed provisioning safely`.

- [ ] **Step 6: Preview every touched shard**

Run preflight against the committed candidate, intersect its shards with the four named production sources, and preview every intersecting exact shard using `MUTATION_SHARD=<id>`. Repair genuine survivors before review; emit no `test_report`.

---

### Task 3: Expose retry on the failed-exceptions screen

**Production sources:**
- Modify: `apps/web/src/modules/request-workflow/orchestration.ts`
- Modify: `apps/web/src/components/requests/checklist-exceptions-list.tsx`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`
- Modify: `apps/web/messages/en-US.json`
- Modify: `apps/web/messages/es-EC.json`

**Tests:**
- Modify: `apps/web/src/modules/request-workflow/orchestration.integration.test.ts`
- Modify: `apps/web/src/components/requests/checklist-exceptions-list.test.tsx`

**Produces:** The failed-exceptions query includes failed automated invites with safe fields, and each eligible row submits its own action identity to `retryProvisioning`; localized messages describe conflict, forbidden, and retry outcomes.

- [ ] **Step 1: Write RED query and component tests**

Assert the exception query returns both orchestration failures and failed automated invite actions within trusted scope, but never raw request/response or connector observations. Render an enabled retry control only for the automated generic failure row, preserve disabled behavior for verification failures, bind the exact action ID, and assert accessible pending/error feedback in both locales.

- [ ] **Step 2: Verify RED**

Run the focused orchestration integration and component tests; require failure because the list is checklist-only and retry is deferred.

- [ ] **Step 3: Implement the minimal read/UI wiring**

Generalize the failure item union without weakening its company-scoped query, pass the server action into the component, render one row-level form/control, and add only the required i18n keys. Do not expose a client-supplied company ID.

- [ ] **Step 4: Reach GREEN**

Rerun both suites and the relevant exceptions-page test/type-check.

- [ ] **Step 5: Commit Task 3**

Commit `feat(US-065): expose provisioning retry`.

- [ ] **Step 6: Preview every touched shard**

Run preflight against the committed candidate, intersect with the three named TypeScript/TSX production sources, and preview every intersecting exact shard. Repair genuine survivors before review; emit no `test_report`.

---

### Task 4: Adversarial verification and integration

- [ ] Run focused worker, DB routing, domain lifecycle, server-action, orchestration-read, and component suites.
- [ ] Run `pnpm test:contract` and the Anthropic probe tests to confirm the provider boundary remains Pact-backed.
- [ ] Ask an independent reviewer to trace AC1-AC3 against code and tests, emphasizing sanitization, unresolved-outcome concurrency, company-scope authorization, alert deduplication, and immutable historical actions.
- [ ] Repair every valid finding through RED/GREEN, rerun the affected task previews, and commit all fixes before the cold campaign.
- [ ] Run `MUTATION_WORK_ID=US-065 MUTATION_BASE=authority/us-065-base pnpm mutation:preflight`; if the actual shard count differs from 8, append a timestamped `deviation` and retain the approved readiness payload unchanged.
- [ ] Run `pnpm check` and commit the verified implementation candidate.

---

### Task 5: One authoritative cold campaign, evidence, and closure — LAST

- [ ] Clear mutation caches once with `pnpm mutation:cache:clear`.
- [ ] Run exactly one full diff-scoped campaign with `MUTATION_WORK_ID=US-065 MUTATION_BASE=authority/us-065-base pnpm test:mutation` and no shard selector. Require every scored shard to reach at least 80%.
- [ ] If the campaign exposes a real defect, append `mutation_invalidation`, repair through TDD and adversarial review, rerun `pnpm check`, clear caches, and run at most one replacement cold campaign.
- [ ] Append exactly one timestamped `test_report` for the valid final campaign, including `scope: "diff"`, killed/survived totals, mutation score, actual shard count, and `mutation_wallclock_s`.
- [ ] Fill `docs/readiness/US-065.json.actuals`, append timestamped AC verification and `done` events, pull the ledger, and require `nous_trace.py story timeline US-065` to show: first valid cold campaign with no shard below 80%, at most two cold campaigns, readiness-to-plan at most ten minutes where reconstructable, review no longer than implementation, at most three docs commits, and total no more than 336 minutes.
- [ ] Commit only terminal evidence. Any later production or test commit invalidates the campaign.
