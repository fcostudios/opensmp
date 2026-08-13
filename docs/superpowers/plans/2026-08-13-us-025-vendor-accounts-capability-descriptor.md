# US-025 Vendor Accounts and Capability Descriptor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-ready Group Admin workspace for creating, reading, updating, retiring, and reactivating vendor accounts; expose the vendor capability descriptor and read-only R1 license types; and guarantee that unsupported provisioning operations continue through the canonical orchestration checklist.

**Architecture:** Add a vendor-catalog contract and audited command/query boundary under `apps/web/src/modules/vendor-catalog/`, keeping `Vendor` as a global seeded catalog and `VendorAccount` as global business data that can serve multiple companies. Server Components load authorization and read models; small Client Components own modal, tab, and form interaction. The existing connector action planner remains the single routing authority, but its input changes from a caller-selected boolean to the complete vendor provisioning descriptor so the planner itself selects `can_provision` or `can_deprovision` and fails closed. “Delete” is implemented as `status = inactive`, matching the ER lifecycle and the runtime prohibition on table DELETE.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, next-intl, Zod, Drizzle ORM, PostgreSQL/Testcontainers, `@smp/connectors`, Vitest/Testing Library, Playwright, Stryker, pnpm/Turborepo.

---

## Story contract and implementation decisions

**Story:** `docs/stories/sprint-3/r1_misc_us_025.md`  
**Persona:** Group Admin  
**Screens:** `SCR-vendor-accounts`, `SCR-vendor-account-detail`  
**Server actions:** `createVendorAccount`, `updateVendorAccount`  
**Dependencies:** US-005 complete; US-045 connector seam already exists; US-025 must finish before US-018.

1. **CRUD means create, read, update, and status-based retirement/reactivation.** `VendorAccount` declares `has_soft_delete: via status`, and `ledger_app` has no DELETE grant. No hard-delete action, cascade, or migration is permitted.
2. **The vendor catalog is global.** Neither `Vendor` nor `VendorAccount` has `company_id`; a vendor account may serve several companies. Authorization is therefore the global `group_admin` role, never a request-supplied company scope.
3. **R1 creation can select only active Anthropic.** The repository resolves the vendor server-side by the submitted UUID and rejects any non-Anthropic or inactive vendor. It never trusts a client label. Manual vendor registry remains FEAT-R2-01.
4. **No ingestion-mode work is pulled forward.** The generated detail screen mentions `ingestion_mode`, but the column and API-less ingestion behavior belong to DEC-SMP-018/US-055. US-025 must not add the field, render a functional selector, or imply it is stored.
5. **License types are read-only.** The detail tab reads seeded `LicenseType` rows and current `RateCard` data. It contains no create/edit/delete controls; those stay deferred with FEAT-R2-01.
6. **Capability display and execution use the same facts.** The UI reads `Vendor.can_provision`, `can_deprovision`, `has_usage_data`, `has_cost_data`, `provisioning_protocol`, and `identity_matching`. Provision/deprovision routing passes the full provisioning descriptor to `planProvisioningAction`; callers cannot accidentally pair a provision operation with the deprovision flag.
7. **Fail closed at every routing layer.** Automation requires account mode `automated`, the corresponding Vendor boolean, a registered connector for the declared protocol, and the connector-reported operation capability. Any missing condition produces the existing canonical localized orchestration checklist.
8. **No migration is expected.** The committed schema already contains every US-025 column, constraints, runtime grants, and status lifecycle. This plan only mirrors the already-committed unique constraints in Drizzle metadata; fresh migration verification and physical parity must prove no SQL migration is necessary.

## Acceptance-criteria evidence map

| Acceptance criterion | Primary implementation | Adversarial evidence |
|---|---|---|
| AC1 — VendorAccount CRUD, mode, floor, renewal, Anthropic-only R1 | contracts, audited service/actions, list/detail forms | real PostgreSQL create/update/retire/reactivate; unauthorized actor; inactive/non-Anthropic vendor; duplicate name/ref; invalid floor/date; audit rollback |
| AC2 — capability card and orchestration fallback | detail read model/card; connector planner descriptor input | exact card fields; provision/deprovision flag-selection tests; mode/flag/protocol/registration/connector-capability negative matrix; canonical checklist output |
| AC3 — read-only license types | detail repository and license-types tab | current effective rate selection; future/expired rate exclusion; inactive types shown with status; DOM has no mutation control or action |

## File map

