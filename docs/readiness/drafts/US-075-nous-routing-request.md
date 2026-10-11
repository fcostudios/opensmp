# US-075 — canonical responsible-route amendment request

## Current request after CHG-079/080 verification (2026-10-11)

The historical request below is superseded by this section. CHG-079's service route and pin are implemented (`cce85d4`, `2be5283`); CHG-080's publication and pin are implemented (`d9d5d48`, `5fe2ee7`). Their full-gate closure is pending, not claimed delivered/dev_done. The shared gate failed on the older offboarding alert fixture: US-075's required assignment-pointer guard rejects a seed without `license_assignment_id`; the same fixture still expects `kind = checklist` instead of canonical `remove`.

Please canonically amend the accepted technical routing prerequisite CHG-079, or allocate its technical successor if required by ledger policy, to register this responsible suite:

```js
"packages/domain/src/request-workflow/lifecycle.ts": [
  "apps/web/src/modules/request-workflow/orchestration.integration.test.ts",
],
```

Tenant work is the same bounded registration shape: the direct-route entry in `scripts/mutation-scope.mjs`, exact direct-route assertion and real-file `routedTestFiles` assertion in `scripts/test-mutation-scope.mjs`, and verification that the domain source's shard selects and executes the actual real-DB suite. No threshold, instrumentation, routing-gap rejection, template, owned-service mock or exemption change. Existing adjacent domain tests remain routed as usual. US-075 will add direct `finalizeOffboarding` behavioral oracles and real transaction-adapter oracles to the existing orchestration integration suite; registration alone does not claim feature delivery. If the stock runner cannot execute the cross-package suite, stop and return that evidence rather than change harness behavior.

The current valid composition has **21 inclusive US-075 paths**, including all already changed paperwork and the newly necessary alert fixture. With this route, keep `lifecycle.test.ts` unchanged and move its proposed new finalizer oracles into the existing real-DB orchestration suite: **20 paths**. The exact conditional inventory is:

| Surface | Paths |
|---|---:|
| Domain `lifecycle.ts` | 1 |
| Org registry `repository.ts`, `repository.integration.test.ts`, `people-action-service.ts` | 3 |
| Request workflow `orchestration.ts`, `orchestration.integration.test.ts`, `actions/checklist-action-transaction.ts`, `actions/checklist-action-transaction.test.ts` | 4 |
| Alerts `offboarding-workflow.integration.test.ts` | 1 |
| Person offboarding component and its behavioral test | 2 |
| Request record component and its behavioral test | 2 |
| Both locale files | 2 |
| Existing readiness, design, plan, routing request and feedback ledger | 5 |
| **Total** | **20** |

The fixture correction keeps the same-business-day alert oracle intact: bind the request to its real assignment and expect `remove`. It does not implement US-077. The checklist transaction wrapper and its oracle remain necessary because its unconditional `withAudit` currently duplicates successful replay audits; orchestration facts alone cannot fix this. The portable finalizer remains in the domain package for US-082. Both detail pages remain unchanged. No parent AC, child scope or oracle is dropped. This is a concrete composition, not proof that all alternatives require 21 paths, and **no functional repartition is requested**.

Independent whole-item forecasts are 310 and 315 minutes. Use the conservative **315-minute** forecast: readiness/design/planning 40; production and all test authoring 150 (including completed Task 1 and fixture correction); focused verification/previews 45; all scoped/adversarial review and bounded repairs 45; shared-fixture setup, full gate, one cold campaign and integration 35. These disjoint forecasts count Task 1 once and do not add duplicate review or gate allowances. Confidence is moderate-low; only five minutes of headroom remain, with a plausible 295–335 range. Any new path, boundary or forecast above 320 requires reassessment; the upper range is not authorized. Technical registration cost is separately assessed under its canonical item.

The stock `createPostgresFixture()` under CHG-067's shared cluster returns `ownerUrl`, `appUrl` and `migrate()`. Use an untracked scratch launcher to supply that migrated pair privately to the existing preflight and clean up only its owned fixture. No user credentials, private container, new harness or repository path is needed. Do not repeat the prior claim that a user-supplied profile is the only solution. Schema/runtime verification must actually pass before reporting runtime evidence.

