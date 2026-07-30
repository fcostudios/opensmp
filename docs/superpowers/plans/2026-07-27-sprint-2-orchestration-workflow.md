# Ledger Sprint 2 Orchestration Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Sprint 2’s 12 stories as a company-scoped, auditable request-to-active workflow that works end to end in orchestration mode without an Anthropic API client.

**Architecture:** Extend the existing modular monolith along the bounded-context seams already declared in `docs/specs/09_architecture.md`: `org-registry` owns people, `request-workflow` owns lifecycle and decisions, `register` owns assignments and exports, `alerts` owns rules/events, and a new `packages/connectors` package owns the vendor-neutral port. Server Components read through module repositories, Server Actions validate shared Zod contracts and authorize against Ledger DB grants, mutations use `withAudit`, and scheduled alert evaluation runs in the existing pg-boss worker.

**Tech Stack:** Node.js 22.12, pnpm 9, Turborepo, Next.js 16 App Router, React 19, TypeScript, PostgreSQL 16, Drizzle, Zod, Auth.js/Keycloak, pg-boss, Nodemailer/SMTP, Vitest, fast-check, Testcontainers, Playwright, Stryker, and Docker Compose.

---

## 1. Planning verdict

Sprint 2 is **conditionally ready**. The repository is clean and the current type-check, lint, test, build, route, sidebar, and Compose configuration gates pass. Feature implementation may begin only after Task 1 records the four source-of-truth repairs below and Task 2 proves the current migration chain against disposable owner/runtime databases.

| Gate | Current evidence | Required resolution |
|---|---|---|
| Sprint queue drift | `docs/specs/10_plan.md` has the correct 34 SP cycle-free plan; generated `docs/stories/SPRINT_PLAN.md` reports 0 SP, stale cross-sprint blockers, and `current_sprint: sprint-5` | Repair Nous data/generator, regenerate the package, and mechanically compare story files, Step 10, and the sprint queue |
| Sprint 1 external deferral | US-054 remains blocked on per-org keys and invite-canary authorization | Record US-054 as an accepted external deferral for Sprint 2; it remains a Sprint 3 connector-entry gate, not a Sprint 2 orchestration blocker |
| Missing lifecycle graph | US-014 refers to the PRD §10 graph, but the dev package contains no explicit transition table | Adopt the transition table in §4.1 of this plan and retrofit it into Scope, story ACs, critical paths, and generated developer guidance |
| Orchestration verification timing | US-020 says the “next member sync” verifies, while member sync/API-less ingestion are Sprint 3 | In Sprint 2, admin attestation activates the assignment; a verification port records later observations. Sprint 3 wires API/CSV member observations to that port and may mark the action `verification_failed` without silently deleting the assignment |
| Alert type mismatch | US-042 title says 8 types, AC1 lists 10, and the schema enum contains 8 | Canonicalize the story to 10 P0 types and append a migration for `deprovision_overdue` and `close_missed` |
| Database freshness | Root gates pass, but `DATABASE_URL` and `DATABASE_ADMIN_URL` were absent during readiness review | Run `db:migrate`, `db:verify`, and `db:parity` with `ledger_owner`/`ledger_app` before the first feature branch |
| CI provenance | The checkout has no Git remote, so current hosted CI cannot be inspected | Configure or document the authoritative remote before Sprint 2 acceptance; local gates remain mandatory meanwhile |

### Fixed Sprint 2 decisions

1. `docs/specs/10_plan.md` is the temporary execution authority until Nous regenerates a matching `docs/stories/SPRINT_PLAN.md`.
2. Sprint 2 contains 12 stories and 34 SP. No Sprint 3 story is a blocker for Sprint 2.
3. `Company` is the tenant boundary. Every person, request, assignment, approval, and alert query derives company scope from the authenticated Ledger authorization context.
4. `VendorAccount` narrows vendor business data but never substitutes for `company_id` authorization.
5. Server Actions are the mutation API. The register CSV uses a route handler for the streamed body; `exportRegisterCsv` returns the authorized download URL.
6. A checklist confirmation is an explicit human attestation. It creates the active register row transactionally; later sync/CSV observations verify the attestation and surface mismatches.
7. Alert evaluation uses 10 canonical types:

   ```ts
   export const ALERT_TYPES = [
     "approval_aging",
     "provisioning_failure",
     "blocked_no_seat",
     "low_pool",
     "invite_unaccepted",
     "sync_stale",
     "credential_failure",
     "register_drift",
     "deprovision_overdue",
     "close_missed",
   ] as const;
   ```

8. No story is marked `done` until every AC has a separate adversarial `ac_verify`, the root quality gates pass, migrations pass, and the critical-path mutation gate kills at least 80% of changed non-equivalent mutants.

## 2. Dependency and execution model

```text
Task 1 Nous/readiness reconciliation
  └─ Task 2 database baseline
       ├─ US-010 people ───────────────┐
       ├─ US-014 lifecycle ── US-015 ──┼─ US-012 intake ── US-013 request surfaces
       │                    │          │                  └─ US-016 notifications
       │                    │          └─ US-020 orchestration
       ├─ US-033 register             └─ US-017 aging
       ├─ US-042 alerts ──── US-022 pools
       └─ US-045 connector ─ US-020 orchestration
```

### Safe parallel waves

| Wave | Stories/tasks | Merge condition |
|---|---|---|
| 0 | Tasks 1–2 | Nous repair accepted or explicitly tracked; fresh migration parity green |
| 1 | US-010, US-014, US-033, US-042, US-045 | Each module contract and tenant-isolation suite green |
| 2 | US-015 and US-022 | Lifecycle engine and alert evaluator integrated |
| 3 | US-012 and US-020 | People/lifecycle and connector/lifecycle prerequisites merged |
| 4 | US-013, US-016, US-017 | Request creation, decisions, and alert rules merged |
| 5 | Tasks 16–17 acceptance | Request → approval → checklist → active register → pool decrement → audit/email/alert evidence passes |

### Story-to-task coverage

| Story | Implementation tasks | Acceptance coverage |
|---|---|---|
| US-010 | Tasks 2, 4 | create/edit, confirmed company move, person assignment/activity/freshness record |
| US-014 | Task 3 | legal graph, atomic transition/audit, derivable SLA timestamps |
| US-033 | Task 7 | filtered register, source drilldown, filter-preserving CSV |
| US-042 | Tasks 2, 6, 15 | 10 rule seeds, 15-minute evaluator/email/dedupe, typed subject links |
| US-045 | Task 5 | connector port, protocol dispatch, core import guard |
| US-015 | Tasks 8, 13 | contextual queue, approve/reject record, notifications and group-admin override |
| US-022 | Tasks 9, 15 | pool equation, low-pool alert, explicit two-operation cross-org move |
| US-012 | Tasks 4, 10, 13 | scoped form/validations, budget warning, atomic request/transitions/email |
| US-020 | Tasks 5, 11, 12 | unsupported routing, checklist actions, later verification/exception |
| US-013 | Task 12 | scoped list/detail, complete timeline, blocked callout |
| US-016 | Task 13 | four lifecycle emails, bilingual sender/catalog rules, scoped deep links |
| US-017 | Task 14 | 24/48 business-hour evaluation, single-fire email/event, escalation setting |

### Branches

```text
feature/planning/sprint2-reconciliation
feature/org-registry/person-records
feature/request-workflow/lifecycle-engine
feature/register/register-surface
feature/alerts/alert-engine
feature/connectors/vendor-neutral-seam
feature/request-workflow/approval-queue
feature/vendor-catalog/pool-tracking
feature/request-workflow/request-intake
feature/request-workflow/orchestration-checklist
feature/request-workflow/request-surfaces
feature/notifications/lifecycle-email
feature/alerts/approval-aging
```

