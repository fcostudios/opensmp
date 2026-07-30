# Sprint 3 Readiness Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a fully green hosted pipeline and a synchronized Nous plan at `current_sprint: sprint-3`, while preserving US-054 as an honest external Anthropic go-live deferral.

**Architecture:** Repair the four host-dependent test/process contracts at their narrow boundaries, add a Pact-backed contract gate around the existing Anthropic probe HTTP seam, then update the Nous source of truth and regenerate Ledger’s planning projections. CI remains fail-fast in the order verify → contract → mutation → E2E; Sprint 3 starts with key-independent stories while live Anthropic acceptance remains blocked on operator credentials and authorization.

**Tech Stack:** TypeScript, Vitest, Node.js child processes, Docker Compose, Pact JS 17, GitHub Actions, Python/SQLite Nous tooling, pnpm/Turborepo.

---

## File map

| File | Responsibility |
|---|---|
| `apps/web/src/test-support/intl.ts` | Test-only normalization of host ICU spacing without changing production formatting |
| `apps/web/src/components/requests/request-record.test.tsx` | Exact Ecuador timeline oracle after spacing normalization |
| `apps/web/src/components/requests/checklist-exceptions-list.test.tsx` | Exact rendered `<time>` oracle after spacing normalization |
| `apps/web/src/modules/vendor-catalog/compose-credential-secrets.test.ts` | Serializer-independent secret-mount security contract |
| `packages/db/scripts/check-migration-parity.mjs` | Portable, bounded pnpm invocation |
| `packages/db/src/parity-process.spec.ts` | POSIX/Windows invocation and process-safety tests |
| `scripts/probes/anthropic/pact.contract.test.ts` | Anthropic consumer contracts over the real probe HTTP seam |
| `scripts/probes/anthropic/vitest.contract.config.ts` | Isolated Pact contract-test configuration |
| `package.json`, `pnpm-lock.yaml` | Pact dependency and contract command |
| `.github/workflows/ci.yml` | Explicit contract gate between verify and mutation |
| `.nous-feedback.jsonl` | Append-only CHG-011 decisions, external deferral, and final evidence |
| `Nous/Specs/fcostudios/smp/v1/08_scope.md` | Canonical US-018 ACs and prerequisites |
| `Nous/Specs/fcostudios/smp/v1/10_plan.md` | Canonical Sprint 3 ordering |
| `Nous/Specs/fcostudios/smp/v1/stories/r1_misc_us_018.md` | Reconciled generated story dependency/AC projection |
| `docs/stories/*`, `.nous-*.json` | Nous-generated Ledger projections after sync |

### Task 1: Open CHG-011 and preserve the external boundary

**Files:**
- Modify: `.nous-feedback.jsonl`
- Test: `scripts/check-nous-feedback-order.mjs`

- [ ] **Step 1: Append the change-start and decisions**

Append these JSON objects without modifying prior lines:

```json
{"story":"CHG-011","event":"started","agent":"codex/sprint3-readiness"}
{"story":"CHG-011","event":"decision","id":"CHG011-CONTROLLED-SPRINT3-START","text":"Sprint 2 remains terminally closed_with_deferrals and Sprint 3 may start after CI, contract, dependency, and projection gates pass. US-054 remains blocked_external and is a live-provider terminal/go-live gate for US-018, US-019, US-026, and US-030 rather than a blocker for key-independent Sprint 3 work.","reason":"Per-organization Admin/Analytics keys, an approved canary, mutation authorization, and immediate VendorAccount confirmation are unavailable, while US-011, US-023, US-025, and US-043 do not require live Anthropic access."}
{"story":"US-054","event":"blocked","reason":"External operator inputs remain unavailable: per-organization Admin and Analytics keys, approved invite-canary address, explicit invite mutation authorization, and immediate VendorAccount confirmation. No live provider request or invite mutation is authorized."}
{"story":"SPRINT-2","event":"closed_with_deferrals","notes":"Sprint 2 implementation and 37/37 acceptance evidence remain terminally accepted. US-054 live Anthropic execution is carried visibly as an external Sprint 3 connector go-live gate and is not marked done."}
{"story":"CHG-011","event":"decision","id":"CHG011-US025-BEFORE-US018","text":"US-025 must complete before US-018 because the concrete Anthropic connector consumes the VendorAccount mode and capability descriptor semantics owned by US-025. Generated scope, story, graph, and sprint-plan projections must encode US-025 as a US-018 prerequisite.","reason":"The prior plan placed US-018 before US-025 while US-018 AC3 explicitly depended on US-025 semantics."}
{"story":"CHG-011","event":"decision","id":"CHG011-ANTHROPIC-PACT-GATE","text":"The existing US-054 Anthropic HTTP seam and future US-018 connector mocks must be backed by Pact consumer contracts covering organization identity, members, invites, analytics, endpoint-specific headers, pagination, rate-limit/error classification, distinct key families, and exact decimal cost strings. Contract tests run after integration tests and before mutation.","reason":"TESTING.md requires every true third-party mock to have a corresponding Pact contract; the repository previously had deterministic Anthropic fixtures but no Pact suite."}
```

