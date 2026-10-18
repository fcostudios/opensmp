**Work item:** US-092
**Readiness assessment:** docs/readiness/US-092.json
**Approved estimate:** 255 minutes

# US-092 implementation plan

> One authorized consolidated implementer executes task-by-task in the existing worktree. Use the executing-plans skill on source authorization; the controller routes builder/scoped reviews to the existing reviewer and final adversarial verification to a distinct fresh reviewer. No new worker/task.

**Goal:** Retire financial drift production while strictly validating new canonical subjects and preserving historical alert readability.
**Architecture:** Separate strict write validation from compatible typed read parsing. Return no financial drift facts from the existing worker and demonstrate compatibility through the actual organism.
**Tech Stack:** TypeScript, Zod, Vitest, React server rendering, PostgreSQL and local SMTP.
**Spec:** `docs/superpowers/specs/US-092-design.md` (interfaces, exact frozen inventory, scope and evidence custody).

## Global constraints

- Bind exact readiness digest `7c873d54fb1abd3fc4e989e2630cfbe319515d61e275324914e80a2755134428`, approval `b1c1d4c`, authority base `7bc42fa74cb198677817a011fd19c3e924a19ecd`; run `rtk proxy pnpm readiness:check -- US-092` before source.
- Only the spec's nine delivery/four bookkeeping paths; no future table/query, fictional episodes, company inference, tenant expansion, other-owner takeover or guide/toolchain edits.
- Read full `docs/dev-guide/TESTING.md`, `docs/TEST_EFFECTIVENESS_STANDARD.md` and TDD `writing-good-tests.md` before any test change; read current critical-path guidance. If guidance requires change, stop for operator amendment rather than hand-editing generated files.
- Actual builder PASS and controller followup are required before source/tests. Standing design/plan authorization does not waive builder review.
- Every shell command starts `rtk`; existing official shared PostgreSQL fixture only, no private container.
- **If, at any task boundary, you judge that the remaining work will exceed the approved estimate, stop there and file a `blocked` or `deviation` feedback event before continuing.** Compare cumulative sunk+remaining all-actor forecast with255; >320minutes/20delivery paths hard-fails. Extra path/coupling requires amendment before work.

## Review focus

1. A permissive generic read union must not allow a new reconciliation or mixed subject through `alertSubjectForTypeSchema` or `alertEvaluationSchema` (Task1 negative matrix).
2. Strict writes must not break stored reconciliation alert parsing or its organism destination (Task1 read assertions; Task2 rendered historical link).
3. Empty financial facts must yield a successful worker run, rather than hidden per-rule validation failure (Task2 exact status).
4. Zero drift must coexist with enabled applicable rules, positive other-alert delivery and unchanged financial rows (Task2 PostgreSQL+SMTP oracle).
5. Account rules must not become company authorization or expose another company's request data (Task2 scope/tenant controls plus retained existing suite).

### Task 1: Strict new subjects and compatible historical reads (AC2, AC3 contract clauses)

**Modify:** contracts `alerts.ts`/`alerts.test.ts`; domain `evaluate.ts`/`evaluate.test.ts`/`types.ts`; additive `scripts/mutation-routes.json`.
**Production sources:** `packages/contracts/src/alerts.ts`, `packages/domain/src/alerts/evaluate.ts`, `packages/domain/src/alerts/types.ts`.
**Interfaces:** Produce the spec's `NewAlertSubjectRef`, strict `alertSubjectForTypeSchema`/`alertEvaluationSchema`, compatible `alertSubjectRefSchema`/`alertSubjectForReadTypeSchema`; preserve evaluator/destination signatures. Runtime new evaluation validates strict pairing; read destination validates compatible pairing.

