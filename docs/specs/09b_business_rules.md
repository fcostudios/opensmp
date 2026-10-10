# 09b — Business Rules: Ledger (`fcostudios__smp`)

**Step:** 9b — Business Rules · **Date:** 2026-07-22 · **Report language:** en-US
**Inputs:** PRD §8/§10/§11/§15 · `08_scope.md` ACs · `04_er_model.md` invariants · mined rule-candidate checklist (129 items, `_step8_coherence_pack.json`) · DEC-SMP-009/014/015/016.
**Contract:** each rule declares enforcement layer, oracle (strongest available per the TE standard), criticality (HR-48 governance), and governing stories (`Business Rules` Meta rows in the 10b files create the `governed_by` edges).

**28 rules; critical set:** BR-01, BR-02, BR-03, BR-04, BR-08, BR-11, BR-12, BR-14, BR-17, BR-18, BR-20, BR-22.

### BR-01 — Register no-overlap (one seat, one holder, one period)

**Statement.** No two LicenseAssignment rows for the same (person, vendor account, license type) may overlap in date range. Open rows (`ended_on IS NULL`) count as unbounded.

- **Parameters:** —
- **Enforced at:** database (EXCLUDE USING gist, btree_gist)
- **Oracle:** exact (constraint-violation test: overlapping insert MUST be rejected)
- **Critical:** YES
- **Governed by stories:** US-003
- **Verification:** Migration test inserts an overlapping row and asserts rejection; Hypothesis property test over random date ranges.

### BR-02 — Every assigned seat-day belongs to exactly one company

**Statement.** Transfers close the old row and open the new with contiguous dates (successor starts ≤ ended_on + 1 day when end_reason=reallocated, enforced by a deferred constraint trigger); the close re-verifies gap/overlap freedom as defense-in-depth.

- **Parameters:** —
- **Enforced at:** database (deferred trigger) + close-run validation
- **Oracle:** exact (worked transfer example) + property (no gaps/overlaps across generated histories)
- **Critical:** YES
- **Governed by stories:** US-003, US-034, US-047
- **Verification:** Trigger test: non-contiguous reallocation rejected at commit; close-run test asserts seat-day partition sums.

### BR-03 — Audit log is append-only at the database level

**Statement.** The application role holds no UPDATE/DELETE grants on audit_log; every mutation writes an audit row (actor, before/after, note when mandated) in the same transaction.

- **Parameters:** —
- **Enforced at:** database (grants) + audit port
- **Oracle:** exact (UPDATE attempt fails; mutation without audit row fails CI lint)
- **Critical:** YES
- **Governed by stories:** US-003, US-008
- **Verification:** Grant test executes UPDATE as app role and asserts failure.

### BR-04 — Only legal state-machine transitions execute

**Statement.** LicenseRequest.state changes only along the §10 graph (incl. provisioning→failed→provisioning retry; approved→blocked_no_seat; terminal deprovisioned/rejected). Every transition persists a RequestTransition row.

- **Parameters:** —
- **Enforced at:** domain engine (request-workflow)
- **Oracle:** exact (transition table test: full legal/illegal matrix)
- **Critical:** YES
- **Governed by stories:** US-014
- **Verification:** Matrix test over all state pairs; illegal pairs rejected; transition rows asserted.

### BR-05 — Duplicate active license is blocked at intake

**Statement.** A request for a person who already holds an open assignment for the same (vendor account, license type) is rejected at submission with a pointer to the existing assignment.

- **Parameters:** —
- **Enforced at:** server action validation
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-012
- **Verification:** Submit-duplicate test asserts block + link payload.

### BR-06 — Budget headroom warns, never blocks

**Statement.** The intake budget check compares committed run-rate + new license rate against Company.budget_monthly_usd and may only warn ('sin tarifa' when no RateCard row exists). It must not prevent submission.

- **Parameters:** budget_monthly_usd per company
- **Enforced at:** server action (soft)
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-012
- **Verification:** Over-budget submission succeeds with warning flag.

### BR-07 — Rejections carry a mandatory comment; decisions are attributed

**Statement.** decideRequest(reject) requires a non-empty comment; approve/reject records decided_by, decided_at, decision_comment.

- **Parameters:** —
- **Enforced at:** server action validation
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-015
- **Verification:** Reject-without-comment rejected.

