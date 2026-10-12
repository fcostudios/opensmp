# Change Requests — Story Cross-Reference

> **Auto-generated from nous.db.** Shows every CHG and the stories it created.
> Regenerate: `python3 Nous/System/nous_package.py sync -c sprint_plan`

| CHG | Status | Title | Stories | Sprints |
|-----|--------|-------|---------|---------|
| **CHG-001** | 🟡 proposed | Reconcile Sprint 1 execution contract | US-001, US-003, US-004, US-005, US-007, US-011, US-054 | S1, S3 |
| **CHG-002** | 🟡 proposed | Reconcile Sprint 2 planning sources | — | — |
| **CHG-003** | 🟡 proposed | A Central Finance register row exposes its request approval source trace in the authorized register drilldown without requiring a role-forbidden request-detail link; statement links remain independent | — | — |
| **CHG-004** | 🟡 proposed | Reconcile reviewed generated guidance markers within the pinned CHG-001 section so later generated CHG entries cannot invalidate unchanged reviewed guidance; add regression coverage for multiple chang | — | — |
| **CHG-005** | 🟡 proposed | Pin regenerated US-014 lifecycle guidance to the canonical plan graph, including blocked_no_seat to rejected and offboarding to failed, and pin US-045 acceptance wording to the Sprint 2 none-connector | — | — |
| **CHG-006** | 🟡 proposed | Make the generated API reconciler's no-argument invocation target the repository root, discover method-exported Next.js App Router route handlers, compare method plus normalized path against a non-sca | — | — |
| **CHG-007** | 🟡 proposed | Harden API reconciliation against lexical spoofing and evasive TypeScript call syntax, constrain CHG-004/005 manifests to canonical reviewed paths and SHA-256 values before artifact access, and add ap | — | — |
| **CHG-008** | 🟡 proposed | Replace the hand-written TypeScript lexer in API reconciliation with an installed TypeScript compiler-API helper that parses route exports and frontend boundary calls with lexical scope and conservati | — | — |
| **CHG-009** | 🟡 proposed | Extend compiler-AST API reconciliation to resolve native fetch through destructuring aliases, bind aliases, and call/apply wrappers while proving global object identity through TypeScript symbols and  | — | — |
| **CHG-010** | 🟡 proposed | Revalidate only the Task 17-affected evidence for US-012 AC4, US-015 AC1, US-020 AC2, and the build/done projections for US-012, US-015, US-020, and US-022 against source commit 8594311e2d4c38b5d8d7d7 | — | — |
| **CHG-011** | 🟡 proposed | Sprint 2 remains terminally closed_with_deferrals and Sprint 3 may start after CI, contract, dependency, and projection gates pass. US-054 remains externally blocked and is a live-provider terminal/go | — | — |
| **CHG-012** | 🟡 proposed | Migrate nav map sidebar.sections to the canonical object form (id + label_en + label_es) | — | — |
| **CHG-013** | 🟡 proposed | Carry the dev team's Sprint 2 spec refinements back into Nous (10 alert types, dedupe_key, US-014 transition table, US-017 SMTP semantics, US-045 connector scope) | — | — |
| **CHG-014** | 📦 delivered | Cache local mutation evidence safely | — | — |
| **CHG-022** | 📦 delivered | Work readiness gate: block oversized or mixed-scope US/CHG before implementation | — | — |
| **CHG-023** | 🟡 proposed | Agent guidance mirrors, merge-HEAD gate, and Stryker exclusions (partition parent) | — | — |
| **CHG-024** | 📦 delivered | Agent guidance mirrors track the layered CLAUDE.md | — | — |
| **CHG-025** | 📦 delivered | Staged readiness validates a merge HEAD against its first parent | — | — |
| **CHG-026** | 📦 delivered | Commit the measured Stryker sandbox exclusions | — | — |
| **CHG-027** | 🟡 proposed | Provision the work-readiness approval public key into CI | — | — |
| **CHG-028** | 🟡 proposed | Define the approval-key cutoff and revocation policy | — | — |
| **CHG-029** | 📦 delivered | Feedback lifecycle checker must not require started before a decision | — | — |
| **CHG-030** | 🟡 proposed | Separate missing base config from unreadable in mutation-scope failure message | — | — |
| **CHG-031** | 📦 delivered | Commit hook resolves the approval trust map from the repo when the env var is unset | — | — |
| **CHG-032** | 🟡 proposed | Readiness CLI resolves approval trust from the repo outside CI | — | — |
| **CHG-033** | 🟡 proposed | Force a partition after repeated ready re-approvals of one work item | — | — |
| **CHG-034** | 📦 delivered | Work-readiness gate simplification: retire Ed25519 signing, wall-clock checkpoints, dual ledger, and git-code sprawl | — | — |
| **CHG-035** | 📦 delivered | Re-baseline the work-readiness execution budget from 120 to 320 minutes, calibrated by IMP-374 | — | — |
| **CHG-036** | 📦 delivered | Retire Ed25519 approval signing, keeping signed history readable | — | — |
| **CHG-037** | 📦 delivered | Replace the wall-clock lock with a task-boundary self-report and collapse to one ledger | — | — |
| **CHG-038** | 📦 delivered | Collapse the fine-grained git-plumbing codes into one message-carrying error | — | — |
| **CHG-039** | 📦 delivered | Make the WR_* code set countable: one spelling at every call site | — | — |
| **CHG-040** | 📦 delivered | Restore operational deadline rules to the effectiveness-critical set | — | — |
| **CHG-041** | 🟢 accepted | Allow honest legacy closure actuals for pre-CHG-037 work | — | — |
| **CHG-042** | 📦 delivered | Re-pin regenerated guidance and propagate the 320-minute budget | — | — |
| **CHG-043** | 📦 delivered | Fix the root test runner: two workspaces declare vitest without a config, and the delivered mock lint fails on alerts/actions.test.ts | — | — |
| **CHG-044** | 📦 delivered | Re-pin testing/critical-paths.md after CHG-040 regenerates the critical set | — | — |
| **CHG-045** | ✅ dev_done | Add a durable connector call observation ledger for US-018 | US-056, US-057, US-058 | S3 |
| **CHG-046** | 📦 delivered | Accept substrate-emitted generated Nous paths by provenance instead of a per-sync overlay-layer registration | — | — |
| **CHG-047** | 📦 delivered | Authoritative cold campaign is diff-scoped and runs once, last; actuals record campaign minutes; estimate re-weights review | — | — |
| **CHG-048** | 🟢 accepted | Guard readiness calibration output size and audit CHG-047 actuals | — | — |
| **CHG-049** | 📦 delivered | Register the 2026-09-06 substrate delivery as an overlay layer and carry the 17 synced paths | — | — |
| **CHG-050** | 📦 delivered | Carry the exact 2026-09-06 Nous delivery as technical provenance | — | — |
| **CHG-051** | 📦 delivered | Register the eight-file CHG-049 immutable overlay | — | — |
| **CHG-052** | 📦 delivered | Reconcile the US-018 partition: retire tenant-local US-059..062 as superseded; close US-018 by parent-level verification | — | — |
| **CHG-053** | 📦 delivered | Register the 2026-09-07 IMP-393/398 guidance refresh and two-file immutable overlay | — | — |
| **CHG-054** | 📦 delivered | Partition US-019 (520 min > 320) into four canonical children US-063..066; parent closes by verification | US-063, US-064, US-065, US-066 | S3 |
| **CHG-055** | 📦 delivered | Register the 2026-09-07 PM authorization-guidance refresh and three-file immutable overlay | — | — |
| **CHG-056** | 🔵 analyzed | Run every diff-scoped mutation shard before reporting the campaign result | — | — |
| **CHG-057** | 🟢 accepted | Mutation campaign: run every shard, lint the preflights before the campaign, one evidence commit per story | — | — |
| **CHG-058** | 📦 delivered | Next child faster: preview campaign per task, honest sizing, plan-only for partition children, fix the sandbox selector | — | — |
| **CHG-059** | 📦 delivered | Append-only completion actuals correction | — | — |
| **CHG-060** | 🔵 analyzed | Scope discipline and parallel siblings: AC-bound tasks, hardening declared or deferred, two sessions on parallel-safe children | — | — |
| **CHG-061** | 📦 delivered | Adopt IMP-410: commit-msg accepts a pure Nous sync via scripts/nous-sync-owns.mjs | — | — |
| **CHG-062** | 📦 delivered | Readiness gate accepts the delivered feedback vocabulary: phase markers and done.cost | — | — |
| **CHG-063** | 📦 delivered | Partition US-021 (730 min > 320) into three canonical children US-067..069; invite-expiry config contract | US-067, US-068, US-069 | S3 |
| **CHG-064** | 📦 delivered | Fix the three unchanged-test flakes that fail the full gate: pg-pool teardown 57P01 race, report-job-failure concurrent-creator oracle, dispatch consecutive type-check deadline | — | — |
| **CHG-065** | 📦 delivered | Verification cost: re-preview only touched shards, one-line survivor annotations, one controller session per story without 1 s polling, emit done.cost | — | — |
| **CHG-066** | 📦 delivered | Full-gate residue after CHG-064: container-load resets, unpinned health-route container, Ryuk disabled, WITH (FORCE) as non-superuser, readiness check's closed decision shape | — | — |
| **CHG-067** | 📦 delivered | Full-gate container-start burst and expiry lock-wait oracle | — | — |
| **CHG-068** | 📦 delivered | Partition US-026 (510 min > 320) into canonical children US-070, US-071; DEC-SMP-024 allowlisted replay payload; DEC-SMP-025 manual ingestion default | US-070, US-071 | S3 |
| **CHG-069** | 📦 delivered | Preview budget: one round per task plus one final, 30 min per child, slow shards once, schema-shard routing fixed, host kept awake during gates | — | — |
| **CHG-070** | 📦 delivered | Session fan-out experiment: one consolidated implementer session per child, measured against US-070/071 before any rule changes | — | — |
| **CHG-071** | ✅ dev_done | Partition US-027 (750 min > 320) into canonical children US-072, US-073, US-074; DEC-SMP-026 lag-aware data_through; DEC-SMP-027 batch idempotency; DEC-SMP-028 flag ownership | US-072, US-073, US-074 | S3 |
| **CHG-072** | 🟡 cancelled | Feedback-order checker exempts annotation-class events from the started ordering (reads the class from the emitted vocabulary) | — | — |
| **CHG-073** | 📦 delivered | Readiness validator: annotation-class events are not pre-approval violations; append-only correction path for a mistakenly recorded historical lifecycle start (unblocks CHG-070) | — | — |
| **CHG-074** | 🔨 dev_in_progress | Partition US-024 (780 min > 320) into canonical children US-075, US-076, US-077; DEC-SMP-029..033 (BR-14 calendar, reasons, capacity refresh, departure confirmation, register closure) | US-075, US-076, US-077 | S3 |
| **CHG-075** | 📦 delivered | Partition US-030 (drift detection + retroactive claim) into US-078/US-079/US-080; DriftEpisode entity; DEC-SMP-034..039 | US-078, US-079, US-080 | S3 |
| **CHG-076** | 🔨 dev_in_progress | Amend CHG-074: repartition US-075 into US-075/US-081/US-082; reallocated = transfer (BR-02); capacity-refresh contract; DEC-SMP-040..042 | US-081, US-082 | S3 |
| **CHG-077** | 📦 delivered | Amend CHG-075: repartition US-078 into US-083/US-084/US-078; member observation contract + MemberObservation ledger; DEC-SMP-043..046 | US-083, US-084 | S3 |
| **CHG-078** | 📦 delivered | Refine CHG-076: US-081 split by screen limit — US-081 (vendor-account foundation) + US-085 (pools/dashboard overview) | US-085 | S3 |
| **CHG-079** | 🟢 accepted | Technical prerequisite for US-075: register people-action-service → repository.integration.test route; canonical critical-set registration (BR-14 governed-by US-075/077/082) | — | — |
| **CHG-080** | 🟢 accepted | Technical prerequisite for US-081: publish the capacity-refresh critical path (config v44) and reconcile critical-paths.md + TESTING.md §3; sequenced after CHG-079's pin | — | — |
| **CHG-081** | 🟢 accepted | Technical successor to CHG-079: route packages/domain request-workflow lifecycle.ts → orchestration.integration.test.ts for US-075 | — | — |
| **CHG-082** | 📦 delivered | smp readiness-gate policy: bookkeeping excluded from the 20-file limit; functional items may add responsible test routes (data-file superset only) | — | — |
| **CHG-083** | 📦 delivered | Partition US-075 into US-086 (anchored removal start) and US-087 (checklist removal completion); dependencies rewired | US-086, US-087 | S3 |
| **CHG-084** | 🟢 accepted | Technical follow-up to CHG-082: historical readiness assessments are never reclassified by rebase; bookkeeping_files optional (absent = legacy counting) | — | — |
| **CHG-085** | 🟢 accepted | Technical: reconciler pin for the guidance regenerated by CHG-083 (BR-14 governed-by += US-086, US-087) | — | — |

