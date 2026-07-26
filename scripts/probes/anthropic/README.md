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
      "analyticsKeyEnv": "ANTHROPIC_CENTRAL_ANALYTICS_KEY",
      "expectedOrganizationIdHash": "hmac-sha256:<64 lowercase hex characters>"
    }
  ]
}
```

Set the named variables in the operator's secret-aware shell. Admin and
Analytics variables must be different for every organization. Also set
`PROBE_HASH_SALT` to a random secret of at least 32 characters. Keep the salt
stable between authorized runs when comparing HMACs, rotate it when correlation
is no longer needed, and never commit it.

Provision `expectedOrganizationIdHash` out of band from the organization ID
shown in the trusted Anthropic administrator console. It must be an HMAC-SHA256
using the same `PROBE_HASH_SALT`; never put the raw provider organization ID in
the manifest or artifact. The probe compares this expected hash with the
schema-valid `GET /v1/organizations/me` response before mutation and fails
closed for a mismatch, invalid response, or non-2xx status.

## Read-only run

Use a UTC day for which Analytics data is available:

```bash
rtk node --experimental-strip-types scripts/probes/anthropic/probe.ts \
  --date 2026-07-24 \
  --manifest .env.anthropic-probe-manifest.local \
  --output docs/spikes/US-054-anthropic-api-probe.runtime.json \
  --checkpoint docs/spikes/US-054-anthropic-api-probe.checkpoint.json
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
an invite ID in a 2xx, schema-valid response, withdrawal runs in a `finally`
block. An ID in a non-2xx or invalid response is never used as a deletion
target. A missing gate is evidence that the canary was not executed, not a
successful dry run.

Immediately before the POST, the probe atomically writes an owner-only (`0600`)
checkpoint whose `manual_review_required` value is `true`. It remains true
after confirmed creation and becomes false only after both DELETE and the final
checkpoint write succeed. Each manifest organization receives a separate file
derived from the base `--checkpoint` path plus its 64-character
organization-reference HMAC, so one organization's unresolved state cannot
overwrite another's. Artifacts expose only that safe filename, never a local
directory path.

A checkpoint persistence failure is distinct from an HTTP transport failure.
It prevents the POST when it occurs before mutation, preserves the last durable
true state after mutation, and returns the explicit manual-review exit status.
Keep all per-organization checkpoint files when the process exits non-zero.

A network/transport failure during creation or withdrawal is recorded only as
`indeterminate_manual_review_required`; no exception text or response body is
persisted. The operator must inspect the target organization immediately and
withdraw any surviving canary manually.
The same manual-review state applies to a successful create response without a
parseable invite ID, missing cleanup evidence after a successful create, and
every non-2xx withdrawal response.

CLI exit codes are `0` for a completed run without uncertainty, `2` when
manual review is required, and `1` for validation, execution, or artifact-write
failure. Standard error contains only a generic JSON status.

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
printed. Artifacts and checkpoints use a symlink-rejecting atomic writer that
rejects the final target and every parent path component. An exclusive
same-directory temporary file is created at `0600`, flushed, renamed, forced
back to `0600`, and the directory is synced. Temporary files are removed after
write failure.

## Verification

The suite uses public-schema-derived synthetic values and never opens a network
connection:

```bash
rtk ./apps/web/node_modules/.bin/vitest run \
  --config scripts/probes/anthropic/vitest.config.ts
rtk pnpm --dir scripts/probes/anthropic run type-check
rtk pnpm --dir scripts/probes/anthropic run lint
rtk pnpm --dir scripts/probes/anthropic run test:mutation
```

It validates cursor families, exact fractional-cent conversion, key-family
separation, status classification, provider-target binding, invite gates,
checkpoint ordering and recovery states, CLI exits, atomic file safety, header
allowlisting, and redaction. Deterministic transport fixtures are derived from
public provider schemas and exercise only the injected third-party network
boundary; they never connect to Anthropic. The safety-critical mutation gate
fails below 80%.