### BR-08 — Approval aging: reminder at 24 h, escalation at 48 h; decision target 2 business days

**Statement.** Pending requests trigger an approver reminder at 24 h and a Group-Admin escalation naming request/company/approver at 48 h (both configurable); queue surfaces breach state past 2 business days (business-day calendar).

- **Parameters:** aging thresholds in AlertRule (24h/48h); 2bd target; reminder + escalation via the 15-min alert-eval job; fire-once-per-breach on first run after threshold (dedupe)
- **Enforced at:** job (alert eval, 15-min cadence) + UI chip
- **Oracle:** exact (clock-injected job test)
- **Critical:** YES
- **Governed by stories:** US-017, US-015
- **Verification:** Frozen-clock test at 23h59/24h01/48h01 asserts exactly-once sends.

### BR-09 — Provisioning attempt within 15 minutes of approval

**Statement.** An approved request with free pool must have its invite ProvisioningAction created ≤ 15 min after approval (automated mode).

- **Parameters:** 15 min
- **Enforced at:** job cadence + engine
- **Oracle:** property (approval→invite latency under simulated queue)
- **Critical:** no
- **Governed by stories:** US-019
- **Verification:** Latency test with injected clock.

### BR-10 — Pool math: free = purchased − open assignments − pending invites

**Statement.** Per (vendor account, license type): free seats derive from the latest effective VendorAccountCapacity minus open register rows minus pending invite actions. Never stored, always derived.

- **Parameters:** —
- **Enforced at:** read-model
- **Oracle:** exact (fixture reconciliation)
- **Critical:** no
- **Governed by stories:** US-022
- **Verification:** Fixture with known counts asserts gauge values.

### BR-11 — Low-pool alert below the per-org floor

**Statement.** free < low_pool_floor (default 5, per-org override) raises the low_pool alert once per breach window.

- **Parameters:** low_pool_floor default 5
- **Enforced at:** alert job
- **Oracle:** exact
- **Critical:** YES
- **Governed by stories:** US-022
- **Verification:** Threshold-crossing test with dedupe assertion.

### BR-12 — Blocked requests are never dropped; review within 1 business day

**Statement.** Pool-empty (or vendor 400) moves the request to blocked_no_seat, notifies requester + Group Admin, opens a purchase-or-reclaim task, and re-alerts if the task is unresolved > 1 business day.

- **Parameters:** review window 1 bd
- **Enforced at:** engine + alert job
- **Oracle:** exact
- **Critical:** YES
- **Governed by stories:** US-023
- **Verification:** 400-simulation test asserts state+alert+task; aging re-alert clock test.

### BR-13 — Invite hygiene: 7-day alert, auto-withdraw frees the seat

**Statement.** Invites unaccepted > 7 days alert; after the configurable auto-withdraw window the invite is withdrawn, the seat returns to pool math, and the requester is re-notified.

- **Parameters:** `AlertRule(type=invite_unaccepted).threshold` = `{"hours": 168, "auto_withdraw_after_hours": null}` — alert strictly older than `hours` (7d); `auto_withdraw_after_hours` null = automatic expiry DISABLED (default), when set an integer strictly greater than `hours`; withdrawal is invitation-only (never removes an active member or LicenseAssignment; acceptance wins a race) — DEC-SMP-023
- **Enforced at:** job
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-021, US-067, US-068, US-069
- **Verification:** Clock test over invite lifecycle.

### BR-14 — Departure deprovisioning completes same business day

**Statement.** Offboarding for end_reason=left_company must reach deprovisioned (removal executed or checklist confirmed) within the same business day; breaches alert.

- **Parameters:** same business day; alert type `deprovision_overdue`
- **Enforced at:** alert-eval job (deprovision_overdue) + email
- **Oracle:** property (SLA over simulated calendars)
- **Critical:** YES
- **Governed by stories:** US-024, US-042
- **Verification:** Business-day calendar test incl. weekend edge.

### BR-15 — Reclamation requires consent; dismissal suppresses re-proposal

**Statement.** Never silent removal: no seat is freed for inactivity without an approved ReclamationProposal (approver or Group Admin decides). Dismissal requires a keep-note and suppresses new proposals for that assignment until a NEW inactivity window elapses after the dismissal date.

