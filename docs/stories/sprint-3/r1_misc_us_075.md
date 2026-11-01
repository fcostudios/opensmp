# US-075: Start anchored seat removal from both detail screens and finalize the register atomically

> **Sprint 3** | **P0** | **1 SP** | **R2**

## User Story

As a Group Admin (persona_01), I want to remove seats same-business-day on departure so that seat-days stop leaking — this child delivers: from either detail screen, one shared authorized `startOffboarding` entrypoint for `left_company` and `inactive` removals that moves the anchor request to `offboarding`, creates the removal action and selects connector or checklist execution; one shared finalization primitive that, on confirmed removal, completes the action, records `offboarding → deprovisioned` and closes exactly the anchored register rows in one transaction; and the checklist path end-to-end. Connector execution in the worker is US-082; the capacity refresh is US-081.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-075 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R2 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-person-detail, SCR-request-detail |
| Server Actions | startOffboarding |
| Entities | LicenseAssignment (U close), ProvisioningAction (CU), LicenseRequest (U), RequestTransition (C), VendorAccount (R), AuditLog (C) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020, US-086, US-087 |

## Acceptance Criteria

- [ ] AC1: `startOffboarding` from SCR-person-detail or SCR-request-detail (group_admin, company-scoped, audited) accepts `end_reason ∈ {left_company, inactive}` only — `reallocated` is a transfer closure under BR-02, never a removal, and is refused with that message (DEC-SMP-040) — moves the anchor LicenseRequest `active → offboarding` (US-028's approval is the only path from `flagged_inactive`), creates one ProvisioningAction `kind = remove`, `status = pending`, and selects execution: the connector when the account's shipped capability descriptor (US-025/US-063..066) supports removal, otherwise the US-020 checklist. From request detail the target is that request's own assignment; Person.status is never touched here (DEC-SMP-032). Capacity is never increased at start (DEC-SMP-031).
- [ ] AC2: One shared finalization primitive in packages/domain (`finalizeOffboarding`, DEC-SMP-042) is the only way a removal reaches `deprovisioned`: in one transaction it completes the ProvisioningAction (`confirmed`), records the `offboarding → deprovisioned` RequestTransition with `occurred_at`, and closes exactly the anchored LicenseAssignment rows with `ended_on` = the Ecuador date of the confirmed removal and `end_reason` = the accepted reason, immutable afterwards (DEC-SMP-033). A failed or unconfirmed removal leaves the register open, the action retryable and the request in `offboarding`; a retry or a concurrent confirmation cannot duplicate the closure, the transition or the audit entry.
- [ ] AC3: The checklist path is delivered end-to-end: US-020's checklist confirmation, extended to `remove` actions on `offboarding` requests (today it completes `provisioning → active` only), confirms the removal and invokes the primitive. Connector-backed `remove` actions are created `pending` and left for the worker (US-082); nothing here dispatches to a provider.
- [ ] AC4: Demo: from person detail and from request detail, remove one checklist-backed active seat for `left_company` and one for `inactive`; each reaches `deprovisioned` only on the admin's confirmation and closes the right register row with the right `ended_on`/`end_reason`; `reallocated` is refused; an unconfirmed checklist keeps the register open and the request in `offboarding`; a repeated confirmation creates no second closure; another company's seat or a non-group_admin role is refused; a connector-backed seat produces a `pending` remove action and no state change; free capacity does not move.

## Notes

- **CHG-083 (2026-10-11) — partitioned** on the tenant's assessment (350 min against 320): **US-086** (start: AC1 + start half of AC4; 230) → **US-087** (completion: AC2, AC3 + completion half of AC4; 250). This story closes by verification once both are dev_done. Existing work, approvals and incurred cost stay recorded here and are carried by the children, not re-counted. No new policy ruling.
- Canonical child of **US-024** (parent AC coverage: **AC1** entrypoint + checklist path, **AC2** register closure), minted by **CHG-074** on 2026-10-11 and **amended by CHG-076** the same day after the tenant's blocked readiness (`docs/readiness/US-075.json`, 440 min / 5 scopes / 25–32 files): connector execution moved to **US-082**, the capacity-refresh foundation to **US-081**, and `reallocated` removed from the accepted reasons. Decisions DEC-SMP-031, DEC-SMP-033, DEC-SMP-040, DEC-SMP-042. First child; no sibling dependency. Nous allocation target ≈ 210 min; the tenant re-assesses.
- Owns the shared offboarding entrypoint and the finalization primitive that **US-082** (worker connector removal), **US-076** (departure confirmation), **US-077** (overdue alert) and **US-028** (approved reclamation → offboarding) reuse. Invitation-only removal and `invited → deprovisioned` stay with US-068/US-069. The `occurred_at` of the `offboarding → deprovisioned` transition is the closure instant the US-081 capacity projection compares against the account's refresh watermark (DEC-SMP-041).
- Vertical delivery: contracts, production entrypoint on both detail screens, checklist extension, the primitive, authorization/audit, real-DB verification (atomic close + transition, unconfirmed/retry/concurrency), review, integration. No schema or migration expected (`ended_on`/`end_reason` UPDATE grants already exist); if one is needed it ships here, append-only, with fresh-database verification.

- CHG-113 / DEC-SMP-065/066: R2; no further R1 work.
