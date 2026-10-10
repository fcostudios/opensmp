# US-072 — Lag-aware usage surface

**Status:** approved by Francisco Lomas in this conversation ("Approved, continue").
Approval binds the proposed design committed in `ab416b2`; the bound plan follows.
**Readiness:** `docs/readiness/US-072.json`, approved payload
`9b4c47527004b73f6b2c9cef78a4bf1bb635b32150a245b18b3a9bf49a1f85bb`, 260 minutes.
**Authority:** US-027 approved partition; CHG-071; canonical US-072;
DEC-SMP-026/027/028; `docs/specs/09b_business_rules.md` BR-16;
`docs/screens/SCR-usage.json`.

## Outcome and approach

Replace `/uso` scaffold with a Group Admin workspace showing activity for open
license assignments, filtered by company and selected 30/60/90-day window.
One shared domain classifier owns the date/window rule. A read-only Drizzle
repository resolves authorized rows and activity evidence. A Server Component
renders filters, cards, freshness and a table. These are the approved domain,
server and UI scopes; packages/contracts is unchanged.

Alternatives: putting window math in SQL makes US-074 duplicate it; a new HTTP
API and Zustand store add a transport and client state that this screen does
not need. The server read path with GET-form URL filters is recommended.
The screen has no dataSource endpoint in its canonical JSON, so no new API
route or registry entry is required. The read interface below is documented
before UI implementation.

US-073 owns batch selection and the proposal modal/action. US-074 owns daily
flagging and return to active. US-028 owns decisions and offboarding. This child
reads request state, creates no proposals, performs no state transitions and
adds no migration. The existing pool/read inactive-candidate queries retain
their wall-clock dates, as the canonical child explicitly requires; emit the
named deferred-divergence annotation during implementation.

## Grain and cards

One row is an open LicenseAssignment (stable row key `assignmentId`), with
person, company, account and license type labels plus its anchor request state.
A person holding several licenses can have several rows; activity is evaluated
once per person/account and reused on those rows. Account evidence is never
borrowed across vendor accounts. Cards count open licenses, consistent with the
screen prototype denominator; labels explicitly say licenses rather than people.

The company filter selects rows. Window selection retains the same rows and
reclassifies their window badges/cards; it does not hide active/no-data rows.
Cards partition the full company-filtered result, independent of pagination:
active = known last activity and days inactive <= selected window;
inactive = known last activity and days inactive > selected window;
no data = no known positive activity. Show active count and percentage of all
filtered open licenses (zero when there are none), inactive count and no-data
count. The computed inactivity card names the selected window. Persisted
`flagged_inactive` is displayed separately as a state badge, even when the
selected 60/90 window no longer classifies the row as inactive.

## Shared pure domain interface

`packages/domain/src/usage/inactivity.ts` exports through
`@smp/domain/usage/inactivity` and its package barrel:

- `InactivityWindow = 30 | 60 | 90`.
- `evaluateInactivity({ evaluationDate, accountDataThrough, lastActivityDate,
  window })` returns `{ dataThrough, lastActivityDate, daysInactive,
  classification }`, with classification `active | inactive | no_data`.
- `hasPositiveVendorActivity(counters)` recognizes supported, normalized
  activity evidence; it does not call the provider or mutate data.

Dates are validated, canonical Gregorian `YYYY-MM-DD` values. Use UTC day
ordinals, an injected evaluation date and exact integer arithmetic; never the
viewer timezone or current wall-clock time inside the function. Invalid dates
or windows reject explicitly. `dataThrough` is accountDataThrough when present,
otherwise evaluationDate minus three UTC days (DEC-SMP-026). A last-active date
on dataThrough yields zero. A later last-active date is rejected as inconsistent
input rather than silently manufacturing a negative inactivity age.
No last-active date yields null days and `no_data`, including never-synced
accounts and histories containing only zeros/unknowns. Strict boundaries are
29/30 active, 31 inactive for window 30; analogously 60/61 and 90/91.
US-074 must call this same function with window 30.

