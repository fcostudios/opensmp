# US-097: Member-list CSV reconciliation

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As Group Admin, I want member-list csv reconciliation so that the five pilot companies can trust a register-derived monthly chargeback.

## Meta

| Field | Value |
|---|---|
| Story ID | US-097 |
| Feature | FEAT-046, FEAT-025 |
| Sprint | Sprint 4 |
| Slice | S3 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-vendor-account-detail, SCR-register |
| Server Actions | previewMemberRegisterDiff |
| Entities | LicenseAssignment (R), Person (R), VendorAccount (R), AuditLog (C) |
| Business Rules | BR-01, BR-02, BR-22 |
| Blocked By | US-095, US-005, US-025, US-008 |
| Gated By | OQ-SMP-1 (soft: real console member-list export; owner=Francisco) |
| Manual Fallback | Manual register entry and a provisional rate; provisional evidence enables development and rehearsal, but never passes the real-data run or H2 reconciliation acceptance. |

## Acceptance Criteria

- [ ] AC1: The admin uploads a console member-list CSV for a server-authorized VendorAccount and supplies its as-of date. Parse identity/account/license mappings using existing normalized identity conventions; preview invalid, duplicate and ambiguous records separately, without inferring a company for unknown members.
- [ ] AC2: Compare active licensed members with open register assignments at the supplied as-of date: show members without assignments and assignments without members, with identity, account, license and evidence. Invitations do not count as active seats; ambiguous/warned identities never become actionable matches.
- [ ] AC3: The diff is read-only. Each correction goes through US-095 with an explicit company, effective date and mandatory note; recomputing the same CSV against unchanged register data yields the same result. Never auto-provision, close assignments, invoke the US-030 diff, or create DriftEpisode rows or capacity watermarks.
- [ ] AC4: Authenticate and authorize upload/reads by company_id and VendorAccount access; audit the comparison metadata and manual corrections, and reject cross-company identifiers. Malformed input reports row errors without changing register data.
- [ ] AC5: Until the real export arrives, use manual register entry and a provisional rate with a manually transcribed member list to rehearse the comparison; label evidence provisional. The real CSV acceptance waits for the export, while monthly close remains usable.

## Path Parameters

| Parameter | Entity | Column | Meaning |
|---|---|---|---|
| vendorAccountId | VendorAccount | id | Server-authorized vendor account for the member comparison |

## Implementation Contract

Use existing schema and shared domain/contracts; no new migration is required. App Router Server Components by default; authenticated actions resolve roles and company_id on the server. All displayed strings belong in es-EC/en-US locale files and components use design-system tokens. No API keys or usage billing dependency.

previewMemberRegisterDiff takes vendorAccountId, asOf and CSV input; returns matched rows, missingAssignments, missingMembers and row warnings. It performs no assignment writes. Manual corrections use US-095. Reuse existing normalized identity and license mappings; no US-078/US-093 dependency.

## Verification

Use deterministic real-DB assertions for interval integrity, rejected writes and company isolation where applicable. Follow docs/dev-guide/TESTING.md before test edits; no mocks of owned code. Slice production evidence is accepted by Central Finance, Company Finance and the IT Director with human story verify; no agent declares human acceptance.
