# US-074 — Daily inactivity flagging

**Status:** proposed; Francisco design approval pending.
**Readiness:** docs/readiness/US-074.json, approved by Francisco Lomas;
payload SHA-256 d82de66f84aa6b8f4e3f22d1a7769ccb1ef3b8bc7bfbdef8b333e110df9ddf46;
260 minutes. Decision US074-READINESS-20261011.
**Authority:** US-074 AC1–AC4; parent US-027 AC2 state side and AC3;
DEC-SMP-026/028; BR-16 and BR-15; CHG-070 adopted session shape.

## Approach and alternatives

Add one daily pg-boss job to the existing worker, backed by tenant-scoped
persistence in packages/db. Reuse evaluateInactivity and
hasPositiveVendorActivity from @smp/domain/usage/inactivity unchanged.
The job changes anchor request state, with atomic transition and audit writes.

Recommended: existing schedule/runtime composition, a small worker adapter and
DB repository. SQL-only classification would duplicate US-072 policy; placing
the job in the web usage repository would couple background mutation to UI
permissions and US-073-owned files. Neither alternative is selected.
No migration, proposal creation, connector call or deprovisioning is needed.

## Schedule and worker contract

JOB_SCHEDULES.inactivityFlagging uses queue inactivity-flagging and daily cron
45 10 * * * in UTC (05:45 America/Guayaquil), after analyticsSync at 10:15 UTC.
The schedule describes daily ordering by scheduled time; separate pg-boss
queues do not guarantee that a slow analytics execution has finished. The job
reads committed activity, and its lag-aware watermark remains authoritative.
It never substitutes wall-clock age for unavailable or delayed analytics.

Add a distinct daily inactivity-flagging:YYYY-MM-DD key and a two-day runtime
idempotency window, consistent with analyticsSync. Register and dispatch through
the existing runtime and deferred handlers. Missing runtime services keep the
existing dependency-not-delivered behavior; normal execution closes its owned
pool in finally and reports the number of successful state changes.

Worker API: createInactivityFlaggingJob({ connectionString }) returns
{ drain(at): Promise<{ processed: number }>, close(): Promise<void> }.
The injected at supplies evaluation date and transition/audit timestamps.
DB API: a repository built from the shared Drizzle schema/client adapter exposes
runForCompany({ companyId, evaluationDate, occurredAt }): Promise<number>.
A worker-owned pg Pool wrapped with Drizzle follows existing worker practice;
no alternate ORM, schema or web DB singleton connection is introduced.

## Evidence and candidate selection

Enumerate companies as trusted worker scope, without a company-status filter,
then process each company
explicitly. Each query/write on tenant-owned rows constrains company_id.
Open assignment means ended_on IS NULL, consistent with the usage read model.
Its anchor is source_request_id, matched on company, person, vendor account
and license type; a missing anchor is skipped. Closed assignments and requests
outside active/flagged_inactive are untouched. Deduplicate anchors so multiple
candidate rows cannot create duplicate evidence.

Account data-through is MAX(activity_date) across that vendor account's
committed observations, including zero/null counters, matching US-072. This is
account-wide freshness rather than a company watermark: activity_record is
scoped by account/person, and per-person activity joins to the scoped person.
Last positive activity is the latest date recognized by
hasPositiveVendorActivity for that person/account. No signal crosses account
or company boundaries. A later zero/null observation does not erase earlier
positive activity. Unknown activity remains no_data. Resolve the account watermark and last-positive
observations in one consistent SQL statement/snapshot. Never use two independent
READ COMMITTED statements that can observe different analytics commits.
Candidate discovery may be stale; recompute this evidence after acquiring the
mutation locks so a waiting candidate uses the latest committed observations.

Call evaluateInactivity with window 30 for every person/account. Its inactive
classification permits active -> flagged_inactive; its active classification
permits flagged_inactive -> active. no_data permits neither transition.
Threshold is strictly more than 30 days; 60/90 are display-only. Return to
active requires known activity within the shared 30-day classification.

## Atomicity, retries and races

