# US-031: Credential management + rotation

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to rotate keys without downtime so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-031 |
| Feature | FEAT-024, FEAT-037 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | SCR-credentials, SCR-vendor-account-detail |
| Server Actions | rotateCredential, verifyCredential |
| Entities | IntegrationCredential (CRU) |
| Business Rules | BR-25 |
| Blocked By | US-005 |

## Acceptance Criteria

- [ ] AC1: Credentials envelope-encrypted at rest; UI masks to last4; scopes displayed
- [ ] AC2: `rotateCredential` creates new row + retires old (note required); `verifyCredential` health-checks on demand and distinguishes auth_failed from empty-data (FEAT-024 semantics)
- [ ] AC3: credential_failure alert on auth failures from any job

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
