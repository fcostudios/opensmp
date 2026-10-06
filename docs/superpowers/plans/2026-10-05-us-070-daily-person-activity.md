**Work item:** US-070
**Readiness assessment:** docs/readiness/US-070.json
**Approved estimate:** 270 minutes

# Daily person activity implementation plan

> Use superpowers:subagent-driven-development: the user selected fresh implementers and task reviews. The controller writes briefs and reviews findings; workers implement. Repository readiness metadata above overrides the generic skill header.

**Goal:** Persist accurate, replayable person-day activity from API-enabled accounts and expose identity warnings through existing audit surfaces.

**Architecture:** A common validated record contract feeds a reusable database boundary. The Anthropic adapter supplies actual per-user metrics. The existing analytics worker composes credentials, observations and ingestion; it introduces no screen or queue.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Vitest, existing Pact harness, existing worker/runtime and diff mutation runner.

**Spec:** `docs/superpowers/specs/2026-10-05-us-070-daily-person-activity-design.md`, approved in this conversation; canonical `docs/stories/sprint-3/r1_misc_us_070.md`; DEC-SMP-024/025 under CHG-068.

## Global Constraints

- Persist one row per `(vendor_account_id, person_id, activity_date)`.
- Resolve email case-insensitively against `Person` with a real `company_id` predicate.
- Account IDs constrain the account/date natural key and do not grant company authority.
- Manual/CSV accounts are excluded before credential reads and provider calls, including explicitly targeted worker runs.
- For scheduled `at`, the observed activity day is the UTC calendar date minus three days.
- Missing/nullable metrics are preserved as unknown, never invented as zero.
- Full provider bodies, request headers and credentials are never persisted.
- Keep company batch writes and their audit summary in one transaction.
- Do not overwrite a row with an older sync instant; newer reruns refresh it.
- Contradictory values at an equal instant must fail rather than make worker scheduling determine the data.
- CSV/manual entry flows remain US-055; costs remain US-071; freshness UI remains US-029. No new screen, public route, queue, lease table or executable verification tooling.
- Migrations are append-only. Use committed-migration apply/verify/parity, never schema push.
- Before any test edit read `docs/dev-guide/TESTING.md` and `docs/TEST_EFFECTIVENESS_STANDARD.md`. Use real database fixtures and Pact-backed external transports; do not mock owned modules. Assertions must constrain named ACs or mutants, including tenant isolation.
- All shell commands start with `rtk`; work in the approved feature workspace. Read `CLAUDE.md`, `docs/dev-guide/local/CLAUDE.md` and applicable nested AGENTS files before edits.
- At every task boundary assess remaining work against the approved 270 minutes. If predicted work exceeds the estimate, emit `blocked` or `deviation` and reassess before continuing; no timestamp-based deadline.
- After each committed implementation task/fix: run ordinary mutation preflight, intersect its returned shard `sources` with changed production sources, preview only those exact shard IDs, and repair genuine survivors before review. No preview `test_report`. Record preview rounds/minutes.

## Stable interfaces and file ownership

Task 1 adds shared contract primitives without changing the existing `ActivitySnapshot` yet, keeping that commit independently green. Task 2 switches the snapshot and provider/dispatch together. Task 3 consumes both. `contracts.ts` is the only shared edit across implementation tasks; reviews are sequential.

The common fields and names are binding. Database driver types must accept the existing Drizzle application client and worker PostgreSQL transaction; infer the narrow common type from Drizzle rather than creating a second connection or using type assertions to hide incompatibility.

