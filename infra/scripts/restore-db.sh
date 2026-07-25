#!/usr/bin/env bash
# Restores an encrypted custom-format dump only after an exact target-name
# confirmation. Decryption streams straight into pg_restore; no plaintext file.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

[[ "$#" -eq 1 && "$1" != -* ]] || fail 'usage: restore-db.sh /path/to/ledger-YYYYMMDDHHMMSS.dump.age'
readonly backup_file="$1"
[[ -f "$backup_file" ]] || fail 'backup file does not exist'
readonly checksum_file="${backup_file}.sha256"
[[ -f "$checksum_file" ]] || fail 'backup checksum metadata does not exist'

prepare_database_connection
require_environment RESTORE_CONFIRM_DATABASE
effective_database="$(effective_database_name)"
[[ "$RESTORE_CONFIRM_DATABASE" == "$effective_database" ]] || fail "RESTORE_CONFIRM_DATABASE does not exactly match target database $effective_database"
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
  | pg_restore --clean --if-exists --no-owner --exit-on-error "${DATABASE_CLIENT_ARGS[@]}"
