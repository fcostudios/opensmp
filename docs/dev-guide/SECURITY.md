# Security Reference Guide

Full code patterns for authentication, authorization, and tenant security.
See `CLAUDE.md` for the condensed rules. This file is the authoritative example reference.

## How to Secure a New Controller

```java
package com.example.app.sales.api;

import com.example.app.identity.domain.User;
import com.example.app.identity.domain.UserRepository;
import com.example.app.shared.api.JwtUtils;
import com.example.app.shared.domain.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/opportunities")
public class OpportunityController {

    private final OpportunityService service;
    private final TenantContext tenantContext;
    private final UserRepository userRepository;

    public OpportunityController(OpportunityService service,
                                 TenantContext tenantContext,
                                 UserRepository userRepository) {
        this.service = service;
        this.tenantContext = tenantContext;
        this.userRepository = userRepository;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('SELLER', 'MANAGER', 'DIRECTOR')")
    public Page<OpportunityResponse> list(Pageable pageable) {
        UUID tenantId = tenantContext.getCurrentTenantId();
        return service.findByTenant(tenantId, pageable);
    }

    @PostMapping
    @PreAuthorize("hasRole('SELLER')")
    public OpportunityResponse create(
            @RequestBody @Valid OpportunityRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID tenantId = JwtUtils.extractTenantId(jwt);
        // CORRECT: resolve actor via preferred_username → DB keycloak_id lookup (DEC-138)
        String keycloakId = JwtUtils.resolveKeycloakId(jwt);
        User actor = userRepository.findByKeycloakId(keycloakId)
                .filter(u -> tenantId.equals(u.getTenantId()))
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "User not found"));
        return service.create(tenantId, actor.getId(), request);
    }
}
```

**Key patterns:**
- `@PreAuthorize` on EVERY method — never rely on URL-based auth alone
- `TenantContext` injected via constructor (domain interface, not TenantFilter)
- `@AuthenticationPrincipal Jwt jwt` when you need the user's identity
- `JwtUtils.resolveKeycloakId(jwt)` → keycloak_id string (= `preferred_username` claim, DEC-138)
- **NEVER** `jwt.getSubject()` or `UUID.fromString(jwt.getSubject())` — sub is the Keycloak realm UUID, not a DB key
- `jwt.getClaimAsString("email")` → email (display only, not for DB identity lookup)

## Controller Tests with Keycloak JWT {#controller-tests}

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

@WebMvcTest(OpportunityController.class)
class OpportunityControllerTest {

    @Autowired MockMvc mockMvc;
    @MockitoBean OpportunityService service;
    @MockitoBean TenantContext tenantContext;

    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final String KEYCLOAK_USERNAME = "ana.seller";

    private SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor sellerJwt() {
        return jwt().jwt(j -> j
            .subject("keycloak-realm-uuid-not-used-for-db")  // sub = Keycloak UUID, never parse as actor
            .claim("org_id", TENANT_ID.toString())
            .claim("preferred_username", KEYCLOAK_USERNAME)   // = app_users.keycloak_id (DEC-138)
            .claim("realm_access", Map.of("roles", List.of("seller")))
        );
    }

    @Test
    void list_asSeller_returnsOpportunities() throws Exception {
        when(tenantContext.getCurrentTenantId()).thenReturn(TENANT_ID);
        when(service.findByTenant(eq(TENANT_ID), any())).thenReturn(Page.empty());
        mockMvc.perform(get("/api/v1/opportunities").with(sellerJwt()))
            .andExpect(status().isOk());
    }

    @Test
    void create_withoutAuth_returns401() throws Exception {
        mockMvc.perform(post("/api/v1/opportunities")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void list_asWrongRole_returns403() throws Exception {
        mockMvc.perform(get("/api/v1/opportunities")
            .with(jwt().jwt(j -> j
                .subject(UUID.randomUUID().toString())
                .claim("realm_access", Map.of("roles", List.of("finance")))
            )))
            .andExpect(status().isForbidden());
    }
}
```

## How to Access Tenant in Services

```java
package com.example.app.sales.application;

import com.example.app.shared.domain.tenant.TenantContext;

@Service
public class OpportunityService {
    private final OpportunityRepository repository;
    private final TenantContext tenantContext; // Domain interface, NOT TenantFilter

    public Page<Opportunity> findByTenant(UUID tenantId, Pageable pageable) {
        return repository.findByTenantIdAndDeletedFalse(tenantId, pageable);
    }
}
```

**NEVER do this:**
```java
repository.findAll(pageable);  // WRONG — bypasses tenant isolation

import com.example.app.shared.security.TenantFilter;
TenantFilter.getCurrentTenant();  // WRONG — imports infrastructure directly
```
