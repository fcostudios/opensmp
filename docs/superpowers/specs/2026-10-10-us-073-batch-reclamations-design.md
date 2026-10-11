# US-073 — Batch reclamation proposals from SCR-usage

**Status:** proposed; readiness approved; design approval pending.
**Readiness:** `docs/readiness/US-073.json`, payload
`6784f0f0562a2fdd70604a097ca227f2f2b553b3e43ba530a8557d84c0add05a`,
230 minutes, approved by Francisco Lomas in this controller conversation.
**Authority:** canonical US-073, approved US-027 partition, CHG-071,
DEC-SMP-027/028, BR-16 and `docs/screens/SCR-usage.json`.

## Outcome and approach

On `/uso`, a Group Admin selects inactive people, reviews the licenses being
proposed, enters an optional note and submits one batch. The service validates
the entire selection before writing, creates pending proposals for the selected
people's open assignments and commits each new proposal with its audit entry.
A repeated or concurrent submission creates no duplicate pending proposal.
The proposal does not withdraw a license or transition its anchor request.

Use a server action with a transaction-level persistence helper in `packages/db`
and a small client selection/modal component within the existing usage view.
This reuses US-072's read model and classification without changing their
sources. Alternatives are an HTTP endpoint (adds a transport without an AC),
a schema-backed request-id store (contradicts DEC-SMP-027), or independent
transactions per proposal (can leave a partial batch after failure). The
existing action and one atomic batch transaction are recommended.

No migration, worker/schedule, request transition, approve/dismiss flow,
dismissal suppression, offboarding or `/reclamaciones` work belongs here.
The screen's existing proposal-navigation prototype is outside this child;
success is reported in the modal on `/uso` without introducing a new route.

## Command, selection and company boundary

The public action is `proposeReclamations(input: unknown)` and accepts this
strict, Zod-validated command, owned by the new usage proposal module:

- `person_ids`: nonempty array of UUIDs, at most 50 unique people; normalize
  UUID case and deduplicate repeated IDs before comparing query results.
- `company_id`: optional UUID copied from the current usage company filter.
- `note`: optional string, at most 2,000 characters; trim, mapping blank to null.
- `client_request_id`: required UUID, normalized to lowercase, accepted and
  recorded only in proposal audit metadata.

Unknown fields and malformed input return `invalid_input`. Actor, role,
capability and authorized company scope come only from the current DB-backed
LedgerAuthorization loaded by the server action. No client-supplied user,
role or scope grants authority. Refuse missing authorization and any role other
than `group_admin`, and require `company:write` for every resolved company.
Use the existing companyScope/hasCapability rules and the verified
`authorization.companyIds` enumeration when restricting person/assignment
ownership; empty permitted scope refuses the batch.

The existing global Group Admin authorization grants all companies. Therefore
another legitimate company is allowed on the all-companies screen. An explicit
company filter narrows this command: every selected person and assignment must
belong to that company. With company A selected, adding a company B person
refuses the entire batch, including valid A people. Nonexistent people,
unauthorized company filters and foreign/mismatched person-assignment company
joins also refuse as `access_denied`, without leaking foreign labels or IDs.
This follows US-072's company-filter semantics and preserves the three-company
prototype. It does not redefine the shared global-admin policy.

Selection is person-based. Each inactive row gets a labeled checkbox; rows for
the same person share selection state. A person qualifies for visible selection
when at least one currently displayed row has `classification === "inactive"`
or `anchorState === "flagged_inactive"`. Other rows for that selected person
reflect the same checkbox state. Selection is local to the current page/filter;
a changed filter or cursor resets it. There is no selection across unseen pages.

Submitting resolves all currently open assignments for those selected people,
within the command's company boundary. This includes multiple open licenses
for one person; the modal states that selection proposes all their open
licenses. A summary uses the existing read model to show selected people,
companies and displayed open licenses; it distinguishes displayed licenses from
the authoritative server result if the person has rows on another page.
Server enforcement depends on authorized people and open assignments, rather
than requiring a persisted flagged state: US-073 must work before US-074 ships,
and inactivity is already a read-model classification. This action neither
reimplements that classification nor silently changes flags. If any selected
person has no remaining open assignment, refuse the whole batch as
`selection_changed` and ask the user to refresh the usage screen.