```ts
export type IngestionSource = "api" | "csv_import" | "manual";
export type ActivityIngestionRecord = Readonly<{
  email: string | null;
  providerUserId: string | null;
  activityDate: string;
  counters: JsonValue;
}>;
export type ActivityIdentityWarning = Readonly<{
  recordIndex: number;
  reason: "missing_email" | "unmatched_email";
  email: string | null;
  providerUserId: string | null;
}>;
export type ActivityBatch = Readonly<{
  companyId: string;
  vendorAccountId: string;
  activityDate: string;
  source: IngestionSource;
  syncedAt: Date;
  actorUserAccountId: string | null;
  records: readonly ActivityIngestionRecord[];
}>;
export type ActivityBatchResult = Readonly<{
  written: number;
  ignored: number;
  warnings: readonly ActivityIdentityWarning[];
}>;
// db parameter: the narrow common Drizzle database/transaction type described above.
// ingestActivityBatch(db, batch: ActivityBatch): Promise<ActivityBatchResult>
// resolveActivityScopes(db, companyIds: readonly string[], records: readonly ActivityIngestionRecord[]):
//   Promise<{ batches: readonly { companyId: string; records: readonly ActivityIngestionRecord[] }[];
//             warnings: readonly ActivityIdentityWarning[] }>
// normalizeActivityCounters(value: unknown): JsonValue
```

`resolveActivityScopes` is an internal scheduled-worker helper receiving trusted company IDs, never public caller input. Every Person query contains a `company_id` predicate. It matches each record once and reports warnings only after checking all authorized scopes. `ingestActivityBatch` never searches outside its one company. Both use the same email normalizer/matcher. Reject multiple matches/conflicting identities instead of choosing collection order. It is permissible to lock/recheck Person scope during transactional persistence so movement cannot cause a foreign-company write.

Replay is reconstructed by the database boundary as `{version:1,vendorAccountId,activityDate,source,identity:{email,providerUserId},counters}`. Never accept an arbitrary caller replay blob. The snapshot contains validated identity/counters sufficient to reconstruct this payload, rather than a second independently mutable raw representation.

## Task 1: Shared source-aware persistence and append-only migration

**Files:**
- Modify: `packages/connectors/src/contracts.ts` (new shared types and counter normalizer; preserve current ActivitySnapshot until Task 2).
- Modify: `packages/db/src/schema.ts`, `packages/db/package.json`.
- Create: `packages/db/src/analytics-ingestion.ts`.
- Create test: `packages/db/src/analytics-ingestion.integration.test.ts`.
- Create migration: `packages/db/src/migrations/V20261006013000__analytics_activity_ingestion.sql` (check timestamp uniqueness first; if occupied choose the next unused UTC timestamp with the same slug).

**Production sources:** contracts.ts, schema.ts, analytics-ingestion.ts, the new SQL migration; package export configuration.

**Consumes:** existing schema, `JsonValue`/`assertJsonValue`, real PostgreSQL fixture `@smp/db/testing/postgres-container`, existing system actor/audit conventions and Drizzle clients.

**Produces:** the shared types and `normalizeActivityCounters` above; `@smp/db/analytics-ingestion` exporting `ActivityBatch`, `ActivityBatchResult`, `ingestActivityBatch`, `resolveActivityScopes`. Task 2 uses the shared record/normalizer; Task 3 uses both database functions. No connection is created inside this module.

- [ ] **Step 1: Write a failing real-database test for the natural-key contract.** Seed two companies, same normalized email in each, an active supported vendor/account and Person IDs. Use `createPostgresFixture`, migrate committed SQL and connect as `ledger_app`; owner connection is for fixtures/privilege inspection only. Use deterministic UUIDs and timestamps. Adapt existing seed helpers, not owned mocks. The core assertion is:

```ts
const first = await ingestActivityBatch(appDb, batchA);
const before = await appDb.select().from(activityRecord);
const second = await ingestActivityBatch(appDb, {
  ...batchA,
  syncedAt: new Date("2026-10-06T12:00:00Z"),
  records: [{ ...batchA.records[0], counters: { chat_metrics: { message_count: 9 } } }],
});
const after = await appDb.select().from(activityRecord);
expect(first.written).toBe(1);
expect(second.written).toBe(1);
expect(after.map(row => row.id)).toEqual(before.map(row => row.id));
expect(after).toHaveLength(1);
expect(after[0].personId).toBe(personAId);
expect(after[0].counters).toEqual({ chat_metrics: { message_count: 9 } });
expect(after[0].syncedAt.toISOString()).toBe("2026-10-06T12:00:00.000Z");
expect(after.some(row => row.personId === personBId)).toBe(false);
```

