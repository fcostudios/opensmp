# US-007 Six-Company Go-Live Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the resynced US-007 import inventory-size agnostic, provide the approved six-company/two-Teams-organization synthetic fixture, and load it through the audited production boundary into the existing local Docker Postgres.

**Architecture:** Keep `register-backfill-transaction.ts` as the single business boundary and remove only its stale fixed 30-row rule. Add committed non-secret CSV/manifest fixtures plus one local operator CLI that initializes ignored synthetic secrets, previews, applies, and verifies the import without direct SQL writes or additional Docker projects.

**Tech Stack:** TypeScript, Node.js 22, `tsx`, Next.js application modules, Drizzle ORM, PostgreSQL, Vitest/Testcontainers, Stryker, pnpm, Docker Compose.

---

## File Map

### Existing files to modify

- `apps/web/src/modules/org-registry/register-backfill-transaction.ts`
  - Remove the stale exact-30-company validation.
- `apps/web/src/modules/org-registry/register-backfill.integration.test.ts`
  - Replace the exact-30 assumption with the five-company DEC-SMP-018 baseline
    and an acceptance property spanning 5, 6, and 30 companies.
- `docs/imports/README.md`
  - Correct the inventory-size documentation and document the synthetic
    operator workflow.
- `apps/web/package.json`
  - Add the `import:go-live` command and direct `tsx` development dependency.
- `pnpm-lock.yaml`
  - Record the `tsx` dependency through `pnpm install`.
- `.gitignore`
  - Retain `data/imports/private/**` as the only location for generated
    credentials and KEKs; no broad ignore is added.

### New committed files

- `data/imports/fixtures/us007/companies.csv`
  - Six Ledger companies and unique contact identities.
- `data/imports/fixtures/us007/member-backfill.csv`
  - Twelve synthetic seat holders with exact company/vendor-account mapping.
- `data/imports/fixtures/us007/capacity.csv`
  - The 15-seat Corporativo pool and 3-seat CentroHub pool.
- `data/imports/fixtures/us007/credential-manifest.json`
  - Environment-variable names for four credentials; no values.
- `apps/web/scripts/go-live-import.ts`
  - `init`, `preview`, `apply`, and `verify` operator modes.
- `docs/runbooks/US-007_LOCAL_FIXTURE.md`
  - Exact safe commands and expected evidence for local verification.

### New ignored local files created at execution time

- `data/imports/private/us007.runtime.env`
  - Four randomly generated, explicitly synthetic credential values.
- `data/imports/private/us007.integration-credential.kek`
  - Base64-encoded random 32-byte KEK, mode `0600`.

## Safety and Test Constraints

- Every shell invocation starts with `rtk`.
- No database reset, volume removal, Compose project recreation, or direct
  domain-table SQL mutation is permitted.
- Run the focused Testcontainers integration file once at a time.
- Keep `TESTCONTAINERS_RYUK_DISABLED=true` and Stryker `concurrency=1`.
- Before a mutation run, inspect active Docker containers. Do not launch a
  second mutation process while one is running.
- Tests use exact behavioral assertions and real PostgreSQL. They do not mock
  owned code or use logs as an oracle.
- All user/company paths assert `company_id` attribution.
- Never print, stage, or diff the generated runtime environment or KEK.

### Task 1: Replace the stale 30-company rule with the resynced baseline contract

**Files:**

- Modify: `apps/web/src/modules/org-registry/register-backfill.integration.test.ts`
- Modify: `apps/web/src/modules/org-registry/register-backfill-transaction.ts`

- [ ] **Step 1: Change the integration fixture baseline to five companies**

Replace the fixed array declaration at the top of
`register-backfill.integration.test.ts`:

