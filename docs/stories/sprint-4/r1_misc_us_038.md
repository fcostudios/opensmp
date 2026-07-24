# US-038: Reconciliation workbench + variance lines

> **Sprint 4** | **P0** | **3 SP** | **R1**

## User Story

As a Central Finance (persona_04), I want to reconcile rollup vs invoice within 0.5% so that 

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-038 |
| Feature | FEAT-028, FEAT-029 |
| Sprint | Sprint 4 |
| Priority | P0 |
| Size | 3 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J3 |
| Screens | SCR-reconciliation |
| Server Actions | saveInvoiceAmount, overrideReconciliation |
| Entities | Reconciliation (CU), ReconciliationVarianceLine (C) |
| Business Rules | BR-20 |
| Blocked By | US-035 |

## Acceptance Criteria

- [ ] AC1: Per-org cards: rollup vs `saveInvoiceAmount` input; variance auto-computed + tolerance coloring
- [ ] AC2: Variance lines (ReconciliationVarianceLine: cause/detail/amounts/evidence link) CRUD during reconciliation; immutable once reconciled/overridden
- [ ] AC3: `overrideReconciliation` requires note; records overridden_by (role per OQ-SMP-11); the open→reconciled flip happens automatically on `saveInvoiceAmount` when within tolerance
- [ ] AC4: open→reconciled is server-rejected when |variance| > 0.5% of invoice total; outside tolerance the ONLY path is `overrideReconciliation` (mandatory note) → overridden; rejection covered by a test

## Notes

- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.
- Sprint 4 milestone: Money core (rates + close engine + license lines + statement template) THEN money complete (usage lines, finalization, exports, reconciliation, rollup) + company CRUD, credentials store, runbooks/restore drill, production deploy. MVP COMPLETE.
