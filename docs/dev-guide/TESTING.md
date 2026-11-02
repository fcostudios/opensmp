# TESTING.md — Ledger

> Per-repo testing contract. Governed by the org-wide **Test Effectiveness Standard**
> (`docs/TEST_EFFECTIVENESS_STANDARD.md`). This is the concrete instantiation for this repo.
> When this file and the Standard disagree, the Standard wins and this file is fixed.
>
> **Coding agents (Claude Code, Cursor, Copilot) MUST read this file before writing or
> modifying any test.** The rules in §1 are hard constraints. This file is generated — do
> not hand-edit; change it by updating the spec/config it derives from.

## 1. Rules for coding agents (hard constraints) — STACK-AGNOSTIC

- **No print/log as a test.** `console.log`, `System.out`, `print`, or a bare "runs without throwing" is **not** an oracle. Every test asserts a property or contract.
- **Do not mock code we own.** Mock **only** true third-party network boundaries (payments, email/SMS/push, LLM providers, external partner APIs). Databases, our own services, the event store, and read-model stores run **real** via Testcontainers or in-memory real implementations.
- **Third-party mocks must be contract-backed.** Any mock of an external API MUST have a corresponding contract test (Pact) so the mock cannot silently drift from the real provider.
- **Aggregates use given/when/then over events.** `GIVEN [historical events] WHEN [command] THEN [emitted events | rejection reason]`. Never mock the event store.
- **Prefer strong oracles.** Order: exact behavioral → property-based → metamorphic → differential → golden. Use property-based for all scoring/money/derived-state math. Do not default to exact-equality on large objects.
- **A new test must kill a mutant it did not previously kill.** If it only raises coverage and kills no new mutant, it is redundant — do not add it.
- **Never add tests to raise a coverage number.** The only effectiveness target is mutation score on critical paths (§3).
- **Determinism is mandatory.** Inject the clock and RNG seed. No live network to uncontrolled hosts. No reliance on collection ordering or timing.
- **Assert tenant isolation** on every path that touches tenant-scoped data.

Violating any of the above is grounds for the reviewer to reject the PR outright.

## 2. Test layers in this repo

The **aggregate + projection layers should be the widest part of the suite**, not the unit layer.

| Layer | Doubles |
|---|---|
| Domain unit (value objects, pure rules) | none |
| Aggregate / command | none (in-memory event store) |
| Projection / read model | none |
| Integration (DB, outbox, auth) | 3rd-party only |
| Contract (external APIs) | contract broker |
| E2E (critical journeys) | none |
| Metamorphic / differential (oracle-hard logic) | n/a |

## 3. Effectiveness-critical paths (the gated set)

