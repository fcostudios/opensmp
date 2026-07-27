# 07 — Screens: Ledger (`fcostudios__smp`)

**Step:** 7 — Screens · **Date:** 2026-07-22 · **Report language:** en-US (UI es-EC primary + en-US, tú — DEC-SMP-013)
**Inputs:** `03_cx_journeys.md` (J1–J4) · `04_er_model.md` (22 entities, state enum) · `05_brand.md` + extract (chips, vocabulary, microcopy) · `06_design_system.md` + `design_system.dss.json` (data-workspace, dark chrome, templates) · PRD Modules A–I.

### SEC01 — Context Snapshot

Ledger's UI is a role-scoped workspace over one register: requesters submit and track license requests; approvers decide from a queue; the Group Admin operates pools/exceptions/credentials; finance verifies statements and reconciles. 28 R1 screens across 5 roles, all rendered in the data-workspace shell (dark rail, three sections: OPERACIÓN / FINANZAS / ADMINISTRACIÓN). Every screen shows status via the 12-chip StatusPill vocabulary and freshness labels on synced figures.

### SEC02 — Persona & Role Mapping

| Role slug | Persona | Landing screen | Scope |
|---|---|---|---|
| `employee` | persona_05 End User | SCR-my-requests | own requests only |
| `approver` | persona_02 Company Approver | SCR-approval-queue | own company queue + reclamations |
| `company_finance` | persona_03 Company Finance | SCR-statements | own company statements/budget |
| `central_finance` | persona_04 Central Finance | SCR-close | all statements + close + reconciliation + register (read) |
| `group_admin` | persona_01 Group Admin | SCR-admin-dashboard | everything |
| `viewer` | (Company Viewer — PRD Module H P0) | SCR-company-detail | own company, read-only (admin tabs hidden) |

### SEC03 — Journey-to-Screens Strategy

- **J1 Seat request:** SCR-new-request (S1) → SCR-my-requests / SCR-request-detail (S1–S4 status; blocked callout at S3) → SCR-approval-queue (S2) → provisioning is job-driven, visible in SCR-request-detail's action log + SCR-exceptions on failure.
- **J2 Reclamation & offboarding:** SCR-usage flags → SCR-reclamation-proposals (approver consent) → SCR-request-detail (offboarding execution trail) → pool return visible in SCR-pools; person history in SCR-person-detail.
- **J3 Monthly close:** SCR-close (run + statement states) → SCR-statements / SCR-statement-detail (verification drill-down, exports) → SCR-reconciliation (invoice entry, variance, override) → SCR-rates (inputs).
- **J4 Pool & exception ops:** SCR-admin-dashboard (tiles) → SCR-exceptions (blocked/failed/drift/verification-failed) → SCR-pools (purchase-or-reclaim) → SCR-credentials (health/rotation) → SCR-alerts (ack log).

### SEC04 — Screen Inventory

