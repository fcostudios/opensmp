# 10 — Plan: Ledger (`fcostudios__smp`)

**Step:** 10 — Plan · **Date:** 2026-07-22 (rev 2, post plan-review) · **Report language:** en-US
**Inputs:** `08_scope.md` (55 stories, cycle-free DAG) · `09_architecture.md` · `09b` · PRD §16 (D4) · sizing (tier M).

## SEC1 — Sprint plan (PRD §16 mirror; hydrator forbids Sprint 0 → PRD "Sprint 0" folds into Sprint 1)

Capacity model: 2 FTEs, AI-assisted; target ≈ 30–40 SP/week-sprint (velocity assumption — **replan trigger:** if Sprint 1 actuals < 25 SP, re-baseline Sprints 2–5 to 1.5-week sprints before Sprint 2 commits; the week-2/week-4 milestone dates shift with the re-baseline). The 6-week plan is the FLOOR of the Step-1 sizing range (1.5–3 months); 7–9 weeks is the sizing-consistent expectation band — **Step 11 must price duration/cost as that band with the 6-week floor as best-case, not the point estimate.**
**Calendar anchor:** parallel close #1 (US-052) runs over the most recently completed calendar month at Sprint-5 start, using the US-007 backfill + US-026 synced data on production (US-053); statements land within bd-3 of that anchor and reconciliation by ~bd-10. Go-live = when that close reconciles — honestly stated as end-of-Sprint-6 at best and up to ~week 8–9 if the anchor month closes late.
**Weeks 5–6 cost treatment for Step 11:** Sprint 5 = 0 SP of stories + ~1 FTE-week parallel-run/close-rehearsal reserve; Sprint 6 = 1 FTE-week bugfix/go-live reserve — both reserves priced as FTE-time, not SP.

### Sprint 1 — Foundations (31 SP)

**Milestone:** Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-001 | Scaffold the monorepo and app skeleton | 2 | — |
| US-002 | Docker Compose runtime + CI pipeline | 3 | US-001 |
| US-003 | Core schema migration with DB-level register integrity | 5 | US-002 |
| US-004 | Platform auth via Keycloak OIDC (mandatory 2FA for admin roles) | 3 | US-003 |
| US-005 | Server-side RBAC + company scoping middleware | 3 | US-004 |
| US-006 | App shell: data-workspace chrome + bilingual i18n | 5 | US-004 |
| US-007 | Seed: companies CSV + go-live register backfill | 3 | US-003 |
| US-008 | Immutable audit trail + viewer | 3 | US-005 |
| US-046 | Job runner + schedules | 3 | US-002 |
| US-054 | Anthropic API probe spike | 1 | — |

### Sprint 2 — Usable workflow (orchestration end-to-end) (34 SP)

**Milestone:** USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-010 | Person records + edit + auto-create on request | 3 | US-005 |
| US-014 | Lifecycle state machine engine | 3 | US-003 |
| US-012 | Request intake with validations | 3 | US-007, US-010, US-014 |
| US-013 | My requests + request detail record | 3 | US-012 |
| US-015 | Approval queue: one-minute decisions | 3 | US-014 |
| US-016 | Lifecycle notifications (email) | 2 | US-012, US-003 |
| US-033 | The register surface + export | 3 | US-007 |
| US-042 | Alert engine: 8 P0 types | 3 | US-046, US-003 |
| US-017 | Approval aging: reminder + escalation job | 2 | US-015, US-042, US-046 |
| US-022 | Per-org pool tracking + low-pool alert | 3 | US-007, US-042 |
| US-045 | Connector interface + orchestration routing | 3 | US-003 |
| US-020 | Orchestration mode: checklist + confirm + verification | 3 | US-014, US-045 |

### Sprint 3 — Automation + monitoring (40 SP)

**Milestone:** Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift, API-less ingestion (CSV import + manual upkeep, DEC-SMP-018). Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-011 | Users, roles and delegation-ready grants | 3 | US-005 |
| US-018 | Anthropic connector client | 3 | US-003, US-045 |
| US-019 | Automated provisioning: invite ≤ 15 min → Active | 5 | US-018, US-014, US-046, US-042 |
| US-021 | Invite hygiene | 2 | US-019, US-042 |
| US-023 | Blocked-no-seat + purchase-or-reclaim flow | 3 | US-022, US-042 |
| US-024 | Offboarding + deprovisioning | 3 | US-019, US-020 |
| US-025 | Vendor accounts + capability descriptor | 3 | US-005 |
| US-026 | Analytics sync: activity + cost | 3 | US-018, US-046 |
| US-027 | Inactivity flags + usage surface | 2 | US-026 |
| US-028 | Reclamation proposals: approve or dismiss | 3 | US-027, US-024 |
| US-029 | Freshness labels + staleness alert | 2 | US-026, US-042 |
| US-030 | Drift detection + retroactive claim | 3 | US-018, US-046, US-042 |
| US-055 | API-less ingestion: member/usage CSV import + manual register upkeep | 3 | US-003, US-025, US-026, US-030 |
| US-043 | Alert log + acknowledgment | 2 | US-042 |

