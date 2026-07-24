# Coding Standards Reference

Full code examples for entity conventions, exception handling, and field standards.
See `CLAUDE.md` for condensed rules and tables.

## Factory Method Convention

```java
// Static factory — the ONLY way to create instances
public static MyEntity create(UUID tenantId, /* required fields */) {
    var entity = new MyEntity();
    entity.setId(UUID.randomUUID());
    entity.setTenantId(tenantId);
    // set required fields
    entity.setCreatedAt(Instant.now());
    entity.setUpdatedAt(Instant.now());
    return entity;
}

// Named variants for lifecycle states:
public static MyEntity createDraft(UUID tenantId, ...) { ... }
public static MyEntity createFromImport(UUID tenantId, ...) { ... }
```

## Cross-Story Interface Rule

1. Define the interface in the **domain** package (e.g., `domain/workflow/GuardEvaluatorLookup.java`)
2. Implement it in **infrastructure** (e.g., `infrastructure/workflow/GuardEvaluatorRegistry.java`)
3. Inject the **domain interface** in the application service, never the infrastructure class

Enforced by ArchUnit: `application` layer MUST NOT import from `infrastructure`.

## Tenant Extraction (IMP-075 / IMP-077)

Every Spring controller handling authenticated requests MUST extract tenant ID via
`JwtUtils` from `com.example.app.shared.api`. **Never** a private helper with a
zero-UUID fallback (that's a security hole). `SalesJwtAccess` is package-private
in `sales.api` and must not be used elsewhere.

```java
import com.example.app.shared.api.JwtUtils;

// CORRECT — throws 401 if org_id is missing
UUID tenantId = JwtUtils.extractTenantId(jwt);

// FORBIDDEN — zero-UUID fallback silently allows unauthenticated requests through
private UUID extractTenantId(Jwt jwt) {
    String orgId = jwt.getClaimAsString("org_id");
    return orgId != null ? UUID.fromString(orgId)
        : UUID.fromString("00000000-0000-0000-0000-000000000000"); // SECURITY HOLE
}
```

**Rules:**
1. All controllers call `JwtUtils.extractTenantId(jwt)` directly — no private wrappers.
2. Services accept `tenantId` as an explicit param — never inject `Jwt` into the service layer.
3. For the actor UUID: `JwtUtils.resolveKeycloakId(jwt)` → `UserRepository.findByKeycloakId()` → `user.getId()`. **Never** `JwtUtils.extractSubjectAsUuid(jwt)` (deprecated, returns Keycloak realm UUID, not DB user UUID — DEC-138).
4. Story AC checklist must include: "All endpoints use `JwtUtils.extractTenantId(jwt)` — no private helpers."

## M:N Association Endpoints (IMP-074)

For every Many-to-Many relationship, implement all CRUD endpoints for both sides.
Minimum required set:

| Side | Method | Path | Purpose |
|------|--------|------|---------|
| A→B | GET | `/api/v1/{a-resource}/{id}/{b-resource}` | List B linked to A |
| A→B | POST | `/api/v1/{a-resource}/{id}/{b-resource}` | Link B to A |
| A→B | DELETE | `/api/v1/{a-resource}/{id}/{b-resource}/{b-id}` | Unlink B from A |
| B→A | GET | `/api/v1/{b-resource}/{id}/{a-resource}` | List A linked to B (if navigable) |

- All endpoints appear in the story's API Endpoints section with request/response schemas.
- All registered in `docs/api-contract-registry.json` (mark `NEW` if absent).
- Run `docs/scripts/api-reconcile-check.sh` after implementation to confirm registration.
- Missing endpoints → a `deviation` event in `.nous-feedback.jsonl`.

## Exception Handling Standard (IMP-076)

```java
import com.example.app.shared.domain.ConflictException;
import com.example.app.shared.domain.BusinessRuleException;

// Duplicate entity → 409
throw new ConflictException("user.duplicate_email",
        "User with email " + email + " already exists in this tenant");

// Business rule violated → 422
throw new BusinessRuleException("opportunity.max_contacts",
        "Opportunity already has the maximum of 3 contacts");
```

| Exception | Package | HTTP | Use for |
|-----------|---------|------|---------|
| `ConflictException` | `shared.domain` | 409 | Duplicate entity, constraint violation |
| `BusinessRuleException` | `shared.domain` | 422 | Business rule not met |
| `IllegalArgumentException` | JDK | 400 | Programmer errors only (value-object guards) |

## Phone Field Standard (IMP-078)

```tsx
// CORRECT
<input type="tel" name="phone" placeholder="+593 99 999 9999" />
<FormField type="tel" label="Phone" name="phone" />

// FORBIDDEN
<input type="text" name="phone" />
<FormField label="Phone" name="phone" />  {/* no type */}
```

## Currency & Number Display Standard (IMP-079)

```tsx
// CORRECT — in any React component
import { useCurrency } from "@/hooks/useCurrency";

function MyComponent() {
  const { format } = useCurrency();
  return <span>{format(opportunity.amount)}</span>;   // → "$50,000" or "€50.000" per tenant
}

// CORRECT — inputs
<input type="number" step="0.01" name="expectedAmount" />

// FORBIDDEN
<span>{opportunity.amount}</span>                         // raw number
{new Intl.NumberFormat("PRIMARY_LOCALE", { style: "currency", currency: "USD" }).format(v)}
function formatCurrency(v) { ... }                        // local redefinition
```

**Implementation files:**
- `src/hooks/useCurrency.ts` — hook that reads tenant config + locale store, returns `{ format }`
- `src/providers/TenantProvider.tsx` — fetches `GET /api/v1/tenant/config`, seeds locale store
- `src/lib/format.ts` — re-export barrel for `formatCurrency` (for non-component use only)
- `src/lib/i18n/formatting.ts` — underlying `formatCurrency(amount, currency, locale)` implementation