ActivityRecord.activityDate is an observation day, not proof of use. Determine
lastActivityDate as the maximum observation date with positive recognized
activity for that person/account. Positive chat message_count is activity.
Claude Code qualifies through positive commit_count, pull_request_count,
lines_of_code added/removed, or accepted/rejected tool actions for edit,
multi_edit, notebook_edit or write. Cowork qualifies through positive
message_count, action_count, file_edit_count, sessions_with_file_edits_count
or edit/multi_edit/notebook_edit/write tool counts.
Session counts alone, artifacts or metadata alone, unknown paths, nulls and
all-zero counters do not manufacture a last-active day. Malformed supported
counts are unknown rather than positive. A known positive signal suffices even
when another metric is absent. No positive history remains no-data: neither
assignment start nor first zero observation invents the person's last activity.
A later null/unknown observation is not evidence of zero use and cannot create
a newer positive date; retain the last known positive date for canonical AC2
age calculation. Label it as last known activity and test older-positive/later-
null histories explicitly. This reports the delivered evidence without claiming
a complete observation history or a confirmed absence of use.

This mapping is an inference from the delivered counter allowlist and
[Anthropic active-user definitions](https://platform.claude.com/docs/en/manage-claude/analytics-api#how-metrics-are-defined),
inspected 2026-10-10. The provider describes chat messages, Code tool/git
activity and Cowork tool/message activity. US-070 intentionally persists only
chat/Code/Cowork; new provider products and their ingestion remain outside this
child. Missing supported evidence must remain unknown. The provider's current
freshness guidance does not override DEC-SMP-026's canonical three-day fallback.

## Server read contract and authorization

`createUsageRepository(database)` in `apps/web/src/modules/usage/repository.ts`
receives the existing shared Drizzle client at production composition. It
exposes `read(authorization, filters, evaluationDate): Promise<UsageReadModel>`.
Use the real DB-backed LedgerAuthorization, not token/client role claims.
Reject null authorization and any globalRole other than group_admin before
business reads. Resolve `permittedCompanyIds(authorization, "company:read")`;
a global Group Admin has `all` under the delivered authorization model.
For a restricted set, every company-owned relation is constrained to that set;
empty scope returns no business rows. Explicit requested company must exist in
the authorized set; nonexistent and unauthorized filters both refuse access.
The filter changes selection, never authorization.

Validate URL parameters with zod: optional company UUID, window 30/60/90
(default 30), optional opaque cursor. Reject duplicate/malformed values with a
localized validation result rather than silently broadening the selection.
Unknown query parameters do not confer permissions. No mutation contract or
new packages/contracts module is introduced.

Load scoped open assignments and scoped Person/Company joins. Pin
LicenseRequest to the assignment sourceRequestId and matching company/person/
account; a missing anchor shows an explicit unavailable state. Read ActivityRecord
only for the scoped person/account pairs; it has no company_id or deleted_at.
Do not assume soft-delete fields on any table. Company/assignment/person joins
must agree on tenant ownership; never join foreign request/person rows by ID
alone. Derive database row types from schema rather than redeclaring entities.

Resolve `max(activity_date)` for each account referenced by scoped assignments,
across that account's synced records, independently of selected company and
positive activity. This is shared vendor-account freshness metadata required
by DEC-SMP-026; it may include an observation from another company sharing the
account. Only the aggregate date is returned, never foreign identities,
counters, counts or rows. A company-specific watermark would change the
canonical rule. Accounts with no stored observations use the fallback date.
Read assignments, activity and account watermarks in one read-only repeatable-
read transaction to avoid mixing a new watermark with old positive history.

`UsageReadModel` contains validated filters, authorized company options,
assignment rows, all-result metrics, account freshness summaries and nextCursor.
Rows carry IDs/labels, anchor state, lastActivityDate, dataThrough, daysInactive,
classification and the selected window. This output contains no rawPayload.
Sort daysInactive descending, no-data last, assignmentId ascending as a stable
tie-break. Page size 50; cursor is validated and binds company/window/sort and
last sort key, so it cannot be reused with changed filters. Compute metrics
before slicing the rows; avoid one query per person/assignment.

## Screen behavior and states

The page loads current Ledger authorization and uses the existing access-denied
route constant for refusal. Auth-backed request rendering is dynamic. The
page reads validated searchParams and locale/messages with next-intl server
helpers. All visible text uses the delivered locale catalog, date/number
formatters and existing design tokens.

Render TOON sections with their matching data-testid: usage_filters,
usage_metrics, active_30d_pct, flagged_inactive, no_data, freshness_banner and
usage_table. The historical card IDs remain stable; their visible labels adapt
to the selected window. The GET filter form has labeled company/window selects
and an Apply button. Applying a filter resets the cursor. Each row shows
person/company, last known active date, days inactive, window qualification, license/account
and actual anchor state. Use semantic table headers, a caption, keyboard links
to existing person detail routes and localized unknown values.

The freshness banner names each displayed account's dataThrough and the
canonical approximate three-day delay. An unsynced account is labeled as using
a fallback date; do not present it as a confirmed sync. Rows retain their own
account's date, even when another account is fresher. No open licenses yields
zero cards and a localized empty table. Loading uses a section skeleton;
unexpected read failures show a localized error with retry, never an empty
success. Filter validation has its own message. Proposed actions/modal and
selection controls arrive in US-073 and are not rendered as working features
here. No global client state is needed.

## Verification and experiment

The implementer writes property/exact tests with each task. Properties constrain
lag invariance, age monotonicity, exact threshold triples, null handling and
cross-account independence; exact counter tests distinguish positive activity
from zeros, nulls, unknown keys and session-only evidence, including Cowork
file-edit and sessions-with-file-edits signals individually, plus older-positive/
later-null history. Seed the RNG and inject
the clock. Test real repository behavior with the existing PostgreSQL fixture
under ledger_app and committed migrations; do not mock owned repositories,
authorization or the database. Fixtures include two companies, shared and
separate vendor accounts, multiple assignments/person, zero-only records,
missing anchors, stale records and forbidden roles. Assert company/row/counter
isolation, account watermark independence of company selection, metric
partitioning, cursor validation and filters.

Render the actual view from real read-model results to constrain dates, cards,
badges, localized empty/error/refusal states and filter behavior. Add only
oracles constraining an observable fault; no coverage-target tests or copied
implementation assertions. Tenant isolation/authorization stay governed by
TESTING.md §3; any change to that declaration follows the generated ownership
rules, and testing/critical-paths.md is not hand widened.

After design approval, write an exact readiness-bound plan with production
sources named per task. Execution uses one implementer for all tasks, one
reused scoped reviewer and a separate fresh adversarial AC reviewer. Controller
briefs/decides and does not run child verification. Preview rounds come from
the implementer in the background after focused-green: touched shards only,
one round/task plus final fix wave, <=30 minutes, slow shards final-only unless
touched. Each full caffeinate gate owns /tmp/smp-full-gate.lock until finally
cleanup. Establish cold TURBO_FORCE=true base-green before implementation.
Collect final previews, full DoD, adversarial AC1–AC4, then one diff-scoped cold
campaign >=80; keep scored sources unchanged afterward.

The plan records phase timestamps, task commits, forced restarts, controller/
implementer/reviewer session IDs and all costs with measured/estimated provenance.
Codex usage must be reconciled with nous's Claude-based baseline, counting
cached input once per call identity. Do not assert measured totals or agreement
without transcript evidence. Closure needs preview rounds/minutes, <=5 loops,
worker/reviewer cost lines with session counts and controller done.cost.
CHG-070's preapproval started/phase history still fails readiness ordering;
this design does not rewrite it or authorize a validator fix. Resolve that
separate governing blocker before experiment execution or closure.

## Scoped design review

The reused US-072 reviewer session inspected AC1–AC4, BR-16, the delivered
authorization and counter seams. Its required correction (Cowork file_edit_count
and sessions_with_file_edits_count) is incorporated, with individual-signal
oracles. Last-known activity and later-null behavior are explicit. It confirmed
assignment metrics, account-wide watermark, global admin scope and strict
thresholds. No code, tests or gates ran. Reviewer session count is one; token
usage remains unavailable to the controller and requires transcript measurement.
