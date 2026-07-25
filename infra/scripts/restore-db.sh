#!/usr/bin/env bash
# Restores a signed encrypted custom dump into a database created by this
# invocation. The decrypted dump is never materialised on disk.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

[[ "$#" -eq 1 && "$1" != -* ]] || fail 'usage: restore-db.sh /path/to/ledger-YYYYMMDDHHMMSS.dump.age'
source_backup_file="$1"
[[ "$(basename -- "$source_backup_file")" =~ ^ledger-[0-9]{14}\.dump\.age$ ]] || fail 'backup file name must be ledger-YYYYMMDDHHMMSS.dump.age'
source_checksum_file="${source_backup_file}.sha256"
source_manifest_file="${source_backup_file}.manifest"
source_signature_file="${source_manifest_file}.minisig"
require_regular_file 'backup file' "$source_backup_file"
require_regular_file 'backup checksum metadata' "$source_checksum_file"
require_regular_file 'backup manifest' "$source_manifest_file"
require_regular_file 'backup manifest signature' "$source_signature_file"
require_environment AGE_IDENTITY_FILE
require_regular_file AGE_IDENTITY_FILE "$AGE_IDENTITY_FILE"
require_environment BACKUP_VERIFY_KEY_FILE
require_regular_file BACKUP_VERIFY_KEY_FILE "$BACKUP_VERIFY_KEY_FILE"

