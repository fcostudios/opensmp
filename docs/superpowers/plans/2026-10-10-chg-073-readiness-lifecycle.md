**Work item:** CHG-073
**Readiness assessment:** docs/readiness/CHG-073.json
**Approved estimate:** 270 minutes

# CHG-073 implementation plan

**Goal:** Make CHG-070 and US-072 readiness and the feedback-order checker pass after one constrained append-only historical-start correction.

**Architecture:** Delivered vocabulary classes govern annotation bookkeeping. A pure correction validator returns only validated start indices, without changing lifecycle projection or approvals. The checker retains lifecycle ordering and checks execution timestamps per story.

**Tech stack:** Node ESM, built-in assertion/process/file APIs, existing readiness CLI and fixtures, Nous config/emitter, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-10-chg-073-readiness-lifecycle-design.md`, approved at `1b67cb7`, recorded in `1bed4b3`. Readiness approved in `650ad83`, digest `25e58287f072d56e42300f4b3bcad9afad8b4d5275580e9e64e7e9daed2f9a9e`.

## Execution constraints

- Use the current managed worktree and `feature/readiness/chg-073-lifecycle-correction`; never the primary checkout or a nested worktree. Every shell command begins with `rtk`.
- Obtain explicit approval of this committed plan before changing tooling/tests or tenant config. Read `TESTING.md` and `TEST_EFFECTIVENESS_STANDARD.md` before test edits; use the real model/checker, not owned-code mocks.
- One implementer receives Tasks 1–3 together and commits each task; a reused scoped reviewer receives the ACs, exact diff and commands at each boundary. The controller briefs and reviews, without implementing. A fresh adversarial reviewer verifies final ACs.
- Scope: CHG-073 items 1–4. No US-072 product changes, experiment work, changes to approval meaning, bootstrap exemption, `isProjectableEvent`, or digest binding. Additional findings are deviations or named deferred hardening in closure, never another work item or readiness blocker.
- Preserve every historical feedback byte. Append exactly one correction targeting CHG-070's original `started` at `2026-10-07T03:44:39Z`; never predate an approval or rewrite a timestamp.
- Establish `authority/chg-073-base` at the committed plan-approval head before implementation. Use this immutable ref for diff routing and counts. Freeze US-072's later authority base only in its original controller after repair delivery and entry approvals.
- The expected scope is 17 files and zero mutation shards. Discover actual shard IDs after each committed task; preview intersecting shards only, in background, at most one round per task plus one final round and 30 minutes. Zero intersections mean zero previews; do not fabricate mutation scores.
- At each task boundary, if remaining work is judged to exceed 270 minutes, record a `deviation` before continuing. Do not expand into unrelated hardening.

## Task 1 — deliver vocabulary registration and consistent annotation recognition

**Production sources:** `scripts/work-readiness/model.mjs`, `scripts/work-readiness/git.mjs`, emitted `docs/dev-guide/feedback-vocabulary.json`.
**Fixtures:** `scripts/test-work-readiness.mjs`.
**External state:** only `fcostudios__smp` tenant config key `feedback.local_events`, preserving its existing array.
**Documentation/evidence:** `.nous-feedback.jsonl`; existing generated ownership metadata only when emitted delivery changes it. No application files.

**Interfaces:** export `DELIVERED_LOCAL_EVENTS: Set<string>` and `DELIVERED_ANNOTATION_EVENTS: Set<string>` from the model alongside existing `DELIVERED_CANONICAL_EVENTS`. Both model known-event validation and Git feedback structure validation consume canonical and registered local names. `isPreapprovalAnnotation(event)` excludes explicit `build_pass`, `ac_verify`, `test_report` from the annotation exemption. Postapproval handling keeps its prior rules.

1. Read the authority spec, approved readiness and canonical ledger; record the implementation phase and baseline status. Install dependencies with `rtk pnpm install --frozen-lockfile`, without changing the lockfile. Save the immutable original ledger bytes/hash from `4780ae1` in the verification workspace.
2. Add exact behavioral fixtures using the existing `normal()`, `decisionFor()`, `test()` and `expectError()` harness:

   ```js
   const value = normal();
   assert.equal(validateApproval(value, [
     { story: value.work_id, event: "phase", phase: "readiness" },
     decisionFor(value),
   ]).active, true);
   expectError("WR_APPROVAL_ORDER", "$.approval.evidence", () =>
     validateApproval(value, [
       { story: value.work_id, event: "build_pass", notes: "premature" },
       decisionFor(value),
     ]));
   ```

   Also pin `ac_verify` and `test_report` as preapproval evidence; pin decision digest and postapproval revocation behavior with existing fixtures. Run `rtk pnpm test:work-readiness` and retain the failing new phase oracle as RED.
3. Read tenant config through `nous_trace.py config show --project fcostudios__smp`. Preserve existing `feedback.local_events` and patch its union with `lifecycle_corrected` through `config patch --key feedback.local_events --value '<JSON array>'`. Use structured/file arguments or safe shell quoting, never interpolate secrets or unrestricted config output into shell code. Record the exact config version before/after.
4. Obtain feedback-vocabulary bytes through the existing Nous dev-guide emitter/sync, with this worktree as target; read its CLI help to select the supported category. Verify `_project_local_events` and `classify_event` both recognize the one registered name as a local annotation without pulling unrelated lifecycle state. Carry generated bytes and required metadata, never manually edit the vocabulary. Inspect every changed path; restore only an unsolicited `testing/critical-paths.md` change. If a path actually requires an immutable overlay, register exact source/desired bytes in a prior commit using the existing ownership seam; do not widen the gate or change old manifests.
5. Derive the annotation sets from `Object.entries(DELIVERED_VOCABULARY.canonical).filter(([, category]) => category === "annotation")` plus `DELIVERED_VOCABULARY.local`. Replace the preapproval two-name literal with classification, retaining explicit evidence/decision guards. Keep the prior postapproval two-event exemption semantically unchanged, with a separate descriptive name if needed. Extend Git's known-event set from the exported local set.
6. Run focused readiness fixtures, generated-guidance checking and staged ownership. Commit with CHG-073 traceability. Run preflight against `authority/chg-073-base`; preview only intersecting sources in background. Brief the reused reviewer for AC2 annotation/evidence behavior and registration/ownership; fold real findings into the next task.

## Task 2 — constrained lifecycle correction and visible readiness reporting

**Production sources:** `scripts/work-readiness/model.mjs`, `scripts/work-readiness.mjs`.
**Fixtures/docs:** `scripts/test-work-readiness.mjs`, `docs/dev-guide/WORK_READINESS.md` §Approval evidence.

**Interface:** `validateLifecycleCorrections(records, workId): { correctedStartIndices: Set<number>, correctedStarts: number }`. The model validates each correction for its story before using the exemption; `validateApproval` and `validateAssessment` expose `correctedStarts` as additive result data. The checker consumes this helper in Task 3. The readiness CLI uses the count in its existing summary envelope.

1. Add a deterministic fixture with one raw start, one later `decisionFor(value)` carrying an explicit UTC timestamp, and the closed correction record. Its timestamp follows approval. Assert active readiness and exactly one corrected start. Add the canonical negative cases: evidence (`build_pass`) between start/approval, absent `approved_by`, and foreign story. Also assert rejection of missing/duplicate target, repeated correction, wrong disposition/event and invalid timestamps; exact rejection is `WR_CORRECTION_INVALID`.
2. Run `rtk pnpm test:work-readiness` to establish RED. Do not change the real ledger yet.
3. Implement the helper with the existing strict-object, timestamp and prior-decision validators. Match a single earlier raw start using literal story/event/target timestamp; find the first valid digest-bound ready decision for that story. Require target-before-approval, correction-after-approval, valid chronology and no raw evidence between target/first approval. Reject duplicate correction targets. Never mutate records or terminal projections.
4. Integrate before approval history scanning; skip only the validated indices in preapproval. Preserve bootstrap, projection and digest-binding code. Return the count through approval/assessment; adapt `validateOne` without breaking callers needing its artifact and append `; 1 corrected start` (pluralized for counts) only when nonzero in `checkAssessment`.
5. Document the annotation/evidence precedence, exact correction shape and constraints, append-only history, non-authorization and reporting under Approval evidence. Test CLI plain/JSON reporting against a temporary real fixture; assert unchanged summaries for uncorrected items.
6. Run focused fixtures; commit the task and collect prior reviewer findings. Run touched-source preflight/preview routing and review this task's AC1/AC2 contracts. The single real correction remains withheld until Task 3 can accept its registered annotation.

## Task 3 — checker annotation handling and per-story execution chronology

**Production source:** `scripts/check-nous-feedback-order.mjs`.
**Fixture source:** `scripts/test-feedback-order.mjs`.
**Shared input:** emitted vocabulary and `validateLifecycleCorrections` from Tasks 1–2.
**Evidence:** `.nous-feedback.jsonl`, including the single CHG-070 correction only after focused fixtures pass.

1. Keep the current 18 historical failure lines as the immutable RED oracle. Add exact checker-process fixtures:

   ```js
   run("feedback before started passes", [
     { story: "US-900", event: "feedback", title: "Assessment", description: "Bookkeeping", images: [] },
     { story: "US-900", event: "started", agent: "test" },
   ], 0);
   run("build before started fails", [
     { story: "US-900", event: "build_pass", notes: "premature" },
   ], 1);
   run("done before build fails", [
     { story: "US-900", event: "started", agent: "test" },
     { story: "US-900", event: "done" },
   ], 1);
   ```

   Replace the obsolete assertion that annotation `ac_pass` before start must fail with the canonical build fixture. Change the existing execution-time regression oracle from annotation `ac_verify` to `build_pass`; retain same-story regression rejection. Add a two-story interleaving oracle preserving each story's start/build chronology and an annotation timestamp regression acceptance oracle.
2. Run `rtk pnpm test:feedback-order:fixtures` and `rtk pnpm test:feedback-order`; retain new fixture and historical RED failures.
3. Build `annotationEvents` from emitted annotation classes and local names beside `terminalEvents`; include local names in parsing known events. Keep all field validation. Validate correction entries per affected story with the real shared helper, reporting its stable error code if invalid. After projection, skip annotation records for lifecycle ordering and execution timestamp state; preserve the existing decision explanatory branch. Store execution `previousTimestamp` per story. Keep duplicate start, build-before-start and terminal-before-build guards.
4. Append a deviation describing the narrow global-to-story timestamp-clock change necessary to clear parallel historical records; all timestamps remain original. Run checker fixtures/current ledger and the same candidate checker against a temporary directory containing `main`'s ledger and required readiness files; never modify main's checkout. Assert zero violations on both ledgers.
5. After focused fixtures pass, append exactly one correction using the approved shape, actual UTC append time and Francisco's approval identity. The reason states the original start was controller readiness bookkeeping and had no evidence before first ready approval. Byte-compare the entire original `4780ae1` ledger prefix; assert exactly one correction and the literal target timestamp.
6. Run both real readiness checks and checker again; CHG-070 summary must include `1 corrected start`, US-072 remains valid. Run all readiness fixtures/artifacts. Commit Task 3, route touched previews and brief scoped review. Resolve findings within scope, merge the last preview with the final round when possible, and collect all review results before final verification.

## Task 4 — final verification, evidence and delivery handoff

**No new production sources.** This task reviews the committed implementation, records actuals/evidence and does not deliver or resume another task itself.

1. Brief a fresh adversarial reviewer with AC1–AC3, the approved spec/plan, `authority/chg-073-base..HEAD` and focused commands. Require attempts to break correction binding/evidence/foreign-story restrictions, annotation versus evidence semantics, bootstrap/projection/digest invariance, checker lifecycle/chronology and the immutable historical prefix. Controller records verdicts as one `ac_verify` per AC; repair findings before final gates.
2. Run required focused suites: `rtk pnpm test:work-readiness`, `rtk pnpm readiness:check:all`, `rtk pnpm readiness:check -- CHG-070`, `rtk pnpm readiness:check -- US-072`, `rtk pnpm test:feedback-order:fixtures`, `rtk pnpm test:feedback-order`, candidate-checker/main-ledger verification, `rtk pnpm check:generated-guidance`, and range ownership against the appropriate preimplementation authority. Keep repair changes separate from scope-sync/docs approval commits when computing the implementation diff.
3. Run `rtk proxy caffeinate -i pnpm check` once on the final reviewed tree under an exclusive `/tmp/smp-full-gate.lock`. Create the lock atomically and hold it through the process; if occupied, wait without overlapping gates. Use `try/finally` cleanup in a temporary external runner, forward exit status and capture wall time. No 1-second polling. Repeat only after repairs or a concrete gate failure, recording causes and any time above twice the last-five-run median. Complete applicable committed-migration verification using existing declared database environment; no schema or migration changes.
4. Run final diff preflight against the frozen authority base; retain zero-shard routing evidence when zero is observed. If shards actually intersect, complete the required scoped previews and one authoritative cold campaign last, after all fixes and reviews; no implementation changes afterward. Do not emit `test_report` for zero shards. Record unexpected findings as deviations/deferred hardening under the approved last-tooling rule; never claim a failed required gate is green.
5. Populate digest-excluded readiness actuals with nonoverlapping phase minutes, file/commit counts, review-fix loops, cold attempts/invalidations, preview minutes/rounds, variance and provenance. Keep this repair's costs separate from CHG-070/US-072; say which metrics are measured and which are estimated in feedback immediately before `done`. Include required `cost` keys and a committed source reference. Commit closure evidence together only after required gates and AC evidence. Recheck readiness artifacts/ownership on the evidence tree.
6. Tell Francisco the actual outcomes of both readiness checks and checker, the commit to deliver, byte-preservation and any named deferred hardening. Nous delivers CHG-073. The original controller then resumes its approved US-072 plan with one implementer and its existing reviewer, freezing its mutation base after the correction and entry approvals. Do not message another task without explicit human authorization.

## Plan review

Items 1–3 map to Tasks 1–2; item 4 and all 18 historical lines map to Task 3.
AC1 maps to Tasks 2–4; AC2 to Tasks 1–2 and adversarial review; AC3 to Task 3
and final gates. Registration, generated ownership, protected guards and reporting
are explicit. No production work is authorized by this plan until Francisco
approves its committed bytes. The 30-minute checker addition is included in the
approved 270-minute phase total. Execution uses the existing managed worktree
and a bounded implementer brief, not a new execution-choice menu.