- Create `packages/contracts/src/vendor-catalog.ts`: strict create/update schemas, enums, date normalization, and public input types.
- Create `packages/contracts/src/vendor-catalog.test.ts`: boundary and normalization tests that kill validation mutants.
- Modify `packages/contracts/src/index.ts`: export the vendor-catalog contract.
- Modify `packages/contracts/package.json`: expose `@smp/contracts/vendor-catalog`.
- Modify `packages/db/src/schema.ts`: mirror the already-committed Vendor name and VendorAccount `(vendor_id, name)` unique constraints in Drizzle metadata.
- Modify `packages/connectors/src/action-planner.ts`: accept the complete provisioning descriptor and choose the correct flag internally.
- Modify `packages/connectors/src/action-planner.test.ts`: prove exact capability semantics and fail-closed routing.
- Modify `packages/db/src/provisioning-routing.ts`: pass the descriptor to the canonical planner.
- Modify `apps/web/src/modules/org-registry/repository.ts`: pass the deprovision descriptor during offboarding.
- Modify `apps/web/src/modules/vendor-catalog/cross-org-move.ts`: pass source/destination descriptors during moves.
- Create `apps/web/src/modules/vendor-catalog/vendor-account-repository.ts`: authorized list/detail query model, active Anthropic options, pool totals, credential health, license types, and current rates.
- Create `apps/web/src/modules/vendor-catalog/production-vendor-account-repository.ts`: production connection wiring.
- Create `apps/web/src/modules/vendor-catalog/vendor-account-service.ts`: audited create/update/status mutation boundary.
- Create `apps/web/src/modules/vendor-catalog/vendor-account-repository.integration.test.ts`: real-PostgreSQL query and mutation evidence.
- Create `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts-operations.ts`: normalized action payload adapter.
- Create `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts-server-actions-factory.ts`: authorization and revalidation composition.
- Create `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts.ts`: production server-action exports.
- Create `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts.test.ts`: production composition and revalidation tests without mocking owned business logic.
- Create `apps/web/src/components/vendor-accounts/vendor-account-form.tsx`: accessible create/edit fields and action-state rendering.
- Create `apps/web/src/components/vendor-accounts/vendor-account-dialog.tsx`: modal lifecycle, focus return, Escape, and focus containment.
- Create `apps/web/src/components/vendor-accounts/vendor-accounts-table.tsx`: responsive list, status/mode chips, counts, empty state, and detail links.
- Create `apps/web/src/components/vendor-accounts/capability-card.tsx`: complete descriptor presentation and fallback explanation.
- Create `apps/web/src/components/vendor-accounts/vendor-account-tabs.tsx`: accessible tabs for capacity, license types, and configuration.
- Create `apps/web/src/components/vendor-accounts/vendor-accounts.test.tsx`: semantic rendering and interaction evidence.
- Replace `apps/web/src/app/(authenticated)/organizaciones/page.tsx`: authorized list screen and create dialog.
- Modify `apps/web/src/app/(authenticated)/organizaciones/[vendorAccountId]/page.tsx`: merge existing pool tiles with capability, license-type, and settings surfaces.
- Create `apps/web/src/app/(authenticated)/organizaciones/loading.tsx`: localized loading boundary.
- Create `apps/web/src/app/(authenticated)/organizaciones/error.tsx`: localized retry boundary.
- Create `apps/web/src/app/(authenticated)/organizaciones/vendor-account-page-boundaries.test.ts`: guard, loading, error, and no-scaffold assertions.
- Modify `apps/web/messages/en-US.json`: English vendor-account vocabulary.
- Modify `apps/web/messages/es-EC.json`: Ecuadorian Spanish vendor-account vocabulary.
- Modify `apps/web/src/lib/i18n/catalogs.test.ts`: lock recursive parity and critical US-025 terms.
- Create `apps/web/e2e/vendor-accounts.spec.ts`: black-box Group Admin CRUD/capability/license-type journey and role denial.
- Modify `apps/web/e2e/auth.setup.ts`: deterministic Anthropic vendor, account, capacity, credential, license, and rate fixtures.
- Modify `apps/web/playwright.config.ts`: include the US-025 journey.
- Modify `docs/benchmarks/CHG-014-local-mutation-cache.md`: append the measured US-025 cold/warm production-campaign result and comparison with the representative fixture.
- Modify `.nous-feedback.jsonl`: append ordered `started`, AC evidence, mutation report, build, verification, and done events only as each event becomes true.

### Task 1: Establish the branch, baseline, and strict public contracts

**Files:**
- Create: `packages/contracts/src/vendor-catalog.ts`
- Create: `packages/contracts/src/vendor-catalog.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `packages/db/src/schema.ts`
- Read before tests: `docs/dev-guide/TESTING.md`

- [ ] **Step 1: Create the implementation branch and record the clean baseline**

Run:

```bash
rtk git status --short --branch
rtk git switch -c feature/vendor-catalog/vendor-account-cru
rtk pnpm check
```

Expected: the worktree starts clean on `main`, the branch is created, and the existing full check is green before US-025 changes. If baseline is red, record and resolve the pre-existing failure before attributing it to this story.

- [ ] **Step 2: Append the story start event**

Append exactly one valid JSONL record:

```json
{"story":"US-025","event":"started","agent":"codex-us025-implementer"}
```

Do not append `ac_pass`, `build_pass`, or `done` yet.

- [ ] **Step 3: Write failing contract tests**

Define test cases with exact strong oracles:

```ts
const validCreate = {
  vendorId: "10000000-0000-0000-0000-000000000001",
  name: "Claude Enterprise — Central",
  mode: "automated",
  vendorOrgRef: "org-central",
  contractRenewalOn: "2027-02-01",
  lowPoolFloor: 5,
};

expect(createVendorAccountSchema.parse(validCreate)).toEqual(validCreate);
expect(createVendorAccountSchema.parse({
  ...validCreate,
  name: "  Claude Enterprise — Central  ",
  vendorOrgRef: "   ",
  contractRenewalOn: "",
})).toEqual({
  ...validCreate,
  name: "Claude Enterprise — Central",
  vendorOrgRef: null,
  contractRenewalOn: null,
});
```

Also reject: non-UUID IDs; blank/over-200-character names; negative, fractional, non-finite, or over-safe-integer floors; impossible dates such as `2027-02-29`; date-times; unknown mode/status; create input containing `status`; update input without a valid account ID; and unexpected keys.

- [ ] **Step 4: Run RED**

Run:

```bash
rtk pnpm --filter @smp/contracts test -- vendor-catalog.test.ts
```

Expected: failure because `vendor-catalog.ts` and its exports do not exist.

- [ ] **Step 5: Implement strict schemas and types**

Use an ISO calendar-date refinement that round-trips in UTC and strict objects:

```ts
export const vendorAccountModeSchema = z.enum(["automated", "orchestration"]);
export const vendorAccountStatusSchema = z.enum(["active", "inactive"]);

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(200).nullable(),
);

export const createVendorAccountSchema = z.object({
  vendorId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  mode: vendorAccountModeSchema,
  vendorOrgRef: optionalText,
  contractRenewalOn: nullableIsoCalendarDateSchema,
  lowPoolFloor: z.number().int().nonnegative().safe(),
}).strict();

