# US-051: Close schedule + workbench readouts

> **Sprint 4** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to the close to run itself by business day 3 so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-051 |
| Feature | FEAT-027 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-close |
| Server Actions | — |
| Entities | CloseRun (R), AlertEvent (C) |
| Business Rules | BR-27 |
| Blocked By | US-050, US-046 |

## Acceptance Criteria

- [ ] AC1: bd-3 schedule triggers runClose per period (business-day calendar); manual run still available
- [ ] AC2: SCR-close tiles + 'última corrida … por … · duración' + <5 min NFR readout bind to latest CloseRun; run-in-progress state visible
- [ ] AC3: Failed scheduled runs alert (provisioning_failure-class routing) and appear on the workbench
- [ ] AC4: Alert-eval detects a MISSING CloseRun for the period past bd-3 and raises `close_missed`, independent of the close job itself (BR-27 watchdog)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
