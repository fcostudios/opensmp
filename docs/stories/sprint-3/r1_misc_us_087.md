# US-087: Complete checklist seat removal and close the register atomically

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want a confirmed removal to close the register exactly once so that seat-days stop at the right date and never double-close — this child delivers: the shared `finalizeOffboarding` primitive (the only path to `deprovisioned`), US-020's checklist confirmation extended to `remove` actions on `offboarding` requests, atomic action/transition/register closure, and replay and failure handling.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-087 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-request-detail |
| Server Actions | confirmChecklistDone |
| Entities | ProvisioningAction (U), LicenseRequest (U), RequestTransition (C), LicenseAssignment (U close), AuditLog (C) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020, US-086 |

## Acceptance Criteria

- [ ] AC1: `finalizeOffboarding` (packages/domain, with its SQL adapter in orchestration) is the only way a removal reaches `deprovisioned`: in one transaction it completes the ProvisioningAction (`confirmed`), records `offboarding → deprovisioned` with `occurred_at`, and closes exactly the anchored LicenseAssignment rows with `ended_on` = the Ecuador date of the confirmed removal and the accepted `end_reason`, immutable afterwards (DEC-SMP-033, DEC-SMP-042).
- [ ] AC2: US-020's checklist confirmation (SCR-request-detail pending-checklist panel), extended to `remove` actions on `offboarding` requests, invokes the primitive; "Marcar no completada" or any failure leaves the register open, the action retryable and the request `offboarding`; a repeated or concurrent confirmation creates no second closure, transition or audit entry.
- [ ] AC3: Demo (completion half of US-075 AC4): confirm a checklist removal started by US-086 for `left_company` and for `inactive` — each reaches `deprovisioned` with the right register row closed and `ended_on`; an unconfirmed or failed checklist keeps the register open; a replayed confirmation adds nothing; the same-business-day alert fixture binds the request to its real assignment with kind `remove`; the completion writes no capacity, watermark or pool data (no `VendorAccountCapacity`, `members_refreshed_at` or projection write), so capacity freshness stays entirely with US-081/US-085 (DEC-SMP-041).

## Notes

- **CHG-092 (2026-10-12):** AC3 no longer requires proving US-081's capacity behaviour. That clause coupled this story's closure to US-081, which depends on US-088 on the US-030 chain. US-087 proves only that completion writes no capacity data; the freshness proof is US-081 AC4/AC6 and US-085. No other AC changes; no dependency on US-081.
- Canonical child of **US-075** (its AC2, AC3 and the completion half of AC4), minted by **CHG-083** on 2026-10-11 from the tenant's `partition_required` assessment (proposal `checklist-removal-completion`, envelope 250 min). Depends on US-086. Uses the CHG-081 route `lifecycle.ts → orchestration.integration.test.ts` for its direct finalizer and atomic-transaction oracles; `lifecycle.test.ts` stays unchanged. Includes the legacy alert-fixture repair.
- **US-082** (worker connector removal) finalizes through this primitive and now depends on this story.