- [ ] **Step 2: Run lifecycle validation**

Run:

```bash
pnpm test:feedback-order
pnpm test:feedback-order:fixtures
```

Expected: both commands print their `ok` result.

- [ ] **Step 3: Commit the change decision**

```bash
git add .nous-feedback.jsonl
git commit -m "docs(CHG-011): open Sprint 3 readiness repair"
```

### Task 2: Make ICU date assertions portable without weakening them

**Files:**
- Create: `apps/web/src/test-support/intl.ts`
- Modify: `apps/web/src/components/requests/request-record.test.tsx`
- Modify: `apps/web/src/components/requests/checklist-exceptions-list.test.tsx`

- [ ] **Step 1: Add a failing normalization test at the first caller**

Add this import and assertion to `request-record.test.tsx`:

```ts
import { normalizeIntlWhitespace } from "@/test-support/intl";

test("normalizes only ICU non-breaking spacing", () => {
  expect(normalizeIntlWhitespace("27 jul 2026, 11:30 p.\u00a0m.")).toBe(
    "27 jul 2026, 11:30 p. m.",
  );
  expect(normalizeIntlWhitespace("27 jul 2026, 11:30 p.\u202fm.")).toBe(
    "27 jul 2026, 11:30 p. m.",
  );
  expect(normalizeIntlWhitespace("27 jul 2026, 11:31 p. m.")).not.toBe(
    "27 jul 2026, 11:30 p. m.",
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter smp-web exec vitest run \
  src/components/requests/request-record.test.tsx
```

Expected: fail because `@/test-support/intl` does not exist.

- [ ] **Step 3: Implement the narrow helper**

Create:

```ts
export function normalizeIntlWhitespace(value: string): string {
  return value.replace(/[\u00a0\u202f]/gu, " ");
}
```

- [ ] **Step 4: Apply it to both exact semantic oracles**

Change the timeline assertion to:

```ts
expect(
  normalizeIntlWhitespace(formatTimelineDateTime(instant, "es-EC")),
).toBe("27 jul 2026, 11:30 p. m.");
```

In `checklist-exceptions-list.test.tsx`, import the helper and replace the
host-sensitive `getByText` assertion with:

```ts
const expectedSentAt = new Intl.DateTimeFormat("es-EC", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date("2026-07-18T12:00:00.000Z"));
const sentAt = within(table).getByText((_content, element) =>
  element?.tagName === "TIME" &&
  normalizeIntlWhitespace(element.textContent ?? "") ===
    normalizeIntlWhitespace(expectedSentAt),
);
expect(sentAt.getAttribute("datetime")).toBe("2026-07-18T12:00:00.000Z");
```

- [ ] **Step 5: Run both tests repeatedly**

```bash
for run in 1 2 3 4 5; do
  pnpm --filter smp-web exec vitest run \
    src/components/requests/request-record.test.tsx \
    src/components/requests/checklist-exceptions-list.test.tsx
done
```

Expected: five consecutive green runs.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/test-support/intl.ts \
  apps/web/src/components/requests/request-record.test.tsx \
  apps/web/src/components/requests/checklist-exceptions-list.test.tsx
git commit -m "test(CHG-011): normalize portable ICU spacing"
```

### Task 3: Make the Compose secret-mount oracle version-independent

**Files:**
- Modify: `apps/web/src/modules/vendor-catalog/compose-credential-secrets.test.ts`
- Test: `infra/docker-compose.import.yml`

- [ ] **Step 1: Write the portable security assertion**

Import `readFile` and change `bind` to optional:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

bind?: { create_host_path?: boolean };
```

