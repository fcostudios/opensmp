# US-066: Activate accepted invitations from the 15-minute membership poll

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As an End User (persona_05), I want to get my seat without human touch so that an approved request becomes a working license on the SLA — this child delivers: Scheduled tenant-scoped polling detects invitation acceptance and atomically moves invited to active while opening exactly one LicenseAssignment with started_on and source_request_id.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-066 |
| Feature | FEAT-011, FEAT-012 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3–S4 |
| Screens | (worker) SCR-request-detail |
| Server Actions | — |
| Entities | LicenseAssignment (C), LicenseRequest (U), ProvisioningAction (U) |
| Business Rules | BR-09 |
| Blocked By | US-063, US-046, US-014 |

## Acceptance Criteria

- [ ] AC1: A scheduled, tenant-scoped 15-minute membership poll (US-046) detects that an invited member accepted and moves `invited` → `active` atomically through the lifecycle engine.
- [ ] AC2: Exactly one `LicenseAssignment` opens per activation with `started_on` and `source_request_id`; re-polling an already-active member creates no second assignment (idempotent by `source_request_id`).
- [ ] AC3: Poll evidence (page cursor, page count, member set size) is recorded on the request's `ProvisioningAction`; a poll interrupted mid-page resumes without double-activation.

## Notes

- Canonical child of **US-019** (parent AC coverage: **AC2**), minted by **CHG-054** on 2026-09-07 from the tenant's `partition_required` assessment (`docs/readiness/US-019.json`, proposal `accepted-invite-activation`, estimate 104 min). Decision DEC-SMP-021.
- US-059..US-062 are retired tombstones (CHG-052); the id range restarts at US-063 so no tenant-local id is ever reused.
- Demo (from the assessment): Run the membership poll before and after provider acceptance; verify the second run creates exactly one assignment and one invited-to-active transition, and replay creates neither again.
