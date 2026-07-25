#!/usr/bin/env bash
# Re-apply idempotent default-safe roles and rotate normal role passwords on a
# running PostgreSQL service.  This always leaves ledger_restore_admin NOLOGIN,
# ungranted, and without a password; only the guarded maintenance scripts may
# open its temporary restore window.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/../docker-compose.yml}"
readonly DISABLE_AUTHORITY_SQL="$SCRIPT_DIR/disable-restore-authority.sql"

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -ec '
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
    --file /docker-entrypoint-initdb.d/001-roles.sql
  /docker-entrypoint-initdb.d/002-set-role-passwords.sh
'

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -ec '
  exec psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1
' < "$DISABLE_AUTHORITY_SQL"
