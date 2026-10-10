**Work item:** US-072
**Readiness assessment:** docs/readiness/US-072.json
**Approved estimate:** 260 minutes

# Lag-aware usage surface implementation plan

> Execute with the CHG-070 consolidated shape: one implementer for every task,
> checkpoint commit per task, one reused scoped reviewer and a fresh adversarial
> reviewer. The controller plans, briefs and decides; it does not implement or
> run child verification. This explicit user protocol overrides the generic
> writing-plans fresh-worker-per-task recommendation. Repository readiness
> metadata above overrides the generic skill header. Francisco approved the plan
> committed in `2493838` with "Approved, continue"; execution prerequisites remain.

**Goal:** Group Admins can read company-filtered, lag-aware 30/60/90-day activity
on `/uso`, with correct license metrics, last-known activity and request state.
**Architecture:** A pure domain classifier feeds a read-only scoped Drizzle
repository. An authenticated Server Component renders a GET filter form,
metrics, account freshness and a paginated table; no new HTTP API or client store.
**Tech stack:** TypeScript, Next.js 16 App Router, React, Drizzle/PostgreSQL,
zod, next-intl, Vitest, fast-check and the existing mutation runner.
**Spec:** `docs/superpowers/specs/2026-10-10-us-072-usage-surface-design.md`,
approved by Francisco against `ab416b2`, recorded in `f03b39e`;
`docs/stories/sprint-3/r1_misc_us_072.md`; BR-16; DEC-SMP-026/028.

## Global constraints and entry prerequisites

- Read CLAUDE.md, docs/dev-guide/local/CLAUDE.md, TESTING.md and
  docs/TEST_EFFECTIVENESS_STANDARD.md, plus nested AGENTS files in touched paths.
- Readiness payload is `9b4c47527004b73f6b2c9cef78a4bf1bb635b32150a245b18b3a9bf49a1f85bb`;
  no production/test/tooling edits until this plan is approved and committed.
- CHG-069 and CHG-071 are delivered; US-026 prerequisite is complete.
- CHG-070 readiness currently rejects its October 7 preapproval started/phase
  history with WR_APPROVAL_ORDER. Require an operator-owned, approved correction
  and a passing CHG-070 readiness check before experiment execution. Neither
  rewriting old events nor absorbing a validator fix belongs to US-072. CHG-072's
  separate feedback-order diagnostic remains nonblocking.
- Work on the user-selected `chg-070` branch. Do not create another checkout
  without a need. Freeze `US072_BASE` to the plan-approval commit before code;
  use that exact SHA as MUTATION_BASE for focused preflight, previews and final
  campaign. Do not use a moving main tip or charge parent/docs-only diffs to this child.
- All shell commands start with rtk. Never print environment secrets or URLs.
- No schema migration, packages/contracts edits, new route or public endpoint;
  no changes to connector ingestion, worker schedules, proposal actions or states.
- One row/open assignment; count licenses, classify against its person/account.
  Preserve last-known activity, selected-window qualification and actual state
  separately. Null/zero/unknown evidence never invents a last-active date.
- Group Admin is global under existing authorization; company selection narrows
  the displayed set. Refuse other roles before business reads. Query tenant
  columns that exist; do not invent tenant_id/deleted_at. Scope anchor joins too.
- Account dataThrough is max synced activity_date, independent of company filter
  and counter positivity. Its aggregate date may include another company sharing
  that account; return no foreign identities/counters. No account records means
  evaluation UTC date minus three days. Strict daysInactive > window qualifies.
- Locale strings live in existing catalogs; design tokens, accessible landmarks,
  table headers and canonical section test IDs are mandatory. No mock data UI.
- At every task boundary, if judged remaining work exceeds the approved estimate,
  stop there and file blocked/deviation before continuing. Do not silently widen.
- Budget remains readiness 25, implementation 105, focused verification 50,
  review 55, integration 25 = 260 minutes. Expected footprint is 14 source/test/
  manifest/catalog files plus existing evidence/design/readiness and this plan;
  this small documentation overhead is named rather than hidden in the estimate.

## File map and stable interfaces