---

## Detail

### CHG-001: Reconcile Sprint 1 execution contract

**Status:** 🟡 `proposed`
**Source:** sprint-1-readiness-review
**Requested by:** Francisco Lomas
**Notes:** # CHG-001 — Reconcile Sprint 1 execution contract

## Trigger

Sprint 1 readiness review found generator-owned guidance that contradicts the
authoritative ER model and architecture.

## Required changes

- Replace tenant guidance that names `org_id` or `tenant_id` with
  `company_id`, matching `0...
**Feedback:** Sprint 1 readiness gate for US-001/003/004/005/007/054

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-001** | Scaffold the monorepo and app skeleton | Sprint 1 | ✅ dev_done | [r1_misc_us_001.md](sprint-1/r1_misc_us_001.md) |
| **US-003** | Core schema migration with DB-level register integrity | Sprint 1 | ✅ dev_done | [r1_misc_us_003.md](sprint-1/r1_misc_us_003.md) |
| **US-004** | Platform auth via Keycloak OIDC (mandatory 2FA for admin roles) | Sprint 1 | ✅ dev_done | [r1_misc_us_004.md](sprint-1/r1_misc_us_004.md) |
| **US-005** | Server-side RBAC + company scoping middleware | Sprint 1 | ✅ dev_done | [r1_misc_us_005.md](sprint-1/r1_misc_us_005.md) |
| **US-007** | Seed: companies CSV + go-live register backfill | Sprint 1 | ✅ dev_done | [r1_misc_us_007.md](sprint-1/r1_misc_us_007.md) |
| **US-011** | Users, roles and delegation-ready grants | Sprint 3 | ✅ dev_done | [r1_misc_us_011.md](sprint-3/r1_misc_us_011.md) |
| **US-054** | Anthropic API probe spike | Sprint 1 | 🔨 in_development | [r1_misc_us_054.md](sprint-1/r1_misc_us_054.md) |

### CHG-002: Reconcile Sprint 2 planning sources

**Status:** 🟡 `proposed`
**Source:** internal
**Requested by:** Francisco
**Notes:** Reconcile Ledger Sprint 2 planning outputs: hydrate 34 story points and canonical blocked_by edges from Step 10/story artifacts; set current_sprint to the first non-closed sprint after honoring sprint-level deferrals; canonicalize US-042 to 10 alert types; publish the US-014 lifecycle transition ...

_No stories linked to this change yet._

### CHG-003: A Central Finance register row exposes its request approval source trace in the authorized register drilldown without requiring a role-forbidden request-detail link; statement links remain independent

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-003 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-004: Reconcile reviewed generated guidance markers within the pinned CHG-001 section so later generated CHG entries cannot invalidate unchanged reviewed guidance; add regression coverage for multiple chang

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-004 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-005: Pin regenerated US-014 lifecycle guidance to the canonical plan graph, including blocked_no_seat to rejected and offboarding to failed, and pin US-045 acceptance wording to the Sprint 2 none-connector

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-005 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-006: Make the generated API reconciler's no-argument invocation target the repository root, discover method-exported Next.js App Router route handlers, compare method plus normalized path against a non-sca

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-006 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-007: Harden API reconciliation against lexical spoofing and evasive TypeScript call syntax, constrain CHG-004/005 manifests to canonical reviewed paths and SHA-256 values before artifact access, and add ap

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-007 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-008: Replace the hand-written TypeScript lexer in API reconciliation with an installed TypeScript compiler-API helper that parses route exports and frontend boundary calls with lexical scope and conservati

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-008 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-009: Extend compiler-AST API reconciliation to resolve native fetch through destructuring aliases, bind aliases, and call/apply wrappers while proving global object identity through TypeScript symbols and 

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-009 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-010: Revalidate only the Task 17-affected evidence for US-012 AC4, US-015 AC1, US-020 AC2, and the build/done projections for US-012, US-015, US-020, and US-022 against source commit 8594311e2d4c38b5d8d7d7

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-010 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-011: Sprint 2 remains terminally closed_with_deferrals and Sprint 3 may start after CI, contract, dependency, and projection gates pass. US-054 remains externally blocked and is a live-provider terminal/go

**Status:** 🟡 `proposed`
**Source:** tenant_minted
**Requested by:** register-tenant
**Notes:** # CHG-011 — tenant-minted, backfilled by IMP-378

This row is **ledger truth, not a design document**. The id was minted inside the dev package at `/Users/fcolomas/Projects/smp` and used there before it was ever registered in `nous.db`; `change register-tenant` created this row so the substrate c...

_No stories linked to this change yet._

### CHG-012: Migrate nav map sidebar.sections to the canonical object form (id + label_en + label_es)

**Status:** 🟡 `proposed`
**Source:** internal
**Requested by:** Francisco
**Notes:** # CHG-012 — Migrate `sidebar.sections` to the canonical object form

**Project:** `fcostudios__smp` · **Source:** IMP-351 §5 (closes the IMP-347 → IMP-351 arc)

## Why this is a CHG and not an IMP

The fork's section ids are **English translations of Spanish display labels** and are verified
**un...

_No stories linked to this change yet._

### CHG-013: Carry the dev team's Sprint 2 spec refinements back into Nous (10 alert types, dedupe_key, US-014 transition table, US-017 SMTP semantics, US-045 connector scope)

**Status:** 🟡 `proposed`
**Source:** dev_agent_review
**Requested by:** Francisco
**Notes:** # CHG-013 — Carry the dev team's Sprint 2 spec refinements back into Nous

**Project:** `fcostudios__smp` (Ledger) · **Source:** the 2026-08-02 IMP-344…353 adoption sync
**Trigger:** a routine sync reverted **268 lines across 12 files** of dev-team-authored spec content.

## Why this is a CHG

Ve...

_No stories linked to this change yet._

### CHG-014: Cache local mutation evidence safely

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Content-Addressed Mutation Evidence Design

## Status

Approved in conversation on 2026-08-12.

## Goal

Make the local story-verification loop fast enough to use continuously without
weakening Ledger's mutation gate. Successful mutation shards and
verification-only bundles will be reused only ...
**Feedback:** US-023 verification repeatedly reran unchanged mutation shards

_No stories linked to this change yet._

### CHG-022: Work readiness gate: block oversized or mixed-scope US/CHG before implementation

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-022 — Work readiness and outcome-based partitioning design

## Status

Approved direction for implementation. This design establishes a blocking,
repository-enforced readiness gate for every new `US-*` and `CHG-*` work item.

## Problem and measured motivation

US-025 took eleven hours from...

_No stories linked to this change yet._

### CHG-023: Agent guidance mirrors, merge-HEAD gate, and Stryker exclusions (partition parent)

**Status:** 🟡 `proposed`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-024: Agent guidance mirrors track the layered CLAUDE.md

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-025: Staged readiness validates a merge HEAD against its first parent

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-026: Commit the measured Stryker sandbox exclusions

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-027: Provision the work-readiness approval public key into CI

**Status:** 🟡 `proposed`
**Source:** client_review
**Requested by:** Francisco Lomas
**Notes:** # WITHDRAWN — filed in error, do not work

Filed 2026-08-15 by the Nous assistant without being requested, while
delivering the CHG-023 approval material. Withdrawn the same day at the
operator's instruction.

The underlying gap is real and is already documented in the tenant's own
`docs/dev-guid...

