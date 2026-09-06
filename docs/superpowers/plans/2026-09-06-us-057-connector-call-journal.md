**Work item:** US-057
**Readiness assessment:** docs/readiness/US-057.json
**Approved estimate:** 208 minutes

# US-057 Connector-Call Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one privacy-safe, provider-neutral, append-only event stream for every connector transport attempt.

**Architecture:** `@smp/connectors` owns a neutral observation session that generates correlation identity, allocates attempts, validates receipts, and constructs closed summaries. `@smp/db` owns the append-only PostgreSQL table and autocommit writer; the Anthropic provider adapts its existing observation seam into the neutral session without importing database code.

**Tech Stack:** TypeScript 5.7, Vitest 4, fast-check, Drizzle ORM, PostgreSQL/Testcontainers, raw SQL migrations, Stryker mutation testing.

**Spec:** `docs/superpowers/specs/2026-09-06-us-057-connector-call-journal-design.md`

## Global Constraints

- Run `pnpm readiness:check -- US-057` before implementation and keep the approved readiness payload unchanged.
- Read and follow `docs/dev-guide/TESTING.md` before changing tests: no mocks of owned code, only the true provider transport may be substituted, deterministic clock/UUID inputs, strong assertions, and explicit tenant-isolation evidence.
- Keep provider names and wire details under `packages/connectors/src/providers/anthropic/`; neutral contracts contain no Anthropic names.
- The connector package must not import Drizzle, `@smp/db`, `apps/web`, or `apps/worker`.
- The database writer must commit `requested` before its promise resolves and must not share a caller-owned transaction with transport.
- Runtime summaries are constructed from a closed allowlist and never contain credentials, authorization headers, email addresses, raw PII, full provider identifiers, raw bodies, URLs with identifiers, exception messages, or unknown fields.
- `ledger_app` has `SELECT` and `INSERT` only on `connector_call_observation`; update and delete are rejected by grants and an append-only trigger.
- A correlation cannot change vendor account, operation, or optional action link; attempts are one-based and increasing; an attempt has one requested event and at most one terminal event.
- Provisioning-action links must belong to the same vendor account; sync operations must have a null action link. Company scope is derived through `ProvisioningAction -> LicenseRequest`, never accepted as observation input.
- Preserve US-056 ordering: committed requested observation, rate admission, request construction, then transport.
- US-057 adds no route, UI, production REST registration, five-operation connector, or Pact contract; those belong to US-058.
- Use append-only migrations after `V20260804120100`; never edit a committed migration.
- Run the approved diff-scoped mutation shard to at least 80 percent and disposition every survivor under the testing contract, then run `pnpm check`.

---

### Task 1: Neutral observation session and allowlist sanitizer

**Files:**
- Create: `packages/connectors/src/connector-call-observation.ts`
- Create: `packages/connectors/src/connector-call-observation.test.ts`
- Modify: `packages/connectors/src/contracts.ts`
- Modify: `packages/connectors/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: no task-local interface.
- Produces: `ConnectorOperation`, `ConnectorCallPhase`, `ConnectorCallClassification`, `ConnectorCallSummary`, `ConnectorCallObservationAppendInput`, `ConnectorCallObservationAppender`, `ConnectorAttemptReceipt`, `ConnectorCallObservationSession`, and `createConnectorCallObservationSession`.

- [ ] **Step 1: Add fast-check directly to the connector package**

Run:

```bash
pnpm --filter @smp/connectors add -D fast-check
```

Expected: `packages/connectors/package.json` and `pnpm-lock.yaml` record the direct development dependency without changing unrelated versions.

- [ ] **Step 2: Write failing exact lifecycle and receipt tests**

Create deterministic tests with fixed UUIDs and clock values. The primary exact oracle is:

```ts
expect(appended).toEqual([
  {
    vendorAccountId: VENDOR_ACCOUNT_ID,
    provisioningActionId: null,
    correlationId: CORRELATION_ID,
    operation: "sync_members",
    attempt: 1,
    phase: "requested",
    classification: null,
    summary: { endpoint_class: "members", method: "GET" },
    occurredAt: new Date("2026-09-06T12:00:00.000Z"),
  },
  {
    vendorAccountId: VENDOR_ACCOUNT_ID,
    provisioningActionId: null,
    correlationId: CORRELATION_ID,
    operation: "sync_members",
    attempt: 1,
    phase: "succeeded",
    classification: "success",
    summary: {
      endpoint_class: "members",
      method: "GET",
      http_status: 200,
      status_class: "success",
    },
    occurredAt: new Date("2026-09-06T12:00:01.000Z"),
  },
]);
```

Also prove attempts increase across repeated `requested` calls, correlation is generated once, a receipt from another session is rejected, and a receipt cannot be completed twice.

- [ ] **Step 3: Run the lifecycle tests and confirm red**

Run:

```bash
pnpm --filter @smp/connectors exec vitest run src/connector-call-observation.test.ts
```

Expected: FAIL because the neutral module and exports do not exist.

- [ ] **Step 4: Define the closed contract and minimal session implementation**

Use these exact public shapes:

```ts
export type ConnectorOperation =
  | "provision" | "deprovision" | "sync_members"
  | "sync_activity" | "sync_cost";
