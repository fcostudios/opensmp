## Work Readiness Gate

Before writing a design, implementation plan, production code, test, migration,
or executable tooling for any US-* or CHG-*, run its approved readiness
assessment. A work item above 320 minutes or any cohesion limit is not
execution-ready; partition it into official, approved vertical children first.

Run `pnpm readiness:check -- <WORK-ID>`. The complete mandatory contract is in
[`docs/dev-guide/WORK_READINESS.md`](docs/dev-guide/WORK_READINESS.md).

## Sprint 1 Execution Contract (DEC-SMP-017 / CHG-001)

- `Company` is the Ledger application-tenant boundary. Every company-scoped
  query filters the real `company_id` column declared by its table.
- `VendorAccount` is a vendor organization/account, not a Ledger application
  tenant or authorization boundary.
- Auth.js obtains identity from Keycloak. Ledger obtains authorization from
  `UserAccount` and `CompanyRoleAssignment` in its own database.
- Keycloak renders and verifies OIDC passwords and TOTP challenges. Ledger
  redirects to Keycloak and never renders or collects those credentials.
- Retained, operator-queryable Keycloak security events are US-004 evidence for
  password/TOTP failures. Ledger `AuditLog` records successful OIDC/session
  linking plus callback and authorization failures that Ledger observes.
- US-004 establishes and tests the Keycloak admin-service seam required for
  admin-group synchronization. The complete user-management UI remains US-011.
- Releases apply committed migrations as `ledger_owner`; the application runs
  as `ledger_app`.
- Docker Compose on a VPS is the R1 deployment target.
