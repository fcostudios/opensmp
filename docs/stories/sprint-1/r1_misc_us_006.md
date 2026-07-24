# US-006: App shell: data-workspace chrome + bilingual i18n

> **Sprint 1** | **P0** | **5 SP** | **R1**

## User Story

As a End User (persona_05), I want to navigate a branded, bilingual workspace so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-006 |
| Feature | FEAT-043 |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 5 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | all |
| Screens | app shell (all screens) |
| Server Actions | — |
| Entities | UserAccount (U ui_language) |
| Business Rules | BR-26 |
| Blocked By | US-004 |

## Acceptance Criteria

- [ ] AC1: Dark rail per DEC-SMP-012 (sections OPERACIÓN/FINANZAS/ADMINISTRACIÓN, filled-orange active item), condensed display titles, breadcrumbs
- [ ] AC2: next-intl catalogs es-EC (tú, vocabulary lock) + en-US; per-user selector persists to `UserAccount.ui_language`; fallback to SystemSetting `default_language`
- [ ] AC3: 12-chip StatusPill component (single source of state colors) + FreshnessLabel + MoneyText (mono, es-EC formats)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