| # | Screen ID | Route | Roles | Template | Journey/Module | Release |
|---|---|---|---|---|---|---|
| 1 | SCR-login | /login | public | tpl.auth | — | R1 |
| 2 | SCR-my-requests | /solicitudes | employee, approver, group_admin | tpl.workspace-list | J1 | R1 |
| 3 | SCR-new-request | /solicitudes/nueva | employee, approver, group_admin | tpl.form-single | J1 S1 | R1 |
| 4 | SCR-request-detail | /solicitudes/:requestId | employee, approver, group_admin | tpl.workspace-record | J1 S1–S4, J2 | R1 |
| 5 | SCR-approval-queue | /aprobaciones | approver, group_admin | tpl.queue | J1 S2 | R1 |
| 6 | SCR-reclamation-proposals | /reclamaciones | approver, group_admin | tpl.queue | J2 | R1 |
| 7 | SCR-admin-dashboard | /panel | group_admin | tpl.workspace-list | Module F, J4 | R1 |
| 8 | SCR-exceptions | /excepciones | group_admin | tpl.workspace-list | J4 | R1 |
| 9 | SCR-pools | /cupos | group_admin | tpl.workspace-list | Module C, J4 | R1 |
| 10 | SCR-vendor-accounts | /organizaciones | group_admin | tpl.workspace-list | D1/Module C | R1 |
| 11 | SCR-vendor-account-detail | /organizaciones/:vendorAccountId | group_admin | tpl.workspace-record | Module C/H | R1 |
| 12 | SCR-credentials | /credenciales | group_admin | tpl.workspace-list | Module H, J4 | R1 |
| 13 | SCR-companies | /companias | group_admin | tpl.workspace-list | Module A | R1 |
| 14 | SCR-company-detail | /companias/:companyId | group_admin, approver, company_finance, viewer (scoped: own company; admin tabs group_admin-only) | tpl.workspace-record | Module A/F | R1 |
| 15 | SCR-people | /personas | group_admin | tpl.workspace-list | Module A | R1 |
| 16 | SCR-person-detail | /personas/:personId | group_admin | tpl.workspace-record | Module A/D | R1 |
| 17 | SCR-register | /registro | group_admin, central_finance | tpl.workspace-list | Module E | R1 |
| 18 | SCR-usage | /uso | group_admin | tpl.workspace-list | Module D | R1 |
| 19 | SCR-alerts | /alertas | group_admin | tpl.workspace-list | Module G | R1 |
| 20 | SCR-audit | /auditoria | group_admin | tpl.workspace-list | Module H | R1 |
| 21 | SCR-users-roles | /usuarios | group_admin | tpl.workspace-list | Module H | R1 |
| 22 | SCR-statements | /estados-de-cuenta | company_finance, central_finance, group_admin | tpl.workspace-list | Module E, J3 | R1 |
| 23 | SCR-statement-detail | /estados-de-cuenta/:statementId | company_finance, central_finance, group_admin | tpl.workspace-record | Module E, J3 | R1 |
| 24 | SCR-close | /cierre | central_finance, group_admin | tpl.close-workbench | J3 | R1 |
| 25 | SCR-reconciliation | /conciliacion | central_finance, group_admin | tpl.close-workbench | J3 | R1 |
| 26 | SCR-rates | /tarifas | central_finance, group_admin | tpl.workspace-list | Module E | R1 |
| 27 | SCR-settings | /configuracion | group_admin | tpl.form-single | Modules C/G | R1 |
| 28 | SCR-access-denied | /acceso-denegado | public | info | — | R1 |

### SEC05 — Detailed Screen Specs (Narrative briefs — the TOON authoring contract)

Conventions for all screens: breadcrumb + condensed display title + gray metadata line; StatusPill via the 12-chip es/en vocabulary; FreshnessLabel on every synced figure; money in mono right-aligned (`USD 27,10`); one orange primary per view; es-EC tú microcopy from the brand lock; `meta.release: "R1"`; roles as listed in SEC04.

#### SCR-login
Sections: hero (building photo + dark veil, corporativo. logo, "EL REGISTRO DE LICENCIAS DEL GRUPO"), form (email, password, TOTP code when required), info-banner (2FA obligatorio para roles administrativos). Action: `server_action:login` → navigate_to SCR role landing. Data: UserAccount(email, password, totp).

#### SCR-my-requests
Sections: action-bar (primary "Solicitar licencia" → SCR-new-request), filters (estado, fecha), data-table of own LicenseRequest rows: columns solicitud (person/license type), organización (VendorAccount.name), estado (StatusPill), enviada (created_at), decidida (decided_at), needed_by. Row click → SCR-request-detail. Empty state per brand microcopy. Data: LicenseRequest(person_id, license_type_id, vendor_account_id, state, created_at, decided_at, needed_by).

