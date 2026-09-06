**Work item:** CHG-043
**Readiness assessment:** docs/readiness/CHG-043.json
**Approved estimate:** 100 minutes

# CHG-043 Root Test Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the normal repository gate discover every Vitest workspace, require an explicit Vitest config, and reject owned-code mocks without weakening the alert acknowledgement integration test.

**Architecture:** A dependency-free Node checker derives the pnpm workspace package set from the repository manifests and verifies that every package whose test command invokes Vitest owns a `vitest.config.*` file. Alert acknowledgement database orchestration moves into a focused non-server service: the server action still loads the real Ledger authorization, while the adjacent service test supplies an explicit authorization value and exercises the real PostgreSQL repository and policy.

**Tech Stack:** Node.js 22 ESM, pnpm workspaces, TypeScript 5.7, Vitest 4, PostgreSQL/Testcontainers, Stryker mutation testing.

**Spec:** `docs/readiness/CHG-043.json`

## Global Constraints

- Run `pnpm readiness:check -- CHG-043` before implementation and leave the approved readiness payload unchanged until actuals are recorded after delivery.
- Follow `docs/dev-guide/TESTING.md`: never mock Ledger-owned code; use deterministic fixtures and real PostgreSQL for owned persistence and policy behavior.
- Keep the server action as the only production caller of `loadCurrentLedgerAuthorization`; never accept authorization from client input.
- The workspace checker must derive its package set from repository configuration and manifests, not from a maintained package allowlist.
- A package whose test script invokes Vitest must own one explicit `vitest.config.ts`, `vitest.config.mts`, `vitest.config.js`, or `vitest.config.mjs` file.
- Add no runtime dependency and do not change migrations, routes, UI, or generated Nous-owned guidance.
- Wire both test-policy lint and the Vitest workspace audit into the normal `pnpm check` path.
- Run the diff-scoped mutation gate for the extracted production service, disposition every survivor under `docs/dev-guide/TESTING.md`, then run `pnpm check`.

---

### Task 1: Fixture-backed Vitest workspace discovery guard

