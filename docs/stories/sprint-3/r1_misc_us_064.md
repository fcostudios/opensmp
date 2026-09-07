# US-064: Route provider no-seat responses to the capacity workflow

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As an End User (persona_05), I want to get my seat without human touch so that an approved request becomes a working license on the SLA — this child delivers: A classified provider 400/no-seat result atomically moves the request to blocked_no_seat through the lifecycle engine and exposes the existing US-023 purchase or reclaim path instead of generic failure.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-064 |
| Feature | FEAT-011, FEAT-012 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3–S4 |
| Screens | SCR-request-detail, SCR-exceptions |
| Server Actions | — |
| Entities | ProvisioningAction (U), LicenseRequest (U) |
| Business Rules | BR-09 |
| Blocked By | US-063, US-023, US-014 |

## Acceptance Criteria

- [ ] AC1: A classified provider 400/no-seat result moves the request atomically to `blocked_no_seat` through the lifecycle engine — never a generic failure, never a partial write.
- [ ] AC2: The request exposes the existing US-023 purchase-or-reclaim path from `blocked_no_seat`; resolving capacity returns it to `provisioning` through the engine, and the no-seat attempt is retained as evidence on its `ProvisioningAction`.
- [ ] AC3: Any other 4xx/5xx is NOT classified as no-seat (fail closed to the US-065 failure path).

## Notes

- Canonical child of **US-019** (parent AC coverage: **AC3**), minted by **CHG-054** on 2026-09-07 from the tenant's `partition_required` assessment (`docs/readiness/US-019.json`, proposal `provider-no-seat-routing`, estimate 104 min). Decision DEC-SMP-021.
- US-059..US-062 are retired tombstones (CHG-052); the id range restarts at US-063 so no tenant-local id is ever reused.
- Demo (from the assessment): Return a provider no-seat response and verify one legal blocked_no_seat transition, no failed transition, and visibility to the existing capacity-recovery workflow.
