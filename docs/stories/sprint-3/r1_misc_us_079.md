# US-079: Claim a drift member retroactively with audit

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to assign an observed console member to a company retroactively so that the register stays the truth — this child delivers: the audited `claimDriftMember` action behind the existing Deriva claim modal, with a mandatory comment, authorized company and Person handling, a retroactive reconciliation assignment anchored on a system-materialized request and its transition, atomic episode resolution, and replay/race protection.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-079 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-exceptions |
| Server Actions | claimDriftMember |
| Entities | DriftEpisode (U resolve), Person (C/R), LicenseRequest (C system), RequestTransition (C), LicenseAssignment (C), AuditLog (C), Statement (R) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-078 |

## Acceptance Criteria

- [ ] AC1: `claimDriftMember` (SCR-exceptions Deriva claim modal: full_name, company_id, license_type_id, started_on, comentario) is callable only by an authenticated Ledger `group_admin` with `company:write` on a server-resolved company scope — never approver, finance or viewer, never caller-supplied authorization, no new role or capability. The trimmed non-empty comentario is mandatory (BR-24) and is persisted as `LicenseAssignment.note` and the AuditLog note; the human claimant is recorded in AuditLog while the system request's actors stay NULL (DEC-SMP-036).
- [ ] AC2: One transaction creates or reuses the Person (created from the mandatory full_name and the chosen company; an existing Person is reused only when consistent with the authorized company, otherwise the claim is refused), creates one LicenseRequest directly in `state = active` with `justification = 'reclamo por deriva'` and NULL `requested_by`/`decided_by`/`created_by`, one `NULL → active` RequestTransition with NULL actor, one LicenseAssignment with `source_kind = reconciliation`, `source_request_id` = that request, the admin-supplied `started_on` and the note, the audit entry, and resolves the pinned DriftEpisode as `claimed` (DEC-SMP-034, DEC-SMP-035, DEC-SMP-039). It never consumes an extra vendor seat or provisions anything.
- [ ] AC3: `started_on` must be a valid operating date no later than the claim date; the existing no-overlap exclusion and company/date integrity apply unchanged; a retroactive range that intersects a finalized statement is rejected at the claim boundary — no financial final is mutated and no reopen/close workflow is introduced (DEC-SMP-039).
- [ ] AC4: The current episode is pinned and locked for the claim: an identical replay returns the original result, a contradictory payload or a claim on an already-resolved or disappeared member returns a conflict, and any failure rolls back Person, request, transition, assignment, audit and resolution together — no partial writes.
- [ ] AC5: Demo: claiming a missing-Person member with full name, company, license, date and comment yields exactly one Person, one reconciliation assignment with the note, one active system request with NULL actors and one NULL-to-active transition, plus the human audit entry, and the episode leaves the Deriva tab; a repeated identical claim creates no second seat; an empty note, an unauthorized company, a `started_on` after today or intersecting a finalized statement, and a competing concurrent claim are each rejected with nothing persisted.

## Notes

- Canonical child of **US-030** (parent AC coverage: **AC2**), minted by **CHG-075** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-030.json`, proposal `claim-member`, estimate 260 min). Decisions DEC-SMP-034, DEC-SMP-036, DEC-SMP-039. Depends on US-078's episode evidence and shared contracts (`Blocked By`); sequential, not parallel-safe with US-080 (shared locale/package export surfaces; US-080's final verification consumes this action).
- **CHG-077 (2026-10-11):** the episode this claim resolves was opened from an accepted `MemberObservation` (US-083); a member with an identity/license warning has no episode and cannot be claimed (DEC-SMP-045).
- The ER model already specifies the system-materialized request shape (LicenseRequest lifecycle) and the mandatory note (BR-24, `AuditLog.note`); this child wires them behind the production action and adds the retroactive-date, replay and race rules. Runtime grants ship here only if missing.
- Vertical delivery: shared input/result contracts, production action wiring, authorization/audit, real-DB verification of atomicity, rollback, replay and races, locales, review, integration.
