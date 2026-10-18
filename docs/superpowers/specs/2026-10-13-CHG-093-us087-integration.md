# CHG-093 — Closed US-087 integration on the delivered runner

Preparation only. Proposed readiness digest `366ca764bc92faaf564673c2105ffbc0714e12117f5a2395c3b7307597ba786a`, 205 minutes. Francisco approved the canonical integration ruling; no approval of this new execution digest is inferred. Automatic resume is off; US-081 remains held.

## Authority and one outcome

Canonical specification: `/Users/fcolomas/Projects/nous/Nous/WorkControl/fcostudios/smp/CHG-093_TECH_SPEC.md` (Nous `6ecb4638`). Deliver one verified integration with append-only replacement applicability of US-087 evidence. No product repair, testing exception, new routing, tooling, migration or guidance amendment.

Assessed target is main `ae98f9fd4206a2e933355ec438cf9970ac3579bf`, including delivered CHG-094. Closed source is `5e3553d93adb36fcfa0e6316dc2a9f0a91ed0ecc`; its cold candidate is `d06c2a62b43843a1c06b15b35eb85385d119ff77`. The approved closed payload is `bc2bf6a955559d8be0e3f63ddcd5eb311d741bba21c0e374373acefa485bc7ef`, with immutable 254-minute actuals. The original deferred request `662ec87d-8b87-49e7-bd6c-42c050624df6` remains history. CHG-093 is separate authority, not a rewrite of that response.

## Current evidence and ownership

Read-only merge-tree result `69c9ee931f26b8c7d31689c9e739070c81cd5f15` conflicts only in `.nous-feedback.jsonl`. This tree is an inspection artifact containing conflict markers, never an executable candidate. There are 22 source-only commits after common ancestor `567af3198403a9c870a446821426054f22f0183a`. No source ref has been rewritten.

The complete anticipated integration inventory is eight nonbookkeeping paths and six bookkeeping paths. The eight existing deliveries replayed byte-for-byte are:

- `.nous-project.json`, `.nous-provenance.json`, `.nous-sync.json` — existing canonical sync envelope, not newly authored configuration.
- `apps/web/src/modules/request-workflow/actions/checklist-action-transaction.test.ts` and `apps/web/src/modules/request-workflow/orchestration.integration.test.ts` — the already-reviewed US-087 acceptance oracles missing from target.
- `docs/stories/CHANGES.md`, `docs/stories/SPRINT_PLAN.md`, `docs/stories/sprint-3/r1_misc_us_087.md` — existing canonical story/control records.

Bookkeeping is CHG-093 readiness, this design, its execution plan, `.nous-feedback.jsonl`, closed `docs/readiness/US-087.json`, and the existing `docs/superpowers/plans/2026-10-12-US-087-checklist-removal-completion.md`. Git refs and raw evidence are custody artifacts. Production blobs already match; tests/control delivery is inherited replay, not new implementation. Check original Nous sync commits with `scripts/nous-sync-owns.mjs --staged`; do not manually re-author generated files. Inspect `testing/critical-paths.md` and `docs/dev-guide/TESTING.md` after replay; the preview leaves both target files intact.

## Exact historical scope, separate execution identity

`mutation_scope` in `docs/readiness/CHG-093.json` binds the historical diff from `783d09df4467e27462dec440cc64ac4855d02e02` to `d06c2a62b43843a1c06b15b35eb85385d119ff77`. It names only these sorted sources:

| Source | Historical/current blob | Complete inclusive ranges |
|---|---|---|
| `apps/web/src/modules/request-workflow/actions/checklist-action-transaction.ts` | `1aaf9e6dd6fdacb2f1afc64555d261cf2304d14e` | 7–7, 15–15, 75–107, 225–251 |
| `apps/web/src/modules/request-workflow/orchestration.ts` | `4b05e835f6b54d89eeb22c01e3c77d379c116dab` | 2–2, 41–82, 323–323, 470–478, 676–693 |
| `packages/domain/src/request-workflow/lifecycle.ts` | `5952c428f906766ad0936595f9296c7024cda321` | 55–122 |

Fresh pending planning on the actual preparation checkout yields three current shards, ten ranges, and scope digest `bafe1f623e83a7e76f40022dbf6e9fd04d0e4a5b96870ebfba939674185ba03c`, with `authoritative:false`. Current accountable suites are checklist-action-transaction.test.ts, orchestration.integration.test.ts, and domain lifecycle.test.ts. Orchestration integration runs in all three relevant shards. No historical seven-shard count is forced.

The full ranges conservatively include earlier US-075 same-file changes (historical commits `8fe7ce3`, `e59c1dd`, `a6dfc17`). They are not exclusively US-087-authored hunks. No same-file range pruning, full-file expansion, score reuse or synthetic ancestry is allowed. Current runtime, schema, suites, runner and execution head remain current; historical base/head are scope identities only.

Main currently carries older US-087 readiness digest `9aeeb1afd4100c7f9bf17b3107907942c3560e14fff77218f44720d7351e451e`. This does not block approval of the proposed governing assessment: pending planning is read-only. After digest approval, the authorized replay must restore the closed readiness and raw decisions before owned preflight/campaign activation. The loader must then validate the exact closed digest and completed subject context. Never integrate before approval to manufacture authority; never reactivate US-087 or change its actuals.