#### SCR-new-request
Sections: form single-column — para quién (self o admin-on-behalf: person email + nombre + compañía pre-suggested), organización/tipo de licencia (VendorAccount + LicenseType selects), justificación (textarea, required), needed_by (date). Inline validations: duplicate active license (blocking, link to existing assignment), domain plausibility (warn), company active, budget headroom (soft warn showing Company.budget_monthly_usd vs current run-rate). Submit `server_action:submitRequest` → navigate_to SCR-request-detail. Info-banner: what happens next (approval SLA 2 días hábiles). Data: Person(email, full_name, company_id), LicenseRequest(justification, needed_by, vendor_account_id, license_type_id), Company(budget_monthly_usd).

#### SCR-request-detail
tpl.workspace-record. Title: "SOLICITUD · {person} · {license_type}". Metadata: company code · vendor account · requested_by · created_at. StatusPill top-right. Sections: (a) metric-cards: estado, días en estado, needed_by, compañía; (b) conditional info-banner callouts — Blocked: "Tu solicitud está aprobada, pero no hay licencias disponibles…" (attention, actions for group_admin: "Ver cupos" → SCR-pools); Failed: retry info (group_admin action "Reintentar" `server_action:retryProvisioning`); (c) conditional checklist panel (mode=orchestration, status pending/sent): renders the step list from ProvisioningAction.raw_request + "Confirmar ejecución" (group_admin; sync verification follows, may flag verification_failed — DEC-SMP-007); (d) timeline (RequestTransition: from→to, actor, occurred_at, note); (d) tabs with counts — Acciones (ProvisioningAction table: kind, mode, status, vendor_ref, sent_at/resolved_at, raw payload drawer for group_admin), Asignación (LicenseAssignment row when active: started_on, register link), Auditoría (AuditLog slice, group_admin). Approver inline actions when state=pending_approval: Aprobar / Rechazar (modal, mandatory comment). Data: LicenseRequest(*), RequestTransition(*), ProvisioningAction(*), LicenseAssignment(started_on, ended_on).

#### SCR-approval-queue
tpl.queue. Cards stack (QueueCard): requester name/email, company, license type + org, justificación, needed_by, cost impact (RateCard.monthly_rate_usd), budget headroom (Company.budget_monthly_usd vs committed), aging chip (24h/48h warning). Inline Aprobar (primary) / Rechazar (modal with mandatory comment → `server_action:decideRequest`). Empty state: "No hay solicitudes pendientes. Te avisaremos por correo cuando llegue una." Data: LicenseRequest(justification, needed_by, created_at, state), Person, Company(budget_monthly_usd), RateCard(monthly_rate_usd), LicenseType.

#### SCR-reclamation-proposals
tpl.queue. Cards: person, company, last-active date + inactive days (30/60/90 badge), license type/org, monthly cost. Actions: "Liberar licencia" (primary, confirm modal — proposal consent per PRD "never silent removal") / "Mantener" (dismiss with note). FreshnessLabel (analytics ~3 días). Data: ActivityRecord(activity_date via last_active), LicenseAssignment(person, company, started_on), RateCard. Import/reconciliation-sourced seats resolve to their system-materialized LicenseRequest (justification "importación inicial"/"reclamo por deriva"), so card → SCR-request-detail navigation and the Acciones trail are uniform across all source_kinds.

#### SCR-admin-dashboard
Sections: metric-cards row 1 (licencias compradas / asignadas / invitaciones pendientes / disponibles — cross-org totals + per-org breakdown link), row 2 (solicitudes en curso by state, inactivas 30+, alertas sin reconocer); data-table "Solicitudes en curso" (recent, all companies); info-banner staleness if any sync >48h; action links → SCR-exceptions, SCR-pools, SCR-usage. Data: VendorAccountCapacity, LicenseAssignment (counts), LicenseRequest (by state), AlertEvent (unacked), ActivityRecord (freshness).

#### SCR-exceptions
Sections: tabs with counts — Bloqueadas (blocked_no_seat requests: request, company, days blocked, action "Ver cupos"), Fallidas (failed + verification_failed ProvisioningActions: retry action), Deriva (drift: console members not in register — claim task form assigning company retroactively → creates LicenseAssignment source_kind=reconciliation), Invitaciones vencidas (invites >7d: withdraw action). Data: LicenseRequest(state), ProvisioningAction(status), LicenseAssignment(source_kind), AlertEvent.

