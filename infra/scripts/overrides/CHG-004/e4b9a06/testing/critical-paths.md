# Effectiveness-critical paths

> Generated from `nous.db` — do not hand-edit. The few areas where a silent fault is
> materially costly. Mutation testing (the effectiveness gate) runs on the diff intersected
> with this set. Governed by the **Test Effectiveness Standard** §3.1.

## Always-mandated (Standard §3.1)

- **Tenant isolation** — every path that touches tenant-scoped data (filtered by `company_id`). → explicit isolation assertions (a query for tenant A must never return tenant B's rows).
- **Authorization** — role/permission gates on commands/mutations. → integration tests for allowed vs forbidden (expect 403).
- **Money / tax / financial math** (if present) — amounts, rounding, and idempotency of charge/ledger events. → property-based + a provider contract test.

## Critical business rules

| Rule | Name | Oracle | Governed-by stories |
|------|------|--------|---------------------|
| BR-01 | Register no-overlap (one seat, one holder, one period) | exact | US-003 |
| BR-02 | Every assigned seat-day belongs to exactly one company | exact | US-003, US-034, US-047 |
| BR-03 | Audit log is append-only at the database level | exact | US-003, US-008 |
| BR-04 | Only legal state-machine transitions execute | exact | US-014 |
| BR-08 | Approval aging: reminder at 24 h, escalation at 48 h; decision target 2 business days | exact | US-015, US-017, US-046 |
| BR-11 | Low-pool alert below the per-org floor | exact | US-022 |
| BR-12 | Blocked requests are never dropped; review within 1 business day | exact | US-023 |
| BR-14 | Departure deprovisioning completes same business day | property | US-024, US-042 |
| BR-17 | Proration is daily actual/actual with exact mid-month boundaries | exact | US-034 |
| BR-18 | Close is deterministic and idempotent; finals are immutable | exact | US-034, US-035, US-047, US-050 |
| BR-20 | Reconciliation flips to reconciled ONLY within 0.5% | exact | US-038 |
| BR-22 | Company scoping is enforced server-side on every query | exact | US-005, US-047 |

## Critical entities

| Entity | Why critical | Source |
|--------|--------------|--------|
| CompanyRoleAssignment | auth-sensitive entity (name heuristic) | heuristic |
| IntegrationCredential | auth-sensitive entity (name heuristic) | heuristic |
| UserAccount | auth-sensitive entity (name heuristic) | heuristic |
| VendorAccount | auth-sensitive entity (name heuristic) | heuristic |
| VendorAccountCapacity | auth-sensitive entity (name heuristic) | heuristic |
