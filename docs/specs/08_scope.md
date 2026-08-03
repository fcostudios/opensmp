# 08 — Scope: Ledger (`fcostudios__smp`)

**Step:** 8 — Scope · **Date:** 2026-07-22 · **Report language:** en-US
**Inputs:** `07b_features_backlog.md` (46 R1 FEATs) · `07_screens.md` + 28 TOONs (46 server actions) · `04_er_model.md` (26 entities) · `03_cx_journeys.md` (J1–J4 + SLAs) · `02_cx_personas.md` · PRD §11 ACs · `extracts/_step8_coherence_pack.json`
**Release:** all stories R1 unless noted. R2 features (FEAT-R2-01..12) get NO stories here.

### SEC1 — Summary

- **55 stories (US-001..US-055; 052–054 added by the Step-10 plan review: parallel-close execution, production deploy, API probe spike; 055 added by DEC-SMP-018: API-less ingestion — CSV import + manual upkeep)** covering all 46 R1 features, all 46 TOON-declared server actions, and every entity write path.
- **MVP scale baseline (DEC-SMP-018):** acceptance criteria and fixtures exercise **5 companies**; the 30-company rollout is the deployment target, not an AC requirement — every seed/close/rollup path scales without code change.
- Sequencing: foundation (US-001..008) → registry/workflow (US-009..017) → connector/automation (US-018..031) → money (US-032..039) → surfaces/ops (US-040..049) — mirrors PRD §16 sprints.
- SLAs carried as ACs: invite ≤15 min post-approval; aging 24h/48h; departure same-business-day; close < 5 min by bd-3; reconciliation ≤0.5%; dashboards < 3 s at scale; drift→0.
- Candidate `critical` business rules (Step 9b): register integrity (DEC-SMP-009, US-003), close determinism (US-034), reconciliation tolerance/override (US-038).

### SEC2 — Story inventory

| ID | Title | Persona | Feature(s) | Screens |
|---|---|---|---|---|
| US-001 | Scaffold the monorepo and app skeleton | Group Admin | — | n/a (infra) |
| US-002 | Docker Compose runtime + CI pipeline | Group Admin | — | n/a (infra) |
| US-003 | Core schema migration with DB-level register integrity | Group Admin | FEAT-025 | n/a (infra) |
| US-004 | Platform auth: email + password + mandatory 2FA for admin roles | End User | FEAT-039 | SCR-login, SCR-access-denied |
| US-005 | Server-side RBAC + company scoping middleware | Group Admin | FEAT-003, FEAT-036 | all scoped screens |
| US-006 | App shell: data-workspace chrome + bilingual i18n | End User | FEAT-043 | app shell (all screens) |
| US-007 | Seed: companies CSV + go-live register backfill | Group Admin | FEAT-001 | SCR-companies |
| US-008 | Immutable audit trail + viewer | Group Admin | FEAT-038 | SCR-audit |
| US-009 | Company registry CRUD + company record | Group Admin | FEAT-001, FEAT-033 | SCR-companies, SCR-company-detail |
| US-010 | Person records + edit + auto-create on request | Group Admin | FEAT-002 | SCR-people, SCR-person-detail |
| US-011 | Users, roles and delegation-ready grants | Group Admin | FEAT-036 | SCR-users-roles |
| US-012 | Request intake with validations | End User | FEAT-004, FEAT-005, FEAT-006 | SCR-new-request |
| US-013 | My requests + request detail record | End User | FEAT-045 | SCR-my-requests, SCR-request-detail |
| US-014 | Lifecycle state machine engine | Group Admin | FEAT-040 | (engine) |
| US-015 | Approval queue: one-minute decisions | Company Approver | FEAT-007, FEAT-008 | SCR-approval-queue, SCR-request-detail |
| US-016 | Lifecycle notifications (email) | End User | FEAT-009 | (email) |
| US-017 | Approval aging: reminder + escalation job | Company Approver | FEAT-010 | (email), SCR-alerts |
| US-018 | Anthropic connector client | Group Admin | FEAT-011 (enabler), FEAT-041 | (connector) |
| US-019 | Automated provisioning: invite ≤ 15 min → Active | End User | FEAT-011, FEAT-012 | SCR-request-detail, SCR-exceptions |
| US-020 | Orchestration mode: checklist + confirm + verification | Group Admin | FEAT-013 | SCR-request-detail, SCR-exceptions |
| US-021 | Invite hygiene | Group Admin | FEAT-014 | SCR-exceptions |
| US-022 | Per-org pool tracking + low-pool alert | Group Admin | FEAT-015, FEAT-016 | SCR-pools, SCR-admin-dashboard, SCR-vendor-account-detail |
| US-023 | Blocked-no-seat + purchase-or-reclaim flow | Group Admin | FEAT-017, FEAT-019 | SCR-pools, SCR-request-detail, SCR-exceptions |
| US-024 | Offboarding + deprovisioning | Group Admin | FEAT-018 | SCR-person-detail, SCR-request-detail |
| US-025 | Vendor accounts + capability descriptor | Group Admin | FEAT-041, FEAT-042 | SCR-vendor-accounts, SCR-vendor-account-detail |
| US-026 | Analytics sync: activity + cost | Group Admin | FEAT-020 | (jobs) |
| US-027 | Inactivity flags + usage surface | Group Admin | FEAT-021 | SCR-usage |
| US-028 | Reclamation proposals: approve or dismiss | Company Approver | FEAT-021 | SCR-reclamation-proposals |
| US-029 | Freshness labels + staleness alert | Central Finance | FEAT-022, FEAT-024 | all usage/statement screens, SCR-credentials |
| US-030 | Drift detection + retroactive claim | Group Admin | FEAT-023 | SCR-exceptions |
| US-031 | Credential management + rotation | Group Admin | FEAT-037, FEAT-024 | SCR-credentials, SCR-vendor-account-detail |
| US-032 | Effective-dated rate cards | Central Finance | FEAT-026 | SCR-rates |
| US-033 | The register surface + export | Central Finance | FEAT-025, FEAT-031 | SCR-register |
| US-034 | Monthly close job + CloseRun | Central Finance | FEAT-027 | SCR-close |
| US-035 | Statement finalization | Central Finance | FEAT-027 | SCR-close, SCR-statement-detail |
| US-036 | Statement detail + kind-aware evidence | Company Finance | FEAT-031, FEAT-033 | SCR-statement-detail |
| US-037 | Statement exports (CSV/PDF, per-company language) | Company Finance | FEAT-030 | SCR-statement-detail |
| US-038 | Reconciliation workbench + variance lines | Central Finance | FEAT-028, FEAT-029 | SCR-reconciliation |
| US-039 | Consolidated rollup + export | Central Finance | FEAT-028, FEAT-030 | SCR-close |
| US-040 | Cross-company admin dashboard | Group Admin | FEAT-032 | SCR-admin-dashboard |
| US-041 | Scoped per-company experience | Company Finance | FEAT-033 | SCR-company-detail, SCR-statements, SCR-my-requests |
| US-042 | Alert engine: 10 P0 types | Group Admin | FEAT-034 | (jobs), SCR-alerts |
| US-043 | Alert log + acknowledgment | Group Admin | FEAT-035 | SCR-alerts |
| US-044 | Operational settings | Group Admin | FEAT-044 | SCR-settings |
| US-045 | Connector interface + orchestration routing | Group Admin | FEAT-041 | (architecture seam) |
| US-046 | Job runner + schedules | Group Admin | (enabler) | (worker) |
| US-047 | Company-isolation test suite | Group Admin | FEAT-003 | (tests) |
| US-048 | Ops runbooks + backup/restore drill | Group Admin | (ops) | docs |
| US-049 | Statement PDF brand template | Company Finance | FEAT-030 | (pdf) |

### SEC3 — Stories

