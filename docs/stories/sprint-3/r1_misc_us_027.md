# US-027: Inactivity flags + usage surface

> **Sprint 3** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to see 30/60/90-day inactivity per company so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-027 |
| Feature | FEAT-021 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-usage |
| Server Actions | proposeReclamations |
| Entities | ReclamationProposal (C), LicenseRequest (U) |
| Business Rules | BR-16 |
| Blocked By | US-026, US-072, US-073, US-074 |

## Acceptance Criteria

- [ ] AC1: SCR-usage: filters, metric cards, last-active + badge per person; batch 'Proponer reclamación' creates pending ReclamationProposals with note
- [ ] AC2: Flags respect the ~3-day analytics lag (windows unaffected): inactivity is counted against the lag-aware `data_through` date (DEC-SMP-026)
- [ ] AC3: State flagged_inactive set on the anchor request when the 30-day window trips, by the daily inactivity job; back to active when activity resumes (DEC-SMP-028)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22; AC2/AC3 amended by CHG-071) — the scope is the single source; edit there and regenerate.
- **CHG-071 (2026-10-07) — partitioned.** The tenant assessment (`docs/readiness/drafts/US-027.json`) sizes this parent at 750 min against the 320-minute execution budget (IMP-374), `partition_required`. Partitioned into canonical vertical children **US-072** (usage surface: AC1 read side + AC2 display, 260 min; the CHG-070 experiment child) → **US-073** (batch proposals: AC1 batch action, 230 min) and **US-074** (daily flagging: AC2 state side + AC3, 260 min). No parent AC is deferred; US-028 keeps approve/dismiss, dismissal suppression, `flagged_inactive → offboarding` and `/reclamaciones`. This parent closes by parent-level verification once the children are dev_done — it is not re-implemented.
- **DEC-SMP-026/027/028 (CHG-071):** lag-aware `data_through` owned by one shared pure function; batch idempotency via the existing partial UNIQUE (no migration; `client_request_id` audited, not persisted); the daily job flags at 30 days, 60/90 are display filters, no auto-proposals, un-flag on renewed activity.
- Sprint 3 milestone: Automation + monitoring: connector live (interface from Sprint 2, capability semantics via US-025), invite≤15min, hygiene, reclamation, drift. Beta-API risk retired here (surprise-detection already pulled to the Sprint-1 probe). Connector jobs run on Compose-secret keys (ADR-13) until US-031 lands the managed credential store in Sprint 4.
