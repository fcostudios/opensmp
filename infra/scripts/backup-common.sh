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
  local allowed_keys=' sslmode sslrootcert sslcert sslkey sslpassword connect_timeout application_name target_session_attrs gssencmode channel_binding require_auth '

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

validate_age_recipient() {
  require_environment BACKUP_AGE_RECIPIENT
  [[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[ac-hj-np-z02-9]{58}$ ]] || fail 'invalid BACKUP_AGE_RECIPIENT'
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
