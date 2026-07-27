<!-- nous-sprint-stamp
generated_at: 2026-07-27T04:39:45Z
current_sprint: sprint-5
sprints_hash: 22ec244e51f61a79
-->
# SMP — Sprint Execution Plan

> **Auto-generated from nous.db.** Read this before starting any story.
> Regenerate: `nous_trace.py sprint-plan --output docs/stories/SPRINT_PLAN.md`

## Where Code Goes

| Story Target | Code Location |
|---|---|
| **backend** | `apps/web/src/app/api/<route>/route.ts` (serverless API routes) |
| **frontend** | `apps/web/src/components/` or `apps/web/src/app/<route>/` |
| **full-stack** | Both the API route handler + frontend UI (one Next.js app) |

See `docs/specs/09_architecture.md` for bounded context details.

---

## Sprint 1: Sprint 1

**Stories:** 10 | **Points:** 0 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | frontend | **US-001** ✅ | Scaffold the monorepo and app skeleton | ? ?SP | `apps/web/src/components/` | CHG-001 | — | →1 | — | [r1_misc_us_001.md](sprint-1/r1_misc_us_001.md) |
| 2 | full-stack | **US-054** 🔨 | Anthropic API probe spike | ? ?SP | `See story file` | CHG-001 | — | — | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_054.md](sprint-1/r1_misc_us_054.md) |
| 3 | full-stack | **US-002** ✅ | Docker Compose runtime + CI pipeline | ? ?SP | `See story file` | — | US-001 | →4 | — | [r1_misc_us_002.md](sprint-1/r1_misc_us_002.md) |
| 4 | backend | **US-003** ✅ | Core schema migration with DB-level register integrity | ? ?SP | `apps/web/src/app/api/` | CHG-001 | US-002 | →9 | — | [r1_misc_us_003.md](sprint-1/r1_misc_us_003.md) |
| 5 | backend | **US-004** ✅ | Platform auth via Keycloak OIDC (mandatory 2FA for admin roles) | ? ?SP | `apps/web/src/app/api/` | CHG-001 | US-003 | →2 | — | [r1_misc_us_004.md](sprint-1/r1_misc_us_004.md) |
| 6 | backend | **US-005** ✅ | Server-side RBAC + company scoping middleware | ? ?SP | `apps/web/src/app/api/` | CHG-001 | US-004 | →9 | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_005.md](sprint-1/r1_misc_us_005.md) |
| 7 | frontend | **US-006** ✅ | App shell: data-workspace chrome + bilingual i18n | ? ?SP | `apps/web/src/components/` | — | US-004 | — | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_006.md](sprint-1/r1_misc_us_006.md) |
| 8 | full-stack | **US-007** ✅ | Seed: companies CSV + go-live register backfill | ? ?SP | `See story file` | CHG-001 | US-003 | →3 | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_007.md](sprint-1/r1_misc_us_007.md) |
| 9 | full-stack | **US-008** ✅ | Immutable audit trail + viewer | ? ?SP | `See story file` | — | US-005 | — | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_008.md](sprint-1/r1_misc_us_008.md) |
| 10 | full-stack | **US-046** ✅ | Job runner + schedules | ? ?SP | `See story file` | — | US-002 | →6 | — | [r1_misc_us_046.md](sprint-1/r1_misc_us_046.md) |

### Parallel Tracks

**Backend (3 stories):** US-003 → US-004 → US-005
**Frontend (2 stories):** US-001 → US-006
**Full-stack (5 stories):** US-054 → US-002 → US-007 → US-008 → US-046

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 2: Sprint 2

