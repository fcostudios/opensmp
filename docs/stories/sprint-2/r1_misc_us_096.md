# US-096: Statements list and totals

> **Sprint 2** | **P0** | **1 SP** | **R1**

## User Story

As Central Finance, I want statements list and totals so that the five pilot companies can trust a register-derived monthly chargeback.

## Meta

| Field | Value |
|---|---|
| Story ID | US-096 |
| Feature | FEAT-027, FEAT-028 |
| Sprint | Sprint 2 |
| Slice | S1 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-statements, SCR-close |
| Server Actions | Read-only statement list and period totals |
| Entities | Statement (R), Company (R), CloseRun (R) |
| Business Rules | BR-18, BR-22 |
| Blocked By | US-034 |

## Acceptance Criteria

- [ ] AC1: SCR-statements lists the five pilot companies for the selected period with company code, draft/final/reconciled status, opening seats, joiners/leavers with dates, seat-days, rate and USD total. Empty and failed-close states identify the period and latest CloseRun.
- [ ] AC2: SCR-close shows generated count, draft/final counts and group total from the same CloseRun-stamped Statement rows. The total equals the sum of visible statement totals and refreshes after a draft rerun without duplicating rows.
- [ ] AC3: Central Finance and Group Admin can filter across authorized companies; Company Finance sees only its authorized company on every read. Cross-company identifiers cannot disclose counts or amounts.
- [ ] AC4: Each row exposes its statement identifier, the S1 CSV export (US-037), and the detail route delivered in S2 (US-036). This story requires no usage records, API sync, or S2 detail implementation to show drafts and export CSV.

## Path Parameters

_No dynamic route parameters._

## Implementation Contract

Use existing schema and shared domain/contracts; no new migration is required. App Router Server Components by default; authenticated actions resolve roles and company_id on the server. All displayed strings belong in es-EC/en-US locale files and components use design-system tokens. No API keys or usage billing dependency.

## Verification

Use deterministic real-DB assertions for interval integrity, rejected writes and company isolation where applicable. Follow docs/dev-guide/TESTING.md before test edits; no mocks of owned code. Slice production evidence is accepted by Central Finance, Company Finance and the IT Director with human story verify; no agent declares human acceptance.
