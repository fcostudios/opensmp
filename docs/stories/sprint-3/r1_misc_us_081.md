# US-081: Refresh free capacity only after an accepted member observation

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want freed seats to appear in the pool only once the vendor's membership has actually been observed again so that capacity is never optimistic (DEC-SMP-031) — this child delivers: the persisted per-account refresh watermark, the single producer entrypoint that only a validated complete member observation may stamp, the source-aware capacity projection that every pool surface reads, and — on one screen, SCR-vendor-account-detail — the explicit audited manual refresh and the pending-refresh / as-of display. The pools and dashboard consumers of the same projection are US-085.

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
| Screens | SCR-vendor-account-detail |
| Server Actions | recordManualPoolRefresh |
| Entities | VendorAccount (U members_refreshed_at, members_refresh_source), VendorAccountCapacity (R), LicenseAssignment (R), RequestTransition (R), ProvisioningAction (R), AuditLog (C) |
| Business Rules | — |
| Blocked By | US-019, US-020 |
| Migration | slug=capacity_refresh_watermark |

## Acceptance Criteria

- [ ] AC1: An append-only migration (`slug=capacity_refresh_watermark`) adds `VendorAccount.members_refreshed_at` (timestamptz, nullable) and `members_refresh_source` (`api / csv_import / manual`, nullable) with application-role grants, applied and parity-verified on a fresh database (DEC-SMP-041).
- [ ] AC2: One shared producer entrypoint in packages (`recordAcceptedMemberSnapshot(vendor_account_id, source, observed_at)`) is the only writer of the watermark and stamps it only for a validated COMPLETE account-wide member observation; partial, failed or stale observations, provider removal success responses, invitation membership polling and single manual register entries never stamp it. Producers: the hourly API member observation (US-084 via US-083's `member_observation_accepted` event — CHG-077), the CSV member import (US-055 AC1) and the manual refresh in AC3 — each named, none implemented here beyond the entrypoint and its verification with all three source fixtures.
- [ ] AC3: On SCR-vendor-account-detail, csv_import/manual accounts expose an explicit, audited "Confirmar cupos actuales" action (`recordManualPoolRefresh`, group_admin) that stamps `manual` after confirmation; API accounts do not expose it.
- [ ] AC4: The capacity projection (`pool-snapshots`, the single free-seat authority for every pool surface) counts a closed assignment as freed only when the account's `members_refreshed_at` is later than the closure instant — the `occurred_at` of the anchoring request's `offboarding → deprovisioned` transition, or `ended_on` end-of-day America/Guayaquil for rows without an anchoring transition; closures after the watermark, or any closure while the watermark is null, are reported as `pending_refresh` with the watermark as-of (or `never_observed`) in the projection's shared read contract, never as free (DEC-SMP-041). `seat_freed`-driven recovery and purchased-quantity changes are untouched.
- [ ] AC5: The SCR-vendor-account-detail Capacidad tiles render the projection's pending-refresh count and as-of ("actualizado hace …", or "sin observación" when null) with attention styling, through the existing group_admin read authorization; the figures move only after the next accepted observation.
- [ ] AC6: Demo (foundation, manual and source behaviour, on vendor-account detail): close an assignment on an API account — free stays unchanged and "1 pendiente de actualización" shows; stamp an `api` observation dated after the closure — free increases and the badge clears; a stamp dated before the closure changes nothing; on a manual account the explicit refresh clears the pending count while a single manual entry does not; a partial import stamps nothing; a never-observed account shows "sin observación"; a non-group_admin request is refused.

## Notes

- Canonical child of **US-024** (parent AC coverage: **AC2** "pool increments next sync, never optimistically at start" — shared with US-085), minted by **CHG-076** on 2026-10-11 and **refined by CHG-078** the same day after the tenant's screen-limit finding: the original story changed three screens against WORK_READINESS.md hard limit 4 (≤ 2 routes/screens). This story keeps the migration, the producer entrypoint, the projection and the one screen that carries production logic (manual refresh action + its display); **US-085** delivers the pools and dashboard consumers. Cross-cutting rationale: the former AC5 (three-screen display) is split by screen — vendor-account share here, pools/dashboard share in US-085 — and the former AC6 demo is split into this foundation/manual/source demo and US-085's overview demo; the shared projection contract (AC4) is delivered once, here, and consumed read-only by US-085. Decisions DEC-SMP-031, DEC-SMP-041. Nous allocation target ≈ 150 min; the tenant re-assesses independently rather than dividing the earlier 170 mechanically. Parallel-safe with US-075 per the tenant's file-boundary review (shared locales, feedback and generated guidance serialized at integration); US-075's finalization is read-only to this story.
- Extends the US-022 projection (Free = capacity − open assignments − pending invites) with the watermark term; US-022 itself is not amended. US-084 (API producer) and US-055 (CSV producer) are annotated as callers of the entrypoint and receive no other scope; US-029 keeps the broader freshness labels and `sync_stale` alerting. The observation ledger itself is **US-083** (DEC-SMP-044); this watermark is its denormalized capacity view.
- Vertical delivery: migration + grants, packages entrypoint + projection + shared read contract, manual refresh action with authorization/audit, one screen surface, locales, verification with injected clock (projection oracle over generated closure/observation histories, real-DB grants), review, integration.
