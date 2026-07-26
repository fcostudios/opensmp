# Ledger Sprint 1 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Sprint 1’s ten foundation stories as a reproducible, self-hosted Ledger modular monolith with enforced register integrity, Keycloak authentication, company-scoped authorization, bilingual application chrome, auditable mutations, reliable jobs, and a controlled real-data onboarding path.

**Architecture:** Keep one Next.js App Router application for pages, Server Components, Server Actions, Auth.js callbacks, and the few required route handlers. Add one non-HTTP `apps/worker` process for pg-boss, backed by the same PostgreSQL database. Put pure policies and ports in `packages/domain`, Zod contracts in `packages/contracts`, database schema/client/testing utilities in `packages/db`, reusable React primitives in `packages/ui`, and infrastructure under `infra`.

**Tech Stack:** Node.js 22.12+, pnpm 9, Turborepo, Next.js 16, React 19, TypeScript 5.7, Auth.js/NextAuth 5 with Keycloak, PostgreSQL 16, Drizzle ORM/Kit, pg-boss, Zod, next-intl, Vitest, PGlite, Testcontainers, Playwright, Stryker, Docker Compose, and age-encrypted PostgreSQL backups.

---

## 1. Planning verdict

Sprint 1 is safe to execute **after the readiness gates in Task 1 are accepted**. The product design is coherent, but the synchronized package still contains generator seams that must not be guessed around:

| Gate | Evidence | Required resolution |
|---|---|---|
| Tenant key conflict | `AGENTS.md`/`CLAUDE.md` say `org_id`; `04_er_model.md`, `09_architecture.md`, all 26 Drizzle tables, and navigation roles use company scoping via `company_id` | Retain the product model’s `company_id`; file a CHG and correct generated agent/dev-guide text before feature code |
| Auth source conflict | Current Auth.js session reads Keycloak realm roles; DEC-SMP-014 says business roles exist only in Ledger DB | Keycloak carries only the technical `platform-admin` role/group; enrich sessions from `UserAccount` and `CompanyRoleAssignment` |
| Login UX conflict | `SCR-login` shows password/TOTP fields inside Ledger; Keycloak OIDC owns credentials and TOTP | Render a Ledger-branded “Continue with corporativo.” action that redirects to Keycloak; record this as a spec reconciliation note |
| Authentication-failure audit ownership | Password and TOTP failures occur inside Keycloak and never reach an Auth.js callback | Decide in CHG-001 whether Keycloak's retained security-event log satisfies US-004 or whether Ledger must ingest Keycloak events; do not claim Ledger has audited failures until the chosen path is tested |
| Migration workflow conflict | Committed append-only migrations coexist with a DoD based on `drizzle-kit push`, which cannot apply custom grants/triggers | CI and release apply the committed migration chain; `push` remains a schema-parity diagnostic, not the production migration mechanism |
| Hosting residue | Architecture is VPS/Docker Compose, but Vercel files/comments remain | Remove Vercel-only configuration and replace the generated cron route with the pg-boss worker |
| External inventory gate | OQ-SMP-1 is unresolved | US-007 cannot be marked done until the operator supplies the inventory and reconciled counts |
| External API gate | US-054 requires per-org Admin and Analytics keys | Build the safe probe harness immediately; execute the mutating invite canary only with explicit operator authorization |

### Fixed planning decisions

These decisions are used throughout the plan:

1. `company_id` is the company-scope key. There is no synthetic `org_id` tenant column.
2. `VendorAccount` represents an Anthropic organization and may serve multiple companies.
3. Server Component reads and Server Actions are the default application API. Route handlers are reserved for Auth.js, health, exports, webhooks, and external scheduler ingress.
4. Business roles are not hierarchical. Access is an explicit capability matrix generated from `07c_navigation_map.json`.
5. `group_admin` and `central_finance` are global roles; `approver`, `finance`, and `viewer` are company grants; an employee is an active `UserAccount` with no elevated grant.
6. The app connects as `ledger_app`; migrations connect as `ledger_owner`; backups use `ledger_backup`.
7. Existing committed migration `V20251002145723__init_schema.sql` remains immutable. All corrections are new timestamped migrations.
8. Real secrets and unredacted member lists never enter Git, test snapshots, `.nous-feedback.jsonl`, or probe artifacts.

## 2. Dependency and execution model

```text
Readiness/CHG
  ├─ US-001 scaffold closure
  │    └─ US-002 runtime + CI
  │         ├─ US-003 schema integrity
  │         │    ├─ US-004 Keycloak auth
  │         │    │    ├─ US-005 authorization ── US-008 audit viewer
  │         │    │    └─ US-006 shell + i18n
  │         │    └─ US-007 import/backfill [OQ-SMP-1 gate]
  │         └─ US-046 job runner
  └─ US-054 API probe harness [real-key execution gate]
```

### Safe parallel waves

| Wave | Work | Merge condition |
|---|---|---|
| 0 | Task 1 readiness reconciliation | CHG/decision recorded; generated instructions agree with ER/architecture |
| 1 | US-001 | clean install and all root Turbo tasks execute |
| 2 | US-002 and US-054 probe harness | Compose/CI green; probe tests green without secrets |
| 3 | US-003 and US-046 | real-Postgres integrity tests green; worker schedule tests green |
| 4 | US-004 and US-007 import engine | auth integration green; import engine green; real US-007 run waits on inventory |
| 5 | US-005 and US-006 | capability/tenant isolation green; shell/i18n component tests green |
| 6 | US-008 | audited actions and audit viewer green |
| 7 | sprint acceptance | every available AC adversarially verified; external gates reported honestly |

### Ten-working-day delivery forecast

This is a dependency forecast, not a promise; it assumes three implementation tracks, timely review, a working Docker runtime, and readiness approval on Day 1.

| Day | Platform/data track | Identity/application track | Operations/integration track | Exit condition |
|---|---|---|---|---|
| 1 | Task 1 reconciliation | Task 1 review | Obtain OQ-SMP-1 inventory/key owners | CHG-001 and DEC-SMP-017 accepted |
| 2 | Tasks 2–3 | Review scaffold contracts | Begin Task 23 probe harness | US-001 green from a clean install |
| 3 | Tasks 4–5 | Keycloak realm preparation | Task 6 backup/restore | Compose and migration CI green |
| 4 | Tasks 7–8 | Task 9 realm/TOTP | Task 21 worker scaffold integration | database constraints pass on real PostgreSQL |
| 5 | Task 17 import engine | Tasks 10–11 Auth.js/login | Task 22 schedules | authentication and worker integration green |
| 6 | Task 18 backfill dry run | Tasks 12–13 authorization | Task 23 controlled probe, if keys are available | isolation matrix and probe evidence reviewed |
| 7 | Support real backfill | Tasks 14–16 shell/i18n | Restore drill and job-failure exercise | application foundation stories green |
| 8 | Real US-007 reconciliation, if inputs exist | Tasks 19–20 audit | Cross-boundary review | every implemented mutation is audited |
| 9 | Fix adversarial findings | E2E/accessibility verification | Compose production-like rehearsal | no unresolved internal acceptance failure |
| 10 | Task 24 evidence | Task 24 evidence | Task 24 evidence | shippable stories marked done; external gates reported blocked |

### Branch and integration order

Create one story branch at a time from the latest integrated `main`, using the required naming convention:

```text
feature/platform/scaffold
feature/platform/docker-runtime
feature/register/core-integrity
feature/identity/keycloak-auth
feature/identity/company-rbac
feature/shell/i18n-foundation
feature/org-registry/go-live-import
feature/audit/immutable-viewer
feature/platform/job-runner
feature/integration/anthropic-probe
```

Each PR references exactly its story ID. Merge in dependency order; do not merge a downstream branch by copying code from an unmerged prerequisite.

## 3. Target file structure