```ts
const baselineCompanyCount = 5;
const companyRows = Array.from({ length: baselineCompanyCount }, (_, index) => {
  const ordinal = index + 1;
  const code = index === 0 ? "ACME" : `C${String(ordinal).padStart(3, "0")}`;
  return [
    code,
    index === 0 ? "Acme Holdings" : `Synthetic Company ${ordinal}`,
    "internal",
    `approver${ordinal}@example.invalid`,
    `finance${ordinal}@example.invalid`,
    index === 0 ? "1500.00" : "1000.00",
    index % 2 === 0 ? "es" : "en",
  ].join(",");
});

function companiesCsvFor(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    const code = index === 0 ? "ACME" : `C${String(ordinal).padStart(3, "0")}`;
    return [
      code,
      index === 0 ? "Acme Holdings" : `Synthetic Company ${ordinal}`,
      "internal",
      `approver${ordinal}@example.invalid`,
      `finance${ordinal}@example.invalid`,
      index === 0 ? "1500.00" : "1000.00",
      index % 2 === 0 ? "es" : "en",
    ].join(",");
  });
  return [
    "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
    ...rows,
  ].join("\n");
}

const companiesCsv = companiesCsvFor(baselineCompanyCount);
```

Update exact baseline expectations:

```ts
inserts: {
  companies: 5,
  contactAccounts: 10,
  roleAssignments: 10,
  vendorAccounts: 1,
  licenseTypes: 1,
  capacities: 1,
  people: 2,
  requests: 2,
  assignments: 2,
  credentials: 2,
}
```

```ts
expect(await database.select().from(userAccount)).toHaveLength(11);
expect((await database.select().from(companyRoleAssignment))).toHaveLength(10);
```

```ts
existing: {
  companies: 5,
  contactAccounts: 10,
  roleAssignments: 10,
  vendorAccounts: 1,
  licenseTypes: 1,
  capacities: 1,
  people: 2,
  requests: 2,
  assignments: 2,
  credentials: 0,
}
```

- [ ] **Step 2: Replace the obsolete rejection test with the inventory-size property**

Replace:

```ts
it("rejects any go-live inventory that does not contain exactly 30 companies", ...)
```

with:

```ts
it.each([5, 6, 30])(
  "accepts a valid %i-company inventory through the same path",
  async (companyCount) => {
    const report = await dryRunGoLiveImport(database, {
      companiesCsv: companiesCsvFor(companyCount),
      membersCsv,
      capacityCsv,
    });

    expect(report.errors).toEqual([]);
    expect(report.inserts.companies).toBe(companyCount);
    expect(report.inserts.contactAccounts).toBe(companyCount * 2);
    expect(report.inserts.roleAssignments).toBe(companyCount * 2);
    expect(await database.select().from(company)).toHaveLength(0);
  },
);
```

This replaces the former count test rather than adding coverage-only volume.
The oracle asserts the decision change, read-only behavior, and derived contact
and grant counts.

- [ ] **Step 3: Run the focused integration test to prove the old code fails**

Run:

```bash
rtk pnpm --dir apps/web exec vitest run \
  --config vitest.us007.config.ts \
  src/modules/org-registry/register-backfill.integration.test.ts
```

Expected: FAIL for the 5- and 6-company cases with
`Go-live company inventory must contain exactly 30 companies`.

- [ ] **Step 4: Remove the fixed-cardinality validation**

Delete only this block from `dryRunGoLiveImport`:

```ts
if (parsed.companies.length !== 30) {
  errors.push(
    `Go-live company inventory must contain exactly 30 companies; received ${parsed.companies.length}`,
  );
}
```

Do not add another row-count limit. Empty and malformed CSVs remain rejected by
the existing parser/reference contracts.

- [ ] **Step 5: Run the focused integration test once**

Run the same Vitest command from Step 3.

Expected: PASS with one Testcontainers PostgreSQL instance and no surviving
test container after Vitest exits.

- [ ] **Step 6: Commit the cardinality correction**