_No stories linked to this change yet._

### CHG-028: Define the approval-key cutoff and revocation policy

**Status:** 🟡 `proposed`
**Source:** client_review
**Requested by:** Francisco Lomas
**Notes:** # WITHDRAWN — filed in error, do not work

Filed 2026-08-15 by the Nous assistant without being requested, while
delivering the CHG-023 approval material. Withdrawn the same day at the
operator's instruction.

The underlying gap is real and is already documented in the tenant's own
`docs/dev-guid...

_No stories linked to this change yet._

### CHG-029: Feedback lifecycle checker must not require started before a decision

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-030: Separate missing base config from unreadable in mutation-scope failure message

**Status:** 🟡 `proposed`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-031: Commit hook resolves the approval trust map from the repo when the env var is unset

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-032: Readiness CLI resolves approval trust from the repo outside CI

**Status:** 🟡 `proposed`
**Source:** client_review
**Requested by:** Francisco Lomas
**Notes:** # WITHDRAWN — not needed, no code change required

Filed 2026-08-15 to make the readiness CLI resolve the approval trust map from
the repository. Withdrawn the same day: the blocker had nothing to do with the
CLI.

Root cause was an operator-environment mistake, not a gap in the gate. The trust
e...

_No stories linked to this change yet._

### CHG-033: Force a partition after repeated ready re-approvals of one work item

**Status:** 🟡 `proposed`
**Source:** client_review
**Requested by:** Francisco Lomas

_No stories linked to this change yet._

### CHG-034: Work-readiness gate simplification: retire Ed25519 signing, wall-clock checkpoints, dual ledger, and git-code sprawl

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Work-readiness gate simplification — design

## Status

Design only. Not yet executed. Filed in `nous.db` as **CHG-034** (`kind:
technical`, per IMP-370) against `fcostudios__smp`; this document is the CHG
body. Execution follows `docs/dev-guide/WORK_READINESS.md`'s own change-control
("a separ...

_No stories linked to this change yet._

### CHG-035: Re-baseline the work-readiness execution budget from 120 to 320 minutes, calibrated by IMP-374

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-035 — Re-baseline the work-readiness execution budget from 120 to 320 minutes, calibrated by IMP-374

## Status

Filed in `nous.db` as **CHG-035** (`kind: technical`, per IMP-370) against
`fcostudios__smp` on 2026-09-05; this document is the CHG body. One child is
expected — the change is a...

_No stories linked to this change yet._

### CHG-036: Retire Ed25519 approval signing, keeping signed history readable

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-036 — Retire Ed25519 approval signing, keeping signed history readable

Child 1 of **CHG-034** (`partition_required`), the `retire-signing` partition.
Parent design: `docs/changes/CHG-034-work-readiness-simplification.md` §1 and its
execution-pass correction log.

## Outcome

Approval decis...

_No stories linked to this change yet._

### CHG-037: Replace the wall-clock lock with a task-boundary self-report and collapse to one ledger

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-037 — Replace the wall-clock lock with a task-boundary self-report, and collapse to one ledger

Child 2 of **CHG-034** (`partition_required`), the `retire-clock-and-dual-ledger`
partition. Parent design: `docs/changes/CHG-034-work-readiness-simplification.md`
§2 and §3, plus its execution-p...

_No stories linked to this change yet._

### CHG-038: Collapse the fine-grained git-plumbing codes into one message-carrying error

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-038 — Collapse the fine-grained git-plumbing codes into one message-carrying error

Child 3 of **CHG-034** (`partition_required`), the `collapse-git-codes`
partition. Parent design §4.

## Outcome

The residual git operations raise a single `WR_GIT_ERROR` carrying the
underlying message, in...

_No stories linked to this change yet._

### CHG-039: Make the WR_* code set countable: one spelling at every call site

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-039 — Make the `WR_*` code set countable: one spelling at every call site

Child 4 of **CHG-034** (`partition_required`), the
`reconcile-doc-and-schema-codes` partition — **re-scoped**, see below.

## The filed premise was wrong, and it was mine

CHG-034's execution-pass correction log clai...

_No stories linked to this change yet._

### CHG-040: Restore operational deadline rules to the effectiveness-critical set

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco Lomas
**Notes:** Widen the canonical critical set in v1/09b_business_rules.md from nine to twelve rules by restoring BR-08 approval aging, BR-11 low-pool alerting, and BR-14 same-business-day deprovisioning. Regenerate testing/critical-paths.md from the spec; do not hand-edit the generated projection. Preserve th...
**Feedback:** BR-08

_No stories linked to this change yet._

### CHG-041: Allow honest legacy closure actuals for pre-CHG-037 work

**Status:** 🟢 `accepted`
**Source:** developer_feedback
**Requested by:** Francisco Lomas
**Notes:** Add a narrow readiness compatibility path for work started before CHG-037: permit terminal actuals to carry reconstructable primary-source counts while phase_minutes is explicitly unreconstructable with a mandatory reason. Scope the exception to legacy items only and keep all modern actuals stric...
**Feedback:** US-043

_No stories linked to this change yet._

### CHG-042: Re-pin regenerated guidance and propagate the 320-minute budget

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco Lomas
**Notes:** Add an immutable reconcile migration layer for the 2026-09-05 generated CHANGES.md, CLAUDE.md, and testing/critical-paths.md states; propagate CHG-035's 320-minute limit to AGENTS.md, CODEX.md, .cursorrules, .github/copilot-instructions.md, and DEFINITION_OF_DONE.md; and bind every new source/des...
**Feedback:** CHG-035

_No stories linked to this change yet._

### CHG-043: Fix the root test runner: two workspaces declare vitest without a config, and the delivered mock lint fails on alerts/actions.test.ts

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-043 — Fix the root test runner: two workspaces declare a vitest `test` script without a config, and the delivered mock lint fails on `alerts/actions.test.ts`

## Status

Filed in `nous.db` as **CHG-043** (`kind: technical`, per IMP-370) against
`fcostudios__smp` on 2026-09-05. Tenant verifi...

_No stories linked to this change yet._

### CHG-044: Re-pin testing/critical-paths.md after CHG-040 regenerates the critical set

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-044 — Re-pin `testing/critical-paths.md` after CHG-040 regenerates the critical set

## Status

Filed in `nous.db` as **CHG-044** (`kind: technical`, per IMP-370) against
`fcostudios__smp` on 2026-09-05, as the companion the smp session asked for.
Tooling only: one pinned migration in `infr...

