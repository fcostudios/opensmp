# US-011: Users, roles and delegation-ready grants

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to administer platform accounts and company-scoped roles so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-011 |
| Feature | FEAT-036 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | SCR-users-roles |
| Server Actions | createUserAccount, disableUserAccount, resetTwoFactor, addCompanyRole, removeCompanyRole |
| Entities | UserAccount (CRU), CompanyRoleAssignment (CRD) |
| Business Rules | — |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: Create/disable accounts via the Keycloak admin client (ADR-03; mandatory motivo note → AuditLog.note); reset 2FA = Keycloak OTP-credential removal + CONFIGURE_TOTP required action (note required)
- [ ] AC2: Grant/remove company roles (approver/finance/viewer) with valid_from/to fields present (delegation itself 🟡)
- [ ] AC3: 2FA estado read from Keycloak's OTP-credential state for the account's `idp_subject` via the admin client (ADR-03; `totp_secret_encrypted` unused under Keycloak)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
