# US-081: Refresh free capacity only after an accepted member observation

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want freed seats to appear in the pool only once the vendor's membership has actually been observed again so that capacity is never optimistic (DEC-SMP-031) — this child delivers: a persisted per-account refresh watermark, one shared producer entrypoint that only a validated complete member observation may stamp, an explicit manual refresh for csv_import/manual accounts, and the capacity projection and stale display that consume it on the pools, vendor-account and dashboard screens.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-081 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-pools, SCR-vendor-account-detail, SCR-admin-dashboard |
| Server Actions | recordManualPoolRefresh |
| Entities | VendorAccount (U members_refreshed_at, members_refresh_source), VendorAccountCapacity (R), LicenseAssignment (R), RequestTransition (R), ProvisioningAction (R), AuditLog (C) |
| Business Rules | — |
| Blocked By | US-019, US-020 |
| Migration | slug=capacity_refresh_watermark |

## Acceptance Criteria

- [ ] AC1: An append-only migration (`slug=capacity_refresh_watermark`) adds `VendorAccount.members_refreshed_at` (timestamptz, nullable) and `members_refresh_source` (`api / csv_import / manual`, nullable) with application-role grants, applied and parity-verified on a fresh database (DEC-SMP-041).
- [ ] AC2: One shared producer entrypoint in packages (`recordAcceptedMemberSnapshot(vendor_account_id, source, observed_at)`) is the only writer of the watermark and stamps it only for a validated COMPLETE account-wide member observation; partial, failed or stale observations, provider removal success responses, invitation membership polling and single manual register entries never stamp it. Producers: the hourly API member sync (US-078, CHG-075), the CSV member import (US-055 AC1) and the manual refresh in AC3 — each named, none implemented here beyond the entrypoint and its verification with all three source fixtures.
- [ ] AC3: On SCR-vendor-account-detail, csv_import/manual accounts expose an explicit, audited "Confirmar cupos actuales" action (`recordManualPoolRefresh`, group_admin) that stamps `manual` after confirmation; API accounts do not expose it.
- [ ] AC4: The capacity projection (`pool-snapshots`, the single free-seat authority for SCR-pools, SCR-vendor-account-detail and the dashboard tiles) counts a closed assignment as freed only when the account's `members_refreshed_at` is later than the closure instant — the `occurred_at` of the anchoring request's `offboarding → deprovisioned` transition, or `ended_on` end-of-day America/Guayaquil for rows without an anchoring transition; closures after the watermark, or any closure while the watermark is null, are reported as `pending_refresh` and never as free (DEC-SMP-041). `seat_freed`-driven recovery and purchased-quantity changes are untouched.
- [ ] AC5: SCR-pools PoolGauges, the SCR-vendor-account-detail Capacidad tiles and the dashboard "Licencias del grupo" tiles show the pending-refresh count and the watermark as-of ("actualizado hace …", or "sin observación" when null) with attention styling; the figures move only after the next accepted observation.
- [ ] AC6: Demo: close an assignment on an API account — free stays unchanged and "1 pendiente de actualización" shows; stamp an `api` observation after the closure — free increases and the badge clears; a stamp dated before the closure changes nothing; on a manual account the explicit refresh clears the pending count while a single manual entry does not; a partial import stamps nothing; a never-observed account shows "sin observación".

## Notes

- Canonical child of **US-024** (parent AC coverage: **AC2** "pool increments next sync, never optimistically at start"), minted by **CHG-076** on 2026-10-11 from the tenant's blocked US-075 readiness, which measured the capacity foundation at 90–150 min and found no accepted-snapshot watermark in the delivered projection (`pool-snapshots` derives occupancy from register dates alone). Decisions DEC-SMP-031, DEC-SMP-041. Nous allocation target ≈ 170 min; the tenant re-assesses. Parallel-safe with US-075 subject to the tenant's file-boundary review (projection/pools/vendor-account surfaces vs offboarding entrypoint/detail-screen surfaces); otherwise runs after US-075.
- Extends the US-022 projection (Free = capacity − open assignments − pending invites) with the watermark term; US-022 itself is not amended. US-078 (API producer) and US-055 (CSV producer) are annotated as callers of the entrypoint and receive no other scope; US-029 keeps the broader freshness labels and `sync_stale` alerting. Full member-sync delivery is **US-078** (CHG-075), not this story.
- Vertical delivery: migration + grants, packages entrypoint + projection, manual refresh action with authorization/audit, three screen surfaces, locales, verification with injected clock (projection oracle over generated closure/observation histories), review, integration.
