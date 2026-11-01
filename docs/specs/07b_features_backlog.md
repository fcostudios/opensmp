# 07b — Features Backlog: Ledger (`fcostudios__smp`)

**Step:** 7b — Features Backlog · **Date:** 2026-07-22 · **Report language:** en-US
> Authoritative R1 feature inventory derived from PRD Modules A–I (P0 set + enabling cross-cutting), mapped to screens (Step 7 SEC04), ER entities (Step 4), and journeys (Step 3). Stories (US-NNN) attach at Step 8 — this backlog is their source. 🟡 R2 features listed at the end for scope integrity; they get no R1 stories.

## Summary

- **Historical feature inventory:** 46 (FEAT-001..FEAT-046); 32 retained R1 / 14 R2 · **R2 fast-follow:** 12 · **R3+:** named in PRD §12 (not enumerated here)
- **Screens covered:** 28 · **Journeys covered:** J1–J4 · **Modules covered:** A–I (all P0 rows)

## Feature matrix (release per row)

| ID | Feature | Module | Journey | Screens | Key entities | Release |
|---|---|---|---|---|---|---|
| FEAT-001 | Company registry (CRUD + 30-company CSV seed + status) | A | — | SCR-companies, SCR-company-detail | Company | R2 |
| FEAT-002 | Person records (auto-create on request; single company; history via register) | A | J1 S1 | SCR-people, SCR-person-detail, SCR-new-request | Person | R1 |
| FEAT-003 | Server-side company scoping on every query (isolation test suite) | A/H | all | all scoped screens | CompanyRoleAssignment | R1 |
| FEAT-004 | Request intake form with validations (domain plausible, company active) | B | J1 S1 | SCR-new-request | LicenseRequest, Person | R1 |
| FEAT-005 | Duplicate-request block with pointer to existing assignment | B | J1 S1 | SCR-new-request | LicenseAssignment | R1 |
| FEAT-006 | Budget headroom soft-warning at intake | B | J1 S1 | SCR-new-request | Company.budget_monthly_usd, RateCard | R1 |
| FEAT-007 | Approval queue with one-card context; approve/reject + mandatory comment on reject | B | J1 S2 | SCR-approval-queue, SCR-request-detail | LicenseRequest, RequestTransition | R1 |
| FEAT-008 | Group Admin override on any request | B | J1 S2 | SCR-approval-queue, SCR-request-detail | LicenseRequest | R1 |
| FEAT-009 | Lifecycle email notifications (submitted, new-request, decision, provisioned) | B/G | J1 | (email) + SCR-request-detail | RequestTransition | R1 |
| FEAT-010 | Approval aging: reminder 24 h, escalation 48 h (configurable) | B | J1 S2 | SCR-settings, (email) | AlertRule, AlertEvent | R1 |
| FEAT-011 | Automated provisioning: vendor invite ≤ 15 min post-approval, raw payloads logged | C | J1 S3 | SCR-request-detail | ProvisioningAction | R2 |
| FEAT-012 | Membership polling → Invited → Active; register row opens at activation | C/E | J1 S4 | SCR-request-detail, SCR-register | ProvisioningAction, LicenseAssignment | R2 |
| FEAT-013 | Orchestration mode: checklist issue + admin confirm (SCR-request-detail pending-checklist panel) + sync verification (verification_failed) | C | J1 S3/J2 | SCR-request-detail, SCR-exceptions | ProvisioningAction, VendorAccount.mode | R1 |
| FEAT-014 | Invite hygiene: 7-day unaccepted alert + auto-withdraw window + re-notify | C | J1 S4 | SCR-exceptions, SCR-settings | ProvisioningAction, AlertRule | R2 |
| FEAT-015 | Per-org seat pool tracking (purchased − assigned − pending = free) | C | J4 | SCR-pools, SCR-admin-dashboard, SCR-vendor-account-detail | VendorAccountCapacity, LicenseAssignment | R1 |
| FEAT-016 | Low-pool alert below per-org floor (default 5) | C/G | J4 | SCR-pools, SCR-alerts | VendorAccount.low_pool_floor, AlertEvent | R1 |
| FEAT-017 | Blocked-No-Seat state + purchase-or-reclaim decision task (candidates beside prorated cost) | C | J1 S3/J4 | SCR-request-detail, SCR-pools, SCR-exceptions | LicenseRequest, ActivityRecord | R2 |
| FEAT-018 | Deprovisioning: departure/reclaim removal or checklist; register close; pool return | C/E | J2 | SCR-person-detail, SCR-request-detail | ProvisioningAction, LicenseAssignment | R2 |
| FEAT-019 | Capacity purchase registration (effective-dated rows per runbook) | C | J4 | SCR-pools, SCR-rates, SCR-vendor-account-detail | VendorAccountCapacity | R1 |
| FEAT-020 | Daily analytics sync (per-user activity, raw stored, idempotent) | D | J1 S5 | SCR-usage, SCR-person-detail | ActivityRecord | R2 |
| FEAT-021 | Inactivity flags 30/60/90 days with last-active + persisted reclamation proposals (propose/approve/dismiss with notes) | D | J2 | SCR-usage, SCR-reclamation-proposals | ActivityRecord, LicenseAssignment, ReclamationProposal | R2 |
| FEAT-022 | Freshness labels on all synced figures + staleness alert > 48 h | D/G | all | all usage/statement screens | ActivityRecord.synced_at, AlertEvent | R2 |
| FEAT-023 | Register-vs-console drift detection (hourly member sync) + retroactive claim task | D | J4 | SCR-exceptions | LicenseAssignment(source_kind), AlertEvent | R2 |
| FEAT-024 | Credential health check distinguishing auth failure from empty data | D/H | J4 | SCR-credentials, SCR-vendor-account-detail | IntegrationCredential.health | R2 |
| FEAT-025 | Append-only seat register with DB-level integrity (EXCLUDE + contiguity trigger) + register CSV export | E | all | SCR-register | LicenseAssignment | R1 |
| FEAT-026 | Effective-dated rate cards (locked once consumed by a close) | E | J3 | SCR-rates | RateCard | R1 |
| FEAT-027 | Monthly close by business day 3: per-company statements + lines (seat-days × rate; usage R2) | E | J3 | SCR-close, SCR-statements | CloseRun, Statement, StatementLine | R1 |
| FEAT-028 | Central rollup across all companies per period | E | J3 | SCR-close, SCR-reconciliation | Statement, Reconciliation | R1 |
| FEAT-029 | Reconciliation vs vendor invoice: 0.5% tolerance, line-level variance, override with note | E | J3 | SCR-reconciliation | Reconciliation, ReconciliationVarianceLine | R1 |
| FEAT-030 | Statement + consolidated rollup exports CSV/PDF (`Company.statement_language` for statements) | E | J3 | SCR-statement-detail, SCR-close | Statement, Company | R1 |
| FEAT-031 | Statement→register traceability (raw usage payloads R2) | E/H | J3 | SCR-statement-detail, SCR-register | StatementLine.assignment_id | R1 |
| FEAT-032 | Cross-company dashboard (pools, states, inactive count, freshness) | F | J4 | SCR-admin-dashboard | (aggregates) | R2 |
| FEAT-033 | Per-company scoped views (requests, statements, budget position, company record) | F | all | SCR-company-detail, SCR-statements, SCR-my-requests, SCR-approval-queue | CompanyRoleAssignment | R1 |
| FEAT-034 | Email alert engine: 8 P0 alert types | G | J4 | SCR-settings, (email) | AlertRule, AlertEvent | R1 |
| FEAT-035 | Alert log with acknowledgment per company | G | J4 | SCR-alerts | AlertEvent | R1 |
| FEAT-036 | RBAC: 5 platform roles (group_admin, approver, company_finance, viewer, central_finance) + employee requester, enforced server-side | H | all | SCR-users-roles | UserAccount, CompanyRoleAssignment | R1 |
| FEAT-037 | Encrypted credentials at rest, masked UI (last 4), zero-downtime rotation | H | J4 | SCR-credentials | IntegrationCredential | R2 |
| FEAT-038 | Immutable audit log (DB-level append-only) + viewer with before/after diff | H | all | SCR-audit | AuditLog | R1 |
| FEAT-039 | Platform auth: email + password + mandatory 2FA for admin roles | H | — | SCR-login | UserAccount | R1 |
| FEAT-040 | §10 state machine with per-transition history and SLA timers | B/C | J1/J2 | SCR-request-detail (timeline) | LicenseRequest.state, RequestTransition | R1 |
| FEAT-041 | Vendor-neutral core + connector capability descriptor (rest/scim/none) | I | — | SCR-vendor-accounts | Vendor, VendorAccount | R1 |
| FEAT-042 | License-type dimension per vendor account (rates + capacity per type) | I | J3/J4 | SCR-rates, SCR-vendor-account-detail | LicenseType | R1 |
| FEAT-043 | Bilingual UI es-EC/en-US, tú register, per-user selector | — | all | all screens | (i18n catalogs) | R1 |
| FEAT-044 | Operational settings: alert thresholds, hygiene windows, pool floors, notification identity | C/G | J4 | SCR-settings | AlertRule, SystemSetting | R2 |
| FEAT-045 | Requester status tracking (my requests + state timeline + notifications) | B | J1 | SCR-my-requests, SCR-request-detail | LicenseRequest, RequestTransition | R1 |
| FEAT-046 | Manual register entry (US-095) + member-list CSV comparison (US-097); usage CSV and automated drift R2 | I | J4 | SCR-vendor-account-detail | VendorAccount, LicenseAssignment, ActivityRecord, CostRecord | R1 |