export const updateVendorAccountSchema = createVendorAccountSchema
  .omit({ vendorId: true })
  .extend({ id: z.string().uuid(), status: vendorAccountStatusSchema })
  .strict();
```

Export inferred input types from `packages/contracts/src/index.ts` and the new package subpath.

- [ ] **Step 6: Mirror existing unique constraints in Drizzle metadata**

Add schema callbacks using the exact committed constraint names:

```ts
}, (table) => ({
  nameUnique: unique("uq_vendor_name").on(table.name),
}));

// VendorAccount callback, alongside the existing checks/index:
vendorNameUnique: unique("uq_vendor_account_vendor_id_name")
  .on(table.vendorId, table.name),
```

Do not edit `V20251002145723__init_schema.sql` or add a duplicate migration: both constraints already exist in the committed migration history.

- [ ] **Step 7: Run GREEN and schema parity**

Run:

```bash
rtk pnpm --filter @smp/contracts test -- vendor-catalog.test.ts
rtk pnpm --filter @smp/contracts type-check
rtk pnpm --filter @smp/db db:verify
rtk pnpm --filter @smp/db db:parity
```

Expected: contract tests and types pass; committed schema verification and push-vs-migration parity remain green with no generated SQL migration.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/contracts/src/vendor-catalog.ts packages/contracts/src/vendor-catalog.test.ts packages/contracts/src/index.ts packages/contracts/package.json packages/db/src/schema.ts .nous-feedback.jsonl
rtk git commit -m "feat(US-025): define vendor account contracts"
```

### Task 2: Make capability routing consume the complete vendor descriptor

**Files:**
- Modify: `packages/connectors/src/action-planner.ts`
- Modify: `packages/connectors/src/action-planner.test.ts`
- Modify: `packages/db/src/provisioning-routing.ts`
- Modify: `apps/web/src/modules/org-registry/repository.ts`
- Modify: `apps/web/src/modules/vendor-catalog/cross-org-move.ts`
- Modify only where compile errors prove necessary: existing focused tests for those call sites

- [ ] **Step 1: Write the failing planner semantics matrix**

Replace the freely paired `vendorCapability` test helper with:

```ts
type VendorProvisioningDescriptor = {
  readonly canProvision: boolean;
  readonly canDeprovision: boolean;
  readonly provisioningProtocol: ConnectorProtocol;
};
```

Add exact assertions that:

- provision reads only `canProvision`, even when `canDeprovision` is the opposite;
- deprovision reads only `canDeprovision`;
- account mode `orchestration` always produces a checklist;
- `none`, missing registration, missing Vendor flag, and missing connector capability each produce a checklist;
- a matching Vendor flag plus registered connector capability plus automated mode produces `invite` or `remove`;
- the persisted `rawRequest.protocol` is the descriptor protocol;
- no negative path throws merely because the REST/SCIM connector is absent.

- [ ] **Step 2: Run RED**

```bash
rtk pnpm --filter @smp/connectors test -- action-planner.test.ts
```

Expected: TypeScript/test failure because the planner still accepts `protocol` and `vendorCapability` separately.

- [ ] **Step 3: Move flag selection into the canonical planner**

Change only the input seam; retain the existing checklist builder and result shape:

```ts
const vendorCapability = input.operation === "provision"
  ? input.vendor.canProvision
  : input.vendor.canDeprovision;
const protocol = input.vendor.provisioningProtocol;

if (input.accountMode === "automated" && vendorCapability) {
  try {
    automated = dispatcher.forProtocol(protocol).capabilities().has(capability);
  } catch {
    // Fail closed: unregistered protocols route to orchestration.
  }
}
```

The public planner input becomes `vendor: VendorProvisioningDescriptor`; remove the standalone `protocol` and `vendorCapability` properties.

- [ ] **Step 4: Update every production caller**

Each query/caller must carry all three facts from its joined `Vendor` row and pass them without transformation:

```ts
vendor: {
  canProvision: request.canProvision,
  canDeprovision: request.canDeprovision,
  provisioningProtocol: request.provisioningProtocol,
},
```

For offboarding and cross-org move, add a missing selected boolean rather than synthesizing it. Do not import Anthropic-specific code into core modules.

- [ ] **Step 5: Run focused GREEN regressions**

```bash
rtk pnpm --filter @smp/connectors test -- action-planner.test.ts
rtk pnpm --filter @smp/db test -- provisioning-routing
rtk pnpm --filter smp-web test -- cross-org-move repository
rtk pnpm lint:provider-boundary
```

Expected: canonical planner and all existing orchestration/cross-org tests pass; provider-boundary lint reports no provider-specific core import.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/connectors/src/action-planner.ts packages/connectors/src/action-planner.test.ts packages/db/src/provisioning-routing.ts apps/web/src/modules/org-registry/repository.ts apps/web/src/modules/vendor-catalog/cross-org-move.ts
rtk git commit -m "refactor(US-025): centralize vendor capability routing"
```

### Task 3: Build the authorized vendor-account query model

**Files:**
- Create: `apps/web/src/modules/vendor-catalog/vendor-account-repository.ts`
- Create: `apps/web/src/modules/vendor-catalog/production-vendor-account-repository.ts`
- Create: `apps/web/src/modules/vendor-catalog/vendor-account-repository.integration.test.ts`
- Reuse: `@smp/db/pool-snapshots`

- [ ] **Step 1: Define stable read-model types in the failing integration test**

Lock the list/detail contract with explicit types:

```ts
export interface VendorAccountListItem {
  readonly id: string;
  readonly name: string;
  readonly vendorName: string;
  readonly connectorType: "api" | "orchestration" | "manual";
  readonly provisioningProtocol: "rest" | "scim" | "none";
  readonly mode: "automated" | "orchestration";
  readonly purchased: number;
  readonly free: number;
  readonly contractRenewalOn: string | null;
  readonly credentialHealth: "ok" | "auth_failed" | "unverified" | null;
  readonly lowPoolFloor: number;
  readonly status: "active" | "inactive";
}

