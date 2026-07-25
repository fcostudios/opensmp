# Encrypted database backup and restore

This runbook implements the encrypted-backup portion of US-002. It is an
operational safeguard, not an approval to restore production data casually.

## Key custody and backup schedule

- Generate and escrow an `age` key pair outside the repository and VPS image.
  Put the public `age1...` recipient in `BACKUP_AGE_RECIPIENT` in the VPS
  `.env`. It is configuration, not a secret.
- Keep the corresponding private identity exclusively with authorised restore
  operators in the documented escrow location. Do not add it to `.env`, the
  backup image, a Compose volume, or the cron environment.
- The backup profile has only `ledger_backup`, which has `CONNECT` and
  `pg_read_all_data`; it is not the application or migration owner.
- Install [`infra/backup/crontab`](../../infra/backup/crontab) on the VPS. Its
  `0 7 * * *` `CRON_TZ=UTC` job is 02:00 America/Guayaquil every day.

The profile is intentionally not part of a normal `docker compose up`:

```bash
docker build -f infra/backup/Dockerfile infra -t ledger-backup:local
docker compose -f infra/docker-compose.yml --profile backup run --rm backup
```

The job uses libpq `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`
environment variables; it does not interpolate a password into a URI. It writes
an encrypted custom dump and adjacent SHA-256 metadata to the persistent
`backup_data` volume. It streams `pg_dump` directly into `age`, writes only
encrypted partial output, publishes the checksum first, then publishes the
ciphertext as the commit marker. If that final publication fails, cleanup removes
the already-published checksum. A per-directory lock prevents simultaneous jobs.

## Restore procedure

1. Obtain the chosen `ledger-YYYYMMDDHHMMSS.dump.age` and its `.sha256` file.
   Verify their provenance separately before entering production credentials.
2. Create a fresh, empty target database. Do not use the live production
   database for a drill.
3. Make the identity readable only by the restore operator (`chmod 600`) and
   mount it only into the one-shot restore container.
4. Set the target libpq variables and type the database name returned by
   `SELECT current_database()` exactly as the confirmation. A `DATABASE_URL` is
   also supported for operators that need an IPv6, Unix-socket, or percent-
   encoded URI, but its `options` parameter is rejected before decryption.

```bash
export PGHOST='db.example'
export PGPORT='5432'
export PGDATABASE='ledger_restore'
export PGUSER='ledger_owner'
export PGPASSWORD='REDACTED'
export RESTORE_CONFIRM_DATABASE='ledger_restore'
backup_file="$PWD/ledger-YYYYMMDDHHMMSS.dump.age"
checksum_file="$backup_file.sha256"
identity_file="$PWD/age-restore-identity.txt"

docker build -f infra/backup/Dockerfile infra -t ledger-backup:local
docker run --rm \
  --network ledger_default \
  --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD \
  --env RESTORE_CONFIRM_DATABASE \
  --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
  --mount type=bind,src="$backup_file",dst=/restore/backup.dump.age,readonly \
  --mount type=bind,src="$checksum_file",dst=/restore/backup.dump.age.sha256,readonly \
  --mount type=bind,src="$identity_file",dst=/run/restore/identity.txt,readonly \
  --entrypoint /usr/local/bin/restore-db.sh \
  ledger-backup:local /restore/backup.dump.age
```

`restore-db.sh` validates the ciphertext against its SHA-256 metadata before it
starts, then streams `age --decrypt` directly into
`pg_restore --clean --if-exists --no-owner --exit-on-error`. It never creates a
plaintext dump. A checksum failure, tampered ciphertext, missing metadata, or
confirmation mismatch must stop the operation; investigate rather than using a
workaround.

## Restore drill

Run the real PostgreSQL 16 drill before a release and after changing these
scripts. It starts a disposable cached `postgres:16-alpine` fixture, backs up
two known tables through real `age`, restores into a second database, and
asserts the exact public-table count plus the ledger migration checksum rows.

```bash
tool_dir="$(infra/tests/bootstrap-backup-tools.sh)"
BACKUP_TEST_TOOLS_DIR="$tool_dir" "$tool_dir/bats" infra/tests/backup-restore.bats
```

The bootstrap downloads pinned, SHA-256-verified `age` and `bats-core` binaries
only into the gitignored `.tmp/backup-restore-tools` directory. It never fakes
encryption or installs system packages. If Docker cannot start the cached
PostgreSQL image, record the drill as externally blocked; do not mark US-002
done based on static checks.
