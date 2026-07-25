#!/usr/bin/env bash
# Shared validation for the backup and restore entry points. Database URLs are
# deliberately constrained to a simple PostgreSQL URI so they cannot smuggle
# libpq connection options or shell-like arguments into client commands.
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_environment() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

parse_database_url() {
  require_environment DATABASE_URL

  [[ "$DATABASE_URL" != *$'\n'* && "$DATABASE_URL" != *$'\r'* && "$DATABASE_URL" != *' '* && "$DATABASE_URL" != *'#'* && "$DATABASE_URL" != *';'* ]] || fail 'DATABASE_URL contains unsafe characters'
  [[ "$DATABASE_URL" != *'?'* ]] || fail 'DATABASE_URL must not contain URI options'
  [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail 'DATABASE_URL must be a postgresql:// URI'

  local authority_and_database="${DATABASE_URL#*://}"
  local authority="${authority_and_database%%/*}"
  target_database="${authority_and_database#*/}"
  [[ "$authority" != "$authority_and_database" && -n "$authority" ]] || fail 'DATABASE_URL must include a host and database name'
  [[ "$target_database" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$ ]] || fail 'DATABASE_URL has an unsafe database name'

  local host_port="${authority##*@}"
  [[ "$host_port" =~ ^[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || fail 'DATABASE_URL has an unsafe host or port'
  if [[ "$host_port" == *:* ]]; then
    local port="${host_port##*:}"
    (( 10#$port >= 1 && 10#$port <= 65535 )) || fail 'DATABASE_URL port is out of range'
  fi
}

validate_age_recipient() {
  require_environment BACKUP_AGE_RECIPIENT
  [[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[ac-hj-np-z02-9]{58}$ ]] || fail 'invalid BACKUP_AGE_RECIPIENT'
}

sha256_file() {
  shasum --algorithm 256 "$1" | awk '{print $1}'
}
