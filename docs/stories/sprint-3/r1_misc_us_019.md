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
| Blocked By | US-056, US-057, US-058, US-014, US-046, US-042, US-063, US-064, US-065, US-066 |

## Acceptance Criteria

- [ ] AC1: On approval with free pool: invite created ≤15 min; state→provisioning→invited; failure→failed + `failure_reason` + provisioning_failure alert; `retryProvisioning` returns to provisioning
- [ ] AC2: Membership polling (15-min job) detects acceptance → state active + LicenseAssignment row opens (started_on, source_request_id)
- [ ] AC3: 400-no-seat → blocked_no_seat path (US-023); all transitions via the engine

## Notes

- **CHG-054 (2026-09-07) — partitioned.** At 5 SP × 104 min/SP = 520 min this parent exceeds the 320-minute execution budget (IMP-374). Partitioned into four canonical 1-SP children from the tenant's `partition_required` assessment: US-063 (AC1 — invitation ≤ 15 min), US-064 (AC3 — no-seat routing), US-065 (AC1 — failure + `retryProvisioning`), US-066 (AC2 — acceptance poll → active + LicenseAssignment). The parent closes by parent-level verification once the children are dev_done (the US-018 / CHG-052 shape). US-059..062 are retired tombstones; the child range starts at US-063. Decision DEC-SMP-021.
- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