## Replay and ledger algorithm

After genuine digest approval is committed, commit the approved design/plan and `started`/phase markers, then freeze the approved entry SHA. It descends from assessed main and contains only approved CHG-093 bookkeeping. Create a named preserved ref at exact closed source, retaining its cold ancestor. Fork the existing closed history into an isolated integration candidate, then rebase those 22 commits onto the approved entry. This preserves original `us-024` while replaying its actual history; record every original/rebased SHA, including any empty replay and its reason.

For each conflict, use approved entry ledger as exact byte prefix. Append only source unique raw rows through the original commit currently being replayed, in original order. Deduplicate by exact raw line, not reserialized JSON. Do not append the source's final terminal row at the first conflict: doing so would make later replayed implementation appear after completion. At the final original source cutoff, independently assert all original unique rows and their order, target/entry prefix, historical approvals, and unchanged US-087 payload/actuals. Any other conflict or unexpected blob change stops for reassessment.

## Verification, correction and integration

Use one consolidated implementer, one reused scoped reviewer, and one fresh adversarial final AC reviewer. No previews are needed for integration without source repair; record zero preview rounds/minutes. Shared lock ownership includes token/device/inode; wait for foreign owners and never delete their lock. Run the existing CHG-067 helper `packages/db/src/testing/run-with-shared-postgres.ts`, committed migration applier and schema verifier as prescribed; no private fixtures or containers.

Ordinary full gate uses `TZ=America/Guayaquil` and exact `caffeinate -i pnpm check`, with owned scope identity `MUTATION_SCOPE_WORK_ID=CHG-093`, `MUTATION_WORK_ID=US-087`. Do not set `MUTATION_BASE`, `MUTATION_SHARD` or `MUTATION_SCOPE_DRY` in owned mode. CHG-094 proved the inherited worker PostgreSQL DATE oracle is local-timezone dependent; its failed UTC gate is retained, not repaired here. Run final owned preflight and cache-off cold with `TZ=UTC`, retaining each profile and actual candidate SHA.

After fresh selected AC suites, scoped review, full gate and independent final acceptance, freeze the final implementation candidate. Run one complete authoritative owned campaign last with `MUTATION_CACHE=off`. Require all three observed shards, complete approved sources/ranges, current runtime/schema identities, no routing gaps, the configured threshold (currently 80), and every survivor annotated and reviewed. The original 96.62% result is history only. A failure or new implementation commit invalidates applicability and requires concrete reassessment; there is no repeat campaign or repair budget hidden here.

Only after replacement evidence passes, append US-087 `evidence_superseded` targets for its unique build, AC1–3 and terminal. Append a named CHG-093 correction decision citing the already-recorded genuine approval, then matching `revalidated` records. Replacement build precedes replacement terminal. Closed projection keys are exactly those supported by `scripts/work-readiness/git.mjs`; terminal projection carries no new source_commit/cost. Actual candidate, scope/base, reports and methods belong in feedback/build/AC notes. Historical evidence, original cost and approved closed actuals remain byte-identical. CHG-093 records its own source-bound test report, actuals, nonzero measured-or-explicitly-estimated cost and done.

Integrate by fast-forward only after correction/lifecycle/readiness/guidance gates pass. Recheck main and candidate at integration; a moved main is a new assessed delta, never a silent rebase or reuse of cold evidence. Report a non-fast-forward to Francisco.

## Estimate and preparation validation

205 minutes: readiness25; replay/correction40 (30 replay/map/ledger +10 projection); focused30 (AC10 +real preflight10 +identity/fixture10); review30 (scoped10 +fresh15 +survivors5); integration80 (one cold60 +full gate10 +closure/FF10). Allowances are included once. Historical complete cold42.3341 minutes and CHG-094 current full gate247.131 seconds support the forecast; this is not a guaranteed runtime. No product, runtime, test, threshold or routing repair is authorized. Stop on unexpected conflicts, changed scope/shards, provenance gaps or total forecast above205; reassess rather than stretch.

Actual preparation results: classifier `ready`; pending planner exit0; `pnpm readiness:check -- CHG-093` exits1 only with `WR_APPROVAL_REQUIRED`. No `started`, preserved ref creation, rebase, DB setup, campaign, correction or integration has occurred. The assessment is committed separately. This plan/design are reviewable preparation; the implementation-plan commit gate requires prior genuine readiness approval, so no approval bypass is used.

Self-review: canonical acceptance conditions map to preservation/replay, current verification, and correction/integration tasks; scope includes the full previewed inventory; all ranges and exact authority identifiers are stated; the pending planner does not authorize execution. Sole entry blocker is this assessment's human digest approval.

## Recorded execution approval

Francisco directly replied approved to the complete205-minute packet in this conversation. Exact digest366ca764bc92faaf564673c2105ffbc0714e12117f5a2395c3b7307597ba786a is now bound by signed decision CHG093-EXECUTION-APPROVAL-SIGNED-20261013 and pnpm readiness:check passes. Earlier preparation results remain described above as history; this entry authorizes the unchanged assessed plan, not US081 or unassessed future-main work.