- [ ] **Step 2: Run RED.** `rtk pnpm --filter @smp/db exec vitest run src/analytics-ingestion.integration.test.ts`. Expected missing ingestion export/fields; record the diagnostic. Fixture services must be available; infrastructure failure is not the RED oracle.

- [ ] **Step 3: Add the schema and grant migration.** Verify existing enum/constraint names and account provisioning column. Declare a common ingestion enum and account default/manual backfill; activity source default/api. Mirror the existing committed activity unique key in Drizzle without duplicating it in SQL. The grant permits ONLY `UPDATE (counters, raw_payload, source, synced_at)` on activity_record. Do not grant UPDATE of key/id columns or DELETE. New runtime writes explicitly provide source. Add `./analytics-ingestion` package export. The SQL shape is:

```sql
CREATE TYPE ingestion_source AS ENUM ('api', 'csv_import', 'manual');
ALTER TABLE vendor_account ADD COLUMN ingestion_mode ingestion_source NOT NULL DEFAULT 'manual';
ALTER TABLE activity_record ADD COLUMN source ingestion_source NOT NULL DEFAULT 'api';
GRANT UPDATE (counters, raw_payload, source, synced_at) ON activity_record TO ledger_app;
```

- [ ] **Step 4: Implement validation/matching/upsert.** Validate UUID/date/source/finite sync instant, record date equals batch date, identity field types, supported vendor email matching and counters before any write. Real dates must round-trip (`2026-02-30` fails). Normalize email with trim/lowercase. Accept null email for warnings; malformed nonnull email is rejected. The counter normalizer reconstructs only the three allowlisted metric groups listed below, preserving missing/null and rejecting negative/noninteger/nonfinite counts. Unknown properties are dropped even if they contain secrets. Reject conflicting duplicate normalized identities/natural keys before writes; equivalent duplicates collapse.

Allowed paths: chat_metrics `{connectors_used_count,distinct_artifacts_created_count,distinct_connectors_used_count,distinct_conversation_count,distinct_files_uploaded_count,distinct_projects_created_count,distinct_projects_used_count,distinct_shared_artifacts_viewed_count,distinct_skills_used_count,message_count,shared_conversations_viewed_count,thinking_message_count}`; claude_code_metrics.core_metrics `{artifacts_created_count,commit_count,distinct_session_count,pull_request_count,lines_of_code:{added_count,removed_count}}`; claude_code_metrics.tool_actions `{edit_tool,multi_edit_tool,notebook_edit_tool,write_tool}` each `{accepted_count,rejected_count}`; cowork_metrics `{action_count,artifacts_created_count,connectors_used_count,dispatch_turn_count,distinct_connectors_used_count,distinct_session_count,distinct_skills_used_count,message_count,skills_used_count,distinct_plugins_used_count,edit_tool_count,file_edit_count,multi_edit_tool_count,notebook_edit_tool_count,plugins_used_count,sessions_with_file_edits_count,write_tool_count}`. Group/nested objects may be missing/null; never manufacture counters or zeros.

For API writes recheck and hold the account ingestion mode through commit; non-api account gives ignored rows and no writes. Prefer existing transaction row locks, no lifecycle/table. Other sources do not invoke providers and may persist regardless of account ingestion mode. Scope/match Person with `company_id`, including a race-safe recheck. Use a real PostgreSQL natural-key upsert; this is the atomic decision shape:

```sql
ON CONFLICT (vendor_account_id, person_id, activity_date)
DO UPDATE SET counters=EXCLUDED.counters, raw_payload=EXCLUDED.raw_payload,
  source=EXCLUDED.source, synced_at=EXCLUDED.synced_at
WHERE activity_record.synced_at < EXCLUDED.synced_at
```

When no row returns, read the now-current key and compare timestamp and JSONB semantics: newer persisted timestamp means ignore; equal and equivalent means ignore; equal and contradictory means reject. Do not compare JSON serialization order. Handle concurrency using PostgreSQL conflict/locks so simultaneous equal conflicts cannot both succeed. Persist `analytics_activity_sync` company summaries inside the same transaction, with account/date/source/written/ignored/warning counts and verified actor or system identity. Scoped callers retain structured warnings and persist scoped warning audit entries in that same transaction. Global routing warnings are persisted by Task 3 only, so an identity matched in another company is never mislabeled unknown globally.

- [ ] **Step 5: Prove specific boundaries with real assertions.** Extend the first test only where each assertion kills a named fault: stale replay preserves newer payload/time; equal equivalent retry preserves ID; equal contradiction rolls back data+audit; concurrent writes retain one row; two accounts retain independent keys; foreign-only email returns unmatched without foreign person data; null email returns missing_email; api/csv_import/manual produce explicit source and replay metadata; invalid full batch writes nothing; immutable-key/DELETE grants fail under ledger_app; audit INSERT failure rolls back rows (owner temporarily revokes grant and restores in finally); backfilled orchestration and automated accounts both default manual. Test mode disable during fetch via shared API batch returning ignored, not a sleep/race test. Global matcher must group two distinct-company records once and emit only true unmatched/null warnings.

- [ ] **Step 6: Run GREEN and commit.** Run the focused DB test and `rtk pnpm --filter @smp/db type-check`, plus connector type-check to prove additive primitives preserved old callers. Run migration parity. Commit only task paths with `feat(US-070): add source-aware activity ingestion`. Controller routes previews on the committed candidate, then sends scoped review. Report actual commands/results and privilege evidence, not coverage counts.

## Task 2: Correct Anthropic per-user activity contract and adapter

**Files:**
- Modify: `packages/connectors/src/contracts.ts`, `packages/connectors/src/dispatch.ts`.
- Modify: `packages/connectors/src/providers/anthropic/connector.ts`.
- Modify tests: `packages/connectors/src/providers/anthropic/connector.test.ts`, `packages/connectors/src/providers/anthropic/connector.pact.test.ts`; `packages/connectors/src/dispatch.test.ts` only if it contains affected activity fixtures or validation coverage.

**Production sources:** contracts.ts, dispatch.ts, providers/anthropic/connector.ts.

**Consumes:** Task 1 `ActivityIngestionRecord` and `normalizeActivityCounters`; current `SyncInput`, endpoint policies, opaque-page implementation, separated analytics credentials, rate limiter and observations.

**Produces:** `ActivitySnapshot = {records: readonly ActivityIngestionRecord[]}`; `VendorConnector.syncActivity` remains the existing method and `ConnectorResult` envelope. No second raw payload field is needed: Task 1 reconstructs replay from validated snapshot fields.

- [ ] **Step 1: Write the failing distinct-person contract test.** Use existing transport fixture/observation helpers, backed by the updated Pact interaction. Current org-summary duplication must fail this oracle:

```ts
const body = { data: [
  { user: { type: "user", id: "u-a", email_address: "ALICE@example.test" },
    chat_metrics: { message_count: 2, thinking_message_count: null },
    unrelated: { authorization: "must-not-persist" } },
  { user: { type: "user", id: "u-b", email_address: "bob@example.test" },
    chat_metrics: { message_count: 7 } },
  { user: null, chat_metrics: { message_count: 3 } },
], has_more: false, next_page: null };
// Run the existing connector with this documented users response.
expect(result.ok).toBe(true);
if (!result.ok) throw new Error("expected activity success");
expect(result.value.records.map(row => row.counters)).toEqual([
  { chat_metrics: { message_count: 2, thinking_message_count: null } },
  { chat_metrics: { message_count: 7 } },
  { chat_metrics: { message_count: 3 } },
]);
expect(result.value.records[2].email).toBeNull();
expect(result.value.records.every(row => row.activityDate === "2026-10-03")).toBe(true);
expect(requests.map(request => new URL(request.url).pathname))
  .toEqual(["/v1/organizations/analytics/users"]);
```

The request path is the existing `endpoints.ts` analytics_users policy; assert there is no summaries call.

- [ ] **Step 2: Run RED.** `rtk pnpm --filter @smp/connectors exec vitest run src/providers/anthropic/connector.test.ts src/providers/anthropic/connector.pact.test.ts`. Expected old flat-identity parser rejection or wrong per-person metrics, not infrastructure failure.

- [ ] **Step 3: Switch contract and adapter together.** Change ActivitySnapshot to shared records. Parse documented nested `user` with id/email_address nullable/missing (null user yields warning candidate); reject wrong nonnull types, malformed envelopes, conflicting duplicate identities/date values and mixed-day records. Provider queried day is `syncDate(input)`. Reconstruct counters using Task 1's explicit normalizer. Keep only normalized email/minimal id, activity date, counters. No organization summary request. Preserve bounded opaque pages (100), repeated-cursor rejection, key separation and observation policy. Keep top-level success raw null. Dispatch validates/canonicalizes each returned activity record (types, real UTC day, JSON/allowlist) using shared primitives; it cannot let an arbitrary connector bypass safe replay. Existing cost parser stays untouched.

```ts
const records = users.map(item => ({
  email: normalizedNullableEmail(item.user?.email_address),
  providerUserId: nullableProviderId(item.user?.id),
  activityDate: syncDate(input),
  counters: normalizeActivityCounters(item),
}));
return success({ records });
```

The adapter's local nullable-field helpers reject malformed nonnull values; put shared normalization in contracts when the database/dispatch also require it. Unknown identity fields are discarded. Validate duplicates over all pages, not just within one page. Equivalent repeated user rows can collapse; conflicts fail the snapshot before worker writes.

- [ ] **Step 4: Update Pact and named failure oracles.** Replace only the activity interaction with official nested-user metrics, exact date/header/query policy and per-person expected counters. Preserve unrelated member, cost and invitation interactions. Prove pagination uses opaque cursors and keeps distinct counters; null identity survives; missing/null groups stay unknown; nested negative/nonfinite/wrong-type counts fail; unknown group fields/headers/secrets never appear in output or observations; cross-page conflicting duplicates/repeated cursor/excess pages fail. Keep no-summary assertion, differentiated analytics key and sanitized failure observations. Fix affected dispatch fixtures rather than weakening legacy validation tests.

- [ ] **Step 5: Run GREEN and commit.** Run affected connector/Pact/dispatch tests, connector type-check and DB focused test (shared primitive changed). Commit `fix(US-070): return documented per-person activity metrics`. Controller routes touched previews and scoped review. Report Pact evidence as local contract-backed fixtures, never claim authenticated live-provider verification.

## Task 3: Execute daily activity ingestion through the existing worker

**Files:**
- Create: `apps/worker/src/jobs/analytics-activity.ts`.
- Create test: `apps/worker/src/jobs/analytics-activity.integration.test.ts`.
- Modify: `apps/worker/src/jobs/deferred.ts`, `apps/worker/src/jobs/deferred.test.ts`.
- Modify: `apps/worker/src/connector-composition.ts` only if a small activity factory alias is needed; prefer the existing dispatcher factory over duplicating composition.

**Production sources:** jobs/analytics-activity.ts, jobs/deferred.ts, optional connector-composition.ts.