export interface VendorAccountDetail extends VendorAccountListItem {
  readonly vendorId: string;
  readonly vendorOrgRef: string | null;
  readonly capabilities: {
    readonly canProvision: boolean;
    readonly canDeprovision: boolean;
    readonly hasUsageData: boolean;
    readonly hasCostData: boolean;
    readonly provisioningProtocol: "rest" | "scim" | "none";
    readonly identityMatching: "email" | "upn" | "vendor_user_id";
  };
  readonly licenseTypes: readonly {
    readonly id: string;
    readonly name: string;
    readonly unit: "seat" | "license";
    readonly status: "active" | "inactive";
    readonly monthlyRateUsd: string | null;
    readonly rateEffectiveFrom: string | null;
    readonly rateEffectiveTo: string | null;
  }[];
}
```

- [ ] **Step 2: Write real-PostgreSQL RED cases**

Use the shared Testcontainers helper and actual migrations. Seed:

- one active Anthropic vendor with two accounts, including an account with no capacity;
- one inactive Anthropic vendor and one non-Anthropic vendor;
- multiple license types and past/current/future/expired rates;
- capacity, open assignment, and pending invite rows;
- multiple credentials with differing health/status.

Assert exact results for:

1. Group Admin sees active and inactive accounts in deterministic `(status, lower(name), id)` order.
2. An account with no capacity remains visible with `purchased = 0` and `free = 0`.
3. Totals equal the sum of canonical pool snapshots and never double-count credentials or license types.
4. Credential health uses only active credentials and the severity order `auth_failed > unverified > ok`; no credential returns `null`.
5. Detail selects the latest currently effective rate by `(effective_from DESC, id DESC)`, excludes future/expired rates, and returns `null` when no current rate exists.
6. Active Anthropic options exclude inactive Anthropic and all other vendors.
7. Non-Group Admin access fails before a catalog query is executed.
8. Invalid/nonexistent detail IDs return `null` without leaking another entity.

- [ ] **Step 3: Run RED**

```bash
rtk pnpm --filter smp-web test -- vendor-account-repository.integration.test.ts
```

Expected: failure because the repository does not exist.

- [ ] **Step 4: Implement the query repository**

Create `createVendorAccountRepository(connectionString)` with:

```ts
list(authorization, at): Promise<readonly VendorAccountListItem[]>
detail(authorization, vendorAccountId, at): Promise<VendorAccountDetail | null>
activeAnthropicOptions(authorization): Promise<readonly { id: string; name: string }[]>
close(): Promise<void>
```

Rules:

- assert `authorization.globalRole === "group_admin"` before any `pool.query`;
- parse IDs with the existing `parseVendorAccountId` helper;
- call `listCurrentSeatPoolCounts()` for canonical purchased/assigned/pending values and aggregate `purchased`/`free` by account;
- query accounts independently so zero-capacity accounts are not dropped;
- aggregate credential health in a subquery before joining, preventing multiplicative joins;
- parameterize `at`/operating date and all IDs;
- normalize PostgreSQL numeric/date results at the repository boundary;
- never filter global catalog data using request-supplied `company_id`.

- [ ] **Step 5: Add production wiring**

Follow `production-pool-repository.ts`: read `DATABASE_URL`, construct one lazy repository, and throw the existing configuration-style error when the variable is absent.

- [ ] **Step 6: Run GREEN and commit**

```bash
rtk pnpm --filter smp-web test -- vendor-account-repository.integration.test.ts
rtk pnpm --filter smp-web type-check
rtk git add apps/web/src/modules/vendor-catalog/vendor-account-repository.ts apps/web/src/modules/vendor-catalog/production-vendor-account-repository.ts apps/web/src/modules/vendor-catalog/vendor-account-repository.integration.test.ts
rtk git commit -m "feat(US-025): add vendor account read models"
```

### Task 4: Implement atomic audited create, update, retire, and reactivate commands

**Files:**
- Create: `apps/web/src/modules/vendor-catalog/vendor-account-service.ts`
- Extend: `apps/web/src/modules/vendor-catalog/vendor-account-repository.integration.test.ts`
- Reuse: `apps/web/src/modules/audit/with-audit.ts`

- [ ] **Step 1: Write failing mutation and audit tests**

Against real PostgreSQL, require:

- create stores normalized input, forces `status = active`, sets `created_by/created_at`, and appends exactly one `vendor_account.created` audit row;
- update locks the account, changes only allowed fields, sets `updated_by/updated_at`, and appends exact before/after to `vendor_account.updated`;
- active→inactive appends `vendor_account.retired`; inactive→active appends `vendor_account.reactivated`;
- a same-value update is rejected as `VENDOR_ACCOUNT_NO_CHANGES` and creates no audit noise;
- non-Group Admin, invalid input, unknown account, inactive/non-Anthropic create vendor, duplicate `(vendor_id, name)`, and duplicate non-null `(vendor_id, vendor_org_ref)` leave domain and audit rows unchanged;
- an injected audit-insert failure rolls the domain mutation back;
- no command issues DELETE and existing capacity, assignments, requests, and audit history survive retirement.

Use exact row and audit JSON assertions; do not mock the service, database, or audit wrapper.

- [ ] **Step 2: Run RED**

```bash
rtk pnpm --filter smp-web test -- vendor-account-repository.integration.test.ts
```

Expected: missing service export/method failures.

- [ ] **Step 3: Implement the command service**

Expose:

```ts
createVendorAccount(
  authorization: LedgerAuthorization,
  input: unknown,
): Promise<{ readonly id: string }>

