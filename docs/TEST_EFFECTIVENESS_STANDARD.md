# Test Effectiveness Standard — Architecture & Execution Policy

**Owner:** FcoStudios Engineering
**Applies to:** All FcoStudios products and **every project hosted in `nous.db`** (all human- or agent-authored code). Adopted into the Nous substrate by IMP-301 (TE-1); synced verbatim into every generated dev package at `docs/TEST_EFFECTIVENESS_STANDARD.md`.
**Status:** Normative. `MUST` / `SHOULD` / `MAY` follow RFC 2119.
**Version:** 1.0

---

## 0. How to read this document

This standard has two halves that must be kept together:

- **Design** (§3–§6): how the test architecture is *shaped* so that the tests are capable of detecting real faults.
- **Execution** (§7–§9): how the suite is *run, gated, reduced, and maintained* so that capability is realized cheaply and repeatably.

Every rule is tied to the evidence base in §2 and §14. The single organizing claim is:

> **Test effectiveness is the ability to detect real faults — not coverage, not test count, not "the agent wrote tests."** We measure and gate on fault-detection proxies (mutation adequacy, real-fault coupling), and we treat coverage and volume as diagnostics, never as targets.

---

## 1. Scope and non-goals

**In scope:** unit, integration, contract, end-to-end (E2E), property-based, metamorphic, and regression testing; test-double policy; oracle strategy; agent-generated test governance; CI gating; test-suite reduction and selection; flakiness; maintenance.

**Non-goals:** performance/load testing methodology, security/pen-testing, and manual exploratory QA are governed by separate standards and only referenced here where they interact with the automated suite.

---

## 2. Evidence base and first principles

These principles are non-negotiable because they are empirically grounded. Full citations in §14.

**P1 — Coverage is a weak proxy for effectiveness.** Controlling for suite size, statement/branch coverage correlates only weakly-to-moderately with fault-detection ability [Inozemtseva & Holmes, ICSE 2014]. Coverage is necessary (uncovered code cannot be tested) but nowhere near sufficient. **We therefore never set a coverage percentage as a pass/fail gate.**

**P2 — Mutation adequacy is the best practical ground truth we have.** Mutant detection correlates significantly with real-fault detection, and more strongly than coverage [Just et al., FSE 2014]. Mutation testing rests on the competent-programmer hypothesis and the coupling effect [DeMillo, Lipton & Sayward, 1978; Papadakis et al., 2019]. **Mutation score is our primary effectiveness gate on critical code.**

**P3 — A test without a strong oracle asserts nothing.** The oracle problem is fundamental [Barr et al., IEEE TSE 2015]. A test that executes code but does not check a meaningful property is theatre. **Every test MUST have an oracle that constrains behavior; observational output (prints/logs) is not an oracle.**

**P4 — Agent-generated tests default to low-fidelity artifacts.** Autonomous coding agents predominantly emit value-inspecting prints and shallow exact-equality assertions rather than contract-constraining checks; test *volume* has no statistically significant effect on task-resolution outcomes but a large effect on cost [Chen et al., arXiv 2602.07900, 2026]. **Volume is never a KPI; effectiveness and cost are.**

**P5 — Agents over-mock.** In the wild, agent-authored test commits add mocks markedly more often than human ones (≈36% vs ≈26%, holding within-repo) and use a narrower, less faithful set of test doubles [Hora & Robbes, MSR 2026]. Over-mocked tests pass without validating real interactions and drift out of sync as production code evolves. **Mocking is restricted by policy (§5) and this restriction is enforced at the config layer, which is known to change agent behavior.**

**P6 — More tests can be worse.** A larger suite that is redundant, slow, or flaky degrades the feedback loop and hides signal. Test-suite reduction (TSR) that preserves fault-detection is a first-class engineering activity, not cleanup [Sebastian, Naseem & Catal, 2024; classic RTS/TCP literature].

---

## 3. Effectiveness model — how we define and measure "good"

### 3.1 Primary metric: mutation score on the effectiveness-critical set