### US-001 — Scaffold the monorepo and app skeleton
- **As**: Group Admin (persona_01) | **Want to**: have the codebase structure in place | **So that**: feature work has a place to land
- **AC1**: Turborepo with `apps/web` (Next.js App Router, TS) + `packages/db` (Drizzle), `packages/contracts` (zod), `packages/ui`, `packages/config`
- **AC2**: pnpm workspaces; `turbo.json` build/dev/type-check/lint/test tasks green on empty app
- **AC3**: Tailwind CSS 4 configured with the corporativo. token layer stub (DEC-SMP-005)
- **Prerequisites**: none
- **Feature**: — | **Journey**: — | **Release**: R1
- **Screens**: n/a (infra)
- **Entities (CRUD)**: —

### US-002 — Docker Compose runtime + CI pipeline
- **As**: Group Admin (persona_01) | **Want to**: run app + Postgres + worker locally and in CI | **So that**: the self-hosted posture (PRD §13) works from day one
- **AC1**: `docker compose up` boots app + Postgres + worker; healthchecks pass
- **AC2**: CI runs type-check/lint/test + `drizzle-kit` migration apply against a throwaway DB
- **AC3**: Nightly encrypted backup job stub with restore command documented
- **Prerequisites**: US-001
- **Feature**: — | **Journey**: — | **Release**: R1
- **Screens**: n/a (infra)
- **Entities (CRUD)**: —

### US-003 — Core schema migration with DB-level register integrity
- **As**: Group Admin (persona_01) | **Want to**: materialize the 26-entity schema | **So that**: every later story writes into a correct model
- **AC1**: Drizzle schema for all 26 entities of `04_er_model.md`; migration applies clean
- **AC2**: Raw-SQL migration adds: `btree_gist` + EXCLUDE no-overlap constraint on LicenseAssignment; deferred transfer-contiguity trigger; partial UNIQUE on ReclamationProposal(assignment_id) WHERE pending; UNIQUE source_request_id; REVOKE DELETE on all core tables + column-level UPDATE grants on append-only tables (BR-28 lists)
- **AC3**: App DB role has NO UPDATE/DELETE grants on AuditLog (append-only proven by a failing test)
- **AC4**: Integrity tests: overlapping assignment rejected; audit UPDATE rejected; illegal-column UPDATE and DELETE attempts rejected per append-only table (DEC-SMP-009/BR-28)
- **AC5**: Migration seeds SystemSetting defaults: notif_sender_email, notif_escalation_email, default_language
- **Prerequisites**: US-002
- **Feature**: FEAT-025 | **Journey**: — | **Release**: R1
- **Screens**: n/a (infra)
- **Entities (CRUD)**: ALL (C schema), SystemSetting (C seed)

### US-004 — Platform auth via Keycloak OIDC (mandatory 2FA for admin roles)
- **As**: End User (persona_05) | **Want to**: log in securely | **So that**: access is controlled per Module H
- **AC1**: OIDC authorization-code login against self-hosted Keycloak (realm `corporativo`, ADR-03/DEC-SMP-014); TOTP enforced by realm policy for `platform-admin` group members; `UserAccount.idp_subject` linked on first login
- **AC2**: Role-based landing per SEC02 (employee→my-requests, approver→queue, company_finance→statements, central_finance→close, group_admin→panel)
- **AC3**: Logins/failures audit-logged; `last_login_at` updated; access-denied for out-of-scope routes; Keycloak realm export in repo + seeded CI users; business roles live ONLY in Ledger's DB (Keycloak carries none)
- **AC4**: Granting/removing group_admin or central_finance syncs `platform-admin` group membership (ADR-03); seeded-CI-user tests: newly-granted admin is TOTP-challenged on next login; disabled account cannot obtain a session; admin without TOTP configured is rejected by realm policy
- **Prerequisites**: US-003
- **Feature**: FEAT-039 | **Journey**: J1 | **Release**: R1
- **Screens**: SCR-login, SCR-access-denied
- **Server actions**: login
- **Entities (CRUD)**: UserAccount (R/U idp_subject)

### US-005 — Server-side RBAC + company scoping middleware
- **As**: Group Admin (persona_01) | **Want to**: enforce role and company scope on every query | **So that**: isolation is structural (PRD §15 highest-severity class)
- **AC1**: Middleware resolves permitted company_id set from CompanyRoleAssignment + global_role on every data access
- **AC2**: 5 platform roles + employee requester enforced; viewer = read-only company scope
- **AC3**: Route guards match `07c_navigation_map.json` role_based_views exactly
- **Prerequisites**: US-004
- **Feature**: FEAT-003, FEAT-036 | **Journey**: — | **Release**: R1
- **Screens**: all scoped screens
- **Entities (CRUD)**: CompanyRoleAssignment (R)

### US-006 — App shell: data-workspace chrome + bilingual i18n
- **As**: End User (persona_05) | **Want to**: navigate a branded, bilingual workspace | **So that**: every screen inherits shell, language and voice
- **AC1**: Dark rail per DEC-SMP-012 (sections OPERACIÓN/FINANZAS/ADMINISTRACIÓN, filled-orange active item), condensed display titles, breadcrumbs
- **AC2**: next-intl catalogs es-EC (tú, vocabulary lock) + en-US; per-user selector persists to `UserAccount.ui_language`; fallback to SystemSetting `default_language`
- **AC3**: 12-chip StatusPill component (single source of state colors) + FreshnessLabel + MoneyText (mono, es-EC formats)
- **Prerequisites**: US-004
- **Feature**: FEAT-043 | **Journey**: all | **Release**: R1
- **Screens**: app shell (all screens)
- **Entities (CRUD)**: UserAccount (U ui_language)

### US-007 — Seed: companies CSV + go-live register backfill
- **As**: Group Admin (persona_01) | **Want to**: load the managed companies and current seat holders | **So that**: day-one data is real and attributed
- **AC1**: `importCompaniesCsv` seeds companies from CSV (code, approver, finance contact, budget, statement_language); MVP fixture seeds 5 companies (DEC-SMP-018) — the same path handles the 30-company rollout
- **AC2**: Backfill imports current Anthropic members as LicenseAssignment rows (source_kind=import) each with a system-materialized LicenseRequest (state=active, justification 'importación inicial') per 04 lifecycle
- **AC3**: Register passes integrity constraints post-backfill; counts reconcile with the console lists
- **AC4**: Seeds one effective-dated VendorAccountCapacity row per (org, license type) at go-live, purchased counts reconciled with the console
- **Prerequisites**: US-003
- **Feature**: FEAT-001 | **Journey**: — | **Release**: R1
- **Screens**: SCR-companies
- **Server actions**: importCompaniesCsv
- **Entities (CRUD)**: Company (C), LicenseAssignment (C), LicenseRequest (C system), Vendor (C seed: Anthropic), VendorAccount (C seed per org inventory OQ-SMP-1), LicenseType (C seed: Claude tiers), IntegrationCredential (C per org), VendorAccountCapacity (C seed)

### US-008 — Immutable audit trail + viewer
- **As**: Group Admin (persona_01) | **Want to**: see who did what with before/after | **So that**: every mutation is evidenced (Module H)
- **AC1**: Every server action writes AuditLog (actor, action, entity, before/after jsonb, note when supplied)
- **AC2**: SCR-audit: filterable table + diff modal incl. the actor `note` field
- **AC3**: Append-only verified (grants from US-003); company scope hint populated where derivable
- **Prerequisites**: US-005
- **Feature**: FEAT-038 | **Journey**: all | **Release**: R1
- **Screens**: SCR-audit
- **Entities (CRUD)**: AuditLog (C/R)

### US-009 — Company registry CRUD + company record
- **As**: Group Admin (persona_01) | **Want to**: manage companies and their configuration | **So that**: attribution targets stay correct
- **AC1**: Create/edit company (code unique, type, status, budget, finance contact, statement_language es/en)
- **AC2**: SCR-company-detail tabs; admin tabs (Roles/Configuración) gated group_admin; company roles see their own company read-scoped (Module F P0)
- **AC3**: Deactivating a company blocks new requests but preserves history
- **Prerequisites**: US-005
- **Feature**: FEAT-001, FEAT-033 | **Journey**: — | **Release**: R1
- **Screens**: SCR-companies, SCR-company-detail
- **Server actions**: createCompany, updateCompany
- **Entities (CRUD)**: Company (CRU)

