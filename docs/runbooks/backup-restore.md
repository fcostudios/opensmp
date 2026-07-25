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
connection URI. Its dump and provenance queries pin those source settings once,
while its shared maintenance lock uses the stable `postgres` administrative
database (`BACKUP_MAINTENANCE_DATABASE=postgres`) so it coordinates with the
restore's exclusive lock even when the application database name differs. With
the Compose PostgreSQL service already running, apply the role updates to an
already-initialized PostgreSQL volume before relying on `ledger_backup` or
`ledger_restore_admin`:

```bash
./infra/postgres/apply-roles.sh
```

Existing-volume convergence uses one `postgres` coordinator session. Its
session-level maintenance lock remains held across role convergence, all three
password rotations, the committed `NOLOGIN`/password-null/membership revoke,
repeated session termination, and final zero-authority postconditions. It
therefore cannot change restore authority in the middle of a guarded restore.

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

This procedure is for an **isolated replacement target only**. Stop the target
application and worker first, or use a cluster that has never served them. Do
not restore into an active application cluster or use this as a way to alter an
existing database. The final database name must be new and absent.

`ledger_restore_admin` is deliberately disabled by default: it is `NOLOGIN`,
`NOINHERIT`, `CREATEDB`, `NOSUPERUSER`, `NOCREATEROLE`, has no password hash,
and has no membership in `ledger_owner`. Re-running
`./infra/postgres/apply-roles.sh` on an existing volume converges back to that
disabled state. It never provisions a restore password or authority.

Only the temporary restore-window scripts may enable the role. They must run
from a protected operator shell using a target-cluster super-admin connection;
the restore role itself cannot read the target system identifier or open its
own window. Every prepare/finalize operation acquires the same PostgreSQL
maintenance lock `(741263, 2)`, verifies the independently confirmed target
system identifier while holding it, and writes an audit event without secrets.

1. Obtain all four backup artifacts and the matching public verification key
   from the operator vault.
2. Pin one target endpoint: use a numeric address (or a Unix socket directory),
   never a mutable DNS name. Confirm it is the isolated, stopped target.
3. Obtain the target `system_identifier` through the protected super-admin
   connection. The backup manifest's source identifier is authenticated source
   provenance; it does not replace the separate target confirmation. A logical
   restore normally uses a different target identifier.
4. Set the variables below in a protected shell with tracing disabled. Secrets
   are environment values or private files; never place them in a URI, argv,
   shell history, audit log, or application configuration.

