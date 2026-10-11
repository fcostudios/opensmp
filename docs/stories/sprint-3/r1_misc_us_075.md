# US-075: Complete anchored seat removal and close the license register

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to remove seats same-business-day on departure so that seat-days stop leaking — this child delivers: from either detail screen, one shared authorized `startOffboarding` entrypoint executes removal through the shipped connector capability or the checklist fallback, reaches `deprovisioned` only on confirmed removal, closes exactly the anchored register rows with `ended_on`/`end_reason`, and refreshes capacity at the next authoritative source-aware refresh.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-075 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | SCR-person-detail, SCR-request-detail |
| Server Actions | startOffboarding |
| Entities | LicenseAssignment (U close), ProvisioningAction (C), LicenseRequest (U), RequestTransition (C), VendorAccount (R) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020 |

## Acceptance Criteria

- [ ] AC1: `startOffboarding` from SCR-person-detail or SCR-request-detail (group_admin, company-scoped, audited) moves the anchor LicenseRequest `active → offboarding` and executes removal through the shipped connector capability (US-025/US-063..066) or the checklist fallback (US-020); it reaches `deprovisioned` only after the provider confirms removal or the admin confirms the checklist, in one transaction with the ProvisioningAction completion and the RequestTransition.
- [ ] AC2: The same transaction closes exactly the anchored LicenseAssignment rows: `ended_on` = the Ecuador date of the confirmed removal, `end_reason` = the accepted reason (`left_company` / `inactive` / `reallocated`), immutable afterwards (DEC-SMP-033). A failed or unconfirmed removal leaves the register open and the request in `offboarding`; a retry or a concurrent confirmation cannot duplicate the closure or the audit entry.
- [ ] AC3: Capacity is never increased optimistically at offboarding start: API accounts show the freed seat after the next successful member sync; csv_import/manual accounts after the next accepted member snapshot or explicit manual pool refresh, and availability is shown as stale until then (DEC-SMP-031). The ingestion UI itself stays with US-055.
- [ ] AC4: Demo: on person and request detail, remove one API-backed and one checklist-backed active seat for each of the three reasons; each transitions `offboarding → deprovisioned` only on success/confirmation and closes the right register row; a failed removal keeps the register open; a retry creates no second closure; another company's seat or a non-group_admin role is refused; capacity updates at the next authoritative refresh and not before.

## Notes

- Canonical child of **US-024** (parent AC coverage: **AC1**, **AC2**), minted by **CHG-074** on 2026-10-11 from the tenant's `partition_required` assessment (`docs/readiness/drafts/US-024.json`, proposal `offboarding-completion`, estimate 270 min). Decisions DEC-SMP-031, DEC-SMP-033. First child; no sibling dependency.
- Owns the shared offboarding entrypoint that **US-076** (departure confirmation), **US-077** (overdue alert) and **US-028** (approved reclamation → offboarding) reuse. Invitation-only removal and `invited → deprovisioned` stay with US-068/US-069 (no activated register row to close).
- Vertical delivery: contracts, production execution on both detail screens, authorization/audit, verification with real-DB fixtures (atomic close + transition, failure and retry/concurrency), review, integration. No schema or migration expected; if one is needed it ships here, append-only, with fresh-database verification.