- **Parameters:** suppression = next full window post-dismissal
- **Enforced at:** domain (register module)
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-028
- **Verification:** Dismiss→repropose-too-early rejected; post-window allowed.

### BR-16 — Inactivity windows are 30/60/90 days on vendor activity; no automated action on activity data alone

**Statement.** Flags derive from the vendor's active-user definition over ActivityRecord; inactivity is counted against a lag-aware `data_through` date (the latest synced `activity_date` of the person's vendor account, or the evaluation date − 3 days when the account has never synced — DEC-SMP-026), so the ~3-day lag never shows as inactivity; a daily job flags the anchor LicenseRequest `active → flagged_inactive` at the 30-day window and returns it to `active` when activity resumes, while 60/90 days are display filters only and the job creates no proposals (DEC-SMP-028); flags NEVER auto-deprovision (BR-15 gates action).

- **Parameters:** windows 30/60/90d (flag at 30d; 60/90d display-only); lag ~3d absorbed by `data_through` (DEC-SMP-026); un-flag on renewed activity (DEC-SMP-028)
- **Enforced at:** telemetry read-model
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-027, US-072, US-074
- **Verification:** Window boundary tests at 29/30/31 days with lag offsets.

### BR-17 — Proration is daily actual/actual with exact mid-month boundaries

**Statement.** License-day charge = monthly_rate × (days held / actual days in month). A transfer effective day D charges the old company through D−1 and the new from D; the person appears on both statements with dates; seat-days across the split sum exactly.

- **Parameters:** daily actual/actual
- **Enforced at:** close computation
- **Oracle:** exact (PRD §11 worked example: transfer on the 10th → period_to = 9th / period_from = 10th)
- **Critical:** YES
- **Governed by stories:** US-034
- **Verification:** Oracle test with the §11 example + property test: split sums equal unsplit totals for random transfer dates.

### BR-18 — Close is deterministic and idempotent; finals are immutable

**Statement.** Re-running a close recalculates DRAFT statements only, byte-identical for identical inputs; final statements never mutate — later corrections are adjustment lines (with mandatory note) on the next draft period. The draft→final flip (`finalizeStatements`/`finalizeStatement`) is server-rejected for any actor whose `global_role ∉ {central_finance, group_admin}`.

- **Parameters:** —
- **Enforced at:** close engine + status guard
- **Oracle:** exact (double-run hash comparison) + golden (fixture statement)
- **Critical:** YES
- **Governed by stories:** US-034, US-035, US-050, US-047
- **Verification:** Run-twice test asserts identical drafts; finalize-then-run asserts no mutation; unauthorized-finalize test asserts rejection for approver/company_finance/viewer actors.

### BR-19 — Statements render in the company's language

**Statement.** Statement exports/PDFs use Company.statement_language (default es); UI language is per-user and independent (BR-26).

- **Parameters:** statement_language es|en, default es
- **Enforced at:** export layer
- **Oracle:** golden (per-language fixture PDFs)
- **Critical:** no
- **Governed by stories:** US-037, US-049
- **Verification:** Golden PDFs per language.

### BR-20 — Reconciliation flips to reconciled ONLY within 0.5%

**Statement.** open→reconciled is server-rejected when |rollup − invoice| > 0.5% of invoice total; within tolerance the flip is automatic on saveInvoiceAmount; outside it the only path is overrideReconciliation with a mandatory note (status overridden, actor recorded per DEC-SMP-016). Once status ∈ {reconciled, overridden}, the reconciliation and its ReconciliationVarianceLine rows are immutable — corrections reopen via the next period, never by editing evidence.

- **Parameters:** tolerance 0.5%
- **Enforced at:** server action guard
- **Oracle:** exact (boundary tests at 0.49/0.50/0.51%)
- **Critical:** YES
- **Governed by stories:** US-038
- **Verification:** Boundary triple test + override-without-note rejected; variance-line edit/delete after flip asserted rejected.

### BR-21 — Rate cards are effective-dated and lock once consumed

**Statement.** RateCard rows never overlap per (org, license type); a row consumed by a FINAL close is immutable — corrections are new effective-dated rows.

- **Parameters:** —
- **Enforced at:** server action + status guard
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-032
- **Verification:** Overlap insert rejected; edit-after-final rejected.

### BR-22 — Company scoping is enforced server-side on every query

