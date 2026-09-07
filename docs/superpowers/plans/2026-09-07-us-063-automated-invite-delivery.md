**Work item:** US-063
**Readiness assessment:** docs/readiness/US-063.json
**Approved estimate:** 104 minutes

# Automated Invite Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> task-by-task and superpowers:test-driven-development for every behavioral
> change. Complete adversarial verification and all repairs before the sole
> cold mutation campaign.

**Goal:** Make the existing 15-minute `invitePoll` worker execute one real
Anthropic invitation for each eligible automated action and durably bind its
provider reference, connector observations, and `invited` lifecycle state.

**Architecture:** A worker-local delivery job uses account-scoped credential
resolution, the shipped Anthropic connector, and a session-level advisory lock.
The connector's requested/terminal observations are committed around the true
network boundary. A shared database lifecycle helper atomically finalizes the
action and legal request transition after known success.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle, pg, libsodium, Vitest,
Testcontainers, Anthropic connector, Stryker.

**Spec:** `docs/superpowers/specs/2026-09-07-us-063-automated-invite-delivery-design.md`

## Global Constraints

- Run `pnpm readiness:check -- US-063` before the first implementation edit.
- Use only the canonical US-063 scope; do not implement US-064 retry/no-seat,
  US-065 retry policy, or US-066 activation.
- Never replay an action with any connector-call observation. An unmatched
  requested attempt is ambiguous and remains visible for reconciliation.
- Never hold an open transaction or row lock across provider transport. Use a
  session-level advisory lock, then re-check state and observations.
- Resolve credentials only for the scheduler-supplied vendor account and never
  log secrets, encrypted envelopes, raw bodies, email addresses, or provider
  error text.
- Tests substitute only the true Anthropic HTTP boundary. PostgreSQL,
  credential crypto, connector observation sessions, lifecycle validation,
  and worker orchestration remain real owned code.
- Every test must name the production mutation or contract failure it catches
  and must be observed failing before implementation.
- Every lifecycle/verification event appended to `.nous-feedback.jsonl` has an
  ISO-8601 UTC `ts`; emit exactly one `test_report` after the final campaign.
- Any implementation commit after the cold mutation campaign invalidates it.

## Planned Path Budget

The readiness estimate anticipated eight files. Repository discovery showed
that production credential decryption and lifecycle persistence are currently
web-local; the first PostgreSQL RED test then proved that the least-privilege
runtime lacked the required `vendor_ref` grant, and runtime inspection proved
cron payloads are coordinator-shaped. The cohesive implementation may
therefore touch these thirty-five paths without changing a table shape. The
first cold campaign then stopped before mutant creation because five shared or
composition-root sources lacked explicit accountability routes; its minimal
repair adds only the mutation router and its contract test:

1. `.nous-feedback.jsonl`
2. `docs/readiness/US-063.json`
3. `pnpm-lock.yaml`
4. `packages/db/package.json`
5. `packages/db/src/credential-crypto.ts`
6. `packages/db/src/request-transition.ts`
7. `apps/web/src/modules/vendor-catalog/credential-crypto.ts`
8. `apps/web/src/modules/request-workflow/transition-core.ts`
9. `apps/worker/package.json`
10. `apps/worker/src/jobs/automated-invite-delivery.ts`
11. `apps/worker/src/jobs/automated-invite-delivery.integration.test.ts`
12. `apps/worker/src/jobs/deferred.ts`
13. `apps/worker/src/jobs/deferred.test.ts`
14. `packages/connectors/package.json`
15. `packages/db/scripts/verify-schema.mjs`
16. `packages/db/src/migrations/V20260907210200__automated_invite_vendor_reference_grant.sql`
17. `packages/db/src/migrations/V20260907210300__verify_automated_invite_vendor_reference_grant.sql`
18. `apps/worker/src/runtime.ts`
19. `packages/db/src/credential-crypto.test.ts`
20. `apps/worker/src/runtime.integration.test.ts`
21. `packages/connectors/src/providers/anthropic/connector.ts`
22. `packages/connectors/src/providers/anthropic/connector.test.ts`
23. `docs/superpowers/specs/2026-09-07-us-063-automated-invite-delivery-design.md`
24. `docs/superpowers/plans/2026-09-07-us-063-automated-invite-delivery.md`
25. `apps/worker/src/connector-composition.ts`
26. `eslint.provider-boundary.config.mjs`
27. `packages/connectors/src/source-boundary.ts`
28. `packages/connectors/src/dispatch.test.ts`
29. `scripts/mutation-scope.mjs`
30. `scripts/test-mutation-scope.mjs`
31. `packages/contracts/package.json`
32. `packages/contracts/src/automated-provisioning.ts`
33. `packages/contracts/src/automated-provisioning.test.ts`
34. `apps/worker/src/connector-composition.test.ts`
35. `apps/web/src/modules/vendor-catalog/credential-crypto-adapter.test.ts`