Replace the exact two-object comparison with:

```ts
const mounts = config.services.app.volumes ?? [];
for (const expected of [
  {
    source: "/srv/ledger/secrets/go-live-credential-manifest.json",
    target: "/run/ledger-secrets/go-live-credential-manifest.json",
  },
  {
    source: "/srv/ledger/secrets/integration-credential.kek",
    target: "/run/ledger-secrets/integration-credential.kek",
  },
]) {
  const mount = mounts.find((candidate) => candidate.target === expected.target);
  expect(mount).toMatchObject({
    type: "bind",
    source: expected.source,
    target: expected.target,
    read_only: true,
  });
  expect(mount?.bind?.create_host_path ?? false).toBe(false);
}
const overlay = await readFile(
  join(repositoryRoot, "infra/docker-compose.import.yml"),
  "utf8",
);
expect(overlay.match(/create_host_path:\s*false/gu)).toHaveLength(2);
```

- [ ] **Step 2: Verify against the installed Compose serializer**

```bash
pnpm --filter smp-web exec vitest run \
  src/modules/vendor-catalog/compose-credential-secrets.test.ts
```

Expected: 3/3 pass whether the JSON serializer emits `bind: {}` or
`bind.create_host_path: false`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modules/vendor-catalog/compose-credential-secrets.test.ts
git commit -m "test(CHG-011): assert portable Compose secret mounts"
```

### Task 4: Correct bounded pnpm execution on Windows

**Files:**
- Modify: `packages/db/scripts/check-migration-parity.mjs`
- Modify: `packages/db/src/parity-process.spec.ts`

- [ ] **Step 1: Extend the resolver tests**

Add exact cases:

```ts
expect(
  imported.resolvePnpmInvocation(["--version"], {
    env: {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      npm_execpath: "C:\\tools\\pnpm.CMD",
    },
    platform: "win32",
    execPath: "C:\\node\\node.exe",
  }),
).toEqual({
  command: "C:\\Windows\\System32\\cmd.exe",
  args: ["/d", "/s", "/c", "C:\\tools\\pnpm.CMD", "--version"],
});

expect(
  imported.resolvePnpmInvocation(["--version"], {
    env: { npm_execpath: "C:\\tools\\pnpm.cjs" },
    platform: "win32",
    execPath: "C:\\node\\node.exe",
  }),
).toEqual({
  command: "C:\\node\\node.exe",
  args: ["C:\\tools\\pnpm.cjs", "--version"],
});
```

- [ ] **Step 2: Run the resolver suite and verify RED**

```bash
pnpm --filter @smp/db exec vitest run src/parity-process.spec.ts
```

Expected: the `.CMD` case fails because the current resolver sends the shim to
Node.

- [ ] **Step 3: Implement explicit CLI-kind resolution**

Replace `resolvePnpmInvocation` with:

```js
function isJavaScriptCli(path) {
  return /\.(?:c|m)?js$/iu.test(path);
}

export function resolvePnpmInvocation(
  args,
  {
    env = process.env,
    platform = process.platform,
    execPath = process.execPath,
  } = {},
) {
  const packageManagerCli = env.npm_execpath;
  if (
    packageManagerCli &&
    basename(packageManagerCli).toLowerCase().includes("pnpm")
  ) {
    if (isJavaScriptCli(packageManagerCli)) {
      return { command: execPath, args: [packageManagerCli, ...args] };
    }
    if (platform === "win32") {
      return {
        command: env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", packageManagerCli, ...args],
      };
    }
  }
  if (platform === "win32") {
    return {
      command: env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd", ...args],
    };
  }
  return { command: "pnpm", args };
}
```

All arguments passed by this module are static internal drizzle-kit arguments;
do not expose the resolver to client input.

- [ ] **Step 4: Run focused and full DB tests**

```bash
pnpm --filter @smp/db exec vitest run src/parity-process.spec.ts
pnpm --filter @smp/db test
```

Expected: 5/5 portability tests and the complete DB suite pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/check-migration-parity.mjs \
  packages/db/src/parity-process.spec.ts
git commit -m "fix(CHG-011): run pnpm portably on Windows"
```

