# US-019: Automated provisioning: invite ≤ 15 min → Active

> **Sprint 3** | **P0** | **5 SP** | **R1**

## User Story

As a End User (persona_05), I want to get my seat without human touch so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-019 |
| Feature | FEAT-011, FEAT-012 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 5 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3–S4 |
| Screens | SCR-request-detail, SCR-exceptions |
| Server Actions | retryProvisioning |
| Entities | ProvisioningAction (CU), LicenseAssignment (C), LicenseRequest (U) |
| Business Rules | BR-09 |
| Blocked By | US-018, US-014, US-046, US-042 |

## Acceptance Criteria

- [ ] AC1: On approval with free pool: invite created ≤15 min; state→provisioning→invited; failure→failed + `failure_reason` + provisioning_failure alert; `retryProvisioning` returns to provisioning
- [ ] AC2: Membership polling (15-min job) detects acceptance → state active + LicenseAssignment row opens (started_on, source_request_id)
- [ ] AC3: 400-no-seat → blocked_no_seat path (US-023); all transitions via the engine

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