```text
apps/
  web/
    Dockerfile
    src/
      app/
        (authenticated)/layout.tsx
        (authenticated)/auditoria/page.tsx
        acceso-denegado/page.tsx
        login/page.tsx
        api/auth/[...nextauth]/route.ts
        api/health/route.ts
      components/
        auth/sign-in-button.tsx
        audit/audit-filters.tsx
        audit/audit-table.tsx
        audit/audit-diff-dialog.tsx
        layout/{app-shell,breadcrumbs,header,locale-selector,mobile-bar,sidebar}.tsx
      lib/
        auth/{auth-config,auth-types,keycloak-admin,role-landing}.ts
        i18n/{config,request}.ts
      modules/
        audit/{queries,types,with-audit}.ts
        identity-access/{actions,authorization,guards,repository}.ts
        org-registry/{actions,company-import,register-backfill}.ts
        vendor-catalog/{credential-crypto,seeding}.ts
  worker/
    Dockerfile
    package.json
    tsconfig.json
    src/{health,index,logger,schedules}.ts
    src/jobs/{alert-evaluation,analytics-sync,close-precheck,invite-poll,member-sync}.ts
packages/
  contracts/src/{audit,imports,identity,locale}.ts
  db/
    scripts/{apply-migrations,verify-integrity,verify-schema}.mjs
    src/migrations/V<timestamp>__core_schema_register_integrity.sql
    src/migrations/V<timestamp>__system_settings.sql
    src/testing/{pglite,postgres-container}.ts
  domain/src/
    audit/{port,types}.ts
    identity-access/{authorization,roles}.ts
    jobs/{job-result,schedule}.ts
    register/{assignment-period}.ts
  ui/src/
    atoms/{freshness-label,money-text,status-pill}.tsx
    organisms/{app-shell,audit-trail-viewer,data-table}.tsx
infra/
  docker-compose.yml
  docker-compose.test.yml
  postgres/init/001-roles.sql
  backup/{Dockerfile,crontab}
  keycloak/realm-corporativo.json
  scripts/{backup-db,restore-db}.sh
scripts/
  probes/anthropic/{probe,redact,schemas}.ts
  probes/anthropic/README.md
docs/
  runbooks/backup-restore.md
  spikes/US-054-anthropic-api-probe.md
  superpowers/plans/2026-07-24-sprint-1-foundations.md
```

## 4. Cross-story contracts

### Authorization context

Define this once in `packages/domain/src/identity-access/authorization.ts`:

```ts
export type GlobalRole = "group_admin" | "central_finance";
export type CompanyRole = "approver" | "finance" | "viewer";

export interface CompanyGrant {
  companyId: string;
  role: CompanyRole;
}

export interface AuthorizationContext {
  userAccountId: string;
  idpSubject: string;
  globalRole: GlobalRole | null;
  companyGrants: readonly CompanyGrant[];
}

export type Capability =
  | "company:read"
  | "company:write"
  | "finance:read"
  | "finance:close"
  | "request:create"
  | "request:approve"
  | "audit:read"
  | "admin:manage";
```

`permittedCompanyIds(context, capability)` returns `"all"` only for the global capabilities explicitly assigned to `group_admin`/`central_finance`; otherwise it returns a set derived from active `CompanyRoleAssignment` rows. `viewer` never receives a mutation capability.

### Audited mutation

Define the port in `packages/domain/src/audit/port.ts`:

```ts
export interface AuditRecordInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  companyId: string | null;
  note: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditedMutationResult<T> {
  value: T;
  audit: AuditRecordInput;
}
```

Application services call `withAudit(db, actor, mutation)` so the business mutation and `AuditLog` insert commit in the same transaction.

### Job result

Define in `packages/domain/src/jobs/job-result.ts`:

```ts
export type JobResult =
  | { status: "succeeded"; processed: number }
  | { status: "skipped"; reason: "dependency_not_delivered" | "not_scheduled_today" }
  | { status: "failed"; alertType: "credential_failure" | "sync_stale"; message: string };
```

Handlers that belong to later sprints return an explicit `skipped` result until their feature port is delivered. They must never pretend a sync ran.

---

## Task 1: Record and resolve Sprint 1 readiness decisions

**Story:** Change control prerequisite for US-001/003/004/005/007/054

**Files:**
- Create: `docs/decisions/DEC-SMP-017-sprint-1-execution-contract.md`
- Create through Nous sync: the generated record for `CHG-001`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/dev-guide/{FRONTEND,STANDARDS,SECURITY,DEFINITION_OF_DONE}.md`
- Modify: `docs/stories/SPRINT_PLAN.md` only through Nous sync, never by hand

- [ ] **Step 1: Write the reconciliation decision**

Record DEC-SMP-017 with these conclusions:

```markdown
- Company isolation uses `company_id`, as defined by 04_er_model SEC6.
- Vendor organizations are `VendorAccount`; they are not application tenants.
- Auth.js obtains identity from Keycloak and authorization from Ledger DB.
- OIDC credentials and TOTP are rendered by Keycloak, not collected by Ledger.
- Keycloak is the system of record for password/TOTP failure events. CHG-001 must choose either (a) retained and operator-queryable Keycloak security events as the US-004 audit evidence, or (b) a tested Keycloak-event ingestion adapter that writes sanitized failures to `AuditLog`.
- Releases apply committed migrations as `ledger_owner`; the app runs as `ledger_app`.
- Docker Compose/VPS is the R1 deployment target.
```

- [ ] **Step 2: File the CHG before editing generated instructions**

Open `CHG-001` in Nous before editing generated files. It must list every generator-owned line that currently says `org_id`, Auth0, Vercel, or in-app credential login and declare `company_id`, Keycloak/Auth.js, Docker Compose, and redirect-based OIDC as the replacements. It must also resolve authentication-failure audit ownership and clarify that US-004 establishes the administrative service seam while the full user-management UI remains US-011.

- [ ] **Step 3: Regenerate/sync the documentation**

Run:

```bash
rtk ./infra/scripts/sync-from-nous.sh
```

Expected: generated docs contain no `auth0`, no Vercel deployment claim, and no assertion that every table has `org_id`.

- [ ] **Step 4: Verify reconciliation**

Run:

```bash
rtk rg -n 'auth0|tenant_id|every multi-tenant.*org_id|Vercel' \
  AGENTS.md CLAUDE.md docs/dev-guide docs/specs/09_architecture.md
```

Expected: no contradictory matches. References to Anthropic organizations or historical change notes are acceptable only when they clearly mean `VendorAccount`.

- [ ] **Step 5: Commit**

```bash
rtk git add AGENTS.md CLAUDE.md docs/dev-guide docs/decisions docs/stories
rtk git commit -m "docs(architecture): reconcile Sprint 1 execution contract (CHG-001)"
```

## Task 2: Establish US-001 reproducible workspace baseline

**Files:**
- Modify: `package.json`
- Create: `pnpm-lock.yaml` through `pnpm install`
- Modify: `turbo.json`
- Modify: `apps/web/package.json`
- Modify: `packages/{config,contracts,db,domain,ui}/package.json`
- Modify: `.gitignore`
- Modify: `.github/workflows/design-system.yml`
- Test: every workspace `type-check`, `lint`, `test`, and `build` script

- [ ] **Step 1: Pin the runtime contract**

Add to the root `package.json`:

```json
{
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "check": "pnpm type-check && pnpm lint && pnpm test && pnpm build",
    "validate:routes": "./infra/scripts/validate-routes.sh",
    "validate:sidebar": "./infra/scripts/regenerate-sidebar.py --check"
  }
}
```

- [ ] **Step 2: Make empty-package tests explicit**

Until a package owns a meaningful test, set its script to:

```json
"test": "vitest run --passWithNoTests"
```

This satisfies US-001 without adding coverage-only tests. Replace `--passWithNoTests` in a package as soon as that package receives its first real test.

- [ ] **Step 3: Install the workspace**

Run:

```bash
rtk pnpm install
```

Expected: root `pnpm-lock.yaml` is created and `pnpm exec turbo --version` succeeds.

- [ ] **Step 4: Install the commit hook**

Run:

```bash
rtk ./infra/scripts/install-git-hooks.sh
rtk git config --get core.hooksPath
```

Expected: `.githooks`.

- [ ] **Step 5: Run the scaffold gate**

Run:

```bash
rtk pnpm type-check
rtk pnpm lint
rtk pnpm test
rtk pnpm build
rtk pnpm validate:routes
rtk pnpm validate:sidebar
```

Expected: every command exits 0. Fix scaffold defects under US-001; do not suppress checks.

- [ ] **Step 6: Record AC evidence**

Append `ac_verify` events only for the US-001 acceptance criteria this task
establishes: AC1 (workspace structure) and AC2 (workspace task execution).
Include the exact command and exit status for each, then append `build_pass`
with the successful scaffold-gate evidence. Do not append AC3 or `done` here:
Tailwind 4 token-layer verification belongs to Task 3, so US-001 remains in
progress after this task.

- [ ] **Step 7: Commit**

```bash
rtk git add package.json pnpm-lock.yaml turbo.json apps packages .gitignore .github .nous-feedback.jsonl
rtk git commit -m "build(repo): establish reproducible monorepo baseline (US-001)"
```

## Task 3: Close US-001 — Tailwind 4 and token ownership

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/app/globals.css`
- Modify: `packages/design-system/tokens.{css,json}`
- Modify: `packages/ui/src/atoms/status-pill.css`
- Test: `scripts/check-hardcoded-color.mjs`
- Test: `scripts/check-status-pill.mjs`

