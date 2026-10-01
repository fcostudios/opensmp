# US-068: Withdraw a pending invitation safely from exceptions

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to never leak seats into invite limbo so that a stale invitation's seat returns to the pool — this child delivers: an authorized Group Admin withdraws exactly the selected pending invitation with a required note, releases its seat reservation only after provider success, and sees the durable withdrawn action in the request trail.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-068 |
| Feature | FEAT-014 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S4 |
| Screens | SCR-exceptions, SCR-request-detail |
| Server Actions | withdrawInvite |
| Entities | ProvisioningAction (CU), LicenseRequest (U) |
| Business Rules | BR-13 |
| Blocked By | US-019, US-042, US-067 |

## Acceptance Criteria

- [ ] AC1: `withdrawInvite` (Group Admin, required note) withdraws exactly the selected pending invitation through an invitation-specific, vendor-neutral connector operation pinned to the durable provider invitation reference — never email-based member removal — and transitions the request invited → deprovisioned via the lifecycle engine.
- [ ] AC2: Invitation-only boundary (DEC-SMP-023): the seat reservation is released only after the provider confirms deletion; if the invitation was accepted concurrently, the withdrawal refuses and no active member or LicenseAssignment is removed; an ambiguous provider outcome fails closed with no state change.
- [ ] AC3: The manual withdrawal is a durable ProvisioningAction visible in the request's Acciones trail with the actor and note.
- [ ] AC4: Demo: withdraw an overdue invitation from exceptions and verify the provider invitation deletion, the invited → deprovisioned transition, the freed reservation and the note in Acciones; race withdrawal with acceptance and prove no active member or assignment is removed.

## Notes

- Canonical child of **US-021** (parent AC coverage: **AC2** manual trigger, **AC3** manual trail), minted by **CHG-063** on 2026-10-01 from the tenant's `partition_required` assessment (`docs/readiness/US-021.json`, proposal `manual-invite-withdrawal`, estimate 310 min). Decision DEC-SMP-023.
- This child owns the shared invitation-only withdrawal service that US-069 reuses for the scheduled trigger.
