# US-070 terminal verification evidence

Completed locally on `feature/analytics/daily-person-activity`. Tested source `e03e465e3e8be975bcaf8ca05662f0bf93bfb25a`; authority base `ed9ff60d9dda6aaf78fae5e9a61d189b1a8e4108`. The following evidence-only closure commit changes no scored source/test/config/dependency. No merge or push.

All three scoped task reviews and the gpt-6-astra broad/final combined scoped review approved; all four ACs pass. `pnpm check` exit0/202.404s: types9/9, lint8/8, tests15/15 (13cached; fresh worker192passed8skipped, DB309passed; cached web926passed3skipped), build9/9 with fresh worker and Next webpack. Independent fresh62committed migrations applied;32tables,5append-onlytriggers/exactrolegrants; parity341columns84FK39enums2governedchecks10unique, all gates exit0. Earlier failed fullcheck attempts1062.456s and132.075s remain retained evidence/actuals.

One cold cache-cleared diff campaign:91.05914718019257%=(661Killed+1Timeout)/727;61Survived4NoCoverage,0excludederrors. Seven shards all passed;727.336s scored command,730.044s outer lifecycle. Independent exact review65/65:46equivalent19accepted0unapproved. Timeout116 removes client.release and is detected, never a survivor. Start/end/current/committed hashes match. Cache cleared once; no host power interruption; fixture and owned cluster stopped cleanly, all owned IDs absent. Historical preview DROP ROLE2BP01 errors remain historical failed teardown with proven container containment.

Actuals: `{"readiness": 7, "implementation": 46, "focused_verification": 102, "review": 22, "integration": 63}`, total240min, variance-30min versus270. Source-cutoff24paths/13commits; one final evidence commit excluded from those source metrics. Five formal fix loops;10previewrounds/19shardruns,46.5369167min→47;1coldattempt/0invalidations,12.1222667min→12;7actualshards versus5estimated. Metrics do not add preview/cold time twice. [Exact intervals and objects](us-070-measurement.json).

Measured done.cost controller subtotal `{"calls": 704, "context_tokens": 190698, "output_tokens": 168365, "model": "gpt-6.1-sol", "window": 258400}`. [Scoped metadata](us-070-cost-metadata.json) states exact capture cutoffs and exclusions; full-task aggregate unavailable.

[Independent cold signoff](us-070-cold-residual-signoff.md), [exact native residual locations/replacements](us-070-cold-residuals.json), [review and gate history](us-070-reviews.md), [compressed native reports/manifests/logs and scratch history](us-070-artifacts.tar.gz), [artifact SHA-256 manifest](us-070-artifacts-manifest.json). Every archived file was extracted and hash-compared before cleanup. Historical critical-path delivery report remains reachable at `bd151bda2a8ecce435f3b5d43d08ed6aa65b9338` and is copied durably in review history.

Material limits: company audit summary retains scoped warningCount but omits the design-promised summary note (accepted M1); exact global warning details remain durable and canonical AC2 passes. No authenticated live-provider demo is claimed; real services-backed deterministic PostgreSQL/queue/Pact evidence supplies AC4. No root US026 completion or US071 work is claimed.

## Exhaustive controller rulings (15)

Ruling: Task 1 seeds distinct globally unique Person emails and proves isolation with a foreign-only email passed to company A — the existing global uq_person_lower_email makes the planned same-email cross-company fixture impossible; preserve canonical identity schema — cost if wrong: isolation fixture rework, no production schema impact. Sent to implementer.

Ruling: Task 1 may update only expected activity column grants in packages/db/scripts/verify-schema.mjs — the existing verifier hard-codes expected privileges and would otherwise reject the approved migration; preserve verifier logic — cost if wrong: grant-map rework and schema-gate rejection. Treat as required schema verification metadata, not new tooling. Add path to touched-preview discovery.

Ruling: authorize private activity allowlist construction inside normalizeActivityCounters once static-mutant import ordering is evidenced — manual source replacement kills the tests but all20 import-time declaration mutants survive the runner activation seam; preserve public fields/behavior and change no harness/cache/lifecycle — cost if wrong: modest per-record construction overhead and refactor rework. Contracts59.42%; ingestion repaired92.43%; schema91.67% retained.

Ruling: final broad reviewer uses available task-review rubric extended to approved whole-branch architecture/AC1..4 and deferred findings because referenced requesting-code-review/code-reviewer.md template is absent in both skill roots — review scope/model/diff/evidence gates remain binding — cost if wrong: reviewer-format rework, no production change.

Ruling: Task3 may correct only analytics-ingestion.ts relative imports to schema.js/system-ids.js — worker NodeNext type-check cannot consume delivered extensionless shared export, crossscope correction is necessary without semantic change — cost if wrong: import rework and ingestion preview minutes.