### Task 5: Contract-back the Anthropic boundary with Pact

**Files:**
- Create: `scripts/probes/anthropic/pact.contract.test.ts`
- Create: `scripts/probes/anthropic/vitest.contract.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Install the current Pact JS release**

```bash
pnpm add --save-dev --workspace-root @pact-foundation/pact@17.0.1
```

Expected: root `package.json` and `pnpm-lock.yaml` change only for Pact and its
transitive dependencies.

- [ ] **Step 2: Add the isolated Vitest configuration**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["scripts/probes/anthropic/pact.contract.test.ts"],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 3: Add one isolated Pact interaction per provider operation**

Create a `PactV3` consumer named `ledger-anthropic-probe` and provider named
`anthropic-enterprise-api`. Use `MatchersV3.like`, `eachLike`, and `regex`.
Each `test` must call the existing exported `request()` function against
`mockServer.url`; no owned connector function is mocked.

The interaction table is:

| Description | Method | Path | Credential | Response oracle |
|---|---|---|---|---|
| current organization | GET | `/v1/organizations/me` | Admin | organization id/name |
| members | GET | `/v1/organizations/users` | Admin | ID pagination + nullable email |
| invites | GET | `/v1/organizations/invites` | Admin | ID pagination |
| create invite | POST | `/v1/organizations/invites` | Admin | schema-valid invite ID |
| withdraw invite | DELETE | `/v1/organizations/invites/inv_contract` | Admin | 204 |
| analytics users | GET | `/v1/organizations/analytics/users` | Analytics | opaque next page |
| analytics summaries | GET | `/v1/organizations/analytics/summaries` | Analytics | summary counters |
| usage report | GET | `/v1/organizations/analytics/usage_report` | Analytics | decimal counters |
| user usage report | GET | `/v1/organizations/analytics/user_usage_report` | Analytics | nullable email path |
| cost report | GET | `/v1/organizations/analytics/cost_report` | Analytics | fractional-cent string |
| user cost report | GET | `/v1/organizations/analytics/user_cost_report` | Analytics | fractional-cent string |
| rate limited | GET | `/v1/organizations/me` | Admin | 429 + retry-after |

For every interaction, require:

```ts
headers: {
  accept: "application/json",
  "anthropic-version": "2023-06-01",
  "x-api-key": regex("^contract-(admin|analytics)-key$", "contract-admin-key"),
}
```

The test callback asserts status, runs the existing schema inspection for the
endpoint, and asserts that the result is valid. Invite creation additionally
asserts `inviteId(body) === "inv_contract"`; cost interactions assert
`decimalCentsToUsd("123.4567") === "1.234567"`. The 429 interaction asserts
`classifyHttpResult(429) === "rate_limited"`.

- [ ] **Step 4: Add root and CI contract commands**

Add:

```json
"test:contract": "./apps/web/node_modules/.bin/vitest run --root . --config scripts/probes/anthropic/vitest.contract.config.ts"
```

Add this `verify` step after `Test` and before `Build`:

```yaml
- name: Verify third-party contracts
  run: pnpm test:contract
```

The existing `mutation` job remains dependent on `verify`; the E2E job remains
dependent on `mutation`.

- [ ] **Step 5: Run the Pact suite twice and inspect generated contracts**

```bash
pnpm test:contract
pnpm test:contract
```

Expected: 12/12 pass twice, no live Anthropic request occurs, and the generated
Pact contains the 12 named interactions.

- [ ] **Step 6: Run the probe mutation gate**

```bash
pnpm test:mutation:probe
```

Expected: ≥80%, no unreviewed survivor introduced by the changed provider
boundary.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .github/workflows/ci.yml \
  scripts/probes/anthropic/pact.contract.test.ts \
  scripts/probes/anthropic/vitest.contract.config.ts
git commit -m "test(US-018): contract-back Anthropic HTTP fixtures"
```

### Task 6: Correct the Nous source and regenerate Sprint 3

**Files:**
- Modify in Nous: `Specs/fcostudios/smp/v1/08_scope.md`
- Modify in Nous: `Specs/fcostudios/smp/v1/10_plan.md`
- Generated in Nous: `Specs/fcostudios/smp/v1/stories/r1_misc_us_018.md`
- Generated in Ledger: `docs/stories/SPRINT_PLAN.md`
- Generated in Ledger: `docs/stories/CHANGES.md`
- Generated in Ledger: `docs/stories/ASSIGNMENTS.md`
- Generated in Ledger: `docs/stories/INDEX.md`
- Generated in Ledger: `.nous-project.json`
- Generated in Ledger: `.nous-provenance.json`
- Generated in Ledger: `.nous-sync.json`

