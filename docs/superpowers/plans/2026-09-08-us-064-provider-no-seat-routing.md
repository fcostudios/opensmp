**Work item:** US-064
**Readiness assessment:** docs/readiness/US-064.json
**Approved estimate:** 104 minutes

# US-064 Provider No-Seat Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route only a contract-recognized Anthropic invitation seat-limit response into the atomic `blocked_no_seat` capacity workflow while preserving every other provider failure for US-065.

**Architecture:** The Anthropic adapter converts one exact, bounded 400 error envelope into a provider-neutral `capacity_unavailable` result and writes the same sanitized code into the existing observation summary JSON. The invitation worker verifies that durable evidence under tenant-bound locks, atomically finalizes the failed action and transitions the request through the lifecycle engine; capacity recovery later retains that failed action and creates a new pending attempt.

**Tech Stack:** TypeScript, Vitest, fast-check, Pact V3, Drizzle SQL, PostgreSQL/Testcontainers, pnpm, Stryker

**Spec:** `docs/superpowers/specs/2026-09-08-us-064-provider-no-seat-routing-design.md`

## Readiness

- `work_id`: `US-064`
- Readiness artifact: `docs/readiness/US-064.json`
- Approved payload: `e1a1d0ac1db253740fe51ecf6073bce4209617ba8f446c8e2305be6e9a80518e`
- Estimate: 104 minutes, within the 320-minute limit

## Global Constraints

- Classify capacity exhaustion only for `create_invite`, HTTP `400`, `application/json`, strict `invalid_request_error`, and exact message `Your organization has reached its seat limit.`
- Read at most 8 KiB of provider error data; malformed, oversized, truncated, differently cased, padded, or otherwise non-exact data fails closed.
- Never retain or expose the provider error body, message, request ID, credentials, or transport exception.
- The provider-neutral result and durable observation expose only `failure_code: "capacity_unavailable"`; the database observation classification remains `client_error` and no migration is added.
- The local action finalization and `provisioning -> blocked_no_seat` transition commit or roll back in one PostgreSQL transaction bound to action, request, vendor account, and real `company_id`.
- A capacity recovery creates a new pending action and leaves the failed no-seat action immutable.
- Generic provider failures remain outside `blocked_no_seat` for US-065.
- Tests use real owned code and real PostgreSQL; only the true Anthropic HTTP boundary may be faked and it remains Pact-backed.
- Every feedback event after `started` carries ISO-8601 UTC `ts`; exactly one authoritative `test_report` is emitted.
- Adversarial verification precedes `pnpm check`; one cache-cleared diff-scoped `pnpm test:mutation` campaign is last. A later code or test commit invalidates it.
- Acceptance target: `story timeline US-064` reports at most two cold campaigns and review minutes no greater than implementation minutes.

---

### Task 1: Contract-recognized and durably observed capacity failure

**Files:**
- Create: `packages/connectors/src/providers/anthropic/capacity-failure.ts`
- Create: `packages/connectors/src/providers/anthropic/capacity-failure.test.ts`
- Modify: `packages/connectors/src/contracts.ts`
- Modify: `packages/connectors/src/dispatch.ts`
- Modify: `packages/connectors/src/providers/anthropic/request.ts`
- Modify: `packages/connectors/src/providers/anthropic/observation.ts`
- Modify: `packages/connectors/src/providers/anthropic/observation.test.ts`
- Modify: `packages/connectors/src/connector-call-observation.ts`
- Modify: `packages/connectors/src/providers/anthropic/connector.ts`
- Modify: `packages/connectors/src/providers/anthropic/connector.test.ts`
- Modify: `scripts/probes/anthropic/pact.contract.test.ts`

**Interfaces:**
- Produces: `AnthropicCapacityFailureCode = "capacity_unavailable"` and `readAnthropicCapacityFailure(response, endpoint): Promise<AnthropicCapacityFailureCode | null>`.
- Produces: `ConnectorResult<T>` variant `{ ok:false, code:"capacity_unavailable", retryable:false, raw:{ failure_code:"capacity_unavailable" } }`.
- Produces: optional observation summary field `failure_code: "capacity_unavailable"` while terminal classification remains `client_error`.
- Consumes: the existing Anthropic request executor, observation bridge, connector dispatcher, and Pact composition.

- [ ] **Step 1: Write the failing pure classifier tests**

