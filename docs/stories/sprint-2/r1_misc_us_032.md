# US-032: Effective-dated rate cards

> **Sprint 2** | **P0** | **2 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to maintain contracted rates that reprice cleanly so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-032 |
| Feature | FEAT-026 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 2 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-rates |
| Server Actions | saveRateCard |
| Entities | RateCard (CR) |
| Business Rules | BR-21 |
| Blocked By | US-005 |

| Slice | S1 |

| Gated By | OQ-SMP-4 (soft: contracted seat rate; owner=Central Finance) |

| Manual Fallback | Manual register entry and a provisional rate; provisional evidence enables development and rehearsal, but never passes the real-data run or H2 reconciliation acceptance. |

## Acceptance Criteria

- [ ] AC1: `saveRateCard` adds effective-dated rows per (org, license type); overlapping periods rejected
- [ ] AC2: Rows consumed by a final close are locked (edit → new effective row)
- [ ] AC3: SCR-rates lists rates + capacity history side by side

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.

- CHG-113 / DEC-SMP-065/066: slice S1; license-only manual path. Production acceptance belongs to finance users and the IT Director.
