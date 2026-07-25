# Change Requests — Story Cross-Reference

> **Auto-generated from nous.db.** Shows every CHG and the stories it created.
> Regenerate: `python3 Nous/System/nous_package.py sync -c sprint_plan`

| CHG | Status | Title | Stories | Sprints |
|-----|--------|-------|---------|---------|
| **CHG-001** | 🟡 proposed | Reconcile Sprint 1 execution contract | US-001, US-003, US-004, US-005, US-007, US-011, US-054 | S1, S3 |

---

## Detail

### CHG-001: Reconcile Sprint 1 execution contract

**Status:** 🟡 `proposed`
**Source:** sprint-1-readiness-review
**Requested by:** Francisco Lomas
**Notes:** CHG-001 reconciles Sprint 1 guidance with [DEC-SMP-017](../decisions/DEC-SMP-017-sprint-1-execution-contract.md): `company_id` scoping, Keycloak/Auth.js redirect-based OIDC, and Docker Compose self-hosting.
**Feedback:** Sprint 1 readiness gate for US-001/003/004/005/007/054

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-001** | Scaffold the monorepo and app skeleton | Sprint 1 | ✅ dev_done | [r1_misc_us_001.md](sprint-1/r1_misc_us_001.md) |
| **US-003** | Core schema migration with DB-level register integrity | Sprint 1 | ⬜ backlog | [r1_misc_us_003.md](sprint-1/r1_misc_us_003.md) |
| **US-004** | Platform auth via Keycloak OIDC (mandatory 2FA for admin roles) | Sprint 1 | ⬜ backlog | [r1_misc_us_004.md](sprint-1/r1_misc_us_004.md) |
| **US-005** | Server-side RBAC + company scoping middleware | Sprint 1 | ⬜ backlog | [r1_misc_us_005.md](sprint-1/r1_misc_us_005.md) |
| **US-007** | Seed: companies CSV + go-live register backfill | Sprint 1 | ⬜ backlog | [r1_misc_us_007.md](sprint-1/r1_misc_us_007.md) |
| **US-011** | Users, roles and delegation-ready grants | Sprint 3 | ⬜ backlog | [r1_misc_us_011.md](sprint-3/r1_misc_us_011.md) |
| **US-054** | Anthropic API probe spike | Sprint 1 | ⬜ backlog | [r1_misc_us_054.md](sprint-1/r1_misc_us_054.md) |

