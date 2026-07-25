#!/usr/bin/env bash
# Preserve Docker's status even though its operator-visible output is sent to
# journald. Called by cron with CRON_TZ=UTC from the repository directory.
set -euo pipefail

: "${BACKUP_SIGNING_KEY_FILE:?BACKUP_SIGNING_KEY_FILE is required}"
: "${BACKUP_OUTPUT_DIR:?BACKUP_OUTPUT_DIR is required}"
[[ -f "$BACKUP_SIGNING_KEY_FILE" && ! -L "$BACKUP_SIGNING_KEY_FILE" && -r "$BACKUP_SIGNING_KEY_FILE" ]] \
  || { printf '%s\n' 'BACKUP_SIGNING_KEY_FILE must be a readable regular non-symlink file' >&2; exit 1; }
[[ -d "$BACKUP_OUTPUT_DIR" && ! -L "$BACKUP_OUTPUT_DIR" && -w "$BACKUP_OUTPUT_DIR" ]] \
  || { printf '%s\n' 'BACKUP_OUTPUT_DIR must be a writable directory' >&2; exit 1; }

export BACKUP_UID="$(id -u)"
export BACKUP_GID="$(id -g)"
[[ "$(stat -c '%u:%g' "$BACKUP_OUTPUT_DIR")" == "$BACKUP_UID:$BACKUP_GID" ]] \
  || { printf '%s\n' 'BACKUP_OUTPUT_DIR must be owned by the invoking Linux UID:GID' >&2; exit 1; }

docker compose -f infra/docker-compose.yml -f infra/docker-compose.backup.yml --profile backup run --rm backup 2>&1 | logger -t ledger-backup