#### SCR-pools
Per-VendorAccount cards-grid: PoolGauge (purchased vs assigned vs pending invites vs free), low-pool attention state (< low_pool_floor), renewal date, mode chip (automated/orchestration). Purchase-or-reclaim callout when a blocked request exists: inactive candidates table (person, company, last-active, monthly cost) beside prorated purchase cost note; actions "Proponer reclamación" → SCR-reclamation-proposals flow / "Registrar compra" (form modal: qty + effective_from → VendorAccountCapacity row, per runbook). Data: VendorAccountCapacity(purchased_qty, effective_from), LicenseAssignment (open count), ProvisioningAction (pending invites), VendorAccount(low_pool_floor, contract_renewal_on, mode), ActivityRecord.

#### SCR-vendor-accounts
data-table: name, vendor, mode (chip), seats purchased/free, renewal, credential health (StatusPill ok/auth_failed/unverified), low_pool_floor. Row → SCR-vendor-account-detail. Action: "Nueva organización" (form modal). Data: VendorAccount(*), Vendor(name, connector_type, provisioning_protocol), VendorAccountCapacity, IntegrationCredential(health).

#### SCR-vendor-account-detail
tpl.workspace-record. Tiles: purchased, assigned, pending, free. Action bar: "Importar miembros (CSV)" (`server_action:importMembersCsv`) + "Importar uso (CSV)" (`server_action:importUsageCsv`) — the API-less ingestion path for csv_import/manual orgs (DEC-SMP-018, US-055). Tabs — Capacidad (VendorAccountCapacity history table + add row form), Credenciales (kind, last4, scopes, health, last_verified_at; rotate action), Tipos de licencia (LicenseType + RateCard current), Configuración (mode automated/orchestration toggle with explanation, ingestion_mode api/csv_import/manual select, low_pool_floor, renewal date). Data: VendorAccount(*), VendorAccountCapacity(*), IntegrationCredential(*), LicenseType(*), RateCard(*).

#### SCR-credentials
data-table across orgs: organización, kind, last4, scopes, health StatusPill, last_verified_at (freshness), status. Actions: "Verificar ahora" (`server_action:verifyCredential`), "Rotar" (modal: paste new secret → creates new row, retires old). Info-banner: least-privilege note (read:members, write:members). Data: IntegrationCredential(*), VendorAccount(name).

#### SCR-companies
data-table: code, name, type (internal/external), status, approvers (names), finance contact, budget_monthly_usd (mono), statement_language. Action: "Nueva compañía" + CSV import (30 seed). Row → SCR-company-detail. Data: Company(*), CompanyRoleAssignment(role=approver → UserAccount names).

#### SCR-company-detail
tpl.workspace-record. Title: company name · code. Tiles: licencias activas, costo mensual actual (mono), presupuesto (budget vs run-rate), personas. Tabs — Personas (Person table of company), Roles (CompanyRoleAssignment: user, role approver/finance/viewer, valid window; add/remove), Licencias (open LicenseAssignment rows), Estados de cuenta (recent Statement list → SCR-statement-detail), Configuración (budget_monthly_usd, finance_contact_email, statement_language es/en, status). Data: Company(*), Person, CompanyRoleAssignment(*), LicenseAssignment, Statement, RateCard.

#### SCR-people
data-table: nombre, email, compañía, status (active/departed), licencia actual (chip or —), last-active (freshness). Filters: company, status, con/sin licencia. Actions: "Nueva persona", CSV import (🟡 bulk marked R2 in backlog but single add R1). Row → SCR-person-detail. Data: Person(*), LicenseAssignment(open), ActivityRecord(last).