### US-010 — Person records + edit + auto-create on request
- **As**: Group Admin (persona_01) | **Want to**: keep people accurate (email is the vendor identity key) | **So that**: requests and matching never break on identity
- **AC1**: Create person; edit full_name/email/company/status ('Salió del grupo') via modal with company-move warning (closes register rows, fast-track re-request)
- **AC2**: Auto-create person on request submission when email is new (J1 S1)
- **AC3**: Person detail shows assignment history (register rows), recent activity, last-active freshness
- **Prerequisites**: US-005
- **Feature**: FEAT-002 | **Journey**: J1 S1 | **Release**: R1
- **Screens**: SCR-people, SCR-person-detail
- **Server actions**: createPerson, updatePerson
- **Entities (CRUD)**: Person (CRU)

### US-011 — Users, roles and delegation-ready grants
- **As**: Group Admin (persona_01) | **Want to**: administer platform accounts and company-scoped roles | **So that**: RBAC has an operating surface
- **AC1**: Create/disable accounts via the Keycloak admin client (ADR-03; mandatory motivo note → AuditLog.note); reset 2FA = Keycloak OTP-credential removal + CONFIGURE_TOTP required action (note required)
- **AC2**: Grant/remove company roles (approver/finance/viewer) with valid_from/to fields present (delegation itself 🟡)
- **AC3**: 2FA estado read from Keycloak's OTP-credential state for the account's `idp_subject` via the admin client (ADR-03; `totp_secret_encrypted` unused under Keycloak)
- **Prerequisites**: US-005
- **Feature**: FEAT-036 | **Journey**: — | **Release**: R1
- **Screens**: SCR-users-roles
- **Server actions**: createUserAccount, disableUserAccount, resetTwoFactor, addCompanyRole, removeCompanyRole
- **Entities (CRUD)**: UserAccount (CRU), CompanyRoleAssignment (CRD)

### US-012 — Request intake with validations
- **As**: End User (persona_05) | **Want to**: request a license in one clear form | **So that**: the AS-IS chat intake dies (J1 S1)
- **AC1**: Form per SCR-new-request: self or admin-on-behalf; org+license type limited to active VendorAccounts/LicenseTypes
- **AC2**: Blocking duplicate check with 'Ver asignación existente' link; domain plausibility warn; company-active check
- **AC3**: Budget headroom soft-warning (run-rate vs Company.budget_monthly_usd using current RateCard; when no RateCard row exists for the (org, license type), show 'sin tarifa' and suppress the warning)
- **AC4**: `submitRequest` creates LicenseRequest (request_no SOL-NNNN) + RequestTransition; confirmation email; redirects to detail
- **Prerequisites**: US-007, US-010, US-014
- **Feature**: FEAT-004, FEAT-005, FEAT-006 | **Journey**: J1 S1 | **Release**: R1
- **Screens**: SCR-new-request
- **Server actions**: submitRequest
- **Entities (CRUD)**: LicenseRequest (C), Person (C-if-absent), RequestTransition (C)

### US-013 — My requests + request detail record
- **As**: End User (persona_05) | **Want to**: track my request's state without chasing | **So that**: silence is eliminated (J1)
- **AC1**: SCR-my-requests scoped list with 12-chip states; SCR-request-detail record with metric cards, conditional callouts (Blocked/Failed), tabs (Acciones/Asignación/Auditoría)
- **AC2**: State timeline renders every RequestTransition with actor + note
- **AC3**: Blocked callout shows requester copy + group_admin 'Ver cupos' action
- **Prerequisites**: US-012
- **Feature**: FEAT-045 | **Journey**: J1 | **Release**: R1
- **Screens**: SCR-my-requests, SCR-request-detail
- **Entities (CRUD)**: LicenseRequest (R), RequestTransition (R)

### US-014 — Lifecycle state machine engine
- **As**: Group Admin (persona_01) | **Want to**: have one legal-transition engine for the 12 states | **So that**: every module drives the same spine (FEAT-040)
- **AC1**: Transition function enforces the §10 graph (incl. provisioning→failed→provisioning retry); illegal transitions rejected + tested
- **AC2**: Every transition persists RequestTransition (from/to/actor/note/occurred_at) + AuditLog
- **AC3**: SLA timers derivable: submitted_at, pending_since for aging (US-017)
- **Prerequisites**: US-003
- **Feature**: FEAT-040 | **Journey**: J1/J2 | **Release**: R1
- **Screens**: (engine)
- **Entities (CRUD)**: LicenseRequest (U), RequestTransition (C)

### US-015 — Approval queue: one-minute decisions
- **As**: Company Approver (persona_02) | **Want to**: approve or reject with full context inline | **So that**: decisions happen inside the SLA (J1 S2)
- **AC1**: QueueCards show requester, company, type/org, justificación, needed-by, cost impact (RateCard; 'sin tarifa' placeholder when absent), budget headroom, aging chip (breach state at > 2 business days pending per PRD §10 decision target; business-day calendar)
- **AC2**: Aprobar inline; Rechazar requires comment (modal); decision recorded (decided_by/at/comment) + notifications
- **AC3**: Group Admin sees all companies and can decide any request (override, audit-logged)
- **Prerequisites**: US-014
- **Feature**: FEAT-007, FEAT-008 | **Journey**: J1 S2 | **Release**: R1
- **Screens**: SCR-approval-queue, SCR-request-detail
- **Server actions**: decideRequest
- **Entities (CRUD)**: LicenseRequest (U), RequestTransition (C)

### US-016 — Lifecycle notifications (email)
- **As**: End User (persona_05) | **Want to**: be notified at each transition | **So that**: nobody chases state over chat (Module B/G)
- **AC1**: Emails: submission confirmation; new-request to approver; decision to requester; provisioning-complete with getting-started note
- **AC2**: Sender = SystemSetting `notif_sender_email`; templates bilingual per recipient's ui_language (fallback es); templates render from the shared next-intl es-EC (tú, vocabulary lock) / en-US catalogs (US-006); approver/finance templates use the 12-chip vocabulary, no vendor jargon or API internals
- **AC3**: Deep links land on the scoped screen (request detail / queue card)
- **Prerequisites**: US-012, US-003
- **Feature**: FEAT-009 | **Journey**: J1 | **Release**: R1
- **Screens**: (email)
- **Entities (CRUD)**: SystemSetting (R)

### US-017 — Approval aging: reminder + escalation job
- **As**: Company Approver (persona_02) | **Want to**: get nudged before I block my company | **So that**: requests never stall silently (J1 S2)
- **AC1**: The 15-min alert-eval job (US-046) evaluates the approver reminder at 24h pending and the Group-Admin escalation at 48h (thresholds from AlertRule), on the first run after each threshold. Concurrent workers create exactly one AlertEvent/delivery stream per breach stage. SMTP delivery is at-least-once across an SMTP-success/DB-crash ambiguity and uses a stable Message-ID so the provider can deduplicate retries; it is not falsely described as exactly-once.
- **AC2**: Escalation email names request, company, approver; AlertEvent logged; reminder/escalation emails use the same catalogs and voice constraint as US-016
- **AC3**: Escalation target = SystemSetting `notif_escalation_email`
- **Prerequisites**: US-015, US-042, US-046
- **Feature**: FEAT-010 | **Journey**: J1 S2 | **Release**: R1
- **Screens**: (email), SCR-alerts
- **Entities (CRUD)**: AlertEvent (C)

### US-018 — Anthropic connector client
- **As**: Group Admin (persona_01) | **Want to**: talk to the vendor API safely | **So that**: automation is reliable and forensically replayable
- **AC1**: Client wraps User Management + Analytics APIs with endpoint-specific header policy, documented rate limits (100/min UM, 60/min Analytics, 1200 invites/h), and bounded retry/backoff; Admin and Analytics credentials are distinct and fail closed when routed to the wrong capability
- **AC2**: Every call persists a sanitized canonical ProvisioningAction/sync request+response summary; credentials, authorization headers, raw PII, full provider identifiers, and raw provider bodies are forbidden
- **AC3**: Connector implements the Connector capability interface (US-045) — nothing Claude-specific outside it (DEC-SMP-008); capability descriptor semantics per US-025
- **AC4**: Every deterministic Anthropic network fixture is backed by a passing Pact consumer contract; live credential-scope, organization-binding, pagination, rate-limit, invite-create, and invite-cleanup acceptance remains gated by the authorized US-054 provider run
- **Prerequisites**: US-003, US-045, US-025
- **Feature**: FEAT-011 (enabler), FEAT-041 | **Journey**: J1 S3 | **Release**: R1
- **Screens**: (connector)
- **Entities (CRUD)**: ProvisioningAction (C)

