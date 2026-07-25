#!/usr/bin/env bash
# Creates an encrypted PostgreSQL custom-format backup. The pipe is intentional:
# a plaintext dump is never written to disk.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

prepare_database_connection
validate_age_recipient
require_environment BACKUP_DIR

backup_timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%d%H%M%S)}"
[[ "$backup_timestamp" =~ ^[0-9]{14}$ ]] || fail 'BACKUP_TIMESTAMP must be UTC YYYYMMDDHHMMSS'

mkdir -p -- "$BACKUP_DIR"
[[ -d "$BACKUP_DIR" ]] || fail 'BACKUP_DIR is not a directory'

readonly encrypted_file="$BACKUP_DIR/ledger-${backup_timestamp}.dump.age"
readonly checksum_file="$encrypted_file.sha256"
readonly lock_dir="$BACKUP_DIR/.backup.lock"
[[ ! -e "$encrypted_file" && ! -e "$checksum_file" ]] || fail "backup already exists for $backup_timestamp"
mkdir "$lock_dir" 2>/dev/null || fail 'another backup is already running'

encrypted_partial=''
checksum_partial=''
published_checksum=''
cleanup() {
  [[ -z "$encrypted_partial" || ! -e "$encrypted_partial" ]] || rm -f -- "$encrypted_partial"
  [[ -z "$checksum_partial" || ! -e "$checksum_partial" ]] || rm -f -- "$checksum_partial"
  [[ -z "$published_checksum" || ! -e "$published_checksum" ]] || rm -f -- "$published_checksum"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

encrypted_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.age.partial")"
checksum_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.sha256.partial")"

pg_dump --format=custom --no-owner --no-acl "${DATABASE_CLIENT_ARGS[@]}" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" > "$encrypted_partial"

checksum="$(sha256_file "$encrypted_partial")"
printf '%s  %s\n' "$checksum" "$(basename "$encrypted_file")" > "$checksum_partial"
mv -- "$checksum_partial" "$checksum_file"
checksum_partial=''
published_checksum="$checksum_file"
mv -- "$encrypted_partial" "$encrypted_file"
encrypted_partial=''
published_checksum=''