Task 1 creates `packages/domain/src/usage/inactivity.ts` and
`inactivity.test.ts`; updates `packages/domain/src/index.ts` and package.json
exports. Task 2 creates `apps/web/src/modules/usage/filters.ts`,
`filters.test.ts`, `repository.ts` and `repository.integration.test.ts`.
Task 3 replaces `apps/web/src/app/(authenticated)/uso/page.tsx`, creates sibling
`loading.tsx` and `error.tsx`, creates `apps/web/src/components/usage/usage-view.tsx`
and `usage-view.integration.test.tsx`, and updates `apps/web/src/lib/i18n/en-US.json`.
Task 4 adds only evidence/readiness actuals; change scored code only if a named
review defect requires a fix before the cold campaign.

Task 1 owns these public domain types:

```ts
export type InactivityWindow = 30 | 60 | 90;
export type InactivityInput = Readonly<{
  evaluationDate: string;
  accountDataThrough: string | null;
  lastActivityDate: string | null;
  window: InactivityWindow;
}>;
export type InactivityResult = Readonly<{
  dataThrough: string;
  lastActivityDate: string | null;
  daysInactive: number | null;
  classification: "active" | "inactive" | "no_data";
}>;
export declare function evaluateInactivity(input: InactivityInput): InactivityResult;
export declare function hasPositiveVendorActivity(counters: unknown): boolean;
```

Task 2 exports `UsageFilters`, `parseUsageFilters`, `serializeUsageFilters`,
`UsageReadModel`, `UsageRow`, `UsageReadError` and `createUsageRepository`.
Task 3 consumes those exact names. Repository composition exports
`usageRepository` using the existing shared db; no second connection.

```ts
export type UsageFilters = Readonly<{
  companyId?: string;
  window: InactivityWindow;
  cursor?: string;
}>;
export type UsageRow = InactivityResult & Readonly<{
  assignmentId: string; personId: string; personName: string;
  companyId: string; companyName: string;
  vendorAccountId: string; vendorAccountName: string;
  licenseTypeName: string;
  anchorState: (typeof licenseRequest.$inferSelect)["state"] | null;
}>;
export type UsageReadModel = Readonly<{
  filters: UsageFilters;
  companies: readonly { id: string; label: string }[];
  rows: readonly UsageRow[];
  metrics: Readonly<{ total: number; active: number;
    inactive: number; noData: number; activePercent: number }>;
  freshness: readonly { accountId: string; accountName: string;
    dataThrough: string; fallback: boolean }[];
  nextCursor: string | null;
}>;
export class UsageReadError extends Error {
  constructor(readonly code: "access_denied" | "invalid_filter" | "invalid_cursor") {
    super(code);
  }
}
export declare function createUsageRepository(database: NodePgDatabase<typeof schema>): {
  read(authorization: LedgerAuthorization | null, filters: UsageFilters,
    evaluationDate: string): Promise<UsageReadModel>;
};
```

## Task 1 — Shared inactivity rule (AC2, AC3)

**Production sources:** packages/domain/src/usage/inactivity.ts,
packages/domain/src/index.ts; package.json adds the export subpath only.
**Produces:** exact pure functions/types above; independently testable without DB.

- [ ] Write domain tests with fast-check seed 72026 and injected UTC dates.
  Reproduction: a last-active day equal to account dataThrough is zero even when
  evaluation is three days later. Exact threshold triples cover 29/30/31,
  59/60/61 and 89/90/91; no last activity gives null/no_data, and invalid dates,
  invalid windows or last-active-after-watermark reject. Use this oracle:

```ts
expect(evaluateInactivity({ evaluationDate: "2026-10-10",
  accountDataThrough: "2026-10-07", lastActivityDate: "2026-10-07",
  window: 30 })).toMatchObject({ daysInactive: 0, classification: "active" });
expect(evaluateInactivity({ evaluationDate: "2026-10-10",
  accountDataThrough: "2026-10-07", lastActivityDate: null,
  window: 30 })).toMatchObject({ daysInactive: null, classification: "no_data" });
fc.assert(fc.property(fc.integer({ min: 0, max: 150 }), age => {
  const through = new Date("2026-10-07T00:00:00Z");
  const last = new Date(through.getTime() - age * 86400000);
  const row = evaluateInactivity({ evaluationDate: "2026-10-10",
    accountDataThrough: "2026-10-07", lastActivityDate: last.toISOString().slice(0, 10),
    window: 30 });
  expect(row.daysInactive).toBe(age);
  expect(row.classification).toBe(age > 30 ? "inactive" : "active");
}), { seed: 72026 });
```