Use one DB transaction for the candidate request's conditional state update,
RequestTransition and audit_log insert. Acquire locks in a fixed order: scoped person FOR NO KEY UPDATE, qualifying assignment
FOR UPDATE, then anchor request FOR UPDATE, with stable ID ordering within
each class. Use one candidate transaction at a time so retained locks preserve
this order. The person lock blocks company transfer while permitting the KEY
SHARE foreign-key checks used by cross-org move inserts, preventing an
assignment/person lock cycle. Re-read after
locking and confirm the person/company relationship, open assignment, anchor
identity and expected request state immediately before mutation. Do not hold
request locks while acquiring earlier person/assignment locks. Concurrent
assignment closure or person transfer must finish first or wait behind these
locks; a stale qualifying row is skipped. Use READ COMMITTED transactions with
post-lock rechecks and one-statement activity evidence, avoiding stale snapshot
writes. A manual
winner or a closed assignment yields a skipped candidate. Only a successful
UPDATE can create evidence. Reuse applyRequestTransitionInTransaction for
its tenant filter and transition/audit writes where possible; any addition
must preserve manual callers' existing conflict behavior. A job-specific
wrapper may return false for an expected-state mismatch before calling it.
Do not swallow unrelated SQL, validation or audit failures.

Audit actor is null for the system job, action request.flagged_inactive or
request.active, entity LicenseRequest, with before/after state and a note
identifying inactivityFlagging and the data-through/activity evidence.
Failed inserts roll back state and transition together. A retry after partial
progress sees the already changed state and creates no duplicate evidence.
Two jobs or a manual transition serialize through the same request row;
the loser observes the winning state and skips or rejects cleanly.
No proposal, assignment end or provisioning/offboarding operation is performed.

## Verification and session shape

Use meaningful real-DB oracles: 31/30/29 days before data-through, lag-only
inactivity, zero/null and metadata counters, no history, renewed activity,
other states, closed/unanchored assignments, mismatched scope, same person
across accounts, and another company's sentinel rows. Compare state plus
transition/audit deltas and proposal counts. A rerun must change nothing.
Use deterministic two-connection request locks to prove both manual/job
orderings, without sleep-based race timing; additionally prove concurrent assignment
closure and person/company transfer cannot produce a stale flag. Verify audit
failure rollback.
Prove schedule registration and actual handler dispatch using the existing
runtime real-DB seam. Shared CHG-067 Postgres fixtures only, never private
containers. Read TESTING.md before touching tests; update its critical-path
section only if this work changes a declared critical path.

After this design's approval, produce the readiness-bound implementation plan
and request its separate approval. Freeze and record the mutation base only
after all entry approvals. One implementer owns all tasks and checkpoint
commits. One reused scoped reviewer and one fresh adversarial AC reviewer;
controller briefs and decides. Implementer launches touched-shard background
previews after focused-green: tasks+1 rounds, <=30 preview minutes, slow shards
final-only unless repairs touched them. Gate lock /tmp/smp-full-gate.lock is
exclusive across US-073/074; caffeinate -i pnpm check owns it until cleanup.
Adversarial AC1–AC4 and all repairs precede one cold campaign, then evidence
and terminal closure only. Record timestamps, preview actuals, session counts,
measured/estimated costs and reviewer/implementer cost lines.

US-073-owned web/proposal persistence stays untouched; shared classifier and
usage read model are read-only. Any required shared change needs a deviation
and coordination through Francisco before commit. Integration fast-forwards
first sibling; second rebases, preserves both ledgers in ts order, records SHA
map, runs feedback-order and readiness checks, then fast-forwards. After any
Nous sync inspect testing/critical-paths.md and restore unsolicited changes.

## Scoped design review

The reused reviewer /root/us074_reviewer required consistent activity evidence
and race-safe assignment/person rechecks. Both are incorporated above. Company
enumeration has no status restriction, preserving AC1 every-open-assignment
coverage. The reviewer confirmed strict thresholds, shared policy, known-activity
unflagging, account/company matching, atomic evidence, and no proposals or
deprovisioning. Separate cron queues provide scheduled-time ordering only. The second scoped
review approved the corrected design provided the person lock is explicitly
FOR NO KEY UPDATE; that mode and one-candidate transaction lifetime are now
specified. Implementation must prove these races; static review is not evidence
that AC4 has passed.
