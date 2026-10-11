**Work item:** US-073
**Readiness assessment:** docs/readiness/US-073.json
**Approved estimate:** 230 minutes

# Batch reclamation proposals implementation plan

> Use the CHG-070 consolidated shape explicitly selected by Francisco: one
> implementer for all tasks, checkpoint commit per task, one reused scoped
> reviewer and one fresh adversarial AC reviewer. The controller plans, briefs
> and decides. This overrides the generic writing-plans execution-choice and
> fresh-worker-per-task recommendations; repository metadata overrides its
> generic header. Plan approval is pending; no production/test edits yet.

**Goal:** Group Admins propose reclamation for selected people on SCR-usage,
with an optional note, one pending proposal/audit per open assignment and
company-isolated, idempotent resubmission.
**Architecture:** An authenticated server action calls an audited transaction
service and a shared DB persistence helper. The existing UsageView consumes
US-072 unchanged, rendering a client table with a component-scoped Zustand
selection store and proposal dialog. Existing partial UNIQUE supplies idempotency.
**Tech stack:** TypeScript, Next.js 16 App Router, React 19, Drizzle/PostgreSQL,
Zod, Zustand, next-intl, Vitest, Testing Library and existing mutation tooling.
**Spec:** `docs/superpowers/specs/2026-10-10-us-073-batch-reclamations-design.md`,
content digest `bc8f5b1cdae832af584dbaf82f6318979047fe6303adddacdaae84f2a011333d`,
approved by Francisco with "Approved, and continue" and recorded as
`US073-DESIGN-20261011`; canonical US-073; BR-16; DEC-SMP-027/028.

## Global constraints and entry

- Read AGENTS.md, CLAUDE.md, local/CLAUDE.md, TESTING.md and
  TEST_EFFECTIVENESS_STANDARD.md before edits; inspect nested AGENTS files.
- Readiness digest is `6784f0f0562a2fdd70604a097ca227f2f2b553b3e43ba530a8557d84c0add05a`.
  Readiness and design are approved; this plan needs Francisco's digest-bound
  approval and a committed immutable binding before implementation.
- Only branch `us-073` in `/Users/fcolomas/Projects/smp-us073`; never commit on
  chg-070 directly. Starting branch point is `872f9381b1914a01fba4cbfb18964c65dd4b2c2c`.
- After plan approval commit, freeze its exact HEAD as US073_BASE/MUTATION_BASE
  and append that SHA in the ledger before the first implementation commit.
  All preflights/previews/campaigns use the frozen base, even after integration
  rebases. Record any rewritten base/commit SHA map without rewriting sibling work.
- One outcome, db/server/ui scopes, one screen. No migration, worker/schedule,
  request transitions, approve/dismiss, suppression, offboarding or new route.
- US-072 classifier, repository and fixture sources are read-only. If a shared
  change becomes necessary, stop at a safe boundary, record deviation and tell
  US-074 through Francisco before committing. Out-of-scope findings stay
  deviations/deferred hardening; never mint another work item.
- All shell commands start with rtk; never print secret environment values/URLs.
- Validate UUIDs, strict input shape, maximum 50 unique people and 2,000 note
  characters; actor/capability/scope come only from verified authorization.
- Group Admin retains all-company capability. An explicit company_id filter
  constrains the whole batch; companyIds is the verified company enumeration,
  not a client grant. Every person/assignment query uses real company_id and
  joins person/company ownership. No invented soft-delete columns.
- One proposal per selected person's open assignment; blank note becomes null.
  No already-pending proposal/audit is changed on retry. client_request_id is
  audited, never persisted on proposal. Use the existing partial UNIQUE.
- Component-scoped Zustand; no Context/global state. UI copy in both existing
  locale catalogs, design tokens and accessible dialog/table/checkbox controls.
- Readiness/implementation/focused/review/integration estimates remain
  25/90/45/50/20 = 230 minutes. File map below has 16 production/test/locale
  paths, plus readiness/design/plan/ledger governance paths. Report actual
  changed-file count honestly; do not edit approved readiness to fit observations.
- At every task boundary, if remaining work is judged to exceed the approved
  estimate, stop there and file a blocked/deviation event before continuing.

## File map and public interfaces

Task 1 creates:
`packages/db/src/reclamation-proposals.ts`;
`apps/web/src/modules/usage/reclamation-command.ts`;
`apps/web/src/modules/usage/reclamation-service.ts`;
`apps/web/src/modules/usage/reclamation-operations.ts`;
`apps/web/src/modules/usage/reclamation-server-actions-factory.ts`;
`apps/web/src/app/(authenticated)/uso/actions.ts`;
`apps/web/src/modules/usage/testing/reclamation-fixture.ts`;
`apps/web/src/modules/usage/reclamation-service.integration.test.ts`.
It modifies only `packages/db/package.json` to add the persistence subpath export.