- **Effectiveness-critical code** = domain model (aggregates, entities, value objects, invariants), command handlers, projections, money/tax/security/authorization logic, and any code path where a silent fault is materially costly. Each product `MUST` declare this set explicitly in `testing/critical-paths.md`.
- On this set we compute **mutation score = killed mutants / (total non-equivalent mutants)** using a per-stack mutation engine (§8.4).
- Gate thresholds are set per product but `MUST` be **mutation-based, not coverage-based** (§7.2).

### 3.2 Secondary / diagnostic metrics (tracked, never gated as targets)

- Line/branch coverage — used only to find *unreachable* or *untested* code, and to explain a low mutation score. A high coverage number never earns a green light on its own (P1).
- Assertion density and **assertion-to-print ratio** per test file (agent-quality signal, §5.4).
- Mock density and test-double diversity (over-mock signal, §5.3).
- Flake rate, suite wall-clock, and per-phase cost (§7, §9).

### 3.3 Explicit anti-metrics (banned as goals)

Number of tests written; coverage percentage as a target; "agent added tests" as a completion criterion; green CI without an effectiveness gate. Optimizing any of these is a Goodhart trap the evidence in §2 specifically warns against.

---

## 4. Test architecture and layering

We use a **testing trophy weighted toward integration** rather than a wide unit base, because in event-sourced/CQRS systems the highest-value faults live at seams (command→event→projection, tenancy, serialization) not in isolated functions. Adapt the classic pyramid [Cohn 2009; Fowler 2018] accordingly.

### 4.1 Layers and what each is *responsible for detecting*

| Layer | Detects | Oracle style | Doubles allowed? |
|---|---|---|---|
| **Domain unit** | Invariant violations, illegal state transitions, value-object rules | Direct assertions on invariants + property-based | None — pure domain, no I/O to mock |
| **Aggregate / command** | Wrong events emitted, wrong rejection of commands | Given-events → When-command → Then-events (§4.3) | None — in-memory event store |
| **Projection / read model** | Wrong read models from event streams, non-idempotent handlers | Apply event sequence → assert projection state | In-memory or real store; no business-logic mocks |
| **Integration / adapter** | Serialization, DB, outbox, Keycloak, external API contracts | Real dependency via container (Testcontainers) | Only true externals (3rd-party network); everything ownable is real |
| **Contract** | Provider/consumer API drift across services | Pact-style consumer-driven contracts | Contract broker, not hand mocks |
| **E2E (thin)** | Critical user journeys, wiring, auth end-to-end | Black-box on real deployment/preview | None — real system |
| **Metamorphic / differential** | Oracle-hard behavior (AI classification, ranking, tax calc) | Relations between outputs, or vs. reference impl (§4.4) | N/A |

**Rule 4.1.1:** Each layer `MUST` justify its existence by the fault class it uniquely catches. A test that could be a cheaper lower layer `MUST` be pushed down. A test that only passes because everything real was mocked `MUST` be pushed up or deleted.

### 4.2 The pyramid is inverted for us — deliberately

Because our correctness lives in the command→event→projection pipeline, the **aggregate/command and projection layers are the widest part of the suite**, not the leaf-function unit layer. Unit tests exist only for genuinely pure logic (value objects, calculators). This directly counters the agent tendency to over-produce shallow, heavily-mocked unit tests (P5).

### 4.3 Event-sourced test pattern (canonical)

All aggregate behavior `MUST` be tested with the given/when/then event form:

```
GIVEN  [historical events replayed into the aggregate]
WHEN   [a command is handled]
THEN   [exactly these new events are emitted]  // or [this command is rejected with this reason]
```

This makes the oracle strong (it pins the *entire* behavioral delta), removes the need for mocks, and produces tests that are stable under refactoring because they assert domain outcomes, not implementation calls.

### 4.4 Oracle strategy (solving P3 concretely)

Choose the strongest available oracle, in priority order:

