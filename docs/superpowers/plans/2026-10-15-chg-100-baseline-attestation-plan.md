**Work item:** CHG-100
**Readiness assessment:** docs/readiness/CHG-100.json
**Approved estimate:** 310 minutes

# CHG-100 implementation plan

Use one consolidated implementer, one reused scoped reviewer, fresh final adversarial reviewer. Standing human approval covers these phases. Spec: docs/superpowers/specs/2026-10-15-chg-100-baseline-attestation-design.md and canonical CHG-100_TECH_SPEC.md9d2c2e57. Goal: actual release declaration attestation and functional denial, preserving verifier authority.

## Global Constraints

- Exactly nine delivery paths in approved readiness; no product schema/migration, grant changes, broader extraction, package scripts or mutation policy edits.
- Literal coreTableNames/ normallyUpdateableTableNames/ expectedAppendOnlyColumnUpdates remain authoritative; specialized verifier checks, derived grants/INSERTexceptions/sort remain verbatim.
- Fixed schema-contract.json canonical version1 declaration; closed identifier/key/encoding/order/duplicate/crossref and exact baseline validation, no executable data.
- Functional edits denied from first introduction in staged and historical percommit/range ownership; CHG088 authority unchanged.
- Read TESTING and org standard before tests. TDD, real process/Git/PG, no mocking our code; report controlled faults and expected rejection oracle.
- Shared PostgreSQL16 fixture and /tmp/smp-full-gate.lock; wait foreignowner, never delete it; awake fullgate; ordinary current-base FF integration only.
- Carry all55estimated sunk minutes once. Hard310approved total; boundary forecast/reassessment before exceeding. Preflight discovers actual mutation applicability; no invented score. Preview<=30min touched shards; final cold last. Record all real process walls/costs and phase UTC markers.

## Review Focus

- Escaped duplicate keys reject before JSON.parse loss: task1 parser category oracle.
- Valid JSON reordered/valuechanged declaration fails actual release attestation: task1 realprocess then task3 realDB oracle.
- Functional initial addition cannot hide behind later technical/range commit: task2 historical fixture.
- Moved worktree/cwd cannot change declaration identity: task1 fixed module-relative path + realprocess oracle.
- Security check loss cannot hide behind a happy baseline: task3 preserved source segments and existing hostile realDB release suite.

### Task 1: Make actual db:verify attest the closed baseline

Files: create packages/db/schema-contract.json, packages/db/scripts/schema-contract-policy.mjs, scripts/test-schema-contract.mjs; modify packages/db/scripts/verify-schema.mjs. Production sources=the two MJS files plus JSON.
Interfaces: parseSchemaContract(bytes,path) returns closed declaration or categorized Error; attestSchemaContract(candidate,baseline) validates ordered equality or throws. No external consumers yet.
- [ ] Capture real existing verifier baseline source/result under shared owner/app fixture; preserve raw commands/results outside tracked deliverypaths.
- [ ] Write failing tests for exact valid33table roundtrip; malformed/BOM/duplicate decoded keys/wrong keys/version/types/identifier/duplicatepair/crossref/noncanonical/order/mismatch and fixedpath process failure. Assert categories/path and successful verifier never reached for invaliddeclaration. Run node scripts/test-schema-contract.mjs RED for missing behavior.
- [ ] Implement minimal helper, canonical JSON and fixedpath attestation call. Preserve literal arrays and specialized verifier source segments.
- [ ] Run same harness GREEN; inject removed attestation and changed baseline controlled faults to prove real process oracle fails, restore exact source. Focusedgreen checkpoint commit CHG-100. Discover actual preflight; preview only eligible touched shards in background if any. Reused scoped review before task2.

### Task 2: Deny functional contract edits from first introduction

Files: scripts/work-readiness/delivery-policy.mjs, scripts/work-readiness/git.mjs, scripts/test-work-readiness.mjs, docs/dev-guide/WORK_READINESS.md. Consumes fixed contract path; produces ordinary technical ownership for exact path.
- [ ] Write real Git fixture tests for staged and committed functional initialadd/edit/delete/mode/symlink/mixed change and safeJSON negative; historical functional commit followed by technical commit cannot launder range. Valid technical ready+plan authority accepts; existing CHG088 tests preserve exact behavior. Run node scripts/test-work-readiness.mjs RED at intended assertion before changes.
- [ ] Implement minimal classification and ownership checks, document denial; no additive admission.
- [ ] Run harness GREEN, task1 harness regression, controlled authority guard bypass RED/restoredGREEN. Green checkpoint commit CHG-100. Actual touched preflight/preview if applicable; reused scoped reviewer exact taskdiff + commands.

### Task 3: Prove release preservation and complete delivery

Files: packages/db/src/migration-release.integration.test.ts; only repairs to earlier eightpaths as findings require. Consumes actual runtime/helper + governance.
- [ ] Pin tests to real old/current executable baseline under same fixture: expected ordered grant tuples, catalog results/diagnostics exact; missing/unsafe/nonidentical declaration rejects before verifier success. Inject actual lostattestation/valuechange faults RED, restore GREEN. Existing hostile RLS/constraint/function/trigger/security suite proves unchanged checks.
- [ ] Run focused node harnesses and pnpm --filter @smp/db exec vitest run src/migration-release.integration.test.ts under shared PG16. Run fresh db:migrate, db:verify, db:parity with owner/app and committed migrations. Record exact candidate and output. Green taskcheckpoint, reused scoped review.
- [ ] Independent fresh adversarial AC1-4 review with complete diff, reports and named oracles; fix one combined wave if required; scoped re-review and affected checks, within scope/budget.
- [ ] Acquire sharedlock normally, run caffeinate -i pnpm check; release only ownedlock in finally. Preserve inherited failures by name, do not waive. Ordinary staged/percommit/range/feedback checks must pass.
- [ ] Run actual final preflight and one ordinary awake cold campaign LAST against frozenapprovedbase. Zeroeligible result is applicability evidence, no fake score. Any resulting source/test delta invalidates relevant proof; stop/reassess if budget cannot retain required gate.
- [ ] Closure test_report/actuals/done as supported with real costs; integration main only if normalFF and workingtree custody permits, otherwise report Francisco. No parent story closure or sibling takeover.
