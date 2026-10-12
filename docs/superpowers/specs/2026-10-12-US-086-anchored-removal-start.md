# US-086 anchored removal start design

US-086 delivers one authorized seat-removal start from person or request detail. Existing US-075 production is carried forward; this delivery repairs canonical repeat refusal and demonstrates the inherited entrypoint with effective real-DB and UI oracles.

Authority: Francisco approved readiness `9a4a88e0e8a41ef1c6848d9b4971969206a30a90a8e212b7ba269e3b0fc39f1e`, recorded by `US086-READY-FRANCISCO-20261012` in `30b2eca`. His standing delegation authorizes design, planning and implementation within that scope and230-minute budget. The canonical story and readiness govern; this design adds no policy ruling.

## Production contract

`executeOffboardingIntent(repository: PeopleRepository, authorization: LedgerAuthorization | null, input: unknown, occurredAt?: Date)` remains the production-used intent executor. `read_targets` returns only authorized active anchored requests and no invalidation paths; malformed intents, invalid targets and authorization refusals produce no writes. Successful mutation returns the existing offboarding action response and person/request revalidation paths. `startOffboardingService` loads current database authorization and applies those paths.

The repository accepts only `left_company` and `inactive`; `reallocated` returns `person_offboarding_transfer_required` under DEC-SMP-040/BR-02. Within one transaction, the exact company/person/request/assignment anchor is validated, the active request is locked, the persisted capability descriptor selects automated or orchestration execution, and one pending `remove` action, one active-to-offboarding transition and the existing audit pair are written. The injected transition instant anchors BR-14. Person.status, assignments and capacity remain unchanged. No provider dispatch occurs.

The inherited matching-offboarding replay branch currently returns success. Canonical AC2 now requires refusal. The implementation will return `person_offboarding_unavailable` for an already-offboarding request, with no additional transition/action/audit or cache invalidation. A simultaneous pair on an initially active request has one winner; the loser rechecks locked state and receives the same refusal. Completion replay semantics belong to US-087 and are not changed.

## UI and assurance

Both screens consume the existing `PersonOffboarding` component: person detail discovers authorized targets through the actual executor; request detail supplies its own fixed request ID. A note and anchored target are required. Only the two removal reasons appear. Loading and pending states prevent submission; failed discovery remains retryable; defaults come from existing next-intl messages. A refusal retains usable selection/note state and renders the appropriate existing translation. Success identifies the pending removal request rather than claiming deprovisioning.

Tests exercise actual components, the production intent executor, database-loaded authorization and the real shared PostgreSQL fixture. Deterministic scheduling barriers may delay delivery of actual executor results, but cannot replace owned services with canned outputs. The clock is injected at the existing seam. Every tenant refusal asserts durable counts and unrelated-seat preservation. Tests are motivated by observed live mutants, not coverage volume.

## Inherited evidence and scope

The accepted SHA map preserves mutation authority `37666528d03a50e2529cad4382f2a5ae146dca63` → `783d09df4467e27462dec440cc64ac4855d02e02`; candidate `9048f6b` → `47e599f7`. The postapproval entry checkpoint is recorded separately and cannot replace that authority base.

The native inherited diff discovers seven shards. Three entry shards belong to US-086: repository/service, person component and request-record. Completion domain/orchestration/wrapper shards belong to US-087; audit belongs to closed CHG-081. Run one full native cold campaign last without synthetic baselines or filters, retain all reports/exit status, and derive the US-086 report from the exact three source-owned entry shards. Own score must meet80%; every retained survivor needs a reviewed annotation. A foreign completion failure is named as a deviation; it cannot be reported as whole-campaign green or borrowed for US-086. Stock full gate and all own ACs must pass.

Only the15 delivery and4 bookkeeping paths in approved readiness are authorized. No tooling/router, migration, generated TESTING/critical-path registration, provider worker, finalizer, departure-state, calendar job or capacity projection edits. A new path/boundary/material repair burden requires reassessment.

## Budget and execution

Prospective phases: readiness25, implementation60, focused40, review50, integration55 =230 minutes. Existing parent255.0026 minutes and its failed/invalidated campaigns remain charged once historically; child execution does not reset or recount them. Track non-overlapping phases and explicit estimated role costs when telemetry is unavailable.

One implementer performs both tasks with a green checkpoint each; one reused scoped reviewer checks both, and a fresh reviewer adversarially verifies AC1–3. Touched previews run in the background after focused green, at most one round per task plus one final fix wave, ≤30 minutes; slow untouched shards run only in the final preview. Stock shared PostgreSQL and owned `/tmp/smp-full-gate.lock` protect `caffeinate -i pnpm check`. Foreign locks are waited on and never removed. Keep the host awake and preserve evidence/cost for failed attempts.
