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
2. Choose a **new, absent** final target. The restore admin must have
   `CREATE DATABASE` and permission to `SET ROLE ledger_owner`; the script
   creates an unpredictable staging database from `template0`, owned by
   `ledger_owner`. It must also have the narrowly granted `EXECUTE` privilege
   on `pg_catalog.pg_control_system()` (the supplied `ledger_owner` init role
   has that grant).
3. Resolve and pin one endpoint. The signed source `system_identifier` is
   authenticated backup provenance and requires an explicit operator
   confirmation. The target endpoint's `system_identifier` is a **separate**
   explicit confirmation. A logical dump may be restored to a replacement
   cluster with a different target identifier. A physical failover workflow is
   different: it must retain the source identifier.
4. Use discrete libpq variables. Never put a password in a URI or argv.

```bash
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

The script takes no-follow descriptor copies into a private staging directory,
verifies checksum and Ed25519 signature, confirms signed source provenance and
the independently confirmed target cluster, and resolves/pins the endpoint. It
creates a cryptographically random `ledger_restore_stage_<128-bit-hex>`
database, not the requested final target. One pinned `psql --single-transaction`
session checks that staging database's name and OID, target system identifier,
and template0-derived empty state before streaming:

```text
age --decrypt → pg_restore --file=- → psql --single-transaction
```

No plaintext dump or `--clean` is used. After the streaming transaction
commits, the script verifies the staging name/OID/owner again and atomically
renames it to the requested final target. The restore session has exited before
that rename; if a requested target appears in the meantime, PostgreSQL rejects
the rename without overwriting or dropping it.

The script never automatically drops a staging database. Any signature,
endpoint, cluster, permission, promotion, or late SQL failure leaves the
staging database quarantined and prints its exact name and OID. This avoids a
name-based cleanup race.

### Manual quarantine cleanup

Only an operator may remove a quarantined staging database. First reconnect to
the **same pinned target endpoint** and verify the recorded name, OID, owner,
and target system identifier. Do not run a drop when this query returns no row
or anything unexpected:

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
