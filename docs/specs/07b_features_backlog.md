# 07b — Features Backlog: Ledger (`fcostudios__smp`)

**Step:** 7b — Features Backlog · **Date:** 2026-07-22 · **Report language:** en-US
> Authoritative R1 feature inventory derived from PRD Modules A–I (P0 set + enabling cross-cutting), mapped to screens (Step 7 SEC04), ER entities (Step 4), and journeys (Step 3). Stories (US-NNN) attach at Step 8 — this backlog is their source. 🟡 R2 features listed at the end for scope integrity; they get no R1 stories.

## Summary

- **R1 features:** 45 (FEAT-001..FEAT-045) · **R2 fast-follow:** 12 · **R3+:** named in PRD §12 (not enumerated here)
- **Screens covered:** 28 · **Journeys covered:** J1–J4 · **Modules covered:** A–I (all P0 rows)

## Feature matrix (R1)

| ID | Feature | Module | Journey | Screens | Key entities |
|---|---|---|---|---|---|
| FEAT-001 | Company registry (CRUD + 30-company CSV seed + status) | A | — | SCR-companies, SCR-company-detail | Company |
| FEAT-002 | Person records (auto-create on request; single company; history via register) | A | J1 S1 | SCR-people, SCR-person-detail, SCR-new-request | Person |
| FEAT-003 | Server-side company scoping on every query (isolation test suite) | A/H | all | all scoped screens | CompanyRoleAssignment |
| FEAT-004 | Request intake form with validations (domain plausible, company active) | B | J1 S1 | SCR-new-request | LicenseRequest, Person |
| FEAT-005 | Duplicate-request block with pointer to existing assignment | B | J1 S1 | SCR-new-request | LicenseAssignment |
| FEAT-006 | Budget headroom soft-warning at intake | B | J1 S1 | SCR-new-request | Company.budget_monthly_usd, RateCard |
| FEAT-007 | Approval queue with one-card context; approve/reject + mandatory comment on reject | B | J1 S2 | SCR-approval-queue, SCR-request-detail | LicenseRequest, RequestTransition |
| FEAT-008 | Group Admin override on any request | B | J1 S2 | SCR-approval-queue, SCR-request-detail | LicenseRequest |
| FEAT-009 | Lifecycle email notifications (submitted, new-request, decision, provisioned) | B/G | J1 | (email) + SCR-request-detail | RequestTransition |
| FEAT-010 | Approval aging: reminder 24 h, escalation 48 h (configurable) | B | J1 S2 | SCR-settings, (email) | AlertRule, AlertEvent |
| FEAT-011 | Automated provisioning: vendor invite ≤ 15 min post-approval, raw payloads logged | C | J1 S3 | SCR-request-detail | ProvisioningAction |
| FEAT-012 | Membership polling → Invited → Active; register row opens at activation | C/E | J1 S4 | SCR-request-detail, SCR-register | ProvisioningAction, LicenseAssignment |
| FEAT-013 | Orchestration mode: checklist issue + admin confirm (SCR-request-detail pending-checklist panel) + sync verification (verification_failed) | C | J1 S3/J2 | SCR-request-detail, SCR-exceptions | ProvisioningAction, VendorAccount.mode |
| FEAT-014 | Invite hygiene: 7-day unaccepted alert + auto-withdraw window + re-notify | C | J1 S4 | SCR-exceptions, SCR-settings | ProvisioningAction, AlertRule |
| FEAT-015 | Per-org seat pool tracking (purchased − assigned − pending = free) | C | J4 | SCR-pools, SCR-admin-dashboard, SCR-vendor-account-detail | VendorAccountCapacity, LicenseAssignment |
| FEAT-016 | Low-pool alert below per-org floor (default 5) | C/G | J4 | SCR-pools, SCR-alerts | VendorAccount.low_pool_floor, AlertEvent |
| FEAT-017 | Blocked-No-Seat state + purchase-or-reclaim decision task (candidates beside prorated cost) | C | J1 S3/J4 | SCR-request-detail, SCR-pools, SCR-exceptions | LicenseRequest, ActivityRecord |
| FEAT-018 | Deprovisioning: departure/reclaim removal or checklist; register close; pool return | C/E | J2 | SCR-person-detail, SCR-request-detail | ProvisioningAction, LicenseAssignment |
| FEAT-019 | Capacity purchase registration (effective-dated rows per runbook) | C | J4 | SCR-pools, SCR-rates, SCR-vendor-account-detail | VendorAccountCapacity |
| FEAT-020 | Daily analytics sync (per-user activity, raw stored, idempotent) | D | J1 S5 | SCR-usage, SCR-person-detail | ActivityRecord |
| FEAT-021 | Inactivity flags 30/60/90 days with last-active + persisted reclamation proposals (propose/approve/dismiss with notes) | D | J2 | SCR-usage, SCR-reclamation-proposals | ActivityRecord, LicenseAssignment, ReclamationProposal |
| FEAT-022 | Freshness labels on all synced figures + staleness alert > 48 h | D/G | all | all usage/statement screens | ActivityRecord.synced_at, AlertEvent |
| FEAT-023 | Register-vs-console drift detection (hourly member sync) + retroactive claim task | D | J4 | SCR-exceptions | LicenseAssignment(source_kind), AlertEvent |
| FEAT-024 | Credential health check distinguishing auth failure from empty data | D/H | J4 | SCR-credentials, SCR-vendor-account-detail | IntegrationCredential.health |
| FEAT-025 | Append-only seat register with DB-level integrity (EXCLUDE + contiguity trigger) + register CSV export | E | all | SCR-register | LicenseAssignment |
| FEAT-026 | Effective-dated rate cards (locked once consumed by a close) | E | J3 | SCR-rates | RateCard |
| FEAT-027 | Monthly close by business day 3: per-company statements + lines (seat-days × rate + usage) | E | J3 | SCR-close, SCR-statements | CloseRun, Statement, StatementLine, CostRecord |
| FEAT-028 | Central rollup across 30 companies per period | E | J3 | SCR-close, SCR-reconciliation | Statement, Reconciliation |
| FEAT-029 | Reconciliation vs vendor invoice: 0.5% tolerance, line-level variance, override with note | E | J3 | SCR-reconciliation | Reconciliation, ReconciliationVarianceLine |
| FEAT-030 | Statement + consolidated rollup exports CSV/PDF (`Company.statement_language` for statements) | E | J3 | SCR-statement-detail, SCR-close | Statement, Company |
| FEAT-031 | Statement→register→raw-payload traceability drill-down | E/H | J3 | SCR-statement-detail, SCR-register | StatementLine.assignment_id |
| FEAT-032 | Cross-company dashboard (pools, states, inactive count, freshness) | F | J4 | SCR-admin-dashboard | (aggregates) |
| FEAT-033 | Per-company scoped views (requests, statements, budget position, company record) | F | all | SCR-company-detail, SCR-statements, SCR-my-requests, SCR-approval-queue | CompanyRoleAssignment |
| FEAT-034 | Email alert engine: 8 P0 alert types | G | J4 | SCR-settings, (email) | AlertRule, AlertEvent |
| FEAT-035 | Alert log with acknowledgment per company | G | J4 | SCR-alerts | AlertEvent |
| FEAT-036 | RBAC: 5 platform roles (group_admin, approver, company_finance, viewer, central_finance) + employee requester, enforced server-side | H | all | SCR-users-roles | UserAccount, CompanyRoleAssignment |
| FEAT-037 | Encrypted credentials at rest, masked UI (last 4), zero-downtime rotation | H | J4 | SCR-credentials | IntegrationCredential |
| FEAT-038 | Immutable audit log (DB-level append-only) + viewer with before/after diff | H | all | SCR-audit | AuditLog |
| FEAT-039 | Platform auth: email + password + mandatory 2FA for admin roles | H | — | SCR-login | UserAccount |
| FEAT-040 | §10 state machine with per-transition history and SLA timers | B/C | J1/J2 | SCR-request-detail (timeline) | LicenseRequest.state, RequestTransition |
| FEAT-041 | Vendor-neutral core + connector capability descriptor (rest/scim/none) | I | — | SCR-vendor-accounts | Vendor, VendorAccount |
| FEAT-042 | License-type dimension per vendor account (rates + capacity per type) | I | J3/J4 | SCR-rates, SCR-vendor-account-detail | LicenseType |
| FEAT-043 | Bilingual UI es-EC/en-US, tú register, per-user selector | — | all | all screens | (i18n catalogs) |
| FEAT-044 | Operational settings: alert thresholds, hygiene windows, pool floors, notification identity | C/G | J4 | SCR-settings | AlertRule, SystemSetting |
| FEAT-045 | Requester status tracking (my requests + state timeline + notifications) | B | J1 | SCR-my-requests, SCR-request-detail | LicenseRequest, RequestTransition |

## R2 fast-follow (no R1 stories; PRD §12 middle column)

FEAT-R2-01 manual vendor registry (any vendor via orchestration; renewal alerts) · FEAT-R2-02 one-click transfer · FEAT-R2-03 scheduled offboarding · FEAT-R2-04 approver delegation · FEAT-R2-05 bulk approvals · FEAT-R2-06 budget vs actual + threshold alerts · FEAT-R2-07 statement email delivery · FEAT-R2-08 weekly digest · FEAT-R2-09 utilization dashboards · FEAT-R2-10 SSO (OIDC) login · FEAT-R2-11 access review report · FEAT-R2-12 Slack/Teams notification webhooks.

## Coverage checks

- Every PRD Module A–I P0 row maps to ≥1 FEAT; every FEAT maps to ≥1 screen (or email channel) and ≥1 ER entity.
- Screens with no feature: none (SCR-login→FEAT-039; SCR-access-denied→FEAT-036).
- The Step-7 coherence review validates this matrix adversarially against journeys/ER/screens.