Successful result: `{ status: "success", created: number, existing: number }`,
where existing is selected open assignments for which a pending proposal already
exists. Refused result: `{ status: "error", code: "invalid_input" |
"access_denied" | "selection_changed" | "unexpected" }`. No foreign data or
stack trace crosses the action boundary. A retry with a different note/request
ID leaves an existing proposal and its original audit untouched.

## Transaction and persistence

`packages/db/src/reclamation-proposals.ts` exposes a helper taking the shared
Drizzle transaction, verified allowed company IDs, optional selected company,
normalized person IDs, actor, note and injected time. It resolves persons with
explicit company filters, compares the complete requested set with resolved
persons before writing, then resolves their open assignments through matching
person/company ownership. Lock persons and assignments in stable UUID order;
assignment row locks serialize concurrent close operations until commit, so
only assignments open at the write boundary are proposed. Do not lock or
update LicenseRequest: US-074 owns its transitions. No soft-delete predicate is
invented on tables without a declared column.

Insert pending proposals with `proposed_by = authorization.userAccountId`,
`proposal_note`, `created_at` and `assignment_id`. Use `ON CONFLICT
(assignment_id) WHERE status = 'pending' DO NOTHING RETURNING ...` against
`reclamation_proposal_one_pending_per_assignment` in committed migration
`V20260725180000__core_schema_register_integrity.sql`. The database constraint
is the final arbiter, including concurrent submissions; a check-then-insert
alone is insufficient. An approved/dismissed historical proposal is not a
pending conflict. Dismissal suppression is still US-028's separate policy.
The helper returns newly inserted rows plus their trusted company ownership
and the number of already-pending assignments. It never stores client_request_id.

`createReclamationProposalService(database, { now })` owns the transaction and
calls existing `withAudit(database, callback, { occurredAt })`. For a nonempty
insert result, build one `AuditRecordInput` per new proposal. Use the first as
the callback's required audit result; insert the remaining audit entries into
the same transaction using existing `redactAuditValue`, the same injected time
and identical audit field semantics. This avoids changing the shared singular
withAudit contract or emitting a separate batch audit. The action/service trace
must remain recognized by audited-actions enforcement.

Each audit has action `reclamation.proposed`, entityType
`ReclamationProposal`, entityId equal to the new proposal ID, its assignment's
companyId, actorUserId equal to the authenticated admin, note equal to the
proposal note, before null and after containing assignment_id, proposed_by,
status pending, proposal_note and client_request_id. One new proposal means
exactly one audit entry. Retry conflicts emit no new proposal audit.

When the entire selection already has pending proposals, the callback throws a
private no-new-proposals result carrying the success counts before withAudit
can insert its singular audit. The transaction rolls back its read-only/no-op
work. The state-returning server-action factory catches failures through a pure
imported result mapper that recognizes only that private result as a successful
no-op; all other failures refuse or return unexpected. The audited service
uses the existing checker-recognized shape: an injected-clock declaration,
then a try containing only `return await withAudit(...)`, and a catch containing
only a synchronous local error mapper call that rethrows. The operations
member directly delegates to the audited service without a catch. The
server-action factory owns the state-result catch, following the delivered
vendor-account pattern; it cannot perform writes in its mapper. A no-op needs
no revalidation because it committed no mutation. If insertion
of any proposal audit fails, the transaction rolls back every new proposal and
audit. No broad catch converts an actual persistence failure into success.
The implementation plan will pin this control flow and the recognized audit
trace before execution; it will not broaden the enforcement checker.

## Screen, action and module contracts

`apps/web/src/app/(authenticated)/uso/actions.ts` exports the server action.
It delegates through the established authorization-and-audit action composition
pattern, loads current authorization, invokes the proposal service and
revalidates `/uso` on success. Factory-based tests inject a real authorization
repository and database, plus a local revalidation observer; production uses
loadCurrentLedgerAuthorization and revalidatePath. No mock replaces our auth,
persistence or service code.

