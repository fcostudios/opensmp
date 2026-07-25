# Encrypted, signed database backup and restore

This US-002 procedure is deliberately fail-closed: a restore creates a new
target database; it never cleans, overwrites, or attaches to an existing one.

## Operating contract

The base application stack intentionally has no `backup` service. Normal
startup is only the base file; a backup is an explicit, on-demand operation
that adds `infra/docker-compose.backup.yml` and selects its `backup` profile:

```bash
docker compose -f infra/docker-compose.yml up -d

# After exporting the required operator variables below:
docker compose -f infra/docker-compose.yml \
  -f infra/docker-compose.backup.yml \
  --profile backup run --rm backup
```

The backup and restore scripts use discrete libpq variables. `DATABASE_URL` is
not an accepted backup or restore input: do not add it to an operator command,
the backup profile, or a cron environment.

## Key custody, schedule, and retention

Generate a passwordless Minisign Ed25519 key pair (`-W`) only on an operator
workstation or in a disposable drill directory, never in this repository. Move
the private key to an operator-managed secret location outside the checkout:

```bash
minisign -G -W -s ledger-backup-signing.key -p ledger-backup-verify.pub
chmod 600 ledger-backup-signing.key
chmod 644 ledger-backup-verify.pub
```

- `BACKUP_SIGNING_KEY_FILE` is the private signing secret. Its host path (for
  example, `/srv/ledger/secrets/backup-signing.key`) must be outside Git, have
  mode `0600`, and be owned by the VPS operator that runs the backup. Compose
  mounts it read-only only into the on-demand `backup` service at
  `/run/ledger-secrets/backup-signing.key`; it is never mounted into restore,
  the application, worker, image build, a Compose volume, or cron.
- `BACKUP_OUTPUT_DIR` is an existing, operator-owned output directory outside
  the checkout (for example, `/srv/ledger/backups`). It is bind-mounted only
  for the backup invocation. Do not put either host path in a committed `.env`
  file.
- `BACKUP_VERIFY_KEY_FILE` is only the matching public key, mounted read-only
  into the restore command. The signature carries a key id: retain a versioned
  public-key ring in off-host escrow so older backups remain verifiable during
  a rotation overlap.
- Rotate by deploying a new signing key and retaining old and new public keys
  for every retained artifact. Record its key id/cutover in the vault. Revoke a
  compromised signing key immediately; preserve its public key only for
  incident review and treat its artifacts as untrusted until recovered and
  re-signed under the replacement key.
- `ledger_backup` has `CONNECT`, `pg_read_all_data`, and explicit
  `EXECUTE` only on `pg_catalog.pg_control_system()` so a manifest can bind a
  dump to its physical cluster. It has no mutation privilege.
- Install [`infra/backup/crontab`](../../infra/backup/crontab) in the VPS
  operator's crontab. Its environment must also set the two operator-managed
  host paths, for example:

```cron
BACKUP_SIGNING_KEY_FILE=/srv/ledger/secrets/backup-signing.key
BACKUP_OUTPUT_DIR=/srv/ledger/backups
CRON_TZ=UTC
0 7 * * * cd /opt/ledger && /usr/bin/env bash infra/backup/run-cron.sh
```

  `CRON_TZ=UTC` and `0 7 * * *` is 02:00 America/Guayaquil.
  `run-cron.sh` checks the paths, exports `BACKUP_UID=$(id -u)` and
  `BACKUP_GID=$(id -g)`, uses `pipefail`, and writes through journald's
  `logger`.

```bash
# Run as the same Linux user that owns the key and backup directory.
export BACKUP_UID="$(id -u)"
export BACKUP_GID="$(id -g)"
export BACKUP_OUTPUT_DIR='/srv/ledger/backups'
export BACKUP_SIGNING_KEY_FILE='/srv/ledger/secrets/backup-signing.key'

docker compose -f infra/docker-compose.yml \
  -f infra/docker-compose.backup.yml \
  --profile backup run --rm backup
```

