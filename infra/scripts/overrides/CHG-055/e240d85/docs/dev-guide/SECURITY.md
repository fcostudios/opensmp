# Security Reference Guide

Authentication, authorization, and tenant scoping for this self-hosted Next.js app.
See `CLAUDE.md` for the condensed rules; this file is the authoritative reference.

## Identity and Authorization Boundary

- Auth.js with Keycloak performs OIDC authorization-code redirects against the Keycloak realm `corporativo`.
- Keycloak is the identity provider. It renders and verifies credentials; this
  application must never render, collect, proxy, or persist them.
- **This application's own database is the authorization source of truth.** After
  verifying the session, resolve the subject's grants from `UserAccount` and `CompanyRoleAssignment` —
  Keycloak carries no application roles.
- Every read and write is scoped to the tenant set that resolution returns, never
  to a value that arrived in a token.

## Protecting a Route Handler

```ts
// apps/web/src/app/api/<resource>/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@smp/db";
import { alertRule } from "@smp/db/schema";
import { inArray } from "drizzle-orm";
import { loadLedgerAuthorization } from "@/lib/auth/authorization";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authorization = await loadLedgerAuthorization(session.user.id);   // grants from this app's own tables
  const rows = await db
    .select()
    .from(alertRule)
    .where(inArray(alertRule.companyId, authorization.companyIds));          // the AUTHORIZED tenant set
  return NextResponse.json(rows);
}
```

**Key patterns:**
- Every protected handler calls `auth()` first — no session → `401`.
- Tenant scope and roles come from `UserAccount` and `CompanyRoleAssignment` via `loadLedgerAuthorization(...)` — NEVER from the request body/query, and NEVER from a client-supplied claim.
- Every Drizzle query on a multi-tenant table filters `company_id` against the authorized set (`authorization.companyIds`) — confirm the column in `schema.ts`; there is no `tenant_id`. Add a soft-delete filter (`deleted_at`) ONLY on a table that declares one — most tables hard-delete and have no `is_deleted` column.
- Role-gate a mutation with the RESOLVED authorization, not a claim:
  ```ts
  if (!authorization.roles.includes("GROUP_ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```
- NEVER trust a role or tenant supplied by the client — **including one that arrives in a token claim**; only the grants this application resolved.

## Client-Side Auth

- The app is wrapped in `AuthSessionProvider` (`@/lib/auth/session-provider`), already mounted in the root layout.
- Read the user with `useSession()` from `next-auth/react`.
- Gate UI with `hasMinRole(roles, minRole)` from `@/lib/auth/roles` — hierarchy is `ROLE_HIERARCHY`, generated from the nav-map RBAC. The server MUST independently re-resolve and enforce the same grants.
- Log out via `logout()` from `@/lib/auth/logout` (ends the NextAuth session AND the keycloak SSO session).
- Never render a raw user id as identity — use the display name from the session.

## Project additions

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
<!-- nous-emitted: sha256=4851bab272c5da23 -->
