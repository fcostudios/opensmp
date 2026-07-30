# Change Requests — Story Cross-Reference

> **Auto-generated from nous.db.** Shows every CHG and the stories it created.
> Regenerate: `python3 Nous/System/nous_package.py sync -c sprint_plan`

| CHG | Status | Title | Stories | Sprints |
|-----|--------|-------|---------|---------|
| **CHG-001** | 🟡 proposed | Reconcile Sprint 1 execution contract | US-001, US-003, US-004, US-005, US-007, US-011, US-054 | S1, S3 |
| **CHG-002** | 🟡 proposed | Reconcile Sprint 2 planning sources | — | — |

---

## Detail

### CHG-001: Reconcile Sprint 1 execution contract

**Status:** 🟡 `proposed`
**Source:** sprint-1-readiness-review
**Requested by:** Francisco Lomas
**Notes:**
> # CHG-001 — Reconcile Sprint 1 execution contract
>
> ## Trigger
>
> Sprint 1 readiness review found generator-owned guidance that contradicts the
> authoritative ER model and architecture.
>
> ## Required changes
>
> - Replace tenant guidance that names `org_id` or `tenant_id` with
>   `company_id`, matching `04_er_model.md` SEC6 and the generated Drizzle
>   schema.
> - Clarify that `VendorAccount` represents a vendor organization; it is not a
>   Ledger application tenant.
> - Replace Auth0 or in-app credential login guidance with Auth.js using
>   Keycloak OIDC authorization-code redirects. Ledger never renders or
>   collects the user's OIDC password or TOTP.
> - Keep identity authentication in Keycloak and authorization in Ledger's
>   `UserAccount` and `CompanyRoleAssignment` records.
> - Make retained, operator-queryable Keycloak security events the US-004
>   evidence for password/TOTP failures. Require realm event retention and an
>   integration/operational verification. Ledger `AuditLog` records successful
>   OIDC/session linking plus callback and authorization failures that Ledger
>   observes. Do not add a Keycloak-event ingestion adapter in Sprint 1.
> - Clarify that US-004 establishes and tests the Keycloak admin-service seam
>   required for admin-group synchronization, while the complete user and role
>   management UI remains US-011.
> - Replace Vercel deployment assumptions with the R1 Docker Compose/VPS target.
> - State that releases apply committed migrations as `ledger_owner`, while the
>   application runtime connects as `ledger_app`.
>
> ## Rationale
>
> `company_id` is already authoritative in the ER model, architecture, and all
> 26 Drizzle tables. Keycloak owns password and TOTP processing, so retaining
> its security events avoids duplicating sensitive telemetry and avoids an
> unrequired Sprint 1 ingestion seam. Docker Compose on a VPS is the accepted R1
> deployment posture.
>
> ## Affected generated artifacts
>
> - `AGENTS.md`
> - `CLAUDE.md` and synchronized agent instruction mirrors
> - `docs/dev-guide/FRONTEND.md`
> - `docs/dev-guide/STANDARDS.md`
> - `docs/dev-guide/SECURITY.md`
> - `docs/dev-guide/DEFINITION_OF_DONE.md`
> - `docs/specs/08_scope.md`
> - `docs/specs/09_architecture.md`
> - `docs/stories/sprint-1/r1_misc_us_004.md`
> - `docs/stories/sprint-3/r1_misc_us_011.md`
> - `docs/stories/SPRINT_PLAN.md`
>
> ## Decision
>
> DEC-SMP-017 records the complete execution contract and supersedes
> contradictory generator defaults.
**Feedback:** Sprint 1 readiness gate for US-001/003/004/005/007/054

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-001** | Scaffold the monorepo and app skeleton | Sprint 1 | ✅ dev_done | [r1_misc_us_001.md](sprint-1/r1_misc_us_001.md) |
| **US-003** | Core schema migration with DB-level register integrity | Sprint 1 | ✅ dev_done | [r1_misc_us_003.md](sprint-1/r1_misc_us_003.md) |
| **US-004** | Platform auth via Keycloak OIDC (mandatory 2FA for admin roles) | Sprint 1 | ✅ dev_done | [r1_misc_us_004.md](sprint-1/r1_misc_us_004.md) |
| **US-005** | Server-side RBAC + company scoping middleware | Sprint 1 | ✅ dev_done | [r1_misc_us_005.md](sprint-1/r1_misc_us_005.md) |
| **US-007** | Seed: companies CSV + go-live register backfill | Sprint 1 | ✅ dev_done | [r1_misc_us_007.md](sprint-1/r1_misc_us_007.md) |
| **US-011** | Users, roles and delegation-ready grants | Sprint 3 | ⬜ backlog | [r1_misc_us_011.md](sprint-3/r1_misc_us_011.md) |
| **US-054** | Anthropic API probe spike | Sprint 1 | 🔨 in_development | [r1_misc_us_054.md](sprint-1/r1_misc_us_054.md) |

### CHG-002: Reconcile Sprint 2 planning sources

**Status:** 🟡 `proposed`
**Source:** internal
**Requested by:** Francisco
**Notes:**
> Reconcile Ledger Sprint 2 planning outputs: hydrate 34 story points and canonical blocked_by edges from Step 10/story artifacts; set current_sprint to the first non-closed sprint after honoring sprint-level deferrals; canonicalize US-042 to 10 alert types; publish the US-014 lifecycle transition table; clarify US-020 attestation-now/verification-later semantics; add the AlertEvent dedupe-key contract; add BR-08/BR-11/BR-14 to the generated effectiveness-critical set; clear expired story claims.

_No stories linked to this change yet._