updateVendorAccount(
  authorization: LedgerAuthorization,
  input: unknown,
): Promise<{ readonly id: string; readonly status: "active" | "inactive" }>
```

Inside `withAudit`:

1. assert global Group Admin;
2. parse with the public Zod contract;
3. select/lock trusted vendor/account facts;
4. verify create vendor is active Anthropic;
5. execute a parameterized Drizzle insert/update;
6. map PostgreSQL unique/check violations to stable domain codes without exposing SQL text;
7. return an audit envelope with `companyId: null`, `entityType: "VendorAccount"`, exact action, trusted actor, redacted before/after, and injected clock.

No client input may populate audit actor, timestamps, status on create, or vendor name.

- [ ] **Step 4: Run GREEN and commit**

```bash
rtk pnpm --filter smp-web test -- vendor-account-repository.integration.test.ts
rtk pnpm --filter smp-web lint
rtk git add apps/web/src/modules/vendor-catalog/vendor-account-service.ts apps/web/src/modules/vendor-catalog/vendor-account-repository.integration.test.ts
rtk git commit -m "feat(US-025): audit vendor account lifecycle"
```

### Task 5: Expose tested server actions with exact revalidation

**Files:**
- Create: `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts-operations.ts`
- Create: `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts-server-actions-factory.ts`
- Create: `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts.ts`
- Create: `apps/web/src/modules/vendor-catalog/actions/manage-vendor-accounts.test.ts`

- [ ] **Step 1: Write failing action-composition tests**

Use real `FormData` plus a real service backed by the integration database where business behavior is asserted. Restrict injected spies to framework seams (`loadAuthorization`, `revalidate`) and assert:

- unauthenticated invocation fails before the service;
- create parses `lowPoolFloor` as a number and blank optional values as `null`;
- update includes the route ID and status;
- successful create revalidates `/organizaciones` and returns the created ID;
- successful update revalidates both `/organizaciones` and `/organizaciones/<encoded-id>`;
- failure does not revalidate;
- exported production actions call the tested factory/operation path so the audited-action checker can prove the mutation boundary.

- [ ] **Step 2: Run RED**

```bash
rtk pnpm --filter smp-web test -- manage-vendor-accounts.test.ts
```

- [ ] **Step 3: Implement normalized action state**

Use a discriminated, serializable state:

```ts
export type VendorAccountActionState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly vendorAccountId: string }
  | {
      readonly status: "error";
      readonly code: "invalid_input" | "duplicate" | "forbidden" | "not_found" | "unexpected";
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    };
```

Map internal stable service errors to these public codes. Never send raw database errors, SQL, stack traces, or audit payloads to the client.

- [ ] **Step 4: Implement production exports**

Export exactly `createVendorAccount` and `updateVendorAccount` from the `"use server"` module. Wire production DB, `loadCurrentLedgerAuthorization`, `revalidatePath`, and the audited service factory. Add the audit-enforcement annotation only if the checker requires it and it truthfully identifies the one-hop audited service.

- [ ] **Step 5: Run GREEN, enforcement, and commit**

```bash
rtk pnpm --filter smp-web test -- manage-vendor-accounts.test.ts audited-actions-enforcement.test.ts
rtk pnpm --filter smp-web lint
rtk git add apps/web/src/modules/vendor-catalog/actions
rtk git commit -m "feat(US-025): expose vendor account server actions"
```

### Task 6: Build the vendor-account list and accessible creation modal

**Files:**
- Create: `apps/web/src/components/vendor-accounts/vendor-account-form.tsx`
- Create: `apps/web/src/components/vendor-accounts/vendor-account-dialog.tsx`
- Create: `apps/web/src/components/vendor-accounts/vendor-accounts-table.tsx`
- Create: `apps/web/src/components/vendor-accounts/vendor-accounts.test.tsx`
- Replace: `apps/web/src/app/(authenticated)/organizaciones/page.tsx`
- Modify: `apps/web/messages/en-US.json`
- Modify: `apps/web/messages/es-EC.json`
- Modify: `apps/web/src/lib/i18n/catalogs.test.ts`

- [ ] **Step 1: Add failing semantic rendering tests**

Use Testing Library and the real component tree. Assert:

- empty and populated list states;
- one semantic table row/link per account, including a zero-capacity account;
- purchased/free, renewal, connector/protocol, mode, credential health, floor, and inactive status render from the read model;
- link targets encode the account ID;
- opening the modal moves focus inside; Tab/Shift+Tab stay contained; Escape/cancel closes and restores trigger focus;
- submitting invalid data exposes field errors with `aria-invalid`, linked descriptions, and no action call;
- pending disables duplicate submission and changes the button label;
- successful creation closes the dialog and surfaces localized success feedback;
- all user-facing content comes through supplied labels, not embedded Spanish/English strings.

- [ ] **Step 2: Run RED**

```bash
rtk pnpm --filter smp-web test -- vendor-accounts.test.tsx
```

- [ ] **Step 3: Implement the list, dialog, and form**

Follow the native `<dialog>` pattern already used by audit/request components. The form fields are exactly:

- active Anthropic vendor select (one option in R1, still server-provided);
- name;
- optional vendor reference;
- mode;
- non-negative integer low-pool floor defaulting to 5;
- optional contract-renewal date.

Use minimum 44px interactive targets, visible focus rings, design tokens only, `aria-labelledby`, `aria-describedby`, `role="alert"` for failures, and return focus to `btn_new_vendor_account`.

- [ ] **Step 4: Replace the scaffold page**

The Server Component must:

```ts
const authorization = await loadCurrentLedgerAuthorization();
if (!authorization || authorization.globalRole !== "group_admin") {
  redirect(ROUTE_SCR_ACCESS_DENIED);
}
const [accounts, vendors, t] = await Promise.all([
  repository.list(authorization, new Date()),
  repository.activeAnthropicOptions(authorization),
  getTranslations("vendorAccounts"),
]);
```

Render a semantic main/header, action bar, table, and create dialog. Remove the `data-scaffold` marker and all imports from the obsolete `src/lib/i18n/en-US.json` generated scaffold catalog.

- [ ] **Step 5: Add complete bilingual vocabulary**

Add identical recursive key structure under `vendorAccounts` in both runtime catalogs. Include titles, descriptions, column labels, connector/mode/status/credential labels, form labels/help, submitting/success/error messages, empty state, and accessibility labels. Lock critical translations and key parity in `catalogs.test.ts`.

- [ ] **Step 6: Run GREEN, design-system lint, and commit**

```bash
rtk pnpm --filter smp-web test -- vendor-accounts.test.tsx catalogs.test.ts
rtk pnpm --filter smp-web lint:ds
rtk pnpm --filter smp-web lint:a11y
rtk git add apps/web/src/components/vendor-accounts apps/web/src/app/'(authenticated)'/organizaciones/page.tsx apps/web/messages/en-US.json apps/web/messages/es-EC.json apps/web/src/lib/i18n/catalogs.test.ts
rtk git commit -m "feat(US-025): build vendor account registry"
```

### Task 7: Complete the detail screen, capability card, read-only license tab, and settings

**Files:**
- Create: `apps/web/src/components/vendor-accounts/capability-card.tsx`
- Create: `apps/web/src/components/vendor-accounts/vendor-account-tabs.tsx`
- Extend: `apps/web/src/components/vendor-accounts/vendor-account-form.tsx`
- Extend: `apps/web/src/components/vendor-accounts/vendor-accounts.test.tsx`
- Modify: `apps/web/src/app/(authenticated)/organizaciones/[vendorAccountId]/page.tsx`
- Modify: `apps/web/messages/en-US.json`
- Modify: `apps/web/messages/es-EC.json`

- [ ] **Step 1: Write failing detail-surface tests**

Assert the rendered detail contains:

1. account name, vendor, mode, renewal, and existing canonical capacity tiles;
2. all six descriptor facts: provision, deprovision, usage, cost, protocol, identity matching;
3. an explicit localized statement that unsupported provisioning steps use orchestration;
4. accessible tabs with `role=tablist`, `role=tab`, `aria-selected`, `aria-controls`, keyboard Left/Right/Home/End behavior, and one visible panel;
5. license rows with localized unit/status, current USD rate and effective dates, or the exact no-current-rate placeholder;
6. no license-type create/edit/delete button, form, or server action;
7. settings prefilled with account values and status; save feedback and pending state;
8. invalid UUID and unknown account behavior produces `notFound()`; non-Group Admin redirects before repository access.

- [ ] **Step 2: Run RED**

```bash
rtk pnpm --filter smp-web test -- vendor-accounts.test.tsx
```

- [ ] **Step 3: Implement the capability card**

Render a definition list rather than parsing a prose description. Each boolean uses localized supported/not-supported text and a non-color-only symbol/state. Render protocol and identity values through translation keys. Include a persistent orchestration fallback note referencing behavior, not internal DEC IDs.

- [ ] **Step 4: Implement accessible tabs without URL ambiguity**

Use local client state for `capacity | licenseTypes | settings`, defaulting to capacity. Preserve server-rendered tab labels and panels for hydration. Do not implement Credentials (US-031) or ingestion actions (US-055) in this story.

- [ ] **Step 5: Integrate the authorized detail read model**

Keep the existing authorization and UUID parse before data access. Load the detail and pool snapshots concurrently; return `notFound()` only when the account itself is absent, not when it has no capacity. This corrects the current behavior where zero snapshots incorrectly imply a missing account.

Pass existing snapshots to `PoolTiles`. A zero-capacity account renders the localized empty-capacity state while the detail, descriptor, license types, and settings remain available.

- [ ] **Step 6: Wire update/retire/reactivate settings**

Reuse `VendorAccountForm` in edit mode. Include name, mode, floor, renewal, vendor ref, and status. Vendor is read-only on update to avoid silently moving an account—and all dependent licenses/requests—between vendors.

- [ ] **Step 7: Run GREEN and commit**

```bash
rtk pnpm --filter smp-web test -- vendor-accounts.test.tsx vendor-account-repository.integration.test.ts
rtk pnpm --filter smp-web type-check
rtk pnpm --filter smp-web lint:ds
rtk git add apps/web/src/components/vendor-accounts apps/web/src/app/'(authenticated)'/organizaciones/'[vendorAccountId]'/page.tsx apps/web/messages/en-US.json apps/web/messages/es-EC.json
rtk git commit -m "feat(US-025): complete vendor account detail"
```

### Task 8: Add resilient page boundaries and black-box acceptance evidence

**Files:**
- Create: `apps/web/src/app/(authenticated)/organizaciones/loading.tsx`
- Create: `apps/web/src/app/(authenticated)/organizaciones/error.tsx`
- Create: `apps/web/src/app/(authenticated)/organizaciones/vendor-account-page-boundaries.test.ts`
- Create: `apps/web/e2e/vendor-accounts.spec.ts`
- Modify: `apps/web/e2e/auth.setup.ts`
- Modify: `apps/web/playwright.config.ts`

- [ ] **Step 1: Write failing static boundary tests**

Assert both routes use the canonical authorization loader and access-denied route, the detail parses UUID before repository access, scaffolding markers are absent, loading/error files contain localized accessible status/alert semantics, and `error.tsx` invokes the supplied retry callback.

- [ ] **Step 2: Implement localized loading/error boundaries**

Use existing page-boundary patterns. The error boundary is a Client Component, logs no sensitive data, presents one localized retry button, and calls `reset()`.

- [ ] **Step 3: Seed deterministic E2E catalog facts**

Change the existing breadcrumb vendor fixture to `Anthropic` and add deterministic:

- descriptor booleans/protocol/identity;
- account renewal/floor/vendor ref;
- capacity, active assignment, and pending invite producing known totals;
- active credential health;
- active/inactive license types and current/future rates.

Use idempotent fixture SQL or a clean Compose database. Do not add a second Anthropic row that violates the committed unique name constraint.

- [ ] **Step 4: Write the black-box US-025 journey**

In a real Compose/Auth.js/Keycloak/PostgreSQL environment:

1. an employee opening `/organizaciones` and the detail route is redirected to `/acceso-denegado` and sees no catalog data;
2. Group Admin sees the seeded account, exact capacity totals, renewal, credential health, and floor;
3. Group Admin creates a new account using the sole Anthropic option and it appears even with zero capacity;
4. detail shows all capability fields and the orchestration fallback explanation;
5. license types and current rate render, future rate does not, and no mutation control exists;
6. Group Admin changes mode/floor/renewal and retires the account; list/detail reflect the persisted state after reload;
7. the audit screen contains `vendor_account.created`, `vendor_account.updated`, and `vendor_account.retired` for the new entity.

- [ ] **Step 5: Run focused component/integration tests, then E2E**

```bash
rtk pnpm --filter smp-web test -- vendor-account-page-boundaries.test.ts vendor-accounts.test.tsx vendor-account-repository.integration.test.ts manage-vendor-accounts.test.ts
rtk pnpm --filter smp-web test:e2e -- vendor-accounts.spec.ts
```

Expected: every focused test and the real black-box journey passes. Preserve traces only on failure.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/src/app/'(authenticated)'/organizaciones/loading.tsx apps/web/src/app/'(authenticated)'/organizaciones/error.tsx apps/web/src/app/'(authenticated)'/organizaciones/vendor-account-page-boundaries.test.ts apps/web/e2e/vendor-accounts.spec.ts apps/web/e2e/auth.setup.ts apps/web/playwright.config.ts
rtk git commit -m "test(US-025): verify vendor account journey"
```

