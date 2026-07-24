# US-012: Request intake with validations

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a End User (persona_05), I want to request a license in one clear form so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-012 |
| Feature | FEAT-004, FEAT-005, FEAT-006 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S1 |
| Screens | SCR-new-request |
| Server Actions | submitRequest |
| Entities | LicenseRequest (C), Person (C-if-absent), RequestTransition (C) |
| Business Rules | BR-05, BR-06 |
| Blocked By | US-007, US-010, US-014 |

## Acceptance Criteria

- [ ] AC1: Form per SCR-new-request: self or admin-on-behalf; org+license type limited to active VendorAccounts/LicenseTypes
- [ ] AC2: Blocking duplicate check with 'Ver asignación existente' link; domain plausibility warn; company-active check
- [ ] AC3: Budget headroom soft-warning (run-rate vs Company.budget_monthly_usd using current RateCard; when no RateCard row exists for the (org, license type), show 'sin tarifa' and suppress the warning)
- [ ] AC4: `submitRequest` creates LicenseRequest (request_no SOL-NNNN) + RequestTransition; confirmation email; redirects to detail

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
