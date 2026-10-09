# US-074: Daily inactivity flagging of anchor license requests

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want inactive people flagged automatically so that reclamation candidates are visible without my reading the usage screen — this child delivers: an audited daily job that sets `flagged_inactive` on the anchor LicenseRequest of every open assignment whose person trips the 30-day window against the lag-aware data-through date, never on apparent inactivity that is only the analytics lag, rerun- and race-safe, and that returns the request to `active` when activity resumes.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-074 |
| Feature | FEAT-021 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | (jobs) |
| Server Actions | — |
| Entities | LicenseRequest (U), RequestTransition (C), LicenseAssignment (R), ActivityRecord (R), AuditEntry (C) |
| Business Rules | BR-16, BR-15 |
| Blocked By | US-026, US-072 |

## Acceptance Criteria

- [ ] AC1: A daily `inactivityFlagging` schedule entry runs after `analyticsSync` (pg-boss runtime) and, using the shared lag function from US-072, transitions the anchor LicenseRequest of each open assignment whose person has been inactive for more than 30 days against `data_through` from `active` to `flagged_inactive`, with one RequestTransition and one audit entry per flag (DEC-SMP-028).
- [ ] AC2: The 60- and 90-day windows are display filters only; the job flags at 30 days and creates no ReclamationProposal; a person inactive only because of the ~3-day lag is never flagged (DEC-SMP-026, BR-16).
- [ ] AC3: When activity resumes, the job moves `flagged_inactive` back to `active` with its own RequestTransition and audit entry; a request in any other state is left alone.
- [ ] AC4: Rerun- and race-safe: the transition is a conditional UPDATE on the current state inside one transaction with the RequestTransition insert; a rerun changes nothing, a concurrent manual transition wins or loses cleanly, and another company's rows are untouched — proven with real-DB fixtures (activity ending 31 and 29 days before `data_through`: only the first is flagged).

## Notes

- Canonical child of **US-027** (parent AC coverage: **AC2** state side — the lag applied to the flag; **AC3** wholly), minted by **CHG-071** on 2026-10-07 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-027.json`, proposal `inactivity-flagging`, estimate 260 min). Decisions DEC-SMP-026/027/028. Depends on US-072's lag function (`Blocked By`).
- Flags are state, not action: BR-16 and BR-15 still gate any deprovisioning; `flagged_inactive → offboarding` is US-028's approve path.
- No schema migration (the state enum already carries `flagged_inactive`).