_No stories linked to this change yet._

### CHG-045: Add a durable connector call observation ledger for US-018

**Status:** ✅ `dev_done`
**Source:** developer_feedback
**Requested by:** Francisco Lomas
**Notes:** # US-018 Anthropic Connector Design

**Date:** 2026-09-05
**Status:** Approved
**Story:** `docs/stories/sprint-3/r1_misc_us_018.md`
**Readiness:** `docs/readiness/US-018.json`

## Goal

Deliver the R1 Anthropic adapter behind Ledger's vendor-neutral connector
interface. The adapter must keep Admi...
**Feedback:** US-018

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-056** | Anthropic transport with separated credentials and bounded retry | Sprint 3 | ✅ dev_done | [r1_misc_us_056.md](sprint-3/r1_misc_us_056.md) |
| **US-057** | Append-only sanitized connector-call journal | Sprint 3 | ✅ dev_done | [r1_misc_us_057.md](sprint-3/r1_misc_us_057.md) |
| **US-058** | Anthropic connector conformance and Pact contracts | Sprint 3 | ✅ dev_done | [r1_misc_us_058.md](sprint-3/r1_misc_us_058.md) |

### CHG-046: Accept substrate-emitted generated Nous paths by provenance instead of a per-sync overlay-layer registration

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-046 — Accept substrate-emitted generated Nous paths by provenance instead of a per-sync overlay-layer registration