## R2 fast-follow (no R1 stories; PRD §12 middle column)

FEAT-R2-01 manual vendor registry (any vendor via orchestration; renewal alerts) · FEAT-R2-02 one-click transfer · FEAT-R2-03 scheduled offboarding · FEAT-R2-04 approver delegation · FEAT-R2-05 bulk approvals · FEAT-R2-06 budget vs actual + threshold alerts · FEAT-R2-07 statement email delivery · FEAT-R2-08 weekly digest · FEAT-R2-09 utilization dashboards · FEAT-R2-10 SSO (OIDC) login · FEAT-R2-11 access review report · FEAT-R2-12 Slack/Teams notification webhooks.

## Coverage checks

- Every PRD Module A–I P0 row maps to ≥1 FEAT; every FEAT maps to ≥1 screen (or email channel) and ≥1 ER entity.
- Screens with no feature: none (SCR-login→FEAT-039; SCR-access-denied→FEAT-036).
- The Step-7 coherence review validates this matrix adversarially against journeys/ER/screens.

## R1′ release interpretation — CHG-113

DEC-SMP-065/066 supersede the former all-R1 inventory: R2 rows are deferred, built implementations remain frozen unchanged. FEAT-001 CSV pilot seeding is reused through US-094; company CRUD is R2. FEAT-046 R1 is only US-095/097; US-055 residual scope/AC2 is R2. FEAT-027 and FEAT-031 are license-only. FEAT-033 uses scoped statements/register evidence without company CRUD. FEAT-032 receives no further work; the built panel stays routed. H2 alone is tested in R1′.