- [ ] Add monotonicity and lag-invariance properties independent of the exact
  equality oracle. Counter exact tests exercise each positive signal alone and
  zero/null/unknown/session-only records; include both Cowork file-edit fields.
- [ ] Run `rtk proxy pnpm --filter @smp/domain exec vitest run src/usage/inactivity.test.ts`;
  confirm the failing oracle is caused by the missing/wrong behavior.
- [ ] Implement validated UTC day conversion (ISO round-trip plus integer date
  ordinal), three-day fallback, null result and strict threshold. The decisive
  branch is `daysInactive > input.window ? "inactive" : "active"`.
  Enumerate only the approved positive signals: chat message_count; Code core
  commit/pull_request and lines added/removed, accepted/rejected edit/multi_edit/
  notebook_edit/write actions; Cowork message/action/file_edit/
  sessions_with_file_edits/edit/multi_edit/notebook_edit/write counts. A positive
  supported value must be finite, integral and >0. Check own object fields,
  reject arrays as metric objects, and never recursively scan arbitrary JSON.
- [ ] Export via the package subpath and barrel; run focused tests and
  `rtk proxy pnpm --filter @smp/domain type-check` to GREEN.
- [ ] Commit with `feat(US-072): add shared lag-aware inactivity classifier`.
  Run preflight, launch Task 1 previews in background, then start Task 2.
  Send the reused reviewer AC2/AC3, the exact task commit diff and these commands.

## Task 2 — Authorized usage read model (AC1–AC4)

**Production sources:** apps/web/src/modules/usage/filters.ts and repository.ts.
**Consumes:** Task 1 evaluateInactivity/hasPositiveVendorActivity/types.
**Produces:** filters/DTO/repository exports above; real scoped read behavior.

- [ ] Write filter oracles for defaults, UUID/window rejection, duplicate query
  parameters, cursor/filter binding and round-trip serialization. The parser
  accepts `Record<string, string | string[] | undefined>`; defaults only absent
  window to 30, never coerces an unsupported value or duplicate array.

```ts
expect(parseUsageFilters({})).toEqual({ window: 30 });
expect(parseUsageFilters({ window: "60" }).window).toBe(60);
expect(() => parseUsageFilters({ window: ["30", "60"] })).toThrow();
expect(() => parseUsageFilters({ companyId: "not-a-uuid" })).toThrow();
```

- [ ] Use existing createPostgresFixture and fixture.migrate(), connect owner
  only for deterministic seed, and Drizzle over ledger_app for exercised reads.
  Reuse the existing register integration setup pattern, no owned-module mocks.
  Seed Company A and B, one global Group Admin and a viewer; two vendor accounts;
  Person A with two open assignments sharing account X, Person B on account X,
  another A assignment on account Y, one ended assignment and a missing anchor.
  Inject evaluation 2026-10-10. Account X watermark is 2026-10-07 from B's zero
  observation; A's positive dates include 2026-09-06 and 2026-10-07. Account Y
  watermark is 2026-10-01. Add zero-only and null-only histories and older-positive/
  later-null history. Seed positive Cowork file-edit signals separately.
- [ ] Assert with actual repository reads: A filter returns only A assignment IDs
  and no B names/counters; X freshness is still 2026-10-07. Closed assignment is
  absent. No record from Y alters X's last-active or freshness. Request state
  comes only from the matching anchor, missing/foreign anchors are unavailable.
  31-day person is inactive at 30 and active at 60; last synced active day is 0.
  No positive history remains no_data. Older-positive/later-null retains the
  last-known positive date. Card partition sums equal total over all licenses.
  No/other-role authorization rejects before returning business data.
- [ ] Run `rtk proxy pnpm --filter smp-web exec vitest run src/modules/usage/filters.test.ts src/modules/usage/repository.integration.test.ts`
  to reproduce failures, then implement.
  Define parseUsageFilters(parameters): UsageFilters and
  serializeUsageFilters(filters): Record<string, string>; serialization omits
  absent companyId/cursor and always preserves the validated window.