**Files:**
- Create: `scripts/check-vitest-workspaces.mjs`
- Create: `scripts/test-vitest-workspaces.mjs`
- Create: `packages/notifications/vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: root `pnpm-workspace.yaml`, package `package.json` manifests, and package-local Vitest config filenames.
- Produces: `findVitestWorkspaceConfigFailures(rootDir): readonly string[]` and a CLI that exits nonzero with one diagnostic per missing config.

- [ ] **Step 1: Write the failing fixture checks**

Create `scripts/test-vitest-workspaces.mjs` with temporary repository fixtures that write a root `pnpm-workspace.yaml` containing `packages/*`. Assert these exact properties with `node:assert/strict`:

```js
assert.deepEqual(findVitestWorkspaceConfigFailures(configuredRoot), []);
assert.deepEqual(
  findVitestWorkspaceConfigFailures(missingRoot),
  ["packages/notifications: test script invokes vitest but no vitest.config.* exists"],
);
assert.deepEqual(findVitestWorkspaceConfigFailures(nonVitestRoot), []);
```

The configured fixture has `packages/config/vitest.config.ts`; the missing fixture has `packages/notifications/package.json` with `"test": "vitest run --passWithNoTests"`; the non-Vitest fixture has `"test": "node --test"`. Remove each temporary directory in `finally`.

- [ ] **Step 2: Run the fixture test and confirm red**

Run:

```bash
node scripts/test-vitest-workspaces.mjs
```

Expected: FAIL because `check-vitest-workspaces.mjs` and its export do not exist.

- [ ] **Step 3: Implement deterministic workspace discovery**

Create `scripts/check-vitest-workspaces.mjs`. Export:

```js
export function findVitestWorkspaceConfigFailures(rootDir) {
  // Return sorted, package-relative diagnostics; do not call process.exit here.
}
```

Parse the `packages:` list in `pnpm-workspace.yaml`, expand its simple directory globs, read each discovered `package.json`, and inspect every string value in `scripts`. Treat a script as Vitest-backed only when a shell token is `vitest` or ends in `/vitest`; ignore substring-only names. Accept the four explicit config filenames named in Global Constraints. Sort packages and diagnostics so fixture output is stable. In CLI mode, print diagnostics to stderr and set `process.exitCode = 1`; print one success summary otherwise.

- [ ] **Step 4: Prove the checker fails on the current repository**

Run:

```bash
node scripts/test-vitest-workspaces.mjs
node scripts/check-vitest-workspaces.mjs .
```

Expected: fixture test PASS; repository check FAIL naming only `packages/notifications`.

- [ ] **Step 5: Add the notifications configuration**

Create `packages/notifications/vitest.config.ts` using the repository convention:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.{test,spec}.ts"],
  },
});
```

- [ ] **Step 6: Wire the guard and fixture into root scripts**

Add `lint:vitest-workspaces` as `node scripts/check-vitest-workspaces.mjs .`, append it to `lint:tests`, and make root `lint` invoke `pnpm run lint:tests`. Add `test:vitest-workspaces` as `node scripts/test-vitest-workspaces.mjs` and invoke it from the root `test` chain. Preserve all existing checks and their order otherwise.

- [ ] **Step 7: Run focused verification**

Run:

```bash
node scripts/test-vitest-workspaces.mjs
pnpm lint:vitest-workspaces
pnpm --filter @smp/notifications test
```

Expected: all commands PASS and notifications tests are selected through the explicit configuration.

- [ ] **Step 8: Commit Task 1**

```bash
git add scripts/check-vitest-workspaces.mjs scripts/test-vitest-workspaces.mjs packages/notifications/vitest.config.ts package.json
git commit -m "fix(CHG-043): audit Vitest workspace configuration"
```

---

### Task 2: Real alert acknowledgement service integration test

**Files:**
- Create: `apps/web/src/modules/alerts/ack-alert-service.ts`
- Create: `apps/web/src/modules/alerts/ack-alert-service.test.ts`
- Modify: `apps/web/src/modules/alerts/actions.ts`
- Delete: `apps/web/src/modules/alerts/actions.test.ts`

**Interfaces:**
- Consumes: `LedgerAuthorization`, `ackAlertPolicy`, and `createAlertRepository`.
- Produces: `ackAlertWithAuthorization(input: unknown, context: Readonly<{ authorization: LedgerAuthorization; databaseUrl: string; now?: () => Date }>): Promise<AckAlertResult>`.

- [ ] **Step 1: Move the existing integration fixture to the adjacent service test and remove the mock**

Rename `actions.test.ts` to `ack-alert-service.test.ts`. Remove `vi`, `vi.mock`, `vi.mocked`, the `server-authorization` import, and all process environment mutation. Import `ackAlertWithAuthorization` from `./ack-alert-service`. Call it with the real fixture URL and explicit authorization:

```ts
const result = await ackAlertWithAuthorization(
  { alertEventId: event },
  {
    authorization: authorization([ids.companyA], "group_admin"),
    databaseUrl: fixture.appUrl,
    now: () => new Date("2026-09-06T18:00:00.000Z"),
  },
);
```

Retain the exact row assertions for successful acknowledgement and forbidden non-admin behavior. Replace the missing-environment test with a direct assertion that an empty `databaseUrl` is rejected before persistence.

- [ ] **Step 2: Run the service test and confirm red**

Run:

```bash
pnpm --filter smp-web exec vitest run src/modules/alerts/ack-alert-service.test.ts
```

Expected: FAIL because `ack-alert-service.ts` does not exist.

- [ ] **Step 3: Implement the minimal database-backed service**

Create `ack-alert-service.ts` with the exact public signature from Interfaces. Reject an empty `databaseUrl` with `DATABASE_URL is required`. Create the real alert repository, call `ackAlertPolicy` with the supplied authorization, repository `acknowledgeEvent`, and `context.now ?? (() => new Date())`, then always close the repository in `finally`. Do not import the server authorization loader or read process environment inside this module.

- [ ] **Step 4: Make the server action delegate without widening trust**

Keep `actions.ts` marked `"use server"`. Preserve the environment check, load authorization with `loadCurrentLedgerAuthorization()`, and call:

```ts
return ackAlertWithAuthorization(input, {
  authorization,
  databaseUrl: process.env.DATABASE_URL,
});
```

Update the action comment to state that the service owns the real repository transaction orchestration. Do not export a dependency-injected server action and do not accept authorization in `input`.

- [ ] **Step 5: Run focused behavior and policy checks**

Run:

```bash
pnpm --filter smp-web exec vitest run src/modules/alerts/ack-alert-service.test.ts src/modules/alerts/ack-alert-policy.test.ts src/modules/alerts/repository.integration.test.ts
pnpm --filter smp-web type-check
pnpm lint:tests
```

Expected: real PostgreSQL behavior PASS, web type-check PASS, and owned-code mock lint PASS with no exception or allowlist.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/web/src/modules/alerts/ack-alert-service.ts apps/web/src/modules/alerts/ack-alert-service.test.ts apps/web/src/modules/alerts/actions.ts apps/web/src/modules/alerts/actions.test.ts
git commit -m "fix(CHG-043): test alert acknowledgement without owned mocks"
```

---

### Task 3: Mutation, integration, and delivery evidence

**Files:**
- Modify only if required by evidence routing: `scripts/mutation-scope.mjs`
- Modify only if the router changes: `scripts/test-mutation-scope.mjs`
- Modify after delivery: `docs/readiness/CHG-043.json`
- Modify after delivery: `.nous-feedback.jsonl`

**Interfaces:**
- Consumes: Task 1 root gate and Task 2 adjacent service test.
- Produces: retained mutation evidence, passing full repository gate, readiness actuals, and terminal CHG-043 lifecycle events.

- [ ] **Step 1: Preview the diff-scoped mutation route**

Run:

```bash
MUTATION_BASE=d1a8605 MUTATION_SCOPE_DRY=1 pnpm test:mutation
```

Expected: the manifest includes `apps/web/src/modules/alerts/ack-alert-service.ts` and its adjacent test. If it does not, add the smallest deterministic router rule plus a fixture assertion in `scripts/test-mutation-scope.mjs`; run `pnpm test:mutation-scope` and commit that correction before continuing.

- [ ] **Step 2: Run the cache-disabled mutation campaign**

Run:

```bash
MUTATION_BASE=d1a8605 MUTATION_CACHE_DISABLE=1 pnpm test:mutation
```

Expected: PASS at or above the critical-path threshold in `docs/dev-guide/TESTING.md`; inspect and disposition every survivor. Add only behaviorally meaningful assertions that kill a real mutant; do not add coverage-only tests.

- [ ] **Step 3: Run the complete repository gate**

Run:

```bash
pnpm check
```

Expected: type-check, lint including `lint:tests` and the Vitest workspace audit, all test suites, and all builds PASS.

- [ ] **Step 4: Perform two-stage review**

Dispatch one reviewer against the approved readiness artifact and plan, then a separate code-quality reviewer against the full branch diff. Resolve every finding with a focused test where behavior changes, rerun the affected checks, and repeat review until both reviewers approve.

- [ ] **Step 5: Commit integration fixes if any**

```bash
git add package.json scripts/check-vitest-workspaces.mjs scripts/test-vitest-workspaces.mjs packages/notifications/vitest.config.ts apps/web/src/modules/alerts/ack-alert-service.ts apps/web/src/modules/alerts/ack-alert-service.test.ts apps/web/src/modules/alerts/actions.ts apps/web/src/modules/alerts/actions.test.ts
git commit -m "fix(CHG-043): address integration review"
```

Expected: omit this commit when review produces no changes; never stage unrelated paths.

- [ ] **Step 6: Record actuals and lifecycle evidence**

Update `docs/readiness/CHG-043.json` actuals from primary git/test evidence. Append digest-valid `ac_verify` events for AC1 through AC3, a `build_pass` event naming the tested source commit, any required mutation event, and a terminal `done` event to `.nous-feedback.jsonl`. Run:

```bash
pnpm readiness:check -- CHG-043
pnpm readiness:check:all
pnpm test:feedback-order
```

Expected: all lifecycle and readiness checks PASS.

- [ ] **Step 7: Commit closure evidence**

```bash
git add docs/readiness/CHG-043.json .nous-feedback.jsonl
git commit -m "docs(CHG-043): record terminal closure"
```

- [ ] **Step 8: Verify the final tree**

Run:

```bash
pnpm check
git status --short
```

Expected: full gate PASS and the worktree is clean.