export type ConnectorCallPhase = "requested" | "succeeded" | "failed";
export type ConnectorCallClassification =
  | "success" | "rate_limited" | "provider_error" | "client_error";
export type ConnectorEndpointClass =
  | "organization" | "members" | "invitations"
  | "activity" | "usage" | "cost";
export type ConnectorCallSummary = Readonly<{
  endpoint_class: ConnectorEndpointClass;
  method: "GET" | "POST" | "DELETE";
  http_status?: number;
  status_class?: ConnectorCallClassification;
}>;
export type ConnectorCallObservationAppendInput = Readonly<{
  vendorAccountId: string;
  provisioningActionId: string | null;
  correlationId: string;
  operation: ConnectorOperation;
  attempt: number;
  phase: ConnectorCallPhase;
  classification: ConnectorCallClassification | null;
  summary: ConnectorCallSummary;
  occurredAt: Date;
}>;
export type ConnectorCallObservationAppender =
  (input: ConnectorCallObservationAppendInput) => Promise<void>;
export type ConnectorAttemptReceipt = Readonly<{ attempt: number }>;
export type ConnectorCallObservationSession = Readonly<{
  correlationId: string;
  requested(input: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: "GET" | "POST" | "DELETE";
  }>): Promise<ConnectorAttemptReceipt>;
  succeeded(receipt: ConnectorAttemptReceipt, input: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: "GET" | "POST" | "DELETE";
    httpStatus: number;
  }>): Promise<void>;
  failed(receipt: ConnectorAttemptReceipt, input: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: "GET" | "POST" | "DELETE";
    httpStatus: number;
    classification: Exclude<ConnectorCallClassification, "success">;
  }>): Promise<void>;
}>;
export function createConnectorCallObservationSession(input: Readonly<{
  vendorAccountId: string;
  provisioningActionId: string | null;
  operation: ConnectorOperation;
  clock: () => Date;
  randomId: () => string;
  append: ConnectorCallObservationAppender;
}>): ConnectorCallObservationSession;
```

`createConnectorCallObservationSession` accepts the exact input above. It creates
frozen summaries by selecting individual allowed fields; never use object spread
from input. Validate UUID-shaped identifiers, legal operation/action
combinations, status range `100..599`, receipt ownership, and single completion.
Expose the focused module as `@smp/connectors/connector-call-observation`; do not
expand the neutral root barrel.

- [ ] **Step 5: Write the failing fixed-seed property/metamorphic sanitizer test**

Use `fast-check` with an explicit seed and run count. Generate nested dictionaries/arrays containing unique credential, authorization, email, PII, provider-ID, URL, body, exception, and unknown-field sentinels. Inject them alongside valid fields through an `unknown` boundary, then assert:

```ts
expect(Object.keys(summary).sort()).toEqual(allowedKeysForPhase);
expect(JSON.stringify(summary)).not.toContain(forbiddenSentinel);
expect(buildSummary({ ...valid, ...unknownFields })).toEqual(buildSummary(valid));
```

Expected before implementation: FAIL on the absent summary builder.

- [ ] **Step 6: Complete the allowlist implementation and run focused tests**

Run:

```bash
pnpm --filter @smp/connectors exec vitest run src/connector-call-observation.test.ts
pnpm --filter @smp/connectors type-check
```

Expected: all tests and type-check pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/connectors/src/connector-call-observation.ts packages/connectors/src/connector-call-observation.test.ts packages/connectors/src/contracts.ts packages/connectors/package.json pnpm-lock.yaml
git commit -m "feat(US-057): add neutral connector observation session"
```

---