- [ ] Write minimal contract/domain tests: canonical `{drift_episode_id:"episode-1",vendor_account_id:"account-1"}` succeeds; reconciliation-only, mixed, missing either key, empty/non-string, extra keys and wrong type fail. Apply these to typed new-subject and evaluation schemas. Assert historical generic+typed read succeeds, malformed historical read fails and legacy destination equals `/excepciones`. Update new-evaluation matrix drift facts to canonical shape; assert exact canonical subject/dedupe, retain non-drift matrix and disabled/threshold behavior.
- [ ] Run `rtk proxy pnpm --filter smp-web exec vitest run ../../packages/contracts/src/alerts.test.ts ../../packages/domain/src/alerts/evaluate.test.ts`; observe expected assertion RED because canonical writes fail/legacy writes pass. A compatibility assertion already green remains a regression control. Save raw receipt ignored.
- [ ] Implement only the named schemas/type export and destination read-schema switch. Keep generic `AlertFacts.subject` read-compatible, with strict evaluator validation. Avoid notification/barrel/UI edits.
- [ ] Rerun that exact command to GREEN; check relevant type compilation for unchanged consumers. Add the `types.ts` route to existing domain evaluation test only when that source actually changed; preserve every existing route key and ordered value.
- [ ] Commit green task with `US-092` in message, recording exact diff/test receipt. Run ordinary own preflight against committed source with `MUTATION_BASE` and `MUTATION_WORK_ID=US-092`; discover IDs, intersect `sources` above and launch eligible touched-only previews awake in background. Treat forecast3 as nonauthoritative; record actual discrepancy as deviation, not payload rewrite. Record zero previews if no intersecting shard. Defer slow/DB shards to final preview.
- [ ] Send controller the exact range, AC2/3, commands, receipts and cumulative phase forecast for existing scoped review; wait for its disposition before Task2. Fold genuine survivor/review repairs into the next authorized fix wave and rerun touched tests. Keep a green checkpoint commit.

### Task 2: Real worker retirement and historical organism proof (AC1, AC3)

**Modify:** `apps/worker/src/alerts/evaluate-alerts.ts`, its existing `evaluate-alerts.integration.test.ts`, `apps/web/src/components/alerts/alert-list.test.tsx`, additive `scripts/mutation-routes.json`.
**Production source:** `apps/worker/src/alerts/evaluate-alerts.ts`.
**Consumes:** Task1 strict new validation and compatible destination parser.
**Produces:** Unchanged `createAlertEvaluationJob(options): AlertEvaluationJob` / `run(at)` interface; financial drift facts empty, other alerts preserved; actual historical organism link.

- [ ] In the existing real integration suite seed an open nonzero financial reconciliation, enabled applicable global/account drift rules, account-negative/company-negative controls and an independent valid low-pool breach. Use existing owner/app fixture, official CHG-067 runner and actual local SMTP, injected timestamps/fixed IDs. Name the counterfactual: restoring the financial fact branch must violate successful zero-drift behavior; skipping all rules must violate the low-pool positive oracle.
- [ ] Assert exact success; zero newly persisted `register_drift` events and drift delivery/outbox records; no drift SMTP subject; exact low-pool persisted delivery evidence and SMTP message. Query financial reconciliation status/variance and relevant fixture financial data before/after for unchanged values. Explicit tenant A/B isolation assertions apply wherever fixture paths are company-scoped; do not invent a reconciliation company field.
- [ ] Run `rtk proxy pnpm --filter smp-web test ../../apps/worker/src/alerts/evaluate-alerts.integration.test.ts`; observe semantic RED, not fixture/schema/SMTP setup error. Under Task1 strict subjects the old branch may fail the worker; success assertion must catch that failure too.
- [ ] Replace the worker's financial `register_drift` fact case with `return []`; remove now-unused reconciliation-only helper support only inside this file. Preserve scope admission and all other rule processing, financial data and outbox behavior.
- [ ] Extend the existing organism render test with an actual historical reconciliation alert and assert visible subject plus `href="/excepciones"`; retain request render/malformed destination checks. This regression control may already pass; do not claim a new failing behavior or a future episode proof.
- [ ] Run the integration command to GREEN and `rtk proxy pnpm --filter smp-web exec vitest run src/components/alerts/alert-list.test.tsx`; retain all existing worker other-type tests. Append the existing worker integration suite to its route, leaving the existing overdue-invitations suite first; compare all base keys/ordered prefixes against authority.
- [ ] Commit green task; own actual preflight intersects the worker source. Run/collect Task1 preview and eligible Task2/final touched-only previews; slow shards once final unless changed. At most3 rounds and30minutes for two tasks; explain any excess in root_cause. Never use another actor's lock/cache or treat routing gaps as score evidence.
- [ ] Send exact task range, AC1/3, commands/receipts, survivor lines and cumulative forecast to controller for existing scoped review. Commit agreed repairs; refresh only affected tests/previews. Stop at this boundary if scope/budget no longer fits.

