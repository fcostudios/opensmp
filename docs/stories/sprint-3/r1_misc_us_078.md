# US-078: Open, resolve and list drift episodes from accepted member observations

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to catch console bypass within an hour so that the register stays the truth — this child delivers: the shared diff that turns any accepted complete member observation (api, csv_import or manual) into durable, deduplicated drift episodes, `register_drift` alerts about those episodes through the existing outbox, and the authorized Deriva listing with its count and its separate identity/license warnings. Evidence comes from US-083; the hourly production path is US-084.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-078 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-exceptions |
| Server Actions | — |
| Entities | DriftEpisode (CU), AlertEvent (C), MemberObservation (R), LicenseAssignment (R), VendorAccount (R), Person (R) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-089, US-090, US-092, US-093 |

## Acceptance Criteria

- [ ] AC1: One shared diff/upsert entrypoint in packages (no UI dependency) consumes an accepted `MemberObservation` (DEC-SMP-044) from any source. An unknown member is a `member` (never `invited`) with `seat_evidence = licensed` and a resolved `license_type_id`, with no open LicenseAssignment for the same normalized identity, vendor account and license type at `observed_at`, after the confirmed-provision adapter has run (US-090; accepted observation pipeline US-089); members carrying a warning are neither unknown nor known and are excluded (DEC-SMP-045). A missing Person stays unassigned drift; the diff never creates an assignment and never infers a company from an e-mail domain (DEC-SMP-034).
- [ ] AC2: Drift is persisted as DriftEpisode rows: one open episode per (vendor account, member identity, license type) enforced by a unique-open constraint, stable `first_seen_at`, `observed_at` = the latest accepted observation that still showed the member, the observing `source`, `resolved_at`/`resolution_reason`. A newer accepted observation without the member resolves the episode as `disappeared` without deleting alerts or closing register rows; reappearance opens a new episode; nothing but an accepted observation changes an episode (stale and conflicting snapshots never reach the diff); repeated and racing runs never multiply episodes (DEC-SMP-035). The append-only migration (`slug=drift_episodes`) ships the table, the constraint, RLS and grants with fresh-database apply and parity verification.
- [ ] AC3: The `register_drift` AlertRule fires about member drift: `subject_ref = {"drift_episode_id", "vendor_account_id"}`, one AlertEvent per enabled applicable rule and episode through the US-067 stable `dedupe_key`, delivered by the existing outbox with a tenant-safe link to the Deriva tab; acknowledgement never resolves an episode. New-event validation accepts only the canonical drift subject; the financial-variance facts and `reconciliationId` subject are retired for new events; historical reconciliation-subject AlertEvents stay readable through a legacy-compatible destination (DEC-SMP-038).
- [ ] AC4: `/excepciones?tab=drift` (SCR-exceptions, Deriva) lists open episodes — identity, account, license type, first seen, last observed, source; the suggested company is advisory only — with a real tab count replacing the placeholder zero, and shows the latest observation's identity/license warnings in a separate list with its own count, excluded from the episode count and from claiming (DEC-SMP-045); visible only to authenticated Group Admin; unattributed members are never attributed to a company; other tenants' rows never leak; no navigation entry is added; blocked/failed/invite and pool behaviour is preserved.
- [ ] AC5: Demo: equivalent accepted `api`, `csv_import` and `manual` observations fed to the entrypoint produce the same single episode and alert per unknown seat, while known open assignments, invitations, checklist-confirmed provisions and warned members produce nothing; a repeated run and a raced run add no episode or alert; a newer accepted observation without the member resolves it as `disappeared` with the alert still readable; a historical reconciliation-subject alert still renders; the Deriva tab shows the episodes, the count and the warnings list to a Group Admin and refuses other roles. The actual hourly producer is US-091 with shared verification from US-090. Under DEC-SMP-048, the real hourly wiring and end-to-end demo is a named obligation owed and budgeted by whichever of US-093 and US-091 integrates second; neither may claim that proof complete before it actually runs.

## Notes

- **CHG-086 (2026-10-12):** US-083 was partitioned; this story consumes accepted observations and now depends on **US-089**.
- Canonical child of **US-030** (parent AC coverage: **AC1** — the drift outcome of the detection chain), minted by **CHG-075** on 2026-10-11 and **amended by CHG-077** the same day after the tenant's blocked readiness (`docs/readiness/US-078.json`, 540 min / 38 files): the connector contract repair, observation ledger and warnings moved to **US-083**; the hourly worker and confirmed-provision composition to **US-084**. Decisions DEC-SMP-034, DEC-SMP-035, DEC-SMP-038, DEC-SMP-045. Depends on US-083 (`Blocked By`); parallel-safe with US-084 subject to the tenant's file-boundary review, otherwise after it. **US-079** (claim) and **US-080** (metric) build on the episode evidence this child delivers. Nous allocation target ≈ 260 min; the tenant re-assesses — if the post-foundation inventory still exceeds 20 files, Nous allocates a further independently demonstrable outcome (e.g. alert correction + legacy readability apart from episodes + Deriva), never a technical layer.
- Owns the shared diff/upsert entrypoint that **US-055** calls for every successful `importMembersCsv` (after producing its observation through US-089's acceptance pipeline); US-055 implements no second drift algorithm.
- Vertical delivery: migration + grants, packages diff/upsert, alert contract correction, Deriva listing + warnings, locales, verification (all sources, races, disappearance, legacy alerts, authorization), review, integration.

- **CHG-099 / DEC-SMP-048/049 (2026-10-15):** approved verification parent after Francisco selected B+narrow V1 at packet4589abe. US-092 owns financial false-drift retirement, strict new-event subject and legacy destination (parentAC3 plus matchingAC5 clauses); US-093 owns accepted-source diff, actual persisted episodes/RLS/grants/migration, real rule/dedupe/outbox/link/ack behavior, authorized Deriva/warnings and remainingAC1–AC5. Parent owns integrated AC verification, not a second implementation. Original allocations, costs and approvals remain history.
- **Current dependency/owner correction supersedes older Notes above:** US-089 supplies accepted observations; US-090 owns the mandatory first provision-verification adapter before US-093's diff; US-091 owns actual hourly composition. The original US-083/US-084 references record partition history, not current executable prerequisites. US-055 calls the same diff supplied by US-093, never a second drift algorithm. US-079/080 remain downstream under their own readiness; no successor starts from this allocation alone.
- **DEC-SMP-048 / named hourly obligation:** whichever of US-093 and US-091 integrates second owns real hourly wiring plus production end-to-end equivalence proof. Both owners inventory and budget any necessary runtime/test files in their own current readiness; no synthetic call, borrowed proof or unowned debt. This is not a circular unconditional Blocked By edge or deletion of AC5. Parent verification must account for the actual obligation and cannot mark required outstanding proof complete.
- **DEC-SMP-049:** CHG-100→CHG-101→CHG-102 are the separately allocated technical verifier outcomes. Product DriftEpisode schema/migration/RLS/grants remains US-093; the parent no longer declares the migration. CHG-102 must integrate before US-093 executable readiness; functional contract edits remain denied until then. Each item needs its own current exact readiness; no blocked-parent digest or implementation approval is inferred.
- Scope/delivery estimates: US-092255minutes/9paths; US-093320minutes/19conditional paths. CHG-100250..310/9paths, CHG-101185..240/5paths, CHG-102255..320/5..7paths. All later actual source/envelope inventories follow existing counting/320/20limits; no cost reset or hidden expansion. Existing CHG-093/US-090 P4(a) order and ownership remain; no code, tests or readiness ledger changed here.
