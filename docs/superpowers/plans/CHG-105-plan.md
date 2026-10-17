**Work item:** CHG-105
**Readiness assessment:** docs/readiness/CHG-105.json
**Approved estimate:** 315 minutes

# CHG-105 Owned Additive Declaration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. The human-selected method is one consolidated implementer with controller-dispatched independent reviews; no worker delegation. Steps use checkbox syntax.

**Goal:** Admit only a current approved functional item's own additive finite declaration, with own exact Git-to-production-release proof.

**Architecture:** Git builds immutable source/provenance snapshots, a pure helper validates the finite declaration and literal AST identity, and functional classification exempts only the admitted data path. The existing integrated production verifier independently validates actual migrated catalog state in a real release composition.

**Tech Stack:** Node MJS, existing locked TypeScript 5.9.3 AST parser, real Git, Vitest and official shared PostgreSQL 16 owner/app fixture.

**Spec:** `docs/superpowers/specs/CHG-105-design.md`, canonical CHG-105 TECH_SPEC and immutable Outcome A packet/addendum named there.

## Global Constraints

- Current exact digest `18fcf48488de3110ee8baf6110fa66eb19dc645da3e377baa9c423258ff7b60f`; decision `CHG105-READY-18FCF484` (original f4/4408 approval and reviewed source preserved); no separate human stage repermission. Independent builder PASS before source/test changes.
- Six technical paths and four bookkeeping paths exactly as the design; no product schema/migration/declaration, API/auth, TESTING, config or toolchain changes.
- Only finite drift_episode/drift-episode-v1 version2 additive newTables; immutable ordered old prefix; all tooling/mutation-route/CHG088 guards unchanged.
- Existing TypeScript5.9.3 parser and integrated104 parse/attest/verifier unchanged. No arbitrary SQL parser, code evaluation, candidate PASS authority or owned mocks.
- Baseline/main `d2280c4e511812da72b82084e6ad2ec891375781`; preserve complete original interval. Source mutation base is the post-builder-approved documentation entry commit, recorded before source.
- Every shell begins `rtk`. SharedPG CHG067 fixture only; no private container. Owner-aware `/tmp/smp-full-gate.lock`, no foreign lock deletion; awake uncached fullgate; final own native cold last.
- Upper315=25readiness+110implementation+95focused+55review+30integration; design/plan cost is included inside Task1's45, not added above110. New path/framework/proofgap or forecast>315 STOP amendment; >320/20 hard STOP. No borrowed proof or cost reset.

## Review Focus

1. A foreign table can look freshly owned after an unrelated schema edit: Task1 tests immutable-base absence and exact introduction lineage.
2. A bad history transition can disappear at matching endpoints: Task2 tests removal/re-addition, unauthorized intermediate edits, later approvals and full-history rejection.
3. Staged source may differ from worktree source: Task2 tests exact staged blobs/modes independently of unstaged bytes.
4. Correct declaration with wrong/no-table SQL can look structurally valid: Task3 requires structural PASS then actual release rejection.
5. Dependency copying can accidentally execute local source instead of admitted bytes: Task3 asserts Git-object extraction/checksums and faults the extracted candidate.

---

## Shared interfaces and checkpoints

Internal evidence types (plain immutable objects): `FileSnapshot = {path, mode, blob, bytes}`; missing entries are null. `Snapshot = {revision, schema, declaration, migrations: FileSnapshot[]}`. `OwnedTransition = {parent, commit, workId, digest, parentApproved, planBound, before: Snapshot, after: Snapshot}`. `git.mjs` alone computes approval booleans from real immutable assessments/feedback/plan validation; callers cannot supply a candidate receipt. Migrations are lexically sorted and carry SHA256 computed from bytes alongside Git blob identity.

New helper export: `validateSchemaDeclarationOwnership({workId, digest, authorityBase, parent, candidate, transitions}) -> true`, or an error translated by `git.mjs` to `WR_MIXED_FUNCTIONAL_TOOLING` at the declaration path. All arguments are snapshots/history, never filesystem/DB capabilities. `authorityBase`, `parent`, `candidate` are Snapshots; `transitions` includes every original authority-to-candidate transition. Schema AST parsing and finite declaration validation stay in this helper. Existing `validateFunctionalDelivery` public signature is unchanged. Preserve `itemAuthorityPaths` Set projection for mutation routes over the richer history records.