1. **Exact behavioral oracle** — given/when/then events, or exact value on deterministic pure functions.
2. **Property-based oracle** — invariants that hold for all inputs (e.g., "applying then reversing a command is a no-op"; "projection is a pure fold over events"). Use QuickCheck-style generators [Claessen & Hughes, 2000]. Mandatory for value objects and money/tax math.
3. **Metamorphic oracle** — for oracle-hard code (email classification in MailConcierge, ranking/idea-quality in Nous, tax edge cases in Centinela-style logic) where the exact answer is unknown but *relations* are known: "adding an irrelevant sentence must not flip the class"; "scaling all amounts by k scales tax by k" [Chen et al., metamorphic testing survey 2018].
4. **Differential oracle** — compare against a trusted reference implementation or the previous released version.
5. **Golden/approval oracle** — snapshot with human-reviewed baseline; lowest priority, only where 1–4 are impossible, and never auto-updated (§9.3).

A test whose only "oracle" is that the code ran without throwing is **not a test** and `MUST NOT` be merged.

---

## 5. Agent-generated test governance

This section operationalizes P4 and P5. It is the part most specific to how FcoStudios actually builds now.

### 5.1 Config-layer rules (enforced, because config demonstrably steers agents)

Every repo `MUST` carry a `TESTING.md` (or an `AGENTS.md`/`CLAUDE.md` section) containing at minimum:

```
## Testing rules for coding agents
- Do NOT use print/console.log/logging as a test. Every test asserts a property or contract.
- Do NOT mock code we own. Mock ONLY true third-party network boundaries.
  Prefer Testcontainers / in-memory real implementations over mocks.
- For aggregates use given-events / when-command / then-events. No mocking the event store.
- Prefer property-based and metamorphic assertions over exact-equality on complex objects.
- A new test must kill at least one mutant it did not previously kill, or it is redundant — delete it.
- Do not add tests to raise a coverage number. Effectiveness (mutation) is the only target.
```

Rationale: the wild-repo evidence shows that a single explicit "never mock" instruction correlates with near-zero agent mock commits in that repo [Hora & Robbes, MSR 2026]. Config is the cheapest effective lever.

### 5.2 Generation → mutation-gated acceptance loop

Agent-written tests are **candidates, not commits**. The pipeline:

1. Agent generates tests for the changed effectiveness-critical code.
2. CI runs mutation testing scoped to the diff.
3. **Accept only tests that kill previously-surviving mutants.** Tests that raise coverage but kill no new mutant are auto-flagged as redundant and dropped (this is TSR at the point of generation — see §7.4).
4. Surviving mutants after acceptance are reported as an explicit "assurance gap" for the author to close.

This mirrors mutation-guided industrial pipelines [Harman et al., FSE 2025] and turns the agent's cheap volume into a filtered, fault-revealing set.

### 5.3 Test-double / anti-over-mock policy

- **Mock only what you cannot own or run.** Databases, message brokers, Keycloak, our own services → run real via Testcontainers or in-memory implementations, never mock.
- **Third-party network APIs** (payment, SRI/tax endpoints, LLM providers, social platforms) → the *only* legitimate mock targets, and they `MUST` be behind a contract test (§4.1) so the mock cannot silently drift from reality.
- **Test-double diversity check:** CI reports the mock-to-test ratio and fails review (soft gate) when an agent PR exceeds the repo's human baseline by a configured margin — the exact over-mock signature identified in P5.

### 5.4 Assertion-quality check (anti-print-theatre)

CI computes an **assertion-to-print ratio** and **relational-assertion share** per changed test file. Files dominated by value-inspecting prints or by only exact-equality assertions (the agent default per P4) are flagged for the author to strengthen toward property/relational/contract oracles.

### 5.5 Scope agent test-writing to where it pays

Per P4, encourage agent test generation specifically for **small-to-moderate correctness bugs with explicit reproduction conditions and precise expected behavior**, and suppress reflexive test-spraying elsewhere. This both preserves the one regime where agent tests helped and reclaims 35–49% of interaction budget observed when test-spraying is discouraged [Chen et al., 2026].

### 5.6 Cost tracing

