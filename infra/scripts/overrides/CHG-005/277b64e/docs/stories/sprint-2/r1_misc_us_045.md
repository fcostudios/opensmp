# US-045: Connector interface + orchestration routing

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to keep the core vendor-neutral so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-045 |
| Feature | FEAT-041 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | — |
| Screens | (architecture seam) |
| Server Actions | — |
| Entities | Vendor (R) |
| Business Rules | — |
| Blocked By | US-003 |

## Acceptance Criteria

- [ ] AC1: Connector interface: capabilities() + provision/deprovision/syncMembers/syncActivity/syncCost; the Sprint 2 `none` connector routes unsupported provision/deprovision operations to the orchestration checklist (US-020). Unsupported sync operations remain explicit until the CSV/manual ingestion path lands in US-055; the orchestration milestone is independent of the API client (US-018).
- [ ] AC2: Dispatch reads Vendor.provisioning_protocol (rest/scim/none); Sprint 2 registers only the `none` connector. US-018 provides the first concrete Anthropic connector after the US-054 probe gate.
- [ ] AC3: Core modules import only the interface (lint/test guard)

## Notes

- ACs are reconciled by CHG-005 with the fixed Sprint 2 execution plan; edit the canonical source and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