### Task 9: Prove each acceptance criterion and mutation effectiveness

**Files:**
- Modify: `.nous-feedback.jsonl`
- Modify: `docs/benchmarks/CHG-014-local-mutation-cache.md`
- Create only if routing requires it: a focused `vitest.us025.config.ts` or mutation runner patterned after existing accountable-story runners
- Modify only when a surviving non-equivalent mutant exposes a missing property: the corresponding US-025 test first, then production code

- [ ] **Step 1: Run the complete focused suite from a clean test database**

```bash
rtk pnpm --filter @smp/contracts test -- vendor-catalog.test.ts
rtk pnpm --filter @smp/connectors test -- action-planner.test.ts
rtk pnpm --filter smp-web test -- vendor-account
rtk pnpm --filter smp-web test -- vendor-accounts
rtk pnpm --filter smp-web test:e2e -- vendor-accounts.spec.ts
```

- [ ] **Step 2: Capture the cache baseline and run the cold diff-scoped mutation gate**

Use the story branch’s merge base with `main`. Inspect the cache, clear only the repository-scoped CHG-014 cache, snapshot the performance-record directory, and run the authoritative campaign once:

```bash
rtk pnpm mutation:cache:inspect
rtk pnpm mutation:cache:clear
rtk ls -1 reports/mutation-performance
rtk env MUTATION_BASE_REF=main pnpm test:mutation
rtk ls -1t reports/mutation-performance
```

