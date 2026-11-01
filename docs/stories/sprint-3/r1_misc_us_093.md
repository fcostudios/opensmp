# US-093: Detect accepted member drift episodes and expose real alerts and Deriva

> **Sprint 3** | **P0** | **1 SP** | **R2**

## User Story

As a Group Admin (persona_01), I want accepted membership observations to produce durable drift episodes, real tenant-safe alerts and an authorized Deriva view, so that I can investigate unattributed licensed seats without creating assignments or inferring companies.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-093 |
| Feature | FEAT-023 |
| Sprint | 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R2 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-exceptions |
| Server Actions | — |
| Entities | DriftEpisode (CU), AlertEvent (C), MemberObservation (R), LicenseAssignment (R), VendorAccount (R), Person (R) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-089, US-090, US-092 |
| Migration | slug=drift_episodes |

## Acceptance Criteria

- [ ] AC1: One shared diff/upsert entrypoint in packages (no UI dependency) consumes an accepted `MemberObservation` (DEC-SMP-044) from any source. An unknown member is a `member` (never `invited`) with `seat_evidence = licensed` and a resolved `license_type_id`, with no open LicenseAssignment for the same normalized identity, vendor account and license type at `observed_at`, after the confirmed-provision adapter has run (US-090; accepted observation pipeline US-089); members carrying a warning are neither unknown nor known and are excluded (DEC-SMP-045). A missing Person stays unassigned drift; the diff never creates an assignment and never infers a company from an e-mail domain (DEC-SMP-034).
- [ ] AC2: Drift is persisted as DriftEpisode rows: one open episode per (vendor account, member identity, license type) enforced by a unique-open constraint, stable `first_seen_at`, `observed_at` = the latest accepted observation that still showed the member, the observing `source`, `resolved_at`/`resolution_reason`. A newer accepted observation without the member resolves the episode as `disappeared` without deleting alerts or closing register rows; reappearance opens a new episode; nothing but an accepted observation changes an episode (stale and conflicting snapshots never reach the diff); repeated and racing runs never multiply episodes (DEC-SMP-035). The append-only migration (`slug=drift_episodes`) ships the table, the constraint, RLS and grants with fresh-database apply and parity verification.
- [ ] AC3: The `register_drift` AlertRule fires about member drift: `subject_ref = {"drift_episode_id", "vendor_account_id"}`, one AlertEvent per enabled applicable rule and episode through the US-067 stable `dedupe_key`, delivered by the existing outbox with a tenant-safe link to the Deriva tab; acknowledgement never resolves an episode. New-event validation accepts only the canonical drift subject; consume US-092's already delivered strict new-event subject and legacy-readable destination; its financial-retirement behavior is not reimplemented here (DEC-SMP-038).
- [ ] AC4: `/excepciones?tab=drift` (SCR-exceptions, Deriva) lists open episodes — identity, account, license type, first seen, last observed, source; the suggested company is advisory only — with a real tab count replacing the placeholder zero, and shows the latest observation's identity/license warnings in a separate list with its own count, excluded from the episode count and from claiming (DEC-SMP-045); visible only to authenticated Group Admin; unattributed members are never attributed to a company; other tenants' rows never leak; no navigation entry is added; blocked/failed/invite and pool behaviour is preserved.
- [ ] AC5: Demo: equivalent accepted `api`, `csv_import` and `manual` observations fed to the entrypoint produce the same single episode and alert per unknown seat, while known open assignments, invitations, checklist-confirmed provisions and warned members produce nothing; a repeated run and a raced run add no episode or alert; a newer accepted observation without the member resolves it as `disappeared` with the alert still readable; a historical reconciliation-subject alert still renders; the Deriva tab shows the episodes, the count and the warnings list to a Group Admin and refuses other roles. The actual hourly producer is US-091 with shared verification from US-090. Under DEC-SMP-048, the real hourly wiring and end-to-end demo is a named obligation owed and budgeted by whichever of US-093 and US-091 integrates second; neither may claim that proof complete before it actually runs.

## Notes

- Canonically allocated by CHG-099 after Francisco selected exact B+narrowV1 packet4589abe; readiness is not approved by this allocation. Parent US-078 verifies integrated coverage rather than reimplementing children. Existing US-088/089 closed evidence/costs remain unchanged. Own current full gate, meaningful scoped/fresh final review, realDB proof and applicable own preflight/cold are required; no borrowed scores, source/tests changed or started event here.
- Existing US-084/090/091 and CHG-093/096/097/098 remain with their owners; no takeover, code scope expansion or P4(a) override. BR-24 remains non-critical, settled existing TESTING§3 guidance applies; no new guide/pin/toolchain delivery. Hard320minutes/20actualdelivery paths and all current ownership/readiness/authority rules remain.
- Proposal accepted-episodes-and-deriva. Allocation estimate320active minutes: readiness25/implementation100/focused105/review65/integration25;19conditional delivery paths+4bookkeeping. Depends on US-092 and actual completed/deliveredUS-090; the technical CHG-102 controlled admission route must integrate BEFORE executable readiness. Technical prerequisites are named here rather than an invalid CHG-valued story Blocked By row.
- Frozen proposed delivery inventory: packages/db/src/schema.ts, packages/db/src/migrations/V<authoring-UTC>__drift_episodes.sql, packages/db/src/migrations/V<authoring-UTC>__verify_drift_episodes.sql, packages/db/src/physical-schema.integration.test.ts, packages/db/src/migration-release.integration.test.ts, packages/db/src/drift-episodes.ts, packages/db/src/drift-episodes.integration.test.ts, packages/db/src/index.ts, packages/db/package.json, apps/web/src/modules/drift-read.ts, apps/web/src/modules/drift-read.integration.test.ts, apps/web/src/app/(authenticated)/excepciones/page.tsx, apps/web/src/app/(authenticated)/excepciones/exceptions-view.tsx, apps/web/src/app/(authenticated)/excepciones/exceptions-view.test.tsx, apps/web/messages/en-US.json, apps/web/messages/es-EC.json, apps/web/src/lib/i18n/catalogs.test.ts, scripts/mutation-routes.json, packages/db/schema-contract.json. This includes its owned new product migration/table/RLS/grants plus matching additive contract data, never a technical schema layer. Existing injected transaction/outbox SQL seam must be proven by its own real tests; two extra required adapters would make19+2=21 and require normal repartition, not hidden files or stretched320.
- ParentAC1/2/4 plus actual episode/rule/dedupe/outbox/link/recipient/ack portionsAC3 and remainingAC5 belong here. US-092 owns financial retirement/strict new subject/legacy destination; shared AC3/AC5 rationale is the full integration proof across both outcomes.
- DEC-SMP-048 exact real-hourly obligation is owed by whichever of this story and US-091 integrates second: production wiring and real end-to-end accepted API/CSV/manual equivalence, not a synthetic call. Record/budget actual worker/test paths in the owning current readiness, preserve all parentAC5 proof and no unowned debt. Parent verification cannot claim outstanding assigned proof complete.
- DEC-SMP-049: CHG-100→CHG-101→CHG-102 establish closed attestation/single-source/additive authority. This story may not change executable verifier/tooling or existing contract expectations under functional scope. Only owned new table/data/migration under the separately delivered finite policy; no rawSQL/module data or CHG-088 exception expansion.
- Already-settled U10: enabled global rules and matching vendor_account rules apply to open unassigned episodes; company rules never do, GroupAdmin-only visibility, existing escalation-setting delivery boundary, no company inferred from account/domain/Person. These are implementation/proof requirements, not new product approval questions.

- CHG-113 / DEC-SMP-065/066: R2; no further R1 work.