Test *generation*, *execution*, and *failure-analysis* token/API costs `MUST` be logged as separate lines in the agent trace. Volume is a cost lever, not a quality lever (P4); you cannot manage what you do not separate.

---

## 6. Test data, determinism, and multi-tenancy

- **Determinism is mandatory.** No wall-clock, no real randomness, no network to uncontrolled hosts, no ordering assumptions on unordered collections. Inject clocks and seeds. A non-deterministic test is a defect (§7.5).
- **Event fixtures** are the canonical test data: build state by replaying event sequences, not by poking rows into tables. This keeps tests aligned with the source of truth and refactor-stable.
- **Tenancy:** every integration test `MUST` assert tenant isolation where the code path touches tenant-scoped data (cross-tenant leakage is an effectiveness-critical fault class for all FcoStudios SaaS products).
- **Data builders over fixtures files:** use the builder/object-mother pattern for readable, intention-revealing setup.

---

## 7. Execution policy — gating and the CI pipeline

### 7.1 Pipeline stages (fast-to-slow, fail-fast)

```
1. Static + lint + type            (seconds)
2. Domain unit + property-based    (seconds)      — every push
3. Aggregate/command + projection  (seconds-mins) — every push
4. Integration (Testcontainers)    (minutes)      — every push, parallelized
5. Contract verification           (minutes)      — every push
6. Mutation testing (diff-scoped)  (minutes)      — every PR   ← effectiveness gate
7. E2E (thin, critical journeys)   (minutes)      — pre-merge / nightly full
```

### 7.2 The effectiveness gate (replaces the coverage gate)

- PRs touching effectiveness-critical code `MUST` meet a **per-product mutation-score threshold on the diff** (recommended starting point: **≥ 80% killed on changed critical code**, tuned per product).
- Surviving mutants `MUST` be either killed or explicitly annotated as equivalent/accepted-risk with a reviewer sign-off.
- **Coverage is reported but never gates.** A PR cannot pass on coverage alone (P1).
- Non-critical code uses a lighter gate (coverage as a *floor to find untested code* + reviewer judgment), never coverage-as-target.

### 7.3 Regression test selection & prioritization (speed without losing signal)

- Use **change-based regression test selection (RTS):** run the subset of tests reachable from the diff on every push; run the full suite nightly and pre-release [classic RTS literature].
- **Prioritize** likely-failing and high-fault-revealing tests first so failures surface early [test-case prioritization literature; note the Sebastian et al. SMS explicitly separates TSR from prioritization — we use both].

### 7.4 Test-suite reduction (TSR) as continuous hygiene

Operationalizing P6 and the 2024 SMS:

- **Reduce on the basis of fault-detection, not coverage.** A test is a reduction candidate if removing it does not lower the mutation score of the suite. (Coverage-preserving reduction — the common default — is explicitly *not* our criterion, because coverage ≠ effectiveness.)
- Run a **redundancy report** (near-duplicate detection over test bodies; clustering of tests by killed-mutant sets — the unsupervised-clustering direction the SMS surveys) and propose culls for review.
- **Never auto-delete;** TSR proposals go through review. The goal is a minimal suite with maximal preserved fault-detection.

### 7.5 Flaky test policy (zero-tolerance, budgeted)

- Flakiness is tracked per test; a test that fails intermittently on unchanged code is **quarantined within one working day** (excluded from the gate, tagged, ticketed) — never left to erode trust in CI [Luo et al., FSE 2014].
- Quarantined tests have an SLA to fix-or-delete. A permanently quarantined test is deleted; a test you cannot make deterministic is not protecting you.
- **Flake budget:** if quarantine volume exceeds a threshold, feature work pauses for stabilization. Flaky green is worse than red.

---

## 8. Tooling (per stack)

Choose per repo; the *policy* is fixed, the *tools* are pluggable.

