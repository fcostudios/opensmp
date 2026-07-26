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
[[ -z "${DATABASE_URL:-}" ]] || fail 'DATABASE_URL is not permitted for backup; use discrete libpq variables'
require_environment PGHOST
require_environment PGPORT
require_environment PGDATABASE
require_environment PGUSER
[[ "$PGPORT" =~ ^[0-9]+$ ]] || fail 'PGPORT must be numeric'

# Resolve the configured host once, then make every dump and provenance query
# use the resulting address/socket rather than re-resolving a mutable DNS name.
requested_host="$PGHOST"
pinned_endpoint_host="$(resolve_pinned_connection_host "$requested_host")"
if [[ "$pinned_endpoint_host" == unix:* ]]; then
  pinned_host="${pinned_endpoint_host#unix:}"
else
  pinned_host="$pinned_endpoint_host"
fi
DATABASE_CLIENT_ARGS=("--host=$pinned_host" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$PGDATABASE")
effective_backup_database="$(effective_database_name)"
[[ "$effective_backup_database" == "$PGDATABASE" ]] || fail 'backup connection did not reach PGDATABASE'
BACKUP_MAINTENANCE_DATABASE="${BACKUP_MAINTENANCE_DATABASE:-postgres}"
[[ "$BACKUP_MAINTENANCE_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'BACKUP_MAINTENANCE_DATABASE must be a PostgreSQL identifier'
maintenance_client_args=("--host=$pinned_host" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$BACKUP_MAINTENANCE_DATABASE")
require_environment BACKUP_DIR
require_environment BACKUP_SIGNING_KEY_FILE
require_regular_file BACKUP_SIGNING_KEY_FILE "$BACKUP_SIGNING_KEY_FILE"

backup_timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%d%H%M%S)}"
[[ "$backup_timestamp" =~ ^[0-9]{14}$ ]] || fail 'BACKUP_TIMESTAMP must be UTC YYYYMMDDHHMMSS'

mkdir -p -- "$BACKUP_DIR"
[[ -d "$BACKUP_DIR" ]] || fail 'BACKUP_DIR is not a directory'

readonly encrypted_file="$BACKUP_DIR/ledger-${backup_timestamp}.dump.age"
readonly checksum_file="$encrypted_file.sha256"
readonly manifest_file="$encrypted_file.manifest"
readonly signature_file="$manifest_file.minisig"
[[ ! -e "$encrypted_file" && ! -e "$checksum_file" && ! -e "$manifest_file" && ! -e "$signature_file" ]] || fail "backup already exists for $backup_timestamp"
readonly lock_file="$BACKUP_DIR/.backup.lock"
lock_dir=''
maintenance_dir=''
maintenance_input=''
maintenance_output=''
maintenance_pid=''
maintenance_locked=0
if command -v flock >/dev/null 2>&1; then
  exec 9>"$lock_file"
  flock -n 9 || fail 'another backup is already running'
else
  # Development-host fallback only; the pinned production image has flock.
  lock_dir="$BACKUP_DIR/.backup.lock.d"
  mkdir "$lock_dir" 2>/dev/null || fail 'another backup is already running'
fi

start_backup_maintenance_session() {
  # Keep one PostgreSQL session alive for the entire dump. The shared side of
  # the same advisory lock used by restore blocks a cooperating exclusive
  # restore without turning a cross-session pg_advisory_lock call into a race.
  maintenance_dir="$(mktemp -d "$BACKUP_DIR/.ledger-maintenance.XXXXXX")"
  chmod 0700 "$maintenance_dir"
  maintenance_input="$maintenance_dir/in"
  maintenance_output="$maintenance_dir/out"
  mkfifo -m 0600 "$maintenance_input" "$maintenance_output"
  psql --no-psqlrc --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${maintenance_client_args[@]}" <"$maintenance_input" >"$maintenance_output" &
  maintenance_pid="$!"
  exec 7>"$maintenance_input"
  exec 6<"$maintenance_output"
  printf '%s\n' 'SELECT pg_advisory_lock_shared(741263, 2);' >&7
  printf '%s\n' '\echo __LEDGER_BACKUP_LOCKED__' >&7
  local line
  while IFS= read -r line <&6; do
    [[ "$line" == '__LEDGER_BACKUP_LOCKED__' ]] && break
  done
  [[ "${line:-}" == '__LEDGER_BACKUP_LOCKED__' ]] || fail 'backup maintenance coordinator ended before acquiring its advisory lock'
  maintenance_locked=1
}

stop_backup_maintenance_session() {
  if [[ -n "$maintenance_input" ]]; then
    if [[ "$maintenance_locked" == 1 ]]; then
      printf '%s\n' 'SELECT pg_advisory_unlock_shared(741263, 2);' >&7 2>/dev/null || true
    fi
    printf '%s\n' '\q' >&7 2>/dev/null || true
    exec 7>&- 2>/dev/null || true
    exec 6<&- 2>/dev/null || true
  fi
  [[ -z "$maintenance_pid" ]] || wait "$maintenance_pid" 2>/dev/null || true
  [[ -z "$maintenance_dir" ]] || rm -rf -- "$maintenance_dir"
  maintenance_dir=''
  maintenance_input=''
  maintenance_output=''
  maintenance_pid=''
  maintenance_locked=0
}

encrypted_partial=''
checksum_partial=''
manifest_partial=''
signature_partial=''
published_checksum=''
published_manifest=''
published_signature=''
published=0
cleanup() {
  stop_backup_maintenance_session
  [[ -z "$encrypted_partial" || ! -e "$encrypted_partial" ]] || rm -f -- "$encrypted_partial"
  [[ -z "$checksum_partial" || ! -e "$checksum_partial" ]] || rm -f -- "$checksum_partial"
  [[ -z "$manifest_partial" || ! -e "$manifest_partial" ]] || rm -f -- "$manifest_partial"
  [[ -z "$signature_partial" || ! -e "$signature_partial" ]] || rm -f -- "$signature_partial"
  [[ -z "$published_checksum" || ! -e "$published_checksum" ]] || rm -f -- "$published_checksum"
  [[ -z "$published_manifest" || ! -e "$published_manifest" ]] || rm -f -- "$published_manifest"
  [[ -z "$published_signature" || ! -e "$published_signature" ]] || rm -f -- "$published_signature"
  if [[ "$published" == 0 && ( -n "$published_checksum" || -n "$published_manifest" || -n "$published_signature" || -e "$encrypted_file" || -e "$checksum_file" || -e "$manifest_file" || -e "$signature_file" ) ]]; then
    rm -f -- "$encrypted_file" "$checksum_file" "$manifest_file" "$signature_file"
    fsync_directory "$BACKUP_DIR" || true
  fi
  [[ -z "$lock_dir" ]] || rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# A shared advisory lock is held from the first provenance observation through
# the post-dump check and atomic publication. Restore takes the exclusive side.
start_backup_maintenance_session
# Capture the physical-cluster identity before the dump. A second query after
# streaming must agree before any manifest can be published.
source_system_identifier_before="$(database_system_identifier)"

encrypted_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.age.partial")"
checksum_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.sha256.partial")"
manifest_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.manifest.partial")"
signature_partial="${manifest_partial}.minisig"

pg_dump --format=custom --no-owner --no-acl "${DATABASE_CLIENT_ARGS[@]}" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" > "$encrypted_partial"
fsync_path "$encrypted_partial"

checksum="$(sha256_file "$encrypted_partial")"
source_system_identifier_after="$(database_system_identifier)"
[[ "$source_system_identifier_before" == "$source_system_identifier_after" ]] || fail 'PostgreSQL system identifier changed during backup; refusing to publish'
source_system_identifier="$source_system_identifier_before"
created_at="${backup_timestamp:0:4}-${backup_timestamp:4:2}-${backup_timestamp:6:2}T${backup_timestamp:8:2}:${backup_timestamp:10:2}:${backup_timestamp:12:2}Z"
encrypted_size="$(wc -c < "$encrypted_partial" | tr -d ' ')"
printf '%s  %s\n' "$checksum" "$(basename "$encrypted_file")" > "$checksum_partial"
fsync_path "$checksum_partial"
# The manifest has an intentionally fixed, line-oriented format so an operator
# can inspect it without a JSON parser and the verifier can reject ambiguity.
printf '%s\n' \
  'format_version=1' \
  "basename=$(basename "$encrypted_file")" \
  "ciphertext_sha256=$checksum" \
  "ciphertext_size=$encrypted_size" \
  "created_at=$created_at" \
  "source_system_identifier=$source_system_identifier" > "$manifest_partial"
fsync_path "$manifest_partial"
minisign -S -s "$BACKUP_SIGNING_KEY_FILE" -m "$manifest_partial" -x "$signature_partial" -q
fsync_path "$signature_partial"
mv -- "$checksum_partial" "$checksum_file"
checksum_partial=''
published_checksum="$checksum_file"
fsync_directory "$BACKUP_DIR"
mv -- "$manifest_partial" "$manifest_file"
manifest_partial=''
published_manifest="$manifest_file"
fsync_directory "$BACKUP_DIR"
mv -- "$signature_partial" "$signature_file"
signature_partial=''
published_signature="$signature_file"
fsync_directory "$BACKUP_DIR"
mv -- "$encrypted_partial" "$encrypted_file"
encrypted_partial=''
published_checksum=''
published_manifest=''
published_signature=''
fsync_directory "$BACKUP_DIR"
published=1
