# US-091: Observe API membership on the real hourly worker

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want Ledger to observe API-connected org membership hourly with complete journaled evidence so that accepted membership evidence verifies provisions before downstream drift is evaluated.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-091 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (packages, jobs) |
| Server Actions | — |
| Entities | MemberObservation (C via pipeline), ConnectorCallObservation (C), VendorAccount (R), IntegrationCredential (R), AuditLog (C), ProvisioningAction (U via shared verification) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-089, US-090 |

## Acceptance Criteria

- [ ] AC1: The existing hourly memberSync default handler replaces its deferred stub with production composition over US-056/057/058, using the delivered schedule and credential-safe paginated connector. It selects only active ingestion_mode=api accounts with active vendors; csv_import/manual accounts are never polled regardless of provisioning mode. Every page attempt is journaled through ConnectorCallObservation, with requested-before-transport and terminal success/failure, without raw credentials, provider bodies or sensitive continuation tokens in public state. Both members and invitations streams must exhaust successfully before a complete normalized snapshot is handed to acceptMemberObservation(source=api); failed or malformed pages create no observation or verification (US-084 AC1; BR-24).
- [ ] AC2: One credential-free account-bound AuditLog run outcome per account per tick surfaces accepted, replayed, stale, conflict, incomplete, forbidden or failed, distinct from per-HTTP connector journals and the acceptance service's existing audit rows. Unsupported capabilities and account failures are visible; other accounts continue and no account is partially accepted. The failure alert-path requirement is fixed in child readiness against ADR-04 and the existing operational reporter; no silent failure or invented schema/logger contract (US-084 AC1; approved P5).
- [ ] AC3: Use the injected worker clock at the first page request as observed_at. Preserve DEC-SMP-044: older is stale, equal time/equal hash is replay, equal time/different hash is conflict, newer (including empty or unchanged content) accepts freshness. Accepted API observations invoke the already delivered shared verification adapter before downstream diff consumers. Stamp the account capacity watermark only through US-081 recordAcceptedMemberSnapshot(source=api) if available; otherwise record a named deferred-integration item owed by whichever integrates second. No local watermark/schema/migration substitute (US-084 AC4; DEC-SMP-041/044/047).
- [ ] AC4: Demo through the real hourly runtime/default handler with API and csv_import/manual accounts: only API is polled, every page is safely journaled, the complete snapshot is accepted and shared provision verification runs with its exact lifecycle/audit effects. A failed page leaves no observation or verification while another account can finish. Repeating an unchanged tick adds no duplicate assignment, transition, verification alert or lifecycle notice; same-time equivalent is replay, conflicting equal-time is rejected, and a later same-content tick still advances observation freshness (US-084 AC5 hourly/API/paging/failure/replay/conflict clauses).

## Notes

- Canonical child of US-084 (second), allocated through the Nous ledger under CHG-095 on 2026-10-14 after Francisco approved exact P1–P5. Proposal hourly-api-observation. Owns US-084 AC1/AC4 and hourly clauses of AC5; depends on US-090. Parent closes by integrated verification with explicit cross-cutting AC5 coverage, not by reimplementing either child.
- Allocation estimate210 minutes (readiness20, implementation60, focused verification90, review30, integration10), five expected delivery paths. Tenant re-assesses its own exact digest before code; all tests/reviews/gates/own cold included, no borrowed proof. Parent sunk readiness is counted once.
- DEC-SMP-047 state-change-only adapter is delivered by US-090; this child composes it and does not duplicate its workflow. Existing hourly schedule, connector/Pact contracts, credential encryption, rate limit/retry and journal services are reused. No UI, migration, generic mutation tooling or guide/config/pin delivery.
- US-081 deferred-integration debt: accepted API observations call recordAcceptedMemberSnapshot(source=api) once it is integrated; whichever story integrates second owes the connection and verification. Until then this child records the named debt and never stamps locally. This is allowed by US-084 AC4, not a hidden omission.
- P4(a) integration hold inherited from the shared verification delivery: no integration that invalidates CHG-093 before it integrates/formally closes. Carry source reconciliation and evidence identity into readiness. BR-24 stays non-critical per CHG-086; normal own cold effectiveness proof applies.

- **CHG-099 / DEC-SMP-048 (2026-10-15), approved AC5 B obligation:** US-093 is the accepted-episode/real-alert/Deriva outcome of the US-078 partition. Whichever of US-093 and US-091 integrates second owns the actual production hourly wiring and end-to-end episode/alert equivalence demo. Record this named conditional obligation in current readiness and parent verification; inventory/budget any worker-composition/test changes before execution, never hide extra paths/effort or use synthetic/borrowed evidence. No unconditional circular dependency is added. US-090 Blocked By, actual shared-verification completion, all US-091 ACs, US-081 watermark debt, existing owner and P4(a) main hold are unchanged. This Notes amendment supplies no implementation-readiness approval or candidate-only dependency exception.
