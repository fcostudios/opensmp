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

- [ ] AC1: Connector interface: capabilities() + provision/deprovision/syncMembers/syncActivity/syncCost; 'unsupported' routes the step to orchestration mode; ships BEFORE any concrete connector (US-018 implements it) — the orchestration path (US-020) runs against the interface alone
- [ ] AC2: Dispatch reads Vendor.provisioning_protocol (rest/scim/none); Anthropic connector registered as #1
- [ ] AC3: Core modules import only the interface (lint/test guard)

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
