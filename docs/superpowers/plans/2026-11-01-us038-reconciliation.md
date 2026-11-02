# US-038 reconciliation implementation plan

> Implement inline in the supplied dedicated worktree. Review the complete branch before the final mutation campaign.

**Goal:** Implement AC1–AC4 of `docs/stories/sprint-3/r1_misc_us_038.md`, governed by BR-20 and DEC-SMP-016/066.

**Architecture:** Exact decimal cents in a shared domain rule. Audited Drizzle transactions serialize account/period commands; database triggers preserve terminal evidence. The existing reconciliation route consumes server actions and finalized statement contributions, grouped by vendor organization.

**Constraints:** Only US-038; no consolidated screen, CSV, provider connector, branch switch or merge. All money comes from finalized statements, never live assignments/rates. Validate shared Zod commands; resolve actor/scope from authorization. Variance explanation amounts do not change the tolerance calculation.

**Contracts:** `saveInvoiceAmount({period,vendorAccountId,invoiceAmountUsd})` saves open outside tolerance and automatically reconciles inside. `overrideReconciliation({period,vendorAccountId,note})` requires saved invoice, outside tolerance, finance/admin and note. `saveVarianceLine` upserts an open parent’s line (cause/detail/register/invoice/evidence URL); `deleteVarianceLine` deletes only under the same open scoped parent. Read model returns finalized org cards and their lines. No client status or rollup input is accepted.

**Rollup:** Final statement headers are company totals spanning accounts. Sum account contributions from their finalized statement lines, checking headers against all statement lines. Reject incomplete/draft or partially authorized orgs rather than reconcile a partial invoice. Preserve final statement status; reconciliation has its own terminal status.

## Tasks

- [x] Domain: failing exact boundary triple (both signs, zero invoice), seeded money properties and invalid input; implement integer cents comparison `abs(delta)*200 <= invoice`.
- [x] Persistence: real app-role PostgreSQL tests for finalized totals, open saves, exact automatic flip, override note/actor/role, tenant isolation, CRUD immutability and rollback; implement service and append-only migration. Add evidence URL and guarded edit/delete grants. Database test proves committed migration behavior.
- [x] Workbench: test real forms and rendered cards; implement shared contracts, authenticated actions and dynamic existing route, per-org inputs, tolerance colors, variance CRUD/evidence, override confirmation, pending/error/empty states and locale strings.
- [x] Verification: preflight, type-check/lint/build/test, committed migration applier+verifier on fresh PostgreSQL, adversarial AC checks, fresh branch review, one final diff mutation campaign (>=80%, BR-20 evidence), feedback and commit. Report SHA; no merge.

## Review focus

Exact 0.50% inclusion and both variance signs; zero versus zero and nonzero versus zero; mixed account/company statements and draft blockers; terminal save/edit/delete races; missing/forged role, scope, actor, rollup and status. Test each at its owning boundary.

## Review record

Independent whole-branch review found no actionable correctness defect in AC1–AC4. The first full run exposed an existing signed-variance fixture; the append-only correction migration preserves either stored sign while retaining the exact BR-20 magnitude guard. The historical verifier executable stays hash-pinned before applying the narrow US-038 runtime grant profile to both executable comparisons. An unchanged targeted worker run (evaluate-alerts + membership-poll) passes all 34 tests.

Mutation previews exposed eager Zod/UI module caching; tests now reload modules so mutations exercise the actual contracts. Previews are diagnostic only, never completion evidence. The authoritative cold campaign uses the immutable worktree starting commit d1e2f9043569502b9ed6f5bd39375f0a93df880a, disposable owner/app PostgreSQL URLs, and MUTATION_CACHE=off.

## Final verification evidence

- `pnpm install --frozen-lockfile`: completed in the dedicated worktree before implementation.
- `pnpm type-check`, `pnpm lint`, `pnpm build`: pass.
- Fresh PostgreSQL: committed applier and schema verifier pass with 69 migrations, 33 application tables and the exact runtime grant matrix.
- Route registry: all 28 pages registered. API reconciliation (Python 3.12): all endpoints match; no raw fetch violations.
- Test lint: no assertion-free tests or forbidden mocks introduced.
- AC1–AC4: adversarially verified after fixes; see `.nous-feedback.jsonl`.
- Final full suite: pass (15/15 Turbo tasks; web1160 passed, DB359 passed, worker226 passed). Final cold diff campaign: pass, 96.59574468085107% (454 killed, 16 reviewed equivalents, zero uncovered/timeouts/errors), all eight shards passed in 1194.920 seconds. See `testing/us038-mutation-evidence.json`.

The serialized full run identified physical-column-order parity: PostgreSQL ADD COLUMN appends evidence_url after created_by, so the Drizzle declaration mirrors that append order. No committed migration or parity comparison is changed.

Diagnostic mutation review additionally constrained real authorization-loader failures, multi-org card partition, stale-open recomputation and terminal override rejection. All resulting tests pass; final full web suite is1159 passed. The earlier cold run is diagnostic, not reported as acceptance evidence; final campaign follows the closed oracle tree.

The final authorization-error oracle composes the action factory with the real app-role PostgreSQL authorization repository; all eight formerly uncovered catch-return mutations are killed. The final report is emitted only after closed review, refreshed functional gates and the authoritative cold campaign. Scored source/test/config/dependency hashes are unchanged. Raw diagnostics are retained locally under `.tmp/us038-reports/`; the compact final evidence is committed.
