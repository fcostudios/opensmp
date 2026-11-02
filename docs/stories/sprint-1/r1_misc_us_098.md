# US-098: Register filter: seats active during a month

> **Sprint 1** | **P0** | **1 SP** | **R1**

## User Story

As Central Finance, I want to filter and export the register for the seats active in a month so that the M-1 register CSV matches what the close bills.

## Meta

| Field | Value |
|---|---|
| Story ID | US-098 |
| Feature | FEAT-025, FEAT-031 |
| Sprint | Sprint 1 |
| Slice | S0 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-register |
| Server Actions | exportRegisterCsv |
| Entities | LicenseAssignment (R), AuditLog (C) |
| Business Rules | BR-02, BR-22 |
| Blocked By | US-033, US-095 |

## Acceptance Criteria

- [ ] AC1: SCR-register offers an "active in month" filter (a calendar month, e.g. M-1). It returns every assignment that was active on at least one day of that month: started on or before the month's last day, and not ended before its first day. Open assignments that started before the month are included.
- [ ] AC2: `exportRegisterCsv` honours the same filter, so the M-1 register CSV lists every seat active during M-1 with its dates, end reason and provenance. The existing start-date and end-date filters keep their current meaning.
- [ ] AC3: Per-company headcount on the last day of the month, derived from the filtered rows, matches the seat-days the license-only close (US-034) uses for the same month. Company scoping (BR-22) and audit of the export are unchanged.

## Path Parameters

_No dynamic route parameters._

## Notes

- Source: CHG-118 S0/S1 dress rehearsal (`docs/runbooks/demo-s0-s1.md` §4) found that the register's start/end
  date filters both match on the start date, so a seat open since before M-1 was missing from the "M-1" export.
- US-033 is `dev_done`; its filters keep their meaning. This story adds the month filter rather than changing them.