### Task 1: Pure structural ownership and immutable provenance (implementation upper45)

**Files:** create `scripts/work-readiness/schema-declaration-ownership.mjs`; modify `scripts/work-readiness/git.mjs` snapshot/history internals; tests in `scripts/test-work-readiness.mjs`.

**Consumes:** integrated `parseSchemaContract(bytes,path)` / `attestSchemaContract(declaration)`; existing `payloadAuthority`, `linearCommits`, parent assessment/plan checks.
**Produces:** pure helper signature and snapshot/transition shapes above, with existing route Set projection preserved. No functional admission is enabled yet.

- [ ] Read TDD `writing-good-tests.md` before test edits; record intended predicate fault for each new case. Read TESTING and Test Effectiveness Standard already completed at entry.
- [ ] Add minimal helper tests for exact valid additive profile and same-candidate/prior-own-approved introductions. Assert `true` for valid inputs; assert declaration category/path for old-prefix changes and borrowed existing table. Extend real fixture module/dependency copying in the existing test file only.
- [ ] Run `rtk pnpm test:work-readiness`; confirm RED for the missing helper/behavior, then implement the helper and immutable snapshot/history builder. Named import must be actual unaliased drizzle-orm/pg-core pgTable; unique direct export, literal table/column identities, selected referenced columns and immutable-base absence. Unsupported relevant shapes reject.
- [ ] Add distinct fault cases: computed/spread/dynamic names, import spoof/alias/re-export/duplicate table, missing/wrong column, duplicate/unsafe declaration, missing or nonregular schema/declaration/migration, old migration edit/removal/replacement, missing new migration and wrong timestamp path. Assert precise structural rejection. Each protects a distinct removed predicate; no coverage-only variants.
- [ ] Run focused harness GREEN and compare existing mutation-route ownership behavior. Inspect diff for scope and unchanged CHG088 constants. Run own mutation preflight; preview only actual touched shards if any, within preview budget.
- [ ] Commit normally `CHG-105 add immutable declaration ownership analysis`; submit checkpoint diff/report to controller. Stop at review boundary until spec compliance AND quality approved. Reassess spent+remaining315 before Task2.

### Task 2: Functional admission through real staged and historical gates (implementation upper45)

**Files:** `scripts/work-readiness/delivery-policy.mjs`, `scripts/work-readiness/git.mjs`, `scripts/test-work-readiness.mjs`.

**Consumes:** Task1 helper and richer actual transition records.
**Produces:** unchanged public `validateFunctionalDelivery` signature with narrow declaration exemption; no other tooling exemption. Same evidence contract for staged and historical callers.

- [ ] Add real Git fixture tests `owned declaration same staged commit`, `owned declaration prior approved source`, and `owned declaration full history`. Fixture commits actual approved digest/decision/bound plan before sources. Assert successful staged hook exit and exact ordinary per-commit/range result. Run harness RED at the existing blanket schema-contract denial.
- [ ] Wire the helper for changed declaration paths, retaining global tooling classification and all other guards. Enforce regular mode, exact current-parent digest/plan, exact approved root and every path transition; staged entries come from Git candidate tree rather than worktree reads.
- [ ] Add independently hostile real histories: wrong/stale digest or plan, self/later approval, foreign/existing/copied/unapproved/multi-item source, wrong path/blob/mode/symlink, intervening unauthorized schema/migration edit, deletion/re-addition, bad transition restored to identical endpoint. For each assert staged denial where applicable and per-commit/full-history exact `WR_MIXED_FUNCTIONAL_TOOLING` category/path (ordinary prior approval errors retain their existing category).
- [ ] Add staged-vs-unstaged identity controls; old declaration baseline/security/new-row edit/reorder/version1 denial; mixed MJS denial; mutation-route remove/reorder denial and unchanged CHG088 expansion/copy denial. Retain old technical-owner admission behavior.
- [ ] Run own current harness and integrated-base differential. Perform independent predicate-removal controls for AST absence, approved transition lineage, append-only migration identity and historical traversal; each removal must make its corresponding hostile case fail. Preserve raw outputs/hashes in ignored report workspace, restore every fault before commit.
- [ ] Run focused GREEN, scope/diff check and actual preflight; touched-only preview only if warranted. Commit normally `CHG-105 admit owned finite declaration data`; submit report and complete checkpoint range to controller for spec+quality review. Reassess remaining budget before Task3.