Expected: every generated scored shard meets the repository’s ≥80% mutation threshold, verification-only shards pass exact static/integration assertions, and the manifest identifies the exact base/head provenance. The new performance record is the cold record: all successful cacheable shards executed, none were reused, and rejected shards include an explicit fail-closed reason. A timeout/error is not a pass unless the runner classifies it as a detected non-surviving mutant under the repository policy.

- [ ] **Step 3: Run the unchanged warm campaign and prove reuse effectiveness**

Without changing tracked files, dependencies, database schema/profile, tool versions, locale, timezone, or the base/head pair, run the exact campaign again:

```bash
rtk git status --short
rtk env MUTATION_BASE_REF=main pnpm test:mutation
rtk ls -1t reports/mutation-performance
rtk pnpm mutation:cache:inspect
```

Identify the two newly generated JSON records by creation order and verify they have the same campaign key, machine profile, tool profile, runtime/DB profile, base, and head. Generate the comparison with:

```bash
rtk pnpm mutation:benchmark:summary <cold-record.json> <warm-record.json>
```

Expected: the records are comparable; every successful cold shard is reused; no Stryker shard executes on the warm run; hit ratio is 1 for cacheable successful shards; warm orchestration completes below 60 seconds; and the summary distinguishes measured wall-clock savings from estimated reused-shard time. If any shard executes or is rejected unexpectedly, treat it as a CHG-014 regression: reproduce it with the mutation-evidence tests, fix it RED-first, rerun both campaigns from a cleared cache, and do not report partial reuse as success.

- [ ] **Step 4: Save benchmark documentation and canonical feedback**

Append a dated “US-025 production campaign” section to `docs/benchmarks/CHG-014-local-mutation-cache.md` containing:

- exact base/head SHA and performance-record filenames;
- machine, tool, and PostgreSQL profile;
- cold/warm wall-clock and orchestration durations;
- total, executed, reused, rejected, and cacheable shard counts;
- hit ratio, measured savings, estimated shard savings, and comparison with the earlier fixed representative benchmark;
- remaining cold and warm bottlenecks;
- whether the evidence strengthens or changes the later Substrate proposal.

Do not commit generated JSON reports. Append a canonical feedback record only after measurements are verified:

```json
{"story":"US-025","event":"feedback","title":"CHG-014 mutation-cache effectiveness on US-025","description":"<exact cold/warm durations, shard counts, hit ratio, measured savings, provenance, and Substrate conclusion>","images":[]}
```

The description must contain measured values from the records, not estimates or placeholders.

- [ ] **Step 5: Kill non-equivalent surviving mutants**

For each survivor on authorization, vendor selection, status lifecycle, date/floor validation, current-rate selection, credential severity, capability routing, audit atomicity, or read-only UI behavior:

