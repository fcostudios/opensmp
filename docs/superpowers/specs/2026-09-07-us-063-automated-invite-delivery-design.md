# US-063 Automated Invite Delivery Design

## Context

US-063 is the first canonical child of US-019. US-056 supplies the bounded
Anthropic transport and retry policy, US-057 supplies append-only connector
attempt observations, US-058 supplies the conforming Anthropic connector, and
US-046 supplies the scheduled worker runtime. Approval already creates one
pending automated `ProvisioningAction`, moves its request from `approved` to
`provisioning` through the lifecycle engine, and stores the validated neutral
provision instruction in `raw_request`.

This story connects those completed seams. It does not create a second
scheduler, connector, action kind, credential format, or request transition
model. Provider no-seat routing, provisioning retry policy, and accepted-invite
activation belong to US-064, US-065, and US-066 respectively.

## Outcome

The existing 15-minute `invitePoll` job drains pending automated invite actions
for its scheduled vendor account. Each eligible action invokes the real
Anthropic connector exactly once. A known success durably binds the provider
reference and terminal connector observation to the action before the request
is advanced through the legal `provisioning -> invited` transition.

An action with any prior connector observation is not dispatched again. In
particular, a process crash or ambiguous transport result leaves the request in
`provisioning`, the action unresolved, and its append-only `requested`
observation available for reconciliation. This is deliberate fail-closed
behavior: the provider does not offer a proven idempotency contract for invite
creation, so automatic replay could create a duplicate invitation.

## Chosen Approach

Add a worker-local `createAutomatedInviteDeliveryJob` composition service. It
receives explicit ports for the completed Anthropic connector dependencies and
owns the PostgreSQL claim/finalization boundary. The default `invitePoll`
handler constructs it from the worker connection string and runs it only when
the scheduled job context contains a vendor account ID.

The job selects a small ordered batch of actions that are:

- `kind = 'invite'`, `mode = 'automated'`, and `status = 'pending'`;
- linked to the same `vendor_account_id` supplied by the trusted scheduler;
- linked to a request in `provisioning` under the same vendor account;
- validated against the closed version-1 provision payload; and
- free of every existing `ConnectorCallObservation`.

Candidate discovery never decrypts credentials for another vendor account.
The production credential resolver reads the mounted KEK once per drain,
selects only active account-bound Admin and Analytics rows, decrypts their
envelopes, and returns tagged candidates to the Anthropic factory. Although a
provision call uses only the Admin credential, the completed connector's
existing fail-closed contract validates the account's complete credential pair.

For each candidate, the connector receives the action ID as neutral
`requestId`. Its `observationSessionFor` port verifies that this ID still names
the selected action/vendor pair and creates a real database-backed session with
`provisioningActionId` set to that action. The US-057 appender commits the
`requested` observation before transport and the terminal observation after a
known provider response.

After a successful connector result, the worker opens one database transaction,
locks the action and request, proves the matching terminal success observation
already exists, writes `vendor_ref`, marks the action `sent`, and applies the
legal `provisioning -> invited` lifecycle persistence. The shared transition
helper validates `REQUEST_TRANSITIONS`, writes `request_transition`, updates the
request, and appends the audit event without requiring a human authorization
object. A conditional update makes repeated finalization a no-op.

## Crash and Concurrency Contract

The remote API cannot participate in Ledger's database transaction. The safe
recovery boundary is therefore explicit:

| Boundary | Durable state | Next poll |
|---|---|---|
| Before `requested` | pending action, no observation | may dispatch |
| After `requested`, before known result | provisioning + unmatched attempt | never replays |
| After terminal success, before finalization | provisioning + known success | never replays; operator reconciliation may finalize |
| After finalization | action sent + provider ref + invited transition | no-op |
| Known provider failure | provisioning + failed observation | never replays in US-063 |

Concurrent pollers may discover the same candidate, but each must acquire a
session-level PostgreSQL advisory lock derived from the action UUID and then
repeat the observation/state checks before dispatch. The lock is held on a
dedicated connection across the call, not inside a database transaction. A
crash releases it automatically; the already committed requested observation
then prevents replay. Thus only one poller can reach transport without holding
row locks or an open transaction across the network call.

## Lifecycle Persistence

The current lifecycle implementation mixes authorization checks with the core
state/audit persistence. Extract a database-owned system transition helper that
accepts a caller-owned transaction, validates the expected state and legal
transition, performs the conditional update, records `request_transition`, and
writes the audit event with a nullable system actor. The web helper retains its
existing company authorization checks and delegates only after those checks
pass. The invite worker delegates with the system actor and the already locked,
vendor-scoped request.

This keeps one lifecycle engine for user and worker transitions while avoiding
an import from the Next.js app into the worker package.

## Rejected Approaches

### Replay unmatched or failed invite attempts

Anthropic invite creation is not proven idempotent. Retrying an ambiguous
attempt could create two invitations and would violate AC1.

### Hold a PostgreSQL transaction across the provider call

This would not make the remote call atomic, and it would turn network latency
into lock contention. Durable pre-call evidence and fail-closed replay policy
provide the honest boundary.

### Update the request directly in the worker

Direct SQL would bypass legal-transition validation and duplicate lifecycle
persistence. The database-owned system transition helper is the shared seam.

### Re-export or replace the Anthropic connector

US-058 deliberately exposes the connector through its provider subpath. The
worker composes that exact factory and does not add a second provider adapter.

## Verification Strategy

Development follows red-green-refactor. Real PostgreSQL integration tests use
the repository Testcontainers fixture and only substitute the true Anthropic
HTTP boundary. They prove:

- one pending free-pool action becomes `sent`, gets the provider reference, and
  advances to `invited` within the scheduled 15-minute job window;
- the requested and succeeded observations are bound to the action before the
  invited state is durable;
- a second drain and concurrent drains produce only one provider invitation;
- an unmatched requested observation, known failure, foreign vendor account,
  malformed payload, or stale request state never reaches transport;
- a crash after remote success leaves visible evidence and is never replayed;
- the web authorization path continues to use the same lifecycle persistence;
  and
- logs and persisted summaries contain neither credential values nor raw
  provider bodies.

Adversarial AC verification and every repair precede the sole cold,
cache-cleared, diff-scoped mutation campaign. The campaign is the last
implementation command; any later implementation commit invalidates it.