**Stories:** 12 | **Points:** 0 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-010** ⬜ | Person records + edit + auto-create on request | ? ?SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_010.md](sprint-2/r1_misc_us_010.md) |
| 2 | full-stack | **US-014** ⬜ | Lifecycle state machine engine | ? ?SP | `See story file` | — | US-003 | →4 | — | [r1_misc_us_014.md](sprint-2/r1_misc_us_014.md) |
| 3 | full-stack | **US-033** ⬜ | The register surface + export | ? ?SP | `See story file` | — | US-007, US-019 | →1 | — | [r1_misc_us_033.md](sprint-2/r1_misc_us_033.md) |
| 4 | full-stack | **US-042** ⬜ | Alert engine: 8 P0 types | ? ?SP | `See story file` | — | US-003, US-046 | →9 | — | [r1_misc_us_042.md](sprint-2/r1_misc_us_042.md) |
| 5 | full-stack | **US-045** ⬜ | Connector interface + orchestration routing | ? ?SP | `See story file` | — | US-018, US-003 | →2 | — | [r1_misc_us_045.md](sprint-2/r1_misc_us_045.md) |
| 6 | full-stack | **US-013** ⬜ | My requests + request detail record | ? ?SP | `See story file` | — | US-012 | — | — | [r1_misc_us_013.md](sprint-2/r1_misc_us_013.md) |
| 7 | full-stack | **US-015** ⬜ | Approval queue: one-minute decisions | ? ?SP | `See story file` | — | US-014 | →1 | — | [r1_misc_us_015.md](sprint-2/r1_misc_us_015.md) |
| 8 | full-stack | **US-016** ⬜ | Lifecycle notifications (email) | ? ?SP | `See story file` | — | US-003, US-012 | — | — | [r1_misc_us_016.md](sprint-2/r1_misc_us_016.md) |
| 9 | full-stack | **US-022** ⬜ | Per-org pool tracking + low-pool alert | ? ?SP | `See story file` | — | US-019, US-042, US-007 | →2 | — | [r1_misc_us_022.md](sprint-2/r1_misc_us_022.md) |
| 10 | full-stack | **US-012** ⬜ | Request intake with validations | ? ?SP | `See story file` | — | US-007, US-010, US-014 | →2 | — | [r1_misc_us_012.md](sprint-2/r1_misc_us_012.md) |
| 11 | full-stack | **US-017** ⬜ | Approval aging: reminder + escalation job | ? ?SP | `See story file` | — | US-015, US-042, US-046 | — | — | [r1_misc_us_017.md](sprint-2/r1_misc_us_017.md) |
| 12 | full-stack | **US-020** ⬜ | Orchestration mode: checklist + confirm + verification | ? ?SP | `See story file` | — | US-019, US-014, US-045 | →1 | — | [r1_misc_us_020.md](sprint-2/r1_misc_us_020.md) |

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 3: Sprint 3

**Stories:** 14 | **Points:** 0 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-011** ⬜ | Users, roles and delegation-ready grants | ? ?SP | `See story file` | CHG-001 | US-005 | — | — | [r1_misc_us_011.md](sprint-3/r1_misc_us_011.md) |
| 2 | full-stack | **US-018** ⬜ | Anthropic connector client | ? ?SP | `See story file` | — | US-003, US-045 | →4 | — | [r1_misc_us_018.md](sprint-3/r1_misc_us_018.md) |
| 3 | full-stack | **US-023** ⬜ | Blocked-no-seat + purchase-or-reclaim flow | ? ?SP | `See story file` | — | US-022, US-042 | — | — | [r1_misc_us_023.md](sprint-3/r1_misc_us_023.md) |
| 4 | full-stack | **US-025** ⬜ | Vendor accounts + capability descriptor | ? ?SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_025.md](sprint-3/r1_misc_us_025.md) |
| 5 | full-stack | **US-043** ⬜ | Alert log + acknowledgment | ? ?SP | `See story file` | — | US-042 | — | — | [r1_misc_us_043.md](sprint-3/r1_misc_us_043.md) |
| 6 | full-stack | **US-019** ⬜ | Automated provisioning: invite ≤ 15 min → Active | ? ?SP | `See story file` | — | US-014, US-018, US-042 | →5 | — | [r1_misc_us_019.md](sprint-3/r1_misc_us_019.md) |
| 7 | full-stack | **US-021** ⬜ | Invite hygiene | ? ?SP | `See story file` | — | US-019, US-042 | — | — | [r1_misc_us_021.md](sprint-3/r1_misc_us_021.md) |
| 8 | full-stack | **US-024** ⬜ | Offboarding + deprovisioning | ? ?SP | `See story file` | — | US-019, US-020 | →1 | — | [r1_misc_us_024.md](sprint-3/r1_misc_us_024.md) |
| 9 | full-stack | **US-026** ⬜ | Analytics sync: activity + cost | ? ?SP | `See story file` | — | US-018, US-046 | →4 | — | [r1_misc_us_026.md](sprint-3/r1_misc_us_026.md) |
| 10 | full-stack | **US-027** ⬜ | Inactivity flags + usage surface | ? ?SP | `See story file` | — | US-026 | →1 | — | [r1_misc_us_027.md](sprint-3/r1_misc_us_027.md) |
| 11 | frontend | **US-029** ⬜ | Freshness labels + staleness alert | ? ?SP | `apps/web/src/components/` | — | US-026, US-042 | — | — | [r1_misc_us_029.md](sprint-3/r1_misc_us_029.md) |
| 12 | full-stack | **US-030** ⬜ | Drift detection + retroactive claim | ? ?SP | `See story file` | — | US-018, US-042, US-046 | →1 | — | [r1_misc_us_030.md](sprint-3/r1_misc_us_030.md) |
| 13 | full-stack | **US-028** ⬜ | Reclamation proposals: approve or dismiss | ? ?SP | `See story file` | — | US-024, US-027 | — | — | [r1_misc_us_028.md](sprint-3/r1_misc_us_028.md) |
| 14 | full-stack | **US-055** ⬜ | API-less ingestion: member/usage CSV import + manual register upkeep | ? ?SP | `See story file` | — | US-003, US-025, US-026 | — | — | [r1_misc_us_055.md](sprint-3/r1_misc_us_055.md) |

