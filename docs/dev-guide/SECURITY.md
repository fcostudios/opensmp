# Security Reference Guide

Authentication, authorization, and company scoping for the self-hosted Next.js
app. See `CLAUDE.md` for the condensed rules; this file is the authoritative
reference.

## Identity and Authorization Boundary

- Auth.js performs OIDC authorization-code redirects against the self-hosted
  Keycloak realm `corporativo`.
- Keycloak is the identity provider. It renders and verifies passwords and TOTP;
  Ledger must never render, collect, proxy, or persist those credentials.
- Ledger is the authorization source of truth. After verifying the session,
  resolve the matching `UserAccount` and its `CompanyRoleAssignment` rows.
  Keycloak carries no Ledger business roles.
- `Company` is the application-tenant boundary. `VendorAccount` is a vendor
  organization/account inside Ledger, not an application tenant.

## Protecting a Route Handler

```ts
// apps/web/src/app/api/<resource>/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@smp/db";
import { statement } from "@smp/db/schema";
import { inArray } from "drizzle-orm";
import { loadLedgerAuthorization } from "@/lib/auth/authorization";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorization = await loadLedgerAuthorization(session.user.idpSubject);
  const rows = await db
    .select()
    .from(statement)
    .where(inArray(statement.companyId, authorization.companyIds));

  return NextResponse.json(rows);
}
```

**Key patterns:**

- Every protected handler calls `auth()` first — no session → `401`.
- Roles and authorized company IDs come from Ledger DB, never from the request
  body/query and never from a client-supplied claim.
- Every company-scoped Drizzle query filters the real `company_id` column
  declared by its table. Add a soft-delete filter (`deleted_at`) only on a
  table that declares one.
- Role-gate mutations with the Ledger authorization result:

  ```ts
  if (!authorization.roles.includes("group_admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```

- A vendor-account filter can narrow business data, but it never replaces the
  company authorization predicate.

## Client-Side Auth

- The app is wrapped in `AuthSessionProvider`
  (`@/lib/auth/session-provider`), already mounted in the root layout.
- Read the Auth.js session with `useSession()` from `next-auth/react`.
- Gate UI with `hasMinRole(roles, minRole)` from `@/lib/auth/roles`; the server
  must independently enforce the same Ledger DB authorization.
- Log out via `logout()` from `@/lib/auth/logout` (ends the Auth.js session and
  the Keycloak SSO session).
- Never render a raw user id as identity; use the display name from the
  verified session.

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