## Status

Filed in `nous.db` as **CHG-046** (`kind: technical`, per IMP-370) against
`fcostudios__smp` on 2026-09-05. Tenant verification infrastructure only
(`scripts/work-r...

_No stories linked to this change yet._

### CHG-047: Authoritative cold campaign is diff-scoped and runs once, last; actuals record campaign minutes; estimate re-weights review

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-047 — The authoritative cold campaign is diff-scoped and runs once, last; actuals record campaign minutes; the estimate model re-weights review

## Why (measured, 2026-09-06)

US-057 was on budget (208 estimated / 228 actual) but review took 148 of those
minutes against an estimate of 20, w...

_No stories linked to this change yet._

### CHG-048: Guard readiness calibration output size and audit CHG-047 actuals

**Status:** 🟢 `accepted`
**Source:** developer_feedback
**Requested by:** Francisco Lomas
**Notes:** # CHG-048 — Guard readiness calibration output size and audit CHG-047 actuals

## Background

CHG-047 introduced opt-in readiness estimate calibration. Its final whole-change review reproduced a boundary defect: an input artifact can be valid at the 4,194,304-byte reader limit, while calibration'...

_No stories linked to this change yet._

### CHG-049: Register the 2026-09-06 substrate delivery as an overlay layer and carry the 17 synced paths

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-049 — Register the 2026-09-06 substrate delivery in the overlay layers and carry the 17 synced paths

## Why

On 2026-09-06 the operator ran the substrate's IMP-386 `adopt` + `agent_files`
sync against this package (nous `6466f60d`): refreshed
`docs/dev-guide/DEFINITION_OF_DONE.md` (one col...

_No stories linked to this change yet._

### CHG-050: Carry the exact 2026-09-06 Nous delivery as technical provenance

**Status:** 📦 `delivered`
**Source:** CHG-049 readiness partition carry-delivery
**Requested by:** Francisco Lomas
**Notes:** # CHG-050 — Carry the exact 2026-09-06 Nous delivery as technical provenance

## Parent

Partition child `carry-delivery` of CHG-049.

## Outcome

Carry the exact 17 operator-delivered paths under technical ownership, without attributing generator and guidance maintenance to functional story US-0...

_No stories linked to this change yet._

### CHG-051: Register the eight-file CHG-049 immutable overlay

**Status:** 📦 `delivered`
**Source:** CHG-049 readiness partition register-overlay
**Requested by:** Francisco Lomas
**Notes:** # CHG-051 Overlay Registration Design

## Context and outcome

CHG-050 carries eight generated guidance files whose current SHA-256 values are unknown to `reconcile-sprint1-docs.py`. Because the reconciler runs inside lint, the red state blocks every subsequent story. CHG-051 registers those exac...

_No stories linked to this change yet._

### CHG-052: Reconcile the US-018 partition: retire tenant-local US-059..062 as superseded; close US-018 by parent-level verification

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-052 — Reconcile the US-018 partition: retire tenant-local US-059..062 as superseded, close US-018 as satisfied by its three canonical children

## Why (measured 2026-09-07)

US-018 (Anthropic connector client, 4 SP) was split on 2026-08-15 into seven
tenant-local children US-056..062 (readi...

_No stories linked to this change yet._

### CHG-053: Register the 2026-09-07 IMP-393/398 guidance refresh and two-file immutable overlay

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-053 — Register the 2026-09-07 IMP-393/398 guidance refresh

## Context

The substrate refresh after IMP-393 and IMP-398 delivers seven tenant paths: `CLAUDE.md`, `CODEX.md`, `.cursorrules`, `.github/copilot-instructions.md`, `docs/dev-guide/FRONTEND.md`, `docs/dev-guide/CONTRIBUTING-GUIDANC...

_No stories linked to this change yet._

### CHG-054: Partition US-019 (520 min > 320) into four canonical children US-063..066; parent closes by verification

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-054 — Partition US-019 (520 min > 320 budget) into four canonical children US-063..066; parent closes by verification

## Why
US-019 "Automated provisioning: invite ≤ 15 min → Active" is 5 SP = 520 min at the calibrated
104 min/SP against the 320-minute execution budget (IMP-374, ready-chec...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-063** | Deliver approved requests as vendor invitations within 15 minutes | Sprint 3 | ✅ dev_done | [r1_misc_us_063.md](sprint-3/r1_misc_us_063.md) |
| **US-064** | Route provider no-seat responses to the capacity workflow | Sprint 3 | ✅ dev_done | [r1_misc_us_064.md](sprint-3/r1_misc_us_064.md) |
| **US-065** | Recover failed automated provisioning with an operator retry | Sprint 3 | ✅ dev_done | [r1_misc_us_065.md](sprint-3/r1_misc_us_065.md) |
| **US-066** | Activate accepted invitations from the 15-minute membership poll | Sprint 3 | ✅ dev_done | [r1_misc_us_066.md](sprint-3/r1_misc_us_066.md) |

### CHG-055: Register the 2026-09-07 PM authorization-guidance refresh and three-file immutable overlay

**Status:** 📦 `delivered`
**Notes:** # CHG-055 — Register the 2026-09-07 PM authorization-guidance refresh

## Context

The substrate refresh after IMP-397 and IMP-399 delivers verified database-authorization guidance in `docs/dev-guide/SECURITY.md`, `docs/dev-guide/STANDARDS.md`, and `docs/dev-guide/DEFINITION_OF_DONE.md`, plus ten...

_No stories linked to this change yet._

### CHG-056: Run every diff-scoped mutation shard before reporting the campaign result

**Status:** 🔵 `analyzed`
**Notes:** # CHG-056 — Run every diff-scoped mutation shard before reporting the campaign result

## Context

IMP-397 identified an execution-conformance gap in the tenant mutation runner. `pnpm test:mutation` currently chains selected Stryker shards with fail-fast semantics, so the first below-threshold sh...

_No stories linked to this change yet._

### CHG-057: Mutation campaign: run every shard, lint the preflights before the campaign, one evidence commit per story

**Status:** 🟢 `accepted`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # The mutation campaign discovers one obstacle per run: run every shard, lint the preflights before the campaign, and stop documenting every attempt

## Why (measured 2026-09-08 from `story timeline` — IMP-397)

| story | est | actual | implementation | review | cold campaigns | campaign minutes ...

_No stories linked to this change yet._

### CHG-058: Next child faster: preview campaign per task, honest sizing, plan-only for partition children, fix the sandbox selector

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Run the next child faster: preview campaign per task, honest sizing, plan-only for partition children, fix the sandbox selector

## Why (measured on US-064 under CHG-057, 2026-09-08)

CHG-057 held: 2 cold campaigns, 9 campaign minutes (US-063: 9 and 44). The 189 minutes that
remain are three ot...

_No stories linked to this change yet._

### CHG-059: Append-only completion actuals correction

**Status:** 📦 `delivered`
**Source:** tenant_feedback
**Requested by:** Francisco Lomas
**Notes:** # CHG-059 Append-Only Completion Actuals Correction Design

## Problem

CHG-058 completed with valid source, review, mutation, and terminal evidence, but
its completion artifact records `changed_files: 11`. The value came from piping
RTK's human-formatted `git diff --name-only` display into `wc -...

_No stories linked to this change yet._

### CHG-060: Scope discipline and parallel siblings: AC-bound tasks, hardening declared or deferred, two sessions on parallel-safe children

**Status:** 🔵 `analyzed`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Scope discipline and parallel siblings: AC-bound tasks, hardening declared or deferred, two sessions on parallel-safe children

## Why (measured 2026-09-09)
US-066 closed with a clean process (readiness 8 min, one cold campaign at 94.46%, review 80 <
implementation 205) and still took 391 minut...

_No stories linked to this change yet._

### CHG-061: Adopt IMP-410: commit-msg accepts a pure Nous sync via scripts/nous-sync-owns.mjs

**Status:** 📦 `delivered`

_No stories linked to this change yet._

### CHG-062: Readiness gate accepts the delivered feedback vocabulary: phase markers and done.cost

**Status:** 📦 `delivered`

_No stories linked to this change yet._

### CHG-063: Partition US-021 (730 min > 320) into three canonical children US-067..069; invite-expiry config contract

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** Partition US-021 (Invite hygiene, 2 SP; tenant assessment 730 min > 320-minute execution budget, `partition_required`, docs/readiness/US-021.json @ smp b29f559) into three canonical 1-SP vertical children, following the CHG-054 / DEC-SMP-021 shape:

- **US-067** — Surface overdue invitations with...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-067** | Surface overdue invitations with configurable alerts | Sprint 3 | ✅ dev_done | [r1_misc_us_067.md](sprint-3/r1_misc_us_067.md) |
| **US-068** | Withdraw a pending invitation safely from exceptions | Sprint 3 | ✅ dev_done | [r1_misc_us_068.md](sprint-3/r1_misc_us_068.md) |
| **US-069** | Expire stale invitations automatically and notify the requester | Sprint 3 | ✅ dev_done | [r1_misc_us_069.md](sprint-3/r1_misc_us_069.md) |

### CHG-064: Fix the three unchanged-test flakes that fail the full gate: pg-pool teardown 57P01 race, report-job-failure concurrent-creator oracle, dispatch consecutive type-check deadline

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Fix the three unchanged-test flakes that fail the full gate: pg-pool teardown 57P01 race, report-job-failure concurrent-creator oracle, dispatch consecutive type-check deadline

## Why (measured 2026-10-02 on US-067..069, the first children after IMP-409..412)

The children landed on estimate (...

_No stories linked to this change yet._

### CHG-065: Verification cost: re-preview only touched shards, one-line survivor annotations, one controller session per story without 1 s polling, emit done.cost

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Verification cost: re-preview only touched shards, one-line survivor annotations, one controller session per story that never polls at 1 s, emit `done.cost`

## Why (measured 2026-10-01/02 on US-067..069 + US-021)

After IMP-409..412 and CHG-061/062/063 the three children landed at **0.95× esti...

_No stories linked to this change yet._

### CHG-066: Full-gate residue after CHG-064: container-load resets, unpinned health-route container, Ryuk disabled, WITH (FORCE) as non-superuser, readiness check's closed decision shape

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Full-gate residue after CHG-064: container-load resets, the unpinned health-route container, Ryuk disabled, `WITH (FORCE)` as non-superuser, and the readiness check's closed decision shape

## Why (CHG-064 closure, 2026-10-03)

CHG-064 fixed the five load-dependent causes it named (pg-pool tear...

_No stories linked to this change yet._

### CHG-067: Full-gate container-start burst and expiry lock-wait oracle

**Status:** 📦 `delivered`
**Notes:** # Full-gate container-start burst and expiry lock-wait oracle (partition child of CHG-066)

## Why

CHG-066 closed its six items (head 565fb63): `readiness:check:all` exits 0, a killed run leaves no
containers, `ECONNRESET` 0 in 20 runs, forced default-parallel `pnpm check` at 237–248 s per run. ...

_No stories linked to this change yet._

### CHG-068: Partition US-026 (510 min > 320) into canonical children US-070, US-071; DEC-SMP-024 allowlisted replay payload; DEC-SMP-025 manual ingestion default

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** Partition US-026 (Analytics sync: activity + cost, 3 SP; tenant assessment 510 min > 320-minute execution budget, `partition_required`, docs/readiness/drafts/US-026.json @ smp b6b651d, policy approvals recorded in the ledger 2026-10-05T13:36Z) into two canonical 1-SP vertical children, following ...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-070** | Ingest accurate daily person activity from API-enabled accounts | Sprint 3 | ✅ dev_done | [r1_misc_us_070.md](sprint-3/r1_misc_us_070.md) |
| **US-071** | Synchronize exact person costs within the 30-day revision window | Sprint 3 | ✅ dev_done | [r1_misc_us_071.md](sprint-3/r1_misc_us_071.md) |

### CHG-069: Preview budget: one round per task plus one final, 30 min per child, slow shards once, schema-shard routing fixed, host kept awake during gates

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Preview budget: one round per task plus one final, 30 minutes per child, slow shards once, schema-shard routing fixed, host kept awake during gates

## Why (measured on US-070 and US-071, 2026-10-05/06 — the first children under CHG-064..067)

The program's targets held except one. Both childre...

_No stories linked to this change yet._

### CHG-070: Session fan-out experiment: one consolidated implementer session per child, measured against US-070/071 before any rule changes

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Session fan-out experiment: one consolidated implementer session per child, measured against US-070/071 before any rule changes

## Why (measured on US-070 and US-071, 2026-10-05/06)

Wall-clock and throughput improved under the full program (459 minutes for two children, 2.4 product
lines per ...

_No stories linked to this change yet._

### CHG-071: Partition US-027 (750 min > 320) into canonical children US-072, US-073, US-074; DEC-SMP-026 lag-aware data_through; DEC-SMP-027 batch idempotency; DEC-SMP-028 flag ownership

**Status:** ✅ `dev_done`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** Partition US-027 (Inactivity flags + usage surface, 2 SP; tenant assessment 750 min > 320-minute execution budget, five scopes, five acceptance flows, 24 files, three primary outcomes, `partition_required`, docs/readiness/drafts/US-027.json @ smp aca2412, payload 374eaec6…abb3) into three canonic...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-072** | Usage surface: lag-aware inactivity per person on SCR-usage | Sprint 3 | ✅ dev_done | [r1_misc_us_072.md](sprint-3/r1_misc_us_072.md) |
| **US-073** | Batch reclamation proposals from SCR-usage | Sprint 3 | ✅ dev_done | [r1_misc_us_073.md](sprint-3/r1_misc_us_073.md) |
| **US-074** | Daily inactivity flagging of anchor license requests | Sprint 3 | ✅ dev_done | [r1_misc_us_074.md](sprint-3/r1_misc_us_074.md) |

### CHG-072: Feedback-order checker exempts annotation-class events from the started ordering (reads the class from the emitted vocabulary)

**Status:** 🟡 `cancelled`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CANCELLED 2026-10-10 — folded into CHG-073 item 4

CHG-073's acceptance needs `test:feedback-order` green, this CHG owned that checker, and both fixes are the same
rule (annotation-class events, read from the emitted vocabulary, are never execution or ordering violations).
Two items for one ide...

_No stories linked to this change yet._

### CHG-073: Readiness validator: annotation-class events are not pre-approval violations; append-only correction path for a mistakenly recorded historical lifecycle start (unblocks CHG-070)

**Status:** 📦 `delivered`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # Readiness validator: delivered annotation-class events are not pre-approval violations, and a mistakenly recorded historical lifecycle `started` has an append-only correction path

## Why (reproduced 2026-10-10 on chg-070, handoff commit daf624a)

`pnpm readiness:check -- CHG-070` exits 1 with ...

_No stories linked to this change yet._

### CHG-074: Partition US-024 (780 min > 320) into canonical children US-075, US-076, US-077; DEC-SMP-029..033 (BR-14 calendar, reasons, capacity refresh, departure confirmation, register closure)

**Status:** 🔨 `dev_in_progress`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** Partition US-024 (Offboarding + deprovisioning, 3 SP; tenant assessment 780 min bottom-up / 1,152 at 384 min/SP against the 320-minute execution budget, `partition_required`, docs/readiness/drafts/US-024.json @ smp adb533d on `us-024`, payload 409f38f0…ed6a) into three canonical 1-SP vertical chi...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-075** | Start anchored seat removal from both detail screens and finalize the register atomically | Sprint 3 | 🔨 in_development | [r1_misc_us_075.md](sprint-3/r1_misc_us_075.md) |
| **US-076** | Confirm person departure through the offboarding flow | Sprint 3 | ⬜ backlog | [r1_misc_us_076.md](sprint-3/r1_misc_us_076.md) |
| **US-077** | Raise same-business-day departure deprovisioning alerts | Sprint 3 | ⬜ backlog | [r1_misc_us_077.md](sprint-3/r1_misc_us_077.md) |

### CHG-075: Partition US-030 (drift detection + retroactive claim) into US-078/US-079/US-080; DriftEpisode entity; DEC-SMP-034..039

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Partition US-030 (Drift detection + retroactive claim, 3 SP; tenant assessment 780 min bottom-up / 1,152 at 384 min/SP against the 320-minute execution budget, `partition_required`, docs/readiness/drafts/US-030.json @ smp d7fa0df on `us-030`, base fd73ee3, payload a2a7a993…9811) into three canoni...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-078** | Open, resolve and list drift episodes from accepted member observations | Sprint 3 | ⬜ backlog | [r1_misc_us_078.md](sprint-3/r1_misc_us_078.md) |
| **US-079** | Claim a drift member retroactively with audit | Sprint 3 | ⬜ backlog | [r1_misc_us_079.md](sprint-3/r1_misc_us_079.md) |
| **US-080** | Show the drift-to-zero metric on the dashboard | Sprint 3 | ⬜ backlog | [r1_misc_us_080.md](sprint-3/r1_misc_us_080.md) |

### CHG-076: Amend CHG-074: repartition US-075 into US-075/US-081/US-082; reallocated = transfer (BR-02); capacity-refresh contract; DEC-SMP-040..042

**Status:** 🔨 `dev_in_progress`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Amend CHG-074's US-075 allocation before implementation, on the tenant's blocked readiness (`docs/readiness/US-075.json` @ smp 7b26d51 on `us-024`, digest f1ee50bc…60fe; 440 min / 5 scopes / 25–32 files / 2 boundaries against the 320-minute, 3-scope, 20-file, 1-boundary gate; parent approval 019a...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-081** | Refresh free capacity only after an accepted member observation | Sprint 3 | 🔨 in_development | [r1_misc_us_081.md](sprint-3/r1_misc_us_081.md) |
| **US-082** | Execute connector seat removal in the production worker | Sprint 3 | ⬜ backlog | [r1_misc_us_082.md](sprint-3/r1_misc_us_082.md) |

### CHG-077: Amend CHG-075: repartition US-078 into US-083/US-084/US-078; member observation contract + MemberObservation ledger; DEC-SMP-043..046

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Amend CHG-075's US-078 allocation before design or implementation, on the tenant's blocked readiness (`docs/readiness/US-078.json` @ smp 864742a on `us-030`, payload 7b78918c…c722; 540 min / 38 files / 2 boundaries against the 270-minute / 20-file ceiling). CHG-075 is `delivered` and the ledger i...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-083** | Accept complete member observations with authoritative identity and license evidence | Sprint 3 | ⬜ backlog | [r1_misc_us_083.md](sprint-3/r1_misc_us_083.md) |
| **US-084** | Run the hourly API member observation and verify confirmed provisions | Sprint 3 | ⬜ backlog | [r1_misc_us_084.md](sprint-3/r1_misc_us_084.md) |

### CHG-078: Refine CHG-076: US-081 split by screen limit — US-081 (vendor-account foundation) + US-085 (pools/dashboard overview)

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Refine CHG-076's US-081 allocation before execution, on the tenant's screen-limit finding (us-024 @ 00f2b15: the canonical US-081 changed three screens — SCR-pools, SCR-vendor-account-detail, SCR-admin-dashboard — against WORK_READINESS.md hard limit 4, ≤ 2 routes/screens per executable item; the...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-085** | Show pending-refresh capacity on the pools and dashboard overview | Sprint 3 | ⬜ backlog | [r1_misc_us_085.md](sprint-3/r1_misc_us_085.md) |

### CHG-079: Technical prerequisite for US-075: register people-action-service → repository.integration.test route; canonical critical-set registration (BR-14 governed-by US-075/077/082)

**Status:** 🟢 `accepted`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Technical prerequisite for US-075 (CHG-076/078 allocation unchanged; no functional repartition): register one responsible source-to-suite route in the tenant's mutation harness and deliver the canonical critical-set registration that follows from the amended stories. Requested by the US-075 contr...

_No stories linked to this change yet._

### CHG-080: Technical prerequisite for US-081: publish the capacity-refresh critical path (config v44) and reconcile critical-paths.md + TESTING.md §3; sequenced after CHG-079's pin

**Status:** 🟢 `accepted`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Technical prerequisite for US-081 readiness: publish the capacity-refresh critical path and reconcile the two pinned guidance files. Requested by the US-024 controller ("does existing TESTING §3 registration fulfil US-081's capacity-refresh logic?"). Ruling: it does not. §3 carries BR-11 (low-poo...

_No stories linked to this change yet._

### CHG-081: Technical successor to CHG-079: route packages/domain request-workflow lifecycle.ts → orchestration.integration.test.ts for US-075

**Status:** 🟢 `accepted`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Technical successor to CHG-079 (not an amendment: CHG-079 carries an approved readiness digest and its route + pin are committed; changing its scope would void that approval). Requested by the US-075 controller at smp c04b812 on us-024.

Scope (tenant harness `scripts/mutation-scope.mjs`, a tenan...

_No stories linked to this change yet._

### CHG-082: smp readiness-gate policy: bookkeeping excluded from the 20-file limit; functional items may add responsible test routes (data-file superset only)

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Tenant readiness-gate policy (technical). It reduces the round trips that turned US-024's chain into six CHGs in one day. Two of those were route-only technical CHGs (CHG-079, CHG-081) whose sole purpose was to keep US-075 at ≤ 20 inclusive paths. Drafted by Nous at Francisco's request; **propose...

_No stories linked to this change yet._

### CHG-083: Partition US-075 into US-086 (anchored removal start) and US-087 (checklist removal completion); dependencies rewired

**Status:** 📦 `delivered`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Partition US-075 (amended by CHG-076; tenant assessment `partition_required`, 350 min against 320, docs/readiness/US-075.json on us-024 @ 9614e6e) into two canonical 1-SP vertical children, exactly as the tenant proposed. No new policy ruling.
- **US-086** — Start anchored seat removal from both ...

**Stories created by this change:**

| Story | Name | Sprint | Status | File |
|-------|------|--------|--------|------|
| **US-086** | Start anchored seat removal from both detail screens | Sprint 3 | ⬜ backlog | [r1_misc_us_086.md](sprint-3/r1_misc_us_086.md) |
| **US-087** | Complete checklist seat removal and close the register atomically | Sprint 3 | ⬜ backlog | [r1_misc_us_087.md](sprint-3/r1_misc_us_087.md) |

### CHG-084: Technical follow-up to CHG-082: historical readiness assessments are never reclassified by rebase; bookkeeping_files optional (absent = legacy counting)

**Status:** 🟢 `accepted`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Technical follow-up to CHG-082 (defect found by the US-024 controller while rebasing us-024 onto main, recorded at 9614e6e). CHG-082 classifies rebased HISTORICAL readiness assessments as new and demands `bookkeeping_files`, failing them with WR_MISSING_PROPERTY although their approved digests mu...

_No stories linked to this change yet._

### CHG-085: Technical: reconciler pin for the guidance regenerated by CHG-083 (BR-14 governed-by += US-086, US-087)

**Status:** 🟢 `accepted`
**Source:** client_review
**Requested by:** Francisco
**Notes:** Technical: reconciler pin for the guidance regenerated by CHG-083. Both new children declare BR-14, so `testing/critical-paths.md` (BR-14 governed-by += US-086, US-087) and `docs/dev-guide/TESTING.md` §3 change; both are pinned by `infra/scripts/reconcile-sprint1-docs.py`. Nous delivers both with...

_No stories linked to this change yet._

