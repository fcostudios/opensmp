## Authentication-Failure Evidence (US-004)

- Keycloak is the system of record for password and TOTP failures.
- The realm configuration must retain security events for the agreed
  operational period and make them queryable by authorized operators.
- US-004 must include a tested integration/operational check proving retained
  password/TOTP failures can be queried. Sprint 1 does not ingest those events
  into Ledger.
- Ledger `AuditLog` records successful OIDC/session linking and the callback or
  authorization failures that Ledger itself observes. Sanitize provider errors;
  never copy credentials, tokens, TOTP values, or raw sensitive payloads.
- US-004 establishes and tests the Keycloak admin-service seam used to
  synchronize `platform-admin` membership. Complete account administration,
  reset-2FA workflows, and the user-management UI remain US-011.

## Tenant boundary note (tenant-authored)

- `Company` is the application-tenant boundary. `VendorAccount` is a vendor
