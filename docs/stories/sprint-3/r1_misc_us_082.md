# US-082: Execute connector seat removal in the production worker

> **Sprint 3** | **P0** | **1 SP** | **R1**

## User Story

As a Group Admin (persona_01), I want connector-backed removals to actually reach the vendor without my intervention so that same-business-day departures complete on API accounts — this child delivers: the production worker claims `remove` actions, executes them through the shipped provider deprovision capability with credentials, composition and connector observations, finalizes confirmed removals through the US-075 primitive, and leaves failed removals retryable from the exceptions screen.

## Meta

| Field | Value |
|-------|-------|
| Story ID | US-082 |
| Feature | FEAT-018 |
| Sprint | Sprint 3 |
| Priority | P0 |
| Size | 1 SP |
| Release | R1 |
| Domain | r1_mvp |
| Journey | J2 |
| Screens | (jobs), SCR-exceptions |
| Server Actions | — |
| Entities | ProvisioningAction (U), ConnectorCallObservation (C), IntegrationCredential (R), VendorAccount (R), LicenseRequest (U via primitive), LicenseAssignment (U via primitive), RequestTransition (C via primitive) |
| Business Rules | BR-14 |
| Blocked By | US-019, US-020, US-087 |

## Acceptance Criteria

- [ ] AC1: The production worker's action selection includes `kind = remove` (today it selects `invite` only) for `mode = automated` accounts whose capability descriptor supports removal, claims each action once (no double dispatch across workers or ticks), and executes it through the shipped provider deprovision capability with the account's credentials, the US-056/US-057 composition and one ConnectorCallObservation per attempt (DEC-SMP-042).
- [ ] AC2: A provider-confirmed removal — including a provider "already removed / not a member" response, which counts as success — finalizes through the US-075 primitive only: action `confirmed`, `offboarding → deprovisioned`, register closed, one transaction; the worker never writes register, request or transition rows directly.
- [ ] AC3: A provider or transport failure marks the action `failed` with the sanitized error, keeps the request in `offboarding` and the register open (DEC-SMP-033), applies a bounded retry policy, and surfaces the action on SCR-exceptions Fallidas with the existing retry affordance; a retry re-dispatches idempotently. Failed removals do not fire `provisioning_failure` (the provisioning path's rule); overdue ones reach `deprovision_overdue` through US-077.
- [ ] AC4: Demo: a connector-backed `left_company` removal is dispatched on the next tick, observed, confirmed and finalized with the register closed; an injected provider failure leaves the request `offboarding` and the register open, shows on Fallidas and succeeds on retry; an "already removed" response finalizes without error; two workers racing on one action dispatch once; capacity does not move until the next accepted observation (US-081).

## Notes

- **CHG-083 (2026-10-11):** US-075 was partitioned; this story now depends on **US-087** (the child that owns what it consumes) instead of the parent.
- Canonical child of **US-024** (parent AC coverage: **AC1** connector execution), minted by **CHG-076** on 2026-10-11 from the tenant's blocked US-075 readiness, which found the people entrypoint falling back to the checklist through an unregistered dispatcher, the worker selecting `invite` only, and no removal finalization. Decisions DEC-SMP-033, DEC-SMP-042. Depends on US-075's entrypoint and primitive (`Blocked By`). Nous allocation target ≈ 180 min; the tenant re-assesses.
- Reuses, does not re-specify: the provider deprovision capability and action planner (US-025/US-063..066), credential/composition/observation foundations (US-056/US-057/US-058), the Fallidas retry affordance. Runs after US-075; US-077 (worker alert surface) is sequenced after this story; US-076 may run in parallel with it subject to the file-boundary review.
- Vertical delivery: worker selection/claim, dispatch, failure/retry, finalization call, exceptions surface, verification with contract-backed connector fixtures (success, failure, already-removed, race), review, integration. No migration expected.