**Statement.** Every company-owned read/write filters by the actor's permitted company set (CompanyRoleAssignment + global role); viewer grants are read-only; cross-company access yields access-denied, never empty-but-200 leakage of existence.

- **Parameters:** —
- **Enforced at:** authz port (middleware)
- **Oracle:** exact (isolation suite: every owned table × every role)
- **Critical:** YES
- **Governed by stories:** US-005, US-047
- **Verification:** CI isolation suite is the acceptance evidence (PRD §15 highest-severity class).

### BR-23 — Synced figures carry freshness; staleness alerts at 48 h

**Statement.** Every ActivityRecord/CostRecord-derived figure renders its as-of date; sync older than 48 h flips the label to attention and raises sync_stale.

- **Parameters:** staleness 48h
- **Enforced at:** UI + alert job
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-029
- **Verification:** Stale-clock rendering + alert test.

### BR-24 — Console drift is detected hourly and claimed, never absorbed silently

**Statement.** The hourly member sync raises register_drift for console members absent from the register; claiming creates the assignment (source_kind=reconciliation, note mandatory) plus its system-materialized request.

- **Parameters:** hourly
- **Enforced at:** sync job + claim action
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-030
- **Verification:** Injected-drift fixture asserts alert + claim artifacts.

### BR-25 — Credentials are encrypted, masked, and rotate by replacement

**Statement.** Secrets are envelope-encrypted at rest and only ever displayed as last4; rotation creates a new row and retires the old (note mandatory); health is verified, distinguishing auth_failed from empty data.

- **Parameters:** —
- **Enforced at:** vendor-catalog module per ADR-13
- **Oracle:** exact
- **Critical:** no
- **Governed by stories:** US-031
- **Verification:** Rotation test asserts old row retired + audit note.

### BR-26 — USD only; es-EC number/date formats; per-user UI language

**Statement.** All money is USD (no FX); es-EC surfaces format as `USD 1.234,56` / dd/mm/aaaa; UI language follows UserAccount.ui_language with SystemSetting default fallback.

- **Parameters:** —
- **Enforced at:** UI formatting layer
- **Oracle:** golden (format fixtures)
- **Critical:** no
- **Governed by stories:** US-006
- **Verification:** Format fixture tests per locale.
### BR-27 — Monthly close lands by business day 3

**Statement.** The scheduled close for period P runs no later than business day 3 of P+1 (business-day calendar, America/Guayaquil); a failed or missing scheduled run alerts and blocks the statements-delivered metric (G3) from being claimed.

- **Parameters:** deadline = business day 3; timezone America/Guayaquil
- **Enforced at:** job schedule (pg-boss) + missed-run watchdog: the 15-min alert-eval job raises `close_missed` when no CloseRun exists for period P after business day 3 of P+1 (subject_ref=period)
- **Oracle:** exact (calendar test incl. weekend/holiday edges)
- **Critical:** no
- **Governed by stories:** US-051
- **Verification:** Frozen-calendar tests around month boundaries; missed-run alert asserted.

### BR-28 — Append-only tables allow only their legal update columns

**Statement.** RequestTransition, LicenseAssignment, AlertEvent, ProvisioningAction are append-only with legal UPDATEs restricted to their SEC6 column sets (LicenseAssignment: ended_on/end_reason; ProvisioningAction: status/sent_at/resolved_at; AlertEvent: acknowledged_by/acknowledged_at; RequestTransition: none); DELETE is revoked on all core tables (CompanyRoleAssignment grants excepted).

- **Parameters:** —
- **Enforced at:** database (column-level UPDATE grants + DELETE revoke in the ADR-02 raw-SQL migration)
- **Oracle:** exact (per-table rejection tests)
- **Critical:** no
- **Governed by stories:** US-003
- **Verification:** Illegal-column UPDATE and any DELETE fail as app role, per table.

### External vendor constraints (context, NOT Ledger rules)

- Seat inventory is bought/reduced only in the vendor UI; minimum 20 seats per Enterprise org; additions prorated (PRD §8) — Ledger surfaces these in the purchase runbook (US-048) and pool math (BR-10) but cannot enforce them.
- Close runtime < 5 min at the 30-company rollout target is a performance NFR (09 SEC3), not a business rule; AC fixtures exercise the 5-company MVP baseline (DEC-SMP-018) plus the US-040 50-company perf fixture.
