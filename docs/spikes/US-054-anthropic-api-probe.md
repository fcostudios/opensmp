# US-054 — Anthropic API probe evidence

**Status:** harness ready; real per-organization execution not performed  
**Contract review:** 2026-07-26  
**Evidence classification:** public documentation + synthetic fixtures only

No Anthropic key, private inventory, approved canary address, or immediate
VendorAccount confirmation was available in this workspace. Consequently, this
document does not claim US-054 AC1 or AC2 complete and contains no real provider
payload.

## Current official contract

The implementation was checked against Anthropic's current official
documentation:

- [Admin API overview](https://platform.claude.com/docs/en/manage-claude/overview)
- [Claude Enterprise user management](https://platform.claude.com/docs/en/manage-claude/user-management)
- [Analytics APIs and key selection](https://platform.claude.com/docs/en/manage-claude/analytics-api)
- [Enterprise Analytics user activity](https://platform.claude.com/docs/en/api/admin/analytics/users/list)
- [Enterprise Analytics cost reports](https://platform.claude.com/docs/en/api/admin/analytics/cost)
- [Usage and Cost API selection](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)

As of the review date:

| Surface | Credential | Endpoint/pagination | Header behavior |
|---|---|---|---|
| Current organization | Admin API key | `GET /v1/organizations/me` | `x-api-key`; `anthropic-version: 2023-06-01` |
| Members | Admin API key with member-read scope | `GET /v1/organizations/users`; `before_id`/`after_id`, `first_id`/`last_id`, `has_more` | member requests take `anthropic-version: 2023-06-01` and no beta header |
| Invites | Admin API key with member-read/write scope | `GET/POST /v1/organizations/invites`; `DELETE /v1/organizations/invites/{id}`; ID pagination | invite requests take `anthropic-version: 2023-06-01` and no beta header |
| Enterprise activity | distinct Analytics API key with `read:analytics` | `/v1/organizations/analytics/users` and `/summaries`; opaque `next_page` → `page` where paginated | `x-api-key`; no global beta header documented |
| Enterprise usage/cost | distinct Analytics API key | `/v1/organizations/analytics/usage_report`, `/user_usage_report`, `/cost_report`, `/user_cost_report`; opaque cursor | amount fields are decimal strings in fractional cents |

Admin and Enterprise Analytics keys are provisioned separately and are not
interchangeable. Admin user/invite lists are ID-paginated; Analytics uses opaque
page tokens. Analytics cursors are bound to the query that issued them.

Anthropic documents Admin API reads at 100 requests/minute per organization,
invite creation at 1,200/hour, and Enterprise Analytics at 60 requests/minute
per organization. Real response headers and 429 behavior remain execution
evidence, not documentation-only evidence.

## Invite mutation finding

There is no documented invite dry-run operation. The current create-invite
operation sends an email, creates a pending invite, and can consume a seat.
Therefore the harness performs no mutation unless the operator supplies all of:

1. `PROBE_ALLOW_INVITE_MUTATION=true`;
2. an approved `PROBE_CANARY_EMAIL` plus
   `PROBE_CANARY_EMAIL_APPROVED=true`;
3. `PROBE_CONFIRMED_VENDOR_ACCOUNT_REF` matching the manifest organization
   plus `PROBE_VENDOR_ACCOUNT_CONFIRMED_AT` no more than five minutes old,
   supplied immediately before execution.

If creation yields an invite ID, the withdrawal call is attempted in `finally`.
Without all gates, the artifact records `invite_canary: not_executed`.
All organizations' read-only phases complete before the first canary phase.
Transport uncertainty during creation or cleanup is recorded as sanitized
`indeterminate_manual_review_required` evidence and requires immediate manual
inspection; raw exception text is never retained.

## Scope notes for Sprint 3

These are the deltas to carry into planning; they are not claims based on a real
tenant run.

### US-054-SN-001 — Replace “invite dry-run”

US-054 AC1 assumes an invite dry-run. The public API exposes a real
create-and-withdraw flow instead. Change the acceptance language to “controlled
invite canary with explicit operator authorization and cleanup evidence.”

### US-054-SN-002 — Make headers endpoint-specific in US-018 AC1

US-018 AC1 says `anthropic-version + beta header` are pinned in one module.
Member and invite endpoints explicitly take no beta header. Keep header policy
centralized, but represent it per endpoint/capability rather than adding one
global beta header.

### US-054-SN-003 — Preserve separate key families

US-018 must model Admin and Enterprise Analytics credentials as distinct kinds.
Fail closed before network access when a credential is attached to the wrong
capability. One generic “Anthropic key” abstraction would encode the wrong
contract.

### US-054-SN-004 — Revisit raw payload persistence

US-018 AC2 and US-026 AC1 currently require raw requests/responses or raw
payloads. Current member and Analytics responses contain provider IDs, names,
and email addresses; request headers contain credentials. Before Sprint 3,
define a restricted encrypted payload store and explicit field/header
exclusions, or revise the ACs to sanitized canonical payloads. Secrets must
never enter `ProvisioningAction`, `ActivityRecord`, `CostRecord`, logs, or the
audit diff.

### US-054-SN-005 — Exact cost arithmetic and revision window

Enterprise cost amounts are decimal strings in fractional cents, including
sub-cent precision. US-026 must use exact decimal arithmetic rather than
JavaScript `number`. Anthropic states that cost data can be revised and is not
final until roughly 30 days after usage, which supports the existing 30-day
resync window.

### US-054-SN-006 — Identity matching has a null-email case

Analytics user records expose email for active users, supporting US-026's
email-based matching assumption, but deleted users may have a null email while
retaining a provider user ID. US-026 needs an unmatched/deleted-user path that
does not silently discard cost or activity.

## Harness evidence

The harness lives in `scripts/probes/anthropic/` and:

- reads a gitignored JSON manifest containing only environment-variable names;
- runs every non-mutating endpoint before considering an invite canary;
- keeps Admin and Analytics key routing explicit;
- validates documented pagination and cost-decimal shapes;
- constrains one-day usage/cost probes to `bucket_width=1d&limit=1`;
- resolves all key variables and rejects equal Admin/Analytics secret values
  before the first network call;
- stores only allowlisted metadata, schema/type paths, and salted HMACs;
- never persists raw bodies, full PII, IDs, credentials, or authorization
  headers;
- classifies authentication, authorization/key mismatch, missing route/header
  behavior, rate limiting, and provider errors.

Synthetic contract verification:

```text
15 tests passed
```

The suite does not mock Anthropic HTTP. A future HTTP-boundary test must first
add root-level `@pact-foundation/pact` and wire a contract-test task, then verify
the Pact against an authorized provider run or an explicitly governed
official-schema adapter. Until that exists, the pure fixture checks are the
strongest policy-compliant offline validation.

## Remaining external gates

- final OQ-SMP-1 organization inventory;
- per-organization Admin and Analytics API keys with the required scopes;
- approved canary email;
- immediate VendorAccount confirmation for each mutation;
- an authorized real run per organization;
- review of sanitized runtime artifacts and filing/acceptance of the scope
  notes above.