### US-019 — Automated provisioning: invite ≤ 15 min → Active
- **As**: End User (persona_05) | **Want to**: get my seat without human touch | **So that**: G1 is met on the happy path (J1 S3–S4)
- **AC1**: On approval with free pool: invite created ≤15 min; state→provisioning→invited; failure→failed + `failure_reason` + provisioning_failure alert; `retryProvisioning` returns to provisioning
- **AC2**: Membership polling (15-min job) detects acceptance → state active + LicenseAssignment row opens (started_on, source_request_id)
- **AC3**: 400-no-seat → blocked_no_seat path (US-023); all transitions via the engine
- **Prerequisites**: US-018, US-014, US-046, US-042
- **Feature**: FEAT-011, FEAT-012 | **Journey**: J1 S3–S4 | **Release**: R1
- **Screens**: SCR-request-detail, SCR-exceptions
- **Server actions**: retryProvisioning
- **Entities (CRUD)**: ProvisioningAction (CU), LicenseAssignment (C), LicenseRequest (U)

### US-020 — Orchestration mode: checklist + confirm + verification
- **As**: Group Admin (persona_01) | **Want to**: execute vendor steps manually with the same guarantees | **So that**: beta-API failure degrades speed, never blocks (DEC-SMP-007)
- **AC1**: Orgs with mode=orchestration route provision/deprovision to a checklist ProvisioningAction (steps in raw_request) — via the connector-interface dispatch (US-045), independent of the API client (US-018): the PRD's week-2 milestone ships on this path alone
- **AC2**: SCR-request-detail pending-checklist panel renders steps + 'Confirmar ejecución' / 'Marcar no completada' (group_admin)
- **AC3**: `confirmChecklistDone` is the Group Admin's audited attestation and advances the request immediately through the same lifecycle transition as automated execution; the next member sync verifies later. A mismatch changes only the ProvisioningAction to `verification_failed` and surfaces an exception for remediation—it does not retroactively erase the attested lifecycle transition.
- **Prerequisites**: US-014, US-045
- **Feature**: FEAT-013 | **Journey**: J1 S3, J2 | **Release**: R1
- **Screens**: SCR-request-detail, SCR-exceptions
- **Server actions**: confirmChecklistDone, markChecklistNotDone
- **Entities (CRUD)**: ProvisioningAction (U)

### US-021 — Invite hygiene
- **As**: Group Admin (persona_01) | **Want to**: never leak seats into invite limbo | **So that**: pending invites stop eating the pool (J1 S4)
- **AC1**: Invites unaccepted >7d raise invite_unaccepted alert (threshold configurable)
- **AC2**: Auto-withdraw after configurable window frees the seat + re-notifies requester; manual `withdrawInvite` with note from exceptions tab
- **AC3**: Withdrawn invites visible in request Acciones trail
- **Prerequisites**: US-019, US-042
- **Feature**: FEAT-014 | **Journey**: J1 S4 | **Release**: R1
- **Screens**: SCR-exceptions
- **Server actions**: withdrawInvite
- **Entities (CRUD)**: ProvisioningAction (U), AlertEvent (C)

### US-022 — Per-org pool tracking + low-pool alert
- **As**: Group Admin (persona_01) | **Want to**: see purchased/assigned/pending/free per org | **So that**: pool truth replaces console guesswork (J4)
- **AC1**: Free = latest VendorAccountCapacity − open assignments − pending invites, per (org, license type); PoolGauge on SCR-pools + dashboard tiles (works on seeded capacity + backfilled register before automation exists — the pending-invite term is simply zero until US-019)
- **AC2**: Below `low_pool_floor` → low_pool alert + attention state
- **AC3**: Cross-org moves render as two operations (never a silent transfer)
- **Prerequisites**: US-007, US-042
- **Feature**: FEAT-015, FEAT-016 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-pools, SCR-admin-dashboard, SCR-vendor-account-detail
- **Entities (CRUD)**: VendorAccountCapacity (R), AlertEvent (C)

### US-023 — Blocked-no-seat + purchase-or-reclaim flow
- **As**: Group Admin (persona_01) | **Want to**: decide reclaim-vs-buy with evidence | **So that**: blocked requests are never silently dropped (J1 S3, J4)
- **AC1**: Pool-empty (or vendor 400) → state blocked_no_seat; requester + admin notified; decision task on SCR-pools
- **AC2**: Callout shows inactive candidates (last-active, monthly cost) beside prorated purchase note once US-027 analytics data exists; renders a 'sin datos de uso' empty state before
- **AC3**: `registerPurchase`/`addCapacity`/`saveVendorAccountCapacity` create effective-dated capacity rows (license type required); blocked requests auto-resume provisioning when pool frees
- **AC4**: A request still blocked_no_seat with its decision task unresolved > 1 business day re-alerts/escalates to Group Admin (blocked_no_seat AlertRule aging threshold, default 1bd) and shows an aging chip on the SCR-pools decision task (PRD §10 'review within 1 business day')
- **Prerequisites**: US-022, US-042
- **Feature**: FEAT-017, FEAT-019 | **Journey**: J1 S3, J4 | **Release**: R1
- **Screens**: SCR-pools, SCR-request-detail, SCR-exceptions
- **Server actions**: registerPurchase, addCapacity, saveVendorAccountCapacity
- **Entities (CRUD)**: VendorAccountCapacity (C), LicenseRequest (U)

### US-024 — Offboarding + deprovisioning
- **As**: Group Admin (persona_01) | **Want to**: remove seats same-business-day on departure | **So that**: seat-days stop leaking (J2)
- **AC1**: `startOffboarding` (person detail / request detail) → state offboarding → removal via connector or checklist → deprovisioned
- **AC2**: Register row closes (ended_on, end_reason left_company/inactive/reallocated); pool increments next sync
- **AC3**: Departure flow can set Person.status='Salió del grupo'
- **AC4**: Offboardings with end_reason=left_company still not deprovisioned at end of the same business day raise `deprovision_overdue` (15-min alert-eval, business-day calendar, subject_ref=request) — BR-14
- **Prerequisites**: US-019, US-020
- **Feature**: FEAT-018 | **Journey**: J2 | **Release**: R1
- **Screens**: SCR-person-detail, SCR-request-detail
- **Server actions**: startOffboarding
- **Entities (CRUD)**: LicenseAssignment (U close), ProvisioningAction (C), Person (U)

### US-025 — Vendor accounts + capability descriptor
- **As**: Group Admin (persona_01) | **Want to**: manage orgs, modes and connector capabilities | **So that**: the vendor-neutral core is operable (Module I)
- **AC1**: CRUD VendorAccount (mode automated/orchestration, low_pool_floor, renewal); R1 vendor select = Anthropic (registry is FEAT-R2-01)
- **AC2**: Capabilities info-card renders Vendor booleans + provisioning_protocol; missing capability routes steps to orchestration
- **AC3**: License types tab read-only in R1 (deferral noted SEC08 of 07)
- **Prerequisites**: US-005
- **Feature**: FEAT-041, FEAT-042 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-vendor-accounts, SCR-vendor-account-detail
- **Server actions**: createVendorAccount, updateVendorAccount
- **Entities (CRUD)**: VendorAccount (CRU), Vendor (R), LicenseType (R)

