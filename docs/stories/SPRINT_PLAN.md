<!-- nous-sprint-stamp
generated_at: 2026-10-12T00:52:13Z
current_sprint: sprint-3
sprints_hash: 34b278be05e0ca45
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

**Stories:** 10 | **Points:** 31 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | frontend | **US-001** ✅ | Scaffold the monorepo and app skeleton | 2SP | `apps/web/src/components/` | CHG-001 | — | →1 | — | [r1_misc_us_001.md](sprint-1/r1_misc_us_001.md) |
| 2 | full-stack | **US-054** 🔨 | Anthropic API probe spike | 1SP | `See story file` | CHG-001 | — | — | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_054.md](sprint-1/r1_misc_us_054.md) |
| 3 | full-stack | **US-002** ✅ | Docker Compose runtime + CI pipeline | 3SP | `See story file` | — | US-001 | →4 | — | [r1_misc_us_002.md](sprint-1/r1_misc_us_002.md) |
| 4 | backend | **US-003** ✅ | Core schema migration with DB-level register integrity | 5SP | `apps/web/src/app/api/` | CHG-001 | US-002 | →10 | — | [r1_misc_us_003.md](sprint-1/r1_misc_us_003.md) |
| 5 | backend | **US-004** ✅ | Platform auth via Keycloak OIDC (mandatory 2FA for admin roles) | 3SP | `apps/web/src/app/api/` | CHG-001 | US-003 | →2 | — | [r1_misc_us_004.md](sprint-1/r1_misc_us_004.md) |
| 6 | backend | **US-005** ✅ | Server-side RBAC + company scoping middleware | 3SP | `apps/web/src/app/api/` | CHG-001 | US-004 | →9 | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_005.md](sprint-1/r1_misc_us_005.md) |
| 7 | frontend | **US-006** ✅ | App shell: data-workspace chrome + bilingual i18n | 5SP | `apps/web/src/components/` | — | US-004 | — | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_006.md](sprint-1/r1_misc_us_006.md) |
| 8 | full-stack | **US-007** ✅ | Seed: companies CSV + go-live register backfill | 3SP | `See story file` | CHG-001 | US-003 | →3 | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_007.md](sprint-1/r1_misc_us_007.md) |
| 9 | full-stack | **US-008** ✅ | Immutable audit trail + viewer | 3SP | `See story file` | — | US-005 | — | 33b725b7-eb1 (push, exp 2026-08-02) | [r1_misc_us_008.md](sprint-1/r1_misc_us_008.md) |
| 10 | full-stack | **US-046** ✅ | Job runner + schedules | 3SP | `See story file` | — | US-002 | →15 | — | [r1_misc_us_046.md](sprint-1/r1_misc_us_046.md) |

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

**Stories:** 12 | **Points:** 34 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-010** ✅ | Person records + edit + auto-create on request | 3SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_010.md](sprint-2/r1_misc_us_010.md) |
| 2 | full-stack | **US-014** ✅ | Lifecycle state machine engine | 3SP | `See story file` | — | US-003 | →8 | — | [r1_misc_us_014.md](sprint-2/r1_misc_us_014.md) |
| 3 | full-stack | **US-033** ✅ | The register surface + export | 3SP | `See story file` | — | US-007 | →1 | — | [r1_misc_us_033.md](sprint-2/r1_misc_us_033.md) |
| 4 | full-stack | **US-042** ✅ | Alert engine: 10 P0 types | 3SP | `See story file` | — | US-003, US-046 | →19 | — | [r1_misc_us_042.md](sprint-2/r1_misc_us_042.md) |
| 5 | full-stack | **US-045** ✅ | Connector interface + orchestration routing | 3SP | `See story file` | — | US-003 | →3 | — | [r1_misc_us_045.md](sprint-2/r1_misc_us_045.md) |
| 6 | full-stack | **US-013** ✅ | My requests + request detail record | 3SP | `See story file` | — | US-012 | — | — | [r1_misc_us_013.md](sprint-2/r1_misc_us_013.md) |
| 7 | full-stack | **US-015** ✅ | Approval queue: one-minute decisions | 3SP | `See story file` | — | US-014 | →1 | — | [r1_misc_us_015.md](sprint-2/r1_misc_us_015.md) |
| 8 | full-stack | **US-016** ✅ | Lifecycle notifications (email) | 2SP | `See story file` | — | US-003, US-012 | — | — | [r1_misc_us_016.md](sprint-2/r1_misc_us_016.md) |
| 9 | full-stack | **US-022** ✅ | Per-org pool tracking + low-pool alert | 3SP | `See story file` | — | US-007, US-042 | →2 | — | [r1_misc_us_022.md](sprint-2/r1_misc_us_022.md) |
| 10 | full-stack | **US-012** ✅ | Request intake with validations | 3SP | `See story file` | — | US-007, US-010, US-014 | →2 | — | [r1_misc_us_012.md](sprint-2/r1_misc_us_012.md) |
| 11 | full-stack | **US-017** ✅ | Approval aging: reminder + escalation job | 2SP | `See story file` | — | US-015, US-042, US-046 | — | — | [r1_misc_us_017.md](sprint-2/r1_misc_us_017.md) |
| 12 | full-stack | **US-020** ✅ | Orchestration mode: checklist + confirm + verification | 3SP | `See story file` | — | US-014, US-045 | →9 | — | [r1_misc_us_020.md](sprint-2/r1_misc_us_020.md) |

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 3: Sprint 3

