**Work item:** CHG-103
**Readiness assessment:** docs/readiness/CHG-103.json
**Approved estimate:** 310 minutes

# Canonical managed decision custody implementation plan

Spec: docs/superpowers/specs/CHG-103-design.md and canonical CHG-103_TECH_SPEC.md @f4971779. One consolidated implementer, one reused scoped reviewer, fresh adversarial final reviewer. Preserve original073/31b/CHG100mutationbase24fe and immutable history. All shell commands start rtk; no production edit before this bound plan is committed and builder check passes.

## Global constraints

Exactly scripts/work-readiness/git.mjs, scripts/test-work-readiness.mjs, docs/dev-guide/WORK_READINESS.md may change technically. Six normal custody paths already committedfc6620d count toward nine; four approved bookkeeping paths only. No timestamp/co-change/replay change, issuer edit, generic exception, migration, runtime feature or new work item. Read TESTING before test edits. Preserve all checks, CHG088 exact exception, CHG100 functional-edit denial and original failed evidence. No test mocks of owned code; real temporary Git and real database where applicable.

## Review focus

- Correct category with forged hash still rejects; independent guard control.
- Correct category with same unmodified manifest claim cannot replay a delivery.
- Normal clean source identity does not authorize wrong project, path or mode.
- Staged and multi-commit history cannot borrow later approval or hide mixed edits.
- New validator may reinterpret category but cannot backfill original parent authority.

### Task 1: exact managed decision admission and real Git controls

Files: scripts/work-readiness/git.mjs; scripts/test-work-readiness.mjs; docs/dev-guide/WORK_READINESS.md. Interface: existing validateRangeOwnership and staged CLI paths remain unchanged; exactNousSyncOwns recognizes docs/decisions/ in its existing route.

- [ ] Add focused real temporary Git first/changed/unchanged decision-delivery positive assertions through staged/per-commit/full-history paths. Observe RED before category change, specific WR_GENERATED_NOUS_PATH/ownership failure rather than unrelated setup failure.
- [ ] Add independent hostile claim/hash/source/path/mode/symlink/dirty/incomplete/replayed/wrong-project/self-approval assertions using existing fixtures. Reuse existing independent controls when they already prove the identical predicate; no shallow duplicate spraying. Record exact mapped fault/oracle and guard-removal proof.
- [ ] Apply only missing managed category recognition, align guide with DEC-SMP-050 historical scope. No predicate weakening beyond category.
- [ ] Run node scripts/test-work-readiness.mjs, independent controls and affected differential baseline; exact original073 and full31b-to-ba43 plus composed history. Name governed validator revision and dated result. If independent original-parent gap appears STOP, no exception.
- [ ] Commit focused-green task with CHG-103; send scoped reviewer full diff+ACs+commands; fix within scope then re-review. Record preflight discovered shards; only applicable touched preview, <=30minutes.

### Task 2: independent verification, own gates and closure

Files: approved bookkeeping only unless scoped/fresh review requires Task1 fixes in same three technical paths. Consume Task1 real receipts.

- [ ] Reused scoped reviewer verifies exact semantics and fault-control evidence; fresh adversarial reviewer verifies AC1canonical delivery/AC2protected guards/AC3original-history proof/AC4guide and own evidence. Controller records verdicts only after actual reports.
- [ ] Same implementer runs own uncached caffeinate -i pnpm check, holding /tmp/smp-full-gate.lock throughout without deleting foreign lock; use sharedPG16fixture (no private containers), migrate/verify/parity where applicable. Setup with frozen lock only. Preserve foreign work and no shared runtime interference.
- [ ] Run own ordinary staged gate and original073-parent..073, original31b..ba43, original31b..fullcandidate checks under named governed revision, plus childrange and feedback-order checks. Preserve raw old failure. A shortened or convention-only PASS is insufficient.
- [ ] After all final fixes/reviews/fullgate, run cache-cleared authoritative own caffeinate -i pnpm test:mutation with actual postapproval mutationbase; discover zero rather than invent score. Record attempts/previews. No source edits after final cold.
- [ ] Record actuals, test_report, phase markers and real nonzero estimated/measured cost with implementer/reviewer session lines; commit ordinary closure if all own evidence passes. CHG100 terminal is separate. Main FF only after full composed proof and rootcoordination ensures original approved CHG100 own closure, no foreign staged changes. If moved, stop for safe owner coordination rather than force/reset.

## Self-review and task interfaces

Task1 produces corrected validator and unchanged interface consumed by Task2; both share technical paths only for review fixes. Task1 tests and code require same category, documentation preserves same semantics. Task2 depends on Task1 green and does not create a new contract. All canonical ACs map above; original historical evidence is explicitly part ofTask1/2 rather than omitted debt. No task authorizes a later approval to cure original missing authority.

## Explicit byte-limit waiver amendment

Francisco directly instructed: "Waiver from Francisco to overcome the byte limit received, proceed" (relayed by root controller). This authorizes only the observed1MiB reader-cap accommodation in the already-owned git.mjs. Raise its bounded output ceiling to2MiB, preserve full raw ledger/history and ordinary rejection beyond the new ceiling; do not truncate, split, skip, rewrite, alter timestamps, bypass hooks or claim CHG097 integrated. Original failure51996a2 with staged ledger1049041bytes is retained in /tmp/chg103-ledger-cap-blocker.json. This amendment is within the same nine-path inventory and310-minute ceiling; expected additional implementation/focused allowance10minutes is absorbed in approved remaining270, not new funding.

Entry sequence for independent review: the implementer changes only the waived local reader ceiling, then uses the normal ordinary hook to commit this approved design/plan and legitimate postapproval ledger records (technical source remains unstaged). The subsequent implementation commit includes the cap change and category correction only after its bound plan exists in the immutable parent. The normal hook executes the actual working-tree validator as it ordinarily does; no skip or replacement hook. Tests must prove a real full ledger above old1MiB is accepted under otherwisevalid immutable authority and a child Git output above2MiB still fails closed, plus all category/provenance/approval guards. If the independent builder finds this normal sequence invalid, report the exact guard rather than infer another waiver.