Ruling: Task3 uses existing two-role Anthropic credential composition and fixtures seed encrypted admin_scoped plus analytics credentials — existing dispatcher factory requires both, approved work reuses credential architecture and preserves endpoint keyseparation — cost if wrong: unnecessary credential coupling needs bounded connector follow-up; independent review assesses required analytics-only behavior.

Ruling: final verification scratch launcher owns a disposable shared PostgreSQL cluster plus scoped fixture, stopping fixture then owning cluster in outer finally — both private-preview helper DROP ROLE failures are observed2BP01 dependencies and container containment is proven; this uses existing exports without scored source/config/harness change — cost if wrong: bounded teardown repair and verification-stage infrastructure rework, never suppressed diagnostics.

Ruling: retain Minor M1 company-summary note omission as an explicit design discrepancy; do not add an account-level summary — independent whole-branch review verifies exact global warning detail persistence and existing globally authorized audit visibility satisfy canonical AC2, while company summaries correctly retain scoped counts in after — cost if wrong: bounded summary-note follow-up and operator discoverability rework; no warning evidence is lost.

Ruling: fix Minor M2 through normal Nous critical-path config preservation and generated-guide delivery, not production ambiguity behavior — approved interfaces and real atomic rejection assertions are binding, so generated warning prose is incorrect — cost if wrong: documentation/provenance rework only, no scored source change.

Ruling: classify the contracts null-guard residual as @accepted diagnostic difference, retaining Task1 narrower interpretation — removing the guard changes incidental Error subtype at Object.getPrototypeOf(null), so Task2 literal-equivalence label overstates its guarantee while acceptance/rejection stays tested — cost if wrong: exact residual annotation rework or targeted diagnostic oracle, never an unapproved genuine behavior waiver.

Ruling: rerun one covering full pnpmcheck on unchanged scored code after the verified host suspension, without production/test/harness repairs — bounded pmset evidence records Dark Wake Thermal Emergency sleep997seconds matching unrelated993second test stalls and delayed timeout timers; it is an external execution interruption — cost if wrong: one additional gate run and deeper environment diagnosis, no weakened timeout/assertion/config.

Ruling: correct only the two existing worker-runtime oracles that still require the analytics deferred stub, preserving real queue/cron/vendor-account dedup assertions — full unchanged-code gate now reaches these tests and proves analytics success replaced generic/skipped stub logs; root authorized this bounded test adjustment within the ongoing final fix wave before its single combined scoped re-review — cost if wrong: focused queue contract rework and necessary selected-test preview, no production/harness weakening.

Ruling: retain all seven existing scoped previews and run zero touched previews after e03e465 — actual fixture-scoped ordinary preflight exits0 with7shards, runtime.integration.test.ts absent from every selected source/test seam, and production/dependencies/config unchanged; exact current manifest SHA2564375b68d388386f1fa721bc95a1ce69f431b7f7fc29168bc8a354fb5db6255a2 — cost if wrong: targeted affected-seam re-preview before cold, never blanket duplicate campaigns.

Ruling: retain the independent cold reviewer’s narrower @accepted diagnostic classifications for dispatch residuals18/19 — both still reject unsupported inputs but may change Error to TypeError, so literal equivalence would overstate the guarantee — cost if wrong: residual annotation rework or a targeted typed-diagnostic oracle; no genuine behavior waiver.

## Closure checks

Readiness validator passed the closed US-070 payload. The separate feedback-order validator reports only inherited base lines945–954 (CHG-065 timestamp ordering) and964–965 (US-026 feedback before started). All970base ledger lines remain byte-identical; no new US-070 ordering error. This historical limitation is retained and is outside US-070. The green full `pnpm check` and campaign remain unchanged.

Final evidence tree:33changed paths against authority base;15reachable item commits after closure (13tested-source commits,1artifact preservation/scratch removal commit,1terminal feedback/actuals commit). Source-bound actuals intentionally remain24paths/13commits. Measurement snapshot lists every final path and preserved artifact SHA-256; the terminal commit itself is identified by Git after creation, never by a fabricated self-hash.


Ruling: use one artifact-preservation and tracked-scratch-removal commit before the single terminal feedback/actuals commit — the existing readiness gate classifies evidence and scratch paths as implementation and rejects candidate done as inactive, while all terminal feedback and actuals remain together as required — cost if wrong: one extra docs-only commit to reconcile; no gate bypass, scored-source change or repeated campaign. Root explicitly authorized this ordering.

Closure overhead after the recorded05:32:16.929492Z measurement cutoff (archive/stage/validator/commit operations) is excluded from the source-bound phase measurement and scoped cost snapshots; recorded240minutes must not be presented as an exhaustive end-to-end aggregate. The root mixed assessment remains excluded.
