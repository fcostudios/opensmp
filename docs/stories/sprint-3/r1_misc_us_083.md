# US-083: Accept complete member observations with authoritative identity and license evidence

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want every console membership observation Ledger acts on to carry real provider identity, membership status and license evidence so that drift is never inferred from a guessed seat or license — this child delivers: the lossless connector member contract with its external contract proof, the per-vendor/per-account license mapping, the append-only `MemberObservation` ledger with completeness, replay and conflict rules under the account lock, and durable identity/license warnings. No worker, no UI, no drift logic.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-083 |
| Feature | FEAT-023 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J4 |
| Screens | (packages) |
| Server Actions | — |
| Entities | MemberObservation (C), Vendor (U capability fields), LicenseType (U provider_ref), VendorAccount (U default_license_type_id), ConnectorCallObservation (R), AuditLog (C) |
| Business Rules | BR-24 |
| Blocked By | US-056, US-057, US-058, US-046, US-042, US-088, US-089 |
| Migration | slug=member_observations |

## Acceptance Criteria

- [ ] AC1: The connector member contract is lossless: each observed member is a normalized record with `provider_member_ref` (preserved whenever the provider exposes one), nullable `email` and `display_name`, `membership_status ∈ {member, invited}`, the reported role, `seat_evidence ∈ {licensed, unlicensed, unknown}` with its provenance (`provider_field:<name>` or `capability:all_members_licensed`), a nullable `provider_license_ref`, and a resolved `license_type_id` or an `unmapped_license` warning. Null-e-mail records are kept (identity = provider ref) with a `null_email` warning; nothing is dropped, and no member is ever treated as licensed or mapped to a catalogue license by assumption (DEC-SMP-043).
- [ ] AC2: Provider capability limits are declared, not guessed: `Vendor.member_seat_evidence ∈ {provider_field, all_members_licensed, none}` and `Vendor.member_license_identity ∈ {provider_field, none}`; mapping uses `LicenseType.provider_ref` when the provider exposes a per-member seat type and `VendorAccount.default_license_type_id` when it does not (Anthropic R1: `all_members_licensed` + `none`). The Anthropic contract (Pact) proves null-e-mail preservation, invited vs member, provider id, role and complete pagination; a vendor declared `none` for seat evidence yields `unknown` + warning, never `licensed`.
- [ ] AC3: `acceptMemberObservation(vendor_account_id, source, observed_at, members, completeness)` is the single acceptance pipeline: completeness is validated (every page succeeded in the connector journal and the provider total matches when exposed; a CSV parsed to the end), the account advisory lock is taken, and the snapshot is compared with the latest accepted `MemberObservation`: older `observed_at` → rejected `stale` (AuditLog, no state change); equal `observed_at` and equal `content_hash` → idempotent no-op returning the prior row; equal `observed_at` and different hash → rejected `conflict` (AuditLog + account warning); newer → one ledger row (`UNIQUE(vendor_account_id, observed_at)`) and the `member_observation_accepted` event for consumers (US-078 drift diff, US-081 capacity watermark). A complete empty snapshot is a valid observation (DEC-SMP-044).
- [ ] AC4: The append-only migration (`slug=member_observations`) ships `MemberObservation`, the three mapping/capability columns, RLS and application-role grants, applied and parity-verified on a fresh database; identity/license warnings are persisted on the observation row (`warnings[]`: kind, provider ref, e-mail, detail) and nothing else is created for a warned member (DEC-SMP-045).
- [ ] AC5: Demo: a complete Anthropic fixture with licensed members, two invitations, one null-e-mail member and one member whose seat type has no mapping yields exactly the expected records and warnings; invitations are not seats; an older snapshot is rejected `stale` after a newer one; an identical replay is a no-op; an equal-timestamp different snapshot is rejected `conflict`; a complete empty snapshot is accepted with `member_count = 0`; a vendor declared `none` for seat evidence produces `unknown` + warnings; the ledger survives a fresh-database apply with its grants.

## Notes

- **CHG-086 (2026-10-12) — partitioned after execution** (final cold 74.15%; full forecast 357 against 320): **US-088** (authoritative member evidence + persisted mapping; owns the committed combined migration whole) → **US-089** (atomic acceptance; owns the root export). This story closes by verification. Completed commits, approval history and real sunk cost are preserved and split between the children by the tenant. No policy change.
- Canonical child of **US-030** (parent AC1 — the evidence foundation of the detection chain), minted by **CHG-077** on 2026-10-11 from the tenant's blocked US-078 readiness (`docs/readiness/US-078.json`, 540 min / 38 files / 2 boundaries against the 270-minute / 20-file ceiling; the connector exposed `{email, active}` only). Decisions DEC-SMP-043, DEC-SMP-044, DEC-SMP-045. First of the amended chain: **US-084** (hourly execution + confirmed-provision composition) and **US-078** (drift episodes, alerts, Deriva) consume it. Nous allocation target ≈ 220 min; the tenant re-assesses.
- Scopes: connectors contract + Pact, db migration, packages acceptance pipeline. The operator-facing `default_license_type_id` field lives in US-055 AC4's Configuración (ingestion-mode configuration), not here. The capacity watermark stamp (`recordAcceptedMemberSnapshot`, US-081/DEC-SMP-041) is a consumer of the event: US-084 wires it for API observations once both are integrated.
- Falsifiers that require repartition through Nous: a second provider, UI scope, or a file inventory above 20.
