# US-065: Recover failed automated provisioning with an operator retry

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As an End User (persona_05), I want to get my seat without human touch so that an approved request becomes a working license on the SLA — this child delivers: Non-no-seat invitation failures persist a safe failure_reason, raise provisioning_failure, and retryProvisioning returns the same tenant-scoped request to provisioning without duplicate live actions.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-065 |
| Feature | FEAT-011, FEAT-012 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3–S4 |
| Screens | SCR-request-detail, SCR-exceptions |
| Server Actions | retryProvisioning |
| Entities | ProvisioningAction (CU), LicenseRequest (U) |
| Business Rules | BR-09 |
| Blocked By | US-063, US-042, US-014 |

## Acceptance Criteria

- [ ] AC1: A non-no-seat invitation failure moves the request to `failed` with a safe, sanitized `failure_reason` (no credential, header or body echo) and raises the `provisioning_failure` alert (US-042).
- [ ] AC2: `retryProvisioning` returns the same tenant-scoped request to `provisioning` through the engine and re-executes the invitation with a NEW `ProvisioningAction`; a retry can never issue a duplicate live invitation for an attempt whose outcome is unresolved (US-057's requested/known-success/known-failure/unresolved states decide).
- [ ] AC3: Retry is authorized for the request's company scope only; a cross-company retry is rejected server-side (403).

## Notes

- Canonical child of **US-019** (parent AC coverage: **AC1**), minted by **CHG-054** on 2026-09-07 from the tenant's `partition_required` assessment (`docs/readiness/US-019.json`, proposal `provisioning-failure-retry`, estimate 104 min). Decision DEC-SMP-021.
- US-059..US-062 are retired tombstones (CHG-052); the id range restarts at US-063 so no tenant-local id is ever reused.
- Demo (from the assessment): Force a non-no-seat provider failure, verify failed state, sanitized reason, and one alert, then retry and verify one legal return to provisioning without duplicate provider execution.