**Consumes:** Task 1 DB exports, Task 2 `syncActivity`, existing membership-poll credential/KEK and connector observation seams, worker service inputs/runtime retry failure reporting and `successfulJob`.

**Produces:**

```ts
export function createAnalyticsActivityJob(options: {
  connectionString: string; allowedKekRoot?: string; kekFile?: string;
  now: () => Date; sleep: (milliseconds: number) => Promise<void>;
  transport: (request: Request) => Promise<Response>;
}): {
  drain(input: { at: Date; vendorAccountId?: string }): Promise<{ processed: number }>;
  close(): Promise<void>;
};
```

- [ ] **Step 1: Write a failing end-to-end worker test with real ledger_app storage.** Seed a manual automated account, csv_import account, api orchestration account, two people in different companies and valid encrypted analytics credential. Transport uses Task 2's Pact-backed nested-user response with different counters plus one unmatched and one null user. Invoke the deferred handler with services and targeted account. Assert api rows reference each correct Person ID and retain distinct counters, the two warning audit reasons/evidence are persisted, and observation entries use sync_activity with provisioningActionId null and no credentials. Invoke again at a later injected now and assert row IDs/count unchanged and synced_at increased. For manual/CSV targeted runs use a transport that throws on ANY call, assert success zero, empty telemetry and no observation. Assert missing credentials do not break mode-excluded runs.

```ts
const job = createAnalyticsActivityJob(options);
try {
  expect(await job.drain({ at: new Date("2026-03-03T00:00:00Z"), vendorAccountId: apiAccountId }))
    .toEqual({ processed: 2 });
  expect(capturedDates).toEqual(["2026-02-28"]);
  expect(await job.drain({ at: new Date("2026-03-03T00:00:00Z"), vendorAccountId: manualAccountId }))
    .toEqual({ processed: 0 });
} finally { await job.close(); }
```

- [ ] **Step 2: Run RED.** `rtk pnpm --filter @smp/worker exec vitest run src/jobs/analytics-activity.integration.test.ts src/jobs/deferred.test.ts`. Expected absent job or deferred dependency result, not fixture failures.

- [ ] **Step 3: Compose worker resources and account filtering.** Model pool/Drizzle ownership, KEK decryption, rate limiter and sanitized observation session after `jobs/membership-poll.ts`; reuse module seams without copying domain feature logic. Query active account/vendor, ingestion_mode api, supported api connector, hasUsageData true and email matching before credential reads. Unsupported targeted matching fails explicitly when API ingestion is otherwise eligible. Account provisioning mode does not filter. Enumerate trusted active company IDs from database for global execution and route records once with resolveActivityScopes. Never derive company authority from account ID or email input. Fetch snapshot entirely before writes. For each company batch use ingestActivityBatch with API source, exact queried day, injected actual now and system actor. The shared transaction rechecks ingestion mode; disabled-in-flight account produces no persisted rows or warnings from that excluded attempt.

```ts
const observedAt = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - 3));
const observedDay = observedAt.toISOString().slice(0, 10);
const snapshot = await connector.syncActivity({ vendorAccountId: account.id, observedAt });
if (!snapshot.ok) throw providerFailureForExistingRuntime(snapshot);
const routed = await resolveActivityScopes(db, trustedCompanyIds, snapshot.value.records);
```

Use the existing worker's error/retry contract; no invented helper export is required for the local provider failure conversion. Persist each true global missing/unmatched warning as analytics_identity_warning, null company and allowlisted account/day/reason/identity. No arbitrary company assignment, truncation or lost warning on provider pagination. Audit failure rejects run. Successful earlier company batches remain safe to replay after later failure. processed counts written rows; ignored/stale records don't count. Drain does not close its reusable resources; handler closes in finally. Constructor/resource initialization must also clean up on errors.