Please state the bounded integration order: focused responsible-route and runtime evidence → US-075's revised digest approval → fixture repair and functional execution → one coordinated green full gate and each item's own closure evidence. CHG-079/080 remain pending until their required evidence passes; do not waive the failed gate or falsely mark them done merely to unlock this sequence. After sync, inspect both generated testing files, validate ownership, reassess US-075 and obtain its new digest-bound approval before implementation resumes.

**Audit correction after Francisco's challenge: do not act on the previous functional repartition proposal yet.** The 335-minute total and the claim that 24 delivery paths is a global minimum are withdrawn. Those figures described one plan plus speculative allowances; they did not establish unavoidable time/file limits for every valid design.

## What is established

- Canonical authority remains CHG-076/078 at 0e56c7f. Standing authorization70826e1 covers only an approved readiness digest/scope/budget.
- Valid partial Task1 checkpoints5a3f7e4/4b924d7 remain:13real-DB tests, web/domain type checks and accountability preflight pass. No preview/coldcampaign/dev_done claimed.
- Actual mutation shards select conventional adjacent tests or explicit DIRECT_TEST_ROUTES. Importing another suite does not establish a source's responsible route.
- The chosen original plan requires six additional changed oracle paths: people-action-service.test.ts; domain lifecycle.test.ts; web service.integration.test.ts; checklist-action-transaction.test.ts; person page.test.tsx; request page.test.ts. That plan is24deliverypaths/25includingthisrequest. This is a plan-specific count, not a mathematical lower bound.
- Changing the protected request page triggers its exact-source classifier. A design preserving page bytes avoids that policy boundary; no local hash replacement, exemption or tooling patch is authorized.

## Corrected estimation

The original280-minute forecast already included55focused-verification and55review minutes. Routing the same obligations differently does not justify automatically adding55more minutes. The original forecast is restored only as an unvalidated baseline; remaining work must be re-estimated after a concrete smaller design is selected.

Observed execution start16:21:39UTC through fix checkpoint16:33:55 is approximately12m15elapsed. It is not total active labor, terminal actuals, or measured remaining cost. No time-based partition requirement is presently proven.

## Smaller design candidates

1. Put the caller-owned SQL finalization adapter in existing orchestration.ts and its responsible integration suite, rather than transition-core.ts plus its separately routed service suite: two fewer changed paths.
2. Compose request-detail removal inside existing RequestRecord and its adjacent behavioral test. Its existing props include person/request identity, admin status and locale; preserve request-page bytes. Server authorization and actual binding oracles remain mandatory.

Together these yield a22-delivery-path candidate. A valid20-or-fewer-path design has not yet been demonstrated, nor proved impossible. These are assessment candidates, not approved implementation changes. Do not drop independent oracles, add import-only test relays, group scopes deceptively, or patch routing to force a pass.

## Next

Hold the prior anchored-entry/checklist-completion allocation proposal while the controller validates minimal production composition, exact responsible routes and a bottom-up remaining estimate. If a hard limit still fails after that assessment, submit the evidenced canonical repartition request; Nous alone mints IDs and reconciles dependencies. No new IDs or allocation are requested by this corrected note.

Pending blocked readiness digest:6cfa0fcbbf036036efee3595408def3298d7f400bb22a6b6f0e0f0b0e1f44a8c. Further implementation remains stopped. Parent approval and historical child approvals are preserved, not replayed as authority for a changed digest.

All existing ownership remains:US-082providerexecution;US-081/085capacityfreshness;US-076departure;US-077overdue;US-028approvalconsumer;US-068/069invitation-onlyremoval. The persisted US-025 descriptor remains the in-scope execution-selection seam. Provider ReadonlySet/ESNext compatibility remains named deferred hardening, not a new local work item.

## Validated smaller composition and canonical routing prerequisite

The reused scoped reviewer validated a concrete 20-delivery-path composition on 2026-10-11. Including this already changed request document makes **21**, so it cannot execute within the 20-path hard limit as it stands. This is a concrete candidate, not a proof that every possible composition exceeds the limit.

Both detail pages stay byte-identical. Existing `startOffboarding` accepts an explicit `read_targets` intent through the existing service, validates the person and group-admin authority, and reads actual repository detail without writes. PersonOffboarding loads and explicitly selects an anchor; RequestRecord supplies its own fixed request anchor. The web transaction adapter lives in orchestration rather than transition-core. These are proposed composition changes, pending revised readiness approval.

