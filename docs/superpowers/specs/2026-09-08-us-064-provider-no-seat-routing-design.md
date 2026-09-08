# US-064 Provider No-Seat Routing Design

## Readiness

- Work item: `US-064`
- Readiness artifact: `docs/readiness/US-064.json`
- Approved payload: `e1a1d0ac1db253740fe51ecf6073bce4209617ba8f446c8e2305be6e9a80518e`
- Estimate: 104 minutes, within the 320-minute limit
- Primary outcome: a classified provider no-seat response atomically enters the existing capacity workflow while every other provider failure remains distinct

## Context

US-063 established the automated Anthropic invitation worker, the durable connector-call observation journal, advisory-lock crash protection, and atomic success finalization. Today every unsuccessful connector result is a generic `provider_error`; the worker leaves the action pending and cannot distinguish capacity exhaustion from authentication, malformed input, conflicts, or provider failure.

US-064 extends that existing seam. It does not add a new queue, screen, migration, or provider-specific branch outside the Anthropic adapter. The existing exception UI and US-023 capacity-recovery worker already consume `blocked_no_seat` requests.

Anthropic's documented error envelope exposes HTTP status plus `error.type` and `error.message`, but no stable machine-readable seat-limit code. Classification must therefore be deliberately narrow and backed by the consumer Pact.

## Chosen Architecture

### Provider classification

The Anthropic request layer recognizes capacity exhaustion only for all of these conditions:

1. endpoint is `create_invite`;
2. status is exactly `400`;
3. response media type is `application/json`;
4. the bounded response is the strict Anthropic error envelope;
5. `error.type` is exactly `invalid_request_error`; and
6. `error.message` is exactly `Your organization has reached its seat limit.`

The message is a one-entry allowlist owned by the Anthropic adapter and exercised by the Pact contract. Adding or changing a provider message requires a new contract example. Prefix, suffix, case, whitespace, type, status, endpoint, or shape differences fail closed.

The reader accepts at most 8 KiB of UTF-8 response data. Oversized, truncated, malformed, non-JSON, or unexpected responses become ordinary provider errors and are never retained verbatim.

### Provider-neutral result and durable evidence

`ConnectorResult<T>` gains a distinct failure variant:

```ts
type CapacityUnavailable = Readonly<{
  ok: false;
  code: "capacity_unavailable";
  retryable: false;
  raw: Readonly<{ failure_code: "capacity_unavailable" }>;
}>;
```

The dispatcher validates, clones, and freezes this result like every other connector result. No provider error message, response body, request ID, or credential crosses the provider boundary.

The low-level Anthropic observation remains classified as `client_error`, preserving the existing database vocabulary. Its sanitized summary gains optional `failure_code: "capacity_unavailable"`. This JSON field requires no schema migration and provides the durable recovery fact required by the worker transaction.

### Atomic worker finalization

When the invitation worker receives `capacity_unavailable`, it starts one PostgreSQL transaction and:

1. locks the exact pending `ProvisioningAction` and its `LicenseRequest` using action, vendor-account, request, and company identities;
2. requires the request to still be `provisioning`;
3. requires a linked failed connector observation with `classification='client_error'` and sanitized `summary.failure_code='capacity_unavailable'`;
4. updates the action to `failed`, stores only `{ "failure_code": "capacity_unavailable" }` in `raw_response`, and sets `resolved_at`;
5. asks the lifecycle engine to validate `provisioning -> blocked_no_seat`; and
6. applies the request transition and audit record through `applyRequestTransitionInTransaction`.

The transaction commits all local state together. A lock mismatch returns an idempotent no-op. Any update, transition, or audit failure rolls the action and request changes back together. The remote HTTP call and its append-only observation cannot participate in the local transaction; the durable sanitized observation is the recovery boundary.

Generic connector failures retain the existing behavior for US-065. They do not call no-seat finalization and cannot create a `blocked_no_seat` transition.

### Capacity recovery

The lifecycle table gains the legal transition `provisioning -> blocked_no_seat`; the existing `blocked_no_seat -> provisioning` transition remains unchanged.

US-023 recovery selects the blocked request and routes it through `routeProvisioningActionInTransaction`. Provisioning-action reuse is limited to a still-pending action. The historical failed no-seat action therefore remains immutable while recovery creates a new pending invitation action and returns the request to `provisioning` through the lifecycle engine.

No new UI is required: the request detail and exception workbench already expose `blocked_no_seat`, purchase capacity, and reclaim-capacity navigation.

## Error Handling and Security

- Every classification condition is conjunctive and fail-closed.
- Other 400 responses and all other 4xx/5xx responses remain generic failures.
- Provider bodies and messages never enter `ProvisioningAction`, audit logs, connector results, or thrown errors.
- Transaction queries bind real `company_id`, vendor-account, request, and action identities.
- Advisory locks preserve the US-063 duplicate-dispatch and duplicate-finalization protections.
- A no-seat result without matching durable evidence cannot change business state.
- A failed transaction cannot leave a partially finalized action or request transition.

## Verification Strategy

All behavior is implemented test-first under the repository testing standard.

1. Pure request and connector tests prove the exact allowlist, bounded parsing, semantic connector result, sanitized observation, and near-match rejection.
2. The Anthropic consumer Pact includes the exact recognized no-seat response and proves no provider response data leaks through the connector result.
3. Lifecycle tests prove `provisioning -> blocked_no_seat` is legal without broadening unrelated transitions.
4. Real-PostgreSQL worker tests prove one atomic no-seat transition, retained sanitized action evidence, tenant isolation, idempotent replay, concurrency behavior, and rollback on a forced audit failure.
5. Generic 400/401/403/409/422/429/5xx examples prove AC3 by leaving the request out of `blocked_no_seat`.
6. Capacity-recovery tests prove the failed attempt remains and a new pending action is created when capacity returns.
7. Adversarial acceptance-criteria verification occurs before the authoritative campaign.
8. `pnpm check` must pass before one cache-cleared, diff-scoped `pnpm test:mutation` campaign. Any code or test commit after that campaign invalidates it.

Every feedback event after `started` carries an ISO-8601 UTC `ts`. Exactly one authoritative `test_report` is emitted. Actuals record `mutation_shards_actual`, cold attempts, mutation minutes, review loops, and phase minutes. The CHG-057 acceptance target is measured from `story timeline US-064`: at most two cold campaigns and review minutes no greater than implementation minutes.

## Non-Goals

- Implementing the generic provisioning-failure retry policy owned by US-065.
- Activating accepted invitations, owned by US-066.
- Changing capacity purchasing or reclaim policy.
- Persisting raw provider error bodies or matching arbitrary provider message substrings.
- Adding a database enum value or migration for the sanitized failure code.