```bash
rtk git add \
  apps/web/src/modules/org-registry/register-backfill-transaction.ts \
  apps/web/src/modules/org-registry/register-backfill.integration.test.ts
rtk git commit -m "fix(US-007): accept resynced company inventories"
```

### Task 2: Add the approved six-company fixture and correct the import guide

**Files:**

- Create: `data/imports/fixtures/us007/companies.csv`
- Create: `data/imports/fixtures/us007/member-backfill.csv`
- Create: `data/imports/fixtures/us007/capacity.csv`
- Create: `data/imports/fixtures/us007/credential-manifest.json`
- Modify: `docs/imports/README.md`

- [ ] **Step 1: Create the exact company fixture**

Create `companies.csv` with:

```csv
code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language
CORP,Corporativo,internal,approver.corp@ledger.invalid,finance.corp@ledger.invalid,2500.00,es
PPM,PPM,internal,approver.ppm@ledger.invalid,finance.ppm@ledger.invalid,1500.00,es
FOCUS,Focus,internal,approver.focus@ledger.invalid,finance.focus@ledger.invalid,1500.00,es
MULLEN,Mullen Lowe,internal,approver.mullen@ledger.invalid,finance.mullen@ledger.invalid,1500.00,es
RAM,RAM,internal,approver.ram@ledger.invalid,finance.ram@ledger.invalid,1000.00,es
CENTROHUB,CentroHub,internal,approver.centrohub@ledger.invalid,finance.centrohub@ledger.invalid,1000.00,es
```

- [ ] **Step 2: Create the exact member fixture**

Create `member-backfill.csv` with:

```csv
vendor_org_ref,email,full_name,company_code,license_type,started_on
corporativo-teams,ana.corp@ledger.invalid,Ana Corporativo,CORP,Teams,2026-07-01
corporativo-teams,bruno.corp@ledger.invalid,Bruno Corporativo,CORP,Teams,2026-07-01
corporativo-teams,ana.ppm@ledger.invalid,Ana PPM,PPM,Teams,2026-07-01
corporativo-teams,bruno.ppm@ledger.invalid,Bruno PPM,PPM,Teams,2026-07-01
corporativo-teams,ana.focus@ledger.invalid,Ana Focus,FOCUS,Teams,2026-07-01
corporativo-teams,bruno.focus@ledger.invalid,Bruno Focus,FOCUS,Teams,2026-07-01
corporativo-teams,ana.mullen@ledger.invalid,Ana Mullen,MULLEN,Teams,2026-07-01
corporativo-teams,bruno.mullen@ledger.invalid,Bruno Mullen,MULLEN,Teams,2026-07-01
corporativo-teams,ana.ram@ledger.invalid,Ana RAM,RAM,Teams,2026-07-01
corporativo-teams,bruno.ram@ledger.invalid,Bruno RAM,RAM,Teams,2026-07-01
centrohub-teams,ana.centrohub@ledger.invalid,Ana CentroHub,CENTROHUB,Teams,2026-07-01
centrohub-teams,bruno.centrohub@ledger.invalid,Bruno CentroHub,CENTROHUB,Teams,2026-07-01
```

- [ ] **Step 3: Create the exact capacity and credential-name fixtures**

Create `capacity.csv`:

```csv
vendor_org_ref,license_type,purchased_qty,effective_from,note
corporativo-teams,Teams,15,2026-07-01,Synthetic shared Teams pool with five spare seats
centrohub-teams,Teams,3,2026-07-01,Synthetic CentroHub Teams pool with one spare seat
```

Create `credential-manifest.json`:

```json
{
  "version": 1,
  "organizations": [
    {
      "vendor_org_ref": "corporativo-teams",
      "admin_env": "ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY",
      "analytics_env": "ANTHROPIC_CORPORATIVO_TEAMS_ANALYTICS_KEY"
    },
    {
      "vendor_org_ref": "centrohub-teams",
      "admin_env": "ANTHROPIC_CENTROHUB_TEAMS_ADMIN_KEY",
      "analytics_env": "ANTHROPIC_CENTROHUB_TEAMS_ANALYTICS_KEY"
    }
  ]
}
```

