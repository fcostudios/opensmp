**Work item:** US-066
**Readiness assessment:** docs/readiness/US-066.json
**Approved estimate:** 224 minutes

# US-066 Accepted Invitation Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Detect accepted provider invitations on the scheduled 15-minute poll, atomically activate the exact tenant request, and create exactly one license assignment with durable resumable poll evidence.

**Architecture:** Preserve the existing complete `syncMembers()` contract while adding a provider-neutral page continuation seam used by the worker. The worker runs membership activation after automated invitation delivery, checkpoints only sanitized cursor/count/set-size evidence on each eligible sent action between provider pages, and resumes from that checkpoint after interruption. Each accepted match is finalized in one tenant-scoped transaction that locks the action and request, guards against an existing assignment, opens one assignment, links it to the request, resolves the action, and applies the canonical `invited -> active` transition.

**Tech Stack:** TypeScript, worker jobs, connector contracts, Anthropic REST transport, Drizzle SQL, PostgreSQL/Testcontainers, Vitest, Pact, pnpm, Stryker

**Spec authority:** Approved US-019 partition in `docs/readiness/US-019.json`; DEC-SMP-021/CHG-054 canonical allocation in `docs/stories/CHANGES.md`; generated child `docs/stories/sprint-3/r1_misc_us_066.md`; and `docs/superpowers/plans/2026-08-02-sprint-3-delivery.md`, section **Task 7: Deliver US-019 provisioning and membership confirmation**.

## Readiness

- `work_id`: `US-066`
- Readiness artifact: `docs/readiness/US-066.json`
- Approved payload: `a95626d9a0d27a1f296bc521acd0e6907f4e53c76d8ba9bddb093c94434716f2`
- Estimate: 224 minutes, within the 320-minute limit
- Planned scope: 16 files and 8 mutation shards, calculated under CHG-058

## Global constraints

- Reuse the existing `invitePoll` schedule and its per-vendor, per-quarter-hour idempotency key. Do not introduce a second scheduler or migration.
- Keep `syncMembers()` backward compatible. Add page continuation as an explicit connector contract with an opaque, JSON-safe cursor; never expose provider response bodies, IDs, credentials, or member PII as poll evidence.
- A checkpoint records only stream position, page count, and cumulative member-set size. Persist it after every successful page so a later run resumes at the next unprocessed page.
- Provider calls occur outside database transactions. Each checkpoint and each accepted-member finalization uses a short transaction.
- Candidate selection joins action, request, person, and vendor account on their real keys; requires an automated sent invite, an invited request, and an active API account; and never matches across vendor accounts or companies.
- Activation locks the exact action/request pair and checks that the request remains `invited`, the action remains `sent`, and no assignment is already linked. `source_request_id` is evidence, not a database uniqueness fence.
- Assignment creation, request linkage, action confirmation/evidence, lifecycle transition, transition evidence, and audit evidence are atomic.
- Tests use real owned code and real PostgreSQL. Only the Anthropic HTTP transport boundary is substituted, under the existing Pact-backed seam.
- Every feedback event after `started` carries ISO-8601 UTC `ts`; previews emit no `test_report`; exactly one authoritative final `test_report` is emitted.
- If remaining work at a task boundary appears likely to exceed 224 minutes, append a timestamped `deviation` or `blocked` event before continuing.

---

### Task 1: Add resumable membership-page connector semantics

**Production sources:**
- Modify: `packages/connectors/src/contracts.ts`
- Modify: `packages/connectors/src/dispatch.ts`
- Modify: `packages/connectors/src/providers/anthropic/connector.ts`

**Tests:**
- Modify: `packages/connectors/src/dispatch.test.ts`
- Modify: `packages/connectors/src/providers/anthropic/connector.test.ts`

**Produces:** A provider-neutral `syncMemberPage` operation whose cursor can resume the members/invitations streams, while `syncMembers` remains a compatible full-snapshot operation composed from the same validated page logic.

