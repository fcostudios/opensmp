# US-054 safe Anthropic probe

This harness captures only sanitized contract evidence from the current
Anthropic Admin and Claude Enterprise Analytics APIs. It never writes response
bodies, API keys, authorization headers, emails, names, or provider IDs.

## Inputs

Copy `manifest.example.json` to the already-gitignored default path
`.env.anthropic-probe-manifest.local`. The file is JSON despite its
security-oriented name. Its values are environment-variable **names**, never
key values:

```json
{
  "organizations": [
    {
      "ref": "central",
      "adminKeyEnv": "ANTHROPIC_CENTRAL_ADMIN_KEY",
      "analyticsKeyEnv": "ANTHROPIC_CENTRAL_ANALYTICS_KEY"
    }
  ]
}
```

Set the named variables in the operator's secret-aware shell. Admin and
Analytics variables must be different for every organization. Also set
`PROBE_HASH_SALT` to a random secret of at least 32 characters. Keep the salt
stable between authorized runs when comparing HMACs, rotate it when correlation
is no longer needed, and never commit it.

## Read-only run

Use a UTC day for which Analytics data is available:

```bash
rtk node --experimental-strip-types scripts/probes/anthropic/probe.ts \
  --date 2026-07-24 \
  --manifest .env.anthropic-probe-manifest.local \
  --output docs/spikes/US-054-anthropic-api-probe.runtime.json
```

The read-only sequence completes for **every manifest organization** before any
organization's mutation is considered:

1. current organization;
2. members and invites;
3. Enterprise activity users and summaries;
4. Enterprise usage and cost reports, each constrained to one `1d` bucket with
   `limit=1`.

Admin member/invite pages follow `after_id`; Analytics pages echo the opaque
`next_page` value as `page`. The harness caps each resource at 100 pages.
Before this schedule begins, every referenced secret is resolved and each
organization's Admin and Analytics values are compared. Missing or equal
resolved values fail before the first network request.

## Invite canary

There is no invite dry-run endpoint. `POST /v1/organizations/invites` sends an
email and may consume a purchased seat. The canary remains `not_executed` unless
all of these values are present in the same invocation:

```bash
PROBE_ALLOW_INVITE_MUTATION=true
PROBE_CANARY_EMAIL='operator-approved-address@example.com'
PROBE_CANARY_EMAIL_APPROVED=true
PROBE_CONFIRMED_VENDOR_ACCOUNT_REF='central'
PROBE_VENDOR_ACCOUNT_CONFIRMED_AT='2026-07-26T05:00:00Z'
```

`PROBE_CONFIRMED_VENDOR_ACCOUNT_REF` must equal the manifest organization
`ref`, and the RFC 3339 confirmation timestamp must be no more than five minutes
old, providing an expiring immediate target confirmation. When creation returns
an invite ID, withdrawal runs in a `finally` block. A missing gate is evidence
that the canary was not executed, not a successful dry run.

A network/transport failure during creation or withdrawal is recorded only as
`indeterminate_manual_review_required`; no exception text or response body is
persisted. The operator must inspect the target organization immediately and
withdraw any surviving canary manually.
The same manual-review state applies to a successful create response without a
parseable invite ID, missing cleanup evidence after a successful create, and
every non-2xx withdrawal response.

## Artifact contract

The JSON artifact allowlists:

- endpoint name, expected key family, HTTP status, and failure class;
- whether a beta header was sent or returned;
- retry/rate-limit headers;
- an HMAC of the request ID;
- response field paths and scalar types;
- pagination family, item count, schema result, and salted HMACs of sensitive
  values.

Raw response bodies are held only long enough to validate and summarize the
response, then discarded. Error bodies and thrown error messages are not
printed. Output mode is forced to `0600`, including when overwriting an existing
artifact with broader permissions.

## Verification

The suite uses public-schema-derived synthetic values and never opens a network
connection:

```bash
rtk ./apps/web/node_modules/.bin/vitest run \
  --config scripts/probes/anthropic/vitest.config.ts
rtk pnpm --dir scripts/probes/anthropic run type-check
rtk pnpm --dir scripts/probes/anthropic run lint
```

It validates cursor families, exact fractional-cent conversion, key-family
separation, status classification, invite gates, header allowlisting, and
redaction. It is deliberately not an HTTP mock: repository policy requires any
third-party mock to be Pact-backed. Adding an HTTP orchestration test therefore
requires root-level `@pact-foundation/pact` dependency and contract-test command
wiring before such a mock is introduced.
