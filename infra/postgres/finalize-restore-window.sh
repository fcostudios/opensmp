#!/usr/bin/env bash
# Closes restore authority even after a failed or abandoned restore attempt.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/postgres/restore-window-common.sh
source "$SCRIPT_DIR/restore-window-common.sh"

restore_window_validate_target
restore_window_audit 'finalize_started'
finalize_state="$({
  restore_window_psql_preamble
  cat <<'SQL'
BEGIN;
ALTER ROLE ledger_restore_admin NOLOGIN PASSWORD NULL VALID UNTIL 'epoch';
REVOKE ledger_owner FROM ledger_restore_admin;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'ledger_restore_admin' AND pid <> pg_backend_pid();
COMMIT;
DO $wait$
DECLARE
  attempt integer;
BEGIN
  FOR attempt IN 1..50 LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'ledger_restore_admin');
    PERFORM pg_sleep(0.1);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'ledger_restore_admin') THEN
    RAISE EXCEPTION 'restore-admin sessions remained after termination';
  END IF;
END
$wait$;
SELECT rolcanlogin::text || '|' ||
  (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'ledger_restore_admin')::text || '|' ||
  (SELECT count(*) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE parent.rolname = 'ledger_owner' AND member.rolname = 'ledger_restore_admin')::text || '|' ||
  (SELECT count(*) FROM pg_stat_activity WHERE usename = 'ledger_restore_admin')::text
FROM pg_roles WHERE rolname = 'ledger_restore_admin';
\q
SQL
} | restore_window_psql)"
finalize_state="${finalize_state##*$'\n'}"
[[ "$finalize_state" == 'false|true|0|0' ]] || restore_window_fail "restore window did not reach the expected disabled state: $finalize_state"
restore_window_remove_credential_file
restore_window_audit 'finalized'
unset PGPASSWORD