Package exports stay explicit. The append-only permission migration is recorded
by the timestamped deviation event; it grants only `vendor_ref` and its verifier
rejects broad table or raw-payload mutation. Stop and emit another deviation if
the behavior requires a table-shape change, another production subsystem, or
more than the approved 104-minute total.

---

### Task 1: Establish the Authority and Story Start

**Estimated phase:** readiness 8 minutes

**Files:**
- Append: `.nous-feedback.jsonl`

- [ ] Confirm `main` contains this design and plan and is otherwise clean.
- [ ] Create `authority/us-063-base` at the post-plan commit.
- [ ] Use `superpowers:using-git-worktrees` to create
  `.worktrees/us-063-invite-delivery` on
  `feature/provisioning/us-063-invite-delivery` from the authority ref.
- [ ] In the worktree run `pnpm install`, `pnpm readiness:check -- US-063`, and
  the existing worker/connectors focused suites as the clean baseline.
- [ ] Claim/start US-063 in Nous, append the sole timestamped `started` event,
  validate feedback order, and commit:

```bash
git add .nous-feedback.jsonl
git commit -m "docs(US-063): record automated invite delivery start"
```

### Task 2: Extract Shared Credential and Lifecycle Boundaries

**Estimated phases:** implementation 20 minutes; focused verification 4 minutes

**Files:**
- Create: `packages/db/src/credential-crypto.ts`
- Create: `packages/db/src/request-transition.ts`
- Modify: `packages/db/package.json`
- Modify: `apps/web/src/modules/vendor-catalog/credential-crypto.ts`
- Modify: `apps/web/src/modules/request-workflow/transition-core.ts`
- Modify: `pnpm-lock.yaml`

- [ ] Add failing tests to the existing credential-crypto and transition suites
  proving byte-identical credential behavior, system-actor legality, exact
  expected-state conflict handling, audit persistence, and preservation of web
  authorization checks. Observe RED before moving implementation.
- [ ] Move the KEK file reader and envelope decryptor into the database package;
  keep encryption and the web public import surface unchanged through explicit
  re-exports/imports. Add only the direct libsodium dependency required by that
  package.
- [ ] Add a database-owned transaction helper that validates the expected and
  target lifecycle states, performs the conditional request update, writes the
  transition, and appends the audit row with a nullable system actor.
- [ ] Refactor the web transition helper to retain authorization/company checks
  and delegate persistence to the shared helper.
- [ ] Run focused DB, credential, and request-workflow suites GREEN, then commit:

```bash
git add packages/db/package.json packages/db/src/credential-crypto.ts \
  packages/db/src/request-transition.ts pnpm-lock.yaml \
  apps/web/src/modules/vendor-catalog/credential-crypto.ts \
  apps/web/src/modules/request-workflow/transition-core.ts
git commit -m "refactor(US-063): share credential and lifecycle boundaries"
```

### Task 3: Drive the Automated Invite Job With Real PostgreSQL

**Estimated phases:** implementation 28 minutes; focused verification 8 minutes