The profile provides the backup process with `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, and `PGPASSWORD`; it must not be converted to a password-bearing
connection URI. With the Compose PostgreSQL service already running, apply the
role updates to an already-initialized PostgreSQL volume before relying on
`ledger_backup` or `ledger_restore_admin`:

```bash
./infra/postgres/apply-roles.sh
```

Each backup keeps four files together:

```text
ledger-YYYYMMDDHHMMSS.dump.age
ledger-YYYYMMDDHHMMSS.dump.age.sha256
ledger-YYYYMMDDHHMMSS.dump.age.manifest
ledger-YYYYMMDDHHMMSS.dump.age.manifest.minisig
```

The fixed signed manifest binds format version, basename, ciphertext SHA-256 and
size, UTC creation time, and PostgreSQL `system_identifier`. The checksum is
renamed and directory-fsynced before the ciphertext commit marker; all sidecars
are removed and the directory is fsynced after every later failure. Copy a
verified four-file set to an independently administered off-host store and
follow a written retention policy; a local volume alone is not a backup.

## Guarded restore

1. Obtain all four artifacts and the matching public verification key through
   the operator vault.
2. Choose a **new, absent** final target. Authenticate as
   `ledger_restore_admin`, not `ledger_owner`. It is an unprivileged,
   `NOINHERIT`, `NOSUPERUSER`, `NOCREATEROLE` role with `CREATEDB` and
   membership in `ledger_owner`, so it may `SET ROLE ledger_owner` only inside
   the guarded restore transaction. It also has the narrowly granted
   `EXECUTE` privilege on `pg_catalog.pg_control_system()`. On an existing
   PostgreSQL volume, run `./infra/postgres/apply-roles.sh` first so those
   grants and the restore-admin password exist.
3. Resolve and pin one endpoint. The signed source `system_identifier` is
   authenticated backup provenance and requires an explicit operator
   confirmation. The target endpoint's `system_identifier` is a **separate**
   explicit confirmation. A logical dump may be restored to a replacement
   cluster with a different target identifier. A physical failover workflow is
   different: it must retain the source identifier.
4. Use discrete libpq variables. Never put a password in a URI or argv.

```bash
unset DATABASE_URL
export PGHOST='203.0.113.10' # one explicit address, not a round-robin name
export PGPORT='5432'
export PGUSER='ledger_restore_admin'
export PGPASSWORD='REDACTED'
export RESTORE_ADMIN_DATABASE='postgres'
export RESTORE_TARGET_DATABASE='ledger_restore_20260725'
export RESTORE_TARGET_OWNER='ledger_owner'

target_system_identifier="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$RESTORE_ADMIN_DATABASE" \
  --command 'SELECT (pg_control_system()).system_identifier')"
backup_file="$PWD/ledger-YYYYMMDDHHMMSS.dump.age"
backup_name="$(basename "$backup_file")"
checksum_file="$backup_file.sha256"
manifest_file="$backup_file.manifest"
signature_file="$manifest_file.minisig"
identity_file="$PWD/age-restore-identity.txt"
verify_key_file="$PWD/ledger-backup-verify.pub"

# Verify the signed manifest before using its authenticated source provenance.
minisign -Vm "$manifest_file" -p "$verify_key_file" -x "$signature_file"
source_system_identifier="$(awk -F= '$1 == "source_system_identifier" { print $2 }' "$manifest_file")"
export RESTORE_CONFIRM_DATABASE="$RESTORE_TARGET_DATABASE"
export RESTORE_CONFIRM_HOST="$PGHOST"
export RESTORE_CONFIRM_PORT="$PGPORT"
export RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$source_system_identifier"
export RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$target_system_identifier"
export RESTORE_CONFIRM_FINGERPRINT="${RESTORE_TARGET_DATABASE}@${PGHOST}:${PGPORT}#${target_system_identifier}"
chmod 600 "$identity_file"

docker build -f infra/backup/Dockerfile infra -t ledger-backup:local
docker run --rm --user "$(id -u):$(id -g)" \
  --network ledger_default \
  --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD \
  --env RESTORE_ADMIN_DATABASE --env RESTORE_TARGET_DATABASE --env RESTORE_TARGET_OWNER \
  --env RESTORE_CONFIRM_DATABASE --env RESTORE_CONFIRM_HOST --env RESTORE_CONFIRM_PORT \
  --env RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER --env RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER \
  --env RESTORE_CONFIRM_FINGERPRINT \
  --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
  --env BACKUP_VERIFY_KEY_FILE=/run/restore/verify.pub \
  --mount type=bind,src="$backup_file",dst="/restore/$backup_name",readonly \
  --mount type=bind,src="$checksum_file",dst="/restore/$backup_name.sha256",readonly \
  --mount type=bind,src="$manifest_file",dst="/restore/$backup_name.manifest",readonly \
  --mount type=bind,src="$signature_file",dst="/restore/$backup_name.manifest.minisig",readonly \
  --mount type=bind,src="$identity_file",dst=/run/restore/identity.txt,readonly \
  --mount type=bind,src="$verify_key_file",dst=/run/restore/verify.pub,readonly \
  --entrypoint /usr/local/bin/restore-db.sh \
  ledger-backup:local "/restore/$backup_name"