### Task 2: Append-only database schema and migration enforcement

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/V20260804120200__connector_call_observation.sql`
- Create: `packages/db/src/migrations/V20260804120300__verify_connector_call_observation.sql`
- Modify: `packages/db/scripts/verify-schema.mjs`
- Modify: `packages/db/src/schema.test.ts`
- Modify: `packages/db/src/physical-schema.test.ts`
- Modify: `packages/db/src/schema-parity.test.ts`
- Modify: `packages/db/src/integrity/append-only.test.ts`

**Interfaces:**
- Consumes: Task 1 neutral operation, phase, classification, and summary shapes.
- Produces: Drizzle export `connectorCallObservation`, PostgreSQL enums `connector_call_operation_enum` and `connector_call_phase_enum`, and the verified physical table.

- [ ] **Step 1: Write failing schema and migration assertions**

Add exact assertions for the canonical columns, enum catalogs, nullability,
foreign keys, indexes, `attempt >= 1`, JSON-object summaries, phase/classification
shape, unique `(correlation_id, attempt, phase)`, partial terminal uniqueness,
runtime grants, and both validation and append-only triggers. Add the table to
schema parity and release migration expectations.

- [ ] **Step 2: Run the focused database tests and confirm red**

Run:

```bash
pnpm --filter @smp/db exec vitest run src/schema.test.ts src/physical-schema.test.ts src/schema-parity.test.ts src/integrity/append-only.test.ts
```

Expected: FAIL because the table, migrations, and verifier registrations do not exist.

- [ ] **Step 3: Add the Drizzle schema mirror**

Define operation and phase enums with the exact Task 1 values. Define
`connectorCallObservation` with the canonical fields from
`docs/specs/04_er_model.md`, including indexes on vendor account, action,
correlation, operation, and occurrence time plus Drizzle-expressible checks and
uniqueness.

- [ ] **Step 4: Add the create migration and database validation triggers**

The create migration must:

```sql
GRANT SELECT, INSERT ON connector_call_observation TO ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON connector_call_observation FROM ledger_app;
```

Add a `BEFORE INSERT` validator that serializes by correlation with an advisory
transaction lock and rejects mismatched correlation context, nonsequential
requested attempts, terminal-without-request, duplicate terminal outcomes,
cross-account action links, and action links on sync operations. Add a separate
`BEFORE UPDATE OR DELETE` trigger that raises SQLSTATE `55000` for every role.
Revoke function execution from `PUBLIC`; trigger execution remains internal.

- [ ] **Step 5: Add the verification migration and central verifier entries**

The verification migration fails closed when the table, columns, enums,
constraints, indexes, triggers, or grants drift. Add
`connector_call_observation` to `coreTableNames` and its exact append-only
trigger/function source to `expectedAppendOnlyTriggers`; do not add it to
`normallyUpdateableTableNames` or column-update exceptions.

- [ ] **Step 6: Run focused database tests and schema verification**

Run:

```bash
pnpm --filter @smp/db exec vitest run src/schema.test.ts src/physical-schema.test.ts src/schema-parity.test.ts src/integrity/append-only.test.ts
pnpm --filter @smp/db type-check
pnpm --filter @smp/db db:parity
```

Expected: all tests, type-check, and migration parity pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/db/src/schema.ts packages/db/src/migrations/V20260804120200__connector_call_observation.sql packages/db/src/migrations/V20260804120300__verify_connector_call_observation.sql packages/db/scripts/verify-schema.mjs packages/db/src/schema.test.ts packages/db/src/physical-schema.test.ts packages/db/src/schema-parity.test.ts packages/db/src/integrity/append-only.test.ts
git commit -m "feat(US-057): add append-only connector journal schema"
```

---

### Task 3: Autocommit PostgreSQL appender

**Files:**
- Create: `packages/db/src/connector-call-observations.ts`
- Create: `packages/db/src/connector-call-observations.integration.test.ts`
- Modify: `packages/db/package.json`

**Interfaces:**
- Consumes: `ConnectorCallObservationAppender` from Task 1 and `connectorCallObservation` from Task 2.
- Produces: `createConnectorCallObservationAppender(connectionString): { append: ConnectorCallObservationAppender; close(): Promise<void> }` exported as `@smp/db/connector-call-observations`.

- [ ] **Step 1: Write the failing real-PostgreSQL repository test**

Use the repository Testcontainers fixture and real `ledger_app` URL. Append an
exact requested/succeeded pair and assert persisted values through an owner
connection. Prove `append` has committed by querying from a separate connection
immediately after it resolves. Add rejected cases for invalid FK, mismatched
action/account, sync action link, skipped attempt, terminal without request,
second terminal, update, and delete.

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```bash
pnpm --filter @smp/db exec vitest run src/connector-call-observations.integration.test.ts
```

Expected: FAIL because the appender module and package export do not exist.

- [ ] **Step 3: Implement the minimal dedicated-pool appender**

Create a dedicated `pg.Pool` from the runtime connection string. `append`
performs one parameterized `INSERT` with no surrounding caller transaction and
awaits `pool.query`; `close` ends the pool. Map camelCase neutral input to exact
snake-case columns. Do not accept `companyId`, raw SQL fragments, a transaction,
or arbitrary summary JSON from another API.

- [ ] **Step 4: Add the focused package export and run verification**

Expose the appender as `@smp/db/connector-call-observations`; do not expand the
root database barrel.

Run:

```bash
pnpm --filter @smp/db exec vitest run src/connector-call-observations.integration.test.ts
pnpm --filter @smp/db type-check
```