- [ ] **Step 1: Write RED connector contract tests**

  Specify an immutable, JSON-safe continuation containing the current stream and provider continuation token. Assert one call returns normalized members plus sanitized `{cursor, pageCount, memberSetSize, complete}` evidence; the next call resumes without refetching completed pages; a terminal page returns `cursor: null`; malformed or cyclic cursors fail safely; and the none connector returns the canonical unsupported result. Assert full `syncMembers()` retains its existing output and observation behavior.

- [ ] **Step 2: Verify RED**

  Run `pnpm --filter @smp/connectors test -- src/dispatch.test.ts src/providers/anthropic/connector.test.ts`; require failure because the page operation does not exist.

- [ ] **Step 3: Implement the minimal page contract**

  Add the typed cursor/page result and `syncMemberPage` method, validate it in the dispatcher, and implement Anthropic members-then-invitations continuation using the existing request executor and strict parsers. Build the legacy full snapshot by consuming pages and deduplicating normalized email membership exactly as today. Freeze returned values and keep raw provider data out of the public result.

- [ ] **Step 4: Reach GREEN and preserve Pact coverage**

  Rerun the focused connector suites and `pnpm test:contract`.

- [ ] **Step 5: Commit Task 1**

  Commit `feat(US-066): add resumable membership pages`.

- [ ] **Step 6: Preview every touched shard**

  Run `MUTATION_WORK_ID=US-066 MUTATION_BASE=authority/us-066-base pnpm mutation:preflight`, select every generated shard intersecting the three production sources, and run each exact ID with `MUTATION_SHARD=<id>`. Repair genuine survivors through RED/GREEN and rerun affected previews to at least 80%. Emit no `test_report`.

---

### Task 2: Activate accepted invitations with durable checkpoints

**Production sources:**
- Create: `apps/worker/src/jobs/membership-poll.ts`
- Modify: `apps/worker/src/connector-composition.ts`

**Tests:**
- Create: `apps/worker/src/jobs/membership-poll.integration.test.ts`
- Modify: `apps/worker/src/connector-composition.test.ts`

**Produces:** A tenant-scoped membership poll service that resumes from action evidence and atomically produces one assignment and one lifecycle activation.

- [ ] **Step 1: Write RED real-PostgreSQL behavior tests**

  Given a sent automated invite, assert an inactive or absent provider member leaves the request invited with no assignment. Given the matching active member, assert exactly one assignment with the injected Ecuador `started_on`, `source_request_id`, and `source_kind='request'`; the request points to it; the action becomes confirmed with sanitized final poll evidence; and exactly one `invited -> active` transition and audit record exist. Assert replay and concurrent pollers create neither a second assignment nor a second transition. Assert same-email people in another company or vendor account are untouched and no raw provider value enters evidence.

- [ ] **Step 2: Write RED interruption/resume tests**

  Interrupt after a successful nonterminal page, then run the job again. Assert the action retained the next cursor, page count, and member-set size; the second run starts at that cursor; and an accepted member encountered around the interruption activates at most once. Trigger a database failure during checkpoint or finalization and assert transactional rollback without advancing evidence incorrectly.

- [ ] **Step 3: Verify RED**

  Run `pnpm --filter @smp/worker test -- src/jobs/membership-poll.integration.test.ts`; require failure because the job does not exist.

- [ ] **Step 4: Implement polling and activation**

  Load only eligible tenant/account candidates and account-bound credentials, construct the observed connector through the existing composition seam, resume from each action's validated checkpoint, and process one provider page at a time outside transactions. In short transactions, lock and revalidate each candidate before checkpointing or activation. For an active normalized email match, explicitly guard the request assignment pointer and existing request-sourced assignment, insert the assignment, set the request pointer, confirm the action with final evidence, call `assertLegalTransition` and `applyRequestTransitionInTransaction`, then commit. Treat stale/replayed candidates as no-ops.

- [ ] **Step 5: Reach GREEN**

  Rerun the membership integration suite, connector-composition suite, request-transition suite, and domain lifecycle suite.

