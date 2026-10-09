# US-073: Batch reclamation proposals from SCR-usage

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to propose reclamation for the inactive people I select on SCR-usage in one audited batch with an optional note so that reclamation candidates reach the approvers — this child delivers: `proposeReclamations` creates at most one pending ReclamationProposal per open assignment, audited, idempotent on resubmission, company-isolated.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-073 |
| Feature | FEAT-021 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-usage |
| Server Actions | proposeReclamations |
| Entities | ReclamationProposal (C), LicenseAssignment (R), AuditEntry (C) |
| Business Rules | BR-16 |
| Blocked By | US-026, US-072 |

## Acceptance Criteria

- [ ] AC1: From SCR-usage, selecting people and submitting "Proponer reclamación" with an optional note runs `proposeReclamations` (group_admin with `company:write`, company-scoped, wrapped in `withAudit` and registered in audited-actions enforcement) and creates one pending ReclamationProposal per selected open assignment with the note and `proposed_by` = the admin, plus one audit entry per proposal.
- [ ] AC2: Idempotency comes from the existing partial UNIQUE on pending proposals per assignment via insert-on-conflict-do-nothing (DEC-SMP-027): resubmitting the same selection creates nothing; `client_request_id` is accepted and recorded in the audit entry, not persisted on the proposal — no migration.
- [ ] AC3: A person from another company in the payload is rejected as a whole-batch refusal; a non-group_admin role is refused.
- [ ] AC4: Demo: select three flagged people and submit a note — three pending proposals with the note and `proposed_by` = the admin exist, one audit entry each; resubmit the same selection — none created; include a foreign-company person — rejected; a non-group_admin — refused.

## Notes

- Canonical child of **US-027** (parent AC coverage: **AC1** batch action), minted by **CHG-071** on 2026-10-07 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-027.json`, proposal `propose-reclamations`, estimate 230 min). Decisions DEC-SMP-026/027/028. Depends on US-072's surface (`Blocked By`).
- Deciding proposals (approve/dismiss), suppression after a dismissal, `flagged_inactive → offboarding` and `/reclamaciones` stay with US-028. The inactivity job never creates proposals (DEC-SMP-028).
- No schema migration.