- [ ] **Step 4: Replace deferred handler and prove UTC/errors/mode/concurrency.** With no configured services return dependencyNotDelivered("US-070"); with services create the activity job, drain `{at,vendorAccountId}`, wrap processed via successfulJob and close in finally. Update only analytics no-services expectation in deferred tests. Existing daily schedule stays unchanged. Add deterministic assertions for UTC midnight, leap day and month/year boundary; driver/provider errors propagate to existing failure reporter, unsupported vendor/matching behavior is explicit, pagination completes before persistence, disable during external fetch stops writes, concurrent reruns preserve one natural-key row, stale finishing attempt cannot replace newer counters and globally unmatched warnings persist once per attempt rather than per company. Test DB cleanup through real pool/session behavior and repeat job use, without mocking the owned job.

- [ ] **Step 5: Run GREEN and commit.** Run focused worker tests and worker type-check. Commit `feat(US-070): execute daily API activity ingestion`. Controller routes touched previews then scoped review. Report exact account exclusions, UTC examples and durable warning evidence.

## Integration, adversarial verification and terminal evidence

This section is controller/verifier work, not another implementation task. Never dispatch US-071 from this session.

- [ ] Record review phase. Package the complete branch diff and all task reports for one broad reviewer on the most capable available model. Reviewer adversarially attempts AC1..AC4 using real fixture tests and narrow commands where reported evidence leaves a concrete doubt; it also reviews deferred/minor rulings. Record one ac_verify per AC only after a passing verdict. Fix findings through one bounded implementer wave followed by scoped rereview; any logic fixes rerun only touched previews and focused tests.
- [ ] Update effectiveness-critical declarations by the Nous-owned config path, not by editing generated TESTING.md. Locate the authoritative testing.critical_paths config and preserve existing entries; add daily activity row idempotency/tenant matching/source gating/replay/warning retention with US-070. Use the normal generated delivery. If the producer is being modified concurrently, prepare a concrete bounded handoff and coordinate rather than editing its database behind its agent. Generated-only delivery does not change runtime semantics.
- [ ] Record integration phase. A verifier runs `rtk pnpm check` with MUTATION_WORK_ID=US-070 and MUTATION_BASE set to the recorded plan authority commit. Independently apply committed migrations and verify schema/parity on a fresh real PostgreSQL owner database; app privilege tests remain ledger_app. Preserve logs as files and report concise results. Infrastructure failure must be fixed or reported, never treated as a passing gate.
- [ ] After all repairs are committed, clear authoritative cache once and run one cold diff campaign: `rtk pnpm mutation:cache:clear`, then `rtk env MUTATION_WORK_ID=US-070 MUTATION_BASE=<recorded-authority-commit> pnpm test:mutation`. The exact base is captured before Task 1, not inferred from HEAD~1. Capture shard count/minutes. A post-campaign implementation change invalidates it and needs an explicit mutation_invalidation before another cold attempt. Shard-count estimate mismatch is a deviation, not a silent readiness rewrite.
- [ ] Reviewer signs off any survivor with exactly one line: `<mutant-id> <file>:<line> @equivalent: <reason>` or `@accepted: <reason>`. No separate equivalence document. Genuine unaccepted survivors are repaired; the killing test is evidence. Retain no tests whose only purpose was coverage.
- [ ] Controller records phase actuals, git authority/cutoff/file and commit counts, review loops, preview rounds/minutes, cold attempts/invalidations and cost provenance. Read `docs/dev-guide/FEEDBACK.md` and DEFINITION_OF_DONE before terminal evidence. Work-state tools are currently unavailable in this tool catalog; the plan-specific SDD ledger is the durable recovery map.
- [ ] Commit closed readiness actuals and feedback together in one evidence commit; emit build_pass, all four passing ac_verify, authoritative test_report and cost provenance before done. Do not mark US-026 done: it still awaits US-071 and fresh parent verification readiness. Finish according to the development-branch skill without merging or publishing without authorization.