### Approved amendment checkpoint: exact production baseline compatibility

Joint human approval binds readiness digest `18fcf48488de3110ee8baf6110fa66eb19dc645da3e377baa9c423258ff7b60f` and its exact U9 canonical AC3 append. Normal canonical source `163e49e7` and custody commit `2faf34fcaa45e1282ede3ccd698a9b7c4bdcf9a3` delivered that append (SHA256 `94f9abd65b270ecb4505f7c79bdb8180ccaa49480202d1adccd33e68522a0625`) before any fix. This finite amendment supersedes only the design/Task1 literal-only restriction for EXISTING non-target baseline identities; new target remains direct exported pgTable literal. Original f4/4408 and exact66-path source RED are preserved, not retroactively reclassified. Frozen mutation base remains `ef56be580b50964a3fe457d898b99db035f729e5`; complete original interval remains `d2280c4..candidate`. Actual custody is six paths, within the approved maximum eight (maximum14delivery+4bookkeeping=18; actual6technical+6custody+4bookkeeping=16).

**Files:** only existing helper, git.mjs if required for immutable evidence, and existing test-work-readiness harness; no new path/framework/product normalization. Same helper signature and Git snapshots; same consolidated implementer and reused scoped reviewer. Correction/regression/rebinding/scoped review estimated10–15 active minutes from existing phase reserves, not new funding. Remaining original Task3 release proof is unchanged.

- [ ] Record amended approval/canonical/plan pins; independently review this exact plan delta before source fixes.
- [ ] Preserve the existing exact66-path real-Git RED and implement its strongest regression: unchanged production baseline const/call plus direct literal new target must pass real staged/percommit/full-history admission before real release composition.
- [ ] Derive ONLY from immutable authority-BASE AST an inventory of existing non-target direct top-level exported pgTable calls whose first-argument Identifier has exactly one local top-level const DIRECT canonical StringLiteral initializer. Resolve BEFORE target absence. Pin identifier/literal/declaration/direct-call/non-target identity through EVERY historical snapshot, parent and candidate. Existing target resolution rejects; candidate cannot expand allowed inventory.
- [ ] Add failing exact-category/path cases for prior const resolving to target; changed/removed/reintroduced mapping or call restored at endpoints; candidate-only const-table call; duplicate/import collision/shadow/escape/reassign/destructure/let/var/call/import/concat/interpolation/unknown expression; nonliteral NEW target. No alias chain, recursive resolution, symbolic/type/scope engine, evaluation, blanket computed-call skipping or rights/history weakening.
- [ ] Implement only the finite approved rule, observe GREEN, independently remove BASE-derived mapping/identity and EVERY-snapshot preservation guards and prove corresponding hostile oracles fail; restore source exactly.
- [ ] Rebind/rerun own affected real Git harness after helper changes; previous reviewed receipts remain historical, not current-source PASS. Actual preflight/touched preview rules unchanged. Normal green amendment checkpoint, exact report/package and reused scoped review before proceeding into Task3 release composition.

### Task 3: Exact admitted Git source to real release and documented boundary (implementation upper20)

**Files:** `packages/db/src/migration-release.integration.test.ts`, `docs/dev-guide/WORK_READINESS.md`; test fixture support stays within the existing release test.

**Consumes:** Task2 real gate and exact admitted Git object identities; integrated104 production parser/catalog verifier; existing release bundle and sharedPG fixture.
**Produces:** real admitted source/declaration/migration bundle, own baseline/candidate and hostile release evidence; guide replacing blanket functional denial with the exact narrow rule.

