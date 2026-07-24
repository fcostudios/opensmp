# Security Reference Guide

Authentication, authorization, and tenant scoping for this serverless Next.js app.
See `CLAUDE.md` for the condensed rules; this file is the authoritative reference.

## Protecting a Route Handler

```ts
// apps/web/src/app/api/<resource>/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@smp/db";
import { member } from "@smp/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = (session as any).orgId as string;          // tenant claim (set by the session callback)
  const rows = await db
    .select()
    .from(member)
    .where(eq(member.org_id, orgId));                        // filter the real tenant column
  return NextResponse.json(rows);
}
```

**Key patterns:**
- Every protected handler calls `auth()` first — no session → `401`.
- The tenant id comes from the **session claim** (`org_id`), NEVER from the request body/query.
- Every Drizzle query on a multi-tenant table filters `org_id` (the generated tenant column — confirm it in `schema.ts`; there is no `tenant_id`). Add a soft-delete filter (`deleted_at`) ONLY on a table that declares one — most tables hard-delete and have no `is_deleted` column.
- Role-gate a mutation with the session roles claim:
  ```ts
  const roles = ((session as any).roles ?? []) as string[];
  if (!roles.includes("PRESIDENTE")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```
- NEVER trust a role or tenant supplied by the client; only the verified session.

## Client-Side Auth

- The app is wrapped in `AuthSessionProvider` (`@/lib/auth/session-provider`), already mounted in the root layout.
- Read the user with `useSession()` from `next-auth/react`.
- Gate UI with `hasMinRole(roles, minRole)` from `@/lib/auth/roles` — hierarchy is `ROLE_HIERARCHY`, generated from the nav-map RBAC.
- Log out via `logout()` from `@/lib/auth/logout` (ends the NextAuth session AND the keycloak SSO session).
- Never render a raw user id as identity — use the display name from the session.