### Sprint 4 — Money + production readiness (39 SP)

**Milestone:** Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-009 | Company registry CRUD + company record | 3 | US-005 |
| US-031 | Credential management + rotation | 3 | US-005 |
| US-032 | Effective-dated rate cards | 2 | US-005 |
| US-034 | Monthly close job + CloseRun | 5 | US-032, US-033 |
| US-044 | Operational settings | 2 | US-005 |
| US-048 | Ops runbooks + backup/restore drill | 2 | US-002, US-031 |
| US-049 | Statement PDF brand template | 3 | US-003 |
| US-050 | Close usage lines from CostRecord via the register | 2 | US-034, US-026 |
| US-035 | Statement finalization | 2 | US-050 |
| US-036 | Statement detail + kind-aware evidence | 3 | US-050 |
| US-037 | Statement exports (CSV/PDF, per-company language) | 2 | US-036, US-049 |
| US-038 | Reconciliation workbench + variance lines | 3 | US-035 |
| US-039 | Consolidated rollup + export | 2 | US-050 |
| US-051 | Close schedule + workbench readouts | 2 | US-050, US-046 |
| US-053 | Production environment + first deploy | 3 | US-002 |

### Sprint 5 — Hardening + first parallel close (11 SP)

**Milestone:** Hardening + FIRST PARALLEL CLOSE (US-052, on production): dashboards/perf fixture, scoped views, isolation suite. Go-live gate.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-040 | Cross-company admin dashboard | 3 | US-022, US-042 |
| US-041 | Scoped per-company experience | 2 | US-009, US-005 |
| US-047 | Company-isolation test suite | 3 | US-041, US-034 |
| US-052 | Execute the first parallel close on real data | 3 | US-034, US-038, US-050, US-053 |

### Sprint 6 — Go-live (no new stories)
Bugfix/go-live reserve (1 FTE-week); go-live as system of record when the US-052 close reconciles.

## SEC2 — Sequencing rationale (risk-first)
- Orchestration path (US-020/045) lands in Sprint 2 WITHOUT the API client (DEC-SMP-007): a beta-API problem cannot slip the usable-product milestone.
- Beta-API surprise-detection pulled to Sprint 1 (US-054 probe spike, real keys); implementation risk retired at the start of Sprint 3.
- **Sprint-3 slip fallback:** Sprint 4 proceeds with rates + license-line-only close drafts + statement template (US-032, US-034, US-044, US-049 — no analytics dependency); US-050 and its dependents (US-035/036/037/038/039/051) join when US-026 lands.
- Register migration (US-003, slug=core_schema_register_integrity) is Sprint 1 (HR-25 slugs in story Meta; no Vxxx).
- Close split (US-034→050→051) inside Sprint 4; US-049 unblocked from the close (prereq = schema) so the template runs parallel.
- Production deploy (US-053) + restore drill (US-048) land in Sprint 4 — proven a week before the go-live gate; Sprint 5 concentrates the perf fixture, isolation suite and the parallel close itself.

## SEC3 — Ordering + staffing notes
- Sprint tables are in TOPOLOGICAL execution order (a story never appears above a same-sprint blocker) — validated mechanically.
- US-013 must stay in Sprint 2: it owns SCR-request-detail, the surface the US-020 checklist panel and Sprint-3 stories render onto.
- Sprint 4 note: the US-032→US-034→US-050→US-036→US-037 chain (14 SP) is serial on one FTE; effective Sprint-4 staffing ≈ 1.5 FTE — **Step 11 should price Sprint 4 by duration, not SP/velocity.**
- Sprint 5 deliberately runs light: reserve for parallel-close operation, variance fixes, and Sprint 2/3 spillover.

## SEC4 — Gates & external dependencies
- Before US-007/US-054: org inventory + per-org Analytics/Admin keys (OQ-SMP-1; primary-owner action per org).
- Before US-052: contracted rates (OQ-SMP-4) and the calendar anchor month confirmed (month-end + bd-3 + reconciliation window inside Sprints 5–6).
- Before US-053: hosting root (OQ-SMP-7).
- Go-live: approver roster (OQ-SMP-5); US-048 restore drill (Sprint 4); US-052 reconciled.