Task 2 creates:
`apps/web/src/components/usage/reclamation-selection-store.ts`;
`apps/web/src/components/usage/usage-batch-table.tsx`;
`apps/web/src/components/usage/usage-batch-table.integration.test.tsx`.
It modifies:
`apps/web/src/components/usage/usage-view.tsx`;
`apps/web/src/app/(authenticated)/uso/page.tsx`;
`apps/web/messages/en-US.json` and `apps/web/messages/es-EC.json`.
Task 3 changes only readiness actuals and the append-only ledger unless a named
review defect requires a fix before the cold campaign.

`reclamation-command.ts` owns these types and schema; no packages/contracts
scope is added. Task 2 imports the schema/types, never a database service.

```ts
export type ReclamationCommand = Readonly<{
  person_ids: readonly string[];
  company_id?: string;
  note?: string;
  client_request_id: string;
}>;
export type ReclamationCounts = Readonly<{ created: number; existing: number }>;
export type ReclamationResult =
  | ({ readonly status: "success" } & ReclamationCounts)
  | { readonly status: "error"; readonly code:
      "invalid_input" | "access_denied" | "selection_changed" | "unexpected" };
export type ReclamationAction = (input: unknown) => Promise<ReclamationResult>;
// zod output normalizes casing, deduplicates IDs, and converts blank note to null.
export type ParsedReclamationCommand = Readonly<{
  person_ids: readonly string[]; company_id?: string;
  note: string | null; client_request_id: string;
}>;
export declare function parseReclamationCommand(input: unknown): ParsedReclamationCommand;
```

DB helper types derive from the shared schema and transaction rather than
handwriting divergent proposal rows:

```ts
export type ReclamationTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];
export type InsertedReclamation = Readonly<{
  proposal: typeof reclamationProposal.$inferSelect;
  companyId: string;
}>;
export class ReclamationPersistenceError extends Error {
  constructor(readonly code: "access_denied" | "selection_changed") { super(code); }
}
export declare function insertReclamationProposals(tx: ReclamationTransaction, input: {
  readonly personIds: readonly string[]; readonly allowedCompanyIds: readonly string[];
  readonly companyId?: string; readonly actorUserId: string;
  readonly note: string | null; readonly occurredAt: Date;
}): Promise<{ readonly inserted: readonly InsertedReclamation[]; readonly existing: number }>;
```

Service/factory contracts:

```ts
export declare function createReclamationProposalService(
  database: NodePgDatabase<typeof schema>, options?: { now?: () => Date },
): { proposeReclamations(authorization: LedgerAuthorization, input: unknown): Promise<ReclamationCounts> };
export declare function createReclamationOperations(input: {
  database: NodePgDatabase<typeof schema>; now?: () => Date;
}): { proposeReclamations(authorization: LedgerAuthorization, input: unknown): Promise<ReclamationCounts> };
export declare function reclamationActionError(error: unknown): ReclamationResult;
export declare function createReclamationServerActions(input: {
  database: NodePgDatabase<typeof schema>;
  loadAuthorization: () => Promise<LedgerAuthorization | null>;
  now?: () => Date; revalidate: (path: string) => void | Promise<void>;
}): { proposeReclamations: ReclamationAction };
```

## Task 1 — Audited, isolated and idempotent batch command (AC1–AC4)

**Production sources:** reclamation-proposals.ts, reclamation-command.ts,
reclamation-service.ts, reclamation-operations.ts,
reclamation-server-actions-factory.ts and uso/actions.ts; DB package export.
**Deliverable:** a real authenticated server action, tested through its factory,
that commits a complete batch and its proposal audits or refuses/rolls back.

