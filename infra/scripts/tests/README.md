# Infra sync tests

The deterministic reconciler/configuration tests run in the default suite:

```bash
pnpm test:infra
```

The real Nous integration is explicitly gated because it needs a Nous checkout,
PostgreSQL state, and permission to create and drop isolated test databases:

```bash
python3 -m pip install -r infra/scripts/tests/requirements-integration.txt

export NOUS_SYSTEM=/path/to/nous/Nous/System
read -rsp "NOUS database URL: " NOUS_DB_URL && echo
export NOUS_DB_URL
export PG_DUMP=/path/to/server-compatible/pg_dump
export PG_RESTORE=/path/to/server-compatible/pg_restore

pnpm test:infra:integration
```

`NOUS_SYSTEM` and `NOUS_DB_URL` are mandatory; there are no machine-specific
fallbacks. `PG_DUMP` and `PG_RESTORE` default to commands on `PATH`, but their
client major version must support the configured server. The database role must
be able to read the source and create/drop databases on the test PostgreSQL
server. The test creates only UUID-named `nous_ledger_sync_test_*` databases,
loads them through bounded `pg_dump`/`pg_restore`, and drops the exact generated
name in cleanup. It never writes rows to the source database.

Do not place a password-bearing `NOUS_DB_URL` directly in command arguments or
echo it in logs. Supplying it through the environment is supported. The test
extracts the credential in-process, writes a uniquely named temporary
`PGPASSFILE` with mode `0600`, and gives `pg_dump`/`pg_restore` only sanitized
password-free URLs plus the credential-file path in their environment. The
credential file is removed on both success and failure.

Optional bounds:

```bash
export NOUS_INTEGRATION_COMMAND_TIMEOUT_SECONDS=120
export NOUS_INTEGRATION_CONNECT_TIMEOUT_SECONDS=10
```

Every subprocess has the command timeout. Every database connection has the
connect timeout and applies the command timeout as PostgreSQL
`statement_timeout`.
