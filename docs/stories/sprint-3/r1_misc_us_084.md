# US-084: Run the hourly API member observation and verify confirmed provisions

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want Ledger to observe every API-connected org's membership hourly and to verify my confirmed provisions against it so that the register's truth does not depend on anyone remembering to look — this child delivers: the production hourly worker that replaces the deferred `memberSync` stub for `ingestion_mode = api` accounts only, credential-safe paginated journaled reads through the delivered connector composition, acceptance through US-089's acceptance pipeline, the worker-safe confirmed-provision adapter over the extracted verification core, and the capacity-watermark stamp.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-084 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (jobs) |
| Server Actions | — |
| Entities | MemberObservation (C via pipeline), ConnectorCallObservation (C), ProvisioningAction (U verification), VendorAccount (R, U members_refreshed_at via US-081), IntegrationCredential (R), AuditLog (C) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-089, US-090, US-091 |

## Acceptance Criteria

- [ ] AC1: The deferred `memberSync` stub is replaced by production composition over US-056/US-057/US-058 — credential-safe, paginated, one ConnectorCallObservation per attempt — on the existing hourly schedule, processing only `ingestion_mode = api` vendor accounts; csv_import/manual accounts are never polled (BR-24). Each run hands the complete normalized snapshot to `acceptMemberObservation(source = api)` and surfaces its `stale`/`conflict`/accepted outcome in the run journal.
- [ ] AC2: The verification lifecycle's decision core is extracted from the web module into packages/domain as a pure function plus repository port, and the single application service that both the web workflow and the worker call keeps the delivered transaction, replay, state/audit and `verification_failed` behaviour; no workflow logic is duplicated and packages never import the web app (DEC-SMP-046).
- [ ] AC3: A worker-safe adapter runs inside the acceptance pipeline before any diff, for every source: it selects the account's pending checklist/invite actions awaiting membership verification, matches them by provider identity (`provider_member_ref`, else normalized e-mail) and license against the accepted observation, and verifies them through the service; unmatched members proceed to the diff untouched (DEC-SMP-046).
- [ ] AC4: On an accepted API observation the worker stamps the account's capacity-refresh watermark through US-081's `recordAcceptedMemberSnapshot` (`source = api`); if US-081 has not integrated when this story closes, the stamp is a named deferred-integration item owed by whichever of the two integrates second (DEC-SMP-041).
- [ ] AC5: Demo: with one API and one csv_import account, the real hourly tick observes only the API account, journals every page, and accepts the snapshot; a pending checklist provision whose member now appears is verified through the existing lifecycle with its audit entry, a mismatching one becomes `verification_failed`; a failed page leaves no observation and no verification; a repeated tick with an unchanged provider list is an idempotent no-op; a conflicting equal-timestamp replay is rejected.

## Notes

- **CHG-095 (2026-10-14):** partitioned into **US-090** (accepted-provision-verification; AC2/AC3 and AC5 verification/rollback/replay) then **US-091** (hourly-api-observation; AC1/AC4 and AC5 hourly/API/paging/failure/replay/conflict). This story closes by parent-level verification after both children complete; original ACs remain the parent oracle. DEC-SMP-047 records state-change-only verification. P4(a) holds: isolated builds after child readiness, no main integration before CHG-093 integrates/formally closes.

- **CHG-086 (2026-10-12):** US-083 was partitioned; this story consumes accepted observations and now depends on **US-089**.
- Canonical child of **US-030** (parent AC1 — the production execution of the detection chain), minted by **CHG-077** on 2026-10-11 from the tenant's blocked US-078 readiness. Decisions DEC-SMP-044, DEC-SMP-046 (and DEC-SMP-041 for the stamp). Depends on US-083 (`Blocked By`). Nous allocation target ≈ 200 min; the tenant re-assesses. Parallel-safe with US-078 after US-083 subject to the tenant's file-boundary review (worker + verification extraction vs db/packages diff + web Deriva); when sequential, runs before US-078 so US-078's integrated demo can use the real hourly path.
- Reuses, does not re-specify: the US-046 schedule, US-056/US-057/US-058 connector composition and journal, the US-020 checklist and US-066 membership-poll verification semantics (relocated behind a port, not rewritten).
- Falsifiers that require repartition through Nous: a verification rewrite instead of an extraction, UI scope, or a file inventory above 20.