- [ ] **Step 1: Preview feedback ingestion**

From the Nous repository:

```bash
python3 System/nous_package.py pull \
  --source /Users/fcolomas/Projects/smp \
  --project fcostudios__smp \
  --dry-run
```

Expected: CHG-011 decisions and the Sprint 2 closure marker are recognized; no
unknown event appears.

- [ ] **Step 2: Apply the canonical US-018 correction**

In `08_scope.md`, set:

```md
- **AC1**: Client wraps User Management + Analytics APIs with endpoint-specific header policy, documented rate limits (100/min UM, 60/min Analytics, 1200 invites/h), and bounded retry/backoff; Admin and Analytics credentials are distinct and fail closed when routed to the wrong capability
- **AC2**: Every call persists a sanitized canonical ProvisioningAction/sync request+response summary; credentials, authorization headers, raw PII, full provider identifiers, and raw provider bodies are forbidden
- **AC3**: Connector implements the Connector capability interface (US-045) — nothing Claude-specific outside it (DEC-SMP-008); capability descriptor semantics per US-025
- **AC4**: Every deterministic Anthropic network fixture is backed by a passing Pact consumer contract; live credential-scope, organization-binding, pagination, rate-limit, invite-create, and invite-cleanup acceptance remains gated by the authorized US-054 provider run
- **Prerequisites**: US-003, US-045, US-025
```

In `10_plan.md`, change the US-018 blocked-by cell to:

```md
| US-018 | Anthropic connector client | 3 | US-003, US-045, US-025 |
```

- [ ] **Step 3: Reconcile story dependencies and hydrate Nous**

```bash
python3 System/nous_trace.py reconcile-deps \
  --project fcostudios__smp \
  --dry-run
python3 System/nous_trace.py reconcile-deps \
  --project fcostudios__smp
python3 System/nous_trace.py hydrate \
  --project fcostudios__smp \
  --extract 10b_stories
python3 System/nous_trace.py sprint set-current sprint-3 \
  --project fcostudios__smp
```

Expected: US-018 gains US-025 and no dependency cycle appears; current sprint
is `sprint-3`.

- [ ] **Step 4: Commit only the intended Nous source projections**

Do not stage the pre-existing `.claude/settings.json` or `WorkControl` files.

```bash
git add Specs/fcostudios/smp/v1/08_scope.md \
  Specs/fcostudios/smp/v1/10_plan.md \
  Specs/fcostudios/smp/v1/stories/r1_misc_us_018.md
git commit -m "docs(CHG-011): order and contract Sprint 3 connector"
```

- [ ] **Step 5: Preview and apply Ledger synchronization**

From Ledger:

```bash
NOUS_SYSTEM=/Users/fcolomas/Projects/nous/Nous/System \
  ./infra/scripts/sync-from-nous.sh --dry-run
NOUS_SYSTEM=/Users/fcolomas/Projects/nous/Nous/System \
  ./infra/scripts/sync-from-nous.sh
```

Expected: generated artifacts update from Nous; hand-written application code
does not change.

- [ ] **Step 6: Verify generated readiness**

```bash
rg -n "current_sprint: sprint-3" docs/stories/SPRINT_PLAN.md
rg -n "US-018.*US-025" docs/stories/SPRINT_PLAN.md \
  docs/stories/sprint-3/r1_misc_us_018.md
python3 infra/scripts/reconcile-sprint1-docs.py . --check
pnpm test:feedback-order
pnpm test:feedback-order:fixtures
pnpm validate:sidebar
```

Expected: all commands pass; Sprint 2 is terminal, US-054 remains visibly
deferred, and US-025 precedes/blocks US-018.

- [ ] **Step 7: Commit the generated sync**

```bash
git add .nous-feedback.jsonl .nous-project.json .nous-provenance.json \
  .nous-sync.json docs/stories
git commit -m "docs(CHG-011): advance Nous plan to Sprint 3"
```

### Task 7: Run every local readiness gate

