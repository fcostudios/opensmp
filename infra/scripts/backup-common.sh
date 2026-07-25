#!/usr/bin/env bash
# Shared libpq-safe connection and checksum helpers for backup/restore.
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_environment() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

DATABASE_CLIENT_ARGS=()

percent_decode_uri_component() {
  local encoded="$1"
  local decoded=''
  local index=0
  local character hex byte
  while (( index < ${#encoded} )); do
    character="${encoded:index:1}"
    if [[ "$character" == '%' ]]; then
      (( index + 2 < ${#encoded} )) || fail 'DATABASE_URL URI query has malformed percent encoding'
      hex="${encoded:index + 1:2}"
      [[ "$hex" =~ ^[[:xdigit:]]{2}$ && "$hex" != '00' ]] || fail 'DATABASE_URL URI query has malformed percent encoding'
      printf -v byte '%b' "\\x$hex"
      decoded+="$byte"
      ((index += 3))
    else
      decoded+="$character"
      ((index += 1))
    fi
  done
  [[ "$decoded" != *$'\n'* && "$decoded" != *$'\r'* ]] || fail 'DATABASE_URL URI query contains unsafe characters'
  printf '%s' "$decoded"
}

validate_database_uri_query() {
  local query="$1"
  local pair encoded_key encoded_value key value
  local seen_keys='|'
  local -a query_pairs=()
  local allowed_keys=' sslmode sslrootcert sslcert sslkey connect_timeout application_name target_session_attrs gssencmode channel_binding require_auth '

  [[ -n "$query" ]] || fail 'DATABASE_URL URI query must not be empty'
  IFS='&' read -r -a query_pairs <<< "$query"
  for pair in "${query_pairs[@]}"; do
    [[ "$pair" == *=* ]] || fail 'DATABASE_URL URI query parameter is malformed'
    encoded_key="${pair%%=*}"
    encoded_value="${pair#*=}"
    key="$(percent_decode_uri_component "$encoded_key" | tr '[:upper:]' '[:lower:]')"
    value="$(percent_decode_uri_component "$encoded_value")"
    [[ -n "$key" && -n "$value" ]] || fail 'DATABASE_URL URI query parameter is malformed'
    [[ "$seen_keys" != *"|$key|"* ]] || fail 'DATABASE_URL URI query has duplicate parameters'
    seen_keys+="$key|"
    [[ "$allowed_keys" == *" $key "* ]] || fail 'DATABASE_URL URI query contains a forbidden parameter'
  done
}

prepare_database_connection() {
  [[ -z "${PGOPTIONS:-}" ]] || fail 'PGOPTIONS is not permitted'

  if [[ -n "${DATABASE_URL:-}" ]]; then
    [[ "$DATABASE_URL" != *$'\n'* && "$DATABASE_URL" != *$'\r'* ]] || fail 'DATABASE_URL contains unsafe characters'
    [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail 'DATABASE_URL must be a PostgreSQL URI'
    local authority="${DATABASE_URL#*://}"
    authority="${authority%%/*}"
    if [[ "$authority" == *@* ]]; then
      [[ "${authority%@*}" != *:* ]] || fail 'DATABASE_URL must not contain a userinfo password'
    fi
    local query=''
    if [[ "$DATABASE_URL" == *'?'* ]]; then
      query="${DATABASE_URL#*\?}"
      validate_database_uri_query "$query"
    fi
    DATABASE_CLIENT_ARGS=("--dbname=$DATABASE_URL")
  else
    require_environment PGDATABASE
    DATABASE_CLIENT_ARGS=("--dbname=$PGDATABASE")
  fi
}

effective_database_name() {
  local database
  database="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${DATABASE_CLIENT_ARGS[@]}" --command 'SELECT current_database()')"
  [[ "$database" =~ ^[[:print:]]+$ && "$database" != *$'\n'* && "$database" != *$'\r'* ]] || fail 'could not determine effective target database'
  printf '%s\n' "$database"
}

effective_target_identity() {
  local identity database host port socket_directories
  identity="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 --field-separator '|' "${DATABASE_CLIENT_ARGS[@]}" --command "SELECT current_database(), COALESCE(host(inet_server_addr()), '<unix>'), inet_server_port()")"
  IFS='|' read -r database host port <<< "$identity"
  if [[ "$host" == '<unix>' ]]; then
    socket_directories="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${DATABASE_CLIENT_ARGS[@]}" --command 'SHOW unix_socket_directories')"
    socket_directories="${socket_directories#"${socket_directories%%[![:space:]]*}"}"
    socket_directories="${socket_directories%"${socket_directories##*[![:space:]]}"}"
    [[ "$socket_directories" =~ ^/[^,[:space:]]*$ && "$socket_directories" != *'//'* && "$socket_directories" != *'/./'* && "$socket_directories" != *'/../'* && "$socket_directories" != */. && "$socket_directories" != */.. ]] || fail 'could not determine an unambiguous Unix socket directory'
    host="unix:${socket_directories%/}"
  fi
  if [[ -z "$port" ]]; then
    port="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${DATABASE_CLIENT_ARGS[@]}" --command 'SHOW port')"
  fi
  [[ "$database" =~ ^[[:print:]]+$ && "$host" =~ ^[[:print:]]+$ && "$port" =~ ^[0-9]+$ ]] || fail 'could not determine effective restore target identity'
  printf '%s\t%s\t%s\n' "$database" "$host" "$port"
}

resolve_pinned_connection_host() {
  local requested_host="$1"
  local resolved_candidates resolved
  [[ -n "$requested_host" ]] || fail 'database host is required'
  if [[ "$requested_host" == /* ]]; then
    [[ "$requested_host" =~ ^/[^,[:space:]]*$ && "$requested_host" != *'//'* && "$requested_host" != *'/./'* && "$requested_host" != *'/../'* ]] || fail 'could not normalize Unix socket directory'
    printf 'unix:%s\n' "${requested_host%/}"
    return 0
  fi
  if [[ "$requested_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ || "$requested_host" =~ ^[0-9A-Fa-f:]+$ ]]; then
    printf '%s\n' "$requested_host"
    return 0
  fi
  command -v getent >/dev/null 2>&1 || fail 'cannot resolve a non-numeric database host without getent'
  resolved_candidates="$(getent ahostsv4 "$requested_host" 2>/dev/null | awk '{print $1}' | awk '!seen[$0]++')"
  [[ "$(printf '%s\n' "$resolved_candidates" | sed '/^$/d' | wc -l | tr -d ' ')" == 1 ]] || fail 'database hostname resolves ambiguously; use one explicit address'
  resolved="$(printf '%s\n' "$resolved_candidates" | sed -n '1p')"
  [[ "$resolved" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail 'could not resolve database host'
  printf '%s\n' "$resolved"
}

target_user_object_count() {
  psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${DATABASE_CLIENT_ARGS[@]}" --command "
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
  -- Database-scoped or non-namespaced dumpable state not covered above.
  + (SELECT count(*) FROM pg_largeobject_metadata)
  + (SELECT count(*) FROM pg_default_acl)
  + (SELECT count(*) FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))
  + (SELECT count(*) FROM pg_foreign_data_wrapper)
  + (SELECT count(*) FROM pg_foreign_server)
  + (SELECT count(*) FROM pg_publication)
  + (SELECT count(*) FROM pg_subscription);"
}

validate_age_recipient() {
  require_environment BACKUP_AGE_RECIPIENT
  [[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[ac-hj-np-z02-9]{58}$ ]] || fail 'invalid BACKUP_AGE_RECIPIENT'
}

require_regular_file() {
  local label="$1"
  local path="$2"
  [[ ! -L "$path" && -f "$path" && -r "$path" ]] || fail "$label must be a readable regular non-symlink file"
}

database_system_identifier() {
  local identifier
  identifier="$(psql --no-align --tuples-only --quiet --set ON_ERROR_STOP=1 "${DATABASE_CLIENT_ARGS[@]}" --command 'SELECT (pg_control_system()).system_identifier')"
  [[ "$identifier" =~ ^[0-9]+$ ]] || fail 'could not determine PostgreSQL system identifier'
  printf '%s\n' "$identifier"
}

secure_copy_regular() {
  # Open the source exactly once with O_NOFOLLOW, then copy that descriptor. A
  # pre-copy lstat alone is TOCTOU-vulnerable if a mounted backup is replaced.
  local source="$1"
  local destination="$2"
  perl -MFcntl=':DEFAULT,O_NOFOLLOW' -MIO::Handle -e '
    my ($source, $destination) = @ARGV;
    sysopen(my $in, $source, O_RDONLY | O_NOFOLLOW) or die "open source: $!\n";
    my @st = stat($in);
    die "source is not a regular file\n" unless @st && -f _;
    sysopen(my $out, $destination, O_WRONLY | O_CREAT | O_EXCL, 0600) or die "open destination: $!\n";
    binmode($in); binmode($out);
    my $buffer;
    while (1) {
      my $read = read($in, $buffer, 1024 * 1024);
      die "read source: $!\n" unless defined $read;
      last if $read == 0;
      my $offset = 0;
      while ($offset < $read) {
        my $written = syswrite($out, $buffer, $read - $offset, $offset);
        die "write destination: $!\n" unless defined $written;
        $offset += $written;
      }
    }
    $out->sync or die "fsync destination: $!\n";
  ' "$source" "$destination"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum --algorithm 256 "$1" | awk '{print $1}'
  else
    fail 'no SHA-256 tool is available'
  fi
}

process_start_token() {
  local pid="$1"
  if [[ -r "/proc/$pid/stat" ]]; then
    awk '{print $22}' "/proc/$pid/stat"
  else
    ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ' | sed 's/^ //' | tr ' ' '_'
  fi
}

fsync_path() {
  if sync --help 2>&1 | grep -q -- ' -f'; then
    sync -f "$1"
  else
    perl -MIO::Handle -e 'open my $fh, "<", $ARGV[0] or die $!; $fh->sync or die $!' "$1"
  fi
}

fsync_directory() {
  if sync --help 2>&1 | grep -q -- ' -d'; then
    sync -d "$1"
  elif [[ "$(uname -s)" == 'Darwin' ]]; then
    # Darwin sync(1) has no path form; the production Linux image uses GNU sync -d.
    return 0
  else
    perl -MIO::Handle -e 'opendir my $dh, $ARGV[0] or die $!; $dh->sync or die $!' "$1"
  fi
}