```bash
unset DATABASE_URL
set +x
export RESTORE_WINDOW_PGHOST='203.0.113.10' # one explicit address
export RESTORE_WINDOW_PGPORT='5432'
export RESTORE_WINDOW_SUPERADMIN_USER='postgres'
export RESTORE_WINDOW_SUPERADMIN_PASSWORD='REDACTED_FROM_VAULT'
export RESTORE_WINDOW_ADMIN_DATABASE='postgres'
export RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION='I_CONFIRM_TARGET_IS_ISOLATED_AND_APPLICATION_STOPPED'
export RESTORE_WINDOW_AUDIT_LOG='/srv/ledger/restore-audit/restore-window.jsonl'
export RESTORE_WINDOW_TTL_SECONDS='300' # 1–900 seconds; keep the window short

# This is a protected super-admin query; the secret is not part of argv.
target_system_identifier="$(PGPASSWORD="$RESTORE_WINDOW_SUPERADMIN_PASSWORD" psql \
  --no-psqlrc --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 \
  --host="$RESTORE_WINDOW_PGHOST" --port="$RESTORE_WINDOW_PGPORT" \
  --username="$RESTORE_WINDOW_SUPERADMIN_USER" --dbname="$RESTORE_WINDOW_ADMIN_DATABASE" \
  --command 'SELECT (pg_control_system()).system_identifier')"
export RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER="$target_system_identifier"
export RESTORE_WINDOW_CONFIRM_FINGERPRINT="${RESTORE_WINDOW_PGHOST}:${RESTORE_WINDOW_PGPORT}#${target_system_identifier}"

# Required by restore-db.sh after the guarded wrapper opens the role.
export PGHOST="$RESTORE_WINDOW_PGHOST"
export PGPORT="$RESTORE_WINDOW_PGPORT"
export RESTORE_ADMIN_DATABASE='postgres'
export RESTORE_TARGET_DATABASE='ledger_restore_20260725'
export RESTORE_TARGET_OWNER='ledger_owner'
backup_file="$PWD/ledger-YYYYMMDDHHMMSS.dump.age"
backup_name="$(basename "$backup_file")"
checksum_file="$backup_file.sha256"
manifest_file="$backup_file.manifest"
signature_file="$manifest_file.minisig"
identity_file="$PWD/age-restore-identity.txt"
verify_key_file="$PWD/ledger-backup-verify.pub"
# This host directory is an explicit mounted scratch filesystem for encrypted
# and public artifacts only. It must be private, owned by the invoking UID,
# non-symlinked, and have at least 2x artifact bytes plus 64 MiB available.
restore_staging_root="$PWD/.restore-staging"
[[ ! -L "$restore_staging_root" ]] || { echo 'restore staging root must not be a symlink' >&2; exit 1; }
mkdir -p "$restore_staging_root"
chmod 700 "$restore_staging_root"

# Verify the signed manifest before using its authenticated source provenance.
minisign -Vm "$manifest_file" -p "$verify_key_file" -x "$signature_file"
source_system_identifier="$(awk -F= '$1 == "source_system_identifier" { print $2 }' "$manifest_file")"
export RESTORE_CONFIRM_DATABASE="$RESTORE_TARGET_DATABASE"
export RESTORE_CONFIRM_HOST="$RESTORE_WINDOW_PGHOST"
export RESTORE_CONFIRM_PORT="$RESTORE_WINDOW_PGPORT"
export RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$source_system_identifier"
export RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$target_system_identifier"
export RESTORE_CONFIRM_FINGERPRINT="${RESTORE_TARGET_DATABASE}@${RESTORE_WINDOW_PGHOST}:${RESTORE_WINDOW_PGPORT}#${target_system_identifier}"
chmod 600 "$identity_file"

# Build only the pinned restore-tool image. Its guarded entrypoint generates a
# 0600 credential inside the container; the credential never appears in argv,
# a host file, or the audit log. The bound audit file must already be owned by
# the operator UID passed to the container and have mode 0600.
[[ ! -L "$RESTORE_WINDOW_AUDIT_LOG" ]] || { echo 'audit log must not be a symlink' >&2; exit 1; }
[[ -e "$RESTORE_WINDOW_AUDIT_LOG" ]] || install -m 600 /dev/null "$RESTORE_WINDOW_AUDIT_LOG"
chmod 600 "$RESTORE_WINDOW_AUDIT_LOG"
docker build -f infra/backup/Dockerfile infra -t ledger-backup:local
docker run --rm --user "$(id -u):$(id -g)" \
  --network ledger_default \
  --env RESTORE_WINDOW_PGHOST --env RESTORE_WINDOW_PGPORT \
  --env RESTORE_WINDOW_SUPERADMIN_USER --env RESTORE_WINDOW_SUPERADMIN_PASSWORD \
  --env RESTORE_WINDOW_ADMIN_DATABASE --env RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER \
  --env RESTORE_WINDOW_CONFIRM_FINGERPRINT --env RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION \
  --env RESTORE_WINDOW_TTL_SECONDS \
  --env PGHOST --env PGPORT \
  --env RESTORE_ADMIN_DATABASE --env RESTORE_TARGET_DATABASE --env RESTORE_TARGET_OWNER \
  --env RESTORE_CONFIRM_DATABASE --env RESTORE_CONFIRM_HOST --env RESTORE_CONFIRM_PORT \
  --env RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER --env RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER \
  --env RESTORE_CONFIRM_FINGERPRINT \
  --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
  --env BACKUP_VERIFY_KEY_FILE=/run/restore/verify.pub \
  --env RESTORE_STAGING_ROOT=/run/restore/staging \
  --mount type=bind,src="$backup_file",dst="/restore/$backup_name",readonly \
  --mount type=bind,src="$checksum_file",dst="/restore/$backup_name.sha256",readonly \
  --mount type=bind,src="$manifest_file",dst="/restore/$backup_name.manifest",readonly \
  --mount type=bind,src="$signature_file",dst="/restore/$backup_name.manifest.minisig",readonly \
  --mount type=bind,src="$identity_file",dst=/run/restore/identity.txt,readonly \
  --mount type=bind,src="$verify_key_file",dst=/run/restore/verify.pub,readonly \
  --mount type=bind,src="$restore_staging_root",dst=/run/restore/staging \
  --mount type=bind,src="$RESTORE_WINDOW_AUDIT_LOG",dst=/run/restore/window.audit.jsonl \
  --env RESTORE_WINDOW_AUDIT_LOG=/run/restore/window.audit.jsonl \
  --entrypoint /usr/local/bin/run-guarded-restore.sh \
  ledger-backup:local "/restore/$backup_name"
```