- [ ] **Step 1: Remove duplicate token declarations**

Keep `@theme` in `apps/web/src/styles/tokens.css` as the runtime Tailwind source. Keep `packages/design-system/tokens.json` as canonical machine-readable data. Generate `tokens.css` from JSON or document the one-way sync; do not maintain two unrelated value sets.

- [ ] **Step 2: Correct `StatusPill` CSS semantics**

The current CSS assigns background hexes to the `color` property. Replace it with four semantic variants:

```css
.status-pill--success { color: var(--color-success); background: var(--color-success-bg); }
.status-pill--pending { color: var(--color-pending-text); background: var(--color-pending-bg); }
.status-pill--attention { color: var(--color-error-text); background: var(--color-error-bg); }
.status-pill--neutral { color: var(--color-neutral-text); background: var(--color-neutral-bg); }
```

Each variant also renders a dot using the corresponding `*-dot` token.

- [ ] **Step 3: Run token enforcement**

Run:

```bash
rtk pnpm --filter smp-web lint:ds
```

Expected: status-pill SSOT, hardcoded-color, hardcoded-string, and Lucide checks pass.

- [ ] **Step 4: Record final US-001 evidence**

Only after token enforcement passes, append the US-001 AC3 `ac_verify` event
with the exact command and exit status, then append the story `done` event.
Tasks 2–3 together cover US-001; Task 3 is the closing evidence boundary.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/styles apps/web/src/app/globals.css packages/design-system packages/ui/src/atoms
rtk git commit -m "feat(ui): establish corporativo token baseline (US-001)"
```

## Task 4: Implement US-002 Docker Compose runtime

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/{health,index}.ts`
- Create: `infra/docker-compose.yml`
- Create: `infra/docker-compose.test.yml`
- Create: `infra/postgres/init/001-roles.sql`
- Modify: `.env.example`
- Modify: `infra/scripts/setup.sh`
- Modify: `infra/scripts/run-all.sh`
- Delete: `apps/web/vercel.json`
- Delete: `apps/web/src/app/api/cron/daily/route.ts`

- [ ] **Step 1: Create least-privilege database roles**

`001-roles.sql` creates login roles from Compose-provided secrets:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_owner') THEN
    CREATE ROLE ledger_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_backup') THEN
    CREATE ROLE ledger_backup LOGIN;
  END IF;
END $$;
```

Set passwords with `psql` variables passed by the init wrapper; do not interpolate secrets into the committed SQL file.

- [ ] **Step 2: Build a standalone Next.js image**

Enable `output: "standalone"` in `apps/web/next.config.ts`. The Dockerfile must use a dependency stage, build stage, and non-root runtime stage; copy only `.next/standalone`, `.next/static`, and `public`.

- [ ] **Step 3: Define Compose services**

`infra/docker-compose.yml` must declare:

- `postgres:16-alpine` with a real healthcheck.
- `keycloak:26.5` importing `infra/keycloak/realm-corporativo.json`.
- `app` with `depends_on` healthy Postgres and Keycloak.
- `worker` with `depends_on` healthy Postgres.
- `smtp-relay` as the declared R1 mail seam.

Expose only app `3000` and Keycloak `8180` in local development. Keep Postgres bound to localhost.

- [ ] **Step 4: Create the minimal worker process required by US-002**

Create `@smp/worker` as a workspace package now so the Compose image has a real, buildable target. Its initial process must keep a PostgreSQL connection healthy, atomically touch `/tmp/ledger-worker-heartbeat` on a bounded interval, handle SIGTERM/SIGINT, and expose no HTTP server. Task 21 replaces the file heartbeat with pg-boss database ownership.

- [ ] **Step 5: Add health checks**

The app route returns a non-secret JSON body:

```json
{"status":"ok","database":"reachable"}
```

It must return 503 if a `SELECT 1` database check fails. The initial worker healthcheck verifies that the process exists and the heartbeat file is recent.

After Task 21, update the worker check to require a current pg-boss-maintained database heartbeat.

- [ ] **Step 6: Verify Compose**

Run:

```bash
rtk docker compose -f infra/docker-compose.yml config
rtk docker compose -f infra/docker-compose.yml up -d --build
rtk docker compose -f infra/docker-compose.yml ps
rtk curl --fail http://localhost:3000/api/health
rtk curl --fail http://localhost:8180/realms/corporativo/.well-known/openid-configuration
```

Expected: app, Postgres, worker, Keycloak, and SMTP relay are healthy.

- [ ] **Step 7: Commit**

```bash
rtk git add apps/web apps/worker infra .env.example
rtk git commit -m "feat(infra): add self-hosted Compose runtime (US-002)"
```

## Task 5: Implement US-002 committed migration runner and CI

**Files:**
- Create: `packages/db/scripts/apply-migrations.mjs`
- Create: `packages/db/scripts/check-migration-parity.mjs`
- Modify: `packages/db/package.json`
- Modify: `packages/db/scripts/verify-schema.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `docs/dev-guide/DEFINITION_OF_DONE.md` through CHG sync

- [ ] **Step 1: Implement checksum-verified migration application**

`apply-migrations.mjs` must:

1. Require `DATABASE_ADMIN_URL`.
2. Acquire `pg_advisory_lock(hashtext('ledger-schema-migrations'))`.
3. Create `ledger_schema_migrations(filename text primary key, sha256 text not null, applied_at timestamptz not null default now())`.
4. Read sorted `V*.sql` files.
5. Reject a checksum mismatch for an applied filename.
6. Apply each new file in a transaction and record its checksum.
7. Release the advisory lock and close the pool in `finally`.

- [ ] **Step 2: Wire database scripts**

Add:

```json
{
  "scripts": {
    "db:migrate": "node scripts/apply-migrations.mjs",
    "db:push": "drizzle-kit push",
    "db:verify": "node scripts/verify-schema.mjs",
    "db:parity": "node scripts/check-migration-parity.mjs"
  }
}
```

- [ ] **Step 3: Make parity explicit**

`db:parity` provisions two throwaway databases:

- migration DB: apply committed `V*.sql`;
- push DB: run `drizzle-kit push`.

Compare tables, columns, types, nullability, and FKs. Ignore custom grants/triggers/extensions only in the push DB comparison; verify those separately with `verify-integrity`.

- [ ] **Step 4: Add CI**

The CI workflow runs:

```bash
rtk pnpm install --frozen-lockfile
rtk pnpm type-check
rtk pnpm lint
rtk pnpm test
rtk pnpm build
rtk pnpm validate:routes
rtk pnpm validate:sidebar
rtk pnpm --filter @smp/db db:migrate
rtk pnpm --filter @smp/db db:verify
rtk pnpm --filter @smp/db db:parity
```

Use PostgreSQL 16 as a service and run real grant tests as `ledger_app`, not as the owner.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/db .github docs/dev-guide/DEFINITION_OF_DONE.md
rtk git commit -m "ci(database): verify committed migrations on Postgres (US-002)"
```

## Task 6: Implement US-002 encrypted backup and restore stub

**Files:**
- Create: `infra/scripts/backup-db.sh`
- Create: `infra/scripts/restore-db.sh`
- Create: `infra/backup/Dockerfile`
- Create: `infra/backup/crontab`
- Create: `docs/runbooks/backup-restore.md`
- Test: `infra/tests/backup-restore.bats`

- [ ] **Step 1: Implement encrypted backup**

The script must use:

```bash
set -euo pipefail
umask 077
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" \
  > "$BACKUP_DIR/ledger-${BACKUP_TIMESTAMP}.dump.age"
