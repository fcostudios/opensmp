# US-023: Blocked-no-seat + purchase-or-reclaim flow

> **Sprint 3** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to decide reclaim-vs-buy with evidence so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-023 |
| Feature | FEAT-017, FEAT-019 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1 S3, J4 |
| Screens | SCR-pools, SCR-request-detail, SCR-exceptions |
| Server Actions | registerPurchase, addCapacity, saveVendorAccountCapacity |
| Entities | VendorAccountCapacity (C), LicenseRequest (U) |
| Business Rules | BR-12 |
| Blocked By | US-022, US-042 |

## Acceptance Criteria

- [ ] AC1: Pool-empty (or vendor 400) → state blocked_no_seat; requester + admin notified; decision task on SCR-pools
- [ ] AC2: Callout shows inactive candidates (last-active, monthly cost) beside prorated purchase note once US-027 analytics data exists; renders a 'sin datos de uso' empty state before
- [ ] AC3: `registerPurchase`/`addCapacity`/`saveVendorAccountCapacity` create effective-dated capacity rows (license type required); blocked requests auto-resume provisioning when pool frees
- [ ] AC4: A request still blocked_no_seat with its decision task unresolved > 1 business day re-alerts/escalates to Group Admin (blocked_no_seat AlertRule aging threshold, default 1bd) and shows an aging chip on the SCR-pools decision task (PRD §10 'review within 1 business day')

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