Add tests that pass a streamed JSON `Response` to `readAnthropicCapacityFailure` and assert the exact recognized envelope returns `"capacity_unavailable"`. Parameterize near misses for endpoint, status, media type, error type, message case, prefix, suffix, whitespace, malformed JSON, arrays, missing fields, extra error fields, and an 8,193-byte body; each must return `null`. Assert the response body is consumed or cancelled without surfacing its contents.

- [ ] **Step 2: Run the classifier test and verify RED**

Run: `pnpm --filter @smp/connectors test -- src/providers/anthropic/capacity-failure.test.ts`

Expected: FAIL because `capacity-failure.ts` and `readAnthropicCapacityFailure` do not exist.

- [ ] **Step 3: Implement the bounded exact classifier**

Export a frozen one-entry message allowlist and a reader that consumes at most 8 KiB from `response.body.getReader()`, cancels on overflow, decodes UTF-8 fatally, parses JSON, checks the exact closed envelope, and returns only `"capacity_unavailable"` or `null`. Never return or throw provider-controlled text.

- [ ] **Step 4: Run the classifier tests and verify GREEN**

Run: `pnpm --filter @smp/connectors test -- src/providers/anthropic/capacity-failure.test.ts`

Expected: PASS with every exact and near-match case green.

- [ ] **Step 5: Write failing result and observation contract tests**

Extend connector and observation-bridge tests to require:

```ts
{
  ok: false,
  code: "capacity_unavailable",
  retryable: false,
  raw: { failure_code: "capacity_unavailable" },
}
```

for the exact response. Require the terminal observation to remain `classification: "client_error"` and add `summary.failure_code: "capacity_unavailable"`. Assert every generic or near-match error still returns `{ code:"provider_error", raw:null }` and has no `failure_code`. Route the exact result through `createConnectorDispatcher` in the connector test and assert cloning, freezing, and JSON-safety there.

- [ ] **Step 6: Run focused contracts and verify RED**

Run: `pnpm --filter @smp/connectors test -- src/dispatch.test.ts src/connector-call-observation.test.ts src/providers/anthropic/request.test.ts src/providers/anthropic/observation.test.ts src/providers/anthropic/connector.test.ts`

Expected: FAIL because the new result variant and sanitized observation field are absent.

- [ ] **Step 7: Implement the semantic result and sanitized journal field**

Add the exact `capacity_unavailable` variant to `ConnectorResult<T>` and dispatcher validation. Extend the Anthropic request failure result and observation input with optional `failureCode`, invoke the bounded reader only for the candidate `create_invite` 400, and pass the code through the observation bridge. Extend `ConnectorCallSummary` and `failed()` input with the exact optional failure code. Map the exact request result to the semantic connector result while leaving all other failures unchanged.

- [ ] **Step 8: Run focused contracts and verify GREEN**

Run: `pnpm --filter @smp/connectors test -- src/dispatch.test.ts src/connector-call-observation.test.ts src/providers/anthropic/capacity-failure.test.ts src/providers/anthropic/request.test.ts src/providers/anthropic/observation.test.ts src/providers/anthropic/connector.test.ts`

Expected: PASS with pristine output.

- [ ] **Step 9: Write the failing Pact interaction**

Add a `POST /v1/organizations/invites` interaction returning the exact 400 envelope. Assert the connector result is the semantic sanitized result, the observation summary carries only the sanitized code, and serialized outputs exclude the provider message and request ID. Add a near-match 400 interaction that remains generic.

- [ ] **Step 10: Run the Pact test and verify RED**

Run: `pnpm test:probe -- --run scripts/probes/anthropic/pact.contract.test.ts`

Expected: FAIL until the connector contract wiring preserves the new semantic result through the shipped package boundary.

- [ ] **Step 11: Complete Pact wiring and verify GREEN**

Make only the minimal export or interaction-wiring adjustments required, then rerun `pnpm test:probe -- --run scripts/probes/anthropic/pact.contract.test.ts`.

Expected: PASS, with Pact artifacts cleaned up by the existing harness.

- [ ] **Step 12: Commit Task 1**

Stage exactly the Task 1 files and commit: `feat(US-064): classify Anthropic capacity exhaustion`.

---

### Task 2: Atomic no-seat action finalization and lifecycle transition