### US-026 — Analytics sync: activity + cost
- **As**: Group Admin (persona_01) | **Want to**: ingest per-user daily activity and cost | **So that**: monitoring and usage charges have data (J1 S5)
- **AC1**: Daily job upserts ActivityRecord (counters jsonb + raw payload + synced_at) per (org, person, date); idempotent re-runs
- **AC2**: Cost sync upserts CostRecord within the 30-day revision window
- **AC3**: Identity matched via Vendor.identity_matching (email); unmatched rows surfaced as warnings
- **AC4**: The job only auto-syncs orgs with ingestion_mode=api; csv_import/manual orgs reach the SAME upserts through US-055 (source=csv_import/manual) — freshness labels and sync_stale semantics (US-029) are channel-agnostic, keyed on synced_at
- **Prerequisites**: US-018, US-046
- **Feature**: FEAT-020 | **Journey**: J1 S5 | **Release**: R1
- **Screens**: (jobs)
- **Entities (CRUD)**: ActivityRecord (CU), CostRecord (CU)

### US-027 — Inactivity flags + usage surface
- **As**: Group Admin (persona_01) | **Want to**: see 30/60/90-day inactivity per company | **So that**: reclamation candidates are visible (J2)
- **AC1**: SCR-usage: filters, metric cards, last-active + badge per person; batch 'Proponer reclamación' creates pending ReclamationProposals with note
- **AC2**: Flags respect the ~3-day analytics lag (windows unaffected)
- **AC3**: State flagged_inactive set on the anchor request when window trips
- **Prerequisites**: US-026
- **Feature**: FEAT-021 | **Journey**: J2 | **Release**: R1
- **Screens**: SCR-usage
- **Server actions**: proposeReclamations
- **Entities (CRUD)**: ReclamationProposal (C), LicenseRequest (U)

### US-028 — Reclamation proposals: approve or dismiss
- **As**: Company Approver (persona_02) | **Want to**: consent before any seat is freed | **So that**: never silent removal (J2)
- **AC1**: Queue cards with last-active, days, cost; 'Liberar' → approves proposal → offboarding flow; 'Mantener' → dismissed with mandatory keep-note
- **AC2**: Dismissal suppresses re-proposal until a new inactivity window elapses
- **AC3**: Decisions audit-logged; proposal state drives the pending queue + empty state
- **Prerequisites**: US-027, US-024
- **Feature**: FEAT-021 | **Journey**: J2 | **Release**: R1
- **Screens**: SCR-reclamation-proposals
- **Server actions**: approveReclamation, dismissReclamation
- **Entities (CRUD)**: ReclamationProposal (U), LicenseRequest (U)

### US-029 — Freshness labels + staleness alert
- **As**: Central Finance (persona_04) | **Want to**: know how fresh every synced figure is | **So that**: no silent staleness (Module D)
- **AC1**: FreshnessLabel bound to synced_at on usage/cost figures across screens ('datos al 19-jul')
- **AC2**: Sync >48h behind → sync_stale alert + attention styling
- **AC3**: Staleness surfacing is read-only and distinguishes cause: 'sin datos' vs 'credencial con fallo de autenticación', reading IntegrationCredential.health maintained by US-031 (FEAT-024)
- **Prerequisites**: US-026, US-042
- **Feature**: FEAT-022 | **Journey**: J4 | **Release**: R1
- **Screens**: all usage/statement screens
- **Entities (CRUD)**: AlertEvent (C)

### US-030 — Drift detection + retroactive claim
- **As**: Group Admin (persona_01) | **Want to**: catch console bypass within an hour | **So that**: the register stays the truth (J4)
- **AC1**: Hourly member sync diffs console vs register (ingestion_mode=api orgs); for csv_import/manual orgs the SAME diff runs on every `importMembersCsv` (US-055) — unknown members → register_drift alert + Deriva tab entry either way
- **AC2**: `claimDriftMember` assigns company retroactively: creates LicenseAssignment (source_kind=reconciliation, note=comentario) + system-materialized request
- **AC3**: Drift metric on dashboard trends to zero (PRD §17)
- **Prerequisites**: US-018, US-046, US-042
- **Feature**: FEAT-023 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-exceptions
- **Server actions**: claimDriftMember
- **Entities (CRUD)**: LicenseAssignment (C), LicenseRequest (C system), AlertEvent (C)

### US-031 — Credential management + rotation
- **As**: Group Admin (persona_01) | **Want to**: rotate keys without downtime | **So that**: Module H secrets rules hold
- **AC1**: Credentials envelope-encrypted at rest; UI masks to last4; scopes displayed
- **AC2**: `rotateCredential` creates new row + retires old (note required); `verifyCredential` health-checks on demand and distinguishes auth_failed from empty-data (FEAT-024 semantics)
- **AC3**: credential_failure alert on auth failures from any job
- **Prerequisites**: US-005
- **Feature**: FEAT-037, FEAT-024 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-credentials, SCR-vendor-account-detail
- **Server actions**: rotateCredential, verifyCredential
- **Entities (CRUD)**: IntegrationCredential (CRU)

### US-032 — Effective-dated rate cards
- **As**: Central Finance (persona_04) | **Want to**: maintain contracted rates that reprice cleanly | **So that**: close math is deterministic (Module E)
- **AC1**: `saveRateCard` adds effective-dated rows per (org, license type); overlapping periods rejected
- **AC2**: Rows consumed by a final close are locked (edit → new effective row)
- **AC3**: SCR-rates lists rates + capacity history side by side
- **Prerequisites**: US-005
- **Feature**: FEAT-026 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-rates
- **Server actions**: saveRateCard
- **Entities (CRUD)**: RateCard (CR)

### US-033 — The register surface + export
- **As**: Central Finance (persona_04) | **Want to**: inspect and export the attribution truth | **So that**: disputes become lookups (Module E)
- **AC1**: SCR-register: filters, open/closed rows, end_reason chips, source links (request_no), note for import/reconciliation rows
- **AC2**: Row expander: source request trace
- **AC3**: `exportRegisterCsv` respects filters; integrity banner states the DB-level guarantees
- **Prerequisites**: US-007
- **Feature**: FEAT-025, FEAT-031 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-register
- **Server actions**: exportRegisterCsv
- **Entities (CRUD)**: LicenseAssignment (R)

### US-034 — Monthly close job + CloseRun
- **As**: Central Finance (persona_04) | **Want to**: generate per-company draft statements by business day 3 | **So that**: the close is push-button and <5 min (J3)
- **AC1**: `runClose` writes CloseRun (running→succeeded/failed, note) then per-company Statement + StatementLines: license lines from register seat-days × effective rates (daily actual/actual proration, mid-month splits with period_from/to); oracle test (PRD §11 Module E): a transfer effective the 10th yields a company-A line with period_to = the 9th and a company-B line with period_from = the 10th, zero gap/overlap in seat-days, and the person appears on both statements with dates
- **AC2**: Idempotent per period: re-run recalculates drafts, never touches finals; duration surfaced (<5 min NFR)
- **AC3**: Statements stamped close_run_id
- **Prerequisites**: US-032, US-033
- **Feature**: FEAT-027 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-close
- **Server actions**: runClose
- **Entities (CRUD)**: CloseRun (CU), Statement (C), StatementLine (C)

### US-035 — Statement finalization
- **As**: Central Finance (persona_04) | **Want to**: flip drafts to immutable finals | **So that**: downstream reconciliation has a stable base (J3)
- **AC1**: `finalizeStatements` (period) + `finalizeStatement` (single) with confirm; finals immutable (adjustments = new lines next draft)
- **AC2**: Locks consumed RateCard rows; status chips update across screens
- **AC3**: Only central_finance/group_admin may finalize
- **Prerequisites**: US-050
- **Feature**: FEAT-027 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-close, SCR-statement-detail
- **Server actions**: finalizeStatements, finalizeStatement
- **Entities (CRUD)**: Statement (U status)