- [ ] Create the US-073 fixture using createPostgresFixture(), fixture.migrate(),
  owner-only deterministic seed and a pg.Pool/Drizzle connection as ledger_app.
  Reuse fixture APIs, not the US-072 fixture implementation. Fixed time is
  `2026-10-10T12:00:00.000Z`; deterministic IDs use prefix
  `00000000-0000-4000-8000-000000730` plus a three-digit suffix.
  Seed admin, viewer, central finance, companies A/B/C, vendor/account/type,
  three flagged people with one open assignment each, a second open assignment
  for person 1, an ended assignment, a company B outsider and an authorized
  person with no open assignment. Real load authorization uses
  createAuthorizationRepository(f.database).load({ subject: "reclamation-admin" }).
  Export createReclamationFixture({ extraAssignment = true } = {}). The UI and
  exact three-person demo use extraAssignment:false; expansion tests use true.
  Fixture exposes database, owner, ownerDb, admin, ids, now and stop(). ids contains
  admin/viewer/finance/companyA/companyB/companyC/vendor/account/type,
  person1/person2/person3/outsider/noOpen, assignment1/assignment2/assignment3/
  assignmentExtra/assignmentEnded/assignmentOutsider, request1/request2/request3,
  command1/command2 and openSelectedAssignments. The selected people belong to
  A/B/C for the all-companies demo; company-A mixed-batch refusal uses person1
  plus outsider. A separate scoped variant can seed all three in A using an
  explicit fixture option if a company-filtered three-person demo is needed.
  Seeded business queries always run on ledger_app; owner is for setup/fault injection.
- [ ] Add exact behavior oracles before implementing. Instantiate the real action
  factory with real authorization and a local array collecting revalidation
  paths. Tests may intentionally constrain authorization.companyIds to a subset
  as the real verified context input; do not mock auth/service/database methods.
  The central demo oracle is:

```ts
const action = createReclamationServerActions({ database: f.database,
  loadAuthorization: async () => f.admin, now: f.now,
  revalidate: path => { revalidated.push(path); } }).proposeReclamations;
const command = { person_ids: [f.ids.person1, f.ids.person2, f.ids.person3],
  note: "  Inactividad revisada  ", client_request_id: f.ids.command1 };
expect(await action(command)).toEqual({ status: "success", created: 4, existing: 0 });
const proposals = await f.database.select().from(reclamationProposal);
expect(proposals.map(p => p.assignmentId).sort()).toEqual(f.ids.openSelectedAssignments.slice().sort());
expect(proposals.every(p => p.status === "pending" && p.proposedBy === f.admin.userAccountId
  && p.proposalNote === "Inactividad revisada")).toBe(true);
const audits = await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed"));
expect(audits).toHaveLength(proposals.length);
for (const proposal of proposals) {
  const matches = audits.filter(a => a.entityId === proposal.id);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ actorUserId: f.admin.userAccountId,
    entityType: "ReclamationProposal", note: proposal.proposalNote,
    before: null, after: { assignment_id: proposal.assignmentId,
      client_request_id: f.ids.command1, status: "pending" } });
}
expect(await action({ ...command, note: "different", client_request_id: f.ids.command2 }))
  .toEqual({ status: "success", created: 0, existing: 4 });
expect((await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed"))))
  .toHaveLength(4);
```

  Also run the exact three-person/three-assignment AC4 variant in a separate
  reset/fixture case, not only the four-assignment expansion case. Compare before/
  after pending rows and audits for retry; assert all original notes/IDs/times
  and request audit IDs remain unchanged. Assert no selected ended assignment
  appears; audit companyId must equal the matched assignment/company.
- [ ] Add whole-batch negative oracles: company A command with A+B people,
  nonexistent person/company, empty verified allowed list, stale person without
  an open assignment, non-group_admin roles and null session. Assert the exact
  error code and unchanged proposal/audit counts, even when valid IDs precede
  the bad ID. Invalid input covers unknown fields, empty/over-50-unique selection,
  malformed UUID/note/request ID, 2,001-character note and nonstring note. Case
  normalization plus duplicate person IDs must create one set of proposals.
  Blank optional note persists null; no company filter permits legitimate A/B/C
  multi-company selection under global admin with correct audit ownership.
- [ ] Add real concurrency and rollback oracles: Promise.all of two actions on
  fresh selected assignments yields summed created equal to assignment count,
  one pending row and one audit per assignment. Seed historical dismissed/
  approved proposals and prove they do not conflict with a new pending row.
  Test an already-pending subset: create/audit only the remaining assignments.
  For audit failure, install an owner-authored test-only BEFORE INSERT trigger
  that raises on `NEW.action='reclamation.proposed'` and the selected
  `NEW.after->>'assignment_id'`; invoke action, expect unexpected and zero new
  proposals/audits. Drop the test trigger/function in finally; no trigger is
  production code or committed migration. Exercise an assignment-close race
  with real independent connections: hold its row lock and stage ended_on,
  start action, confirm it waits on the held lock using pg_stat_activity,
  release the owner transaction and expect selection_changed with no proposal.
  Use database lock state as the synchronization oracle, no fixed sleep or
  order-dependent winner expectation. Stop all fixture pools in finally.
- [ ] Run the focused suite and confirm failures are the absent command behavior:
  `rtk proxy pnpm --filter smp-web exec vitest run src/modules/usage/reclamation-service.integration.test.ts`.
