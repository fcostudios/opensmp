#!/usr/bin/env bash
# Emits the complete existing-volume role convergence program. The caller must
# feed this stream to exactly one psql session so its advisory lock spans every
# role and password change through disable-session termination verification.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROLES_SQL="$SCRIPT_DIR/init/001-roles.sql"
readonly DISABLE_AUTHORITY_SQL="$SCRIPT_DIR/disable-restore-authority.sql"

[[ -f "$ROLES_SQL" && -f "$DISABLE_AUTHORITY_SQL" ]] \
  || { printf '%s\n' 'role convergence SQL inputs are required' >&2; exit 1; }

printf '%s\n' '\set ON_ERROR_STOP 1'
printf '%s\n' 'SELECT pg_advisory_lock(741263, 2);'
printf '%s\n' '\set restore_disable_lock_held 1'
command cat "$ROLES_SQL"
printf '%s\n' \
  "ALTER ROLE ledger_owner PASSWORD :'ledger_owner_password';" \
  "ALTER ROLE ledger_app PASSWORD :'ledger_app_password';" \
  "ALTER ROLE ledger_backup PASSWORD :'ledger_backup_password';"
command cat "$DISABLE_AUTHORITY_SQL"
printf '%s\n' 'SELECT pg_advisory_unlock(741263, 2);'
