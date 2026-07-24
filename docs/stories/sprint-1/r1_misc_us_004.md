# US-004: Platform auth via Keycloak OIDC (mandatory 2FA for admin roles)

> **Sprint 1** | **P0** | **3 SP** | **R1**

## User Story

As a End User (persona_05), I want to log in securely so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-004 |
| Feature | FEAT-039 |
| Sprint | Sprint 1 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 |
| Screens | SCR-login, SCR-access-denied |
| Server Actions | login |
| Entities | UserAccount (R/U idp_subject) |
| Business Rules | — |
| Blocked By | US-003 |

## Acceptance Criteria

- [ ] AC1: OIDC authorization-code login against self-hosted Keycloak (realm `corporativo`, ADR-03/DEC-SMP-014); TOTP enforced by realm policy for `platform-admin` group members; `UserAccount.idp_subject` linked on first login
- [ ] AC2: Role-based landing per SEC02 (employee→my-requests, approver→queue, company_finance→statements, central_finance→close, group_admin→panel)
- [ ] AC3: Logins/failures audit-logged; `last_login_at` updated; access-denied for out-of-scope routes; Keycloak realm export in repo + seeded CI users; business roles live ONLY in Ledger's DB (Keycloak carries none)
- [ ] AC4: Granting/removing group_admin or central_finance syncs `platform-admin` group membership (ADR-03); seeded-CI-user tests: newly-granted admin is TOTP-challenged on next login; disabled account cannot obtain a session; admin without TOTP configured is rejected by realm policy

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 1 milestone: Foundations complete: schema+integrity, auth (Keycloak), RBAC, shell, seeds+backfill, jobs, audit, API probe spike. GATE: org inventory + per-org keys (OQ-SMP-1) cleared before US-007/US-054.