require_environment PGHOST
require_environment PGPORT
require_environment PGUSER
require_environment PGPASSWORD
require_environment RESTORE_ADMIN_DATABASE
require_environment RESTORE_TARGET_DATABASE
require_environment RESTORE_TARGET_OWNER
require_environment RESTORE_CONFIRM_DATABASE
require_environment RESTORE_CONFIRM_HOST
require_environment RESTORE_CONFIRM_PORT
require_environment RESTORE_CONFIRM_FINGERPRINT
require_environment RESTORE_CONFIRM_SYSTEM_IDENTIFIER
[[ -z "${DATABASE_URL:-}" ]] || fail 'DATABASE_URL is not permitted for restore; use discrete libpq variables'
[[ "$RESTORE_TARGET_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'RESTORE_TARGET_DATABASE must be a PostgreSQL identifier'
[[ "$RESTORE_TARGET_OWNER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'RESTORE_TARGET_OWNER must be a PostgreSQL identifier'
[[ "$RESTORE_CONFIRM_DATABASE" == "$RESTORE_TARGET_DATABASE" ]] || fail 'RESTORE_CONFIRM_DATABASE must exactly match RESTORE_TARGET_DATABASE'
[[ "$PGPORT" =~ ^[0-9]+$ ]] || fail 'PGPORT must be numeric'

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/ledger-restore.XXXXXX")"
chmod 0700 "$stage_dir"
stage_backup="$stage_dir/$(basename -- "$source_backup_file")"
stage_checksum="$stage_dir/$(basename -- "$source_checksum_file")"
stage_manifest="$stage_dir/$(basename -- "$source_manifest_file")"
stage_signature="$stage_dir/$(basename -- "$source_signature_file")"
stage_identity="$stage_dir/identity.txt"
stage_verify_key="$stage_dir/verify.pub"
created_target=0
created_target_oid=''
pinned_admin_args=()

cleanup() {
  local cleanup_status=$?
  if [[ "$created_target" == 1 && -n "$created_target_oid" && ${#pinned_admin_args[@]} -gt 0 ]]; then
    # The oid check means we never drop a same-name database that an operator or
    # another process replaced after this invocation created its target.
    current_target_oid="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${pinned_admin_args[@]}" \
      --command "SELECT d.oid FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = '$RESTORE_TARGET_DATABASE' AND r.rolname = '$RESTORE_TARGET_OWNER'" 2>/dev/null || true)"
    if [[ "$current_target_oid" == "$created_target_oid" ]]; then
      psql --quiet --set ON_ERROR_STOP=1 "${pinned_admin_args[@]}" \
        --command "DROP DATABASE \"$RESTORE_TARGET_DATABASE\"" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf -- "$stage_dir"
  exit "$cleanup_status"
}
trap cleanup EXIT INT TERM

# Descriptor-based staging prevents a check-to-copy replacement race on a bind
# mount. All inputs used after validation are the private staged descriptors.
secure_copy_regular "$source_backup_file" "$stage_backup"
secure_copy_regular "$source_checksum_file" "$stage_checksum"
secure_copy_regular "$source_manifest_file" "$stage_manifest"
secure_copy_regular "$source_signature_file" "$stage_signature"
secure_copy_regular "$AGE_IDENTITY_FILE" "$stage_identity"
secure_copy_regular "$BACKUP_VERIFY_KEY_FILE" "$stage_verify_key"

expected_filename="$(basename "$stage_backup")"
expected_checksum="$(awk '{print $1}' "$stage_checksum")"
expected_checksum_line="$expected_checksum  $expected_filename"
[[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'backup checksum metadata is invalid'
[[ "$(wc -l < "$stage_checksum" | tr -d ' ')" == '1' && "$(< "$stage_checksum")" == "$expected_checksum_line" ]] || fail 'backup checksum metadata is invalid'
[[ "$(sha256_file "$stage_backup")" == "$expected_checksum" ]] || fail 'backup checksum verification failed'

minisign -Vm "$stage_manifest" -p "$stage_verify_key" -x "$stage_signature" -q >/dev/null
manifest_lines=()
while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
  manifest_lines+=("$manifest_line")
done < "$stage_manifest"
[[ "${#manifest_lines[@]}" == 6 ]] || fail 'backup manifest is invalid'
[[ "${manifest_lines[0]}" == 'format_version=1' ]] || fail 'backup manifest format version is unsupported'
[[ "${manifest_lines[1]}" == "basename=$expected_filename" ]] || fail 'backup manifest basename does not match ciphertext'
[[ "${manifest_lines[2]}" == "ciphertext_sha256=$expected_checksum" ]] || fail 'backup manifest checksum does not match ciphertext'
manifest_size="${manifest_lines[3]#ciphertext_size=}"
manifest_created_at="${manifest_lines[4]#created_at=}"
source_system_identifier="${manifest_lines[5]#source_system_identifier=}"
[[ "${manifest_lines[3]}" == "ciphertext_size=$manifest_size" && "$manifest_size" =~ ^[0-9]+$ ]] || fail 'backup manifest size is invalid'
[[ "$manifest_size" == "$(wc -c < "$stage_backup" | tr -d ' ')" ]] || fail 'backup manifest size does not match ciphertext'
[[ "${manifest_lines[4]}" == "created_at=$manifest_created_at" && "$manifest_created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail 'backup manifest timestamp is invalid'
[[ "${manifest_lines[5]}" == "source_system_identifier=$source_system_identifier" && "$source_system_identifier" =~ ^[0-9]+$ ]] || fail 'backup manifest source system identifier is invalid'

# Resolve once before the authenticated admin connection. The target psql
# session uses that numeric address (or a single normalized Unix socket path),
# so a subsequent DNS change cannot redirect destructive work.
requested_host="$PGHOST"
pinned_endpoint_host="$(resolve_pinned_connection_host "$requested_host")"
if [[ "$pinned_endpoint_host" == unix:* ]]; then
  pinned_host="${pinned_endpoint_host#unix:}"
else
  pinned_host="$pinned_endpoint_host"
fi
DATABASE_CLIENT_ARGS=("--host=$PGHOST" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$RESTORE_ADMIN_DATABASE")
admin_database="$(effective_database_name)"
[[ "$admin_database" == "$RESTORE_ADMIN_DATABASE" ]] || fail 'admin connection did not reach RESTORE_ADMIN_DATABASE'
admin_system_identifier="$(database_system_identifier)"
[[ "$RESTORE_CONFIRM_HOST" == "$pinned_endpoint_host" ]] || fail 'RESTORE_CONFIRM_HOST does not exactly match pinned admin host'
[[ "$RESTORE_CONFIRM_PORT" == "$PGPORT" ]] || fail 'RESTORE_CONFIRM_PORT does not exactly match pinned admin port'
[[ "$RESTORE_CONFIRM_SYSTEM_IDENTIFIER" == "$admin_system_identifier" ]] || fail 'RESTORE_CONFIRM_SYSTEM_IDENTIFIER does not exactly match resolved cluster'
expected_fingerprint="${RESTORE_TARGET_DATABASE}@${pinned_endpoint_host}:${PGPORT}#${admin_system_identifier}"
[[ "$RESTORE_CONFIRM_FINGERPRINT" == "$expected_fingerprint" ]] || fail 'RESTORE_CONFIRM_FINGERPRINT does not exactly match the pinned target'
[[ "$admin_system_identifier" == "$source_system_identifier" ]] || fail 'backup belongs to a different PostgreSQL system identifier'

pinned_admin_args=("--host=$pinned_host" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$admin_database")
target_exists="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${pinned_admin_args[@]}" --command "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$RESTORE_TARGET_DATABASE')")"
[[ "$target_exists" == f ]] || fail 'restore target database must be absent'
psql --quiet --set ON_ERROR_STOP=1 "${pinned_admin_args[@]}" \
  --command "CREATE DATABASE \"$RESTORE_TARGET_DATABASE\" WITH TEMPLATE template0 OWNER \"$RESTORE_TARGET_OWNER\""
created_target=1
created_target_oid="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${pinned_admin_args[@]}" --command "SELECT oid FROM pg_database WHERE datname = '$RESTORE_TARGET_DATABASE'")"
[[ "$created_target_oid" =~ ^[0-9]+$ ]] || fail 'could not identify database created for restore'

target_args=("--host=$pinned_host" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$RESTORE_TARGET_DATABASE")
target_empty_guard_sql() {
  cat <<'SQL'
SELECT 1 / CASE WHEN (
WITH user_schemas AS (
  SELECT oid FROM pg_namespace
  WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema', 'public')
), public_schema AS (
  SELECT oid FROM pg_namespace WHERE nspname = 'public'
), candidate_schemas AS (
  SELECT oid FROM user_schemas UNION ALL SELECT oid FROM public_schema
)
SELECT
  (SELECT count(*) FROM user_schemas)
  + (SELECT count(*) FROM pg_class WHERE relnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_proc WHERE pronamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_type WHERE typnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_operator WHERE oprnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_conversion WHERE connamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_collation WHERE collnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_ts_config WHERE cfgnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_ts_dict WHERE dictnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_ts_parser WHERE prsnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_ts_template WHERE tmplnamespace IN (SELECT oid FROM candidate_schemas))
  + (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql')
  + (SELECT count(*) FROM pg_largeobject_metadata)
  + (SELECT count(*) FROM pg_default_acl)
  + (SELECT count(*) FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))
  + (SELECT count(*) FROM pg_foreign_data_wrapper)
  + (SELECT count(*) FROM pg_foreign_server)
  + (SELECT count(*) FROM pg_publication)
  + (SELECT count(*) FROM pg_subscription)
) = 0 THEN 1 ELSE 0 END;
SQL
}

# All gates and every generated SQL statement share this one pinned psql
# connection and one transaction. A late SQL error makes psql stop; connection
# teardown rolls the transaction back and EXIT cleanup drops only this target.
{
  printf '%s\n' "SELECT 1 / CASE WHEN current_database() = :'restore_target_database' THEN 1 ELSE 0 END;"
  printf '%s\n' "SELECT 1 / CASE WHEN (pg_control_system()).system_identifier::text = :'restore_source_system_identifier' THEN 1 ELSE 0 END;"
  target_empty_guard_sql
  printf '%s\n' 'SET ROLE :"restore_target_owner";'
  age --decrypt --identity "$stage_identity" < "$stage_backup" | pg_restore --no-owner --exit-on-error --file=-
} | psql --quiet --single-transaction --set ON_ERROR_STOP=1 \
  --set restore_target_database="$RESTORE_TARGET_DATABASE" \
  --set restore_target_owner="$RESTORE_TARGET_OWNER" \
  --set restore_source_system_identifier="$source_system_identifier" \
  "${target_args[@]}"

created_target=0
