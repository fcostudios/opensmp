# 10 — Plan: Ledger R1′ (`fcostudios__smp`)

**Step:** 10 · **Date:** 2026-11-01 · **Authority:** CHG-113, DEC-SMP-065 and DEC-SMP-066.
R1′ tests H2 through a license-only manual monthly close for five pilot companies. This replaces the former 155-SP R1 sprint plan. S0–S4 total **43 SP**; the first usable draft chargeback is at **14 SP**, and the core-value slice ends at **27 SP**.

## SEC1 — Slices S0–S4

One operator/orchestrator; one item per agent session. Slices are the delivery and acceptance unit. For the existing extract/hydration format only, Sprint 1–5 below map to slices S0–S4; these are not the former sprint assignments. New work is R1. Already-built baseline stories are reused without amendment.

**Calendar:** target one slice per week over five weeks, conditional on at least three operator active days per week and about 1.5 SP per active day. 43 / 1.5 = 28.7 active days if that is the actual pace; five weeks at three days yields only 15 active days and requires 2.87 SP/active day. Therefore five weeks is a target, not a promise: the 1.5-SP assumption yields about 9.6 weeks at the attention floor. Track actual verified SP weekly. The attention commitment remains open under DEC-SMP-066; do not invent approval. If S1 is not verified in production by the end of week 3, stop for an operator decision to rescope, pause or close.

**Data:** manual register entry, typed provisional rate/invoice and manually maintained pilot configuration allow S0–S2 to proceed. Real-data acceptance remains pending until the actual inputs arrive. Keys are not required. The period anchor is the most recently completed calendar month when the first real parallel close runs. Real invoice acceptance cannot be replaced by provisional totals or an override alone.

### Sprint 1 — S0: Register on production (5 SP)

**Goal:** deploy with Docker Compose and make the five-company register usable through manual entry.
**Milestone:** S0 production register journey accepted by Central Finance, Company Finance and IT Director.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-053 | Production Docker Compose deployment | 3 | US-002 |
| US-094 | Real-data run, child of US-007; provisional rehearsal until data arrives | 1 | US-007, US-053, US-095 |
| US-095 | Manual register entry | 1 | US-003, US-005, US-008, US-033 |

**Production exit:** Central Finance completes the register inspection and CSV export journey for month M-1 and five pilot companies on production; Company Finance verifies its company's headcount against its supplied list, and the IT Director completes login and deployment health checks. With manual inputs this exit is explicitly provisional: US-094 remains unverified until the real export is compared. Verifiers use human `story verify` only for the evidence actually accepted. Cumulative **5 SP**. No new money-rule campaign; reuse DB register integrity and auth evidence.

### Sprint 2 — S1: First draft chargeback (9 SP)

**Goal:** produce draft statements from register seat-days and typed rates.
**Milestone:** S1 first usable increment in production; cumulative 14 SP.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-032 | Effective-dated rates | 2 | US-005 |
| US-034 | License-only close and CloseRun | 5 | US-032, US-033 |
| US-096 | Statements list and group totals | 1 | US-034 |
| US-037 | CSV export half; PDF completes in S3 | 1 | US-034, US-096 |

**Production exit:** Central Finance completes the manual close and CSV handover journey on production for month M-1; Company Finance reads each pilot draft and compares seat-days, dated joiners/leavers and amounts line by line against its manual spreadsheet, recording every difference; the IT Director verifies deployed rerun behavior and that finals remain untouched. Provisional rates are visibly identified. Finance users and IT Director record acceptance with human `story verify` for completed work; US-037 is only partially accepted until its S3 PDF half. Critical mutation campaign once at slice close: **BR-17/18/21**, minimum 80%, survivors annotated. Cumulative **14 SP**.

### Sprint 3 — S2: A reconciled real month (13 SP)

**Goal:** answer H2 using the real invoice and contracted rate.
**Milestone:** S2 core value in production; cumulative 27 SP, H2 pending real data.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-036 | License statement detail and register evidence | 3 | US-034 |
| US-039 | Consolidated rollup and CSV export | 2 | US-034, US-096 |
| US-035 | Finalization and rate locking | 2 | US-034 |
| US-038 | Reconciliation and explained variances | 3 | US-035 |
| US-052 | First parallel close on real data | 3 | US-034, US-038, US-053, US-094 |

**Production exit:** Central Finance completes the invoice-entry, reconciliation, finalization and CSV delivery journey on production for a real completed month with the contracted rate; Company Finance for all five pilots accepts its statement and traces lines to register evidence, and the IT Director verifies final immutability and the deployed evidence. H2 passes only if the real invoice is present and the register-derived statement sum is within **0.5%** of it and accepted by the finance users. An `overridden` reconciliation with every variance explained is a supported operational outcome, but does not count as H2 passing; record the failed/pending hypothesis honestly. Manual register entry and a provisional rate permit rehearsal; **S2/H2 is not passed until the real invoice and contracted rate arrive**. Finance users and IT Director perform human `story verify` on the accepted real run. Critical mutation campaign once: **BR-20**, minimum 80%, survivors annotated. Cumulative **27 SP**.