### Final verification and closure (after scoped reviews; no source work before builder PASS)

- [ ] Use own final diff preflight with approved base and US-092 ID; require routed executed suites/no routing gaps and honestly record observed shard count. Raw evidence belongs ignored Git-common `.git/agent-evidence/US-092` only. Preserve all thirteen-path inventory accounting.
- [ ] Controller requests distinct fresh final adversarial AC1–3 review with exact range, source and earlier focused raw evidence, using its allocated role. Complete all scoped/final reviews and commit every accepted source/test repair BEFORE the final own full gate/DB proof. Rerun affected focused checks for repairs. Reviewer signs each retained preview survivor line as equivalent or accepted with a concrete reason; controller records verdicts.
- [ ] On that reviewed source, after reading DoD/shared-fixture procedures, acquire the owner-aware `/tmp/smp-full-gate.lock`; wait for any foreign owner and never delete a foreign lock. Hold ownership for the WHOLE `pnpm check` process and its completion wait; release only this session's own lock after process exit. Run the final own gate awake and uncached (`rtk proxy env TURBO_FORCE=true MUTATION_BASE=7bc42fa74cb198677817a011fd19c3e924a19ecd MUTATION_WORK_ID=US-092 caffeinate -i pnpm check`). Establish real owned official-fixture owner/app credentials without printing secrets; never reuse foreign credentials. Run `rtk proxy pnpm --filter @smp/db db:migrate`, then `db:verify`, then `db:parity` against fresh owned databases. No borrowed gate or DB evidence; no private container. Capture exact reviewed source/ref/inputs/exit/UTC receipts. The same final reviewer then binds these receipts to its reviewed source without restarting scope discovery; any accepted source/test repair invalidates this gate/proof and requires refreshed own evidence before cold.
- [ ] Only after reviews, repairs, full gate and actual DB proof: obtain owner-aware campaign lock, clear only own authoritative cache via native command, run one own awake native diff-scoped cold campaign with approved base. Score>=80; actual routed suites execute. No implementation changes after cold; if required, record invalidation and stop/reforecast before another attempt. Preserve other actors' caches and locks.
- [ ] Commit final evidence/actuals and append-only lifecycle together; controller/root handles closure/range/custody/FF review. All phase totals include all actors and elapsed active work; no historical costs moved/reset. `done.cost` requires estimated-vs-measured provenance annotation immediately before terminal. Do not claim episode-production proof or borrowed scores.

## Estimate and self-review

Whole approved255 = readiness25/implementation65/focused95/review45/integration25. Readiness23 is already consumed; remaining232 is an all-actor envelope, not a new estimate. Implementer allocation45/70/8 in implementation/focused/integration includes this design/plan. Controller/root/scoped/final reviewer retain U8 allocations; report phase estimates and current cumulative forecast at each checkpoint. Native telemetry limitations must be disclosed. No token/cost claims from unrelated items.

Self-review: AC1 maps to Task2 real worker; AC2 to Task1 strict/read separation; AC3 to both plus actual organism. All five review-focus cases have named oracles. No new delivery path, table, query, route, guide or takeover is planned. Actual builder/scoped/final PASS remains pending, never self-certified.