### US-036 — Statement detail + kind-aware evidence
- **As**: Company Finance (persona_03) | **Want to**: verify every line to its evidence | **So that**: statements defend themselves (J3)
- **AC1**: Lines table with kind badges, period_from/to, mono amounts, note column (mandatory on adjustments)
- **AC2**: Kind-aware expander: license→register rows; usage→CostRecord table (freshness + revision caption), each row linking to a modal viewer for its stored raw API payload — completing statement→register→raw-payload (PRD §15 auditability); adjustment→note; register-row expander links back to statement lines (bidirectional with US-033)
- **AC3**: Scoped: company roles see own company only
- **Prerequisites**: US-050
- **Feature**: FEAT-031, FEAT-033 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-statement-detail
- **Entities (CRUD)**: StatementLine (R), CostRecord (R)

### US-037 — Statement exports (CSV/PDF, per-company language)
- **As**: Company Finance (persona_03) | **Want to**: hand my finance team a defensible document | **So that**: statements travel (Module E)
- **AC1**: `exportStatementCsv`/`Pdf` per statement; PDF in Company.statement_language (DEC-SMP-011) using the US-049 brand template
- **AC2**: PDF footer: period, generated stamp, integrity note
- **AC3**: Exports audit-logged
- **Prerequisites**: US-036, US-049
- **Feature**: FEAT-030 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-statement-detail
- **Server actions**: exportStatementCsv, exportStatementPdf
- **Entities (CRUD)**: Statement (R)

### US-038 — Reconciliation workbench + variance lines
- **As**: Central Finance (persona_04) | **Want to**: reconcile rollup vs invoice within 0.5% | **So that**: the month closes with evidence (J3)
- **AC1**: Per-org cards: rollup vs `saveInvoiceAmount` input; variance auto-computed + tolerance coloring
- **AC2**: Variance lines (ReconciliationVarianceLine: cause/detail/amounts/evidence link) CRUD during reconciliation; immutable once reconciled/overridden
- **AC3**: `overrideReconciliation` requires note; records overridden_by (role per OQ-SMP-11); the open→reconciled flip happens automatically on `saveInvoiceAmount` when within tolerance
- **AC4**: open→reconciled is server-rejected when |variance| > 0.5% of invoice total; outside tolerance the ONLY path is `overrideReconciliation` (mandatory note) → overridden; rejection covered by a test
- **Prerequisites**: US-035
- **Feature**: FEAT-028, FEAT-029 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-reconciliation
- **Server actions**: saveInvoiceAmount, overrideReconciliation
- **Entities (CRUD)**: Reconciliation (CU), ReconciliationVarianceLine (C)

### US-039 — Consolidated rollup + export
- **As**: Central Finance (persona_04) | **Want to**: see and export the group total | **So that**: Module E P0 'statement AND rollup' is complete (J3)
- **AC1**: Group-total tile on SCR-close (SUM Statement.total_usd for period)
- **AC2**: `exportRollupCsv`/`Pdf`: consolidated rollup across all companies
- **AC3**: Rollup ties to reconciliation totals (same period source)
- **Prerequisites**: US-050
- **Feature**: FEAT-028, FEAT-030 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-close
- **Server actions**: exportRollupCsv, exportRollupPdf
- **Entities (CRUD)**: Statement (R aggregate)

### US-040 — Cross-company admin dashboard
- **As**: Group Admin (persona_01) | **Want to**: see pools, states, inactivity and alerts at a glance | **So that**: exceptions-only operation works (J4)
- **AC1**: Tiles: purchased/assigned/pending/free (cross-org), in-flight by state, inactive 30+, unacked alerts — each tile navigates
- **AC2**: Recent requests table (all companies) + staleness banner when any sync >48h
- **AC3**: Numbers match their source screens (pool math, alert counts)
- **AC4**: Perf fixture in CI (50 companies, ~1,000 people, 2 years of daily ActivityRecord/CostRecord rows); SCR-admin-dashboard server-renders < 3 s against it (PRD §15); fixture reused for SCR-pools/SCR-usage aggregates
- **Prerequisites**: US-022, US-042
- **Feature**: FEAT-032 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-admin-dashboard
- **Entities (CRUD)**: (aggregates R)

### US-041 — Scoped per-company experience
- **As**: Company Finance (persona_03) | **Want to**: see my company's complete world and nothing else | **So that**: scoping is the trust contract (Module F)
- **AC1**: approver/company_finance/viewer reach SCR-company-detail scoped to their company (admin tabs hidden)
- **AC2**: Isolation asserted: cross-company URL access → access-denied; exports scoped
- **AC3**: Viewer role: read-only everywhere it has access
- **Prerequisites**: US-009, US-005
- **Feature**: FEAT-033 | **Journey**: all | **Release**: R1
- **Screens**: SCR-company-detail, SCR-statements, SCR-my-requests
- **Entities (CRUD)**: (scoped reads)

### US-042 — Alert engine: 10 P0 types
- **As**: Group Admin (persona_01) | **Want to**: get email alerts for every failure class | **So that**: nothing fails silently (Module G)
- **AC1**: AlertRule seed: approval_aging, provisioning_failure, blocked_no_seat, low_pool, invite_unaccepted, sync_stale, credential_failure, register_drift, deprovision_overdue, close_missed (enabled, thresholds)
- **AC2**: 15-min evaluation job fires AlertEvent + email (sender from SystemSetting); `dedupe_key = alert_rule_id + alert stage + stable subject identity + breach-window start` is UNIQUE, and retries use insert-on-conflict/no-op so each breach stage fires once
- **AC3**: subject_ref carries the target for per-type link dispatch
- **Prerequisites**: US-046, US-003
- **Feature**: FEAT-034 | **Journey**: J4 | **Release**: R1
- **Screens**: (jobs), SCR-alerts
- **Entities (CRUD)**: AlertRule (C seed/R), AlertEvent (C)

### US-043 — Alert log + acknowledgment
- **As**: Group Admin (persona_01) | **Want to**: triage and acknowledge alerts | **So that**: the alert log is evidence (Module G)
- **AC1**: SCR-alerts tabs (sin reconocer / todas); `ackAlert` records who/when
- **AC2**: Per-type subject link dispatch (request/pools/credentials/exceptions) per the TOON contract
- **AC3**: Alert rows display their alcance (global/compañía/org) per the TOON contract; SCR-alerts remains group_admin-only in R1 — company personas receive company-scoped alerts via email only (US-042); any in-app company alert surface requires a nav-map + screens change (open question, Step 9)
- **Prerequisites**: US-042
- **Feature**: FEAT-035 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-alerts
- **Server actions**: ackAlert
- **Entities (CRUD)**: AlertEvent (RU)

### US-044 — Operational settings
- **As**: Group Admin (persona_01) | **Want to**: tune thresholds and notification identity | **So that**: the platform is configurable without deploys (Modules C/G)
- **AC1**: `saveAlertRules` edits per-type enabled/thresholds (aging 24/48h, floor default, invite 7d + auto-withdraw window, staleness 48h)
- **AC2**: `saveNotificationSettings`/`saveSystemSettings` persist SystemSetting keys (sender, escalation, default_language); every save audit-logged with before/after
- **AC3**: Per-org floor override lives on VendorAccount (linked from settings)
- **Prerequisites**: US-005
- **Feature**: FEAT-044 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-settings
- **Server actions**: saveAlertRules, saveNotificationSettings, saveSystemSettings
- **Entities (CRUD)**: AlertRule (U), SystemSetting (CU)

### US-045 — Connector interface + orchestration routing
- **As**: Group Admin (persona_01) | **Want to**: keep the core vendor-neutral | **So that**: vendor #2 is additive, never a rewrite (DEC-SMP-008)
- **AC1**: Connector interface: capabilities() + provision/deprovision/syncMembers/syncActivity/syncCost; the Sprint 2 `none` connector routes unsupported provision/deprovision operations to the orchestration checklist (US-020). Unsupported sync operations remain explicit until the CSV/manual ingestion path lands in US-055; the orchestration milestone is independent of the API client (US-018).
- **AC2**: Dispatch reads Vendor.provisioning_protocol (rest/scim/none); Sprint 2 registers only the `none` connector. US-018 provides the first concrete Anthropic connector after the US-054 probe gate.
- **AC3**: Core modules import only the interface (lint/test guard)
- **Prerequisites**: US-003
- **Feature**: FEAT-041 | **Journey**: — | **Release**: R1
- **Screens**: (architecture seam)
- **Entities (CRUD)**: Vendor (R)