```

Write SHA-256 metadata separately. Never write an unencrypted intermediate dump.

- [ ] **Step 2: Implement guarded restore**

Require `RESTORE_CONFIRM_DATABASE` to exactly match the parsed target database name. Decrypt to stdout and pipe directly into `pg_restore --clean --if-exists --no-owner`.

- [ ] **Step 3: Schedule nightly backup**

Use `0 7 * * *` UTC, which is 02:00 America/Guayaquil year-round. Mount the age recipient as configuration and the identity only into the restore operator environment, never the backup container.

- [ ] **Step 4: Run a disposable restore drill**

Back up a fixture database, restore into a second database, and assert the expected table count and migration checksum rows.

- [ ] **Step 5: Commit**

```bash
rtk git add infra/backup infra/scripts/backup-db.sh infra/scripts/restore-db.sh infra/tests docs/runbooks
rtk git commit -m "feat(ops): add encrypted backup and restore drill (US-002)"
```

## Task 7: Reconcile and complete US-003 schema

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/V<UTC timestamp>__core_schema_register_integrity.sql`
- Create: `packages/db/src/migrations/V<later UTC timestamp>__system_settings.sql`
- Create: `packages/db/src/system-ids.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/db/src/schema-parity.test.ts`

- [ ] **Step 1: Prove all 26 entities exist**

Generate a manifest from `schema.ts` and compare it to the 26 names in `04_er_model.md`. Expected entities:

```text
Company Person UserAccount CompanyRoleAssignment Vendor VendorAccount
VendorAccountCapacity LicenseType IntegrationCredential LicenseRequest
RequestTransition LicenseAssignment ProvisioningAction ReclamationProposal
ActivityRecord CostRecord RateCard Statement StatementLine CloseRun
Reconciliation ReconciliationVarianceLine AlertRule AlertEvent
SystemSetting AuditLog
```

- [ ] **Step 2: Preserve the product’s company scope**

Do not add `org_id`. Confirm company-owned tables carry direct `company_id` or are scoped through a mandatory parent:

- direct: `Person`, `LicenseRequest`, `LicenseAssignment`, `Statement`;
- optional scope hint: `AlertRule`, `AuditLog`;
- inherited: `RequestTransition` through `LicenseRequest`, `StatementLine` through `Statement`.

- [ ] **Step 3: Add a deterministic system user**

Create:

```ts
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
export const SYSTEM_USER_EMAIL = "system@ledger.invalid";
```

The settings migration inserts this disabled, non-login user before inserting settings, satisfying the non-null `SystemSetting.updated_by` FK.

- [ ] **Step 4: Seed settings idempotently**

Insert:

```sql
INSERT INTO system_setting (key, value, updated_at, updated_by) VALUES
  ('notif_sender_email', '"ledger@corporativo.ec"'::jsonb, now(), '00000000-0000-0000-0000-000000000001'),
  ('notif_escalation_email', '"admin@corporativo.ec"'::jsonb, now(), '00000000-0000-0000-0000-000000000001'),
  ('default_language', '"es"'::jsonb, now(), '00000000-0000-0000-0000-000000000001')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 5: Run schema parity**

Run:

```bash
rtk pnpm --filter @smp/db type-check
rtk pnpm --filter @smp/db db:migrate
rtk pnpm --filter @smp/db db:verify
```

Expected: 26 domain tables plus `ledger_schema_migrations` and pg-boss-owned tables when the worker has started.

## Task 8: Add US-003 register and append-only database guarantees

**Files:**
- Modify the new integrity migration from Task 7 before it is committed
- Create: `packages/db/src/testing/postgres-container.ts`
- Create: `packages/db/src/integrity/register-integrity.test.ts`
- Create: `packages/db/src/integrity/append-only.test.ts`

- [ ] **Step 1: Add the no-overlap exclusion**

Use a half-open period so a successor may start on the day after an inclusive `ended_on`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE license_assignment
  ADD CONSTRAINT license_assignment_no_overlap
  EXCLUDE USING gist (
    person_id WITH =,
    vendor_account_id WITH =,
    license_type_id WITH =,
    daterange(started_on, COALESCE(ended_on + 1, 'infinity'::date), '[)') WITH &&
  );
```

- [ ] **Step 2: Add the pending-proposal uniqueness**

```sql
CREATE UNIQUE INDEX reclamation_proposal_one_pending_per_assignment
  ON reclamation_proposal (assignment_id)
  WHERE status = 'pending';
```

The existing unique `source_request_id` constraint remains and receives an explicit test.

- [ ] **Step 3: Add the deferred reallocation-contiguity trigger**

At transaction commit, a row closed with `end_reason='reallocated'` must have a successor for the same person/vendor account/license type beginning no later than `ended_on + 1`. It must reject a missing successor and a gap; the exclusion constraint separately rejects overlap.

- [ ] **Step 4: Grant the app role only legal mutations**

Grant `ledger_app`:

- `SELECT, INSERT` on core tables;
- normal `UPDATE` on mutable catalog/workflow tables;
- `UPDATE (ended_on, end_reason)` on `license_assignment`;
- `UPDATE (status, sent_at, resolved_at)` on `provisioning_action`;
- `UPDATE (acknowledged_by, acknowledged_at)` on `alert_event`;
- no update on `request_transition` or `audit_log`;
- no delete on core tables except `company_role_assignment`.

Keep the existing triggers as defense in depth. Grants are the acceptance oracle.

- [ ] **Step 5: Test through `ledger_app`**

Real PostgreSQL tests must assert SQLSTATE/constraint name for:

1. overlapping assignment rejected;
2. adjacent assignment accepted;
3. reallocation without successor rejected at commit;
4. reallocation with contiguous successor accepted;
5. duplicate pending reclamation rejected;
6. duplicate source request rejected;
7. audit update/delete rejected;
8. request transition update/delete rejected;
9. illegal assignment column update rejected;
10. legal assignment close accepted;
11. core-table delete rejected;
12. company-role grant delete accepted and audited by application code.

- [ ] **Step 6: Run mutation and integration gates**

Run:

```bash
rtk pnpm --filter @smp/db test
rtk pnpm test:mutation
```