Each PR references exactly one `US-NNN` or the planning CHG. Merge from the latest integrated `main`; do not copy downstream code around an unmerged prerequisite.

## 3. Target file structure

```text
packages/
  connectors/
    package.json
    tsconfig.json
    src/index.ts
    src/contracts.ts
    src/dispatch.ts
    src/dispatch.test.ts
  notifications/
    package.json
    tsconfig.json
    src/{catalog,mailer}.ts
    src/locales/{en-US,es-EC}.json
  contracts/src/
    alerts.ts
    connectors.ts
    people.ts
    register.ts
    requests.ts
  db/src/
    schema.ts
    migrations/V20260727090000__sprint2_workflow_guards.sql
    sprint2-schema.integration.test.ts
  domain/src/
    alerts/{evaluate,types}.ts
    org-registry/person-move.ts
    request-workflow/{lifecycle,request-number}.ts
    vendor-catalog/pool-math.ts
apps/
  web/src/
    app/(authenticated)/
      personas/{page.tsx,[personId]/page.tsx}
      solicitudes/{page.tsx,nueva/page.tsx,[requestId]/page.tsx}
      aprobaciones/page.tsx
      registro/page.tsx
      cupos/page.tsx
      excepciones/page.tsx
    app/api/exports/register/route.ts
    components/
      alerts/alert-list.tsx
      people/{person-form,people-table}.tsx
      requests/{approval-queue,checklist-panel,request-form,request-record}.tsx
      register/{register-filters,register-table}.tsx
      pools/pool-cards.tsx
    lib/i18n/{en-US.json}
    messages/strings.es-EC.json
    modules/
      alerts/{evaluator,repository}.ts
      org-registry/{actions,repository}.ts
      register/{actions,repository}.ts
      request-workflow/{actions,repository,service}.ts
      vendor-catalog/pool-repository.ts
  worker/src/
    alerts/evaluate-alerts.ts
    jobs/deferred.ts
packages/ui/src/organisms/
  alert-list.tsx
  pool-gauge.tsx
  queue-card.tsx
  register-drilldown.tsx
  state-timeline.tsx
testing/critical-paths.md
docs/superpowers/plans/2026-07-27-sprint-2-orchestration-workflow.md
```

## 4. Cross-story contracts

### 4.1 Lifecycle graph

Create the single graph in `packages/domain/src/request-workflow/lifecycle.ts`:

```ts
export const REQUEST_TRANSITIONS = {
  submitted: ["pending_approval"],
  pending_approval: ["approved", "rejected"],
  approved: ["provisioning", "blocked_no_seat"],
  blocked_no_seat: ["provisioning", "rejected"],
  provisioning: ["invited", "active", "failed"],
  failed: ["provisioning"],
  invited: ["active", "deprovisioned"],
  active: ["flagged_inactive", "offboarding"],
  flagged_inactive: ["active", "offboarding"],
  offboarding: ["deprovisioned", "failed"],
  deprovisioned: [],
  rejected: [],
} as const;

export type RequestState = keyof typeof REQUEST_TRANSITIONS;

export type TransitionCommand = {
  requestId: string;
  from: RequestState;
  to: RequestState;
  actorUserId: string | null;
  note: string | null;
  occurredAt: Date;
};

export function assertLegalTransition(
  from: RequestState,
  to: RequestState,
): void {
  if (!(REQUEST_TRANSITIONS[from] as readonly RequestState[]).includes(to)) {
    throw new Error(`ILLEGAL_REQUEST_TRANSITION:${from}:${to}`);
  }
}
```

System imports continue to use the already-established `null → active` materialization seam; it is not a user-command transition.

### 4.2 Connector port

Define the vendor-neutral contract once in `packages/connectors/src/contracts.ts`:

```ts
export type ConnectorCapability =
  | "provision"
  | "deprovision"
  | "syncMembers"
  | "syncActivity"
  | "syncCost";

export type ConnectorResult<T> =
  | { ok: true; value: T; raw: unknown }
  | { ok: false; code: "unsupported"; checklistSteps: readonly string[] }
  | { ok: false; code: "provider_error"; retryable: boolean; raw: unknown };

export type ProvisionInput = {
  requestId: string;
  vendorAccountId: string;
  personEmail: string;
  licenseTypeName: string;
};
export type ProvisionResult = { vendorRef: string | null };
export type DeprovisionInput = ProvisionInput;
export type DeprovisionResult = { vendorRef: string | null };
export type SyncInput = { vendorAccountId: string; observedAt: Date };
export type MemberSnapshot = {
  members: readonly { email: string; active: boolean }[];
};
export type ActivitySnapshot = {
  records: readonly { email: string; activityDate: string; counters: unknown }[];
};
export type CostSnapshot = {
  records: readonly { email: string; costDate: string; amountUsd: string }[];
};

export interface VendorConnector {
  capabilities(): ReadonlySet<ConnectorCapability>;
  provision(input: ProvisionInput): Promise<ConnectorResult<ProvisionResult>>;
  deprovision(input: DeprovisionInput): Promise<ConnectorResult<DeprovisionResult>>;
  syncMembers(input: SyncInput): Promise<ConnectorResult<MemberSnapshot>>;
  syncActivity(input: SyncInput): Promise<ConnectorResult<ActivitySnapshot>>;
  syncCost(input: SyncInput): Promise<ConnectorResult<CostSnapshot>>;
}
```

The `none` connector returns `unsupported` with checklist steps for provision/deprovision and an empty unsupported result for sync methods. Core modules import `@smp/connectors`, never an Anthropic implementation.

### 4.3 Person and request inputs

Define shared Zod schemas in `packages/contracts`:

```ts
export const personInputSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  companyId: z.string().uuid(),
  status: z.enum(["active", "departed"]),
  confirmCompanyMove: z.boolean().default(false),
});

export const submitRequestSchema = z.object({
  requestFor: z.enum(["self", "on_behalf"]),
  personId: z.string().uuid().optional(),
  personEmail: z.string().trim().toLowerCase().email().optional(),
  personFullName: z.string().trim().min(1).max(200).optional(),
  companyId: z.string().uuid(),
  vendorAccountId: z.string().uuid(),
  licenseTypeId: z.string().uuid(),
  justification: z.string().trim().min(1).max(2_000),
  neededBy: z.string().date().optional(),
});

export const decideRequestSchema = z.discriminatedUnion("decision", [
  z.object({
    requestId: z.string().uuid(),
    decision: z.literal("approve"),
    comment: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    requestId: z.string().uuid(),
    decision: z.literal("reject"),
    comment: z.string().trim().min(1).max(2_000),
  }),
]);
```

### 4.4 Pool calculation

Keep pool math pure and property-tested:

```ts
export type PoolSnapshot = {
  purchased: number;
  assigned: number;
  pendingInvites: number;
};

export function calculatePool(snapshot: PoolSnapshot) {
  const free = snapshot.purchased - snapshot.assigned - snapshot.pendingInvites;
  return { ...snapshot, free };
}

export function isLowPool(
  snapshot: PoolSnapshot,
  lowPoolFloor: number,
): boolean {
  return calculatePool(snapshot).free < lowPoolFloor;
}
```

Do not clamp negative free capacity; a negative result is an operational discrepancy that must remain visible.

## Task 1: Reconcile Sprint 2 sources before feature code

**Files:**
- Do not hand-edit: `docs/stories/SPRINT_PLAN.md`
- Verify: `docs/specs/10_plan.md`
- Verify: `docs/stories/sprint-2/*.md`
- Append evidence: `.nous-feedback.jsonl`

- [ ] **Step 1: Open one Nous CHG for the planning/source defects**

Use this exact change description:

