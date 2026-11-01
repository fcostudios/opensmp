# US-080: Show the drift-to-zero metric on the dashboard

> **Sprint 3** | **P0** | **1 SP** | **R2**

## User Story

As a Group Admin (persona_01), I want to see current drift and its 30-day trend on my dashboard so that I can prove drift trends to zero (PRD §17) — this child delivers: the current unresolved drift count and a daily trailing-30-day trend on the existing admin dashboard, derived from the delivered episode evidence through a shared read contract with authorization and freshness, verified against the real claim path; no new screen and no persisted metric.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-080 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R2 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-admin-dashboard |
| Server Actions | — |
| Entities | DriftEpisode (R), VendorAccount (R) |
| Business Rules | — |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-079 |

## Acceptance Criteria

- [ ] AC1: The current drift metric is the count of unresolved distinct DriftEpisode rows (member/account/license identity), independent of alert acknowledgement, notification enablement or rule configuration; a successful claim reduces it immediately; episodes are counted, never seat-days, alert rows or financial amounts (DEC-SMP-037).
- [ ] AC2: The trend is the end-of-day unresolved count for each of the trailing 30 completed America/Guayaquil dates, derived from `first_seen_at`/`resolved_at` at read time — no snapshot table — so pre-claim history is retained after a claim; the dashboard discloses the observation as-of and shows accounts that have never been observed as unknown/stale rather than zero (DEC-SMP-037).
- [ ] AC3: The metric is served through a shared read contract on the existing `/panel` (SCR-admin-dashboard) Group Admin read authorization; other companies' and other tenants' rows never leak; no new screen, navigation entry, persisted metric or throughput claim is added.
- [ ] AC4: Demo: detect two episodes, acknowledge one alert, claim one member and then the other — the current metric reads 2, 2, 1, 0; the daily points match the episode lifetimes and keep the pre-claim history; the as-of and a never-observed account's unknown state are visible; a non-Group-Admin request is refused.

## Notes

- Canonical child of **US-030** (parent AC coverage: **AC3**), minted by **CHG-075** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-030.json`, proposal `drift-metric`, estimate 250 min). Decision DEC-SMP-037. Depends on US-079 (`Blocked By`; transitively US-078): its final verification consumes the real claim action and it shares locale/package export surfaces with US-079, so it runs after US-079 integrates.
- PRD §17 sets the KPI ("provisioning actions outside the platform: 0 after go-live, continuous") without a counting or window definition; DEC-SMP-037 supplies both and this story is the canonical dashboard specification of the metric. US-029 keeps the broader freshness/stale alert presentation.
- Vertical delivery: contracts, server read model, dashboard rendering, authorization, locales, verification against the real claim path, review, integration. No migration expected.

- CHG-113 / DEC-SMP-065/066: R2; no further R1 work.
