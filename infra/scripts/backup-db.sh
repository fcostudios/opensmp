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
if command -v flock >/dev/null 2>&1; then
  exec 9>"$lock_file"
  flock -n 9 || fail 'another backup is already running'
else
  # Development-host fallback only; the pinned production image has flock.
  lock_dir="$BACKUP_DIR/.backup.lock.d"
  mkdir "$lock_dir" 2>/dev/null || fail 'another backup is already running'
fi

encrypted_partial=''
checksum_partial=''
manifest_partial=''
signature_partial=''
published_checksum=''
published_manifest=''
published_signature=''
published=0
cleanup() {
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

encrypted_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.age.partial")"
checksum_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.sha256.partial")"
manifest_partial="$(mktemp "$BACKUP_DIR/.ledger-${backup_timestamp}.XXXXXX.manifest.partial")"
signature_partial="${manifest_partial}.minisig"

pg_dump --format=custom --no-owner --no-acl "${DATABASE_CLIENT_ARGS[@]}" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" > "$encrypted_partial"
fsync_path "$encrypted_partial"

checksum="$(sha256_file "$encrypted_partial")"
source_system_identifier="$(database_system_identifier)"
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
