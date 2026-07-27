# Coding Standards Reference

Entity conventions, error handling, and field standards for the self-hosted
Next.js stack.
See `CLAUDE.md` for the condensed rules and tables.

## Drizzle Entity Convention

```ts
// packages/db/src/schema.ts
import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";

export const statement = pgTable("statement", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  companyId: uuid("company_id").notNull(),        // company scope (camelCase key, snake_case SQL)
  // ... domain columns ...                          (camelCase JS keys, snake_case SQL names)
  createdAt: timestamp("created_at").notNull(),   // set in app code (no .defaultNow())
  updatedAt: timestamp("updated_at"),             // nullable until first update
  // NOTE: no universal soft-delete column. A table only has `deleted_at`
  // when its entity declares one — most tables hard-delete. Never assume an
  // `is_deleted`/`deleted_at` column exists; check schema.ts for the real table.
});

export type Statement = typeof statement.$inferSelect;
export type NewStatement = typeof statement.$inferInsert;
```

- Derive row types from the schema (`$inferSelect` / `$inferInsert`) — never hand-write a divergent interface.
- Reuse the exported table; do NOT redeclare its columns in a second module.
- Company-owned records use `companyId: uuid("company_id")`. Confirm the
  actual column on the table; `VendorAccount` is vendor-organization data and
  does not define Ledger tenant scope.

## Enums

Column enums are `pgEnum` values **defined in the schema** (`schema.ts`) and exported
alongside the tables. Use the exact members declared there (reference the generated
`pgEnum(...)` literal — e.g. via the column's inferred union type); never invent a
string value — an unknown member fails the DB enum check at insert/update time.

## Tenant & Actor Extraction

```ts
const session = await auth();
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const authorization = await loadLedgerAuthorization(session.user.idpSubject);
const companyIds = authorization.companyIds;      // from Ledger DB grants
const actorSub = session.user.idpSubject;          // stable Keycloak subject
```

- **Never** read company scope or roles from the request body/query. Authenticate
  with the verified Keycloak OIDC session, then load authorization from
  Ledger's `UserAccount` and `CompanyRoleAssignment` records.
- Every company-scoped query filters the table's `company_id` column against
  the authorized company set. Apply a soft-delete filter (`deleted_at`) ONLY
  on a table that declares one in `schema.ts` — do not assume `is_deleted`
  exists.

## Database Roles and Migration Execution

- Committed release migrations run as `ledger_owner`, which owns schema changes
  and grants.
- The deployed Next.js application connects as `ledger_app`, which has only the
  runtime privileges established by migrations.
- Do not run schema mutation or migration tooling with the application role.

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
