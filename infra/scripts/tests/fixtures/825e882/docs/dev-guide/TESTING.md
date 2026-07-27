# TESTING.md — Mi Banquito

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

> The few areas where a silent fault is materially costly. Mutation testing runs on the diff
> intersected with this set. Adding logic here without updating this file is a review smell.
> *(Authoritative machine-derived set: [`testing/critical-paths.md`](../../testing/critical-paths.md),
> generated from this project's business rules + graph. Keep current.)*

- **Tenant isolation** — every path that touches tenant-scoped data (filtered by `company_id`, DEC-SMP-017). → explicit isolation assertions (a query for tenant A must never return tenant B's rows).
- **Authorization** — role/permission gates on commands/mutations. → integration tests for allowed vs forbidden (expect 403).
- **Money / tax / financial math** (if present) — amounts, rounding, and idempotency of charge/ledger events. → property-based + a provider contract test.
- **BR-01 — Register no-overlap (one seat, one holder, one period)** — critical business rule; oracle: `exact`. (stories: US-003)
- **BR-02 — Every assigned seat-day belongs to exactly one company** — critical business rule; oracle: `exact`. (stories: US-003, US-034, US-047)
- **BR-03 — Audit log is append-only at the database level** — critical business rule; oracle: `exact`. (stories: US-003, US-008)
- **BR-04 — Only legal state-machine transitions execute** — critical business rule; oracle: `exact`. (stories: US-014)
- **BR-12 — Blocked requests are never dropped; review within 1 business day** — critical business rule; oracle: `exact`. (stories: US-023)
- **BR-17 — Proration is daily actual/actual with exact mid-month boundaries** — critical business rule; oracle: `exact`. (stories: US-034)
- **BR-18 — Close is deterministic and idempotent; finals are immutable** — critical business rule; oracle: `exact`. (stories: US-034, US-035, US-047, US-050)
- **BR-20 — Reconciliation flips to reconciled ONLY within 0.5%** — critical business rule; oracle: `exact`. (stories: US-038)
- **BR-22 — Company scoping is enforced server-side on every query** — critical business rule; oracle: `exact`. (stories: US-005, US-047)
- **CompanyRoleAssignment** — auth-sensitive entity (name heuristic).
- **IntegrationCredential** — auth-sensitive entity (name heuristic).
- **UserAccount** — auth-sensitive entity (name heuristic).
- **VendorAccount** — auth-sensitive entity (name heuristic).
- **VendorAccountCapacity** — auth-sensitive entity (name heuristic).
- *(Derived from this project's business rules + graph — `testing/critical-paths.md`. Keep current.)*

## 4. CI gates

- **Effectiveness gate:** diff-scoped **mutation score ≥ 80%** on changed code within §3. Surviving mutants must be killed or annotated `@equivalent: <reason>` with reviewer sign-off. *(Threshold provisional — recalibrate after the first month of real diffs.)*
- **Coverage:** reported as a *diagnostic only*; it never gates. A PR cannot pass on coverage alone.
- **Contract:** external-API contract verification must pass; a broken provider contract fails the build even if mocked unit tests pass.
- **Flake:** any test failing intermittently on unchanged code is quarantined within 1 working day (tagged `@quarantine`, ticketed) and excluded from the gate until fixed or deleted.

Pipeline order (fail-fast): lint/type → domain+property → aggregate+projection → integration → contract → **mutation (gate)** → e2e.

## 5. Agent test-generation loop

1. Generate tests for changed code in §3.
2. CI runs diff-scoped mutation.
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
# NOTE: these task names are wired by the test harness (TE-2); until then the
# package ships no test runner — do not assume `test`/`test:mutation` run yet.
<test>             # unit + aggregate + projection (fast)
<test:integration> # Testcontainers
<test:contract>    # contract verification
<test:mutation>    # mutation on critical-path diff  ← the gate
<test:e2e>         # critical journeys
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