### Parallel Tracks

**Frontend (1 stories):** US-029
**Full-stack (13 stories):** US-011 → US-018 → US-023 → US-025 → US-043 → US-019 → US-021 → US-024 → US-026 → US-027 → US-030 → US-028 → US-055

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 4: Sprint 4

**Stories:** 15 | **Points:** 0 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-009** ⬜ | Company registry CRUD + company record | ? ?SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_009.md](sprint-4/r1_misc_us_009.md) |
| 2 | full-stack | **US-031** ⬜ | Credential management + rotation | ? ?SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_031.md](sprint-4/r1_misc_us_031.md) |
| 3 | full-stack | **US-032** ⬜ | Effective-dated rate cards | ? ?SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_032.md](sprint-4/r1_misc_us_032.md) |
| 4 | full-stack | **US-044** ⬜ | Operational settings | ? ?SP | `See story file` | — | US-005 | — | — | [r1_misc_us_044.md](sprint-4/r1_misc_us_044.md) |
| 5 | full-stack | **US-053** ⬜ | Production environment + first deploy | ? ?SP | `See story file` | — | US-002 | →1 | — | [r1_misc_us_053.md](sprint-4/r1_misc_us_053.md) |
| 6 | full-stack | **US-034** ⬜ | Monthly close job + CloseRun | ? ?SP | `See story file` | — | US-032, US-033 | →4 | — | [r1_misc_us_034.md](sprint-4/r1_misc_us_034.md) |
| 7 | full-stack | **US-035** ⬜ | Statement finalization | ? ?SP | `See story file` | — | US-050 | →1 | — | [r1_misc_us_035.md](sprint-4/r1_misc_us_035.md) |
| 8 | full-stack | **US-036** ⬜ | Statement detail + kind-aware evidence | ? ?SP | `See story file` | — | US-050 | →1 | — | [r1_misc_us_036.md](sprint-4/r1_misc_us_036.md) |
| 9 | full-stack | **US-038** ⬜ | Reconciliation workbench + variance lines | ? ?SP | `See story file` | — | US-035 | →1 | — | [r1_misc_us_038.md](sprint-4/r1_misc_us_038.md) |
| 10 | full-stack | **US-039** ⬜ | Consolidated rollup + export | ? ?SP | `See story file` | — | US-050 | — | — | [r1_misc_us_039.md](sprint-4/r1_misc_us_039.md) |
| 11 | full-stack | **US-048** ⬜ | Ops runbooks + backup/restore drill | ? ?SP | `See story file` | — | US-002, US-031 | — | — | [r1_misc_us_048.md](sprint-4/r1_misc_us_048.md) |
| 12 | full-stack | **US-049** ⬜ | Statement PDF brand template | ? ?SP | `See story file` | — | US-034, US-003 | →1 | — | [r1_misc_us_049.md](sprint-4/r1_misc_us_049.md) |
| 13 | full-stack | **US-050** ⬜ | Close usage lines from CostRecord via the register | ? ?SP | `See story file` | — | US-026, US-034 | →5 | — | [r1_misc_us_050.md](sprint-4/r1_misc_us_050.md) |
| 14 | full-stack | **US-051** ⬜ | Close schedule + workbench readouts | ? ?SP | `See story file` | — | US-046, US-050 | — | — | [r1_misc_us_051.md](sprint-4/r1_misc_us_051.md) |
| 15 | full-stack | **US-037** ⬜ | Statement exports (CSV/PDF, per-company language) | ? ?SP | `See story file` | — | US-036, US-049 | — | — | [r1_misc_us_037.md](sprint-4/r1_misc_us_037.md) |

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 5: Sprint 5

**Stories:** 4 | **Points:** 0 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-040** ⬜ | Cross-company admin dashboard | ? ?SP | `See story file` | — | US-022, US-042 | — | — | [r1_misc_us_040.md](sprint-5/r1_misc_us_040.md) |
| 2 | full-stack | **US-041** ⬜ | Scoped per-company experience | ? ?SP | `See story file` | — | US-005, US-009 | →1 | — | [r1_misc_us_041.md](sprint-5/r1_misc_us_041.md) |
| 3 | full-stack | **US-052** ⬜ | Execute the first parallel close on real data | ? ?SP | `See story file` | — | US-034, US-038, US-050 | — | — | [r1_misc_us_052.md](sprint-5/r1_misc_us_052.md) |
| 4 | full-stack | **US-047** ⬜ | Company-isolation test suite | ? ?SP | `See story file` | — | US-034, US-041 | — | — | [r1_misc_us_047.md](sprint-5/r1_misc_us_047.md) |

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

