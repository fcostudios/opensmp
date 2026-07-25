#!/usr/bin/env bash
# Restores an encrypted custom-format dump only after an exact target-name
# confirmation. Decryption streams straight into pg_restore; no plaintext file.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

[[ "$#" -eq 1 && "$1" != -* ]] || fail 'usage: restore-db.sh /path/to/ledger-YYYYMMDDHHMMSS.dump.age'
backup_file="$1"
[[ ! -L "$backup_file" && -f "$backup_file" ]] || fail 'backup file must be a regular non-symlink file'
[[ "$(basename -- "$backup_file")" =~ ^ledger-[0-9]{14}\.dump\.age$ ]] || fail 'backup file name must be ledger-YYYYMMDDHHMMSS.dump.age'
checksum_file="${backup_file}.sha256"
[[ ! -L "$checksum_file" && -f "$checksum_file" ]] || fail 'backup checksum metadata must be a regular non-symlink file'
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/ledger-restore.XXXXXX")"
cleanup_stage() { rm -rf -- "$stage_dir"; }
trap cleanup_stage EXIT INT TERM
chmod 0700 "$stage_dir"
stage_backup="$stage_dir/$(basename -- "$backup_file")"
stage_checksum="$stage_dir/$(basename -- "$checksum_file")"
cp -- "$backup_file" "$stage_backup"
cp -- "$checksum_file" "$stage_checksum"
chmod 0600 "$stage_backup" "$stage_checksum"
backup_file="$stage_backup"
checksum_file="$stage_checksum"

prepare_database_connection
require_environment RESTORE_CONFIRM_DATABASE
require_environment RESTORE_CONFIRM_HOST
require_environment RESTORE_CONFIRM_PORT
require_environment RESTORE_CONFIRM_FINGERPRINT
IFS=$'\t' read -r effective_database effective_host effective_port < <(effective_target_identity)
[[ "$RESTORE_CONFIRM_DATABASE" == "$effective_database" ]] || fail "RESTORE_CONFIRM_DATABASE does not exactly match target database $effective_database"
[[ "$RESTORE_CONFIRM_HOST" == "$effective_host" ]] || fail "RESTORE_CONFIRM_HOST does not exactly match target host $effective_host"
[[ "$RESTORE_CONFIRM_PORT" == "$effective_port" ]] || fail "RESTORE_CONFIRM_PORT does not exactly match target port $effective_port"
effective_fingerprint="${effective_database}@${effective_host}:${effective_port}"
[[ "$RESTORE_CONFIRM_FINGERPRINT" == "$effective_fingerprint" ]] || fail 'RESTORE_CONFIRM_FINGERPRINT does not exactly match target fingerprint'
user_object_count="$(target_user_object_count)"
[[ "$user_object_count" == '0' ]] || fail 'target database is not empty'
require_environment AGE_IDENTITY_FILE
[[ -f "$AGE_IDENTITY_FILE" && -r "$AGE_IDENTITY_FILE" ]] || fail 'AGE_IDENTITY_FILE must be a readable file'

expected_filename="$(basename "$backup_file")"
expected_checksum="$(awk '{print $1}' "$checksum_file")"
expected_line="$expected_checksum  $expected_filename"
metadata_size="$(wc -c < "$checksum_file" | tr -d ' ')"
[[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'backup checksum metadata is invalid'
[[ "$(wc -l < "$checksum_file" | tr -d ' ')" == '1' ]] || fail 'backup checksum metadata is invalid'
[[ "$metadata_size" == "$(( ${#expected_line} + 1 ))" ]] || fail 'backup checksum metadata is invalid'
[[ "$(< "$checksum_file")" == "$expected_line" ]] || fail 'backup checksum metadata is invalid'
actual_checksum="$(sha256_file "$backup_file")"
[[ "$actual_checksum" == "$expected_checksum" ]] || fail 'backup checksum verification failed'

age --decrypt --identity "$AGE_IDENTITY_FILE" < "$backup_file" \
  | pg_restore --single-transaction --no-owner --exit-on-error "${DATABASE_CLIENT_ARGS[@]}"
