# Change Requests — Story Cross-Reference

> **Auto-generated from nous.db.** Shows every CHG and the stories it created.
> Regenerate: `python3 Nous/System/nous_package.py sync -c sprint_plan`

| CHG | Status | Title | Stories | Sprints |
|-----|--------|-------|---------|---------|
| **CHG-001** | 🟡 proposed | Reconcile Sprint 1 execution contract | US-001, US-003, US-004, US-005, US-007, US-011, US-054 | S1, S3 |
| **CHG-002** | 🟡 proposed | Reconcile Sprint 2 planning sources | — | — |
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
| **CHG-041** | 📦 delivered | Allow honest legacy closure actuals for pre-CHG-037 work | — | — |
| **CHG-042** | 📦 delivered | Re-pin regenerated guidance and propagate the 320-minute budget | — | — |
| **CHG-043** | 📦 delivered | Fix the root test runner: two workspaces declare vitest without a config, and the delivered mock lint fails on alerts/actions.test.ts | — | — |
| **CHG-044** | 📦 delivered | Re-pin testing/critical-paths.md after CHG-040 regenerates the critical set | — | — |
| **CHG-045** | 🔨 dev_in_progress | Add a durable connector call observation ledger for US-018 | US-056, US-057, US-058 | S3 |
| **CHG-046** | 🟢 accepted | Accept substrate-emitted generated Nous paths by provenance instead of a per-sync overlay-layer registration | — | — |

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

**Status:** 📦 `delivered`
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

**Status:** 🔨 `dev_in_progress`
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
| **US-056** | Anthropic transport with separated credentials and bounded retry | Sprint 3 | 🔨 in_development | [r1_misc_us_056.md](sprint-3/r1_misc_us_056.md) |
| **US-057** | Append-only sanitized connector-call journal | Sprint 3 | ⬜ backlog | [r1_misc_us_057.md](sprint-3/r1_misc_us_057.md) |
| **US-058** | Anthropic connector conformance and Pact contracts | Sprint 3 | ⬜ backlog | [r1_misc_us_058.md](sprint-3/r1_misc_us_058.md) |

### CHG-046: Accept substrate-emitted generated Nous paths by provenance instead of a per-sync overlay-layer registration

**Status:** 🟢 `accepted`
**Source:** developer_feedback
**Requested by:** Francisco
**Notes:** # CHG-046 — Accept substrate-emitted generated Nous paths by provenance instead of a per-sync overlay-layer registration

## Status

Filed in `nous.db` as **CHG-046** (`kind: technical`, per IMP-370) against
`fcostudios__smp` on 2026-09-05. Tenant verification infrastructure only
(`scripts/work-r...

_No stories linked to this change yet._