- [ ] **Step 6: Commit Task 2**

  Commit `feat(US-066): activate accepted invitations`.

- [ ] **Step 7: Preview every touched shard**

  Recompute preflight, preview every shard intersecting both production sources, repair all genuine survivors before review, and emit no `test_report`.

---

### Task 3: Wire activation into the scheduled 15-minute poll

**Production sources:**
- Modify: `apps/worker/src/jobs/deferred.ts`

**Tests:**
- Modify: `apps/worker/src/jobs/deferred.test.ts`
- Modify: `apps/worker/src/runtime.integration.test.ts`

**Produces:** Every existing vendor-scoped `invitePoll` execution delivers pending invites first, then checks accepted memberships, and closes both owned resources on success or failure.

- [ ] **Step 1: Write RED composition tests**

  Assert the existing `*/15` scheduled handler passes the exact optional vendor account to invitation delivery and membership activation in that order, returns the combined processed count, closes both services exactly once, and still attempts cleanup when either run fails. Assert runtime scheduling retains the quarter-hour cron and vendor-scoped idempotency key.

- [ ] **Step 2: Verify RED**

  Run `pnpm --filter @smp/worker test -- src/jobs/deferred.test.ts src/runtime.integration.test.ts`; require failure because activation is not wired.

- [ ] **Step 3: Implement minimal handler composition**

  Create both jobs from the shared runtime options, run delivery before membership activation, preserve explicit vendor filtering, aggregate their counts, and close resources deterministically without changing the schedule registry.

- [ ] **Step 4: Reach GREEN**

  Rerun the focused worker suites and the domain schedule suite.

- [ ] **Step 5: Commit Task 3**

  Commit `feat(US-066): poll accepted memberships every quarter hour`.

- [ ] **Step 6: Preview every touched shard**

  Recompute preflight, preview every shard intersecting `apps/worker/src/jobs/deferred.ts`, repair genuine survivors, and emit no `test_report`.

---

### Task 4: Adversarial verification and integration

- [ ] Run the focused connector, Pact, membership-poll, deferred-handler, runtime, request-transition, lifecycle, and register-integrity suites.
- [ ] Ask an independent reviewer to trace AC1-AC3 against code and tests, emphasizing cursor validation, interruption ordering, provider-call transaction boundaries, same-email cross-tenant/account isolation, action/request locking, assignment idempotency without a unique source constraint, and evidence sanitization.
- [ ] Repair every valid finding through RED/GREEN, rerun the affected task previews, and commit all fixes before the cold campaign.
- [ ] Run `MUTATION_WORK_ID=US-066 MUTATION_BASE=authority/us-066-base pnpm mutation:preflight`; if the actual shard count differs from 8, append a timestamped `deviation` and retain the approved readiness payload unchanged.
- [ ] Run `pnpm check`, append timestamped `build_pass` plus AC1-AC3 `ac_verify` events, and commit the verified implementation candidate.

---

### Task 5: One authoritative cold campaign, evidence, and closure — LAST

- [ ] Clear mutation caches once with `pnpm mutation:cache:clear`.
- [ ] Run exactly one full diff-scoped campaign with `MUTATION_WORK_ID=US-066 MUTATION_BASE=authority/us-066-base pnpm test:mutation` and no shard selector. Require every scored shard and the aggregate to reach at least 80%.
- [ ] If the campaign exposes a real defect, append `mutation_invalidation`, repair through TDD and adversarial review, rerun `pnpm check`, clear caches, and run at most one replacement cold campaign.
- [ ] Append exactly one timestamped `test_report` for the valid final campaign, including `scope: "diff"`, killed/survived totals, mutation score, actual shard count, and `mutation_wallclock_s`.
- [ ] Fill `docs/readiness/US-066.json.actuals`, append the timestamped `done` event, pull the ledger, and require `nous_trace.py story timeline US-066` to show the accepted-invite activation, review, campaign, and terminal actuals.
- [ ] Commit only terminal evidence. Any later production or test commit invalidates the campaign.
