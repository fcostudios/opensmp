# US-095: Manual register entry

> **Sprint 1** | **P0** | **1 SP** | **R1**

## User Story

As Group Admin, I want manual register entry so that the five pilot companies can trust a register-derived monthly chargeback.

## Meta

| Field | Value |
|---|---|
| Story ID | US-095 |
| Feature | FEAT-025, FEAT-046 |
| Sprint | Sprint 1 |
| Slice | S0 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-register |
| Server Actions | recordManualAssignment, closeManualAssignment |
| Entities | LicenseAssignment (CU), LicenseRequest (C system), AuditLog (C) |
| Business Rules | BR-01, BR-02, BR-22 |
| Blocked By | US-003, US-005, US-008, US-033 |

## Acceptance Criteria

- [ ] AC1: On SCR-register a Group Admin records an assignment for a server-authorized company, person, VendorAccount and LicenseType with an effective start date and mandatory note. Persist source_kind=manual and the existing system-request anchor convention; use existing register persistence and schema.
- [ ] AC2: The admin closes a manual assignment with effective end date, existing end_reason and mandatory note. Existing DB exclusion and contiguity constraints reject invalid intervals; finalized statement periods cannot be rewritten.
- [ ] AC3: Both operations authenticate with auth(), enforce company_id scoping, transact audit with the write, and reject an unauthorized company or cross-company identifiers without mutation. Central/Company Finance remain read-only for these writes.
- [ ] AC4: The register and its CSV reflect the change with dates and provenance. Rejected writes leave no partial assignment, anchor or audit success. No member observation, capacity watermark, DriftEpisode or API call is produced.

## Path Parameters

_No dynamic route parameters._

## Implementation Contract

Use existing schema and shared domain/contracts; no new migration is required. App Router Server Components by default; authenticated actions resolve roles and company_id on the server. All displayed strings belong in es-EC/en-US locale files and components use design-system tokens. No API keys or usage billing dependency.

Action inputs: recordManualAssignment takes personId, companyId, vendorAccountId, licenseTypeId, startedOn and note; closeManualAssignment takes assignmentId, endedOn, endReason and note. Resolve and validate every referenced entity against authorized company scope; return the existing register result/validation convention. Reuse existing typed persistence rather than duplicating register rules.

## Verification

Use deterministic real-DB assertions for interval integrity, rejected writes and company isolation where applicable. Follow docs/dev-guide/TESTING.md before test edits; no mocks of owned code. Slice production evidence is accepted by Central Finance, Company Finance and the IT Director with human story verify; no agent declares human acceptance.