### Sprint 4 — S3: Company self-service and manual register check (9 SP)

**Goal:** keep the register true without API automation and deliver company PDFs.
**Milestone:** S3 second-month company finance journey accepted in production; cumulative 36 SP.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-041 | Scoped statements and register experience | 2 | US-005, US-036, US-096 |
| US-097 | Member-list CSV comparison with manual corrections | 3 | US-095, US-005, US-025, US-008 |
| US-049 | Statement PDF brand template | 3 | US-003 |
| PDF half of US-037 | PDF export; CSV already credited in S1 | 1 | US-036, US-049 |

**Production exit:** Central Finance completes the member-list comparison and month-M close journey on production; mismatches are corrected through audited manual entry. Two Company Finance users independently open and export only their own PDF, with language per DEC-SMP-011; the IT Director verifies cross-company access rejection. Finance users and IT Director accept via human `story verify`, including US-037 now complete. If the real export is absent, manually transcribe the list and keep real-CSV acceptance pending; the close remains usable. No DriftEpisode or API dependency. Reuse S1/S2 campaigns; BR-22's single campaign closes in S4. Cumulative **36 SP**.

### Sprint 5 — S4: Operate monthly (7 SP)

**Goal:** schedule the monthly close and prove recovery and company isolation.
**Milestone:** S4 production system-of-record acceptance by finance users and IT Director; cumulative 43 SP.

| Story | Title | SP | Blocked By |
|---|---|---|---|
| US-051 | bd-3 close schedule and independent close_missed watchdog | 2 | US-034, US-046 |
| US-048 | Runbooks and encrypted backup/restore drill | 2 | US-002, US-053 |
| US-047 | Company isolation suite | 3 | US-041, US-034 |

**Production exit:** Central Finance completes the month-M+1 scheduled-close journey in production by business day 3 without a manual trigger; Company Finance verifies receipt and reads its own numbers; the IT Director completes a restore from the previous night's encrypted backup into an isolated recovery environment and verifies the restored register/statement totals against production evidence. Finance users and IT Director sign off with human `story verify`. Critical mutation campaign once: **BR-22**, minimum 80%, survivors annotated. Five pilot companies become the system-of-record scope only after this acceptance; rollout to 30 is configuration. Cumulative **43 SP**.

## SEC2 — Deferred R2 and frozen baseline

**S5 is R2 and not planned** (DEC-SMP-066). The historical optional API tail was about 8 SP (51 SP including the 43-SP core); 51 is a comparison scenario, not an R1 commitment. No S0–S4 dependency on API keys, US-026 analytics, US-030 drift machinery, US-050 usage lines, company CRUD or credential/settings UI remains.

Open cut stories: US-009, US-024, US-028/029/030/031, US-040, US-044, US-050, US-054, US-055, US-075/076/077/078/079/080/081/082/083/084/085/090/091/093 are R2. US-055 is the residual automation/usage/configuration parent: its AC3 manual entry is replaced in R1 by US-095, AC1's minimal comparison by US-097, and AC2 usage CSV remains R2. No duplicate R1 implementation.

Freeze built cut modules without editing their stories or statuses: US-019 and children US-063..066; US-021 (children US-067..069), US-023, US-026 (US-070/071), US-027 (US-072..074), and already-built US-086/087/088/089/092. All 50 built baseline stories remain unchanged. Reuse auth/RBAC/shell/audit, register, J1 orchestration, jobs and alerts. One production baseline acceptance pass covers US-001–008, US-012/013/015/020/033; only a human changes verification status. Other built work is accepted as built, unverified, with no further extension in R1′.

## SEC3 — Operating conditions

Spec frozen per slice; discoveries go to `docs/stories/DEFERRED_EXTERNAL_BLOCKERS.md` and are triaged at the demo. One approval of the slice story set; no tenant-built readiness gate, envelopes or per-item forecasts. One mutation campaign per slice's critical set, not per story or commit. Package type-check, lint, tests and build remain. No substrate changes mid-slice except a genuine blocking bug.

Every Friday record in WORKFLOW_STATE.md: `verified SP / 43 · week N of 5 · next slice · blocker`. Pending verifications are not earned SP; do not credit US-037 twice. The weekly attention floor is still an operator decision. Docker Compose is the R1′ host. Keep images and configuration twelve-factor so the later Azure Container Apps move needs no code change; that is a later change, not an R1 story.