- [ ] **Step 4: Validate the fixtures through the production parsers**

Run:

```bash
rtk pnpm --dir apps/web exec tsx --version
```

At this point the expected result is failure because `tsx` is not yet a direct
dependency. Do not use a globally installed or transient executable; Task 3
adds and locks it.

Perform the parser validation after Task 3 with `import:go-live preview`.

- [ ] **Step 5: Correct the inventory-size language in the import guide**

Replace:

```md
The companies file must contain exactly 30 rows.
```

with:

```md
The committed MVP fixture baseline contains five companies per DEC-SMP-018.
The importer accepts the operator's complete validated inventory through the
same path, including the approved six-company local fixture and the 30-company
rollout target; company count is not a parser invariant.
```

Add a “Local synthetic fixture” section linking
`docs/runbooks/US-007_LOCAL_FIXTURE.md` and state that synthetic Teams
credentials are nonfunctional placeholders used only to exercise encrypted
storage until US-055 supplies API-less ingestion.

- [ ] **Step 6: Confirm no secret-like values are committed**

Run:

```bash
rtk rg -n \
  'synthetic-local-|PRIVATE KEY|BEGIN [A-Z ]+ KEY|=[A-Za-z0-9_-]{24,}' \
  data/imports/fixtures docs/imports
```

Expected: no credential values; only public fixture content and environment
variable names.

- [ ] **Step 7: Commit the fixture and guide correction**

```bash
rtk git add data/imports/fixtures/us007 docs/imports/README.md
rtk git commit -m "feat(US-007): add six-company synthetic inventory"
```

### Task 3: Add the safe operator command

**Files:**

- Create: `apps/web/scripts/go-live-import.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/runbooks/US-007_LOCAL_FIXTURE.md`

- [ ] **Step 1: Add and lock the direct TypeScript runner**

Run:

```bash
rtk pnpm --filter smp-web add --save-dev tsx@4.23.1
```

Expected: `apps/web/package.json` contains `"tsx": "^4.23.1"` and
`pnpm-lock.yaml` changes without unrelated dependency upgrades.

- [ ] **Step 2: Add the package command**

Add to `apps/web/package.json` scripts:

```json
"import:go-live": "tsx scripts/go-live-import.ts"
```

- [ ] **Step 3: Implement explicit modes and paths**

Create `apps/web/scripts/go-live-import.ts` with these constants and argument
contract:

```ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@smp/db";
import {
  auditLog,
  company,
  companyRoleAssignment,
  integrationCredential,
  licenseAssignment,
  licenseRequest,
  licenseType,
  person,
  userAccount,
  vendor,
  vendorAccount,
  vendorAccountCapacity,
} from "@smp/db/schema";

import {
  auditedGoLiveImportBoundary,
  dryRunGoLiveImport,
  prepareProductionGoLiveImport,
  productionImportDatabase,
} from "../src/modules/org-registry/register-backfill-transaction";

type Mode = "init" | "preview" | "apply" | "verify";

const appRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(appRoot, "../..");
const fixtureRoot = resolve(repositoryRoot, "data/imports/fixtures/us007");
const privateRoot = resolve(repositoryRoot, "data/imports/private");
const runtimeEnvironmentPath = resolve(privateRoot, "us007.runtime.env");
const kekPath = resolve(
  privateRoot,
  "us007.integration-credential.kek",
);
const manifestPath = resolve(fixtureRoot, "credential-manifest.json");
const actorId = "70070000-0000-4000-8000-000000000007";
const actorEmail = "us007.group-admin@ledger.invalid";

function modeFrom(argv: readonly string[]): Mode {
  const mode = argv[2];
  if (
    mode !== "init" &&
    mode !== "preview" &&
    mode !== "apply" &&
    mode !== "verify"
  ) {
    throw new Error(
      "Usage: pnpm --filter smp-web import:go-live <init|preview|apply|verify>",
    );
  }
  return mode;
}
```