- [ ] Implement parseReclamationCommand with strict zod; normalize UUIDs first,
  then enforce 1..50 unique IDs. Validate raw note length before trim. Export
  client-visible input/result types in a DB-free module. Validation failure is
  invalid_input; unknown error is unexpected. Do not accept actor/scope fields.
- [ ] Implement the transaction helper. Reject empty allowed scope and an explicit
  company not in allowedCompanyIds. Query selected Person IDs with both allowed
  company IDs and optional company_id, ordered ID ascending and FOR UPDATE;
  compare the complete unique requested set before selecting any assignments.
  Query LicenseAssignment with matching Person ID AND companyId, explicit
  allowed/filter clauses, endedOn IS NULL and stable assignment-ID order,
  FOR UPDATE OF assignment. Refuse selection_changed if any resolved person
  has no open assignment. No state change/LicenseRequest lock. Insert all pending
  values and return only actual inserted proposals, with trusted company ID
  obtained from the locked assignments. The decisive SQL/Drizzle contract is:

```ts
await tx.insert(reclamationProposal).values(values).onConflictDoNothing({
  target: reclamationProposal.assignmentId,
  where: sql`${reclamationProposal.status} = 'pending'`,
}).returning();
```

  If this installed Drizzle version cannot express the partial conflict target,
  use parameterized `tx.execute(sql\`INSERT ... ON CONFLICT (assignment_id)
  WHERE status = 'pending' DO NOTHING RETURNING ...\`)`; do not change the
  constraint/schema. existing = lockedAssignments.length - inserted.length.
  Add `"./reclamation-proposals": "./src/reclamation-proposals.ts"` to DB exports.
- [ ] Implement the audited service in the exact checker-recognized shape.
  Authorization and parse run inside withAudit before persistence. Validate
  group_admin, actor identity from authorization, verified company enumeration
  and hasCapability(authorization, "company:write", company) for resolved scope.
  Clock is sampled once; no per-row wall-clock/RNG injection requirement for
  DB-generated UUIDs. Construct AuditRecordInput per returned proposal.

```ts
function mapPersistenceFailure(error: unknown): never { throw error; }
const occurredAt = now();
try {
  return await withAudit(database, async transaction => {
    if (authorization.globalRole !== "group_admin" || authorization.companyIds.length === 0) {
      throw new ReclamationPersistenceError("access_denied");
    }
    const command = parseReclamationCommand(input);
    const allowedCompanyIds = authorization.companyIds.filter(companyId =>
      hasCapability(authorization, "company:write", companyId));
    const batch = await insertReclamationProposals(transaction, {
      personIds: command.person_ids, allowedCompanyIds,
      companyId: command.company_id, actorUserId: authorization.userAccountId,
      note: command.note, occurredAt,
    });
    const value = { created: batch.inserted.length, existing: batch.existing };
    if (batch.inserted.length === 0) throw new NoNewReclamationProposals(value);
    const records: AuditRecordInput[] = batch.inserted.map(({proposal, companyId}) => ({
      actorUserId: authorization.userAccountId, action: "reclamation.proposed",
      entityType: "ReclamationProposal", entityId: proposal.id, companyId,
      note: command.note, before: null,
      after: { assignment_id: proposal.assignmentId, proposed_by: proposal.proposedBy,
        status: proposal.status, proposal_note: proposal.proposalNote,
        client_request_id: command.client_request_id },
    }));
    if (records.length > 1) {
      await transaction.insert(auditLog).values(records.slice(1).map(record => ({
        ...record, before: redactAuditValue(record.before),
        after: redactAuditValue(record.after), occurredAt,
      })));
    }
    return { value, audit: records[0]! };
  }, { occurredAt });
} catch (error) { mapPersistenceFailure(error); }
```

  Imports are withAudit/redactAuditValue, AuditRecordInput, auditLog,
  hasCapability, parseReclamationCommand and the DB helper/error. Define the
  internal no-op result exception in reclamation-service.ts:

```ts
export class NoNewReclamationProposals extends Error {
  constructor(readonly counts: ReclamationCounts) { super("no_new_proposals"); }
}
```

  Export it only for the pure result mapper's instanceof check.
  Audit after fields are assignment_id/proposed_by/status/proposal_note/
  client_request_id. First audit is returned to withAudit; remaining auditLog
  inserts use the same fields, redaction and occurredAt. Audit failure rolls
  back every write. No separate batch/no-op audit, no shared helper edit.