#### SCR-person-detail
tpl.workspace-record. Title: full_name. Metadata: email · company · status. Tiles: licencia actual, último uso (freshness), días inactiva. Sections: timeline of LicenseAssignment history (register rows: license, org, company, started/ended, end_reason); data-table ActivityRecord recent (date, counters summary); actions: "Solicitar licencia para esta persona" → SCR-new-request (prefilled), "Iniciar retiro" (offboarding confirm modal, departure same-business-day SLA note). Data: Person(*), LicenseAssignment(*), ActivityRecord(*), LicenseRequest.

#### SCR-register
The register. filters (company, org, license type, abierta/cerrada, rango de fechas), data-table: persona, compañía (code), organización, tipo, started_on, ended_on (— actual when open), end_reason (chip), source (request link / import / reconciliation). Row expander: source request, statement lines touching the row (traceability both directions). Export CSV. Info-banner: integrity note (sin brechas ni solapamientos — DB-enforced). Data: LicenseAssignment(*), Person, Company, VendorAccount, LicenseType, StatementLine(assignment_id backlink).

#### SCR-usage
Sections: filters (company, window 30/60/90), metric-cards (activas 30d %, marcadas inactivas, sin datos), data-table: persona, compañía, última actividad (date + FreshnessLabel), días inactiva, badge 30/60/90, licencia (type/org), acción "Proponer reclamación" (batch select → creates proposals for approver). Freshness banner: "datos al {date} (retraso ~3 días del proveedor)". Data: ActivityRecord(*), Person, Company, LicenseAssignment(open).

#### SCR-alerts
tabs — Sin reconocer / Todas. data-table: fired_at, tipo (approval_aging, provisioning_failure, blocked_no_seat, low_pool, invite_unaccepted, sync_stale, credential_failure, register_drift), alcance (global/compañía/org), asunto (subject_ref link), notificados, reconocida por/at. Action per row: "Reconocer" (`server_action:ackAlert`). Data: AlertEvent(*), AlertRule(type, scope).

#### SCR-audit
filters (entity_type, action, actor, date range), data-table: occurred_at, actor (— sistema), action, entidad (type + link), compañía. Row expander: before/after JSON diff viewer (read-only). Info-banner: registro inmutable (append-only a nivel de base de datos). Data: AuditLog(*).

#### SCR-users-roles
tabs — Usuarios (UserAccount: email, global_role chip, persona vinculada, 2FA estado — derivado de `totp_secret_encrypted IS NOT NULL`, sin columna propia —, status, last_login_at; actions nueva cuenta / desactivar / reset 2FA), Roles por compañía (CompanyRoleAssignment: user, company, role, valid_from/to; add/remove; delegation window fields marked 🟡). Data: UserAccount(*), CompanyRoleAssignment(*), Person(link).

#### SCR-statements
filters (period, company [central/admin only], status draft/final/reconciled). data-table: período, compañía (code), estado StatusPill, apertura (opening_seats), total (mono), generado. Row → SCR-statement-detail. company_finance sees own company only. Data: Statement(*), Company(code, statement_language).

#### SCR-statement-detail
tpl.workspace-record. Title: "ESTADO DE CUENTA · {company} · {period}". Tiles: total USD, licencias-día, altas, bajas. data-table lines: kind badge (licencia/uso/ajuste), persona, org, tipo, período (from–to), licencias-día, tarifa (mono), importe (mono). Row expander → RegisterDrilldown (assignment rows + dates; "ver evidencia"). Actions: Exportar CSV / Exportar PDF (in Company.statement_language). Status banner if draft/reconciled. Data: Statement(*), StatementLine(*), LicenseAssignment(via assignment_id), RateCard.

