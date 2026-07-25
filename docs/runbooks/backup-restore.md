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
docker compose -f infra/docker-compose.yml --profile backup run --rm backup
```

The job writes an encrypted custom dump and an adjacent SHA-256 metadata file
to the persistent `backup_data` volume. It streams `pg_dump` directly into
`age`, writes only encrypted partial output, then atomically publishes the dump
and checksum. A per-directory lock prevents simultaneous jobs.

## Restore procedure

1. Obtain the chosen `ledger-YYYYMMDDHHMMSS.dump.age` and its `.sha256` file.
   Verify their provenance separately before entering production credentials.
2. Create a fresh, empty target database. Do not use the live production
   database for a drill.
3. Make the identity readable only by the restore operator (`chmod 600`) and
   mount it only into the one-shot restore container.
4. Set the target URI and type its parsed database name exactly as the
   confirmation. URI query options, unsafe host/port syntax, and mismatches are
   rejected before decryption.

```bash
export DATABASE_URL='postgresql://ledger_owner:REDACTED@db.example:5432/ledger_restore'
export RESTORE_CONFIRM_DATABASE='ledger_restore'
export AGE_IDENTITY_FILE="$PWD/age-restore-identity.txt"

docker run --rm \
  --network ledger_default \
  --mount type=bind,src="$PWD",dst=/restore,readonly \
  --entrypoint /usr/local/bin/restore-db.sh \
  ledger-backup:local /restore/ledger-YYYYMMDDHHMMSS.dump.age
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
