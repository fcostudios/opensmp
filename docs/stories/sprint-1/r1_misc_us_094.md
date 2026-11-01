# US-094: Real-data pilot register run (child of US-007)

> **Sprint 1** | **P0** | **1 SP** | **R1**

## User Story

As Group Admin, I want real-data pilot register run (child of us-007) so that the five pilot companies can trust a register-derived monthly chargeback.

## Meta

| Field | Value |
|---|---|
| Story ID | US-094 |
| Feature | FEAT-001, FEAT-025 |
| Sprint | Sprint 1 |
| Slice | S0 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-register |
| Server Actions | Existing US-007 seed/backfill and exportRegisterCsv |
| Entities | Company (C), Person (C), LicenseAssignment (C) |
| Business Rules | BR-01, BR-02, BR-22 |
| Blocked By | US-007, US-053, US-095 |
| Parent Story | US-007 |
| Gated By | OQ-SMP-1 (soft: real five-company inventory and member export; owner=Francisco), OQ-SMP-4 (soft: real contracted rate and last invoice for subsequent H2 acceptance; owner=Central Finance) |
| Manual Fallback | Manual register entry and a provisional rate; provisional evidence enables development and rehearsal, but never passes the real-data run or H2 reconciliation acceptance. |

## Acceptance Criteria

- [ ] AC1: On production (US-053), run the existing US-007 companies CSV and register backfill for the most recently completed calendar month and five pilot companies. Record source month, account, company mapping and source evidence; require no API keys.
- [ ] AC2: Central Finance checks the register CSV headcount per company against the real source spreadsheet/member export. Report every mismatch and resolve through audited manual entry (US-095); enforce existing register integrity and company isolation.
- [ ] AC3: If the real inputs have not arrived, use manual register entry and a provisional rate to exercise the journey, label the evidence provisional, and leave this real-data acceptance pending. No synthetic or provisional run is evidence that H2 passed.
- [ ] AC4: Central Finance, Company Finance and the IT Director inspect the production run evidence; human story verify follows only when the real-data headcounts are accepted. US-007 remains dev_done and unchanged.

## Path Parameters

_No dynamic route parameters._

## Implementation Contract

Use existing schema and shared domain/contracts; no new migration is required. App Router Server Components by default; authenticated actions resolve roles and company_id on the server. All displayed strings belong in es-EC/en-US locale files and components use design-system tokens. No API keys or usage billing dependency.

## Verification

Use deterministic real-DB assertions for interval integrity, rejected writes and company isolation where applicable. Follow docs/dev-guide/TESTING.md before test edits; no mocks of owned code. Slice production evidence is accepted by Central Finance, Company Finance and the IT Director with human story verify; no agent declares human acceptance.
