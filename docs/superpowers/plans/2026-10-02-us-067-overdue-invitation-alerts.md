**Work item:** US-067
**Readiness assessment:** docs/readiness/US-067.json
**Approved estimate:** 200 minutes

# Overdue invitation alerts implementation plan

**Goal:** Deliver one actionable company-scoped overdue alert for each open pending invitation breach, without duplicate events across evaluation runs.

**Spec authority:** docs/stories/sprint-3/r1_misc_us_067.md; docs/readiness/US-021.json proposal overdue-invite-alerts; DEC-SMP-023 in docs/decisions/DECISION_MATRIX.md; approved docs/readiness/US-067.json.

**Architecture:** Reuse the real PostgreSQL alert evaluator and outbox. Isolate invitation eligibility, current invitation identity and timestamp into a shared read/query seam consumed by the evaluator and exceptions read model. Reuse the existing exceptions route, request drilldown, authorization and locale files. No withdrawal, expiry configuration, new route, provider call, migration or unrelated tooling change.

## Global constraints
- Strictly older than threshold.hours (168 by default); exactly 168 hours does not alert.
- Only current pending invitations are eligible. Accepted, withdrawn, superseded, disabled-rule and foreign-company subjects must not appear or generate events.
- One stable breach event per rule and current invitation; deduplication must survive later evaluation windows and concurrent evaluation.
- Every tenant query filters company_id; shared provisioning_action is scoped through its request.
- All user strings live in locale files; use design-system tokens.
- Real database tests, injected clock, no mocks of code we own. Read docs/dev-guide/TESTING.md and docs/TEST_EFFECTIVENESS_STANDARD.md before test edits.
- If at any task boundary remaining work exceeds the approved estimate, append a blocked/deviation feedback event and stop to reassess.

## Task 1: Deliver the complete overdue invitation alert and exceptions slice

**Production files:** apps/worker/src/alerts/evaluate-alerts.ts; a focused invitation facts/read module under packages/db/src/ if shared ownership warrants it; apps/web/src/modules/request-workflow/repository.ts or a focused invitation read repository; apps/web/src/app/(authenticated)/excepciones/page.tsx; apps/web/src/components/exceptions/overdue-invites-table.tsx; apps/web/src/locales/ locale files (locate existing locale paths before editing); package export files only when required by the shared seam.

**Tests:** Real-DB invitation-evaluation integration tests beside existing apps/worker/src/alerts/evaluate-alerts.integration.test.ts; real-DB read-repository assertions beside the existing request read integration suite; component/page composition evidence beside existing exceptions tests. Reuse Testcontainers/PGlite fixtures and SMTP contract-backed Mailpit boundary. Do not copy mocks or create framework mocks.

**Interfaces:** Shared eligible invitation rows expose companyId, requestId, requestNumber, current invitation reference/action identity, invitation time and ageHours. Exceptions reader accepts verified LedgerAuthorization, injected at and cursor, and returns only visible overdue rows plus pagination/count. Task 2 consumes the tested production diff and verification report.

- [ ] Read the referenced worker, outbox, request transition, provisioning action, membership acceptance and exceptions paths. Confirm current pending identity and locking protocol before defining the SQL seam; record decisions that settle assumptions.
- [ ] Write a focused failing real-DB test: given pending invitations below, at and above 168 h, evaluate at an injected time; assert only the overdue invitation has one invite_unaccepted event. Evaluate at a later 15-minute window and concurrently; assert the same event ID/count, with no second notification success. Include disabled and tenant-B rules, accepted/superseded invitations and state revalidation under the membership lock.
- [ ] Run that test and retain RED evidence (the existing timestamp-bearing dedupe permits duplicates across windows). Then implement the smallest eligibility and stable-breach path. Preserve other alert types and outbox behavior.
- [ ] Write a failing real-DB reader test asserting tenant-A visible overdue request IDs, exact-boundary exclusion, current age, disabled rules and cursor behavior. Implement the reader using the same eligibility and strict threshold. Guard privileged group-admin access and company membership as the existing authorization contract requires.
- [ ] Write a failing rendered component test asserting visible request number/link and age, plus the localized empty state. Implement the table and wire expiredInvites tab data/count from the reader. Keep existing blocked/failed tabs unchanged.
- [ ] Run focused tests, type checks and test lint. Self-review for tenant leaks, stale accepted state, rounding at the threshold, repeated evaluation and mismatched list/event eligibility. Commit the tested slice with US-067 in the subject.
- [ ] Run ordinary mutation preflight against the committed candidate. Discover returned shard IDs and preview every shard whose sources intersect this task's production files; do not emit test_report. Repair actual survivors, retain assurance gaps honestly, and report test commands/results, touched files, commits and preview evidence to the controller.

## Task 2: Independent review and final verification

**Production sources:** Same sources as Task 1; any repair stays within those ACs.

- [ ] Fresh reviewer reads the story, readiness assessment and complete diff. Adversarially verify strict age, invitation identity, disabled rule, tenant isolation, request links, race eligibility and stable breach uniqueness. Repair and re-review material findings.
- [ ] Append focused_verification phase; verify AC1, AC2 and AC3 independently and append passing ac_verify evidence only after real checks.
- [ ] Run pnpm check with bounded VITEST_MAX_WORKERS=2 and the required fresh committed migration apply/verify/parity checks using disposable database fixtures. Report actual results, not cached migration claims.
- [ ] Append integration phase, clear mutation cache and run one authoritative diff-scoped campaign after all source/test repairs and review close. Use authority/us-067-base and MUTATION_WORK_ID=US-067. Report scores, survivors and elapsed campaign time only from the completed campaign.
- [ ] Record actuals from timestamps and raw Git paths; append build_pass, test_report and done in gate order. Commit evidence, validate readiness/feedback and leave a clean feature branch. No merge or external publication is part of this plan.

## Verification scope refinement (controller ruling)
Ordinary preflight discovers the exceptions route as a previously registered exact framework adapter before conventional tests. Re-register only its candidate SHA-256 in scripts/mutation-scope.mjs; preserve classification logic and fail-closed changed-source negative controls. Move new rendering to an adjacent exceptions-view.tsx module with direct rendered tests so new business JSX is scored and page.tsx exports only valid Next.js page exports. This is evidence registration serving AC2, not a new tooling policy. Record the extra verification path in a US-067 deviation; keep actual file and shard counts honest.