> The few areas where a silent fault is materially costly. Mutation testing runs on **the diff**;
> this set decides which **stories owe mutation evidence** before they can close — two separate
> mechanisms. Adding logic here without updating this file is a review smell.
> *(Authoritative machine-derived set: [`testing/critical-paths.md`](../../testing/critical-paths.md),
> generated from this project's business rules + graph. Keep current.)*
>
> **Adding a critical path of your own?** Declare it in config — not by editing a generated file:
> `nous_trace.py config patch --project <id> --key testing.critical_paths --value '["**Your path** — what a silent fault here would cost."]'`
> Declared rows are published verbatim — under `## Operator additions` in `testing/critical-paths.md`, and in the §3 list in `docs/dev-guide/TESTING.md` — and survive every regeneration.

- **Tenant isolation** — every path that touches tenant-scoped data (filtered by `company_id`). → explicit isolation assertions (a query for tenant A must never return tenant B's rows). US-036: `apps/web/src/modules/statements/repository.integration.test.ts` and the signed-session statement-detail route seam assert finance-grant scope for headers, lines and exact US-033 register assignments; a concurrent draft rerun must preserve one repeatable-read snapshot.
- **Authorization** — role/permission gates on commands/mutations. → integration tests for allowed vs forbidden (expect 403).
- **Money / tax / financial math** (if present) — amounts, rounding, and idempotency of charge/ledger events. → property-based + a provider contract test.
- **BR-01 — Register no-overlap (one seat, one holder, one period)** — critical business rule; oracle: `exact`. (stories: US-003, US-094, US-095, US-097)
- **BR-02 — Every assigned seat-day belongs to exactly one company** — critical business rule; oracle: `exact`. (stories: US-003, US-034, US-047, US-094, US-095, US-097)
- **BR-03 — Audit log is append-only at the database level** — critical business rule; oracle: `exact`. (stories: US-003, US-008)
- **BR-04 — Only legal state-machine transitions execute** — critical business rule; oracle: `exact`. (stories: US-014)
- **BR-08 — Approval aging: reminder at 24 h, escalation at 48 h; decision target 2 business days** — critical business rule; oracle: `exact`. (stories: US-015, US-017, US-046)
- **BR-11 — Low-pool alert below the per-org floor** — critical business rule; oracle: `exact`. (stories: US-022)
- **BR-12 — Blocked requests are never dropped; review within 1 business day** — critical business rule; oracle: `exact`. (stories: US-023)
- **BR-14 — Departure deprovisioning completes same business day** — critical business rule; oracle: `property`. (stories: US-024, US-042, US-075, US-077, US-082, US-086, US-087)
- **BR-17 — Proration is daily actual/actual with exact mid-month boundaries** — critical business rule; oracle: `exact`. (stories: US-034). Implementation: `packages/domain/src/close/license-close.ts`; exact transfer-on-10th oracle and seeded split-conservation/rounding properties in its adjacent test.
- **BR-18 — Close is deterministic and idempotent; finals are immutable** — critical business rule; oracle: `exact`. (stories: US-034, US-035, US-047, US-050, US-096). US-035: the same real-PostgreSQL seam exercises confirmed single/period finalization, rate locking and stale-rate rejection, scoped role checks, audit atomicity and next-draft corrections; `finalization-panel.test.tsx` exercises explicit confirmation and command feedback. US-034: `apps/web/src/modules/close/close-service.integration.test.ts` checks stable line bytes, draft reruns, final/reconciled immutability, rollback, company isolation and finalization races against app-role PostgreSQL.
- **BR-20 — Reconciliation flips to reconciled ONLY within 0.5%** — critical business rule; oracle: `exact`. (stories: US-038)
- **BR-22 — Company scoping is enforced server-side on every query** — critical business rule; oracle: `exact`. (stories: US-005, US-047, US-094, US-095, US-096, US-097)
- **CompanyRoleAssignment** — auth-sensitive entity (name heuristic).
- **IntegrationCredential** — auth-sensitive entity (name heuristic).
- **MemberObservation** — auth-sensitive entity (name heuristic).
- **UserAccount** — auth-sensitive entity (name heuristic).
- **VendorAccount** — auth-sensitive entity (name heuristic).
- **VendorAccountCapacity** — auth-sensitive entity (name heuristic).
- **Invitation hygiene (US-067, US-068, US-069; DEC-SMP-023)** — overdue age derives from the durable invitation sent_at, with strict configured boundaries, company-scoped current eligibility and one alert per open breach. Withdrawal targets the pinned invitation only, refuses acceptance races and releases capacity only after confirmed removal; automatic expiry reuses that contract and records its system action.
- **Daily person activity (US-070; DEC-SMP-024, DEC-SMP-025)** — identity matching is company-scoped; natural-key writes are idempotent, ignore stale or equal-equivalent observations and reject equal-time contradictions; source/API activity ingestion requires explicit opt-in; replay accepts only allowlisted activity events; unmatched or null-email identities produce durable warnings; ambiguous identities reject the batch atomically.
- **Exact revisable person costs (US-071; DEC-SMP-024, DEC-SMP-025)** — signed USD amounts use exact decimal strings and integer arithmetic; nonrepresentable precision and overflow reject before writes. The injected UTC completed-date window [D-30,D) guards every source. Company-scoped identities, account/person/day freshness, opt-in locks and atomic warning audits preserve isolation and replay; null/unmatched identities warn and conflicting equal-time payloads reject.
- **Capacity refresh watermark (US-081, US-085; DEC-SMP-031, DEC-SMP-041)** — freed seats never become free capacity optimistically: only `recordAcceptedMemberSnapshot` writes `VendorAccount.members_refreshed_at`/`members_refresh_source`, and only for a validated-complete account-wide member observation (partial/failed/stale observations, provider removal success, invitation polling and single manual entries never stamp it); the `pool-snapshots` projection counts a closed assignment as freed only when the watermark is strictly later than the closure instant (the anchoring `offboarding → deprovisioned` transition `occurred_at`, else `ended_on` end-of-day America/Guayaquil), a null watermark frees nothing, and every other closure reports `pending_refresh`; `seat_freed` recovery and purchased quantities are untouched; every pool surface reads this one projection. Oracle: property-based over generated closure/observation histories with an injected clock, plus real-DB grant/apply verification.
- *(Derived from this project's business rules + graph — `testing/critical-paths.md`. Keep current.)*

## 4. CI gates

- **Effectiveness gate:** **mutation score ≥ 80%** on the changed code a run mutates (`pnpm test:mutation` scopes to the diff automatically). A story touching §3 cannot close without this evidence; surviving mutants must be killed or annotated `@equivalent: <reason>` with reviewer sign-off. *(Threshold provisional — recalibrate after the first month of real diffs.)*
- **Coverage:** reported as a *diagnostic only*; it never gates. A PR cannot pass on coverage alone.
- **Contract:** external-API contract verification must pass; a broken provider contract fails the build even if mocked unit tests pass.
- **Flake:** any test failing intermittently on unchanged code is quarantined within 1 working day (tagged `@quarantine`, ticketed) and excluded from the gate until fixed or deleted.

Pipeline order (fail-fast): lint/type → domain+property → aggregate+projection → integration → contract → **mutation (gate)** → e2e.

## 5. Agent test-generation loop

**The campaign is the LAST step of this loop, not its first feedback.** Write the
test with the code, and use the cheap signals below while you do.

- Run `pnpm test:mutation:preflight` as you go — seconds, no mutants. It names a changed file no test imports, an assertion-free test in the diff, and a test database that cannot be built.
- Preview the touched scope any time you want an early read on oracle strength. A preview is NOT reported as a `test_report` (§4).
- The preflight is not the gate: it says nothing about the oracle strength of tests that already exist. Only a campaign scores that.

1. Generate tests for changed code in §3.
2. Run `pnpm test:mutation` — it scopes to this branch's diff and runs ONE campaign (a diff with nothing mutatable exits immediately). Do not hand-write per-story mutation configs.
3. **Keep only tests that kill previously-surviving mutants;** drop coverage-only redundant tests.
4. Report surviving mutants as an "assurance gap" for the author to close.
5. CI reports **mock-to-test ratio** and **assertion-to-print ratio**; large deviation from the repo baseline is flagged.

Encourage agent test-writing for **small, well-specified correctness bugs with clear reproduction and expected behavior**; suppress reflexive test-spraying elsewhere.

## 6. Stack & commands — Node / TS

| Concern | Tool |
|---|---|
| Runner | Vitest |
| Property-based | fast-check |
| Real deps | Testcontainers |
| Contract | Pact |
| Mutation (gate) | Stryker |
| E2E | Playwright |
| Coverage (diagnostic) | c8 / istanbul |

```bash
pnpm test           # unit + aggregate + projection (fast) — Vitest, wired (TE-2)
pnpm test:mutation  # ONE diff-scoped mutation campaign  ← the gate
                    #   scopes to <merge-base>..HEAD, filtered to mutatable
                    #   sources; exits 0 immediately when the diff has none.
                    #   MUTATION_BASE=<ref> overrides the compared branch.
# Not yet wired by the generator — add them as the project needs them:
<test:integration>  # Testcontainers
<test:contract>     # contract verification
<test:e2e>          # critical journeys
```

## 7. PR checklist (copy into the PR description)

```
[ ] New/changed critical code (§3) has given/when/then or property/metamorphic tests
[ ] No mocks of code we own; third-party mocks are contract-backed
[ ] No print/log used as an oracle; assertions constrain real behavior
[ ] Diff mutation score ≥ threshold; surviving mutants killed or annotated @equivalent
[ ] No test added solely to raise coverage; redundant tests removed
[ ] Deterministic (injected clock/seed, no live network, no ordering luck)
[ ] Tenant isolation asserted where the path is tenant-scoped
[ ] TESTING.md §3 updated if critical-path logic changed
```

## 8. Reference

Full rationale + evidence base: `docs/TEST_EFFECTIVENESS_STANDARD.md`.
<!-- nous-emitted: sha256=26bf2aea0a2a9b0e -->
