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
require_environment RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER
require_environment RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER
[[ -z "${DATABASE_URL:-}" ]] || fail 'DATABASE_URL is not permitted for restore; use discrete libpq variables'
[[ "$RESTORE_TARGET_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'RESTORE_TARGET_DATABASE must be a PostgreSQL identifier'
[[ "$RESTORE_TARGET_OWNER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'RESTORE_TARGET_OWNER must be a PostgreSQL identifier'
[[ "$PGUSER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || fail 'PGUSER must be a PostgreSQL identifier'
[[ "$RESTORE_CONFIRM_DATABASE" == "$RESTORE_TARGET_DATABASE" ]] || fail 'RESTORE_CONFIRM_DATABASE must exactly match RESTORE_TARGET_DATABASE'
[[ "$PGPORT" =~ ^[0-9]+$ ]] || fail 'PGPORT must be numeric'

preverified_inputs="${RESTORE_INPUTS_PREVERIFIED:-0}"
owns_stage_dir=0
runtime_dir=''
if [[ "$preverified_inputs" == 1 ]]; then
  require_environment RESTORE_VERIFIED_STAGE_DIR
  require_environment RESTORE_STAGING_ROOT
  [[ "$RESTORE_VERIFIED_STAGE_DIR" == "$RESTORE_STAGING_ROOT"/ledger-restore-inputs.* ]] \
    || fail 'preverified restore stage is outside RESTORE_STAGING_ROOT'
  [[ "$(dirname -- "$source_backup_file")" == "$RESTORE_VERIFIED_STAGE_DIR" ]] \
    || fail 'preverified backup is outside RESTORE_VERIFIED_STAGE_DIR'
  perl -MFcntl=':DEFAULT,O_NOFOLLOW' -e '
    my ($root, $dir, @paths) = @ARGV;
    my @root_st = lstat($root);
    die "RESTORE_STAGING_ROOT is no longer a private non-symlink directory\n"
      unless @root_st && -d _ && !-l _ && $root_st[4] == $> && ($root_st[2] & 0777) == 0700;
    my @dir_st = lstat($dir);
    die "preverified restore stage metadata changed\n"
      unless @dir_st && -d _ && !-l _ && $dir_st[4] == $> && ($dir_st[2] & 0777) == 0500;
    for my $path (@paths) {
      sysopen(my $in, $path, O_RDONLY | O_NOFOLLOW)
        or die "open preverified artifact: $!\n";
      my @fd_st = stat($in);
      my @path_st = lstat($path);
      die "preverified artifact metadata changed\n"
        unless @fd_st && @path_st && -f _ && !-l _
          && $fd_st[0] == $path_st[0] && $fd_st[1] == $path_st[1]
          && $fd_st[4] == $> && ($fd_st[2] & 0777) == 0400
          && $fd_st[3] == 1;
    }
  ' "$RESTORE_STAGING_ROOT" "$RESTORE_VERIFIED_STAGE_DIR" \
    "$source_backup_file" "$source_checksum_file" "$source_manifest_file" "$source_signature_file" \
    "$RESTORE_VERIFIED_STAGE_DIR/verify.pub"
  stage_dir="$RESTORE_VERIFIED_STAGE_DIR"
  stage_backup="$source_backup_file"
  stage_checksum="$source_checksum_file"
  stage_manifest="$source_manifest_file"
  stage_signature="$source_signature_file"
  stage_verify_key="$stage_dir/verify.pub"
  runtime_dir="$(mktemp -d "$RESTORE_STAGING_ROOT/ledger-restore-runtime.XXXXXX")"
  chmod 0700 "$runtime_dir"
else
  require_environment BACKUP_VERIFY_KEY_FILE
  require_regular_file BACKUP_VERIFY_KEY_FILE "$BACKUP_VERIFY_KEY_FILE"
  stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/ledger-restore.XXXXXX")"
  chmod 0700 "$stage_dir"
  owns_stage_dir=1
  runtime_dir="$stage_dir"
  stage_backup="$stage_dir/$(basename -- "$source_backup_file")"
  stage_checksum="$stage_dir/$(basename -- "$source_checksum_file")"
  stage_manifest="$stage_dir/$(basename -- "$source_manifest_file")"
  stage_signature="$stage_dir/$(basename -- "$source_signature_file")"
  stage_verify_key="$stage_dir/verify.pub"
fi
staging_database=''
staging_database_oid=''
staging_created=0
staging_promoted=0
pinned_admin_args=()
admin_session_input=''
admin_session_output=''
admin_session_pid=''
admin_session_locked=0
admin_session_result=''

admin_session_command() {
  local sql="$1"
  local nonce="__LEDGER_RESTORE_ADMIN_${RANDOM}_${RANDOM}_DONE__"
  local line=''
  admin_session_result=''
  [[ -n "$admin_session_input" && -n "$admin_session_output" ]] || fail 'restore maintenance coordinator is not available'
  printf '%s\n\\echo %s\n' "$sql" "$nonce" >&9 || fail 'restore maintenance coordinator input failed'
  while IFS= read -r line <&8; do
    [[ "$line" == "$nonce" ]] && return 0
    admin_session_result+="$line"$'\n'
  done
  fail 'restore maintenance coordinator ended unexpectedly'
}

start_admin_session() {
  # This single session owns the cluster-scoped exclusive advisory lock for
  # every DDL step. CREATE/ALTER DATABASE cannot run in a transaction, so a
  # transaction lock is deliberately not used here.
  # macOS still ships Bash 3.2, which has no coprocess support. Two private
  # FIFOs keep one psql connection open portably while descriptors 8/9 ensure
  # it never sees EOF between commands.
  admin_session_input="$runtime_dir/admin-session.in"
  admin_session_output="$runtime_dir/admin-session.out"
  mkfifo -m 0600 "$admin_session_input" "$admin_session_output"
  psql --no-psqlrc --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${pinned_admin_args[@]}" <"$admin_session_input" >"$admin_session_output" &
  admin_session_pid="$!"
  exec 9>"$admin_session_input"
  exec 8<"$admin_session_output"
  admin_session_command 'SELECT pg_advisory_lock(741263, 2);'
  admin_session_locked=1
}

stop_admin_session() {
  if [[ -n "$admin_session_input" ]]; then
    if [[ "$admin_session_locked" == 1 ]]; then
      printf '%s\n' 'SELECT pg_advisory_unlock(741263, 2);' >&9 2>/dev/null || true
    fi
    printf '%s\n' '\q' >&9 2>/dev/null || true
    exec 9>&- 2>/dev/null || true
    exec 8<&- 2>/dev/null || true
  fi
  [[ -z "$admin_session_pid" ]] || wait "$admin_session_pid" 2>/dev/null || true
  admin_session_input=''
  admin_session_output=''
  admin_session_pid=''
  admin_session_locked=0
}

cleanup() {
  local cleanup_status=$?
  trap - EXIT INT TERM
  if [[ "$staging_created" == 1 && "$staging_promoted" == 0 ]]; then
    # A database cannot be safely dropped by a later name lookup: an operator
    # could have replaced it after this process disconnected. Preserve the
    # exact database for an operator to inspect against its recorded identity.
    printf 'restore failed; quarantined staging database: name=%s oid=%s\n' \
      "$staging_database" "$staging_database_oid" >&2
  fi
  stop_admin_session
  if [[ -n "$runtime_dir" && "$runtime_dir" != "$stage_dir" ]]; then
    if [[ "$runtime_dir" == "$RESTORE_STAGING_ROOT"/ledger-restore-runtime.* ]]; then
      rm -rf -- "$runtime_dir" || cleanup_status=1
    else
      cleanup_status=1
    fi
  fi
  if [[ "$owns_stage_dir" == 1 ]]; then
    rm -rf -- "$stage_dir" || cleanup_status=1
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT INT TERM

# Descriptor-based staging prevents a check-to-copy replacement race on a bind
# mount. All inputs used after validation are the private staged descriptors.
if [[ "$preverified_inputs" != 1 ]]; then
  secure_copy_regular "$source_backup_file" "$stage_backup"
  secure_copy_regular "$source_checksum_file" "$stage_checksum"
  secure_copy_regular "$source_manifest_file" "$stage_manifest"
  secure_copy_regular "$source_signature_file" "$stage_signature"
  secure_copy_regular "$BACKUP_VERIFY_KEY_FILE" "$stage_verify_key"
fi

expected_filename="$(basename "$stage_backup")"
expected_checksum="$(awk '{print $1}' "$stage_checksum")"
expected_checksum_line="$expected_checksum  $expected_filename"
[[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'backup checksum metadata is invalid'
[[ "$(wc -l < "$stage_checksum" | tr -d ' ')" == '1' && "$(< "$stage_checksum")" == "$expected_checksum_line" ]] || fail 'backup checksum metadata is invalid'
if [[ "$preverified_inputs" != 1 ]]; then
  [[ "$(sha256_file "$stage_backup")" == "$expected_checksum" ]] || fail 'backup checksum verification failed'
  minisign -Vm "$stage_manifest" -p "$stage_verify_key" -x "$stage_signature" -q >/dev/null
fi
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
if [[ "$preverified_inputs" != 1 ]]; then
  [[ "$manifest_size" == "$(wc -c < "$stage_backup" | tr -d ' ')" ]] || fail 'backup manifest size does not match ciphertext'
fi
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
pinned_admin_args=("--host=$pinned_host" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$RESTORE_ADMIN_DATABASE")
# Every connection after hostname resolution uses the pinned address/socket.
DATABASE_CLIENT_ARGS=("${pinned_admin_args[@]}")
admin_database="$(effective_database_name)"
[[ "$admin_database" == "$RESTORE_ADMIN_DATABASE" ]] || fail 'admin connection did not reach RESTORE_ADMIN_DATABASE'
admin_system_identifier="$(database_system_identifier)"
[[ "$RESTORE_CONFIRM_HOST" == "$pinned_endpoint_host" ]] || fail 'RESTORE_CONFIRM_HOST does not exactly match pinned admin host'
[[ "$RESTORE_CONFIRM_PORT" == "$PGPORT" ]] || fail 'RESTORE_CONFIRM_PORT does not exactly match pinned admin port'
[[ "$RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER" == "$source_system_identifier" ]] || fail 'RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER does not exactly match the signed backup provenance'
[[ "$RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER" == "$admin_system_identifier" ]] || fail 'RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER does not exactly match resolved target cluster'
expected_fingerprint="${RESTORE_TARGET_DATABASE}@${pinned_endpoint_host}:${PGPORT}#${admin_system_identifier}"
[[ "$RESTORE_CONFIRM_FINGERPRINT" == "$expected_fingerprint" ]] || fail 'RESTORE_CONFIRM_FINGERPRINT does not exactly match the pinned target'

start_admin_session
admin_session_command 'SELECT current_database();'
admin_session_result="${admin_session_result%$'\n'}"
[[ "$admin_session_result" == "$RESTORE_ADMIN_DATABASE" ]] || fail 'restore maintenance coordinator reached an unexpected admin database'
admin_session_command 'SELECT (pg_control_system()).system_identifier;'
admin_session_result="${admin_session_result%$'\n'}"
[[ "$admin_session_result" == "$admin_system_identifier" ]] || fail 'target PostgreSQL system identifier changed after maintenance lock acquisition'
admin_session_command "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$RESTORE_TARGET_DATABASE');"
admin_session_result="${admin_session_result%$'\n'}"
[[ "$admin_session_result" == f ]] || fail 'restore target database must be absent'

generate_staging_database_name() {
  local random_suffix
  random_suffix="$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')"
  [[ "$random_suffix" =~ ^[a-f0-9]{32}$ ]] || fail 'could not generate a cryptographically unique staging database name'
  printf 'ledger_restore_stage_%s\n' "$random_suffix"
}

for _ in {1..4}; do
  staging_database="$(generate_staging_database_name)"
  [[ "$staging_database" != "$RESTORE_TARGET_DATABASE" ]] && break
done
[[ "$staging_database" != "$RESTORE_TARGET_DATABASE" ]] || fail 'could not generate a staging database distinct from restore target'
# The no-superuser restore-admin initially owns its random template0 staging
# database. That retains the ownership PostgreSQL requires for the guarded
# rename; target objects are still restored under RESTORE_TARGET_OWNER below,
# and ownership transfers to that role in the same locked promotion command.
admin_session_command "CREATE DATABASE \"$staging_database\" WITH TEMPLATE template0; REVOKE ALL PRIVILEGES ON DATABASE \"$staging_database\" FROM PUBLIC; GRANT CONNECT, CREATE, TEMPORARY ON DATABASE \"$staging_database\" TO \"$RESTORE_TARGET_OWNER\"; GRANT CONNECT ON DATABASE \"$staging_database\" TO \"$PGUSER\";"
staging_created=1
admin_session_command "SELECT d.oid FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = '$staging_database' AND r.rolname = '$PGUSER';"
staging_database_oid="${admin_session_result%$'\n'}"
[[ "$staging_database_oid" =~ ^[0-9]+$ ]] || fail 'could not identify the staging database created for restore'

target_args=("--host=$pinned_host" "--port=$PGPORT" "--username=$PGUSER" "--dbname=$staging_database")

# A random template0 database is isolated from unprivileged sessions before
# this connection starts. These exact identity checks and the transaction make
# the dump stream safe without a brittle, incomplete catalog inventory.
{
  printf '%s\n' "SELECT 1 / CASE WHEN current_database() = :'restore_staging_database' THEN 1 ELSE 0 END;"
  printf '%s\n' "SELECT 1 / CASE WHEN (pg_control_system()).system_identifier::text = :'restore_target_system_identifier' THEN 1 ELSE 0 END;"
  printf '%s\n' "SELECT 1 / CASE WHEN (SELECT oid::text FROM pg_database WHERE datname = current_database()) = :'restore_staging_database_oid' THEN 1 ELSE 0 END;"
  printf '%s\n' 'SET ROLE :"restore_target_owner";'
  printf '%s\n' 'REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;'
  age_decrypt_from_regular_fd "$AGE_IDENTITY_FILE" < "$stage_backup" | pg_restore --no-owner --exit-on-error --file=-
} | psql --quiet --single-transaction --set ON_ERROR_STOP=1 \
  --set restore_staging_database="$staging_database" \
  --set restore_staging_database_oid="$staging_database_oid" \
  --set restore_target_owner="$RESTORE_TARGET_OWNER" \
  --set restore_target_system_identifier="$admin_system_identifier" \
  "${target_args[@]}"

# The still-locked coordinator verifies and promotes in this same admin
# session. Cooperating privileged automation must take this advisory lock.
admin_session_command "SELECT d.oid::text || '|' || r.rolname FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = '$staging_database';"
staging_metadata="${admin_session_result%$'\n'}"
[[ "$staging_metadata" == "$staging_database_oid|$PGUSER" ]] || fail 'staging database identity changed before promotion'
admin_session_command 'SELECT (pg_control_system()).system_identifier;'
admin_session_result="${admin_session_result%$'\n'}"
[[ "$admin_session_result" == "$admin_system_identifier" ]] || fail 'target PostgreSQL system identifier changed before promotion'
admin_session_command "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$RESTORE_TARGET_DATABASE');"
admin_session_result="${admin_session_result%$'\n'}"
[[ "$admin_session_result" == f ]] || fail 'restore target database appeared before promotion'
# The restore-admin owns the staging database and retains the ownership
# PostgreSQL requires for the cluster-level rename. It transfers database
# ownership only after the target name has been authenticated as absent.
admin_session_command "ALTER DATABASE \"$staging_database\" RENAME TO \"$RESTORE_TARGET_DATABASE\"; ALTER DATABASE \"$RESTORE_TARGET_DATABASE\" OWNER TO \"$RESTORE_TARGET_OWNER\";"
staging_promoted=1