Define these functions with the mode-specific contract immediately below:

```ts
async function initializePrivateMaterial(): Promise<void>
async function loadInput(): Promise<{
  companiesCsv: string;
  membersCsv: string;
  capacityCsv: string;
}>
async function ensureSyntheticActor(): Promise<void>
async function preview(): Promise<void>
async function apply(): Promise<void>
async function verify(): Promise<void>
async function main(): Promise<void>
```

Required behavior:

- `init`
  - creates `data/imports/private` with mode `0700`;
  - refuses to overwrite either private file by using `flag: "wx"`;
  - writes four distinct `synthetic-local-<random base64url>` values to the
    runtime env file with mode `0600`;
  - writes `randomBytes(32).toString("base64")` plus a newline to the KEK file
    with mode `0600`;
  - writes `LEDGER_CREDENTIAL_MANIFEST_FILE` and
    `LEDGER_CREDENTIAL_KEK_FILE` as absolute paths;
  - prints file paths but never secret values.
- `preview`
  - loads repository `.env` first and the private runtime env second with
    `override: true`;
  - reads the three fixture CSVs;
  - invokes `prepareProductionGoLiveImport`, then `dryRunGoLiveImport`;
  - uses `actorId` as non-mutating preview metadata;
  - prints only `inserts`, `existing`, and `errors`;
  - sets a nonzero exit code if `errors` is nonempty.
- `apply`
  - performs the same preparation and dry-run;
  - stops before mutation on any preview error;
  - inserts the deterministic actor only if absent;
  - rejects an existing actor ID/email unless it is active `group_admin`;
  - calls `auditedGoLiveImportBoundary.run`;
  - prints only created counts and reconciliation.
- `verify`
  - uses Drizzle reads only;
  - asserts exact company codes and names;
  - asserts 2 Anthropic vendor accounts and their org refs;
  - asserts 1 Anthropic `Teams` license type;
  - asserts 12 imported assignments and 12 matching active requests;
  - groups assignment rows by `company.code` and asserts 2 per company;
  - joins assignments to vendor accounts and asserts CORP/PPM/FOCUS/MULLEN/RAM
    map to `corporativo-teams` and CENTROHUB maps to `centrohub-teams`;
  - asserts capacity quantities 15 and 3;
  - asserts 4 active credentials, no plaintext `synthetic-local-` substring in
    `encrypted_secret`, and two credential kinds per vendor account;
  - asserts 12 company-role assignments and at least 13 US-007 audit entries
    (12 imported assignments plus completion);
  - prints a sanitized JSON verification summary.

End the file with:

```ts
main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown go-live import failure"}\n`,
  );
  process.exitCode = 1;
});
```

Do not print error causes, environments, input objects, or credential rows.

- [ ] **Step 4: Type-check the operator command**

Run:

```bash
rtk pnpm --filter smp-web type-check
```

Expected: PASS. Fix type errors without weakening types or using `any`.

- [ ] **Step 5: Write the exact operator runbook**

Create `docs/runbooks/US-007_LOCAL_FIXTURE.md` containing:

```md
# US-007 local synthetic fixture

Prerequisites:

- the persistent `ledger-dev` Docker Compose stack is healthy;
- root `.env` points `DATABASE_URL` to local port `15432`;
- migrations and `verify-schema.mjs` pass.

Commands:

    rtk pnpm --filter smp-web import:go-live init
    rtk pnpm --filter smp-web import:go-live preview
    rtk pnpm --filter smp-web import:go-live apply
    rtk pnpm --filter smp-web import:go-live verify
    rtk pnpm --filter smp-web import:go-live apply
    rtk pnpm --filter smp-web import:go-live verify

