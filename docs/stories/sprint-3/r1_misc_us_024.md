# US-024: Offboarding + deprovisioning

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to remove seats same-business-day on departure so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-024 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-person-detail, SCR-request-detail |
| Server Actions | startOffboarding |
| Entities | LicenseAssignment (U close), ProvisioningAction (C), Person (U) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020 |

## Acceptance Criteria

- [ ] AC1: `startOffboarding` (person detail / request detail) → state offboarding → removal via connector or checklist → deprovisioned
- [ ] AC2: Register row closes (ended_on, end_reason left_company/inactive/reallocated); pool increments next sync
- [ ] AC3: Departure flow can set Person.status='Salió del grupo'
- [ ] AC4: Offboardings with end_reason=left_company still not deprovisioned at end of the same business day raise `deprovision_overdue` (15-min alert-eval, business-day calendar, subject_ref=request) — BR-14

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