- [ ] Operations directly delegate to service.proposeReclamations, without catch.
  The pure reclamationActionError mapper returns success for the private no-op
  sentinel, invalid_input for Zod validation, typed persistence/service code
  errors otherwise, and unexpected for unrecognized errors. It performs no
  writes/new allocations/async calls; use ordinary object literals/instanceof
  branches so pureImportedErrorMapper accepts it. No error toString leakage.
- [ ] Implement factory exactly like the existing vendor-account state pattern:
  `const actions = createReclamationOperations({database, now})`; method loads
  `let authorization` in a try/catch returning unexpected on loader failure;
  null guard returns access_denied; `let result: ReclamationCounts`; operation
  try only assigns `result = await actions.proposeReclamations(authorization,input)`;
  catch only returns `reclamationActionError(error)`; await revalidate(route
  constant); return literal success counts. Production uso/actions.ts uses
  "use server", shared db typed adapter, loadCurrentLedgerAuthorization and
  revalidatePath; exported async proposeReclamations delegates to the factory.
  Import-restriction exceptions are narrowly documented at these transaction
  composition imports; do not edit ESLint/checker configuration.
- [ ] Run focused suite, DB/web type-check and audit enforcement to GREEN:
  `rtk proxy pnpm --filter @smp/db type-check`;
  `rtk proxy pnpm --filter smp-web type-check`;
  `rtk proxy node scripts/check-audited-actions.mjs apps/web`.
  Keep existing audited-actions-enforcement tests unchanged unless a specific
  missing contract mutant justifies an in-scope change and reviewer approval.
- [ ] Commit `feat(US-073): add audited batch reclamation action` with explicit
  Task 1 files only. Run post-task preflight and launch touched fast previews
  in the background. Database-backed shards wait for final preview unless
  source repairs require them earlier. Send controller commit, focused results,
  sources/shards and cost/phase times; controller briefs reused reviewer with
  AC1–4 and exact diff. Begin Task 2 while preview/review runs.

## Task 2 — Selection and proposal modal on SCR-usage (AC1, AC4)

**Production sources:** reclamation-selection-store.ts, usage-batch-table.tsx,
usage-view.tsx, uso/page.tsx and both locale catalogs.
**Consumes:** ReclamationAction/Command/Result and existing UsageReadModel/UsageRow.
**Deliverable:** working selection/modal calling Task 1 action and showing results.

- [ ] Write a jsdom integration test using the new US-073 real fixture, actual
  createUsageRepository and createReclamationServerActions; no owned-code mocks.
  Use createReclamationFixture({extraAssignment:false}) for the three-person UI
  demo and load the all-companies read model. Render UsageView with its real
  model, locale labels and real `propose` callback.
  Inject request-ID factory returning deterministic UUIDs at the store/component
  seam in tests; production calls browser crypto.randomUUID only when preparing
  an actual submission. The public view prop additions are:

```ts
type UsageViewProps = {
  model: UsageReadModel; locale: string; labels: UsageLabels;
  propose?: ReclamationAction;
  requestId?: () => string;
};
// Extract the existing table body into this client component; read model stays unchanged.
type UsageBatchTableProps = {
  model: UsageReadModel; locale: string; labels: UsageLabels;
  propose?: ReclamationAction; requestId?: () => string;
};
```

  Optional propose preserves static/server read-only render callers, including
  existing US-072 tests. The real page always supplies proposeReclamations.
  No proposal controls or extra column render without the action; with the
  action, existing table content is preserved plus a selection column and CTA.
- [ ] Add the browser-to-DB demo oracle, using query-by-role/label rather than
  snapshots. Choose the fixture's three one-assignment flagged people:

```tsx
const user = userEvent.setup();
render(<UsageView model={model} locale="es-EC" labels={labels}
  propose={action} requestId={() => f.ids.command1} />);
expect(screen.getByTestId("btn_propose_reclamation")).toBeDisabled();
for (const id of selectedPeople) {
  await user.click(screen.getByTestId(`select_person_${id}`));
}
await user.click(screen.getByTestId("btn_propose_reclamation"));
await user.type(screen.getByTestId("note"), "Revisar inactividad");
await user.click(screen.getByTestId("btn_send_proposals"));
const expectedSuccess = labels.proposal.success.replace("{created}", "3").replace("{existing}", "0");
await waitFor(() => expect(screen.getByRole("status").textContent).toContain(expectedSuccess));
const pending = await f.database.select().from(reclamationProposal)
  .where(eq(reclamationProposal.status, "pending"));
expect(pending).toHaveLength(3);
expect(pending.every(p => p.proposalNote === "Revisar inactividad"
  && p.proposedBy === f.admin.userAccountId)).toBe(true);
```

  `labels` in this oracle is the real es-EC catalog's usage object;
  `selectedPeople` is the fixture's three one-assignment flagged person IDs.
  Localized success uses count interpolation. Use no fixed
  time delays; waitFor awaits observable UI completion. Assert audit request ID,
  note, company filter and exact selected person set through persisted effects
  and whole-batch refusal, not a mocked action-call counter.