`run-guarded-restore.sh` first copies every encrypted/public artifact with
no-follow descriptors into the explicit mounted staging root. The packaged
entrypoint opens that exact mount with `O_DIRECTORY|O_NOFOLLOW`, proves its
mount ID differs from its parent, and retains the descriptor across staging,
verification, restore, and cleanup. Intermediate-parent replacement therefore
cannot redirect work; an ordinary same-filesystem directory is rejected. It
checks capacity before copying, verifies ciphertext hash and size, and verifies
the Ed25519-signed manifest while `ledger_restore_admin` remains `NOLOGIN`,
passwordless, and ungranted.

The restore invocation unconditionally repeats hash, size, and signature
authentication against the pinned private stage before it calls prepare.
Caller-supplied environment cannot claim that input is preverified. Slow or
tampered input therefore cannot consume the role TTL.

After authentication succeeds, the restore calls prepare and the wrapper has
`EXIT`, `INT`, and `TERM` traps that always call finalize. Prepare itself also
invokes finalize if an error occurs after it might have changed authority. The
wrapper creates a private 0700 credential directory and one 0600
`O_CREAT|O_EXCL|O_NOFOLLOW` credential inode, sends that credential to
PostgreSQL's `\password` prompt on standard input, and never unlinks/recreates
or logs it. An explicitly supplied credential is likewise bound to its verified
device/inode and rejected if replaced. The role is granted `ledger_owner` only
for the configured short `VALID UNTIL` interval.

The restore keeps the private age identity on its original no-follow
descriptor, confirms signed source provenance and the independently confirmed
target cluster, and resolves and pins the endpoint before mutation.

For all target prechecks, creation, restore, and promotion, one persistent
admin `psql` session holds PostgreSQL advisory lock `(741263, 2)`. The script
creates a cryptographically random `ledger_restore_stage_<128-bit-hex>`
database from `template0`, not the requested final target; it is initially
owned by `ledger_restore_admin` so that no-superuser role can perform the
guarded rename, has `PUBLIC` database privileges revoked, and grants access
only to `ledger_owner` and `ledger_restore_admin`. Before it streams the dump,
the transaction verifies the staging name/OID and target system identifier,
sets the owner role, and revokes `PUBLIC` privileges on the `public` schema.
After the guarded rename, the same admin session transfers database ownership
to `ledger_owner`:

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

### Emergency finalization

If a shell, container, or host fails after prepare, **do not retry the
restore or reuse its credential**. From a protected super-admin shell, export
the same `RESTORE_WINDOW_*` target, confirmation, and audit variables shown
above, then run:

```bash
./infra/postgres/finalize-restore-window.sh
```

Finalize is idempotent and deliberately performs this order: `NOLOGIN` and
credential removal first, revoke `ledger_owner`, then terminate every
`ledger_restore_admin` session and verify `NOLOGIN`, a null password hash, no
membership, and zero sessions. A `VALID UNTIL` expiry prevents new password
authentication but does **not** replace finalization; membership must still be
revoked and an audit event recorded. Treat a failed finalization as an
incident: keep the application stopped and target isolated until it succeeds.

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
OID, owner, and target system identifier. Before a drop, verify the recorded name, OID, owner, and target system identifier.
Do not run a drop when this query returns no row or anything unexpected:

```bash
export QUARANTINE_DATABASE='ledger_restore_stage_...'
export QUARANTINE_DATABASE_OID='12345' # exact OID printed by restore-db.sh

PGPASSWORD="$RESTORE_WINDOW_SUPERADMIN_PASSWORD" psql --no-psqlrc --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 \
  --host="$RESTORE_WINDOW_PGHOST" --port="$RESTORE_WINDOW_PGPORT" \
  --username="$RESTORE_WINDOW_SUPERADMIN_USER" --dbname="$RESTORE_WINDOW_ADMIN_DATABASE" \
  --set quarantine_database="$QUARANTINE_DATABASE" \
  --set quarantine_database_oid="$QUARANTINE_DATABASE_OID" \
  --set restore_admin_user='ledger_restore_admin' \
  --set restore_target_system_identifier="$RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER" \
  --command "SELECT d.oid::text, r.rolname, (pg_control_system()).system_identifier::text
             FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
             WHERE d.datname = :'quarantine_database'
               AND d.oid::text = :'quarantine_database_oid'
               AND r.rolname = :'restore_admin_user'
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
