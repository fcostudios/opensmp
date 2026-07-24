# Coding Standards Reference

Entity conventions, error handling, and field standards for the serverless stack.
See `CLAUDE.md` for the condensed rules and tables.

## Drizzle Entity Convention

```ts
// packages/db/src/schema.ts
import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";

export const member = pgTable("member", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  org_id: uuid("org_id").notNull(),               // tenant column (generated on every table)
  // ... domain columns ...                          (camelCase JS keys, snake_case SQL names)
  createdAt: timestamp("created_at").notNull(),   // set in app code (no .defaultNow())
  updatedAt: timestamp("updated_at"),             // nullable until first update
  // NOTE: no universal soft-delete column. A table only has `deleted_at`
  // when its entity declares one — most tables hard-delete. Never assume an
  // `is_deleted`/`deleted_at` column exists; check schema.ts for the real table.
});

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
```

- Derive row types from the schema (`$inferSelect` / `$inferInsert`) — never hand-write a divergent interface.
- Reuse the exported table; do NOT redeclare its columns in a second module.
- The tenant column is `org_id` (uuid) on every multi-tenant table — there is no `tenant_id`.

## Enums

Column enums are `pgEnum` values **defined in the schema** (`schema.ts`) and exported
alongside the tables. Use the exact members declared there (reference the generated
`pgEnum(...)` literal — e.g. via the column's inferred union type); never invent a
string value — an unknown member fails the DB enum check at insert/update time.

## Tenant & Actor Extraction

```ts
const session = await auth();
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const orgId = session.user.org_id as string;       // tenant scope (the org_id column)
const actorSub = session.user.sub as string;       // stable IdP subject
```

- **Never** read the tenant id from the request body/query — only the verified session claim.
- Every multi-tenant query filters `org_id` (the generated tenant column). Apply a soft-delete filter (`deleted_at`) ONLY on a table that declares one in `schema.ts` — do not assume `is_deleted` exists.

## Error Handling Standard

| Situation | Response |
|-----------|----------|
| Unauthenticated | `NextResponse.json({ error }, { status: 401 })` |
| Wrong role / forbidden | `{ status: 403 }` |
| Validation failure (Zod) | `{ status: 400 }` with the issues |
| Duplicate / constraint | `{ status: 409 }` |
| Business rule violated | `{ status: 422 }` |

Validate input with a shared Zod schema before touching the database; return the
parsed value, never the raw request.

## API Contract Reconciliation

`docs/scripts/nous_api_reconcile.py` reconciles the route handlers against the
TOON `dataSource` registry. Match each handler path exactly to the TOON `dataSource.url`.

## Field Standards

```tsx
// Phone — always type="tel"
<input type="tel" name="phone" placeholder="+593 99 999 9999" />

// Money — display via the shared formatter; inputs type="number" step="0.01"
<span>{format(account.amount)}</span>
<input type="number" step="0.01" name="amount" />

// Email — type="email", not text+regex
<input type="email" name="email" />
```