- [ ] Constrain duplicate person rows sharing selection, inactive/flagged
  eligibility, no-data/noneligible controls, blank note, success close clearing
  selection, error preserving note/selection, retry with zero created, changing
  filters/cursor reset and two separately rendered stores without shared state.
  Exercise pending state with a real held DB lock: controls disabled until
  release, double-click cannot create extra pending rows/audits, cancellation
  blocked during submit. Use the real factory's revalidation observer throwing
  to exercise a rejected UI promise after an actual DB commit; retry must find
  pending proposals rather than duplicate them. This is a real local observer,
  not a mocked owned action/DB/service. A changed scope while an older request
  resolves must not apply the stale result to the new store.
- [ ] Run the new rendered integration suite to observe intended failures:
  `rtk proxy pnpm --filter smp-web exec vitest run src/components/usage/usage-batch-table.integration.test.tsx`.
- [ ] Create component-scoped Zustand store using createStore and useStore,
  initialized through a stable ref. State contains selectedPersonIds, note,
  open, submitting, requestId, result and generation. Methods togglePerson,
  setNote, openDialog, closeDialog, beginSubmission, finishSubmission and reset
  enforce: no edits while pending; duplicate clicks return no second command;
  selection/note changes invalidate request ID; retry preserves ID; new scope
  increments generation and clears selection/note/result; finish applies only
  the matching generation/request. At beginSubmission, obtain/reuse the
  candidate request UUID first, construct and parse the complete command,
  then atomically mark pending before invoking the action. Retain the request
  UUID for unchanged retries; selection/note edits invalidate it. Reuse parsed
  validation for client errors; server remains authoritative.
- [ ] Extract existing table markup into usage-batch-table.tsx ("use client").
  Existing model rows/formatters/links/labels/IDs remain; the server UsageView
  still renders filters/cards/freshness and invokes the table with its props.
  With propose present, add labeled person checkboxes. Eligible person set
  derives from any displayed inactive or flagged row; duplicated rows use the
  same selected ID. Additional same-person rows show synchronized selection
  even if their own classification differs. The parent page imports action
  and passes it explicitly; do not import database/auth modules into client code.
- [ ] Implement native dialog with the existing vendor-account-dialog focus and
  showModal/close conventions, no copied Stryker exclusions. Heading/summary
  explain that all currently open licenses for selected people are proposed,
  with displayed license count labeled as displayed, actual counts on success.
  Dialog names companies and selected people, optional note textarea maxLength
  2000, cancel and send. Store drives open/submitting/result. Trap keyboard focus,
  restore trigger focus, prevent Escape/cancel while pending, show errors with
  role alert and success with role status. Catch thrown action failure as
  localized unexpected and always release pending for that current generation.
  Form cannot submit with no selection or after success until a new session.
- [ ] Add `usage.proposal` locale keys in en-US/es-EC: select/selectPerson,
  trigger/title/description, selected people/displayed licenses/all-open warning,
  note/placeholder/cancel/send/submitting/close, success counts and each of four
  error codes. es-EC trigger/title "Proponer reclamación", send "Enviar propuestas".
  IDs: btn_propose_reclamation, modal_propose_reclamation, selected_summary,
  note, btn_send_proposals. Avoid new navigation/action to /reclamaciones.
- [ ] Run new and existing usage view/page integration suites, focused Task 1
  suites, web type-check and lint to GREEN. Static US-072 test callers still
  receive the same table without proposal controls; no test edits just to bless
  unrelated output changes. Server model/classifier sources remain unchanged.
- [ ] Commit `feat(US-073): add usage batch selection and proposal dialog`.
  Collect Task 1 review/preview findings; fold real fixes into this task or one
  final named fix wave. Brief reused reviewer AC1/AC4 plus full action integration,
  exact Task 2 diff and commands. Launch final/last-task merged preview round
  when no fix wave follows; otherwise one Task 2 round plus one final round.
  This child has at most three rounds, <=30 minutes. Source/test fixes are
  checkpointed with US-073 before adversarial verification/cold campaign.

## Preview and serialized gate procedure

Implementer owns focused suites/gates/previews, controller receives bounded
results and decides. Discover actual post-task shards with ordinary preflight,
then intersect shard sources with the task's production sources; never hardcode
IDs from another commit. Before the first code edit, capture the approved
entry HEAD, export it for the Python subprocess, and persist the same value in
an external session file and timestamped feedback freeze marker:

```bash
rtk proxy git rev-parse HEAD > /tmp/smp-us073-mutation-base.txt
export US073_BASE="$(rtk proxy cat /tmp/smp-us073-mutation-base.txt)"
export US073_GATE_LOG=/tmp/smp-us073-base-gate.log
```

On resume, load that file rather than recapturing a moving HEAD. For the final
gate set US073_GATE_LOG=/tmp/smp-us073-final-gate.log. For each post-task preview,
read the exact shard ID from preflight's structured output into US073_SHARD
and set US073_PREVIEW_LOG to `/tmp/smp-us073-preview-<round>-<shard>.log` with
shell-safe characters. These are runtime values, not hardcoded shard IDs.
Pass frozen MUTATION_BASE and MUTATION_WORK_ID=US-073:

```bash
rtk proxy env MUTATION_BASE="$US073_BASE" MUTATION_WORK_ID=US-073 pnpm mutation:preflight
rtk proxy pnpm test:mutation:preflight
rtk proxy env MUTATION_BASE="$US073_BASE" MUTATION_WORK_ID=US-073 \
  MUTATION_SHARD="$US073_SHARD" caffeinate -i pnpm test:mutation \
  > "$US073_PREVIEW_LOG" 2>&1 &
```

Record preview start/end and summed shard wall minutes. Database-backed and
schema-static shards (and prior runs >5 minutes) are previewed once final,
unless a repair touched their sources. Collect background results at the next
review boundary. Genuine survivors join next-task/final fixes; after repairs
preview only intersecting changed sources. A whole-set rerun or >tasks+1 rounds/
30 minutes needs a named root_cause. routing_gaps never count as clean evidence.
Observed shard-count mismatch is a timestamped deviation plus actuals count,
not an approved-readiness payload edit or a new tooling work item.

Both US-073/074 share /tmp/smp-full-gate.lock. Every full gate uses atomic
exclusive file creation, work ID and owner PID; never remove sibling lock.
If present, wait with >=60-second yields, communicate meaningful progress,
and retry acquisition after it disappears. The implementer runs this wrapper
for a cold base gate before Task 1 and final full gate:

```bash
rtk proxy python3 - > "$US073_GATE_LOG" 2>&1 <<'GATE'
import os, signal, subprocess
from pathlib import Path
lock = Path('/tmp/smp-full-gate.lock')
with lock.open('x') as handle:
    handle.write(f'US-073 {os.getpid()}\n')
proc = None
previous = {}
def forward(signum, frame):
    if proc is not None and proc.poll() is None:
        os.killpg(proc.pid, signum)
try:
    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.signal(signum, forward)
    proc = subprocess.Popen(['caffeinate', '-i', 'pnpm', 'check'],
        env={**os.environ, 'TURBO_FORCE': 'true', 'MUTATION_BASE': os.environ['US073_BASE'],
             'MUTATION_WORK_ID': 'US-073'}, start_new_session=True)
    status = proc.wait()
finally:
    if proc is not None and proc.poll() is None:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait()
    for signum, handler in previous.items():
        signal.signal(signum, handler)
    lock.unlink()
raise SystemExit(status if status >= 0 else 128 - status)
GATE
```

The wrapper only removes a lock after successfully creating it. Forwarding
interruptions and awaiting the gate precede cleanup. Do not delete stale locks
from another session; tell Francisco if ownership cannot be resolved safely.
Capture actual durations and name any >2x median of the last five gate runs.
Baseline reds outside US-073 are reported, never silently repaired or promoted
into new work. Set up pnpm install --frozen-lockfile and required environment
without exposing secrets; record any setup restart as same implementer session.

## Task 3 — Gates, fresh adversarial challenge, cold campaign and closure

**Production sources:** none except named pre-campaign review fixes.
**Consumes:** reviewed Tasks 1–2, collected previews, exact frozen base/candidate.

- [ ] Implementer runs locked full caffeinate pnpm check, lint:tests,
  validate:routes, validate:sidebar, check:generated-guidance, readiness:check
  US-073 and test:feedback-order. Prove fresh committed-migration apply and
  verify-schema, plus existing parity gate under ledger_owner with ledger_app
  runtime checks. Never drizzle-kit push as release proof. Record candidate,
  commands, exit codes and sanitized durations; no secret URLs in reports.
- [ ] Reused reviewer closes scoped review and signs off retained preview
  survivors, one line each. Controller records build_pass only from actual
  returned evidence, appends timestamped phase transitions and brief decisions.