The proposal command/result types and schema live under
`apps/web/src/modules/usage/`; they are imported by the action/service and
client view with type-only imports where needed. The persistence helper uses
schema-derived proposal/assignment types; add its package export without
changing existing exports. API shape is defined above before the UI consumes it.

Keep UsageView's current cards, filters, labels, table and freshness behavior.
Add a client selection component around the table/action area; its selection,
note and submission state use one component-scoped Zustand store, with no
Context provider or shared global store. Reset the store when the company,
window or cursor changes. All visible copy goes in existing
en-US/es-EC locale catalogs and uses existing design tokens. Reuse the local
dialog primitive/pattern with a heading, selected summary, optional note,
cancel and submit controls, accessible checkbox labels, keyboard focus and
live status/error messages. Keep `modal_propose_reclamation` and
`btn_send_proposals` test IDs from the screen. The batch CTA reads
"Proponer reclamación" in es-EC; the submit label is "Enviar propuestas".

No selection disables the batch CTA. Submitting freezes selection/note controls
and disables duplicate clicks. Generate one request UUID when preparing the
batch; preserve it across retries until selection/note changes or the dialog
closes. Success reports created/existing counts and clears selection when the
user closes the result; errors retain selection/note for retry. A no-op retry
is a successful result with zero created. A thrown transport failure produces
a localized retry message and releases submitting state. No navigation change
is needed. Empty usage rows render the existing empty state with no active CTA.

## Acceptance and verification

AC1: real service/action and rendered modal create proposals for three selected
flagged people, preserving note, actor and one audit per new assignment. Also
exercise one person with multiple open assignments, an ended assignment,
blank note, validation limits and audit rollback. Audited-actions enforcement
must recognize proposeReclamations without a read-only exemption.

AC2: deterministic repeated requests and two real concurrent transactions prove
one pending proposal and one audit per assignment. Different request IDs/notes
do not overwrite pending proposals. Query proposal schema/data to confirm no
client_request_id persistence; audit metadata includes the first request ID.
Historical non-pending proposals do not collide. No migration changes.

AC3: under company A selection, mixed A/B person IDs reject the entire batch
with proposal/audit counts unchanged. Also constrain unauthorized/missing
companies, person/company join mismatch, empty verified company scope, null
session and each non-group_admin role. Legitimate all-companies Group Admin
batches may span companies and audit each under its own company.

AC4: one deterministic real DB-backed demo exercises three people, note,
resubmit, foreign-company injection and wrong role through the actual action
factory; rendered behavior proves the modal invokes that factory with the
selected people, company filter, note and request ID. Do not mirror large
implementation objects or add coverage-only tests. Use the strongest small
contract oracle for each observable failure; inject time and seed data.

Tests use real committed-migration PostgreSQL fixtures under ledger_app for
transaction, concurrency and tenant seams; PGlite is allowed for compatible
focused persistence tests but cannot replace the real concurrency oracle.
Test fixtures belong to US-073 and do not modify the US-072 shared fixture.
Tenant isolation/authorization/audit are already TESTING.md §3 paths; generated
inventory additions require Nous ownership, never a hand edit. Record any
required inventory reconciliation as a deviation for Francisco.

The approved plan will split independently reviewable deliverables, name every
production source and preserve the consolidated shape: one implementer,
checkpoint commit per task, one reused scoped reviewer and a fresh adversarial
AC reviewer. Background previews select post-task touched shards; tasks+1
rounds, <=30 minutes, slow shards final-only unless touched. Serialize every
full caffeinate gate with an atomically acquired /tmp/smp-full-gate.lock and
owner-only cleanup. Complete full DoD and adversarial AC verification, commit
all fixes, then run one cold campaign last. Freeze MUTATION_BASE after entry
approvals and record it; keep scored source/tests/config unchanged after it.

Append actual UTC phase markers and real measured costs where exposed, labeled
estimates otherwise. Closure includes preview rounds/minutes and one cost line
each for implementer/reviewer with session counts. Concurrent US-074 integration
is sequential fast-forward; if second, preserve both ledgers in timestamp order,
record the rebase SHA map and revalidate readiness/feedback order. Inspect
critical-paths.md after any Nous sync and restore unowned changes (IMP-434).
