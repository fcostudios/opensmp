# Encrypted, signed database backup and restore

This US-002 procedure is deliberately fail-closed: a restore creates a new
target database; it never cleans, overwrites, or attaches to an existing one.

## Key custody, schedule, and retention

Generate a passwordless Minisign Ed25519 key pair (`-W`) only on an operator
workstation or in a disposable drill directory, never in this repository:

```bash
minisign -G -W -s ledger-backup-signing.key -p ledger-backup-verify.pub
chmod 600 ledger-backup-signing.key
chmod 644 ledger-backup-verify.pub
```

- `BACKUP_SIGNING_KEY_FILE` is the private signing secret. Compose mounts it
  read-only only into the on-demand `backup` service at
  `/run/ledger-secrets/backup-signing.key`; it is never mounted into restore,
  the application, worker, image build, a Compose volume, or cron.
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
- Install [`infra/backup/crontab`](../../infra/backup/crontab) on the VPS.
  `CRON_TZ=UTC` and `0 7 * * *` is 02:00 America/Guayaquil; `run-cron.sh`
  uses `pipefail` and writes through journald's `logger`.

```bash
docker build -f infra/backup/Dockerfile infra -t ledger-backup:local
docker compose -f infra/docker-compose.yml --profile backup run --rm backup
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
2. Choose a **new, absent** target. The restore admin must have
   `CREATE DATABASE` and permission to `SET ROLE ledger_owner`; the target is
   created from `template0` owned by `ledger_owner`. It must also have the
   narrowly granted `EXECUTE` privilege on `pg_catalog.pg_control_system()`
   (the supplied `ledger_owner` init role has that grant).
3. Resolve and pin one endpoint. Physical failover is permitted only when
   `(pg_control_system()).system_identifier` exactly matches the value signed
   into the backup manifest; another cluster is rejected before any database is
   created.
4. Use discrete libpq variables. Never put a password in a URI or argv.

```bash
export PGHOST='203.0.113.10' # one explicit address, not a round-robin name
export PGPORT='5432'
export PGUSER='ledger_restore_admin'
export PGPASSWORD='REDACTED'
export RESTORE_ADMIN_DATABASE='postgres'
export RESTORE_TARGET_DATABASE='ledger_restore_20260725'
export RESTORE_TARGET_OWNER='ledger_owner'

system_identifier="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$RESTORE_ADMIN_DATABASE" \
  --command 'SELECT (pg_control_system()).system_identifier')"
export RESTORE_CONFIRM_DATABASE="$RESTORE_TARGET_DATABASE"
export RESTORE_CONFIRM_HOST="$PGHOST"
export RESTORE_CONFIRM_PORT="$PGPORT"
export RESTORE_CONFIRM_SYSTEM_IDENTIFIER="$system_identifier"
export RESTORE_CONFIRM_FINGERPRINT="${RESTORE_TARGET_DATABASE}@${PGHOST}:${PGPORT}#${system_identifier}"

backup_file="$PWD/ledger-YYYYMMDDHHMMSS.dump.age"
backup_name="$(basename "$backup_file")"
checksum_file="$backup_file.sha256"
manifest_file="$backup_file.manifest"
signature_file="$manifest_file.minisig"
identity_file="$PWD/age-restore-identity.txt"
verify_key_file="$PWD/ledger-backup-verify.pub"
chmod 600 "$identity_file"

docker build -f infra/backup/Dockerfile infra -t ledger-backup:local
docker run --rm --user "$(id -u):$(id -g)" \
  --network ledger_default \
  --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD \
  --env RESTORE_ADMIN_DATABASE --env RESTORE_TARGET_DATABASE --env RESTORE_TARGET_OWNER \
  --env RESTORE_CONFIRM_DATABASE --env RESTORE_CONFIRM_HOST --env RESTORE_CONFIRM_PORT \
  --env RESTORE_CONFIRM_SYSTEM_IDENTIFIER --env RESTORE_CONFIRM_FINGERPRINT \
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

The script takes no-follow descriptor copies into a private staging directory,
verifies checksum and Ed25519 signature, resolves/pins the endpoint, then
creates the target. One pinned `psql --single-transaction` session checks the
target database name, system identifier, and template0-derived empty state
before streaming:

```text
age --decrypt → pg_restore --file=- → psql --single-transaction
```

No plaintext dump or `--clean` is used. Any signature/checksum, endpoint,
cluster, permission, or late SQL failure rolls back and drops only the database
OID created by that invocation, never a same-name replacement.

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