**Stories:** 42 | **Points:** 70 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-011** ✅ | Users, roles and delegation-ready grants | 3SP | `See story file` | CHG-001 | US-005 | — | — | [r1_misc_us_011.md](sprint-3/r1_misc_us_011.md) |
| 2 | full-stack | **US-023** ✅ | Blocked-no-seat + purchase-or-reclaim flow | 3SP | `See story file` | — | US-022, US-042 | →1 | — | [r1_misc_us_023.md](sprint-3/r1_misc_us_023.md) |
| 3 | full-stack | **US-025** ✅ | Vendor accounts + capability descriptor | 3SP | `See story file` | — | US-005 | →3 | — | [r1_misc_us_025.md](sprint-3/r1_misc_us_025.md) |
| 4 | full-stack | **US-043** ✅ | Alert log + acknowledgment | 2SP | `See story file` | — | US-042 | — | — | [r1_misc_us_043.md](sprint-3/r1_misc_us_043.md) |
| 5 | frontend | **US-029** ⬜ | Freshness labels + staleness alert | 2SP | `apps/web/src/components/` | — | US-026, US-042 | — | — | [r1_misc_us_029.md](sprint-3/r1_misc_us_029.md) |
| 6 | full-stack | **US-056** ✅ | Anthropic transport with separated credentials and bounded retry | 1SP | `See story file` | CHG-045 | US-003, US-025, US-045 | →14 | — | [r1_misc_us_056.md](sprint-3/r1_misc_us_056.md) |
| 7 | full-stack | **US-057** ✅ | Append-only sanitized connector-call journal | 2SP | `See story file` | CHG-045 | US-056 | →13 | — | [r1_misc_us_057.md](sprint-3/r1_misc_us_057.md) |
| 8 | full-stack | **US-065** ✅ | Recover failed automated provisioning with an operator retry | 1SP | `See story file` | CHG-054 | US-014, US-042, US-063 | →1 | — | [r1_misc_us_065.md](sprint-3/r1_misc_us_065.md) |
| 9 | full-stack | **US-066** ✅ | Activate accepted invitations from the 15-minute membership poll | 1SP | `See story file` | CHG-054 | US-014, US-046, US-063 | →1 | — | [r1_misc_us_066.md](sprint-3/r1_misc_us_066.md) |
| 10 | full-stack | **US-067** ✅ | Surface overdue invitations with configurable alerts | 1SP | `See story file` | CHG-063 | US-019, US-042 | →2 | — | [r1_misc_us_067.md](sprint-3/r1_misc_us_067.md) |
| 11 | full-stack | **US-072** ✅ | Usage surface: lag-aware inactivity per person on SCR-usage | 1SP | `See story file` | CHG-071 | US-026 | →3 | — | [r1_misc_us_072.md](sprint-3/r1_misc_us_072.md) |
| 12 | full-stack | **US-081** 🔨 | Refresh free capacity only after an accepted member observation | 1SP | `See story file` | CHG-076 | US-019, US-020 | →2 | — | [r1_misc_us_081.md](sprint-3/r1_misc_us_081.md) |
| 13 | full-stack | **US-086** ⬜ | Start anchored seat removal from both detail screens | 1SP | `See story file` | CHG-083 | US-019, US-020 | →5 | — | [r1_misc_us_086.md](sprint-3/r1_misc_us_086.md) |
| 14 | full-stack | **US-028** ⬜ | Reclamation proposals: approve or dismiss | 3SP | `See story file` | — | US-024, US-027 | — | — | [r1_misc_us_028.md](sprint-3/r1_misc_us_028.md) |
| 15 | full-stack | **US-058** ✅ | Anthropic connector conformance and Pact contracts | 1SP | `See story file` | CHG-045 | US-056, US-057 | →12 | — | [r1_misc_us_058.md](sprint-3/r1_misc_us_058.md) |
| 16 | full-stack | **US-064** ✅ | Route provider no-seat responses to the capacity workflow | 1SP | `See story file` | CHG-054 | US-014, US-023, US-063 | →1 | — | [r1_misc_us_064.md](sprint-3/r1_misc_us_064.md) |
| 17 | full-stack | **US-068** ✅ | Withdraw a pending invitation safely from exceptions | 1SP | `See story file` | CHG-063 | US-019, US-042, US-067 | →2 | — | [r1_misc_us_068.md](sprint-3/r1_misc_us_068.md) |
| 18 | full-stack | **US-069** ✅ | Expire stale invitations automatically and notify the requester | 1SP | `See story file` | CHG-063 | US-019, US-042, US-068 | →1 | — | [r1_misc_us_069.md](sprint-3/r1_misc_us_069.md) |
| 19 | full-stack | **US-073** ✅ | Batch reclamation proposals from SCR-usage | 1SP | `See story file` | CHG-071 | US-026, US-072 | →1 | — | [r1_misc_us_073.md](sprint-3/r1_misc_us_073.md) |
| 20 | full-stack | **US-074** ✅ | Daily inactivity flagging of anchor license requests | 1SP | `See story file` | CHG-071 | US-026, US-072 | →1 | — | [r1_misc_us_074.md](sprint-3/r1_misc_us_074.md) |
| 21 | full-stack | **US-076** ⬜ | Confirm person departure through the offboarding flow | 1SP | `See story file` | CHG-074 | US-019, US-020, US-086 | →1 | — | [r1_misc_us_076.md](sprint-3/r1_misc_us_076.md) |
| 22 | full-stack | **US-082** ⬜ | Execute connector seat removal in the production worker | 1SP | `See story file` | CHG-076 | US-019, US-020, US-087 | →2 | — | [r1_misc_us_082.md](sprint-3/r1_misc_us_082.md) |
| 23 | full-stack | **US-085** ⬜ | Show pending-refresh capacity on the pools and dashboard overview | 1SP | `See story file` | CHG-078 | US-019, US-020, US-081 | →1 | — | [r1_misc_us_085.md](sprint-3/r1_misc_us_085.md) |
| 24 | full-stack | **US-087** ⬜ | Complete checklist seat removal and close the register atomically | 1SP | `See story file` | CHG-083 | US-019, US-020, US-086 | →3 | — | [r1_misc_us_087.md](sprint-3/r1_misc_us_087.md) |
| 25 | full-stack | **US-055** ⬜ | API-less ingestion: member/usage CSV import + manual register upkeep | 3SP | `See story file` | — | US-003, US-025, US-026, US-030 | — | — | [r1_misc_us_055.md](sprint-3/r1_misc_us_055.md) |
| 26 | full-stack | **US-063** ✅ | Deliver approved requests as vendor invitations within 15 minutes | 1SP | `See story file` | CHG-054 | US-014, US-042, US-046, US-056, US-057, US-058 | →4 | — | [r1_misc_us_063.md](sprint-3/r1_misc_us_063.md) |
| 27 | full-stack | **US-070** ✅ | Ingest accurate daily person activity from API-enabled accounts | 1SP | `See story file` | CHG-068 | US-046, US-056, US-057, US-058 | →2 | — | [r1_misc_us_070.md](sprint-3/r1_misc_us_070.md) |
| 28 | full-stack | **US-075** 🔨 | Start anchored seat removal from both detail screens and finalize the register atomically | 1SP | `See story file` | CHG-074 | US-019, US-020, US-086, US-087 | →1 | — | [r1_misc_us_075.md](sprint-3/r1_misc_us_075.md) |
| 29 | full-stack | **US-077** ⬜ | Raise same-business-day departure deprovisioning alerts | 1SP | `See story file` | CHG-074 | US-019, US-020, US-082, US-086 | →1 | — | [r1_misc_us_077.md](sprint-3/r1_misc_us_077.md) |
| 30 | full-stack | **US-083** ⬜ | Accept complete member observations with authoritative identity and license evidence | 1SP | `See story file` | CHG-077 | US-042, US-046, US-056, US-057, US-058 | →3 | — | [r1_misc_us_083.md](sprint-3/r1_misc_us_083.md) |
| 31 | full-stack | **US-018** ✅ | Anthropic connector client | 4SP | `See story file` | — | US-003, US-025, US-045, US-056, US-057, US-058 | — | — | [r1_misc_us_018.md](sprint-3/r1_misc_us_018.md) |
| 32 | full-stack | **US-021** ✅ | Invite hygiene | 2SP | `See story file` | — | US-019, US-042, US-067, US-068, US-069 | — | — | [r1_misc_us_021.md](sprint-3/r1_misc_us_021.md) |
| 33 | full-stack | **US-027** ✅ | Inactivity flags + usage surface | 2SP | `See story file` | — | US-026, US-072, US-073, US-074 | →1 | — | [r1_misc_us_027.md](sprint-3/r1_misc_us_027.md) |
| 34 | full-stack | **US-071** ✅ | Synchronize exact person costs within the 30-day revision window | 1SP | `See story file` | CHG-068 | US-046, US-056, US-057, US-058, US-070 | →1 | — | [r1_misc_us_071.md](sprint-3/r1_misc_us_071.md) |
| 35 | full-stack | **US-078** ⬜ | Open, resolve and list drift episodes from accepted member observations | 1SP | `See story file` | CHG-075 | US-042, US-046, US-056, US-057, US-058, US-083 | →2 | — | [r1_misc_us_078.md](sprint-3/r1_misc_us_078.md) |
| 36 | full-stack | **US-079** ⬜ | Claim a drift member retroactively with audit | 1SP | `See story file` | CHG-075 | US-042, US-046, US-056, US-057, US-058, US-078 | →2 | — | [r1_misc_us_079.md](sprint-3/r1_misc_us_079.md) |
| 37 | full-stack | **US-080** ⬜ | Show the drift-to-zero metric on the dashboard | 1SP | `See story file` | CHG-075 | US-042, US-046, US-056, US-057, US-058, US-079 | →1 | — | [r1_misc_us_080.md](sprint-3/r1_misc_us_080.md) |
| 38 | full-stack | **US-084** ⬜ | Run the hourly API member observation and verify confirmed provisions | 1SP | `See story file` | CHG-077 | US-042, US-046, US-056, US-057, US-058, US-083 | →1 | — | [r1_misc_us_084.md](sprint-3/r1_misc_us_084.md) |
| 39 | full-stack | **US-026** ✅ | Analytics sync: activity + cost | 3SP | `See story file` | — | US-046, US-056, US-057, US-058, US-070, US-071 | →7 | — | [r1_misc_us_026.md](sprint-3/r1_misc_us_026.md) |
| 40 | full-stack | **US-019** ✅ | Automated provisioning: invite ≤ 15 min → Active | 5SP | `See story file` | — | US-014, US-042, US-046, US-056, US-057, US-058, US-063, US-064, US-065, US-066 | →13 | — | [r1_misc_us_019.md](sprint-3/r1_misc_us_019.md) |
| 41 | full-stack | **US-030** ⬜ | Drift detection + retroactive claim | 3SP | `See story file` | — | US-042, US-046, US-056, US-057, US-058, US-078, US-079, US-080, US-083, US-084 | →1 | — | [r1_misc_us_030.md](sprint-3/r1_misc_us_030.md) |
| 42 | full-stack | **US-024** ⬜ | Offboarding + deprovisioning | 3SP | `See story file` | — | US-019, US-020, US-075, US-076, US-077, US-081, US-082, US-085, US-086, US-087 | →1 | — | [r1_misc_us_024.md](sprint-3/r1_misc_us_024.md) |