**Files:**
- Modify: `packages/domain/src/request-workflow/lifecycle.ts`
- Modify: `packages/domain/src/request-workflow/lifecycle.test.ts`
- Modify: `apps/worker/src/jobs/automated-invite-delivery.ts`
- Modify: `apps/worker/src/jobs/automated-invite-delivery.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's `capacity_unavailable` connector result and observation `summary.failure_code`.
- Produces: legal lifecycle edge `provisioning -> blocked_no_seat`.
- Produces: transactional no-seat finalization that returns `true` only when one exact action/request pair changes state.

- [ ] **Step 1: Write the failing lifecycle test**

Update the exact transition-table oracle so `provisioning` permits `blocked_no_seat` in addition to `invited`, `active`, and `failed`. Add direct legal/illegal assertions proving the reverse edge and unrelated edges did not broaden.

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run: `pnpm --filter @smp/domain test -- src/request-workflow/lifecycle.test.ts`

Expected: FAIL because the production transition table lacks `blocked_no_seat` from `provisioning`.

- [ ] **Step 3: Add the minimal lifecycle edge and verify GREEN**

Add only `"blocked_no_seat"` to the `provisioning` targets and rerun the focused lifecycle test.

Expected: PASS.

- [ ] **Step 4: Write failing real-PostgreSQL no-seat tests**

Extend the US-063 worker fixture with exact no-seat and generic-error transports. Assert the exact response produces:

- one failed connector observation with `classification='client_error'` and sanitized `summary.failure_code`;
- action `status='failed'`, `resolved_at` set, `raw_response={"failure_code":"capacity_unavailable"}`, and no provider message;
- request `state='blocked_no_seat'`;
- exactly one `provisioning -> blocked_no_seat` transition and one matching audit entry;
- a second drain and concurrent drain cannot add another transition;
- another company's action is unchanged.

Add separate assertions that near-match 400, 401, 403, 409, 422, 429, and 503 responses never enter `blocked_no_seat`. Add a trigger-induced audit failure and assert action/request/transition changes roll back while the append-only connector observation remains.

- [ ] **Step 5: Run the worker integration test and verify RED**

Run: `pnpm --filter @smp/worker test -- src/jobs/automated-invite-delivery.integration.test.ts`

Expected: FAIL because `deliver()` returns `false` for every connector failure and no transactional no-seat finalizer exists.

- [ ] **Step 6: Implement transactional no-seat finalization**

Add a focused `finalizeNoSeat()` beside success `finalize()`. Under one transaction, lock the exact pending action and provisioning request, require the matching durable sanitized failed observation, update only that action to failed/resolved with sanitized raw response, call `assertLegalTransition("provisioning", "blocked_no_seat")`, and invoke `applyRequestTransitionInTransaction` with the real company ID. Roll back on any error and return `false` for a stale or duplicate candidate.

Branch `deliver()` only on `result.code === "capacity_unavailable"`; all generic failures retain the pre-US-064 behavior.

- [ ] **Step 7: Run the worker integration and lifecycle suites and verify GREEN**

Run: `pnpm --filter @smp/domain test -- src/request-workflow/lifecycle.test.ts && pnpm --filter @smp/worker test -- src/jobs/automated-invite-delivery.integration.test.ts`

Expected: PASS with no leaked provider-controlled text.

- [ ] **Step 8: Commit Task 2**

Stage exactly the four Task 2 files and commit: `feat(US-064): route no-seat attempts atomically`.

---

### Task 3: Retain failed evidence across capacity recovery

**Files:**
- Modify: `packages/db/src/provisioning-routing.ts`
- Modify: `packages/db/src/provisioning-routing.test.ts`
- Modify: `apps/worker/src/jobs/capacity-recovery.integration.test.ts`

**Interfaces:**
- Consumes: Task 2's failed historical no-seat action and existing `blocked_no_seat -> provisioning` recovery route.
- Produces: provisioning-action reuse limited to a pending action; recovery creates a new action without deleting or mutating the failed attempt.

- [ ] **Step 1: Write the failing routing unit test**

Script an executor whose first action lookup represents a historical failed no-seat action followed by a blocked request. Assert routing does not return that action and instead issues a new action insert plus request transition and audit statements. Keep the existing pending-action idempotency assertion.

- [ ] **Step 2: Run the routing test and verify RED**

Run: `pnpm --filter @smp/db test -- src/provisioning-routing.test.ts`

Expected: FAIL because the current action lookup reuses actions regardless of status.

- [ ] **Step 3: Restrict action reuse to pending work**

Add `AND status='pending'` to the locked existing-action query. Do not delete, overwrite, or otherwise special-case failed rows.

- [ ] **Step 4: Run the routing test and verify GREEN**

Run: `pnpm --filter @smp/db test -- src/provisioning-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing recovery integration assertion**

