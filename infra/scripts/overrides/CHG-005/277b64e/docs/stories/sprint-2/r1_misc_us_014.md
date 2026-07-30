# US-014: Lifecycle state machine engine

> **Sprint 2** | **P0** | **3 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want to have one legal-transition engine for the 12 states so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-014 |
| Feature | FEAT-040 |
| Sprint | Sprint 2 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J1/J2 |
| Screens | (engine) |
| Server Actions | — |
| Entities | LicenseRequest (U), RequestTransition (C) |
| Business Rules | BR-04 |
| Blocked By | US-003 |

## Acceptance Criteria

- [ ] AC1: Transition function enforces the §10 graph (incl. provisioning→failed→provisioning retry); illegal transitions rejected + tested
- [ ] AC2: Every transition persists RequestTransition (from/to/actor/note/occurred_at) + AuditLog
- [ ] AC3: SLA timers derivable: submitted_at, pending_since for aging (US-017)

## Lifecycle Transition Table

| From | To | Guard / trigger |
|---|---|---|
| `submitted` | `pending_approval` | Automatic validation succeeds |
| `pending_approval` | `approved` | Approver or Group Admin approves |
| `pending_approval` | `rejected` | Approver or Group Admin rejects with comment |
| `approved` | `provisioning` | Capacity is available |
| `approved` | `blocked_no_seat` | Capacity is unavailable |
| `blocked_no_seat` | `provisioning` | Capacity is freed or purchased |
| `blocked_no_seat` | `rejected` | Authorized owner cancels the blocked request |
| `provisioning` | `invited` | Automated connector creates an invite |
| `provisioning` | `active` | Group Admin attests checklist completion in orchestration mode |
| `provisioning` | `failed` | Connector or checklist execution fails |
| `failed` | `provisioning` | Group Admin retries |
| `invited` | `active` | Membership sync observes acceptance |
| `invited` | `deprovisioned` | Invite is withdrawn or expires before activation |
| `active` | `flagged_inactive` | Inactivity window is breached |
| `active` | `offboarding` | Departure or reallocation begins |
| `flagged_inactive` | `active` | Qualifying usage resumes |
| `flagged_inactive` | `offboarding` | Reclamation is approved |
| `offboarding` | `deprovisioned` | Removal is executed or attested |
| `offboarding` | `failed` | Connector or checklist removal fails |

`rejected` and `deprovisioned` are terminal. System backfill and drift-claim
imports may materialize `active` directly with a `NULL → active`
`RequestTransition`; that import-only path is not an interactive transition.

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 2 milestone: USABLE END-TO-END IN ORCHESTRATION MODE (PRD week-2 milestone): request→approval→checklist provisioning→register→pool counter→alerts/audit, no API client required.
