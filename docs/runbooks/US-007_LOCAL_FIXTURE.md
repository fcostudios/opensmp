# US-007 local go-live fixture

This runbook loads the committed US-007 synthetic fixture into an existing local
ledger development database. The generated credential values are synthetic and
nonfunctional.

## Prerequisites

- The existing `ledger-dev` stack is healthy.
- The repository-root `.env` has `DATABASE_URL` pointing to the local PostgreSQL
  port `15432`.
- Migrations have been applied and the schema verifier passes:

  ```bash
  rtk pnpm --dir packages/db drizzle-kit push
  rtk node packages/db/scripts/verify-schema.mjs
  ```

## Run the import

From the repository root, run these commands in order:

```bash
rtk pnpm --filter smp-web import:go-live init
rtk pnpm --filter smp-web import:go-live preview
rtk pnpm --filter smp-web import:go-live apply
rtk pnpm --filter smp-web import:go-live verify
rtk pnpm --filter smp-web import:go-live apply
rtk pnpm --filter smp-web import:go-live verify
```

`init` creates the runtime environment and encryption key under
`data/imports/private/`. That directory is ignored and must never be committed.
The command refuses to overwrite either file; remove the private files deliberately
before regenerating them. The runtime environment is mode `0600`; the KEK is
read-only mode `0400`.

The first `apply` creates 6 companies, 12 contact accounts, 2 vendor accounts, 1
license type, 12 people, 12 requests, 12 assignments, 2 capacity rows, 4 encrypted
credentials, and 12 contact grants. Reconciliation reports 10 imported assignments
against 15 seats for `corporativo-teams`, and 2 against 3 for `centrohub-teams`,
with zero member and capacity deltas.

The second `apply` is the idempotency check: every created counter must be zero.
Both `verify` runs must finish with `"status": "ok"`.

Anthropic Teams remains API-less: provisioning and reconciliation are manual/CSV
operations until US-055.
