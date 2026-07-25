#!/usr/bin/env bash
# Creates and always closes a temporary restore window around restore-db.sh.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$SCRIPT_DIR/restore-db.sh" ]]; then
  readonly DEFAULT_RESTORE_SCRIPT="$SCRIPT_DIR/restore-db.sh"
else
  readonly DEFAULT_RESTORE_SCRIPT="$SCRIPT_DIR/../scripts/restore-db.sh"
fi
readonly RESTORE_SCRIPT="${RESTORE_WINDOW_RESTORE_SCRIPT:-$DEFAULT_RESTORE_SCRIPT}"
[[ "$#" -eq 1 ]] || { printf '%s\n' 'usage: run-guarded-restore.sh /path/to/ledger-YYYYMMDDHHMMSS.dump.age' >&2; exit 1; }

temporary_credential=0
if [[ -z "${RESTORE_WINDOW_CREDENTIAL_FILE:-}" ]]; then
  RESTORE_WINDOW_CREDENTIAL_FILE="$(mktemp "${TMPDIR:-/tmp}/ledger-restore-window.XXXXXX")"
  rm -f -- "$RESTORE_WINDOW_CREDENTIAL_FILE"
  export RESTORE_WINDOW_CREDENTIAL_FILE
  export RESTORE_WINDOW_GENERATE_CREDENTIAL=1
  temporary_credential=1
elif [[ -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]]; then
  # A drill may deliberately hand the wrapper an already protected credential
  # file. Prepare rotates/revalidates that authority without treating the path
  # as a new-file generation target.
  export RESTORE_WINDOW_GENERATE_CREDENTIAL=0
fi

# Mark the window as needing finalization before prepare starts.  Prepare is
# transactional, but a process can fail after COMMIT and before its success
# check; finalization is deliberately safe and idempotent in that case.
window_prepared=1
finalize_restore_window() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$window_prepared" == 1 ]]; then
    "$SCRIPT_DIR/finalize-restore-window.sh" || status=1
  fi
  if [[ "$temporary_credential" == 1 && -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]]; then
    rm -f -- "$RESTORE_WINDOW_CREDENTIAL_FILE"
  fi
  unset PGPASSWORD
  exit "$status"
}
trap finalize_restore_window EXIT INT TERM

"$SCRIPT_DIR/prepare-restore-window.sh"
IFS= read -r restore_password < "$RESTORE_WINDOW_CREDENTIAL_FILE"
export PGHOST="$RESTORE_WINDOW_PGHOST"
export PGPORT="$RESTORE_WINDOW_PGPORT"
export PGUSER=ledger_restore_admin
export PGDATABASE="$RESTORE_WINDOW_ADMIN_DATABASE"
export PGPASSWORD="$restore_password"
"$RESTORE_SCRIPT" "$1"