```text
Reconcile Ledger Sprint 2 planning outputs: hydrate 34 story points and canonical
blocked_by edges from Step 10/story artifacts; set current_sprint to the first
non-closed sprint after honoring sprint-level deferrals; canonicalize US-042 to
10 alert types; publish the US-014 lifecycle transition table; clarify US-020
attestation-now/verification-later semantics; add the AlertEvent dedupe-key
contract; add BR-08/BR-11/BR-14 to the generated effectiveness-critical set;
clear expired story claims.
```

Save the CHG ID returned by Nous for the later commit:

```bash
read -r SPRINT2_CHG_ID
export SPRINT2_CHG_ID
test -n "$SPRINT2_CHG_ID"
```

- [ ] **Step 2: Regenerate the developer package through Nous**

Run the configured Nous sync command documented by the local operator. Expected regenerated invariants:

```text
Sprint 2 total: 34 SP
US-033 blocked by: US-007
US-045 blocked by: US-003
US-022 blocked by: US-007, US-042
US-020 blocked by: US-014, US-045
current_sprint: sprint-2
```

- [ ] **Step 3: Add a mechanical consistency check**

Add a Nous-side generator test that compares every story’s `sprint`, `story_points`, and `blocked_by` values across the Step 10 artifact, story artifact, and rendered sprint queue. It must fail with a record such as:

```json
{
  "story": "US-045",
  "field": "blocked_by",
  "step10": ["US-003"],
  "story_file": ["US-003"],
  "sprint_plan": ["US-018", "US-003"]
}
```

- [ ] **Step 4: Record the US-054 deferral boundary**

Append a sprint-planning feedback event without marking US-054 done:

```jsonl
{"story":"SPRINT-2","event":"decision","id":"SPRINT2-US054-DEFERRAL","text":"US-054 real-key execution remains externally deferred; it gates Sprint 3 connector implementation, not Sprint 2 orchestration-mode delivery.","reason":"Sprint 2 has no concrete vendor API dependency; DEC-SMP-007 requires the manual path to ship independently."}
```

- [ ] **Step 5: Commit only regenerated artifacts and the plan**

```bash
test -n "$SPRINT2_CHG_ID"
git add docs .nous-feedback.jsonl
git commit -m "docs(${SPRINT2_CHG_ID}): reconcile Sprint 2 execution plan"
```

## Task 2: Prove the Sprint 2 database baseline

**Files:**
- Verify: `packages/db/src/schema.ts`
- Verify: `packages/db/src/migrations/*.sql`
- Modify later in this task: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/V20260727090000__sprint2_workflow_guards.sql`
- Create: `packages/db/src/sprint2-schema.integration.test.ts`

- [ ] **Step 1: Run the current owner/runtime parity gate**

```bash
pnpm --filter @smp/db db:migrate
pnpm --filter @smp/db db:verify
pnpm --filter @smp/db db:parity
```

Expected: all three commands exit 0 using `DATABASE_ADMIN_URL` as `ledger_owner` and `DATABASE_URL` as `ledger_app`.

- [ ] **Step 2: Write a failing real-PostgreSQL schema test**

Assert these missing guards:

```ts
expect(await enumValues(client, "alert_rule_type_enum")).toEqual(
  expect.arrayContaining(["deprovision_overdue", "close_missed"]),
);
await expect(insertPerson(client, { email: "USER@example.com" })).resolves.toBeDefined();
await expect(insertPerson(client, { email: "user@example.com" })).rejects.toMatchObject({
  code: "23505",
});
await expect(insertRequest(client, { requestNo: "SOL-0001" })).resolves.toBeDefined();
await expect(insertRequest(client, { requestNo: "SOL-0001" })).rejects.toMatchObject({
  code: "23505",
});
await expect(
  insertAlertEvent(client, { dedupeKey: "low_pool:va-1:2026-07-27T15:00Z" }),
).resolves.toBeDefined();
await expect(
  insertAlertEvent(client, { dedupeKey: "low_pool:va-1:2026-07-27T15:00Z" }),
).rejects.toMatchObject({ code: "23505" });
```

- [ ] **Step 3: Run the focused test and verify RED**

```bash
pnpm --filter @smp/db test -- sprint2-schema.integration.test.ts
```

Expected: failure because the enum values and unique indexes do not exist.

- [ ] **Step 4: Append the migration**

Use a new timestamped migration:

```sql
ALTER TYPE alert_rule_type_enum ADD VALUE IF NOT EXISTS 'deprovision_overdue';
ALTER TYPE alert_rule_type_enum ADD VALUE IF NOT EXISTS 'close_missed';

ALTER TABLE alert_event
  ADD COLUMN dedupe_key text;

