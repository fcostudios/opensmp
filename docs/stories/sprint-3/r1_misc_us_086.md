# US-086: Start anchored seat removal from both detail screens

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to start a seat removal from a person or a request so that the departure clock and the removal work begin immediately — this child delivers: the shared authorized `startOffboarding` entrypoint on SCR-person-detail and SCR-request-detail for `left_company`/`inactive`, the anchor request's `active → offboarding` transition, the `remove` ProvisioningAction created `pending`, and execution selection (connector vs checklist) from the persisted capability descriptor.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-086 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-person-detail, SCR-request-detail |
| Server Actions | startOffboarding |
| Entities | LicenseRequest (U), RequestTransition (C), ProvisioningAction (C), LicenseAssignment (R), VendorAccount (R), AuditLog (C) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020 |

## Acceptance Criteria

- [ ] AC1: `startOffboarding` from SCR-person-detail or SCR-request-detail (group_admin, company-scoped, audited) accepts `end_reason ∈ {left_company, inactive}` only and refuses `reallocated` as a BR-02 transfer (DEC-SMP-040); it moves the anchor LicenseRequest `active → offboarding` — the transition whose timestamp anchors the BR-14 deadline (DEC-SMP-029) — creates one ProvisioningAction `kind = remove`, `status = pending`, and selects connector or checklist execution from the persisted US-025 capability descriptor. From request detail the target is that request's own assignment; an explicit `read_targets` intent through the same action lists the authorized targets without writes. Person.status is never touched (DEC-SMP-032); capacity never moves at start (DEC-SMP-031).
- [ ] AC2: Refusals leave nothing behind: another company's seat, a non-group_admin role, a malformed or mismatched target, a request not in `active`, and a repeated start of an already-offboarding request each write no transition, action or audit entry; a concurrent double start creates one transition and one action.
- [ ] AC3: Demo (start half of US-075 AC4): from both detail screens start a `left_company` and an `inactive` removal on one checklist-backed and one connector-backed seat; each request is `offboarding` with one `pending` remove action and the right execution path; `reallocated`, a foreign seat and a non-admin role are refused; unrelated seats of the same person are untouched; free capacity does not move.

## Notes

- Canonical child of **US-075** (its AC1 and the start half of AC4), minted by **CHG-083** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/US-075.json`, proposal `anchored-removal-start`, envelope 230 min). First child; no sibling dependency. Existing US-075 work (Task 1 checkpoints, the CHG-079 route `people-action-service.ts → repository.integration.test.ts`) and its incurred cost are preserved and carried here; they are not re-done or re-counted.
- Consumers of this entrypoint: **US-087** (completes checklist removals), **US-076** (departure confirmation), **US-077** (overdue alert reads the transition), **US-028** (approved reclamation). Connector dispatch stays **US-082**.