Seed a blocked request with a failed no-seat action and available capacity. Run the real recovery job and assert the request returns to `provisioning`, the original action remains failed with its sanitized raw response and resolved timestamp, and one distinct new pending action exists for the same request and vendor account.

- [ ] **Step 6: Run the recovery integration test and verify RED**

Run: `pnpm --filter @smp/worker test -- src/jobs/capacity-recovery.integration.test.ts`

Expected: FAIL until recovery ignores the historical action and creates a replacement.

- [ ] **Step 7: Make the minimal fixture or query integration adjustment and verify GREEN**

Use the Task 3 pending-only reuse behavior without adding a new recovery branch. Rerun the database unit test and worker recovery integration test.

Expected: PASS with both historical and replacement actions visible.

- [ ] **Step 8: Commit Task 3**

Stage exactly the three Task 3 files and commit: `feat(US-064): retain no-seat evidence during recovery`.

---

### Task 4: Adversarial verification, one cold campaign, and completion evidence

**Files:**
- Modify: `.nous-feedback.jsonl`
- Modify: `docs/readiness/US-064.json`

**Interfaces:**
- Consumes: reviewed commits from Tasks 1-3.
- Produces: timestamped AC evidence, one build report, one authoritative mutation report, calibrated actuals, and terminal `done`.

- [ ] **Step 1: Record story start before implementation measurement**

Before Task 1 implementation begins, append one timestamped `started` event with agent `codex/us-064-provider-no-seat-routing`. This is the timeline's first measurement point; include it in the first implementation commit or the final evidence commit without rewriting it.

- [ ] **Step 2: Run adversarial AC verification before mutation**

Verify AC1 with exact transition counts, transaction rollback, concurrency, and tenant-binding evidence. Verify AC2 by showing the retained failed action plus distinct recovery action and legal return to provisioning. Verify AC3 with the generic and near-match response matrix. Append one timestamped `ac_verify` event per AC against the final reviewed source commit.

- [ ] **Step 3: Run the full gate**

Run: `MUTATION_WORK_ID=US-064 pnpm check`

Expected: all type checks, lint, generated guidance, readiness checks, focused/integration suites, Pact probe, database tests, workspace tests, and builds pass. Append one timestamped `build_pass` event naming the reviewed source commit.

- [ ] **Step 4: Inspect mutation preflight and record any shard-count deviation**

Read the preflight output from `pnpm check`. If `mutation_shards_actual` differs from the approved expected value `1`, append a timestamped `deviation` event and later record the actual count; do not edit the approved readiness payload.

- [ ] **Step 5: Clear mutation caches**

Run: `pnpm mutation:cache:clear`

Expected: all repository-owned mutation caches for the diff-scoped campaign are removed.

- [ ] **Step 6: Run the one authoritative campaign last**

Run: `MUTATION_WORK_ID=US-064 MUTATION_BASE=authority/us-064-base pnpm test:mutation`

Expected: every calculated shard runs before the command exits; aggregate score meets the repository threshold. If a real defect requires a code or test change, append `mutation_invalidation`, fix through TDD and review, rerun `pnpm check`, clear caches, and make at most one second cold attempt.

- [ ] **Step 7: Append the single test report, actuals, and done event**

Append exactly one timestamped `test_report` with `scope:"diff"`, killed/survived counts, score, `mutation_wallclock_s`, and annotations. Fill readiness actuals with phase minutes, total, changed files, commits, review loops, cold attempts, invalidations, mutation minutes, `mutation_shards_actual`, variance, and root cause. Append a timestamped `done` event naming the verified source commit.

- [ ] **Step 8: Verify chronology and timeline**

Run:

```bash
pnpm readiness:check -- US-064
python3 /Users/fcolomas/Projects/nous/Nous/System/nous_trace.py story timeline US-064 --project fcostudios__smp
git diff --check
```

Expected: readiness is valid; timeline shows start, AC verification, build, one test report, and done in order; cold campaigns are at most two and measured review minutes do not exceed implementation minutes.

- [ ] **Step 9: Commit the evidence**

Stage exactly `.nous-feedback.jsonl` and `docs/readiness/US-064.json`, then commit: `docs(US-064): record provider no-seat routing evidence`.

The evidence-only commit does not modify code or tests and therefore does not invalidate the authoritative campaign.
