#!/usr/bin/env bash
# Opens a short-lived restore authority window on an isolated target cluster.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/postgres/restore-window-common.sh
source "$SCRIPT_DIR/restore-window-common.sh"

window_may_be_open=0
generated_credential=0
cleanup_failed_prepare() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 && "$window_may_be_open" == 1 ]]; then
    "$SCRIPT_DIR/finalize-restore-window.sh" || status=1
  fi
  if [[ "$status" -ne 0 && "$generated_credential" == 1 ]]; then
    restore_window_remove_credential_file
  fi
  unset credential PGPASSWORD
  exit "$status"
}
trap cleanup_failed_prepare EXIT INT TERM

restore_window_validate_target
restore_window_require RESTORE_WINDOW_TTL_SECONDS
restore_window_require RESTORE_WINDOW_CREDENTIAL_FILE
restore_window_require RESTORE_WINDOW_CREDENTIAL_ROOT
[[ "$RESTORE_WINDOW_TTL_SECONDS" =~ ^[0-9]+$ && "$RESTORE_WINDOW_TTL_SECONDS" -ge 1 && "$RESTORE_WINDOW_TTL_SECONDS" -le 900 ]] \
  || restore_window_fail 'RESTORE_WINDOW_TTL_SECONDS must be between 1 and 900'

if [[ "${RESTORE_WINDOW_GENERATE_CREDENTIAL:-0}" == 1 ]]; then
  command -v openssl >/dev/null 2>&1 || restore_window_fail 'openssl is required to generate a restore-window credential'
  generated_secret="$(openssl rand -base64 48)"
  RESTORE_WINDOW_CREDENTIAL_IDENTITY="$(printf '%s\n' "$generated_secret" | restore_window_create_credential_file "$RESTORE_WINDOW_CREDENTIAL_FILE")"
  export RESTORE_WINDOW_CREDENTIAL_IDENTITY
  unset generated_secret
  generated_credential=1
fi

credential="$(restore_window_read_credential_file "$RESTORE_WINDOW_CREDENTIAL_FILE")" \
  || restore_window_fail 'restore-window credential file validation failed'
[[ "$credential" =~ ^[[:graph:]]{32,}$ && "$credential" != *$'\n'* && "$credential" != *$'\r'* ]] \
  || restore_window_fail 'restore-window credential must be one printable line of at least 32 characters'

restore_window_audit 'prepare_started'
# From this point an error must actively close the window: a server-side
# COMMIT can succeed even if a later client-side state check fails.
window_may_be_open=1
prepare_state="$({
  restore_window_psql_preamble
  cat <<'SQL'
BEGIN;
ALTER ROLE ledger_restore_admin NOLOGIN VALID UNTIL 'epoch';
REVOKE ledger_owner FROM ledger_restore_admin;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'ledger_restore_admin' AND pid <> pg_backend_pid();
\password ledger_restore_admin
SQL
  printf '%s\n%s\n' "$credential" "$credential"
  cat <<'SQL'
SELECT format(
  'ALTER ROLE ledger_restore_admin LOGIN VALID UNTIL %L',
  clock_timestamp() + (:'restore_window_ttl_seconds' || ' seconds')::interval
) \gexec
GRANT ledger_owner TO ledger_restore_admin;
COMMIT;
SELECT rolcanlogin::text || '|' || (rolvaliduntil > clock_timestamp())::text || '|' ||
  (SELECT count(*) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE parent.rolname = 'ledger_owner' AND member.rolname = 'ledger_restore_admin')::text
FROM pg_roles WHERE rolname = 'ledger_restore_admin';
\q
SQL
} | restore_window_psql --set "restore_window_ttl_seconds=$RESTORE_WINDOW_TTL_SECONDS")"
prepare_state="${prepare_state##*$'\n'}"
[[ "$prepare_state" == 'true|true|1' ]] || restore_window_fail 'restore window did not reach the expected enabled state'
restore_window_audit 'prepared'
window_may_be_open=0
trap - EXIT INT TERM
unset credential PGPASSWORD