### Parallel Tracks

**Frontend (1 stories):** US-029
**Full-stack (41 stories):** US-011 → US-023 → US-025 → US-043 → US-056 → US-057 → US-065 → US-066 → US-067 → US-072 → US-081 → US-086 → US-028 → US-058 → US-064 → US-068 → US-069 → US-073 → US-074 → US-076 → US-082 → US-085 → US-087 → US-055 → US-063 → US-070 → US-075 → US-077 → US-083 → US-018 → US-021 → US-027 → US-071 → US-078 → US-079 → US-080 → US-084 → US-026 → US-019 → US-030 → US-024

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 4: Sprint 4

**Stories:** 15 | **Points:** 39 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-009** ⬜ | Company registry CRUD + company record | 3SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_009.md](sprint-4/r1_misc_us_009.md) |
| 2 | full-stack | **US-031** ⬜ | Credential management + rotation | 3SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_031.md](sprint-4/r1_misc_us_031.md) |
| 3 | full-stack | **US-032** ⬜ | Effective-dated rate cards | 2SP | `See story file` | — | US-005 | →1 | — | [r1_misc_us_032.md](sprint-4/r1_misc_us_032.md) |
| 4 | full-stack | **US-044** ⬜ | Operational settings | 2SP | `See story file` | — | US-005 | — | — | [r1_misc_us_044.md](sprint-4/r1_misc_us_044.md) |
| 5 | full-stack | **US-049** ⬜ | Statement PDF brand template | 3SP | `See story file` | — | US-003 | →1 | — | [r1_misc_us_049.md](sprint-4/r1_misc_us_049.md) |
| 6 | full-stack | **US-053** ⬜ | Production environment + first deploy | 3SP | `See story file` | — | US-002 | →1 | — | [r1_misc_us_053.md](sprint-4/r1_misc_us_053.md) |
| 7 | full-stack | **US-034** ⬜ | Monthly close job + CloseRun | 5SP | `See story file` | — | US-032, US-033 | →3 | — | [r1_misc_us_034.md](sprint-4/r1_misc_us_034.md) |
| 8 | full-stack | **US-035** ⬜ | Statement finalization | 2SP | `See story file` | — | US-050 | →1 | — | [r1_misc_us_035.md](sprint-4/r1_misc_us_035.md) |
| 9 | full-stack | **US-036** ⬜ | Statement detail + kind-aware evidence | 3SP | `See story file` | — | US-050 | →1 | — | [r1_misc_us_036.md](sprint-4/r1_misc_us_036.md) |
| 10 | full-stack | **US-038** ⬜ | Reconciliation workbench + variance lines | 3SP | `See story file` | — | US-035 | →1 | — | [r1_misc_us_038.md](sprint-4/r1_misc_us_038.md) |
| 11 | full-stack | **US-039** ⬜ | Consolidated rollup + export | 2SP | `See story file` | — | US-050 | — | — | [r1_misc_us_039.md](sprint-4/r1_misc_us_039.md) |
| 12 | full-stack | **US-048** ⬜ | Ops runbooks + backup/restore drill | 2SP | `See story file` | — | US-002, US-031 | — | — | [r1_misc_us_048.md](sprint-4/r1_misc_us_048.md) |
| 13 | full-stack | **US-050** ⬜ | Close usage lines from CostRecord via the register | 2SP | `See story file` | — | US-026, US-034 | →5 | — | [r1_misc_us_050.md](sprint-4/r1_misc_us_050.md) |
| 14 | full-stack | **US-051** ⬜ | Close schedule + workbench readouts | 2SP | `See story file` | — | US-046, US-050 | — | — | [r1_misc_us_051.md](sprint-4/r1_misc_us_051.md) |
| 15 | full-stack | **US-037** ⬜ | Statement exports (CSV/PDF, per-company language) | 2SP | `See story file` | — | US-036, US-049 | — | — | [r1_misc_us_037.md](sprint-4/r1_misc_us_037.md) |

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