| Concern | JVM / Spring Boot | Node / TS (Next.js, Vite) | Python |
|---|---|---|---|
| Unit / integration runner | JUnit 5 | Vitest / Jest | pytest |
| Property-based | jqwik | fast-check | Hypothesis |
| Real dependencies | Testcontainers | Testcontainers | Testcontainers |
| Contract | Pact / Spring Cloud Contract | Pact | Pact |
| **Mutation (the gate)** | PIT (pitest) | Stryker | mutmut / cosmic-ray |
| E2E | Playwright | Playwright | Playwright |
| Coverage (diagnostic only) | JaCoCo | c8 / istanbul | coverage.py |

**8.4 note on mutation cost:** mutation testing is expensive; scope it to the diff and the effectiveness-critical set (§3.1), run it on PR not on every push, and parallelize. This is the standard way the cost is made tractable [Papadakis et al., 2019].

---

## 9. Maintenance, drift, and oracle rot

- **Mock-sync audits:** because over-mocks drift (P5), every mock of a third-party boundary `MUST` be pinned to a contract test that runs against the real provider on a schedule; a contract break fails the build even if the mocked unit test still passes.
- **Oracle rot:** golden/approval baselines (§4.4) are reviewed on change and **never auto-accepted by an agent**. An auto-updated snapshot is an oracle that asserts nothing.
- **Effectiveness regression watch:** track suite mutation score over time; a drop is treated as a defect in the test suite itself, independent of feature correctness.
- **Kent Beck's rule applies:** effective testing under agents is "eternal vigilance" — the config rules and gates in this document are the vigilance made mechanical.

---

## 10. Roles, cadence, enforcement

- **Author:** writes/curates tests to pass the effectiveness gate; strengthens weak oracles; closes assurance gaps.
- **Reviewer:** rejects print-theatre, over-mocking, coverage-chasing, and redundant tests; approves equivalent-mutant annotations.
- **CI:** enforces gates mechanically; humans do not override the mutation gate without a signed risk acceptance.
- **Quarterly:** review thresholds, flake budget, TSR proposals, and per-product effectiveness trend.

---

## 11. Adoption roadmap (phased, low-friction)

1. **Phase 0 (week 1):** add `TESTING.md`/agent config rules (§5.1) to every repo; declare `critical-paths.md` (§3.1). Cheapest, highest-leverage step.
2. **Phase 1 (weeks 2–4):** stand up Testcontainers integration + given/when/then aggregate tests on one flagship (KoaHub or Bondyo); remove owned-code mocks.
3. **Phase 2 (weeks 4–6):** introduce diff-scoped mutation testing on the critical set; switch the CI gate from coverage to mutation on that repo.
4. **Phase 3 (weeks 6–8):** wire the agent generation→mutation-acceptance loop (§5.2) and the assertion/mock quality reports (§5.3–5.4).
5. **Phase 4 (ongoing):** TSR redundancy reports, flake budget, effectiveness-trend dashboard; roll the pattern across the portfolio.

---

## 12. Quick-reference checklist (paste into PR template)

```
[ ] New/changed critical code has given/when/then or property/metamorphic tests
[ ] No mocks of code we own; third-party mocks are contract-backed
[ ] No print/log used as an oracle; assertions constrain real behavior
[ ] Diff mutation score meets the product threshold; surviving mutants killed or annotated
[ ] No test added solely to raise coverage; redundant tests removed
[ ] Tests are deterministic (injected clock/seed, no live network, no ordering luck)
[ ] Tenant isolation asserted where the path is tenant-scoped
```

---

## 13. Summary of the core inversion

Old default (and the agent default): **write many tests, chase coverage, mock freely, ship green.**
This standard: **write few strong-oracle tests, gate on mutation-detected fault-finding, run real dependencies, reduce ruthlessly, and treat volume as a cost to control — not a quality to maximize.**

Every rule above traces to §2, which traces to §14.

---

## 14. References (effectiveness evidence base)

**Test effectiveness — foundational empirical work**

