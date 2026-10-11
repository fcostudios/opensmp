# US-076: Confirm person departure through the offboarding flow

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to mark a person as having left the group when I remove their seats so that the register and the people list agree — this child delivers: an explicit, unchecked-by-default departure confirmation in the `left_company` offboarding flow that sets the persisted `Person.status = departed` (displayed "Salió del grupo") in the same audited transaction that starts removal of all the person's open anchored seats in my company, while inactivity/reallocation removals leave the person's status untouched.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-076 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-person-detail, SCR-request-detail |
| Server Actions | startOffboarding |
| Entities | Person (U), LicenseAssignment (R), LicenseRequest (U), AuditLog (C) |
| Business Rules | — |
| Blocked By | US-019, US-020, US-075 |

## Acceptance Criteria

- [ ] AC1: In the `left_company` flow on either detail screen, an explicit confirmation (unchecked by default) sets `Person.status = departed`, shown as "Salió del grupo" through the existing locale catalog and people status projection (no new enum, no persisted display string), in the same audited transaction that starts removal of every open anchored seat of that person in the authorized company through the US-075 entrypoint (DEC-SMP-032).
- [ ] AC2: Without the confirmation the person's status is unchanged; `inactive` and `reallocated` removals never mark departure; from request detail the removal targets that request's own assignment unless the admin explicitly chooses person-wide departure. The previous automatic marking of `left_company` departures as `departed` is retired (DEC-SMP-032).
- [ ] AC3: A foreign-company seat in the person's set, or a concurrent status change or start failure, rolls back the departure update and its audit entry; nothing is left half-applied.
- [ ] AC4: Demo: a person with two anchored seats across two accounts in one company is marked departed only when the admin confirms, and both removals start atomically; without confirmation status stays; an `inactive` removal leaves status untouched; a foreign-company seat or an injected concurrent failure rolls back status and audit.

## Notes

- Canonical child of **US-024** (parent AC coverage: **AC3**), minted by **CHG-074** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-024.json`, proposal `departure-confirmation`, estimate 240 min). Decision DEC-SMP-032. Depends on US-075's entrypoint (`Blocked By`); parallel-safe with US-077 after US-075 integrates (people/UI surface vs alert/calendar surface).
- `packages/contracts/src/people.ts` already carries `active / departed`; this child adds the confirmation, the atomic person-wide start and the rollback, not a new state.
- Vertical delivery: contracts, both detail screens, authorization/audit, real-DB verification of atomicity and rollback, review, integration. No migration expected.
