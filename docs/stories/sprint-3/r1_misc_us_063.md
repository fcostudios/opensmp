# US-063: Deliver approved requests as vendor invitations within 15 minutes

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As an End User (persona_05), I want to get my seat without human touch so that an approved request becomes a working license on the SLA — this child delivers: A free-pool approved request executes the real connector invitation and durably reaches invited within the SLA, with provider reference and observation evidence bound to its ProvisioningAction.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-063 |
| Feature | FEAT-011, FEAT-012 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3–S4 |
| Screens | SCR-request-detail (worker-driven) |
| Server Actions | — |
| Entities | ProvisioningAction (CU), LicenseRequest (U) |
| Business Rules | BR-09 |
| Blocked By | US-056, US-057, US-058, US-014, US-046, US-042 |

## Acceptance Criteria

- [ ] AC1: A free-pool approved request executes exactly one real connector invitation through the Anthropic connector (US-056/058) and the request moves provisioning → invited within 15 minutes of approval, every transition via the lifecycle engine (US-014).
- [ ] AC2: The provider reference and the `ConnectorCallObservation` evidence (US-057) are bound to the request's `ProvisioningAction` before `invited` is durable; a crash between the network call and the state write cannot produce an invitation without evidence or evidence without a state.
- [ ] AC3: Demo: approve a free-pool request, run the provisioning worker (US-046), and observe `provisioning` then `invited` within 15 minutes with one provider invitation and durable attempt evidence.

## Notes

- Canonical child of **US-019** (parent AC coverage: **AC1**), minted by **CHG-054** on 2026-09-07 from the tenant's `partition_required` assessment (`docs/readiness/US-019.json`, proposal `automated-invite-delivery`, estimate 104 min). Decision DEC-SMP-021.
- US-059..US-062 are retired tombstones (CHG-052); the id range restarts at US-063 so no tenant-local id is ever reused.
- Demo (from the assessment): Approve a free-pool request, run the provisioning worker, and verify provisioning then invited within 15 minutes with one provider invitation and durable attempt evidence.