Expected: all integrity tests pass; changed critical-path code meets the §3 mutation threshold.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/db packages/contracts testing/critical-paths.md .nous-feedback.jsonl
rtk git commit -m "feat(database): enforce register and append-only integrity (US-003)"
```

## Task 9: Implement US-004 Keycloak realm and real integration fixture

**Files:**
- Replace: `infra/keycloak/realm-corporativo.json`
- Create: `infra/keycloak/README.md`
- Create: `packages/db/src/testing/seed-auth-users.ts`
- Create: `apps/web/src/lib/auth/keycloak-admin.ts`
- Create: `apps/web/src/lib/auth/keycloak-admin.integration.test.ts`
- Modify: `infra/docker-compose.test.yml`

- [ ] **Step 1: Remove stale SaleOS roles and clients**

The realm export must contain:

- client `smp-web` with authorization-code flow and PKCE;
- confidential service client `smp-keycloak-admin`;
- group `platform-admin`;
- technical realm role `platform-admin` assigned through that group;
- no Ledger business roles;
- seeded CI identities for employee, approver, company finance, central finance, group admin, viewer, disabled user, and admin-without-TOTP.

Ledger business-role rows are seeded only in the disposable test database through `packages/db/src/testing/seed-auth-users.ts`, with stable emails and Keycloak subject IDs. Do not put CI fixture users into a production migration.

- [ ] **Step 2: Enforce conditional TOTP**

Create a browser authentication flow that requires OTP when the user has the technical `platform-admin` role. Seed central-finance and group-admin test users into `platform-admin`; seed one admin candidate outside it for the grant-sync test.

- [ ] **Step 3: Implement the admin port**

Expose:

```ts
export interface KeycloakAdminPort {
  addUserToPlatformAdmin(idpSubject: string): Promise<void>;
  removeUserFromPlatformAdmin(idpSubject: string): Promise<void>;
  disableUser(idpSubject: string): Promise<void>;
  revokeSessions(idpSubject: string): Promise<void>;
}
```

Use Keycloak’s Admin REST API with a service-account token. Redact authorization headers and tokens from all errors/logs.

- [ ] **Step 4: Test against real Keycloak**

Do not mock Keycloak. Start the test Compose profile and verify group membership, disabled-user login denial, and the OTP-required action/flow through Admin API state plus one Playwright OIDC flow.

- [ ] **Step 5: Commit**

```bash
rtk git add infra/keycloak infra/docker-compose.test.yml apps/web/src/lib/auth
rtk git commit -m "feat(auth): configure Keycloak identity and TOTP policy (US-004)"
```

## Task 10: Implement US-004 Auth.js session enrichment and landing

**Files:**
- Modify: `apps/web/src/lib/auth/auth-config.ts`
- Create: `apps/web/src/lib/auth/auth-types.ts`
- Create: `apps/web/src/types/next-auth.d.ts`
- Create: `apps/web/src/lib/auth/role-landing.ts`
- Create: `apps/web/src/modules/identity-access/repository.ts`
- Create: `apps/web/src/modules/identity-access/session.ts`
- Create: `apps/web/src/modules/audit/auth-events.ts`
- Test: matching `*.test.ts`

- [ ] **Step 1: Define the session shape**

The session contains:

```ts
interface LedgerSessionUser {
  id: string;
  idpSubject: string;
  email: string;
  name: string;
  globalRole: "group_admin" | "central_finance" | null;
  companyGrants: readonly {
    companyId: string;
    role: "approver" | "finance" | "viewer";
  }[];
  uiLanguage: "es" | "en" | null;
}
```

Do not expose vendor credentials or raw Keycloak tokens to client components.

- [ ] **Step 2: Link the first OIDC login**

In Auth.js `signIn`:

1. Find active `UserAccount` by `idp_subject`.
2. If absent, find one by verified email with null `idp_subject`.
3. Link the Keycloak subject once using a compare-and-set update.
4. Reject unknown, conflicting, or disabled accounts.
5. Update `last_login_at`.
6. Insert a success audit event.

- [ ] **Step 3: Load business roles from PostgreSQL**

Ignore Keycloak realm roles for application authorization. Load `global_role` and currently valid company grants from Ledger DB in the JWT/session callback.

- [ ] **Step 4: Audit the failure surface selected by CHG-001**

Always audit callback/linking failures that Ledger observes. If CHG-001 requires Ledger ingestion of Keycloak password/TOTP failures, implement and integration-test that adapter before passing US-004; otherwise preserve and verify those failures in Keycloak's operator-queryable security-event log. Ledger records use a fixed authentication system entity ID and only `{provider, errorCode}`. Never store passwords, OTPs, tokens, or raw callback query strings.

- [ ] **Step 5: Implement explicit landing**

```ts
export function roleLanding(user: LedgerSessionUser): string {
  if (user.globalRole === "group_admin") return ROUTE_SCR_ADMIN_DASHBOARD;
  if (user.globalRole === "central_finance") return ROUTE_SCR_CLOSE;
  if (user.companyGrants.some((g) => g.role === "approver")) return ROUTE_SCR_APPROVAL_QUEUE;
  if (user.companyGrants.some((g) => g.role === "finance")) return ROUTE_SCR_STATEMENTS;
  if (user.companyGrants.some((g) => g.role === "viewer")) return ROUTE_SCR_COMPANY_DETAIL;
  return ROUTE_SCR_MY_REQUESTS;
}
```

For viewer landing, resolve the viewer’s first permitted company and replace the route parameter.

- [ ] **Step 6: Unit-test precedence and failure cases**

Test all six roles, multiple grants, disabled account, subject conflict, unknown email, and least-privilege employee fallback.

- [ ] **Step 7: Commit**

```bash
rtk git add apps/web/src/lib/auth apps/web/src/types apps/web/src/modules .nous-feedback.jsonl
rtk git commit -m "feat(auth): enrich sessions from Ledger authorization data (US-004)"
```

## Task 11: Implement US-004 login and access-denied screens

**Files:**
- Move: `apps/web/src/app/(authenticated)/login/page.tsx` → `apps/web/src/app/login/page.tsx`
- Move: `apps/web/src/app/(authenticated)/acceso-denegado/page.tsx` → `apps/web/src/app/acceso-denegado/page.tsx`
- Create: `apps/web/src/components/auth/sign-in-button.tsx`
- Modify: `apps/web/src/lib/routes.ts`
- Modify: locale catalogs
- Test: `apps/web/src/components/auth/sign-in-button.test.tsx`
- Test: `apps/web/e2e/auth.spec.ts`

- [ ] **Step 1: Reconcile route groups**

`/login` and `/acceso-denegado` are public screens and must not inherit authenticated chrome. Move them outside `(authenticated)` without changing their URLs. Run route validation after the move.

- [ ] **Step 2: Implement redirect-based login**

The primary form action is:

```tsx
<form action={async () => {
  "use server";
  await signIn("keycloak", { redirectTo: "/auth/landing" });
}}>
  <button type="submit">{messages.auth.continueWithCorporativo}</button>
</form>
```

Do not collect passwords or OTP codes in Ledger. Keycloak renders those fields.

- [ ] **Step 3: Implement access denied**

The page calls `auth()`. Authenticated users get a role-resolved home action; unauthenticated users get the login action. Match TOON test IDs `banner_access_denied`, `actions_access_denied`, `btn_go_home`, and `btn_go_login`.

- [ ] **Step 4: Run OIDC E2E**

Verify:

- employee lands on `/solicitudes`;
- approver on `/aprobaciones`;
- finance on `/estados-de-cuenta`;
- central finance on `/cierre`;
- group admin on `/panel`;
- disabled user gets no session;
- admin candidate without configured OTP cannot complete the admin login flow;
- logout terminates both Auth.js and Keycloak sessions.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/app apps/web/src/components/auth apps/web/src/lib apps/web/e2e
rtk git commit -m "feat(auth): deliver Keycloak login and denied flows (US-004)"
```

## Task 12: Implement US-005 authorization context and company scoping

**Files:**
- Create: `packages/domain/src/identity-access/{authorization,roles}.ts`
- Create: `apps/web/src/modules/identity-access/{authorization,guards,repository}.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/web/eslint.config.mjs`
- Test: matching domain and app tests

- [ ] **Step 1: Implement explicit capabilities**

Do not use `hasMinRole`. Implement `hasCapability(context, capability, companyId?)` using the contract in §4.

- [ ] **Step 2: Resolve valid grants**

Only include grants where:

```sql
(valid_from IS NULL OR valid_from <= CURRENT_DATE)
AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
```

- [ ] **Step 3: Create scoped query helpers**

Expose helpers that require `AuthorizationContext`:

```ts
export function companyScope(
  context: AuthorizationContext,
  companyIdColumn: AnyPgColumn,
): SQL | undefined;
```

Return `undefined` only for an explicitly cross-company global capability. Never accept a tenant/company value from client input as authority.

- [ ] **Step 4: Restrict direct DB imports**

Add an ESLint `no-restricted-imports` rule preventing pages/components/actions from importing `@smp/db` directly. Permit DB imports only in `src/modules/**/repository.ts`, transaction services, health checks, and Auth.js bootstrap.

- [ ] **Step 5: Test tenant isolation**

Insert company A and B data into a real test DB. Assert each scoped role sees only its permitted company, viewer mutations are rejected, central finance receives only finance capabilities, and group admin receives admin capabilities.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/domain apps/web/src/modules/identity-access apps/web/eslint.config.mjs
rtk git commit -m "feat(authz): enforce company-scoped capabilities (US-005)"
```

## Task 13: Implement US-005 route and navigation guards

**Files:**
- Create: `apps/web/src/lib/auth/screen-access.gen.ts`
- Modify: `infra/scripts/regenerate-sidebar.py`
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/app/(authenticated)/layout.tsx`
- Delete/replace: `apps/web/src/lib/auth/roles.ts`
- Test: `apps/web/src/lib/auth/screen-access.test.ts`
- Test: `apps/web/src/components/layout/sidebar.test.tsx`

- [ ] **Step 1: Generate exact access data**

Extend the nav generator to emit every screen’s allowed roles and default route from `role_based_views`. The generated runtime data must use lower-case domain role names.

- [ ] **Step 2: Remove hierarchy authorization**

Delete the ordering that currently places `viewer` above `central_finance`. Roles are sets of capabilities, not ranks.

- [ ] **Step 3: Fail closed**

The current sidebar shows items when the session has no roles. Change it so:

- unauthenticated: no authenticated navigation;
- employee: only employee navigation;
- unknown role: no privileged navigation;
- global/group admin: only items explicitly allowed by the nav map.

- [ ] **Step 4: Guard authenticated routes server-side**

The authenticated layout calls `auth()` and resolves Ledger authorization. Redirect no-session users to `/login`; redirect forbidden screens to `/acceso-denegado`.

- [ ] **Step 5: Verify every role against the nav map**

Generate parameterized tests from JSON and assert screen/sidebar equality for public, employee, approver, company finance, central finance, group admin, and viewer.

- [ ] **Step 6: Commit**

```bash
rtk git add infra/scripts/regenerate-sidebar.py apps/web/src/lib/auth apps/web/src/components/layout apps/web/src/app
rtk git commit -m "feat(authz): align route guards with navigation registry (US-005)"
```