1. Inozemtseva, L., & Holmes, R. (2014). *Coverage Is Not Strongly Correlated With Test Suite Effectiveness.* ICSE 2014. — Coverage weakly predicts effectiveness once suite size is controlled. (Basis for P1.)
2. Just, R., Jalali, D., Inozemtseva, L., Ernst, M. D., Holmes, R., & Fraser, G. (2014). *Are Mutants a Valid Substitute for Real Faults in Software Testing?* FSE 2014. — Mutant detection correlates with real-fault detection, more strongly than coverage. (Basis for P2.)
3. DeMillo, R. A., Lipton, R. J., & Sayward, F. G. (1978). *Hints on Test Data Selection: Help for the Practicing Programmer.* IEEE Computer. — Origin of mutation testing; competent-programmer hypothesis and coupling effect.
4. Papadakis, M., Kintis, M., Zhang, J., Jia, Y., Le Traon, Y., & Harman, M. (2019). *Mutation Testing Advances: An Analysis and Survey.* Advances in Computers. — State of mutation testing and cost-control techniques.
5. Barr, E. T., Harman, M., McMinn, P., Shahbaz, M., & Yoo, S. (2015). *The Oracle Problem in Software Testing: A Survey.* IEEE TSE. — Basis for the oracle strategy (P3, §4.4).

**Oracles, properties, metamorphic testing**

6. Claessen, K., & Hughes, J. (2000). *QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs.* ICFP. — Property-based testing.
7. Chen, T. Y., et al. (2018). *Metamorphic Testing: A Review of Challenges and Opportunities.* ACM Computing Surveys. — Metamorphic oracles for oracle-hard/AI systems.

**Test doubles, structure, flakiness**

8. Meszaros, G. (2007). *xUnit Test Patterns: Refactoring Test Code.* — Test-double taxonomy (dummy/stub/spy/mock/fake).
9. Fowler, M. (2007). *Mocks Aren't Stubs*; (2018) *The Practical Test Pyramid.* — Double semantics and layering.
10. Cohn, M. (2009). *Succeeding with Agile.* — Test pyramid.
11. Beck, K. (2002). *Test-Driven Development: By Example.*
12. Luo, Q., Hariri, F., Eloussi, L., & Marinov, D. (2014). *An Empirical Analysis of Flaky Tests.* FSE 2014. — Basis for §7.5.

**Test-suite reduction / selection / prioritization**

13. Sebastian, A., Naseem, H., & Catal, C. (2024). *Unsupervised Machine Learning Approaches for Test Suite Reduction.* Applied Artificial Intelligence, 38(1), 2322336. — SMS of unsupervised TSR; K-Means prevalence, coverage-metric prevalence, scalability gap. (Basis for §7.4.)

**AI agents and test effectiveness (2025–2026)**

14. Chen, et al. (2026). *Rethinking the Value of Agent-Generated Tests for LLM-Based Software Engineering Agents.* arXiv:2602.07900. — Test volume ↛ resolution; agent tests are mostly observational prints + shallow assertions; interventions swing cost 35–49% not outcomes. (Basis for P4, §5.2, §5.5, §5.6.)
15. Hora, A., & Robbes, R. (2026). *Are Coding Agents Generating Over-Mocked Tests? An Empirical Study.* MSR 2026 / arXiv:2602.00409. — Agents over-mock (~36% vs ~26% within-repo) with narrower doubles; config rules (e.g., "never mock") measurably suppress it. (Basis for P5, §5.1, §5.3.)
16. Harman, M., et al. (2025). *Mutation-Guided LLM-Based Test Generation at Meta.* FSE 2025. — Mutation-guided feedback to steer generated tests toward fault-revealing power. (Basis for §5.2.)
17. Molinelli, D., Di Grazia, L., Martin-Lopez, A., Ernst, M. D., & Pezzè, M. (2025). *Do LLMs Generate Useful Test Oracles? An Empirical Study with an Unbiased Dataset.* ASE 2025. — Oracle quality of LLM-generated tests.
18. Alshahwan, N., et al. (2024). *Automated Unit Test Improvement using Large Language Models at Meta (TestGen-LLM).* — LLM test generation gated by measurable improvement, not volume.
19. Mündler, N., et al. (2024). *SWT-Bench: Testing and Validating Real-World Bug-Fixes with Code Agents.* — Benchmark for agent-generated tests.
