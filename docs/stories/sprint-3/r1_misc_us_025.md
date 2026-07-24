# US-025: Vendor accounts + capability descriptor

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to manage orgs, modes and connector capabilities so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-025 |
| Feature | FEAT-041, FEAT-042 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-vendor-accounts, SCR-vendor-account-detail |
| Server Actions | createVendorAccount, updateVendorAccount |
| Entities | VendorAccount (CRU), Vendor (R), LicenseType (R) |
| Business Rules | — |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: CRUD VendorAccount (mode automated/orchestration, low_pool_floor, renewal); R1 vendor select = Anthropic (registry is FEAT-R2-01)
- [ ] AC2: Capabilities info-card renders Vendor booleans + provisioning_protocol; missing capability routes steps to orchestration
- [ ] AC3: License types tab read-only in R1 (deferral noted SEC08 of 07)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
