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

## Build, bundler and tenant-isolation facts (tenant-authored; carried from CLAUDE.md on 2026-09-07)

### Bundler

- **Bundler: webpack** — `scripts.build` runs `next build --webpack` (Serwist injects a webpack config; Turbopack would hard-fail). Module imports MUST include file extensions for non-TS files (e.g., `import preset from './tailwind-preset.js'`).

### Tenant isolation

- **Tenant isolation:** every company-scoped query filters by the real
  `company_id` column. Confirm the column in `packages/db/src/schema.ts`;
  `VendorAccount` references do not define Ledger tenant scope.

### Build verification gate (tenant additions)

- `pnpm build` succeeds — runs `next build --webpack` (the production/PWA bundler).
- `pnpm test` passes — Vitest across the workspace. Tests must meet the effectiveness bar in [`docs/dev-guide/TESTING.md`](docs/dev-guide/TESTING.md) §4 (real-DB seam tests via the pglite fixture, strongest available oracle; coverage is a diagnostic, never a completion target — TE-1 / R1).
- Committed migrations apply to a fresh database as `ledger_owner`, then
  `node packages/db/scripts/verify-schema.mjs` verifies the result. Application
  runtime checks use `ledger_app`; no duplicate timestamp migrations exist
  under `packages/db/src/migrations/`.
- Report evidence: `{"story":"US-XXX","event":"build_pass",...}` then `{"event":"done",...}`.