```

The script takes no-follow descriptor copies of the backup artifacts into a
private staging directory, keeps the private age identity on its original
no-follow descriptor, verifies the checksum and Ed25519-signed manifest, then
confirms the signed source provenance and independently confirmed target
cluster. It resolves and pins the endpoint before mutation.

For all target prechecks, creation, restore, and promotion, one persistent
admin `psql` session holds PostgreSQL advisory lock `(741263, 2)`. The script
creates a cryptographically random `ledger_restore_stage_<128-bit-hex>`
database from `template0`, not the requested final target; it is owned by
`ledger_owner`, has `PUBLIC` database privileges revoked, and grants `CONNECT`
only to `ledger_owner` and `ledger_restore_admin`. Before it streams the dump,
the transaction verifies the staging name/OID and target system identifier,
sets the owner role, and revokes `PUBLIC` privileges on the `public` schema:

```text
age --decrypt → pg_restore --file=- → psql --single-transaction
```

No plaintext dump or `--clean` is used. After the streaming transaction
commits, the same lock-holding admin session verifies the staging
name/OID/owner and target system identifier again, confirms the final target is
still absent, and atomically renames the stage. The restore session has exited
before that rename; if a requested target appears, PostgreSQL rejects the
rename without overwriting or dropping it.

The script never automatically drops a staging database. Any signature,
endpoint, cluster, permission, promotion, or late SQL failure leaves the
staging database quarantined and prints its exact name and OID. This avoids a
name-based cleanup race.

### Maintenance coordination boundary

The advisory lock is an operational coordination mechanism, not a defence
against an actor that can bypass it. Schedule a maintenance window and require
migrations, manual DDL, and other privileged automation to honor
`pg_advisory_lock(741263, 2)` before a restore begins. A PostgreSQL superuser
or other sufficiently privileged actor can ignore the lock and alter, connect
to, or rename databases anyway; this procedure cannot protect against that
actor. Coordinate such maintenance explicitly and do not run a restore while
it is in progress.

### Manual quarantine cleanup

Only an operator may remove a quarantined staging database. Do it in a
coordinated maintenance window after acquiring the same advisory lock, then
reconnect to the **same pinned target endpoint** and verify the recorded name,
OID, owner, and target system identifier. Do not run a drop when this query
returns no row or anything unexpected:

```bash
export QUARANTINE_DATABASE='ledger_restore_stage_...'
export QUARANTINE_DATABASE_OID='12345' # exact OID printed by restore-db.sh

psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$RESTORE_ADMIN_DATABASE" \
  --set quarantine_database="$QUARANTINE_DATABASE" \
  --set quarantine_database_oid="$QUARANTINE_DATABASE_OID" \
  --set restore_target_owner="$RESTORE_TARGET_OWNER" \
  --set restore_target_system_identifier="$RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER" \
  --command "SELECT d.oid::text, r.rolname, (pg_control_system()).system_identifier::text
             FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
             WHERE d.datname = :'quarantine_database'
               AND d.oid::text = :'quarantine_database_oid'
               AND r.rolname = :'restore_target_owner'
               AND (pg_control_system()).system_identifier::text = :'restore_target_system_identifier';"
```

After independently checking that single returned row, terminate any remaining
connections to that exact database and manually drop it. The restore itself has
already closed its staging connection before promotion; do not terminate or
drop a database solely by a reused name.

## Drill evidence

```bash
tool_dir="$(infra/tests/bootstrap-backup-tools.sh)"
BACKUP_TEST_TOOLS_DIR="$tool_dir" "$tool_dir/bats" infra/tests/backup-restore.bats
```

The bootstrap obtains pinned SHA-256-verified `age` and `bats-core` only in
gitignored `.tmp/backup-restore-tools`. Minisign is pinned in the production
PostgreSQL image; tests generate ephemeral signing keys. If Docker cannot start
the fixture, record the drill as externally blocked and do not mark US-002
done from static checks.