- [ ] Controller marks focused_verification before AC verification, spawns one
  fresh adversarial reviewer with canonical AC1–4, frozen-base..candidate diff,
  exact focused commands and the real fixture/action/browser paths. It tries to
  break role/capability/company limits, mixed A/B refusal, null session,
  actor/note/request ID, all-company demo, duplicates/concurrent conflicts,
  open/closed/multi-assignment behavior, rollback and submitting/error/retry UI.
  Return one evidence-backed verdict per AC. Controller appends ac_verify only
  for proven passes; failed checks return to the same implementer, commit fixes
  and reverify through the same adversarial reviewer. Count review_fix_loops.
- [ ] After all source/test fixes and final preview findings are resolved,
  controller marks integration and implementer runs one authoritative cold
  campaign last, without MUTATION_SHARD:

```bash
rtk proxy pnpm mutation:cache:clear
rtk proxy env MUTATION_BASE="$US073_BASE" MUTATION_WORK_ID=US-073 \
  caffeinate -i pnpm test:mutation
```

  Require >=80% killed and no undisclosed routing gaps. Retained survivor
  annotations are exactly `<mutant-id> <file>:<line> @equivalent: <reason>` or
  reviewer-agreed `@accepted: <reason>`. No separate equivalence report or
  counterfactual log. Controller emits one test_report with measured score,
  killed/survived and wall seconds; do not emit preview test_report.
- [ ] Freeze scored source/tests/config/dependencies after campaign. Any unavoidable
  scored edit requires explicit mutation_invalidation and honest extra attempt
  count; never silently reuse invalid evidence or relabel a cold run as preview.
- [ ] Update readiness actuals with nonoverlapping active phase envelopes,
  total/variance, changed paths vs frozen authority base, reachable item commits,
  loops/cold attempts/invalidations, mutation time/shards and preview rounds/
  minutes. Exclude approval/idle waits and sibling work. root_cause names
  source/ref/timestamp capture, rounding and each verification-budget exception.
  Include one implementer cost/session-count line and one reused-reviewer line;
  include fresh adversarial review cost separately. Measure from harness
  transcripts where exposed, otherwise label numeric estimates; no all-zero cost.
  Controller remains <=3 sessions and about 200K context ceiling; forced
  implementer restart resumes the same worker and is recorded as restart.
- [ ] Append cost-provenance feedback immediately before done. done.cost contains
  calls/context_tokens/output_tokens/model/window only; include real numbers
  or explicitly labeled estimates, not unavailable zeros. Bind done to the
  scored source SHA and valid actuals. Commit readiness actuals and all evidence
  together with US-073, validate terminal readiness and feedback order.
- [ ] Integrate sequentially under Francisco's standing authorization. First
  sibling to close fast-forwards into chg-070 via Git from its worktree; no
  direct commit and no merge commit. If US-074 is already integrated, rebase
  only US-073 commits onto new chg-070, preserve BOTH ledger streams in ts order,
  append deviation mapping every rewritten SHA (CHG-066/86c4726 precedent),
  rerun readiness:check and pnpm test:feedback-order, then fast-forward. Do not
  rewrite US-074 commits. Docs-only rebase preserves scored content; if source/
  tests/config/deps conflict changes scored inputs, record invalidation and
  rerun required verification instead of claiming unchanged evidence.
- [ ] After any Nous sync, inspect testing/critical-paths.md and restore unowned
  changes before committing (IMP-434). Do not hand-edit generated TESTING.md §3;
  existing tenant/auth/audit paths cover this behavior. Any required generated
  inventory reconciliation is a deviation for Francisco/Nous, not new scope.
- [ ] Tell Francisco US-073 is locally done with evidence and transcript/cost
  handoff. Nous pulls and syncs; when US-074 also completes, US-027 closes by
  verification in the US-021 shape. Do not mark US-027 or CHG-071 complete here.

## Self-review and handoff

AC1 maps to Task 1 actor/note/audit/authorization and Task 2 selection/modal;
AC2 to Task 1 partial UNIQUE/retry/request-ID/concurrency;
AC3 to Task 1 whole-batch company/role refusals and Task 2 filter propagation;
AC4 to both real action demo and rendered browser-to-DB demo, then Task 3 fresh
adversarial challenge. Interfaces use the same snake_case command and count
result throughout; persistence does not receive client_request_id. The service
catch only rethrows, operations delegates and factory maps errors, preserving
existing audit enforcement. No shared classifier/read model/worker edits or
new route/migration is planned. Both implementation tasks name production
sources and have focused-green, commit and post-task preview/review boundaries.
All code blocks are instructions for the implementer; none ran in the controller.
Execution remains pending Francisco's approval of this plan's exact digest.