#### SCR-close
tpl.close-workbench. Tiles: período actual, statements generados x/30, borradores, finales, total del período (grupo — SUM Statement.total_usd, mono; from CloseRun-stamped statements). Action-bar: "Ejecutar cierre {period}" (primary, confirm modal; disabled with reason if already final) → `server_action:runClose`; progress + last close runtime (<5 min NFR, from CloseRun); secondary "Exportar consolidado CSV/PDF" (`server_action:exportRollupCsv|Pdf` — PRD Module E "statement and rollup as CSV and PDF", FEAT-028). data-table: per-company statement status (draft/final) with links. Info-banner: bd-3 target + what the close computes (register × tarifas + costos de uso). Data: Statement(status by period), Company, close job state.

#### SCR-reconciliation
tpl.close-workbench. Per VendorAccount cards: rollup_amount (mono), invoice input (form: invoice_amount_usd), variance (auto, colored by 0.5% tolerance), status chip (open/reconciled/overridden). Variance table: per-line contributors (mid-cycle proration, invite-consumed, timing). Override modal: mandatory note, records overridden_by (role per OQ-SMP-11 — render for central_finance + group_admin until decided). Data: Reconciliation(*), Statement(rollup), VendorAccount.

#### SCR-rates
tabs — Tarifas (RateCard table: org, tipo, monthly_rate_usd mono, effective_from/to; add effective-dated row; past rows locked once consumed by a close), Capacidad (VendorAccountCapacity history: org, tipo, purchased_qty, effective_from, note). Info-banner: proration daily actual/actual. Data: RateCard(*), VendorAccountCapacity(*), LicenseType, VendorAccount.

#### SCR-settings
form sections — Alertas (per AlertRule type: enabled, thresholds: aging 24/48h, low_pool_floor default 5, invite unaccepted 7d + auto-withdraw window, staleness 48h), Notificaciones (email remitente, escalation target), Sistema (idioma por defecto, retention note). Save per section. Data: AlertRule(*), VendorAccount(low_pool_floor override note).

#### SCR-access-denied
info-banner: "No tienes acceso a esta sección" + link to role landing. No data.

### SEC06 — Screens JSON

The schema-v3 TOONs live at `v1/toon/SCR-*.json` (28 files) — the structural source of truth for `hydrate --extract 07_screens` and the mock generator. This document's SEC05 briefs are their authoring contract.

### SEC07 — Navigation Map

See `v1/07c_navigation_map.json` (HR-30/31): routes, params, navigation graph (MUST be the closure of all TOON-declared navigate_to / row_on_click / on_click cross-screen targets), role sidebars (rail sections OPERACIÓN / FINANZAS / ADMINISTRACIÓN), user flows for J1–J4.

### SEC08 — Open Questions

- OQ-SMP-11 (override role) → SCR-reconciliation renders the override for central_finance + group_admin until decided.
- Q5/OQ-SMP-6 (Console-org usage reporting) → no R1 screen; would add a tab to SCR-usage (🟡).
- CSV person bulk import per company is 🟡 (Module A P1) — SCR-people ships single-add + the 30-company seed path only.
- LicenseType creation UI is deferred with the manual vendor registry (FEAT-R2-01, 🟡): R1 seeds license types; premium tiers confirmed later (OQ-SMP-4/OQ-ER-3) enter via the R2 registry or a seed migration — SCR-vendor-account-detail's Tipos tab stays read-only in R1.

### SEC09 — Coverage Justification

- Every J1–J4 stage from `03_journeys` maps to ≥1 screen (SEC03); every §10 state is visible via StatusPill on SCR-my-requests / SCR-request-detail / SCR-approval-queue / SCR-exceptions.
- Every PRD P0 module has a surface: A → companies/people/company-detail; B → new-request/approval-queue/request-detail; C → pools/vendor-accounts/exceptions/settings; D → usage/reclamation-proposals; E → register/statements/statement-detail/close/reconciliation/rates; F → admin-dashboard + scoped views; G → alerts/settings; H → login/credentials/users-roles/audit; I → vendor-accounts (capability fields visible), vendor-neutral labels everywhere.
- All 22 ER entities are surfaced except pure-plumbing rows (CostRecord appears inside statement usage lines and close math; Vendor appears within vendor-accounts screens) — the coherence review validates both directions.