- [ ] At read entry, enforce globalRole group_admin and validate company existence
  inside the permitted company set. In one read-only repeatable-read transaction,
  query open assignments with Person/Company agreement and scoped anchor joins;
  query only relevant person/account activity (date/counters only); query
  account-scoped max(activity_date) metadata; load authorized company options.
  No N+1, rawPayload, assumed soft delete or fabricated tenant fields.
- [ ] Aggregate last positive dates per person/account in memory with the pure
  activity predicate; call evaluateInactivity once per pair. Build assignment
  rows, all-result cards and unique account freshness. Sort descending age,
  null last, assignment ID ascending. Validate base64url JSON cursor with zod:
  exact company/window/sort binding, last age/null and UUID assignmentId;
  apply strict lexicographic continuation, take 50, preserve full-set metrics.
  Use activePercent = total === 0 ? 0 : 100 * active / total; format only in UI.
- [ ] Run focused tests and `rtk proxy pnpm --filter smp-web type-check` to GREEN.
  Commit `feat(US-072): add authorized usage read model`. Collect Task 1 preview
  findings at this review boundary; fold fixes into the next round, not a new
  preview session. Launch touched Task 2 previews; defer database-backed slow
  shards until final round unless a repair touched their sources. Brief the
  reused reviewer AC1–AC4, exact diff and focused commands. Start Task 3.

## Task 3 — Real SCR-usage screen (AC1–AC4)

**Production sources:** uso/page.tsx, uso/loading.tsx, uso/error.tsx,
components/usage/usage-view.tsx; locale catalog strings.
**Consumes:** repository read model and filters. **Produces:** working `/uso`.

- [ ] Render UsageView with results from the Task 2 real fixture, using
  renderToStaticMarkup from react-dom/server and the actual locale labels.
  Assert the correct selected-window card count, last-known date/day values,
  separate request-state/window badges and per-account dataThrough. Compare
  filtered A vs all, 30 vs 60/90, and no-license fixture results; do not mock the
  repository or construct a canned domain result to bypass its behavior.
- [ ] Add pure filter-form/render oracles for `method="get"`, named company/window
  controls, resetting cursor, correct next-link binding and row ID keys. Verify
  no proposal action is advertised and empty output has zero cards/empty message.
  Exercise actual repository refusals/invalid filters and the page handling
  of those known errors in the authenticated demo; no fake auth path or
  repository mock is introduced to make a render test pass.
- [ ] Run `rtk proxy pnpm --filter smp-web exec vitest run src/components/usage/usage-view.integration.test.tsx`
  and record the intended failing behavior before UI changes.
- [ ] Replace page scaffold: loadCurrentLedgerAuthorization; refuse wrong role
  using ROUTE_SCR_ACCESS_DENIED; parse awaited searchParams; resolve getLocale
  and getTranslations("usage"); read usageRepository with the injected current
  request UTC evaluation date (the classifier itself subtracts three days only
  for a missing account watermark; never subtract twice). Catch only known UsageReadError codes for localized filter/
  access handling; let unexpected DB errors reach the error boundary. Do not
  add force-dynamic if the Auth.js read already makes the page dynamic.
- [ ] Implement a server UsageView receiving `{ model, locale, labels }`, a
  semantic GET form, token-based cards, banner and table, person links using
  existing route mapping and nextCursor link with validated serialized filters.
  Preserve test IDs usage_filters, usage_metrics, active_30d_pct,
  flagged_inactive, no_data, freshness_banner and usage_table. Dynamic labels
  say licenses, selected window and last known activity. Fallback freshness
  says estimated fallback, not confirmed sync. No-data ages render unknown.
- [ ] Add locale catalog keys for title/subtitle, filters/apply, license metrics,
  window counts, last-known date, no data, unavailable anchor, fallback/sync
  freshness, empty, validation error, loading, read error/retry and next page.
  State badge labels cover the actual schema enum values without hardcoded JSX.
  Loading uses an accessible skeleton. Error is a minimal Client Component
  using locale hook and reset; it does not expose DB error details.
- [ ] Run render/repository/domain focused suites and web type-check to GREEN.
  Commit `feat(US-072): render lag-aware usage workspace`. Collect Task 2 previews
  and send the reused reviewer the complete task diff, AC1–AC4 and commands.
  Fold final survivor/review fixes into one named fix wave and commit it with
  US-072. Launch the last-task/final merged preview round if no later fix wave;
  otherwise use Task 3 round plus one final round. Collect every pending preview
  before adversarial verification; do not rerun untouched shards.

