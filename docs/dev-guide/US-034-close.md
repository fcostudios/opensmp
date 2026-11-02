# US-034: license-only monthly close

Implements AC1–3 in `08_scope.md`, BR-02/17/18, DEC-SMP-065/066. US-096 owns statement lists/totals; US-035 owns finalization; usage charging remains R2.

## Command contract

`runClose(previousState, FormData)` is a server action on `/cierre`:
- `period`: required canonical `YYYY-MM`; `note`: optional, trimmed, maximum 2000 characters.
- The action resolves Auth.js identity through `loadCurrentLedgerAuthorization`. Only active app-owned Central Finance/Group Admin authorization can invoke the service. Company scope comes exclusively from that authorization.
- Returns `error` for authorization/validation failure, or `{status: succeeded|failed, runId, durationMs}` after persistence. Revalidates `/cierre` after committed outcomes.
- The transaction service validates a strict shared Zod object; request-supplied company fields are rejected. The UI submits only period and note.

## Financial evidence and transaction behavior

Every authorized active company gets one draft per period, including zero-seat companies. Lines retain person, assignment, catalog, rate, inclusive dates and seat-days. A provisional consumed rate stamps `note=provisional_rate` on its line. No usage or analytics input is required.

Integer cents implement actual/actual daily proration. For each person/account/license/rate, round cumulative chronological charges half-up to cents; each segment receives the difference from the prior cumulative rounded amount. This conserves cents across transfers; a residual cent belongs to the later segment. Effective-rate changes create separate dated lines. Unpriced or multiply priced seat-days fail the close.

One transaction records the running CloseRun and `close.started` audit, then uses a savepoint for all statement/line writes. On a computation/persistence failure it rolls back that savepoint and records the failed run with a safe diagnostic code and original note. On success it stamps each changed draft with `close_run_id`. Running and terminal audit evidence commit atomically; the manual request shows pending state while it executes. A process/connection loss before commit rolls the transaction back, allowing a clean retry.

Same-period requests serialize with a transaction advisory lock. Existing statement rows are locked before rate consumption; vendor-account locks use US-032's order. License lines receive deterministic UUIDs based on statement/assignment/date boundaries, so identical financial inputs preserve byte-identical line evidence; generation timestamps and CloseRun provenance refresh on rerun. Existing adjustment lines remain intact and contribute to exact Postgres numeric totals.

Final and reconciled statements are skipped, preserving their timestamps, totals, provenance and lines. DB triggers also reject edits/deletes/new lines against final parents. Only the final→reconciled status progression is allowed without changing financial fields. Raw runtime deletes remain forbidden; a checked SECURITY DEFINER routine clears only license lines of a company-scoped locked draft.

## Verification and acceptance boundary

- Domain: transfer on the 10th, leap February, rate boundaries/gaps, generated date/money conservation, independent-person rounding and deterministic ordering.
- Real PostgreSQL/app role: company isolation, unchanged financial-line bytes, changed draft recalculation, concurrent reruns/finalization, audit and persistence rollback, safe failed-run notes, signed adjustments, final guards.
- Native signed Auth.js request context: actual page/action, denied identities, revalidation and persisted status/duration.
- Client form: period/note submission, pending controls, success/error/failed feedback, empty and route error/loading states.

Sprint 2's exit criterion remains a production/human gate: Finance must compare pilot drafts and CSVs line by line, the IT Director must verify deployed reruns/final preservation, and they must record human `story verify`. This development work does not assert that production exit, real-data acceptance, US-096, or US-037 is complete.

Mutation test infrastructure follows the existing rate-card test pattern: module-level Zod contracts and date helpers are re-imported after `vi.resetModules()` so static mutations are exercised after activation. The first diagnostic run exposed this harness issue; its output is not terminal evidence. The final report is emitted only after the revised tests and review are closed.

## Scoped equivalence review

Reviewer: Codex, inline author self-review (no delegated implementation/review). The final mutation ledger lists the actual survivors and their locations.

- Initial client action state: an empty status/object renders no result and the action ignores previous state.
- Missing-role fallback: any fallback string remains outside the explicit finance/admin allowlist.
- Authorization-loader catch/early guard: an empty catch falls through to the null guard; removing only that guard reaches the service's identical pre-write rejection, mapped to the same action error.
- Vendor-account lock projection: selected data is unused; the same WHERE/ORDER BY/FOR NO KEY UPDATE locks the same rows with an empty projection.
- Advisory key namespace: changing only the internal prefix keeps one shared lock per period; the lock-existence and independent-period tests constrain its behavior.
- Month-part predicate: the explicit `en` numeric month/year formatter emits month first, so an always-true month predicate selects the same value. The year predicate, timezone and month arithmetic are constrained by boundary cases.

These are equivalence claims about returned data/commands, not accepted risks for changing financial behavior. Production Finance/IT verification is still required before sprint acceptance.

Final evidence: [US-034-verification.json](US-034-verification.json). The complete cold UTC campaign killed 306/315 mutants (97.14%), with 9 reviewed equivalents and zero uncovered mutants/timeouts. The omitted-timezone mutant was killed under UTC. All scored source bytes were checked against their embedded report identities before completion.
