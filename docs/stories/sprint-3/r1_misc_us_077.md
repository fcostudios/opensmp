# US-077: Raise same-business-day departure deprovisioning alerts

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to be told when a departure's seat removal has not completed by the end of the business day so that seat-days stop leaking unnoticed — this child delivers: the existing quarter-hour alert evaluation raises a request-linked `deprovision_overdue` alert and its configured email when a `left_company` removal is still `offboarding` past the approved business-day deadline, including failed connector or checklist removals, repeat-safe across ticks and suppressed once the request completes.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-077 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | (jobs) |
| Server Actions | — |
| Entities | AlertEvent (C), AlertRule (R), LicenseRequest (R), ProvisioningAction (R), RequestTransition (R) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020, US-075, US-082 |

## Acceptance Criteria

- [ ] AC1: The deadline for a `left_company` offboarding is local midnight (America/Guayaquil) ending the business day on which the `active → offboarding` transition was recorded, anchored on that transition timestamp, never on a retry; a start on a weekend or an `ECUADOR_HOLIDAYS` day rolls to the end of the next business day (DEC-SMP-029, BR-14). The calendar is the operator-maintained one already injected into the worker; no new calendar service.
- [ ] AC2: The existing alert-eval schedule (US-042, minutes 7/22/37/52) raises one `deprovision_overdue` AlertEvent with `subject_ref` = the request at the first tick after the deadline, including on non-business days, for every overdue `left_company` request still in `offboarding` — pending, failed or partially finalized removals alike (DEC-SMP-033) — and delivers the configured email through the existing outbox; `inactive` and `reallocated` removals never alert (DEC-SMP-030).
- [ ] AC3: Repeated ticks deduplicate (one open alert per breached request); a request that reaches `deprovisioned` is suppressed; company and account scope are enforced.
- [ ] AC4: Demo: simulated Ecuador weekend and holiday calendars prove no alert before the deadline and a request-linked breach at the first tick after it; a failed connector removal and a pending checklist both alert; `inactive`/`reallocated` and completed requests do not; repeated ticks add nothing; the email uses the existing outbox.

## Notes

- Canonical child of **US-024** (parent AC coverage: **AC4**), minted by **CHG-074** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-024.json`, proposal `departure-overdue-alert`, estimate 270 min). Decisions DEC-SMP-029, DEC-SMP-030, DEC-SMP-033. Depends on US-075 (`Blocked By`); parallel-safe with US-076 after US-075 integrates.
- **CHG-076 (2026-10-11):** sequenced after **US-082** (shared worker surface; the failed-removal states this story alerts on are produced there). Still parallel-safe with US-076.
- Reuses the US-042 alert evaluator, calendar injection, request-subject routing and notification outbox; this child delivers the removal-specific facts, the deadline function and race-safe evaluation. The existing inactive-candidate query requires a pending action and would omit failed removals — the eligibility here is "still `offboarding`", not "has a pending action".
- Vertical delivery: domain deadline function (property-tested over simulated calendars, the BR-14 oracle), worker wiring, verification, review, integration. No migration expected.