## Preview and full-gate procedure (implementer owns commands)

Preflight is `rtk proxy env MUTATION_BASE="$US072_BASE" MUTATION_WORK_ID=US-072 pnpm mutation:preflight`.
Also run the cheap `pnpm test:mutation:preflight` import/oracle check. Parse the
ordinary preflight sources; select intersecting production sources from the
current task/fix diff. Do not hardcode generated shard IDs. Launch each exact
selected ID from the implementer, with logs outside Git:

```bash
rtk proxy env MUTATION_BASE="$US072_BASE" MUTATION_WORK_ID=US-072   MUTATION_SHARD="$US072_SHARD" caffeinate -i pnpm test:mutation   > "$US072_PREVIEW_LOG" 2>&1 &
```

Record round start/end and summed shard wall minutes; at most four rounds for
three tasks and at most 30 preview minutes. A no-intersection task records zero.
Database/schema-static shards and any prior run >5 minutes wait for final round
unless a fix touched sources. A routing_gap is not a clean result; repair its
oracle routing or name it as a gap. Genuine survivors join the next task/final
fix wave. Unchanged-source shards keep prior evidence. Slow-shard repair can
justify another touched preview, with the named reason in root_cause.

Use atomic exclusive creation for the full-gate lock, with PID/work ID in it.
Never remove another live run's lock. From the implementer session execute:

```bash
rtk proxy python3 - > "$US072_GATE_LOG" 2>&1 <<'GATE'
import os, signal, subprocess
from pathlib import Path
lock = Path("/tmp/smp-full-gate.lock")
with lock.open("x") as handle:
    handle.write(f"US-072 {os.getpid()}\n")
proc = None
previous = {}
def forward(signum, frame):
    if proc is not None and proc.poll() is None:
        os.killpg(proc.pid, signum)
try:
    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.signal(signum, forward)
    proc = subprocess.Popen(["caffeinate", "-i", "pnpm", "check"],
        env={**os.environ, "TURBO_FORCE": "true"}, start_new_session=True)
    status = proc.wait()
finally:
    if proc is not None and proc.poll() is None:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait()
    for signum, handler in previous.items():
        signal.signal(signum, handler)
    lock.unlink()
raise SystemExit(status if status >= 0 else 128 - status)
GATE
```

Cold base gate is required before Task 1, after all approvals/governing repairs.
Final gate uses the same wrapper; remove the explicit TURBO_FORCE entry only
for a justified later non-cold check. Use a blocking/yield wait around 60 seconds and send meaningful
progress, never a one-second polling loop. Log outlier >2x median wall causes.
The wrapper forwards interruption to the dedicated process group and waits
for gate exit before removing its lock. Existing lock acquisition fails without
overwriting it; inspection/removal of stale locks requires confirming the owner
is gone. A hard SIGKILL cannot run cleanup and must be recorded as an outlier.

## Task 4 — Final gates, fresh AC challenge and closure

**Production sources:** none unless a named review finding requires a pre-campaign fix.
**Consumes:** Tasks 1–3 reviewed GREEN and collected previews.

- [ ] Implementer runs locked full `caffeinate -i pnpm check` (types/lint/tests/build),
  route/sidebar and generated-guidance checks. Prove committed migrations on a
  fresh database via existing fixture.migrate() and verify-schema.mjs, as
  ledger_owner for DDL and ledger_app for exercised reads. No drizzle push.
  Record sanitized commands, exit status, wall duration and candidate SHA.
- [ ] Reused reviewer closes scoped review, including survivor annotations and
  generated testing ownership; all substantive source/test fixes commit now.
  Controller records decisions and build_pass from returned evidence.
- [ ] Controller enters focused_verification with UTC ts and briefs a fresh
  adversarial reviewer: canonical AC1–AC4; exact US072_BASE..candidate range;
  domain/repository/render commands above plus actual authenticated `/uso`
  demo where the test environment supports it. Challenge wrong/no role, forged
  company filter, shared-account watermark, two accounts, 29/30/31/60/90 edges,
  filter cards, zero/null/no history, anchor mismatch, pagination and failure UI.
  Use genuine seeded sessions/DB; do not bypass authentication. Return one
  pass/fail report per AC with method/evidence. Controller logs ac_verify only
  on proven passes. Any fix returns to implementer and that reviewer verifies
  again; track review_fix_loops, targeting <=5.