## Task 14: Implement US-006 next-intl and persisted locale

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/messages/es-EC.json`
- Create: `apps/web/messages/en-US.json`
- Create: `apps/web/src/lib/i18n/{config,request}.ts`
- Create: `packages/contracts/src/locale.ts`
- Create: `apps/web/src/modules/identity-access/actions/update-locale.ts`
- Create: `apps/web/src/components/layout/locale-selector.tsx`
- Remove after migration: old partial locale files
- Test: locale action and formatter tests

- [ ] **Step 1: Add next-intl**

Run:

```bash
rtk pnpm --filter smp-web add next-intl
```

- [ ] **Step 2: Create complete catalogs**

Both catalogs must have identical keys. Spanish uses the DEC-SMP-013 tú vocabulary. Include navigation, auth, audit, shell, status labels, freshness, money accessibility labels, errors, loading, and empty states.

- [ ] **Step 3: Resolve locale server-side**

Priority:

1. authenticated `UserAccount.ui_language`;
2. `SystemSetting.default_language`;
3. hard safety fallback `es`.

Do not use browser locale to override an authenticated user preference.

- [ ] **Step 4: Persist locale through an audited Server Action**

Validate:

```ts
export const updateLocaleSchema = z.object({
  locale: z.enum(["es", "en"]),
});
```

Update only the authenticated user row, write the audit record in the same transaction, and refresh the current route.

- [ ] **Step 5: Verify**

Test es/en catalog key parity, persistence, system fallback, unauthorized action rejection, and no hardcoded user strings.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/package.json pnpm-lock.yaml apps/web/messages apps/web/src/lib/i18n apps/web/src/modules apps/web/src/components packages/contracts
rtk git commit -m "feat(i18n): add persisted es-EC and en-US locales (US-006)"
```

## Task 15: Implement US-006 application shell

**Files:**
- Modify: `apps/web/src/app/(authenticated)/layout.tsx`
- Modify: `apps/web/src/components/layout/{sidebar,header,mobile-bar}.tsx`
- Create: `apps/web/src/components/layout/{app-shell,breadcrumbs}.tsx`
- Modify: `packages/ui/src/organisms/app-shell.tsx`
- Test: shell component tests and Playwright visual/accessibility checks

- [ ] **Step 1: Implement the three rail sections**

Render `OPERACIÓN`, `FINANZAS`, and `ADMINISTRACIÓN` from generated nav data. Use dark chrome tokens and one filled-orange active item.

- [ ] **Step 2: Add breadcrumbs**

Generate breadcrumb labels and dynamic parameters from the nav map. Do not hardcode redirect paths or labels.

- [ ] **Step 3: Complete responsive behavior**

Desktop uses the 248px rail. Mobile uses generated bottom-bar items and an accessible overflow menu for remaining destinations. No empty `items` array remains.

- [ ] **Step 4: Add header controls**

Render page title, active company context where applicable, authenticated display name, locale selector, and logout. Remove fixture notification count `3`.

- [ ] **Step 5: Verify design and accessibility**

Run lint plus Playwright checks for keyboard navigation, visible focus, 44px targets, active item, and both locales.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/src/app apps/web/src/components/layout packages/ui/src/organisms
rtk git commit -m "feat(shell): deliver corporativo data workspace chrome (US-006)"
```

## Task 16: Implement US-006 shared status, freshness, and money primitives

**Files:**
- Replace: `packages/ui/src/atoms/status-pill.tsx`
- Create: `packages/ui/src/atoms/freshness-label.tsx`
- Create: `packages/ui/src/atoms/money-text.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: one test file per atom

- [ ] **Step 1: Map all 12 request states**

`StatusPill` accepts the exact request-state union and maps:

```ts
const statusKind = {
  approved: "success",
  active: "success",
  pending_approval: "pending",
  provisioning: "pending",
  invited: "pending",
  flagged_inactive: "pending",
  blocked_no_seat: "attention",
  failed: "attention",
  rejected: "attention",
  submitted: "neutral",
  offboarding: "neutral",
  deprovisioned: "neutral",
} as const;
```

Labels come from the active catalog; color is never the only status signal.

- [ ] **Step 2: Implement freshness**

`FreshnessLabel` receives `syncedAt`, `now`, and `locale`. Inject `now` for deterministic tests. Mark over 48 hours as stale and render the exact timestamp.

- [ ] **Step 3: Implement money formatting**

Use `Intl.NumberFormat` with USD:

- es-EC display contract: `USD 27,10`;
- en-US display contract: `$27.10`.

Use the mono token and right alignment.

- [ ] **Step 4: Test strong properties**