---

## Sprint 5: Sprint 5

**Stories:** 4 | **Points:** 11 SP

### Execution Order

| # | Track | Story | Name | Size | Where to Code | CHG | Blocked By | Blocks | Assignee | File |
|---|-------|-------|------|------|---------------|-----|------------|--------|----------|------|
| 1 | full-stack | **US-040** ⬜ | Cross-company admin dashboard | 3SP | `See story file` | — | US-022, US-042 | — | — | [r1_misc_us_040.md](sprint-5/r1_misc_us_040.md) |
| 2 | full-stack | **US-041** ⬜ | Scoped per-company experience | 2SP | `See story file` | — | US-005, US-009 | →1 | — | [r1_misc_us_041.md](sprint-5/r1_misc_us_041.md) |
| 3 | full-stack | **US-052** ⬜ | Execute the first parallel close on real data | 3SP | `See story file` | — | US-034, US-038, US-050, US-053 | — | — | [r1_misc_us_052.md](sprint-5/r1_misc_us_052.md) |
| 4 | full-stack | **US-047** ⬜ | Company-isolation test suite | 3SP | `See story file` | — | US-034, US-041 | — | — | [r1_misc_us_047.md](sprint-5/r1_misc_us_047.md) |

### References

- Architecture: [docs/specs/09_architecture.md](../specs/09_architecture.md)
- Design system: [packages/design-system/tokens.json](../../packages/design-system/tokens.json)
- Screen specs (TOON): [docs/screens/](../screens/)