CREATE UNIQUE INDEX uq_alert_event_dedupe_key
  ON alert_event (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX uq_person_lower_email
  ON person (lower(email));
```

Mirror the enum, `alertEvent.dedupeKey`, and indexes in `schema.ts`; do not
modify an existing migration. New code always supplies a dedupe key; nullable
storage preserves compatibility with any pre-Sprint-2 rows. Mark
`licenseRequest.requestNo` unique in Drizzle so it reflects the existing
`uq_license_request_request_no` constraint; do not create a duplicate index.

- [ ] **Step 5: Run focused and parity gates**

```bash
pnpm --filter @smp/db test -- sprint2-schema.integration.test.ts
pnpm --filter @smp/db db:migrate
pnpm --filter @smp/db db:verify
pnpm --filter @smp/db db:parity
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "fix(US-042): add Sprint 2 workflow database guards"
```

## Task 3: Implement US-014 lifecycle engine

**Files:**
- Create: `packages/domain/src/request-workflow/lifecycle.ts`
- Create: `packages/domain/src/request-workflow/lifecycle.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/web/src/modules/request-workflow/service.ts`
- Create: `apps/web/src/modules/request-workflow/service.integration.test.ts`
- Verify after Nous regeneration: `testing/critical-paths.md`
- Modify: `stryker.conf.json`

- [ ] **Step 1: Write exact graph tests**

Use table-driven assertions for every allowed edge and representative illegal edges:

```ts
it.each([
  ["submitted", "pending_approval"],
  ["pending_approval", "approved"],
  ["pending_approval", "rejected"],
  ["provisioning", "failed"],
  ["failed", "provisioning"],
  ["active", "offboarding"],
  ["offboarding", "deprovisioned"],
] as const)("allows %s → %s", (from, to) => {
  expect(() => assertLegalTransition(from, to)).not.toThrow();
});

it.each([
  ["pending_approval", "active"],
  ["rejected", "approved"],
  ["deprovisioned", "active"],
] as const)("rejects %s → %s", (from, to) => {
  expect(() => assertLegalTransition(from, to)).toThrow(
    `ILLEGAL_REQUEST_TRANSITION:${from}:${to}`,
  );
});
```

- [ ] **Step 2: Run the domain test and verify RED**

```bash
pnpm --filter @smp/domain test -- lifecycle.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the graph from §4.1**

Copy the exact `REQUEST_TRANSITIONS`, `RequestState`, `TransitionCommand`, and `assertLegalTransition` definitions from §4.1 and export them through `packages/domain/src/index.ts`.

- [ ] **Step 4: Write the real-DB transition service test**

Against Testcontainers PostgreSQL, assert one call:

```ts
await transitionRequest(database, {
  requestId,
  from: "pending_approval",
  to: "approved",
  actorUserId,
  note: "approved in queue",
  occurredAt,
});

expect(await readRequestState(database, requestId)).toBe("approved");
expect(await readTransitions(database, requestId)).toEqual([
  expect.objectContaining({
    fromState: "pending_approval",
    toState: "approved",
    actorUserId,
    occurredAt,
  }),
]);
expect(await readAudit(database, requestId)).toEqual([
  expect.objectContaining({ action: "request.approved", companyId }),
]);
```

Also assert rollback when the current database state differs from `from`, and isolation when the caller lacks the request’s `company_id`.

- [ ] **Step 5: Implement one transaction-bound service**

`transitionRequest` must lock the request row, re-read the state, call `assertLegalTransition`, update `license_request`, insert `request_transition`, and return an audit record through `withAudit`. It must not expose a raw state update helper.

- [ ] **Step 6: Run tests and mutation gate**

Add `packages/domain/src/request-workflow/lifecycle.ts` to the root Stryker
`mutate` list; the regenerated critical-path catalog must continue to name
BR-04/US-014.

```bash
pnpm --filter @smp/domain test -- lifecycle.test.ts
pnpm --filter smp-web test -- service.integration.test.ts
pnpm test:mutation:core
```

Expected: tests pass; changed BR-04 mutants meet the ≥80% gate.

- [ ] **Step 7: Commit**

```bash
git add packages/domain apps/web/src/modules/request-workflow stryker.conf.json
git commit -m "feat(US-014): enforce request lifecycle transitions"
```

## Task 4: Implement US-010 person records

**Files:**
- Create: `packages/contracts/src/people.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/modules/org-registry/repository.ts`
- Create: `apps/web/src/modules/org-registry/repository.integration.test.ts`
- Create: `apps/web/src/modules/org-registry/actions/people.ts`
- Create: `apps/web/src/components/people/person-form.tsx`
- Create: `apps/web/src/components/people/people-table.tsx`
- Modify: `apps/web/src/app/(authenticated)/personas/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/personas/[personId]/page.tsx`

- [ ] **Step 1: Write contracts and repository tests**

Assert normalized email uniqueness, group-admin-only writes, authorized-company reads, and an atomic company move:

```ts
const moved = await repository.updatePerson({
  actorUserId,
  id: personId,
  companyId: newCompanyId,
  confirmCompanyMove: true,
  email: "person@example.com",
  fullName: "Person Example",
  status: "active",
  occurredOn: "2026-07-27",
});

expect(moved.closedAssignments).toEqual([
  expect.objectContaining({
    endedOn: "2026-07-26",
    endReason: "reallocated",
  }),
]);
expect(moved.createdSuccessors).toEqual([
  expect.objectContaining({
    companyId: newCompanyId,
    startedOn: "2026-07-27",
    sourceKind: "request",
    sourceRequestId: moved.fastTrackRequestId,
  }),
]);
expect(moved.reRequestHref).toBe(
  `/solicitudes/${moved.fastTrackRequestId}`,
);
```

Reject a company move with open assignments when `confirmCompanyMove` is
false. When confirmed, close and replace each open assignment in the same
transaction so the existing deferred `reallocated` contiguity trigger passes.
Create one system-materialized active request (`null → active`, justification
`cambio de compañía`) as the successor assignment’s request anchor and return
its detail URL.
Prove a company-scoped user cannot read or mutate another company’s person.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @smp/contracts test -- people
pnpm --filter smp-web test -- repository.integration.test.ts
```

Expected: missing modules.

- [ ] **Step 3: Implement contracts, repository, and audited actions**

Use `personInputSchema` from §4.3. `createPerson` and `updatePerson` authenticate, require `admin:manage`, validate before DB access, and call repository methods that use `withAudit`.

- [ ] **Step 4: Replace both page scaffolds**

Implement Server Component reads and client forms matching every TOON `data-testid` in `SCR-people.json` and `SCR-person-detail.json`. Include loading, empty, error, edit, company-move warning, assignment history, activity history, and freshness states. Never embed fixture rows.

- [ ] **Step 5: Add focused UI behavior tests**

Assert the exact company-move confirmation copy, the disabled save state before confirmation, and the returned fast-track request link. These tests must constrain behavior, not snapshot the whole page.

- [ ] **Step 6: Run gates and commit**

```bash
pnpm --filter @smp/contracts test
pnpm --filter smp-web test -- org-registry
pnpm type-check
pnpm lint
git add packages/contracts apps/web/src/modules/org-registry apps/web/src/components/people apps/web/src/app
git commit -m "feat(US-010): add tenant-safe person records"
```

## Task 5: Implement US-045 connector interface

**Files:**
- Create: `packages/connectors/package.json`
- Create: `packages/connectors/tsconfig.json`
- Create: `packages/connectors/src/contracts.ts`
- Create: `packages/connectors/src/dispatch.ts`
- Create: `packages/connectors/src/dispatch.test.ts`
- Create: `packages/connectors/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/config/eslint-preset.mjs`

- [ ] **Step 1: Write dispatch tests**

```ts
expect(dispatcher.forProtocol("none").capabilities()).toEqual(new Set());
await expect(
  dispatcher.forProtocol("none").provision(provisionInput),
).resolves.toEqual({
  ok: false,
  code: "unsupported",
  checklistSteps: [
    "Open the vendor administration console",
    "Invite person@example.com",
    "Assign Standard",
    "Return to Ledger and confirm execution",
  ],
});
```

Add cases for `rest` and `scim` registration, and a source-boundary test that fails when `request-workflow`, `register`, or `telemetry` imports an Anthropic-specific path.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @smp/connectors test
```

Expected: workspace/package missing.

- [ ] **Step 3: Implement the port and dispatcher**

Copy the interface from §4.2. Register only the `none` connector in Sprint 2; expose registration seams for Sprint 3 without adding a fake Anthropic client.

- [ ] **Step 4: Add the lint boundary**

The rule must allow core imports from `@smp/connectors` and reject imports matching `anthropic`, `claude`, or `providers/anthropic` outside the future connector package and probe harness.

- [ ] **Step 5: Run gates and commit**

```bash
pnpm install
pnpm --filter @smp/connectors test
pnpm type-check
pnpm lint
git add packages/connectors packages/config pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(US-045): add vendor-neutral connector seam"
```

## Task 6: Implement US-042 alert engine

**Files:**
- Create: `packages/contracts/src/alerts.ts`
- Create: `packages/domain/src/alerts/types.ts`
- Create: `packages/domain/src/alerts/evaluate.ts`
- Create: `packages/domain/src/alerts/evaluate.test.ts`
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/tsconfig.json`
- Create: `packages/notifications/src/catalog.ts`
- Create: `packages/notifications/src/mailer.ts`
- Create: `packages/notifications/src/locales/en-US.json`
- Create: `packages/notifications/src/locales/es-EC.json`
- Create: `apps/web/src/modules/alerts/repository.ts`
- Create: `apps/web/src/modules/alerts/repository.integration.test.ts`
- Create: `apps/worker/src/alerts/evaluate-alerts.ts`
- Modify: `apps/worker/src/jobs/deferred.ts`
- Create: `packages/db/src/migrations/V20260727090001__seed_sprint2_alert_rules.sql`
- Modify: `stryker.conf.json`

- [ ] **Step 1: Write pure evaluator tests**

Given facts and a rule, assert exact events:

```ts
expect(
  evaluateAlertRule(
    { type: "low_pool", threshold: { floor: 2 }, enabled: true },
    { subject: { vendorAccountId: "va-1" }, free: 1 },
    new Date("2026-07-27T15:00:00Z"),
  ),
).toEqual({
  dedupeKey: "low_pool:va-1:2026-07-27T15:00:00.000Z",
  subjectRef: { vendorAccountId: "va-1" },
  type: "low_pool",
});
```

Assert disabled rules emit nothing and identical inputs generate the same dedupe key.

- [ ] **Step 2: Write real-DB dedupe and scoping tests**

Run two concurrent evaluations for the same rule/subject/window and assert exactly one `alert_event`. Join through `alert_rule.company_id` when reading company alerts and prove company A cannot see company B.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @smp/domain test -- alerts
pnpm --filter smp-web test -- alerts
```

- [ ] **Step 4: Implement evaluator, repository, and seed**

Seed all 10 types idempotently. Use deterministic threshold JSON and the
existing system actor. Insert the deterministic key into
`AlertEvent.dedupeKey` and treat PostgreSQL unique violation `23505` as an
idempotent replay; never use an in-memory Set.

- [ ] **Step 5: Implement the shared SMTP adapter**

Create `@smp/notifications` as the only SMTP transport. Its input is already
rendered content:

```ts
export type NotificationMessage = {
  from: string;
  to: readonly string[];
  subject: string;
  text: string;
  html: string;
};

export interface NotificationMailer {
  send(message: NotificationMessage): Promise<{
    providerMessageId: string;
    accepted: readonly string[];
  }>;
}
```

The package owns bilingual JSON catalogs for alert and lifecycle templates.
Task 13 extends those catalogs; the worker and web app do not duplicate copy or
SMTP configuration.

- [ ] **Step 6: Wire the existing alert-evaluation job**

Replace the deferred placeholder with a handler that loads enabled rules, gathers facts, creates events, sends email through the notification adapter, and records the notification result in `AlertEvent.notified`. A per-rule failure returns a structured failed `JobResult` and flows through the existing job-failure reporter.

- [ ] **Step 7: Run real integration and mutation gates**

Add `packages/domain/src/alerts/evaluate.ts` to the root Stryker `mutate` list.

```bash
pnpm --filter @smp/domain test -- alerts
pnpm --filter @smp/notifications test
pnpm --filter smp-web test -- alerts
pnpm --filter @smp/worker test -- alerts
pnpm test:mutation:core
```

- [ ] **Step 8: Commit**

```bash
git add packages apps/web/src/modules/alerts apps/worker/src stryker.conf.json
git commit -m "feat(US-042): add deterministic alert evaluation"
```

## Task 7: Implement US-033 register surface and export

**Files:**
- Create: `packages/contracts/src/register.ts`
- Create: `apps/web/src/modules/register/repository.ts`
- Create: `apps/web/src/modules/register/repository.integration.test.ts`
- Create: `apps/web/src/modules/register/actions.ts`
- Create: `apps/web/src/app/api/exports/register/route.ts`
- Create: `apps/web/src/components/register/register-filters.tsx`
- Create: `apps/web/src/components/register/register-table.tsx`
- Modify: `apps/web/src/app/(authenticated)/registro/page.tsx`
- Modify: `packages/ui/src/organisms/register-drilldown.tsx`

- [ ] **Step 1: Write tenant/filter/export integration tests**

Insert assignments for two companies and assert:

```ts
expect(await listRegisterRows(authForCompanyA, filters)).toEqual([
  expect.objectContaining({
    companyId: companyA,
    sourceRequestNo: "SOL-1001",
  }),
]);
expect(await listRegisterRows(authForCompanyA, filters)).not.toEqual(
  expect.arrayContaining([expect.objectContaining({ companyId: companyB })]),
);
```

Use the same parsed filter object for the list and CSV export, and assert RFC 4180 escaping for commas, quotes, and newlines.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter smp-web test -- register/repository.integration.test.ts
```

- [ ] **Step 3: Implement repository and export**

The repository joins person, company, vendor account, license type, source request, and statement-line trace data. `exportRegisterCsv` is marked `@read-only-action` and returns:

```ts
return {
  downloadUrl: `/api/exports/register?${serializeRegisterFilters(parsed)}`,
};
```

The route handler repeats session authorization and streams only authorized rows.

- [ ] **Step 4: Replace the register scaffold**

Match `SCR-register.json`: filters, open/closed rows, end-reason chips, source links, import/reconciliation notes, row drilldown, loading/error/empty states, and DB-integrity banner. Reuse `DataTable` and finish `RegisterDrilldown`.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter smp-web test -- register
pnpm type-check
pnpm lint
git add packages/contracts apps/web/src/modules/register apps/web/src/components/register apps/web/src/app packages/ui
git commit -m "feat(US-033): add scoped register and CSV export"
```

## Task 8: Implement US-015 approval queue

**Files:**
- Create: `packages/domain/src/request-workflow/business-time.ts`
- Create: `packages/domain/src/request-workflow/business-time.test.ts`
- Create: `apps/web/src/modules/request-workflow/actions/decide-request.ts`
- Create: `apps/web/src/modules/request-workflow/approval-repository.ts`
- Create: `apps/web/src/modules/request-workflow/approval-repository.integration.test.ts`
- Create: `apps/web/src/components/requests/approval-queue.tsx`
- Modify: `apps/web/src/app/(authenticated)/aprobaciones/page.tsx`
- Modify: `packages/ui/src/organisms/queue-card.tsx`

- [ ] **Step 1: Write authorization and decision tests**

Assert an approver sees and decides only granted companies, while `group_admin` sees all companies. Reject an empty rejection comment and a stale concurrent decision. Assert `decided_by`, `decided_at`, `decision_comment`, transition, and audit are in one transaction.

- [ ] **Step 2: Write deterministic business-aging tests**

Inject the Ecuador calendar and clock:

```ts
expect(
  businessDaysPending(
    new Date("2026-07-24T15:00:00Z"),
    new Date("2026-07-28T15:00:00Z"),
    ecuadorCalendar,
  ),
).toBe(2);
```

The breach chip activates only after the configured two-business-day decision target.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter smp-web test -- approval
```

- [ ] **Step 4: Implement `decideRequest` through the lifecycle service**

Implement `businessHoursPending` in the domain package. It counts elapsed
calendar hours whose UTC date is a weekday and not in the injected Ecuador
holiday set, so 24 units equal one business day and 48 equal two:

```ts
export function businessHoursPending(
  since: Date,
  now: Date,
  calendar: EcuadorBusinessCalendar,
): number {
  let hours = 0;
  for (
    let cursor = new Date(since);
    cursor < now;
    cursor = new Date(cursor.getTime() + 60 * 60 * 1_000)
  ) {
    if (isEcuadorBusinessDate(cursor, calendar)) hours += 1;
  }
  return hours;
}

function isEcuadorBusinessDate(
  value: Date,
  calendar: EcuadorBusinessCalendar,
): boolean {
  const weekday = value.getUTCDay();
  const isoDate = value.toISOString().slice(0, 10);
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.has(isoDate);
}
```

Parse `decideRequestSchema`, authorize `request:approve` for the request’s real company, and transition `pending_approval → approved|rejected`. Never update state directly.

- [ ] **Step 5: Finish QueueCard and page**

Implement all TOON fields and `data-testid`s, inline approve, mandatory-comment reject modal, missing-rate `sin tarifa`, budget headroom, and deterministic aging chip. Do not optimistically show success before the Server Action returns.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter smp-web test -- approval
pnpm type-check
pnpm lint
git add apps/web/src/modules/request-workflow apps/web/src/components/requests apps/web/src/app packages/ui
git commit -m "feat(US-015): add scoped one-minute approval queue"
```

## Task 9: Implement US-022 pool tracking

**Files:**
- Create: `packages/domain/src/vendor-catalog/pool-math.ts`
- Create: `packages/domain/src/vendor-catalog/pool-math.test.ts`
- Create: `apps/web/src/modules/vendor-catalog/pool-repository.ts`
- Create: `apps/web/src/modules/vendor-catalog/pool-repository.integration.test.ts`
- Create: `apps/web/src/components/pools/pool-cards.tsx`
- Modify: `apps/web/src/app/(authenticated)/cupos/page.tsx`
- Modify: `packages/ui/src/organisms/pool-gauge.tsx`
- Modify: `stryker.conf.json`

- [ ] **Step 1: Write property-based pool tests**

```ts
fc.assert(
  fc.property(
    fc.nat(),
    fc.nat(),
    fc.nat(),
    (purchased, assigned, pendingInvites) => {
      expect(calculatePool({ purchased, assigned, pendingInvites }).free)
        .toBe(purchased - assigned - pendingInvites);
    },
  ),
);
```

Add a metamorphic property: increasing purchased capacity by `k` increases free capacity by exactly `k`.

- [ ] **Step 2: Write real-DB latest-capacity tests**

For each `(vendor_account_id, license_type_id)`, select the latest effective capacity at the injected date, count open assignments, and count pending/sent automated invite actions. Orchestration checklist actions are not pending invites.

- [ ] **Step 3: Implement low-pool event integration**

Pass the snapshot to US-042’s evaluator. Assert below-floor creates/deduplicates `low_pool`, and equal-to-floor is not low because the rule is strictly “below”.

- [ ] **Step 4: Prove cross-organization moves are two operations**

Given a move between vendor accounts, assert the command projection contains a
source close and a destination open:

```ts
export function planCrossOrgMove(input: {
  sourceVendorAccountId: string;
  targetVendorAccountId: string;
}) {
  if (input.sourceVendorAccountId === input.targetVendorAccountId) {
    throw new Error("CROSS_ORG_MOVE_REQUIRES_DISTINCT_ACCOUNTS");
  }
  return [
    { operation: "deprovision", vendorAccountId: input.sourceVendorAccountId },
    { operation: "provision", vendorAccountId: input.targetVendorAccountId },
  ] as const;
}

expect(planCrossOrgMove(input)).toEqual([
  { operation: "deprovision", vendorAccountId: sourceVendorAccountId },
  { operation: "provision", vendorAccountId: targetVendorAccountId },
]);
```

Reject a single-row mutation that changes `vendor_account_id` in place.

- [ ] **Step 5: Finish PoolGauge and page**

Render purchased, assigned, pending, free, negative discrepancies, low-pool attention state, and separate cross-org move operations. Match `SCR-pools.json` IDs and states.

- [ ] **Step 6: Run mutation and commit**

Add `packages/domain/src/vendor-catalog/pool-math.ts` to the root Stryker
`mutate` list before running the gate.

```bash
pnpm --filter @smp/domain test -- pool-math
pnpm --filter smp-web test -- pool
pnpm test:mutation:core
git add packages/domain apps/web/src/modules/vendor-catalog apps/web/src/components/pools apps/web/src/app packages/ui stryker.conf.json
git commit -m "feat(US-022): add per-organization pool tracking"
```

## Task 10: Implement US-012 request intake

**Files:**
- Create: `packages/contracts/src/requests.ts`
- Create: `apps/web/src/modules/request-workflow/repository.ts`
- Create: `apps/web/src/modules/request-workflow/repository.integration.test.ts`
- Create: `apps/web/src/modules/request-workflow/actions/submit-request.ts`
- Create: `apps/web/src/components/requests/request-form.tsx`
- Modify: `apps/web/src/app/(authenticated)/solicitudes/nueva/page.tsx`

- [ ] **Step 1: Write validation and transaction tests**

Assert:

- self requests derive the person/company from the session’s Ledger account;
- on-behalf requests require approver or group-admin authority;
- inactive companies and inactive vendor/license types reject;
- an open assignment for the same person/account/type blocks with its assignment URL;
- unknown domains warn but do not block;
- a missing RateCard returns `sin tarifa` and no budget warning;
- a new email atomically creates Person, LicenseRequest, and initial transitions.

Use concurrent submissions to prove the lowercased person-email and request-number guards prevent duplicates.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter smp-web test -- request-workflow/repository.integration.test.ts
```

- [ ] **Step 3: Implement deterministic request numbers**

Allocate `SOL-NNNN` under a transaction/advisory lock:

```ts
const requestNo = `SOL-${String(nextSequence).padStart(4, "0")}`;
```

Do not use `count(*) + 1`.

- [ ] **Step 4: Implement `submitRequest`**

Parse `submitRequestSchema`, authorize `request:create`, create/reuse the person, insert the request, and call lifecycle transitions `submitted → pending_approval`. Return:

```ts
return {
  requestId,
  redirectTo: `/solicitudes/${requestId}`,
  warnings,
};
```

- [ ] **Step 5: Replace request-form scaffold**

Match `SCR-new-request.json`, including role-dependent self/on-behalf fields, duplicate assignment link, domain warning, inactive-company error, budget/no-rate message, loading/error/success states, and all `data-testid`s.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @smp/contracts test
pnpm --filter smp-web test -- request-workflow
pnpm type-check
pnpm lint
git add packages/contracts apps/web/src/modules/request-workflow apps/web/src/components/requests apps/web/src/app
git commit -m "feat(US-012): add validated license request intake"
```

## Task 11: Implement US-020 orchestration checklist

**Files:**
- Create: `apps/web/src/modules/request-workflow/actions/checklist.ts`
- Create: `apps/web/src/modules/request-workflow/orchestration.ts`
- Create: `apps/web/src/modules/request-workflow/orchestration.integration.test.ts`
- Create: `apps/web/src/components/requests/checklist-panel.tsx`
- Modify: `apps/web/src/app/(authenticated)/solicitudes/[requestId]/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`

- [ ] **Step 1: Write unsupported-capability routing tests**

For a `Vendor.provisioning_protocol = none` account, approval must create exactly one:

```ts
expect(action).toMatchObject({
  kind: "checklist",
  mode: "orchestration",
  status: "pending",
  rawRequest: {
    checklistSteps: expect.arrayContaining([
      "Invite person@example.com",
    ]),
  },
});
```

The request transitions `approved → provisioning`; no Anthropic module is imported.

- [ ] **Step 2: Write confirmation transaction tests**

`confirmChecklistDone` requires `group_admin`, locks the action/request, marks the action confirmed, creates the non-overlapping assignment, links it to the request, transitions to active, and audits the attestation. A repeat call is idempotent. `markChecklistNotDone` marks failed with a mandatory reason and transitions through the engine.

- [ ] **Step 3: Write later-verification tests**

Expose:

```ts
verifyChecklistObservation({
  actionId,
  observedAssigned: false,
  observedAt,
  source: "member_sync",
});
```

A mismatch changes only the action to `verification_failed`, writes audit/alert evidence, and surfaces the exception; it does not silently remove the active register row. A matching observation records `resolvedAt`.

- [ ] **Step 4: Implement checklist actions and panel**

Render steps only from validated `rawRequest.checklistSteps`. Match `checklist_pending`, `btn_confirm_checklist`, and `btn_checklist_not_done` from `SCR-request-detail.json`.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter smp-web test -- orchestration
pnpm type-check
pnpm lint
git add apps/web/src/modules/request-workflow apps/web/src/components/requests apps/web/src/app
git commit -m "feat(US-020): add orchestration checklist execution"
```

## Task 12: Implement US-013 request list and record

**Files:**
- Create: `apps/web/src/modules/request-workflow/read-repository.ts`
- Create: `apps/web/src/modules/request-workflow/read-repository.integration.test.ts`
- Create: `apps/web/src/components/requests/request-record.tsx`
- Modify: `apps/web/src/app/(authenticated)/solicitudes/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/solicitudes/[requestId]/page.tsx`
- Modify: `packages/ui/src/organisms/state-timeline.tsx`

- [ ] **Step 1: Write scoped read tests**

Employees see requests linked to their `UserAccount.person_id`; approvers see granted companies; group admins see all. A direct URL for an unauthorized company returns not found/forbidden without leaking request existence.

- [ ] **Step 2: Write request-record projection tests**

Assert every transition renders in `occurred_at` order with actor/note, current-state age derives from the latest transition using an injected clock, and blocked/failed/checklist/assignment/audit sections appear only under their documented conditions.

- [ ] **Step 3: Implement repository and StateTimeline**

Return a typed projection rather than a large raw joined row. Finish `StateTimeline` with explicit props:

```ts
export interface StateTimelineProps {
  items: readonly {
    id: string;
    from: string | null;
    to: string;
    actor: string;
    note: string | null;
    occurredAt: string;
  }[];
}
```

- [ ] **Step 4: Replace both request scaffolds**

Implement all list/detail TOON sections, 12-state chips, loading/error/empty states, blocked “Ver cupos” action for group admin, and the request detail tabs.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter smp-web test -- request-workflow/read
pnpm --filter @smp/ui test -- state-timeline
pnpm type-check
pnpm lint
git add apps/web/src/modules/request-workflow apps/web/src/components/requests apps/web/src/app packages/ui
git commit -m "feat(US-013): add scoped request history surfaces"
```

## Task 13: Implement US-016 lifecycle notifications

**Files:**
- Modify: `packages/notifications/src/catalog.ts`
- Create: `packages/notifications/src/catalog.test.ts`
- Modify: `packages/notifications/src/locales/en-US.json`
- Modify: `packages/notifications/src/locales/es-EC.json`
- Create: `packages/notifications/src/mailer.integration.test.ts`
- Modify: `apps/web/src/lib/i18n/en-US.json`
- Modify: `apps/web/src/messages/strings.es-EC.json`
- Modify: `apps/web/src/modules/request-workflow/service.ts`

- [ ] **Step 1: Write catalog tests**

For `es`, `en`, and null locale, render submission, new-request-to-approver, decision, and provisioning-complete messages. Assert fallback is Spanish, links use the configured public origin, and the 12-state vocabulary comes from the shared catalogs.

- [ ] **Step 2: Write SMTP boundary integration**

Use the real Compose Mailpit SMTP service, not a mock. Submit one message through
`@smp/notifications` and assert sender, recipient, subject, locale-specific body,
and scoped deep link through Mailpit’s test API.

- [ ] **Step 3: Implement mailer**

The web adapter reads `notif_sender_email` from `SystemSetting` and passes it to
the shared mailer; never accept a sender from the request. Sanitize template
inputs and do not include raw connector payloads.

- [ ] **Step 4: Wire lifecycle hooks**

After the transaction commits:

- request pending approval → confirmation to requester and new-request to approvers;
- approved/rejected → decision to requester;
- active → getting-started message.

Record delivery success/failure as structured audit/alert evidence. A failed SMTP send must not roll back a committed business transition.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter smp-web test -- notifications
pnpm --filter @smp/notifications test
pnpm type-check
pnpm lint
git add packages/notifications apps/web/src/modules/request-workflow apps/web/src/lib/i18n apps/web/src/messages
git commit -m "feat(US-016): send bilingual lifecycle notifications"
```

## Task 14: Implement US-017 approval aging

**Files:**
- Create: `packages/domain/src/alerts/approval-aging.ts`
- Create: `packages/domain/src/alerts/approval-aging.test.ts`
- Modify: `apps/worker/src/alerts/evaluate-alerts.ts`
- Create: `apps/worker/src/alerts/approval-aging.integration.test.ts`
- Modify: `stryker.conf.json`

- [ ] **Step 1: Write deterministic threshold tests**

Use the existing Ecuador business calendar and injected clock. Assert the first run at or after 24 business hours emits the reminder, the first run at or after 48 business hours emits escalation, and later runs emit neither again for the same breach.

- [ ] **Step 2: Write real-DB job tests**

Create one pending request, run two worker instances concurrently, and assert exactly one reminder and one escalation event/email. The escalation reads `notif_escalation_email` and names request, company, and approver.

- [ ] **Step 3: Implement evaluator**

Represent thresholds explicitly:

```ts
type ApprovalAgingThreshold = {
  reminderBusinessHours: 24;
  escalationBusinessHours: 48;
};
```

Use persisted alert-event dedupe keys; do not derive “already sent” from logs or process memory.

- [ ] **Step 4: Run mutation and commit**

Add `packages/domain/src/alerts/approval-aging.ts` to the root Stryker `mutate`
list before running the gate.

```bash
pnpm --filter @smp/domain test -- approval-aging
pnpm --filter @smp/worker test -- approval-aging
pnpm test:mutation:core
git add packages/domain apps/worker/src stryker.conf.json
git commit -m "feat(US-017): add approval reminder and escalation"
```

## Task 15: Complete US-042/022 operational surfaces

**Files:**
- Create: `apps/web/src/components/alerts/alert-list.tsx`
- Modify: `apps/web/src/app/(authenticated)/alertas/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/excepciones/page.tsx`
- Modify: `packages/ui/src/organisms/alert-list.tsx`

- [ ] **Step 1: Write alert-list behavior tests**

Assert subject links dispatch by type, unacknowledged/all filters work, and unauthorized alert scopes never render.

- [ ] **Step 2: Implement read repository and surfaces**

Finish the alerts organism and render the Sprint 2-supported exception tabs: blocked requests and checklist verification failures. Keep drift and expired-invite tabs as honest empty states until their Sprint 3 writers exist.

- [ ] **Step 3: Verify TOON IDs and i18n**

Every section/action has its TOON `data-testid`; all strings come from locale catalogs.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @smp/ui test -- alert-list
pnpm --filter smp-web test -- alerts
pnpm type-check
pnpm lint
git add apps/web/src packages/ui
git commit -m "feat(US-042): add alert and exception surfaces"
```

## Task 16: Run per-story adversarial acceptance

**Files:**
- Append: `.nous-feedback.jsonl`

- [ ] **Step 1: Verify every AC separately**

For each story, append one `ac_verify` per AC. Use real negative cases:

```jsonl
{"story":"US-014","event":"ac_verify","ac":1,"method":"table-driven legal graph plus illegal direct-transition mutation","pass":true,"notes":"All declared edges pass; pending_approval→active and terminal-state exits are rejected."}
```

- [ ] **Step 2: Run API/navigation reconciliation**

```bash
python3 docs/scripts/nous_api_reconcile.py
pnpm validate:routes
pnpm validate:sidebar
```

Expected: no raw fetch, missing route, or generated-sidebar drift.

- [ ] **Step 3: Run the complete root and database gates**

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
pnpm --filter @smp/db db:migrate
pnpm --filter @smp/db db:verify
pnpm --filter @smp/db db:parity
pnpm test:mutation
```

Expected: all pass; changed critical paths meet the mutation threshold.

- [ ] **Step 4: Append build and done events story by story**

Only after that story’s AC events exist:

```jsonl
{"story":"US-010","event":"build_pass","notes":"type-check, lint, test, build, migration verification, and applicable mutation gate passed"}
{"story":"US-010","event":"done"}
```

- [ ] **Step 5: Commit**

```bash
git add .nous-feedback.jsonl
git commit -m "test(SPRINT-2): record adversarial acceptance evidence"
```

## Task 17: Prove the orchestration milestone end to end

**Files:**
- Create: `apps/web/e2e/sprint2-orchestration.spec.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the black-box journey**

Against the real Compose stack:

```ts
test("request → approval → checklist → register → pool", async ({ page }) => {
  await submitRequest(page, employee);
  await approveRequest(page, approver);
  await confirmChecklist(page, groupAdmin);
  await expectRequestState(page, "active");
  await expectRegisterAssignment(page, employee.email);
  await expectPoolDelta(page, -1);
  await expectAuditActions(page, [
    "request.created",
    "request.approved",
    "checklist.confirmed",
    "assignment.created",
  ]);
});
```

The helpers log in through Keycloak test users and navigate only through public routes; they do not call owned internals directly.

- [ ] **Step 2: Add negative journeys**

Prove an employee cannot approve, an approver cannot cross company scope, duplicate submission links to the existing assignment, rejection requires a comment, and a later verification mismatch surfaces without erasing the assignment.

- [ ] **Step 3: Run in Compose**

```bash
docker compose --project-name ledger-sprint2 --env-file .env.example -f infra/docker-compose.yml up --build --wait
pnpm exec playwright test apps/web/e2e/sprint2-orchestration.spec.ts
docker compose --project-name ledger-sprint2 --env-file .env.example -f infra/docker-compose.yml down --volumes --remove-orphans
```

Expected: all journey and negative tests pass; cleanup removes the isolated project.

- [ ] **Step 4: Add the bounded E2E job to CI and commit**

```bash
git add apps/web/e2e .github/workflows/ci.yml
git commit -m "test(SPRINT-2): verify orchestration workflow end to end"
```

## 5. Sprint 2 acceptance checklist

- [ ] The regenerated queue says Sprint 2, 34 SP, and has no Sprint 3 blockers.
- [ ] US-054 is visibly deferred, with no false `done`.
- [ ] Every query uses Ledger authorization and real `company_id`.
- [ ] Every mutation validates Zod input and uses `withAudit`.
- [ ] Every request state change goes through the lifecycle engine.
- [ ] The connector-free checklist path reaches an active register row.
- [ ] Later verification mismatch is visible and does not silently erase truth.
- [ ] Pool calculations remain exact, including negative discrepancies.
- [ ] All 10 alert types exist in schema, seed, evaluator, and catalogs.
- [ ] Lifecycle and escalation email uses `SystemSetting` sender/target values.
- [ ] All screens replace scaffolds and implement loading/error/empty states.
- [ ] All user-facing strings are bilingual catalog entries.
- [ ] Tenant isolation, authorization, BR-04, and pool math meet mutation gates.
- [ ] Root gates, route/sidebar checks, database parity, and Compose E2E pass.
- [ ] Every AC has adversarial evidence before `done`.

## 6. Feedback package for retrofitting the Nous substrate

The following items belong in Nous, not as hand edits to generated project guidance.

### P0 — Sprint-plan integrity

1. **Canonical field ownership**
   - Store `story_points`, `sprint`, `blocked_by`, `status`, and claim/assignee as structured story fields.
   - Step 10, story Markdown, INDEX, assignments, and SPRINT_PLAN must render from those fields.
   - Never reconstruct dependencies from prose or stale graph edges.

2. **Cross-artifact consistency gate**
   - Fail package generation when Step 10, story files, and SPRINT_PLAN disagree.
   - Validate that the rendered order is topological.
   - Reject a same- or cross-sprint dependency cycle with the exact cycle path.

3. **Current sprint derivation**
   - Derive `current_sprint` from the first sprint not terminally closed.
   - Honor `closed_with_deferrals` as a sprint-level terminal marker while leaving deferred stories individually visible.
   - Do not derive the current sprint from the highest numbered sprint, last generated file, or a stale project field.

4. **Sizing rendering**
   - Render `3 SP`, never `? ?SP`.
   - Sum the structured values and fail if a sprint containing sized stories renders `0 SP`.

### P0 — Story/source correctness

5. **Publish the full lifecycle graph**
   - Add a machine-readable transition artifact for US-014/BR-04.
   - Generate the story AC, architecture port, test critical path, and developer-plan reference from the same graph.
   - Include the special system-materialization edge `null → active` separately from user transitions.

6. **Canonicalize US-042**
   - Rename it to “Alert engine: 10 P0 types” or reduce AC1 to eight; the current title/AC/schema conflict must not survive generation.
   - The recommended canonical set is the 10-value list in §1.
   - Add a coherence rule: enum-valued AC lists must be subsets of the ER/schema enum.

7. **Clarify US-020 verification**
   - Encode two moments: admin attestation activates the orchestration assignment in Sprint 2; a later member observation verifies it.
   - Define mismatch behavior explicitly: `ProvisioningAction.status = verification_failed`, alert/exception evidence, assignment retained until an authorized corrective transition.
   - State which Sprint 3 channels call the verification port: API member sync and CSV/manual ingestion.

8. **Clarify US-010 company moves**
   - Specify the effective date, assignment close reason, whether a re-request is auto-created or merely offered, and whether vendor deprovisioning is required.
   - This plan uses: close open register rows on the day before the move with
     `reallocated`, create contiguous successor rows for the new company on the
     effective date, anchor them to a system-materialized active fast-track
     request, then return that request’s detail link.

9. **Clarify approval time semantics**
   - Resolve “24h/48h” versus “two business days” as explicit 24-hour
     business-day units using the Ecuador calendar: hours on weekends/holidays
     do not accrue; 24 accrued hours is one business day and 48 is two.
   - Generate the same threshold definition into US-015 UI aging and US-017 job ACs.

### P1 — Status, claims, and feedback

10. **Claim cleanup**
    - Clear assignee claims when a story becomes done, externally deferred, or the claim expires.
    - Never render an expired push token as the assignee of a completed story.

11. **Status precedence**
    - Later terminal events supersede older blockers in the rendered status.
    - Preserve blocker history as annotations, but render US-002/US-007 as done after their later completion evidence.
    - Render US-054 as externally deferred/blocked, not generic in-progress.

12. **Acceptance-criterion projection**
    - Project `ac_verify` evidence into generated story status without editing source AC prose.
    - Distinguish “AC verified” from a Markdown checkbox so regeneration cannot erase completion evidence.

13. **Feedback vocabulary validation**
    - Reject or visibly quarantine unknown sprint-level event names.
    - Validate that `done` is preceded by every required AC verification and a later build pass.
    - Keep one blocker cause per event, as the current feedback guide requires.

### P1 — Developer-package readiness

14. **Generated readiness report**
    - Emit `docs/stories/READINESS.md` with:
      - current sprint and points;
      - completed/deferred prerequisites;
      - external gates;
      - first executable wave;
      - dependency cycles or source drift;
      - last verified commit and CI/migration evidence.

15. **Database gate discoverability**
    - During package sync, report whether `DATABASE_ADMIN_URL` and `DATABASE_URL` are configured without printing values.
    - Keep migration parity unverified rather than implying green when credentials are absent.

16. **Remote/CI provenance**
    - Record the authoritative repository remote and last known CI run in package metadata.
    - If no remote exists, render CI as “not observable,” not passed or failed.

17. **Critical-path derivation**
    - Add BR-08 approval aging, BR-11 low-pool alerting, and BR-14 operational
      alert delivery/deduplication to `testing/critical-paths.md` and
      `docs/dev-guide/TESTING.md` generation.
    - Generate a Stryker mutate-set suggestion from changed critical paths so a
      story cannot claim the mutation gate while its new critical file is absent
      from `stryker.conf.json`.

### Recommended Nous regression fixture

Add this exact Ledger fixture to the sprint-plan generator suite:

```json
{
  "current_sprint": 2,
  "sprint_points": 34,
  "stories": {
    "US-033": { "points": 3, "blocked_by": ["US-007"] },
    "US-045": { "points": 3, "blocked_by": ["US-003"] },
    "US-022": { "points": 3, "blocked_by": ["US-007", "US-042"] },
    "US-020": { "points": 3, "blocked_by": ["US-014", "US-045"] }
  },
  "deferred": {
    "US-054": {
      "external": true,
      "blocks_sprints": [3],
      "does_not_block_sprints": [2]
    }
  }
}
```

The fixture passes only when the rendered plan contains 34 SP, no US-018/US-019 dependency in Sprint 2, no cycle, `current_sprint: sprint-2`, and a visible US-054 external deferral.