### US-046 — Job runner + schedules
- **As**: Group Admin (persona_01) | **Want to**: run all periodic work reliably | **So that**: jobs are idempotent and observable (PRD §13)
- **AC1**: pg-boss (Postgres-only) with schedules: analytics daily, member sync hourly, invite polling 15min, alert eval 15min (incl. aging reminders/escalations + missed-run watchdogs, ADR-04/BR-08/BR-27), close monthly bd-3
- **AC2**: Every job idempotent + re-runnable; failure → credential_failure/sync_stale alert path; no silent death
- **AC3**: Job runs visible in logs with duration
- **Prerequisites**: US-002
- **Feature**: (enabler) | **Journey**: — | **Release**: R1
- **Screens**: (worker)
- **Entities (CRUD)**: —

### US-047 — Company-isolation test suite
- **As**: Group Admin (persona_01) | **Want to**: prove scoping on every company-owned table | **So that**: the highest-severity bug class is fenced (PRD §15)
- **AC1**: Automated tests: every company-owned entity query path rejects cross-company access per role
- **AC2**: Register integrity tests from US-003 extended: transfer contiguity, close-run determinism
- **AC3**: Suite runs in CI; failures block merge
- **Prerequisites**: US-041, US-034
- **Feature**: FEAT-003 | **Journey**: — | **Release**: R1
- **Screens**: (tests)
- **Entities (CRUD)**: —

### US-048 — Ops runbooks + backup/restore drill
- **As**: Group Admin (persona_01) | **Want to**: operate the three critical procedures | **So that**: bus factor is mitigated (PRD §15/§18)
- **AC1**: Runbooks: seat purchase (console + registerPurchase), credential rotation (ADR-13 KEK/DEK procedure), restore (incl. backup-key retrieval), Keycloak-outage break-glass (enable, use, verify alert + audit rows, confirm auto-disable)
- **AC2**: Nightly encrypted backup verified by an actual restore drill pre-go-live
- **AC3**: Runbooks linked from the relevant screens (pools purchase modal, credentials)
- **Prerequisites**: US-002, US-031
- **Feature**: (ops) | **Journey**: — | **Release**: R1
- **Screens**: docs
- **Entities (CRUD)**: —

### US-049 — Statement PDF brand template
- **As**: Company Finance (persona_03) | **Want to**: receive a document that looks official | **So that**: the brand carries into finance artifacts (DEC-SMP-005/012)
- **AC1**: PDF layout: corporativo. lockup, Barlow, condensed uppercase header, mono numerals, es/en variants
- **AC2**: Renders joiners/leavers with dates, line notes, totals; matches SCR-statement-detail data exactly
- **AC3**: Golden-file test against a fixture statement
- **Prerequisites**: US-003
- **Feature**: FEAT-030 | **Journey**: J3 | **Release**: R1
- **Screens**: (pdf)
- **Entities (CRUD)**: Statement (R)


### US-050 — Close usage lines from CostRecord via the register
- **As**: Central Finance (persona_04) | **Want to**: charge metered usage to the right company | **So that**: usage-based components bill correctly (PRD A6, Module E)
- **AC1**: Close adds kind=usage StatementLines from CostRecord mapped through register attribution (person→company at cost_date); amounts snapshot at close (30-day vendor revisions surface in Reconciliation, never mutate finals)
- **AC2**: Companies with no usage get no usage lines; unmatched CostRecords surface as close warnings
- **AC3**: Idempotent with US-034's recalc semantics (drafts only)
- **Prerequisites**: US-034, US-026
- **Feature**: FEAT-027 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-statement-detail
- **Entities (CRUD)**: StatementLine (C usage), CostRecord (R)

### US-051 — Close schedule + workbench readouts
- **As**: Central Finance (persona_04) | **Want to**: the close to run itself by business day 3 | **So that**: G3 holds without manual triggering
- **AC1**: bd-3 schedule triggers runClose per period (business-day calendar); manual run still available
- **AC2**: SCR-close tiles + 'última corrida … por … · duración' + <5 min NFR readout bind to latest CloseRun; run-in-progress state visible
- **AC3**: Failed scheduled runs alert (provisioning_failure-class routing) and appear on the workbench
- **AC4**: Alert-eval detects a MISSING CloseRun for the period past bd-3 and raises `close_missed`, independent of the close job itself (BR-27 watchdog)
- **Prerequisites**: US-050, US-046
- **Feature**: FEAT-027 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-close
- **Entities (CRUD)**: CloseRun (R), AlertEvent (C)


### US-052 — Execute the first parallel close on real data
- **As**: Central Finance (persona_04) | **Want to**: run the first real monthly close beside the manual process | **So that**: go-live rests on a reconciled month (PRD §16 weeks 5–6)
- **AC1**: Close runs for the most recently completed calendar month (calendar anchor per 10_plan SEC1) with contracted rates (OQ-SMP-4) against the US-007 backfill + US-026 synced data, in the production environment (US-053)
- **AC2**: Per-company statements compared against the manual spreadsheet via the US-038 workbench; every variance triaged into ReconciliationVarianceLines or a bugfix under an existing story
- **AC3**: Invoice amount entered; reconciliation reaches reconciled/overridden; G3 metric (statements bd-3) measured and recorded
- **Prerequisites**: US-034, US-038, US-050, US-053
- **Feature**: FEAT-027, FEAT-029 | **Journey**: J3 | **Release**: R1
- **Screens**: SCR-close, SCR-reconciliation
- **Entities (CRUD)**: CloseRun (C), Reconciliation (CU), ReconciliationVarianceLine (C)

### US-053 — Production environment + first deploy
- **As**: Group Admin (persona_01) | **Want to**: a running production stack | **So that**: the parallel close and go-live happen on real infrastructure (ADR-11)
- **AC1**: VPS provisioned (GATE: hosting root, OQ-SMP-7); Caddy TLS + DNS; production Compose stack up (app/worker/postgres/keycloak/smtp-relay) with healthchecks
- **AC2**: Production Keycloak realm imported; KEK + secrets placed per ADR-13; nightly backup job live
- **AC3**: Deploy runbook documented; first deploy from CI verified
- **Prerequisites**: US-002
- **Feature**: (ops enabler) | **Journey**: — | **Release**: R1
- **Screens**: n/a (infra)
- **Entities (CRUD)**: —

### US-054 — Anthropic API probe spike
- **As**: Group Admin (persona_01) | **Want to**: probe the real APIs with real per-org keys in week 1 | **So that**: beta-API surprises reprice Sprint 3 before it starts
- **AC1**: With the OQ-SMP-1 keys: invite dry-run/member-list/analytics/cost-report calls executed per org; payload shapes, rate-limit and beta-header behavior captured
- **AC2**: Findings diffed against US-018 AC1 / US-026 assumptions; deltas filed as scope notes before Sprint 3 planning
- **Prerequisites**: —
- **Feature**: (risk spike) | **Journey**: — | **Release**: R1
- **Screens**: n/a
- **Entities (CRUD)**: —

### US-055 — API-less ingestion: member/usage CSV import + manual register upkeep
- **As**: Group Admin (persona_01) | **Want to**: keep the register and usage data true for orgs without API access | **So that**: a Teams-plan (or any API-less) org is fully manageable — Ledger helps control the estate even when nothing can be automated (DEC-SMP-018)
- **AC1**: `importMembersCsv` (SCR-vendor-account-detail) parses a Console member-list export and runs the US-030 diff: verifies checklist-confirmed provisions, opens/closes LicenseAssignment rows it evidences, flags unknown members as register_drift — identical states + audit as the API member sync
- **AC2**: `importUsageCsv` parses Console usage/cost exports and upserts ActivityRecord/CostRecord (source=csv_import) with the US-026 idempotent semantics; unmatched identities surfaced as warnings
- **AC3**: On ingestion_mode=manual orgs the admin can record/close a LicenseAssignment directly (source_kind=manual, note required) — DB-level register integrity (US-003) and audit (US-008) apply unchanged
- **AC4**: Ingestion mode is configured per org on SCR-vendor-account-detail (Configuración); non-api orgs surface freshness from the last import/manual entry, and sync_stale alerting (US-029) keys on the same synced_at
- **Prerequisites**: US-003, US-025, US-026, US-030
- **Feature**: FEAT-046 | **Journey**: J4 | **Release**: R1
- **Screens**: SCR-vendor-account-detail
- **Server actions**: importMembersCsv, importUsageCsv
- **Entities (CRUD)**: LicenseAssignment (CU), LicenseRequest (C system), ActivityRecord (CU), CostRecord (CU), VendorAccount (U ingestion_mode), AlertEvent (C)