**Files:**
- Verify only

- [ ] **Step 1: Run focused portability gates**

```bash
pnpm --filter @smp/db exec vitest run src/parity-process.spec.ts
pnpm --filter smp-web exec vitest run \
  src/components/requests/request-record.test.tsx \
  src/components/requests/checklist-exceptions-list.test.tsx \
  src/modules/vendor-catalog/compose-credential-secrets.test.ts
pnpm test:contract
```

Expected: all pass.

- [ ] **Step 2: Run root Definition of Done**

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
pnpm validate:routes
pnpm validate:sidebar
```

Expected: all pass.

- [ ] **Step 3: Run database owner/runtime/parity in isolation**

Provision a disposable PostgreSQL database with `ledger_owner` and
`ledger_app`, then run:

```bash
pnpm --filter @smp/db db:migrate
pnpm --filter @smp/db db:verify
pnpm --filter @smp/db db:parity
```

Expected: all committed migrations apply as owner, runtime grants remain
least-privilege, and Drizzle parity is exact.

- [ ] **Step 4: Run mutation serially**

```bash
pnpm test:mutation
```

Expected: every configured critical-path mutation gate passes. Do not overlap
Stryker runs because several operate in-place.

- [ ] **Step 5: Run exact Compose/Keycloak E2E**

```bash
pnpm --dir apps/web exec playwright test \
  e2e/sprint2-orchestration.spec.ts
```

Expected: 3/3 pass and `docker compose --project-name ledger-sprint2 ps`
returns no residual services after cleanup.

### Task 8: Obtain a fully green hosted run

**Files:**
- Modify only if hosted evidence exposes another portable defect

- [ ] **Step 1: Push the feature branch and open a PR**

```bash
git push -u origin feature/workflow/sprint3-readiness
gh pr create \
  --title "fix(CHG-011): make Sprint 3 readiness portable" \
  --body "Repairs CI portability, adds the Anthropic Pact gate, preserves the US-054 external deferral, orders US-025 before US-018, and synchronizes Nous to Sprint 3."
```

- [ ] **Step 2: Monitor all required jobs**

```bash
gh pr checks --watch --interval 30
```

Expected jobs:

- Process portability (`ubuntu-latest`) — pass
- Process portability (`windows-latest`) — pass
- verify — pass through migration, verification, and parity
- Critical-path mutation gate — executed and pass
- Sprint 2 orchestration E2E — executed and pass
- design-system — pass

- [ ] **Step 3: Repair any hosted-only failure test-first**

For any failure, reproduce the exact job command, add the narrowest oracle that
fails for the hosted behavior, implement the minimal portable correction, run
the affected local gate, commit with `CHG-011`, and push. Never rerun blindly
without diagnosing the log.

### Task 9: Record final readiness evidence

**Files:**
- Modify: `.nous-feedback.jsonl`

- [ ] **Step 1: Resolve and append source-bound final evidence**

Resolve the two evidence values:

```bash
git rev-parse HEAD
gh run list --branch feature/workflow/sprint3-readiness \
  --workflow CI --limit 1 --json headSha,url,conclusion
```

Use `apply_patch` to append a `CHG-011 test_report` object containing those
exact `source_commit` and `run_url` values, followed by:

```json
{"story":"CHG-011","event":"build_pass","notes":"Sprint 3 readiness gates pass locally and in hosted CI; generated Nous plan is synchronized at current_sprint sprint-3; US-025 blocks US-018; US-054 remains externally blocked with no live provider claim."}
{"story":"CHG-011","event":"done"}
```

The `test_report` notes must say that portability, verify, migration, schema
verification, parity, Pact contract, critical-path mutation, and
Compose/Keycloak E2E all executed and passed with no required job skipped.

- [ ] **Step 2: Validate and commit**

```bash
pnpm test:feedback-order
pnpm test:feedback-order:fixtures
git diff --check
git add .nous-feedback.jsonl
git commit -m "docs(CHG-011): record green Sprint 3 readiness"
git push
```

- [ ] **Step 3: Confirm final state**

```bash
git status --short --branch
rg -n "current_sprint: sprint-3" docs/stories/SPRINT_PLAN.md
gh pr checks
```

Expected: clean branch, synchronized Sprint 3 plan, green required checks, and
US-054 still visibly deferred rather than done.
