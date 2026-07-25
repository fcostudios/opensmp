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

prepare_database_connection() {
  [[ -z "${PGOPTIONS:-}" ]] || fail 'PGOPTIONS is not permitted'

  if [[ -n "${DATABASE_URL:-}" ]]; then
    [[ "$DATABASE_URL" != *$'\n'* && "$DATABASE_URL" != *$'\r'* ]] || fail 'DATABASE_URL contains unsafe characters'
    [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail 'DATABASE_URL must be a PostgreSQL URI'
    local query=''
    if [[ "$DATABASE_URL" == *'?'* ]]; then
      query="${DATABASE_URL#*\?}"
      [[ ! "$query" =~ (^|&)options= ]] || fail 'DATABASE_URL must not contain URI options'
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