Expected: test and type-check pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/db/src/connector-call-observations.ts packages/db/src/connector-call-observations.integration.test.ts packages/db/package.json
git commit -m "feat(US-057): persist connector observations atomically"
```

---

### Task 4: Anthropic bridge, end-to-end evidence, and gates

**Files:**
- Create: `packages/connectors/src/providers/anthropic/observation.ts`
- Create: `packages/connectors/src/providers/anthropic/observation.test.ts`
- Modify: `packages/connectors/src/providers/anthropic/request.ts`
- Modify: `packages/connectors/src/providers/anthropic/request.test.ts`
- Modify: `packages/connectors/package.json`
- Modify: `packages/db/src/connector-call-observations.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 observation session, Task 3 database appender, and the existing `AnthropicAttemptObserver` seam.
- Produces: `createAnthropicConnectorObservationBridge(session): AnthropicAttemptObserver` and acceptance evidence for requested-before-transport, terminal outcomes, retries, ambiguity, and fail-closed persistence.

- [ ] **Step 1: Write failing bridge mapping tests**

Assert exact endpoint mapping, `completed/success -> succeeded`, known non-success
`completed -> failed`, stable correlation, monotonically increasing neutral
attempts when provider-local attempts restart, and rejection of completed events
without a matching requested receipt. No raw provider object may enter the
neutral session.

- [ ] **Step 2: Run bridge tests and confirm red**

Run:

```bash
pnpm --filter @smp/connectors exec vitest run src/providers/anthropic/observation.test.ts
```

Expected: FAIL because the bridge does not exist.

- [ ] **Step 3: Implement the bridge and preserve request sequencing**

Map the closed Anthropic endpoint enum to the neutral endpoint class. Store one
receipt for each in-flight provider-local requested attempt, consume it on
completed, and let transport exceptions leave it unmatched. Keep the executor
order `await observe(requested) -> await limiter.acquire -> construct Request ->
transport` and retain response cancellation when terminal persistence rejects.

Use this exact endpoint mapping:

```ts
{
  organization: "organization",
  members: "members",
  invites: "invitations",
  create_invite: "invitations",
  delete_invite: "invitations",
  analytics_users: "activity",
  analytics_summaries: "activity",
  usage_report: "usage",
  cost_report: "cost",
}
```

Expose only the bridge module as
`@smp/connectors/providers/anthropic/observation`; do not export Anthropic names
from the neutral root barrel.

- [ ] **Step 4: Add the real transport/journal acceptance matrix**

Using the real session, real request executor, real appender, and real
PostgreSQL, substitute only the true provider transport and assert:

1. a separate connection sees committed `requested` before the transport returns;
2. 2xx appends `succeeded`;
3. known 4xx/5xx appends `failed`;
4. retry-safe `503 -> 200` yields requested/failed attempt 1 and requested/succeeded attempt 2 under one correlation;
5. a transport exception leaves exactly one unmatched requested row;
6. a real requested insert failure rejects and transport call count stays zero; and
7. terminal insert failure cancels the response and leaves requested evidence.

- [ ] **Step 5: Run focused connector and database suites**

Run:

```bash
pnpm --filter @smp/connectors exec vitest run src/connector-call-observation.test.ts src/providers/anthropic/observation.test.ts src/providers/anthropic/request.test.ts
pnpm --filter @smp/db exec vitest run src/connector-call-observations.integration.test.ts src/integrity/append-only.test.ts
pnpm lint:tests
```

Expected: all focused tests and test-policy lint pass.

- [ ] **Step 6: Run mutation verification**

Capture the story branch base and run:

```bash
MUTATION_BASE=7f08279 pnpm test:mutation
```

Expected: the approved US-057 diff shard reaches at least 80 percent and every
surviving mutant is killed or recorded as equivalent with reviewer sign-off.
Do not retain generated mutation artifacts.

- [ ] **Step 7: Run the full repository gate**

Run:

```bash
pnpm check
```

Expected: type-check, lint, all tests, migrations/schema checks, mutation
routing, and production build pass.

- [ ] **Step 8: Commit Task 4**

```bash
git add packages/connectors/src/providers/anthropic/observation.ts packages/connectors/src/providers/anthropic/observation.test.ts packages/connectors/src/providers/anthropic/request.ts packages/connectors/src/providers/anthropic/request.test.ts packages/connectors/package.json packages/db/src/connector-call-observations.integration.test.ts
git commit -m "feat(US-057): bind Anthropic attempts to durable journal"
```

- [ ] **Step 9: Record completion evidence**

After review, reconstruct actuals only from durable Git/test evidence. Append
`started`, AC1-AC3 verification, mutation evidence/invalidation where supported,
`build_pass`, and `done` through the repository lifecycle contract. If the
canonical feedback vocabulary still cannot represent a required event, record
the exact schema gap as a deviation and do not fabricate terminal completion.