**Files:**
- Create: `apps/worker/src/jobs/automated-invite-delivery.ts`
- Create: `apps/worker/src/jobs/automated-invite-delivery.integration.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Write one real-PostgreSQL integration fixture that seeds two companies,
  account-scoped encrypted credentials, free-pool automated actions, and
  deterministic provider transport.
- [ ] Add failing cases for: success/evidence/finalization order; second drain;
  concurrent drains; unmatched requested attempt; known failure; foreign vendor
  account; malformed payload; stale request state; invalid/foreign credentials;
  and a transport-side crash after invitation creation. Assert exact transport
  call counts and no persisted secrets/raw bodies. Observe RED.
- [ ] Implement strict candidate loading, account-bound credential decryption,
  advisory-lock acquisition/re-check, real observation session construction,
  Anthropic connector dispatch, and transactional action/request finalization.
- [ ] Ensure `processed` counts only newly finalized invitations. Provider and
  ambiguous failures remain unresolved and are not converted into US-065 retry
  behavior.
- [ ] Run the new integration suite GREEN and commit:

```bash
git add apps/worker/package.json pnpm-lock.yaml \
  apps/worker/src/jobs/automated-invite-delivery.ts \
  apps/worker/src/jobs/automated-invite-delivery.integration.test.ts
git commit -m "feat(US-063): deliver automated Anthropic invitations"
```

### Task 4: Wire the Existing Fifteen-Minute Handler

**Estimated phases:** implementation 8 minutes; focused verification 4 minutes

**Files:**
- Modify: `apps/worker/src/jobs/deferred.ts`
- Modify: `apps/worker/src/jobs/deferred.test.ts`

- [ ] Write failing handler tests proving `invitePoll` supports a coordinator
  payload without a vendor account, preserves manual vendor scoping, constructs
  the delivery job with the worker connection string and KEK path, forwards the
  scheduled timestamp, closes resources, and reports the finalized count
  through `successfulJob`.
- [ ] Replace only the `invitePoll` US-018 placeholder. Preserve every other
  deferred handler and the existing `JOB_SCHEDULES.invitePoll` 15-minute cron.
- [ ] Run the worker unit and integration suites GREEN and commit:

```bash
git add apps/worker/src/jobs/deferred.ts apps/worker/src/jobs/deferred.test.ts
git commit -m "feat(US-063): wire the scheduled invitation poll"
```

### Task 5: Adversarial Verification and Repairs

**Estimated phases:** review 16 minutes; integration 4 minutes

- [ ] Map AC1-AC3 to executable evidence and attempt to break vendor scoping,
  action replay, advisory-lock concurrency, observation ordering, terminal
  evidence proof, lifecycle legality, credential secrecy, and the 15-minute
  scheduler contract.
- [ ] Add every legitimate regression test before its repair. Run focused tests,
  then `pnpm check`. Complete all code/test fixes now.
- [ ] Use `superpowers:verification-before-completion`; inspect the full diff
  from `authority/us-063-base`, confirm no US-064/065/066 behavior leaked in,
  and commit all repairs before proceeding.

### Task 6: Run One Cold Diff-Scoped Mutation Campaign Last

**Estimated phase:** integration 4 minutes

- [ ] Confirm the worktree is clean, all adversarial review is closed, and no
  implementation or test edit remains.
- [ ] Clear the mutation cache and run exactly one cold campaign:

```bash
pnpm mutation:cache:clear
MUTATION_BASE=authority/us-063-base pnpm test:mutation
```

- [ ] Do not run another implementation test or modify implementation/test code
  after this point. Record `mutation_wallclock_s`, killed/survived, score, one
  timestamped `test_report`, AC verification, `build_pass`, and actuals in
  `docs/readiness/US-063.json`; append the timestamped `done` event.
- [ ] Validate only readiness/feedback evidence, query
  `nous_trace.py story timeline US-063`, commit the evidence, and use
  `superpowers:finishing-a-development-branch` to integrate the completed
  branch.
