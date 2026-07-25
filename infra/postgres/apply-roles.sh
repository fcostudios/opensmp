#!/usr/bin/env bash
# Re-apply idempotent default-safe roles and rotate normal role passwords on a
# running PostgreSQL service.  This always leaves ledger_restore_admin NOLOGIN,
# ungranted, and without a password; only the guarded maintenance scripts may
# open its temporary restore window.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/../docker-compose.yml}"
readonly CONVERGENCE_SQL_BUILDER="$SCRIPT_DIR/build-role-convergence-sql.sh"

"$CONVERGENCE_SQL_BUILDER" | docker compose -f "$COMPOSE_FILE" exec -T postgres sh -ec '
  exec psql --username "$POSTGRES_USER" --dbname postgres \
    --set ON_ERROR_STOP=1 \
    --set ledger_owner_password="$LEDGER_OWNER_PASSWORD" \
    --set ledger_app_password="$LEDGER_APP_PASSWORD" \
    --set ledger_backup_password="$LEDGER_BACKUP_PASSWORD"
'
