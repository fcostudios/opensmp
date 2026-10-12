# US-088: Deliver authoritative member evidence and its persisted catalogue mapping

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want every membership listing Ledger reads to carry real provider identity, status and declared license evidence so that drift is never inferred from a guess — this child delivers: the lossless connector member contract with its Anthropic Pact proof and shipped invitation-poll compatibility, and the persisted capability/mapping declarations (`Vendor.member_seat_evidence` / `member_license_identity`, `LicenseType.provider_ref`, `VendorAccount.default_license_type_id`) through the already committed combined migration, verified on a fresh database.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-088 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (packages) |
| Server Actions | — |
| Entities | Vendor (U capability fields), LicenseType (U provider_ref), VendorAccount (U default_license_type_id), MemberObservation (C schema only), ConnectorCallObservation (R) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042 |
| Migration | slug=member_observations |

## Acceptance Criteria

- [ ] AC1: The connector member contract is lossless (US-083 AC1 raw evidence): provider member ref, nullable e-mail and display name, member vs invited, reported role, seat evidence with provenance and nullable provider license ref; null-e-mail records are kept; the shipped legacy `{email, active}` projection and the invitation membership poll keep working unchanged (DEC-SMP-043).
- [ ] AC2: Provider limits are declared on the persisted capability descriptor and proven by the Anthropic Pact: complete pagination, two invitations, a null-e-mail member, provider id and role, no implicit per-member seat identity; Anthropic persists `all_members_licensed` + `none`, and an unknown provider defaults to `none`/NULL (US-083 AC2 declarations, AC5 provider demo).
- [ ] AC3: The committed combined migration `V20261011165000__member_observations.sql` (checkpoint `00e8072`) is owned here **whole** — mapping/capability columns AND the `member_observation` table, its RLS and grants — applied append-only and verified on a fresh database, including the existing release inventories updated to 33 tables / 87 foreign keys in `migration-release.integration.test.ts` (US-083 AC4 catalogue and schema portion). Ledger *behaviour* is US-089's.
- [ ] AC4: Demo: a complete Anthropic Pact fixture yields the exact authoritative records and descriptor while the legacy projection is unchanged; a fresh database applies the committed history and passes the physical, parity and release inventories with the exact runtime grant matrix.

## Notes

- Canonical child of **US-083** (first), minted by **CHG-086** on 2026-10-12 from the tenant's execution falsifier (`docs/superpowers/plans/2026-10-11-us083-plan.md` @ adaecb3: final cold 74.15%, full forecast 357 against 320). Proposal `authoritative-member-evidence`. Completed commits on candidate `6191fe8` that touch connectors, dispatcher, Pact, schema, verifier and physical tests are carried here with their share of the historical cost (the tenant states the split in readiness). The sources scored 94–100% only inside a failed combined campaign: this child needs its own cold campaign on its own sources unless the tenant's rules accept the retained per-source scores — decide in readiness.