1. add the smallest strong assertion that proves the missing property;
2. confirm the focused test fails against the mutant;
3. rerun its shard;
4. document only narrowly justified equivalent mutants using the existing classification mechanism.

Do not add coverage-only tests.

- [ ] **Step 6: Append adversarial AC evidence only after it passes**

Append one `ac_pass` and one `ac_verify` per criterion. Example shape:

```json
{"story":"US-025","event":"ac_verify","ac":2,"method":"connector planner capability matrix plus real detail rendering","pass":true,"notes":"Provision and deprovision select their own Vendor flags; missing account mode, Vendor flag, protocol registration, or connector capability produces the canonical orchestration checklist, while the UI renders the same descriptor facts."}
```

Use actual observed methods/results, not this example verbatim. Append the mutation `test_report` with exact source commit/provenance, score, cache-schema version, cold/warm record filenames, and reuse outcome.

- [ ] **Step 7: Commit acceptance and performance evidence**

```bash
rtk git add .nous-feedback.jsonl docs/benchmarks/CHG-014-local-mutation-cache.md
rtk git commit -m "test(US-025): record acceptance and cache evidence"
```

### Task 10: Full Definition of Done, independent review, and delivery readiness

**Files:**
- Review: all files changed since `main`
- Modify only for discovered defects: the owning task’s test and implementation files
- Modify last: `.nous-feedback.jsonl`

- [ ] **Step 1: Inspect the exact story diff**

```bash
rtk git diff --check main...HEAD
rtk git diff --stat main...HEAD
rtk git status --short
```

Confirm there are no generated artifacts, secrets, raw error payloads, hardcoded user-facing strings, unrelated story changes, or modified committed migrations.

- [ ] **Step 2: Run database release gates**

With `DATABASE_ADMIN_URL` using `ledger_owner` and `DATABASE_URL` using `ledger_app`:

```bash
rtk pnpm --filter @smp/db db:migrate
rtk pnpm --filter @smp/db db:verify
rtk pnpm --filter @smp/db db:parity
```

Expected: sorted committed migrations apply to a fresh database; verifier and physical parity pass; runtime grants still permit VendorAccount SELECT/INSERT/UPDATE and deny DELETE.

- [ ] **Step 3: Run the full repository gate**

```bash
rtk pnpm check
```

Expected: type-check, lint (including audited-action/provider/design-system/generated-guidance checks), all tests, and production build are green.

- [ ] **Step 4: Perform an independent specification review**

Use a fresh review agent with no implementation ownership. Give it:

- US-025 story and all three ACs;
- this plan’s implementation decisions/non-goals;
- `docs/dev-guide/TESTING.md` and `DEFINITION_OF_DONE.md`;
- `git diff main...HEAD`;
- mutation manifest/provenance and focused/E2E evidence.

Require it to inspect authorization-before-read, audit atomicity, global-vs-company scope, no hard delete, zero-capacity visibility, current-rate temporal logic, Anthropic-only creation, planner fail-closed behavior, read-only license UI, i18n/a11y, and migration parity. Resolve every actionable finding with RED-first evidence, then rerun affected gates.

- [ ] **Step 5: Append terminal evidence bound to the final commit**

After all review fixes are committed and gates rerun, append:

```json
{"story":"US-025","event":"build_pass","source_commit":"<final-implementation-sha>","notes":"pnpm check, db:migrate, db:verify, db:parity, focused E2E, and mutation gates green"}
{"story":"US-025","event":"verified","source_commit":"<final-implementation-sha>","notes":"Independent specification review approved with no unresolved findings"}
{"story":"US-025","event":"done","source_commit":"<final-implementation-sha>"}
```

The SHA must identify the code under test. If appending evidence creates a later documentation-only commit, explicitly retain the tested implementation SHA in each record.

- [ ] **Step 6: Commit the terminal evidence**

```bash
rtk git add .nous-feedback.jsonl
rtk git commit -m "docs(US-025): record completion evidence"
```

- [ ] **Step 7: Prepare the delivery summary**

Report:

- each AC and its concrete evidence;
- focused, E2E, mutation, database, and full-check outcomes;
- exact mutation base/head and score;
- independent reviewer result;
- commits created;
- explicit deferrals: vendor registry FEAT-R2-01, credentials US-031, CSV/manual ingestion US-055, Anthropic automation US-018.

Do not merge or push until the user separately authorizes those external Git actions.

## Final self-review checklist

- [ ] Every US-025 AC maps to implementation plus adversarial evidence.
- [ ] `VendorAccount` remains global business data; no fake `company_id` or tenant boundary was invented.
- [ ] Group Admin authorization occurs before every read and mutation.
- [ ] Create accepts only the server-verified active Anthropic row in R1.
- [ ] “Delete” is status-based retirement, preserves references/history, and never issues DELETE.
- [ ] All mutations and their audit records commit or roll back atomically.
- [ ] The canonical planner—not its callers—selects the operation-specific Vendor boolean.
- [ ] Missing mode/flag/protocol/registration/connector capability routes to orchestration.
- [ ] Zero-capacity accounts remain listable and detail-addressable.
- [ ] License types are read-only and current rates obey effective dates.
- [ ] No credentials or ingestion capabilities outside US-025 were pulled forward.
- [ ] All runtime strings exist in both locale catalogs with exact key parity.
- [ ] Keyboard, focus, semantic table/tab/dialog, loading, and error behavior are tested.
- [ ] No owned code/database was mocked; real PostgreSQL evidence covers persistence and audit.
- [ ] New tests kill relevant mutants rather than adding coverage volume.
- [ ] No committed migration was edited; fresh migration verification and parity pass.
- [ ] `rtk pnpm check` and independent review pass on the final implementation commit.
- [ ] Placeholder scan is clean: `rtk rg -n "TODO|TBD|FIXME|SCAFFOLD|placeholder"` over all US-025 files yields no implementation placeholder.
