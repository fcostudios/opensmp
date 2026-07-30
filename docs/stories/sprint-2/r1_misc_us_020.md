# US-020: Orchestration mode: checklist + confirm + verification

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to execute vendor steps manually with the same guarantees so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-020 |
| Feature | FEAT-013 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3, J2 |
| Screens | SCR-request-detail, SCR-exceptions |
| Server Actions | confirmChecklistDone, markChecklistNotDone |
| Entities | ProvisioningAction (U) |
| Business Rules | — |
| Blocked By | US-014, US-045 |

## Acceptance Criteria

- [ ] AC1: Orgs with mode=orchestration route provision/deprovision to a checklist ProvisioningAction (steps in raw_request) — via the connector-interface dispatch (US-045), independent of the API client (US-018): the PRD's week-2 milestone ships on this path alone
- [ ] AC2: SCR-request-detail pending-checklist panel renders steps + 'Confirmar ejecución' / 'Marcar no completada' (group_admin)
- [ ] AC3: `confirmChecklistDone` is the Group Admin's audited attestation and advances the request immediately through the same lifecycle transition as automated execution; the next member sync verifies later. A mismatch changes only the ProvisioningAction to `verification_failed` and surfaces an exception for remediation—it does not retroactively erase the attested lifecycle transition.

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
