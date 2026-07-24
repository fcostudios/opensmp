# DEC-SMP-017 — Sprint 1 Execution Contract

| Field | Value |
|---|---|
| Status | Decided |
| Date | 2026-07-24 |
| Decided by | Francisco Lomas |
| Change control | CHG-001 |
| Applies to | US-001, US-003, US-004, US-005, US-007, US-054 |

## Context

The authoritative ER model and generated Drizzle schema use `company_id` for
Ledger's company isolation boundary, while synchronized agent guidance still
described a different tenant key. The same generated guidance also retained
authentication and hosting defaults that conflict with the accepted Keycloak
and self-hosted architecture. Sprint 1 cannot begin safely with contradictory
instructions on tenant isolation, credential ownership, audit evidence,
database privileges, or deployment.

## Decision

### Tenant boundary

`Company` is the Ledger application-tenant boundary. Every company-scoped query
must filter the actual `company_id` column declared by the table, as specified
by `docs/specs/04_er_model.md` SEC6.

`VendorAccount` represents a vendor organization/account, including a vendor's
own notion of an organization. It is business data within Ledger; it is not a
Ledger application tenant or an authorization boundary.

### Authentication and authorization

Auth.js performs the OIDC authorization-code flow against Keycloak. Keycloak
provides the authenticated identity. Ledger resolves authorization from
`UserAccount.global_role` and `CompanyRoleAssignment` in Ledger's database;
Keycloak carries no Ledger business roles.

Keycloak renders and verifies OIDC passwords and TOTP challenges. Ledger
redirects to Keycloak and does not render, collect, proxy, or persist those
credentials.

### Authentication-failure evidence

Keycloak is the system of record for password and TOTP failure events. For
US-004, the Keycloak realm must retain security events for the agreed
operational period and make them queryable by authorized operators. US-004 must
include a tested integration or operational verification proving those retained
events can be queried.

Ledger `AuditLog` records successful OIDC/session linking and callback or
authorization failures that Ledger itself observes. Provider errors must be
sanitized. Sprint 1 will not build a Keycloak-event ingestion adapter.

This keeps sensitive authentication telemetry with the system that owns the
credentials and TOTP policy, avoids duplicated failure records, and avoids an
integration seam that Sprint 1 does not require.

### Story boundary

US-004 establishes and tests the Keycloak admin-service seam needed to
synchronize `platform-admin` membership when Ledger admin roles change. Full
account administration, reset-2FA workflows, role-management surfaces, and the
complete user-management UI remain in US-011.

### Database and deployment roles

Releases apply committed database migrations as `ledger_owner`. The deployed
Next.js application connects as the lower-privilege `ledger_app` role.

Docker Compose on a VPS is the R1 deployment target. R1 documentation,
automation, and acceptance evidence must not assume a managed deployment
platform.

## Consequences

- Tenant-isolation reviews and tests assert company isolation through
  `company_id`.
- Vendor-account filters may narrow business data but never replace a company
  authorization predicate.
- The login UI is a redirect entry point; credential and TOTP forms belong to
  Keycloak.
- US-004 acceptance evidence spans Ledger-observed session/callback behavior
  and operator-queryable Keycloak security events without copying those events
  into Ledger.
- Migration and runtime connection strings are distinct and least-privileged.
- Generator-owned documentation that contradicts this decision is governed by
  CHG-001 and must be regenerated or corrected before Sprint 1 work proceeds.