The first apply creates the fixture. The second apply must report zero created
rows and proves idempotency. Never commit `data/imports/private`.
```

Also document the expected 6/2/1/12/12/2/4 entity counts and both zero-delta
reconciliation lines.

- [ ] **Step 6: Verify ignored private paths before generating anything**

Run:

```bash
rtk git check-ignore -v \
  data/imports/private/us007.runtime.env \
  data/imports/private/us007.integration-credential.kek
```

Expected: both paths match `data/imports/private/**`.

- [ ] **Step 7: Commit the operator command**

```bash
rtk git add \
  apps/web/package.json \
  apps/web/scripts/go-live-import.ts \
  pnpm-lock.yaml \
  docs/runbooks/US-007_LOCAL_FIXTURE.md
rtk git commit -m "feat(US-007): add audited local import command"
```

### Task 4: Run bounded automated verification

**Files:**

- Verify only; modify production/test files only to correct evidenced failures.

- [ ] **Step 1: Inspect the Docker process baseline**

Run:

```bash
rtk docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Expected: only the persistent Ledger services plus unrelated user-owned
containers. Record the baseline count; do not stop unrelated containers.

- [ ] **Step 2: Run the focused US-007 integration suite once**

```bash
rtk pnpm --dir apps/web exec vitest run \
  --config vitest.us007.config.ts \
  src/modules/org-registry/register-backfill.integration.test.ts
```

Expected: PASS. Then inspect `docker ps` again and confirm no orphaned
Testcontainers database.

- [ ] **Step 3: Run the focused mutation gate once**

```bash
rtk pnpm test:mutation:us007
```

Expected: mutation score at least 80%, with Stryker concurrency fixed at 1.
If Docker growth exceeds one transient PostgreSQL container, terminate the
mutation command and diagnose before retrying.

- [ ] **Step 4: Run repository quality gates sequentially**

```bash
rtk pnpm type-check
rtk pnpm lint
rtk pnpm test
rtk pnpm build
```

Expected: all PASS. Do not run these four commands concurrently because tests
and Next builds are resource intensive.

- [ ] **Step 5: Commit only if verification required a correction**

```bash
rtk git status --short
```

If and only if tracked fixes were necessary, stage each corrected file by its
literal path after reviewing `rtk git diff`, then commit with
`rtk git commit -m "fix(US-007): address verification findings"`.

### Task 5: Initialize secrets and load the persistent local database

**Files:**

- Create ignored: `data/imports/private/us007.runtime.env`
- Create ignored: `data/imports/private/us007.integration-credential.kek`
- Read/verify local Docker Postgres state.

- [ ] **Step 1: Confirm stack health without recreating services**

```bash
rtk docker compose \
  --env-file .env \
  --file infra/docker-compose.yml \
  --project-name ledger-dev \
  ps
```

Expected: Postgres, Keycloak, mail service, app, and worker are healthy. Do not
run `up`, `down`, `rm`, or volume commands unless a service is actually absent;
an unhealthy service is diagnosed before any restart.

- [ ] **Step 2: Re-verify the schema**

Run the repository’s existing schema verifier against the local
`DATABASE_URL`:

```bash
rtk pnpm --dir packages/db exec node scripts/verify-schema.mjs
```

Expected: all schema checks pass.

- [ ] **Step 3: Generate ignored synthetic private material**

```bash
rtk pnpm --filter smp-web import:go-live init
```

Expected: two mode-`0600` files are created under
`data/imports/private`; no key value is printed.

If the files already exist, `init` must fail safely rather than overwrite them.
Inspect permissions with:

```bash
rtk stat -f '%Sp %N' \
  data/imports/private/us007.runtime.env \
  data/imports/private/us007.integration-credential.kek
```

- [ ] **Step 4: Run the read-only preview**

```bash
rtk pnpm --filter smp-web import:go-live preview
```

Expected on a clean target:

```json
{
  "inserts": {
    "companies": 6,
    "contactAccounts": 12,
    "roleAssignments": 12,
    "vendorAccounts": 2,
    "licenseTypes": 1,
    "capacities": 2,
    "people": 12,
    "requests": 12,
    "assignments": 12,
    "credentials": 4
  },
  "errors": []
}
```

Existing unrelated platform rows may affect only corresponding `existing`
counts; any conflict error blocks the apply and must be diagnosed.

- [ ] **Step 5: Apply the audited import**

```bash
rtk pnpm --filter smp-web import:go-live apply
```

Expected reconciliation:

```json
[
  {
    "vendorOrgRef": "corporativo-teams",
    "licenseType": "Teams",
    "purchased": 15,
    "consoleMembers": 10,
    "importedAssignments": 10,
    "persistedCapacity": 15,
    "memberDelta": 0,
    "capacityDelta": 0
  },
  {
    "vendorOrgRef": "centrohub-teams",
    "licenseType": "Teams",
    "purchased": 3,
    "consoleMembers": 2,
    "importedAssignments": 2,
    "persistedCapacity": 3,
    "memberDelta": 0,
    "capacityDelta": 0
  }
]
```

Order is not significant; values are.

- [ ] **Step 6: Verify exact persisted state**

```bash
rtk pnpm --filter smp-web import:go-live verify
```

Expected: PASS with the exact verification contract from the design and no
credential plaintext.

- [ ] **Step 7: Prove idempotency**

```bash
rtk pnpm --filter smp-web import:go-live apply
rtk pnpm --filter smp-web import:go-live verify
```

Expected: the second apply reports every created counter as `0`; verification
still reports the same domain counts.

- [ ] **Step 8: Prove secrets are ignored and absent from history**

```bash
rtk git status --short
rtk git grep -n 'synthetic-local-' -- ':!docs/superpowers/**'
```

Expected: private files do not appear in status and no committed implementation
or fixture contains generated key values.

### Task 6: Independent review, story closure evidence, and final commit

**Files:**

- Review all changes since design commit `9622296`.
- Modify only files with evidenced findings.

- [ ] **Step 1: Run a specification-compliance review**

The reviewer checks every item in:

- `docs/superpowers/specs/2026-07-26-us-007-six-company-fixture-design.md`
- `docs/stories/sprint-1/r1_misc_us_007.md`
- `docs/dev-guide/DEFINITION_OF_DONE.md`

The review must confirm tenant attribution, two vendor organizations,
credential secrecy, audited mutation, exact reconciliation, idempotency, and
the absence of destructive Docker behavior.

- [ ] **Step 2: Run a code-quality and safety review**

The reviewer inspects the diff for:

- secret exposure through errors or JSON output;
- unsafe overwrite behavior;
- actor privilege escalation outside the explicit local seed;
- direct SQL domain writes;
- cross-vendor or cross-company query mistakes;
- unbounded container/process creation;
- changes outside US-007 scope.

- [ ] **Step 3: Address only actionable findings**

For each validated finding, reproduce it with a focused test or command, make
the smallest correction, rerun the affected focused gate, review
`rtk git diff`, stage each corrected file by its literal path, and commit with
`rtk git commit -m "fix(US-007): address review finding"`.

- [ ] **Step 4: Capture final evidence**

Run:

```bash
rtk git status --short --branch
rtk git log --oneline -8
rtk docker compose \
  --env-file .env \
  --file infra/docker-compose.yml \
  --project-name ledger-dev \
  ps
rtk pnpm --filter smp-web import:go-live verify
```

Expected: clean tracked worktree, healthy persistent stack, and successful
six-company verification.

- [ ] **Step 5: Report how the user can verify**

The handoff must include:

```bash
rtk pnpm --filter smp-web import:go-live verify
```

and the local application URL. It must explain that keys are synthetic and
Teams ingestion remains manual/CSV until US-055, so lack of live Anthropic
connectivity does not block US-007 completion.
