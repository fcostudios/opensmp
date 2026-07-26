#!/usr/bin/env bash
# Closes restore authority even after a failed or abandoned restore attempt.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/postgres/restore-window-common.sh
source "$SCRIPT_DIR/restore-window-common.sh"

if [[ -f "$SCRIPT_DIR/disable-restore-authority.sql" ]]; then
  readonly DISABLE_AUTHORITY_SQL="$SCRIPT_DIR/disable-restore-authority.sql"
else
  readonly DISABLE_AUTHORITY_SQL='/usr/local/share/ledger/disable-restore-authority.sql'
fi
[[ -f "$DISABLE_AUTHORITY_SQL" ]] || restore_window_fail 'disable-restore-authority.sql is required'

restore_window_validate_target
restore_window_audit 'finalize_started'
finalize_state="$({
  restore_window_psql_preamble
  command cat "$DISABLE_AUTHORITY_SQL"
  printf '%s\n' '\q'
} | restore_window_psql --set restore_disable_lock_held=1)"
finalize_state="${finalize_state##*$'\n'}"
[[ "$finalize_state" == 'false|true|0|0' ]] || restore_window_fail "restore window did not reach the expected disabled state: $finalize_state"
restore_window_remove_credential_file
restore_window_audit 'finalized'
unset PGPASSWORD