Test all 12 state mappings, exact 48-hour boundary, locale formatting, negative/zero/large amounts, and deterministic output.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/ui/src/atoms packages/ui/src/index.ts
rtk git commit -m "feat(ui): add status freshness and money primitives (US-006)"
```

## Task 17: Build US-007 import contracts and dry-run engine

**Files:**
- Create: `packages/contracts/src/imports.ts`
- Create: `apps/web/src/modules/org-registry/company-import.ts`
- Create: `apps/web/src/modules/org-registry/register-backfill.ts`
- Create: `apps/web/src/modules/org-registry/actions/import-companies.ts`
- Create: `docs/imports/templates/{companies,member-backfill,capacity}.csv`
- Modify: `.gitignore`
- Test: import unit/property/integration tests

- [ ] **Step 1: Define exact CSV contracts**

Companies:

```text
code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language
```

Member backfill:

```text
vendor_org_ref,email,full_name,company_code,license_type,started_on
```

Capacity:

```text
vendor_org_ref,license_type,purchased_qty,effective_from,note
```

- [ ] **Step 2: Validate before mutation**

Parse all rows, normalize emails/codes, reject duplicate company codes/emails, reject unknown company/org/license-type references, and return a dry-run report with inserts, existing matches, and errors.

- [ ] **Step 3: Resolve contacts into the identity model**

`Company` has no approver or finance-contact columns. For each normalized contact email, resolve or create a disabled-by-default `UserAccount`, then create the corresponding active `CompanyRoleAssignment` (`approver` or `finance`). Activation and Keycloak subject linking happen only through the US-004 identity flow. Reject a contact that conflicts with a different existing identity; never copy these emails into an ad hoc JSON/company field.

- [ ] **Step 4: Keep real imports out of Git**

Ignore `data/imports/private/**`. Commit only synthetic templates. Reject files containing credential columns.

- [ ] **Step 5: Implement idempotency**

Use deterministic natural keys and one transaction. A second run of the same files must create zero new companies, requests, assignments, capacities, or credentials.

- [ ] **Step 6: Test**

Test malformed CSV, duplicate identifiers, conflicting contact identities, approver/finance grant creation, unknown references, rollback on any row error, dry-run no-write property, and repeated import idempotency.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/contracts apps/web/src/modules/org-registry docs/imports .gitignore
rtk git commit -m "feat(import): add validated company and register import engine (US-007)"
```

## Task 18: Implement US-007 secure vendor and register backfill

**Files:**
- Create: `packages/domain/src/vendor-catalog/credential-envelope.ts`
- Create: `apps/web/src/modules/vendor-catalog/credential-crypto.ts`
- Create: `apps/web/src/modules/vendor-catalog/seeding.ts`
- Modify: import services from Task 17
- Test: encryption and real-DB backfill tests

- [ ] **Step 1: Implement envelope encryption**

Add the audited cryptography dependency and its types to the server package:

```bash
rtk pnpm --filter smp-web add libsodium-wrappers
rtk pnpm --filter smp-web add -D @types/libsodium-wrappers
```

Use a versioned ciphertext envelope:

```ts
interface CredentialEnvelopeV1 {
  version: 1;
  algorithm: "xchacha20poly1305";
  wrappedDek: string;
  nonce: string;
  ciphertext: string;
}
```

Load the KEK from a Docker secret file. Tests inject a deterministic test key; production never reads a key from client input.

- [ ] **Step 2: Seed vendor catalog**

Create Anthropic once, then license types and one `VendorAccount` per inventory org. Seed active capacity rows and encrypted Admin/Analytics credentials without logging plaintext.

- [ ] **Step 3: Materialize each imported seat**

In one transaction per batch:

1. resolve/create `Person`;
2. create active system `LicenseRequest` with justification `importación inicial`;
3. create initial `RequestTransition` null → active;
4. create `LicenseAssignment` with `source_kind='import'` and `source_request_id`;
5. write AuditLog events with system actor.

- [ ] **Step 4: Reconcile counts**

Produce a signed-off report grouped by vendor org and license type:

```text
purchased | console_members | imported_assignments | delta
```

Require every delta to be zero before emitting US-007 AC3/AC4 pass events.

- [ ] **Step 5: Execute only after OQ-SMP-1**

Required operator inputs:

- final 30-company CSV;
- org inventory;
- exported member list;
- purchased capacity;
- Admin/Analytics keys delivered through the secret channel.

If absent, emit one `blocked` event for US-007 naming OQ-SMP-1. Do not substitute demo data and do not mark done.

- [ ] **Step 6: Commit code and sanitized evidence**

```bash
rtk git add packages/domain apps/web/src/modules docs/imports .nous-feedback.jsonl
rtk git commit -m "feat(import): secure Anthropic go-live backfill (US-007)"
```

Never add private CSVs, keys, ciphertext fixtures derived from real keys, or unredacted reports.

## Task 19: Implement US-008 transaction-bound audit port

**Files:**
- Create: `packages/domain/src/audit/{port,types}.ts`
- Create: `apps/web/src/modules/audit/with-audit.ts`
- Modify: every Sprint 1 Server Action
- Create: `scripts/check-audited-actions.mjs`
- Test: `apps/web/src/modules/audit/with-audit.integration.test.ts`

- [ ] **Step 1: Implement `withAudit`**

The function opens one Drizzle transaction, passes the transaction to the mutation, inserts `AuditLog`, and returns the mutation value. If either write fails, both roll back.

- [ ] **Step 2: Redact secrets**

Before/after serialization must replace fields named `password`, `secret`, `token`, `encryptedSecret`, `rawRequest.authorization`, and `rawResponse.authorization` with `[REDACTED]`.

- [ ] **Step 3: Adopt the wrapper**

Wrap locale updates, subject linking, role/group sync, company import, vendor seeding, register backfill, and any other Sprint 1 mutation.

- [ ] **Step 4: Add structural enforcement**

`check-audited-actions.mjs` scans exported `"use server"` functions and fails if a mutation is neither wrapped in `withAudit` nor annotated as a read-only action.

- [ ] **Step 5: Test atomicity**

Force audit insert failure and assert the domain mutation rolled back. Force domain failure and assert no audit row exists. Test system actor null and company scope hint.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/domain/src/audit apps/web/src/modules scripts/check-audited-actions.mjs package.json
rtk git commit -m "feat(audit): make mutation evidence transaction-bound (US-008)"
```

## Task 20: Implement US-008 audit viewer

**Files:**
- Modify: `apps/web/src/app/(authenticated)/auditoria/page.tsx`
- Create: `apps/web/src/modules/audit/{queries,types}.ts`
- Create: `apps/web/src/components/audit/{audit-filters,audit-table,audit-diff-dialog}.tsx`
- Implement: `packages/ui/src/organisms/{audit-trail-viewer,data-table}.tsx`
- Test: component, query, and Playwright tests

- [ ] **Step 1: Implement a scoped cursor query**

Join actor email and company name/code. Filter entity type, action, actor, start/end dates. Sort `(occurred_at DESC, id DESC)` and fetch 51 rows for a 50-row page.

- [ ] **Step 2: Enforce group-admin access**

Call `auth()` and `requireCapability(context, "audit:read")` before querying. A wrong role is redirected to access denied and cannot retrieve data through a route handler.

- [ ] **Step 3: Match the TOON**

Render test IDs:

```text
audit_filters
table_audit
modal_audit_diff
banner_append_only
btn_close_audit_diff
```

Include note, before, after, actor, timestamp, entity link, and company scope hint. System actors render `— sistema`.

- [ ] **Step 4: Implement safe diff rendering**

Render structured JSON values; never inject HTML. Added/removed values include `+`/`−` markers as well as semantic color.

- [ ] **Step 5: Test states**

Verify loading, empty, database error, populated, filter, pagination, null actor/company, note visible, dialog keyboard trap, and wrong-role denial.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/src/app/'(authenticated)'/auditoria apps/web/src/components/audit apps/web/src/modules/audit packages/ui
rtk git commit -m "feat(audit): deliver immutable audit viewer (US-008)"
```

## Task 21: Scaffold US-046 pg-boss worker

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/tsconfig.json`
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/{logger,schedules}.ts`
- Create: `apps/worker/src/jobs/*.ts`
- Modify: `pnpm-lock.yaml`
- Modify: `turbo.json`
- Test: worker unit/integration tests

- [ ] **Step 1: Add pg-boss**

Run:

```bash
rtk pnpm --filter @smp/worker add pg-boss
```

Pin the installed major and verify its Node/PostgreSQL requirements against the Compose images.

- [ ] **Step 2: Define queue names**

```ts
export const QUEUES = {
  analyticsSync: "analytics-sync",
  memberSync: "member-sync",
  invitePoll: "invite-poll",
  alertEvaluation: "alert-evaluation",
  closePrecheck: "close-precheck",
} as const;
```

- [ ] **Step 3: Start and stop safely**

Start pg-boss, create queues, register workers, reconcile schedules, then report ready. Handle SIGTERM/SIGINT by stopping intake and awaiting graceful `boss.stop()` with a bounded timeout.

- [ ] **Step 4: Emit structured logs**

Every run logs `jobName`, `jobId`, `attempt`, `startedAt`, `finishedAt`, `durationMs`, `status`, `processed`, and redacted error code.

- [ ] **Step 5: Test**

Use real PostgreSQL. Verify worker startup, queue creation, graceful stop, retry, and no duplicate execution for the same singleton key.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/worker package.json pnpm-lock.yaml turbo.json
rtk git commit -m "feat(worker): add pg-boss runtime (US-046)"
```

## Task 22: Implement US-046 schedules, idempotency, and failure alerts

**Files:**
- Modify: `apps/worker/src/schedules.ts`
- Implement: `apps/worker/src/jobs/*.ts`
- Create: `packages/domain/src/jobs/{job-result,schedule}.ts`
- Create: `apps/worker/src/alerts/report-job-failure.ts`
- Test: schedule and failure-path tests

- [ ] **Step 1: Register schedules**

Use UTC cron expressions and document America/Guayaquil equivalents:

```ts
export const SCHEDULES = {
  analyticsSync: "15 10 * * *",
  memberSync: "5 * * * *",
  invitePoll: "*/15 * * * *",
  alertEvaluation: "7,22,37,52 * * * *",
  closePrecheck: "30 10 * * 1-5",
} as const;
```

The close precheck runs on weekdays and calls a pure `isThirdBusinessDay` policy with configured Ecuador holidays.

- [ ] **Step 2: Use deterministic idempotency keys**

Examples:

```text
analytics-sync:<vendorAccountId>:<yyyy-mm-dd>
member-sync:<vendorAccountId>:<yyyy-mm-ddThh>
invite-poll:<vendorAccountId>:<15-minute-bucket>
alert-evaluation:<15-minute-bucket>
close-precheck:<yyyy-mm>
```

- [ ] **Step 3: Make later-sprint dependencies explicit**

Until US-018/026/042/034 handlers exist, their ports return `status: "skipped", reason: "dependency_not_delivered"`. This is visible in logs and is not counted as successful work.

- [ ] **Step 4: Implement the available failure path**

Credential/auth failures emit `credential_failure`; stale or missed sync watchdogs emit `sync_stale`. Insert an `AlertEvent` only through a seeded matching `AlertRule`; deduplicate by subject and time bucket.

- [ ] **Step 5: Test reruns**

Run every handler twice with the same idempotency key and assert no duplicate domain writes/alerts. Force credential and timeout failures and assert the correct alert path and retry state.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/worker packages/domain/src/jobs .nous-feedback.jsonl
rtk git commit -m "feat(worker): schedule idempotent operational jobs (US-046)"
```

## Task 23: Build the US-054 safe Anthropic probe harness

**Files:**
- Create: `scripts/probes/anthropic/probe.ts`
- Create: `scripts/probes/anthropic/schemas.ts`
- Create: `scripts/probes/anthropic/redact.ts`
- Create: `scripts/probes/anthropic/README.md`
- Create: `scripts/probes/anthropic/probe.test.ts`
- Create: `docs/spikes/US-054-anthropic-api-probe.md`
- Modify: `.gitignore`

- [ ] **Step 1: Define per-org secret input**

Read a gitignored manifest whose values are environment-variable names:

```json
{
  "organizations": [
    {
      "ref": "central",
      "adminKeyEnv": "ANTHROPIC_CENTRAL_ADMIN_KEY",
      "analyticsKeyEnv": "ANTHROPIC_CENTRAL_ANALYTICS_KEY"
    }
  ]
}
```

- [ ] **Step 2: Probe non-mutating endpoints first**

Capture status, response headers, pagination shape, schema validation result, and redacted field names for:

- current organization/member list;
- invite list;
- Enterprise activity summary;
- Enterprise cost/usage report where the plan supports it.

Admin and Analytics keys are distinct and never interchangeable.

- [ ] **Step 3: Gate the invite canary**

There is no assumed dry-run endpoint. Only create and then delete a canary invite when all are true:

```text
PROBE_ALLOW_INVITE_MUTATION=true
PROBE_CANARY_EMAIL is operator-approved
operator confirms target VendorAccount immediately before execution
```

If any condition is false, report `invite_canary: not_executed` and keep US-054 AC1 blocked.

- [ ] **Step 4: Redact artifacts**

Remove keys, authorization headers, full emails, names, IDs, and raw bodies. Persist schema keys, types, rate-limit headers, beta-header behavior, status codes, and salted stable hashes needed for comparison.

- [ ] **Step 5: Contract-test the probe**

Use recorded synthetic fixtures derived from public API schemas, not real payloads. Verify pagination, error classification, redaction, cents-as-decimal handling, and key-type mismatch errors.

- [ ] **Step 6: Execute after operator authorization**

Run once per inventory org. Compare findings to US-018 and US-026. File each delta as a separate scope note before Sprint 3 planning.

- [ ] **Step 7: Commit only sanitized results**

```bash
rtk git add scripts/probes docs/spikes .gitignore .nous-feedback.jsonl
rtk git commit -m "spike(anthropic): capture provider contract evidence (US-054)"
```

## Task 24: Sprint-wide adversarial acceptance and closure

**Files:**
- Modify: `.nous-feedback.jsonl`
- Create: `docs/sprints/sprint-1-acceptance.md`
- Update: `testing/critical-paths.md` if critical logic changed

- [ ] **Step 1: Run the complete gate**

```bash
rtk pnpm type-check
rtk pnpm lint
rtk pnpm lint:tests
rtk pnpm test
rtk pnpm build
rtk pnpm test:mutation
rtk pnpm validate:routes
rtk pnpm validate:sidebar
rtk docker compose -f infra/docker-compose.yml up -d --build
rtk pnpm --filter @smp/db db:migrate
rtk pnpm --filter @smp/db db:verify
rtk pnpm --filter @smp/db db:parity
```

- [ ] **Step 2: Adversarially verify every AC**

Use exact negative cases:

- US-001: delete node_modules and prove frozen install + build.
- US-002: stop Postgres and prove app/worker health fails.
- US-003: attempt overlap, gap, illegal update, and delete as `ledger_app`.
- US-004: wrong/disabled/no-TOTP identities cannot obtain privileged sessions.
- US-005: company A user cannot read/write company B; viewer cannot mutate.
- US-006: switch locale, reload, and verify persistence/fallback.
- US-007: duplicate import is idempotent and reconciled deltas are zero.
- US-008: audit mutation/delete fails; wrong role cannot view audit.
- US-046: rerun same job key; force failure; verify alert and logs.
- US-054: verify redaction and explicit mutation authorization.

- [ ] **Step 3: Record honest external blockers**

If inventory or keys are unavailable, write separate `blocked` events for US-007 and US-054. Do not use `done_with_deferral` for an unmet mandatory AC.

- [ ] **Step 4: Record build evidence**

Append `build_pass` and `done` only for stories whose ACs all passed and were adversarially verified.

- [ ] **Step 5: Produce the acceptance report**

The report lists:

- commit per story;
- AC → evidence command/test;
- migration filenames/checksums;
- mutation score on critical-path changes;
- Compose service health;
- unresolved operator gates;
- deviations/decisions filed.

- [ ] **Step 6: Final commit**

```bash
rtk git add .nous-feedback.jsonl docs/sprints testing/critical-paths.md
rtk git commit -m "docs(sprint): record Sprint 1 acceptance evidence (US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-046, US-054)"
```

---

## 5. Story-to-task coverage

| Story | Acceptance criteria covered by |
|---|---|
| US-001 | Tasks 2–3 |
| US-002 | Tasks 4–6 |
| US-003 | Tasks 7–8 |
| US-004 | Tasks 9–11 |
| US-005 | Tasks 12–13 |
| US-006 | Tasks 14–16 |
| US-007 | Tasks 17–18 |
| US-008 | Tasks 19–20 |
| US-046 | Tasks 21–22 |
| US-054 | Task 23 |
| All | Task 24 |

## 6. Commit sequence

1. `docs(architecture): reconcile Sprint 1 execution contract (CHG-001)`
2. `build(repo): establish reproducible monorepo baseline (US-001)`
3. `feat(ui): establish corporativo token baseline (US-001)`
4. `feat(infra): add self-hosted Compose runtime (US-002)`
5. `ci(database): verify committed migrations on Postgres (US-002)`
6. `feat(ops): add encrypted backup and restore drill (US-002)`
7. `feat(database): enforce register and append-only integrity (US-003)`
8. `feat(auth): configure Keycloak identity and TOTP policy (US-004)`
9. `feat(auth): enrich sessions from Ledger authorization data (US-004)`
10. `feat(auth): deliver Keycloak login and denied flows (US-004)`
11. `feat(authz): enforce company-scoped capabilities (US-005)`
12. `feat(authz): align route guards with navigation registry (US-005)`
13. `feat(i18n): add persisted es-EC and en-US locales (US-006)`
14. `feat(shell): deliver corporativo data workspace chrome (US-006)`
15. `feat(ui): add status freshness and money primitives (US-006)`
16. `feat(import): add validated company and register import engine (US-007)`
17. `feat(import): secure Anthropic go-live backfill (US-007)`
18. `feat(audit): make mutation evidence transaction-bound (US-008)`
19. `feat(audit): deliver immutable audit viewer (US-008)`
20. `feat(worker): add pg-boss runtime (US-046)`
21. `feat(worker): schedule idempotent operational jobs (US-046)`
22. `spike(anthropic): capture provider contract evidence (US-054)`
23. `docs(sprint): record Sprint 1 acceptance evidence (...)`

## 7. Execution guardrails

- Never modify `V20251002145723__init_schema.sql`.
- Never authorize by Keycloak realm role other than the technical TOTP group/role.
- Never use client-provided company IDs as authorization.
- Never run a data mutation and audit insertion in separate transactions.
- Never test grants as the database owner.
- Never use PGlite for PostgreSQL role/grant/extension acceptance; use real PostgreSQL.
- Never call real Anthropic endpoints from CI.
- Never send an invite probe without the explicit mutation flag and operator-approved canary.
- Never commit private company/member files, API keys, KEKs, age identities, access tokens, raw provider payloads, or unredacted email addresses.
- Never mark a story done because its scaffold exists; verify each AC against observable behavior.

## 8. Definition of Sprint 1 complete

Sprint 1 is complete only when:

1. All eight non-external stories pass their ACs, full build, tests, mutation gate, schema migration/parity checks, and adversarial verification.
2. US-007 has real inventory input, zero reconciliation deltas, and no secret leakage.
3. US-054 has real per-org probe evidence, including an explicitly authorized invite create/delete canary or a product-owner-approved AC amendment.
4. Compose boots the app, worker, PostgreSQL, Keycloak, and SMTP relay with healthy status.
5. Authorization uses Ledger DB roles and company grants; all isolation negatives pass.
6. Every Sprint 1 mutation is transactionally audited.
7. `.nous-feedback.jsonl` contains one evidence-backed lifecycle stream per story.

## 9. External implementation references

Use primary documentation when implementing the provider and worker seams:

- [Anthropic Admin API overview](https://platform.claude.com/docs/en/manage-claude/admin-api)
- [Anthropic organization invites API](https://platform.claude.com/docs/en/api/admin/invites)
- [Anthropic Enterprise Analytics API](https://platform.claude.com/docs/en/manage-claude/analytics-api)
- [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [pg-boss repository and compatibility guidance](https://github.com/timgit/pg-boss)

Re-check these references at execution time before pinning request schemas, pagination behavior, rate limits, beta headers, Node requirements, or PostgreSQL requirements.
