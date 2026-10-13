**Work item:** CHG-094
**Readiness assessment:** docs/readiness/CHG-094.json
**Approved estimate:** 295 minutes

# CHG-094 Historical Owned Mutation Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development under the already supplied consolidated shape: one implementer, one reused scoped reviewer, fresh final AC reviewer. No execution before readiness approval.

**Goal:** Approval-bound historical diff runs on the current real runtime, with unchanged legacy behavior.
**Architecture:** Shared pure scope resolver plus committed authority adapter; both runner modes reuse current routing/runtime fingerprinting. Optional provenance separates scope and execution identity.
**Tech Stack:** Existing Node/Git/Vitest/Stryker/sharedPostgres; no dependencies.
**Spec:** docs/superpowers/specs/2026-10-13-CHG-094-owned-mutation-scope.md and canonical Nous200c6427.

## Global constraints

Nine listed delivery files plus four bookkeeping.295 minutes. No product/routing/threshold/waiver/generated-guide/US087 actuals or093 draft edits. New mode derives complete historical ranges; no synthetic ancestry, user ranges, line remap or old-score reuse. Default mode unchanged. Full gate/capability smoke use shared fixture/lock/awake. Standing preparation is not an execution approval.

## Review focus

Committed authority instead of flag; complete source/range ownership; current runtime fingerprint changes; readonly planning without expensive side effects; provenance preservation/legacy parity. Each pinned by tests below.

### Task 1: Contract and committed authority (35 implementation minutes)

Files: model.mjs, work-readiness.schema.json, git.mjs, new owned-scope.mjs, test-work-readiness.mjs.
Interfaces: model validateOwnedScopeShape(value) validates closed scope; git loadCommittedReadinessAuthority({root,revision,workId}) yields independently validated committed artifact/digest/decision bytes; owned loadApprovedOwnedScope({root,governingWorkId,subjectWorkId,executionHead}) returns approved scope/governing/subject digests.
- [ ] Recheck branch/code/source; prepare isolated094 checkout off fixedmain and record approved digest, start and mutation base after authorityGREEN.
- [ ] RED real-Git authority fixture: absent optional hashes unchanged; supplied scope hash-bound; pending/stale/uncommitted/cross-subject/invalid nested keys reject.
- [ ] Add optional schema/model parity and bounded committed loader, using existing validation context; preserve complete subject valid without reactivation.
- [ ] Run existing work-readiness suite; scoped review; checkpoint with CHG094 message and normal hooks.

### Task 2: Pure historical scope and safe planning (45 implementation minutes)

Files: owned-scope.mjs, mutation-scope.mjs, test-mutation-scope.mjs.
Interfaces: resolveOwnedMutationScope({root,authority,executionHead}, parserPorts) returns changedPaths/targets/hunks/ownedScope/current snapshot; ports are actual existing diff parsers. planOwnedMutationScope({root,governingWorkId}) returns authoritative:false/counts/scopeDigest with no side effects.
- [ ] RED A→B→C fixture: target already has B owned blobs, unrelated source/shared runtime changed; old merge-base omits owned targets, new mode derives complete historical approved diff.
- [ ] RED full rejection matrix and --planned-owned-scope pending success versus execution refusal; assert no files/DB/children/events emitted by planning.
- [ ] Implement common resolver for preflight/campaign, exact Git blobs/ancestry/path modes, current owned byte equality and responsible routes, governing expected count, exclusiveenv/args/cachebypass.
- [ ] Run mutation-scope Node suite and default differential/envrestoration tests; reused review; checkpoint.

### Task 3: Provenance, current runtime and complete delivery (30 implementation minutes)

Files: mutation-scope.mjs, performance.mjs, test-mutation-evidence.mjs, test-mutation-scope.mjs;094bookkeeping.
Interfaces: validateOwnedScopeProvenance(value) recomputes closed digest/ranges without Git; authoritative runner also verifies governing binding. assertOwnedExecutionUnchanged(snapshot) executes before authoritative success/publication. Performance preserves optional validated object.
- [ ] RED provenance roundtrip/tamper/truncation/default identity; same scope with changed current schema/runtime must produce changed evidence identity. Mid-run drift rejects.
- [ ] Wire identical preflight/manifest/performance scope/ranges and actual current head. Do not strip unknown fields or synthesize approvals.
- [ ] Run focused three Node suites; one real shared-DB capability smoke using fixture-owned observation source and exact grants/tenant oracles, actual runner/Stryker not an executor mock. Record failure costs and owned report provenance.
- [ ] Fresh independent canonical AC1–4 review; all bounded fixes committed before final normal gates.
- [ ] Own lock with awake UTC profile: full pnpm check; stock own diff preflight/final native command (honest zero TS eligible); no US087 campaign. Capture migration/schema/app-grant and cleanup. Reassess rather than repair outside scope.
- [ ] Record actuals, test evidence and nonzero estimated/measured done.cost, preview rounds/minutes (no fabricated historical cost transfer); close094 with ordinary readiness/range/guidance guards. Integrate onlyFF or report actual advancement.
- [ ] Return094 capability and readonly planning command to093 controller;093 artifacts remain unchanged until its separately authorized reassessment.

## Self-review

Canonical AC1 historical exact scope→Task2; AC2 authority/rejection→Tasks1–2; AC3 real runtime/provenance/legacy→Task3; AC4 planning/handoff→Tasks2–3. Complete final ranges and governing expected count included. Scope does not require a new BR/product story/route. No material implementation blocker identified; execution readiness waits for concrete digest-bound approval only.