Please have Nous allocate and deliver an independently approved **technical routing prerequisite**, with an official id, registering:

```text
apps/web/src/modules/org-registry/people-action-service.ts
  -> apps/web/src/modules/org-registry/repository.integration.test.ts
```

This is a responsible-suite registration, not a source exemption. Keep instrumentation, thresholds and routing-gap rejection. The service shard must run the production-used intent executor against real repository/database authorization contexts: read-targets availability/no writes; malformed/mismatched/unauthorized/transfer rejection; targeted mutation preserving unrelated seats; replay with one audit; successful mutation's real revalidation contract, with no mutation-success invalidation on reads or rejections. Parser-only tests, imports and fake owned callbacks are insufficient. The technical delivery must prove the selected suite actually runs in that source's shard. US-075 supplies its behavior oracles after renewed readiness approval; the prerequisite does not claim the offboarding feature is delivered.

With that canonical registration, US-075 can use its existing real integration suite instead of adding a separate service test. The exact candidate is **19 delivery paths + this request = 20**:

- `packages/domain/src/request-workflow/lifecycle.ts` and `lifecycle.test.ts` (2).
- `apps/web/src/modules/org-registry/repository.ts`, `repository.integration.test.ts`, `people-action-service.ts` (3).
- `apps/web/src/modules/request-workflow/orchestration.ts`, `orchestration.integration.test.ts`, `actions/checklist-action-transaction.ts`, `actions/checklist-action-transaction.test.ts` (4).
- `apps/web/src/components/people/person-offboarding.tsx`, `person-offboarding.test.tsx`, `apps/web/src/components/requests/request-record.tsx`, `request-record.test.tsx` (4).
- `apps/web/messages/es-EC.json`, `apps/web/messages/en-US.json` (2).
- `docs/readiness/US-075.json`, the existing US-075 design and plan, `.nous-feedback.jsonl` (4).
- This request document (1).

No local tooling or generated guidance changes are authorized. Nous owns the prerequisite allocation and decisions; any required critical-path registration must also be canonical. After sync, inspect `testing/critical-paths.md`, validate the actual routes, reassess the remaining estimate and obtain the new digest-bound readiness approval before implementation resumes.

**No functional repartition is requested on the present evidence.** The previous 335-minute assertion remains withdrawn; 280 is an unvalidated baseline, and the independent remaining-work estimate is still being assessed. A technical prerequisite does not waive the 320-minute limit. If its validated whole-item forecast still fails a hard limit, return an evidenced vertical repartition request rather than stretching the estimate.

Current evidence update: pending blocked digest `54b14d4ec52c138a0dd6e5c1c6f72ef035a9a1dd5a28686386aff07d9eaf50c8`. Independent remaining estimate is215–355 active minutes; prior implementer effort estimates25–45 plus separately unmeasured controller/reviewer work. The resulting range does not validate ready≤320; no precise replacement total is adopted yet. Routing prerequisite is an independent proposal, not a claim that it alone makes US-075 ready.

## Final accounting reconciliation (supersedes the remaining-range estimate above)

The same consolidated implementer independently forecasts **310 minutes for the whole item**: readiness/reassessment/design/plan40; production and test authoring145; focused checks and previews45; all scoped/adversarial reviews and bounded repairs45; gates, one cold campaign and integration35. Completed Task1 is included. Authoring appears only in implementation; repairs only in review; previews only in focused verification; cold campaign only in integration. The preceding215–355 remaining range is withdrawn because it included overlapping authoring/repair allowances. This is a moderate-confidence forecast with10minutes headroom, not measured actuals or a guarantee. The canonical routing prerequisite is separately approved and costed; it does not waive this item's limits.

The request remains **canonical technical routing prerequisite**, not functional repartition. After delivery and actual route validation, the proposed functional composition fits20paths/310minutes and needs renewed digest-bound readiness approval. Without that prerequisite it remains21paths and non-executable. Any new path, boundary or material repair burden requires reassessment; no limits are stretched.

Current blocked/pending readiness digest: 931b876c299251d8b033b0216327c7ef59c8eb83c93db62cfacc9546868cd372.
