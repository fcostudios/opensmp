#!/usr/bin/env bash
# Re-apply idempotent role grants and rotate role passwords on a running
# PostgreSQL service whose data volume has already been initialized.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/../docker-compose.yml}"

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -ec '
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
    --file /docker-entrypoint-initdb.d/001-roles.sql
  /docker-entrypoint-initdb.d/002-set-role-passwords.sh
'
