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
| Blocked By | US-019, US-020, US-075, US-076, US-077 |

## Acceptance Criteria

- [ ] AC1: `startOffboarding` (person detail / request detail) → state offboarding → removal via connector or checklist → deprovisioned
- [ ] AC2: Register row closes (ended_on, end_reason left_company/inactive/reallocated — DEC-SMP-033); pool increments next sync, never optimistically at start (DEC-SMP-031)
- [ ] AC3: Departure flow can set Person.status='Salió del grupo' — by explicit admin confirmation, unchecked by default (DEC-SMP-032)
- [ ] AC4: Offboardings with end_reason=left_company still not deprovisioned at end of the same business day raise `deprovision_overdue` (15-min alert-eval, business-day calendar, subject_ref=request) — BR-14, DEC-SMP-029/030/033

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22; AC2–AC4 amended by CHG-074) — the scope is the single source; edit there and regenerate.
- **CHG-074 (2026-10-11) — partitioned.** The tenant assessment (`docs/readiness/drafts/US-024.json`) sizes this parent at 780 min bottom-up (1,152 at the calibrated rate) against the 320-minute execution budget (IMP-374), `partition_required`. Partitioned into canonical vertical children **US-075** (offboarding completion + register close: AC1, AC2, 270 min) → **US-076** (departure confirmation: AC3, 240 min) ∥ **US-077** (same-business-day overdue alert: AC4, 270 min). No parent AC is deferred; US-028 keeps reclamation approve/dismiss and consumes the shared entrypoint; US-068/US-069 keep invitation-only removal; US-055 keeps the ingestion UI. This parent closes by parent-level verification once the children are dev_done — it is not re-implemented.
- **DEC-SMP-029..033 (CHG-074):** Ecuador business-day calendar and local-midnight deadline anchored on the offboarding transition; only `left_company` under BR-14; capacity refreshes at the next authoritative sync, never optimistically; explicit departure confirmation (the automatic marking is retired); register closes on confirmed removal in one transaction, failed removals stay alert-eligible.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