- [ ] Controller enters integration with UTC ts. Implementer clears the existing
  authoritative mutation cache with `rtk proxy pnpm mutation:cache:clear` and
  runs one cold campaign without a shard:
  `rtk proxy env MUTATION_BASE="$US072_BASE" MUTATION_WORK_ID=US-072 caffeinate -i pnpm test:mutation`.
  Require score >=80, genuine survivor repairs completed and no routing gaps
  misrepresented as evidence. Emit one diff test_report with measured score,
  killed/survived, scope/fingerprint and wall time. Reviewer signs off each
  retained survivor in one `<id> <file>:<line> @equivalent: reason` or
  `@accepted: reason` line. No separate signed report or counterfactual log.
- [ ] Do not change scored source/test/config/dependency after the campaign.
  If unavoidable, record invalidation explicitly, do not hide a second campaign,
  and apply CHG-070's fixed verdict rule to the actual attempt/loop counts.
- [ ] Update readiness actuals: phase_minutes, total, changed_files, commits,
  review_fix_loops, cold_mutation_attempts, mutation_invalidations,
  mutation_minutes, mutation_shards_actual, preview_rounds, preview_minutes,
  estimate_variance_minutes and root_cause. Count active phase time, excluding
  approval/idle waiting; mark its provenance. Session restarts after >1h idle,
  ~150 tools or ~300K context resume the same implementer and are recorded.
- [ ] In root_cause include one implementer cost/session-count line and one
  reused-reviewer line, measured or estimated. Keep fresh AC reviewer costs
  included in the child's overall input total, controller done.cost separate,
  and parent partition work excluded. Controller <=3 sessions, none ~200K+.
  Read transcript input plus cache creation/read input deduplicated per call
  identity; never silently substitute context size for cumulative input tokens.
- [ ] Validate terminal readiness proposal before append; emit cost-provenance
  feedback immediately before done, then controller done.cost (calls,
  context_tokens, output_tokens, model, window). Commit closure with US-072.
  Keep CHG-070 open until nous transcript measurement agrees within 20%.

## CHG-070 decision handoff

Child result is measured against fixed 143M input-token / 230-minute baselines.
Report actual route/screen/shards and tokens/product-line and estimated-minute
normalization alongside the raw totals. Adopt only if input <=110M, total <=265
minutes, score >=80, one campaign and <=5 loops. Keep fan-out if tokens do not
fall 25% or minutes rise >15%; mixed when tokens fall but minutes rise >15%
keeps per-task implementers and adopts the reused reviewer. Apply approved
CHG-070 U7 for the mutation-miss edge case, with any unrelated cause named.
Do not change thresholds, round a miss into a pass or revise Session shape
before the measurements exist.

The CHG-070 controller then records the outcome in WORK_READINESS.md Session
shape without adding/renaming headings, validates guidance/lint/readiness,
records CHG actuals and done.cost, and tells Francisco that nous runs
`change deliver CHG-070` and reports its transcript measurement beside ours.
US-073/074 use the winning shape. This plan does not begin those children.

## Approval and handoff

Francisco approved this plan before Task 1 dispatch. Execution stays pending until the
CHG-070 chronology blocker is corrected under an approved work item and its
readiness check passes. The implementation brief contains this plan, approved
design, AC list, frozen base, files, exact commands, cost/session obligations
and no permission to absorb unrelated red gates or tooling work.

## Plan self-review

AC1 maps to Task 2 authorized selection/cards and Task 3 filters/table/state;
AC2 maps to Task 1 shared lag math and Task 2/3 account freshness;
AC3 maps to Task 1 null/boundaries and Task 2/3 filtered cards;
AC4 maps to the real two-company/account fixtures and fresh Task 4 challenge.
The design's no-data interpretation, Cowork file-edit signals, last-known/null
history, global-admin scope, assignment denominator, request-state separation,
account-wide watermark, validation/cursors and error/loading/empty states all
have named implementation and verification steps. Public types match their
consumers. No placeholder work or extra story behavior is included. The plan
metadata is the exact three-line repository contract at byte zero. All code
blocks are proposed executor instructions; none has been executed here.