- [ ] Add test `owned admitted declaration releases exact committed objects`: actual approved functional Git fixture, actual gate invocation, exact commit extraction/checksums, fresh owner migration and actual production verifier success plus app rights/catalog/ledger/parity assertions. Run RED before composing the new boundary; use existing release helpers and finite extension fixture without a new framework.
- [ ] Implement test-local composition and byte/hash assertions. For baseline and candidate, run real applier/verifier on fresh sharedPG databases and parity over exact admitted schema/migration set. Assert old baseline preserved and relevant app allowed/denied account-reference behavior; do not claim GroupAdmin/company:write authorization.
- [ ] Add `owned wrong-table SQL` and `owned no-table SQL`: assert structural admission succeeds, actual release fails with missing/mismatched catalog diagnostic. Independently fault actual RLS/grants/constraints/ledger/checksum and exact extracted bytes; invoke production verifier, no synthetic PASS and no owned mocks.
- [ ] Run `rtk pnpm --filter @smp/db exec vitest run src/migration-release.integration.test.ts` using official sharedPG environment. Expected GREEN including asserted hostile rejection. Record own baseline differential and removal control that bypassing composition/Git-object binding fails its oracle.
- [ ] Update only WORK_READINESS finite declaration section: exact current-parent/digest/plan/schema/migration history admission; unchanged finite104/security/tooling/CHG088 behavior; structural versus mandatory actual release boundary. Run own readiness harness GREEN for documented contract assertions.
- [ ] Commit normally `CHG-105 prove owned declaration release composition`; submit checkpoint range/report to controller for spec+quality review.

## Own complete assurance and integration handoff

- [ ] Record phase boundaries, actual role/call availability and test generation/execution/analysis costs once. Current readiness21 is separate; no unknown parent cost zeroed. Controller owns reviews; implementer owns bounded fixes and report evidence.
- [ ] Own focused evidence covers AC1 exact admission, AC2 staged/percommit/history hostile and baseline, AC3 actual release composition. Scoped review at each checkpoint and fresh independent adversarial final AC/whole-original-range review cover AC4; final reviewer must be distinct from CHG105 scoped reviewer.
- [ ] Fix reviewed findings in this consolidated session; scoped re-review every fix wave. If any proof gap/new path/framework or forecast>315 emerges, STOP for amendment, never weaken proof or silently transfer cost.
- [ ] After all fixes/reviews acquire owner-aware `/tmp/smp-full-gate.lock`, run own awake uncached `rtk proxy caffeinate -i pnpm check` and required type-check/lint/build/test outcomes. Run own official sharedPG `db:migrate`, `db:verify`, `db:parity` with owner/app roles; record commands, UTC, exits/raw hashes. Never delete a foreign lock.
- [ ] Run actual own preflight for final candidate; resolve/report routing gaps. Ensure an empty own mutation cache using scoped own-key removal only, preserving every foreign shared-cache entry; run own native cold last with frozen entry base after every fix/review. Record actual zero honestly and omit test_report if zero; no invented score. Touched-shard previews <=30minutes with reasons for exceptions.
- [ ] Bind final exact commits/blobs/migration checksums/declaration bytes/raw proof hashes to normal build_pass notes/source_commit and review. Update own actuals/feedback within approved bookkeeping only. Controller/root perform full original d228..candidate custody/protected-guide/cleanliness/ancestry checks and normal FF receipt; moved main requires honest map/review or stop, no reset/autostash/force.

## Plan self-review

Spec coverage checked against canonical source, frozen Outcome A packet and addendum: six technical paths, current immutable approval/history, finite vocabulary, real release stage, hostile differential/removal controls, own complete assurance and cost custody all map to tasks above. No extra path or schema/auth framework required. Task1 and Task2 intentionally share git.mjs/test harness sequentially; Task1 preserves route Set semantics and Task2 consumes its named helper/record shapes unchanged. Task3 consumes only Task2 public gate and immutable Git entries; no hidden production API is introduced. Five review-focus classes each have an explicit owning test step. Three checkpoints independently test helper correctness, actual gate behavior and real release composition; a failing checkpoint cannot be masked by a later task. Builder review is pending; no source/test work has begun.
