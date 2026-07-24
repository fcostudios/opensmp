# US-048: Ops runbooks + backup/restore drill

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to operate the three critical procedures so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-048 |
| Feature | — |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | docs |
| Server Actions | — |
| Entities | — |
| Business Rules | — |
| Blocked By | US-002, US-031 |

## Acceptance Criteria

- [ ] AC1: Runbooks: seat purchase (console + registerPurchase), credential rotation (ADR-13 KEK/DEK procedure), restore (incl. backup-key retrieval), Keycloak-outage break-glass (enable, use, verify alert + audit rows, confirm auto-disable)
- [ ] AC2: Nightly encrypted backup verified by an actual restore drill pre-go-live
- [ ] AC3: Runbooks linked from the relevant screens (pools purchase modal, credentials)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
