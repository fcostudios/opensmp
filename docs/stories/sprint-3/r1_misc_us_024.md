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
| Entities | LicenseAssignment (U close), ProvisioningAction (C), Person (U), VendorAccount (U refresh watermark) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020, US-075, US-076, US-077, US-081, US-082, US-085 |

## Acceptance Criteria

- [ ] AC1: `startOffboarding` (person detail / request detail) → state offboarding → removal via connector or checklist → deprovisioned. Entrypoint, checklist path and the atomic finalization primitive: US-075; connector execution in the worker: US-082 (DEC-SMP-042)
- [ ] AC2: Register row closes (ended_on, end_reason left_company/inactive — DEC-SMP-033; `reallocated` is a BR-02 transfer closure, never a removal — DEC-SMP-040); pool increments only after the next accepted member observation, never optimistically at start (DEC-SMP-031, DEC-SMP-041 — owner US-081)
- [ ] AC3: Departure flow can set Person.status='Salió del grupo' — by explicit admin confirmation, unchecked by default (DEC-SMP-032)
- [ ] AC4: Offboardings with end_reason=left_company still not deprovisioned at end of the same business day raise `deprovision_overdue` (15-min alert-eval, business-day calendar, subject_ref=request) — BR-14, DEC-SMP-029/030/033

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22; AC2–AC4 amended by CHG-074) — the scope is the single source; edit there and regenerate.
- **CHG-074 (2026-10-11) — partitioned.** The tenant assessment (`docs/readiness/drafts/US-024.json`) sizes this parent at 780 min bottom-up (1,152 at the calibrated rate) against the 320-minute execution budget (IMP-374), `partition_required`. Partitioned into canonical vertical children **US-075** (offboarding completion + register close: AC1, AC2, 270 min) → **US-076** (departure confirmation: AC3, 240 min) ∥ **US-077** (same-business-day overdue alert: AC4, 270 min). No parent AC is deferred; US-028 keeps reclamation approve/dismiss and consumes the shared entrypoint; US-068/US-069 keep invitation-only removal; US-055 keeps the ingestion UI. This parent closes by parent-level verification once the children are dev_done — it is not re-implemented.
- **CHG-078 (2026-10-11) — US-081 refined by screen limit:** US-081 keeps the watermark migration, the producer entrypoint, the shared projection and the SCR-vendor-account-detail manual refresh + display (one screen; ≈150); **US-085** (≈90, after US-081) delivers the SCR-pools and SCR-admin-dashboard consumers (two screens). Parent AC2's "pool increments next sync" is shared by US-081 + US-085. US-075's resolved readiness is untouched.
- **CHG-076 (2026-10-11) — US-075 repartitioned** after the tenant's blocked readiness (440 min / 5 scopes / 25–32 files / 2 boundaries): **US-075** (entrypoint on both screens, checklist path, atomic finalization primitive; ≈210) → **US-082** (worker connector removal, failure/retry; ≈180) → **US-076 ∥ US-077**; **US-081** (capacity refresh watermark + projection + stale display; ≈170) parallel-safe with US-075 subject to the tenant's file-boundary review. Rulings DEC-SMP-040 (`reallocated` = transfer, BR-02 stands, no R1 transfer entrypoint), DEC-SMP-041 (accepted-observation watermark contract), DEC-SMP-042 (removal execution and finalization contract). Each revised child gets its own readiness and digest-bound approval; the parent approval stands.
- **DEC-SMP-029..033 (CHG-074):** Ecuador business-day calendar and local-midnight deadline anchored on the offboarding transition; only `left_company` under BR-14; capacity refreshes at the next authoritative sync, never optimistically; explicit departure confirmation (the automatic marking is retired); register closes on confirmed removal in one transaction, failed removals stay alert-eligible.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