<!-- nous:generated:08-sec4:begin -->
### SEC4 — Feature → story coverage (computed)

| Feature | Stories |
|---|---|
| FEAT-001 | US-007, US-009 |
| FEAT-002 | US-010 |
| FEAT-003 | US-005, US-047 |
| FEAT-004 | US-012 |
| FEAT-005 | US-012 |
| FEAT-006 | US-012 |
| FEAT-007 | US-015 |
| FEAT-008 | US-015 |
| FEAT-009 | US-016 |
| FEAT-010 | US-017 |
| FEAT-011 | US-018, US-019 |
| FEAT-012 | US-019 |
| FEAT-013 | US-020 |
| FEAT-014 | US-021 |
| FEAT-015 | US-022 |
| FEAT-016 | US-022 |
| FEAT-017 | US-023 |
| FEAT-018 | US-024 |
| FEAT-019 | US-023 |
| FEAT-020 | US-026 |
| FEAT-021 | US-027, US-028 |
| FEAT-022 | US-029 |
| FEAT-023 | US-030 |
| FEAT-024 | US-029, US-031 |
| FEAT-025 | US-003, US-033 |
| FEAT-026 | US-032 |
| FEAT-027 | US-034, US-035, US-050, US-051, US-052 |
| FEAT-028 | US-038, US-039 |
| FEAT-029 | US-038, US-052 |
| FEAT-030 | US-037, US-039, US-049 |
| FEAT-031 | US-033, US-036 |
| FEAT-032 | US-040 |
| FEAT-033 | US-009, US-036, US-041 |
| FEAT-034 | US-042 |
| FEAT-035 | US-043 |
| FEAT-036 | US-005, US-011 |
| FEAT-037 | US-031 |
| FEAT-038 | US-008 |
| FEAT-039 | US-004 |
| FEAT-040 | US-014 |
| FEAT-041 | US-018, US-025, US-045 |
| FEAT-042 | US-025 |
| FEAT-043 | US-006 |
| FEAT-044 | US-044 |
| FEAT-045 | US-013 |
| FEAT-046 | US-055 |
<!-- nous:generated:08-sec4:end -->

<!-- nous:generated:08-sec5:begin -->
### SEC5 — Coverage matrix: entity × operation → owning stories (IMP-090 §5a)

| Entity | Operations covered (story) |
|---|---|
| Company | US-007:C; US-009:CRU |
| Person | US-010:CRU; US-012:C-if-absent; US-024:U |
| UserAccount | US-004:R/U idp_subject; US-006:U ui_language; US-011:CRU |
| CompanyRoleAssignment | US-005:R; US-011:CRD |
| Vendor | US-007:C seed: Anthropic; US-025:R; US-045:R |
| VendorAccount | US-007:C seed per org inventory OQ-SMP-1; US-025:CRU; US-055:U ingestion_mode |
| VendorAccountCapacity | US-007:C seed; US-022:R; US-023:C |
| LicenseType | US-007:C seed: Claude tiers; US-025:R |
| IntegrationCredential | US-007:C per org; US-031:CRU |
| LicenseRequest | US-007:C system; US-012:C; US-013:R; US-014:U; US-015:U; US-019:U; US-023:U; US-027:U; US-028:U; US-030:C system; US-055:C system |
| RequestTransition | US-012:C; US-013:R; US-014:C; US-015:C |
| LicenseAssignment | US-007:C; US-019:C; US-024:U close; US-030:C; US-033:R; US-055:CU |
| ProvisioningAction | US-018:C; US-019:CU; US-020:U; US-021:U; US-024:C |
| ReclamationProposal | US-027:C; US-028:U |
| ActivityRecord | US-026:CU; US-055:CU |
| CostRecord | US-026:CU; US-036:R; US-050:R; US-055:CU |
| RateCard | US-032:CR |
| Statement | US-034:C; US-035:U status; US-037:R; US-039:R aggregate; US-049:R |
| StatementLine | US-034:C; US-036:R; US-050:C usage |
| CloseRun | US-034:CU; US-051:R; US-052:C |
| Reconciliation | US-038:CU; US-052:CU |
| ReconciliationVarianceLine | US-038:C; US-052:C |
| AlertRule | US-042:C seed/R; US-044:U |
| AlertEvent | US-017:C; US-021:C; US-022:C; US-029:C; US-030:C; US-042:C; US-043:RU; US-051:C; US-055:C |
| SystemSetting | US-003:C seed; US-016:R; US-044:CU |
| AuditLog | US-008:C/R |
<!-- nous:generated:08-sec5:end -->

<!-- nous:generated:08-sec6:begin -->
### SEC6 — Server-action ownership (all 46 TOON-declared actions)

| Action | Story |
|---|---|
| `ackAlert` | US-043 |
| `addCapacity` | US-023 |
| `addCompanyRole` | US-011 |
| `approveReclamation` | US-028 |
| `claimDriftMember` | US-030 |
| `confirmChecklistDone` | US-020 |
| `createCompany` | US-009 |
| `createPerson` | US-010 |
| `createUserAccount` | US-011 |
| `createVendorAccount` | US-025 |
| `decideRequest` | US-015 |
| `disableUserAccount` | US-011 |
| `dismissReclamation` | US-028 |
| `exportRegisterCsv` | US-033 |
| `exportRollupCsv` | US-039 |
| `exportRollupPdf` | US-039 |
| `exportStatementCsv` | US-037 |
| `exportStatementPdf` | US-037 |
| `finalizeStatement` | US-035 |
| `finalizeStatements` | US-035 |
| `importCompaniesCsv` | US-007 |
| `importMembersCsv` | US-055 |
| `importUsageCsv` | US-055 |
| `login` | US-004 |
| `markChecklistNotDone` | US-020 |
| `overrideReconciliation` | US-038 |
| `proposeReclamations` | US-027 |
| `registerPurchase` | US-023 |
| `removeCompanyRole` | US-011 |
| `resetTwoFactor` | US-011 |
| `retryProvisioning` | US-019 |
| `rotateCredential` | US-031 |
| `runClose` | US-034 |
| `saveAlertRules` | US-044 |
| `saveInvoiceAmount` | US-038 |
| `saveNotificationSettings` | US-044 |
| `saveRateCard` | US-032 |
| `saveSystemSettings` | US-044 |
| `saveVendorAccountCapacity` | US-023 |
| `startOffboarding` | US-024 |
| `submitRequest` | US-012 |
| `updateCompany` | US-009 |
| `updatePerson` | US-010 |
| `updateVendorAccount` | US-025 |
| `verifyCredential` | US-031 |
| `withdrawInvite` | US-021 |
<!-- nous:generated:08-sec6:end -->

### SEC7 — Deferred (R2/R3+)

FEAT-R2-01..12 carry no R1 stories (PRD §12 fast-follow). LicenseType creation UI deferred with FEAT-R2-01; delegation windows fields shipped dormant (US-011). R3+ per PRD §12.

### SEC8 — Open questions

- OQ-SMP-11 (override role) → US-038 renders override for central_finance + group_admin until decided (Step 9 locks permission).
- OQ-SMP-1 (org inventory) gates US-007 backfill + US-025 seeds; placeholders acceptable pre-Sprint 0.
- OQ-SMP-4 (rates) gates US-032 values, not the story.
- Duplicate action naming `addCapacity` vs `saveVendorAccountCapacity` vs `registerPurchase` (3 TOON entry points, one capacity-write path) — consolidate to ONE server action at Step 9 (US-023 note).
