#!/usr/bin/env bash
# Creates and always closes a temporary restore window around restore-db.sh.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/postgres/restore-window-common.sh
source "$SCRIPT_DIR/restore-window-common.sh"

if [[ -x "$SCRIPT_DIR/restore-db.sh" ]]; then
  readonly DEFAULT_RESTORE_SCRIPT="$SCRIPT_DIR/restore-db.sh"
  readonly DEFAULT_STAGE_SCRIPT="$SCRIPT_DIR/stage-restore-inputs.sh"
else
  readonly DEFAULT_RESTORE_SCRIPT="$SCRIPT_DIR/../scripts/restore-db.sh"
  readonly DEFAULT_STAGE_SCRIPT="$SCRIPT_DIR/../scripts/stage-restore-inputs.sh"
fi
readonly RESTORE_SCRIPT="${RESTORE_WINDOW_RESTORE_SCRIPT:-$DEFAULT_RESTORE_SCRIPT}"
readonly STAGE_SCRIPT="${RESTORE_WINDOW_STAGE_SCRIPT:-$DEFAULT_STAGE_SCRIPT}"
[[ "$#" -eq 1 ]] || { printf '%s\n' 'usage: run-guarded-restore.sh /path/to/ledger-YYYYMMDDHHMMSS.dump.age' >&2; exit 1; }
[[ -x "$STAGE_SCRIPT" ]] || restore_window_fail 'stage-restore-inputs.sh is required'
# This is intentionally not a forwarding interface. A caller cannot turn the
# direct restorer into an authority opener by pre-populating this legacy name.
unset RESTORE_GUARDED_PREPARE

# The packaged entrypoint first pins the exact mounted staging root. All later
# accesses use its inherited directory descriptor, so replacing an
# intermediate same-UID parent cannot redirect staging or cleanup.
if [[ "$SCRIPT_DIR" == /usr/local/bin && -z "${RESTORE_STAGING_ROOT_FD:-}" ]]; then
  restore_window_require RESTORE_STAGING_ROOT
  exec /usr/local/bin/exec-with-restore-staging-root.pl "$RESTORE_STAGING_ROOT" "$0" "$@"
fi

temporary_credential=0
staged_dir=''
window_prepared=0

finalize_restore_window() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$window_prepared" == 1 ]]; then
    "$SCRIPT_DIR/finalize-restore-window.sh" || status=1
  elif [[ -e "${RESTORE_WINDOW_CREDENTIAL_FILE:-}" ]]; then
    restore_window_remove_credential_file || status=1
  fi
  if [[ "$temporary_credential" == 1 && -d "${RESTORE_WINDOW_CREDENTIAL_ROOT:-}" ]]; then
    rmdir -- "$RESTORE_WINDOW_CREDENTIAL_ROOT" || status=1
  fi
  if [[ -n "$staged_dir" && -d "$staged_dir" ]]; then
    if [[ "$staged_dir" == "$RESTORE_STAGING_ROOT"/ledger-restore-inputs.* ]]; then
      chmod 0700 "$staged_dir" || status=1
      staged_name="$(basename -- "$staged_backup")"
      rm -f -- "$staged_dir/$staged_name" \
        "$staged_dir/$staged_name.sha256" \
        "$staged_dir/$staged_name.manifest" \
        "$staged_dir/$staged_name.manifest.minisig" \
        "$staged_dir/verify.pub" || status=1
      rmdir -- "$staged_dir" || status=1
    else
      status=1
    fi
  fi
  unset restore_password PGPASSWORD
  exit "$status"
}
trap finalize_restore_window EXIT INT TERM

if [[ -z "${RESTORE_WINDOW_CREDENTIAL_FILE:-}" ]]; then
  RESTORE_WINDOW_CREDENTIAL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ledger-restore-window.XXXXXX")"
  RESTORE_WINDOW_CREDENTIAL_ROOT="$(cd "$RESTORE_WINDOW_CREDENTIAL_ROOT" && pwd -P)"
  chmod 0700 "$RESTORE_WINDOW_CREDENTIAL_ROOT"
  RESTORE_WINDOW_CREDENTIAL_FILE="$RESTORE_WINDOW_CREDENTIAL_ROOT/credential"
  export RESTORE_WINDOW_CREDENTIAL_ROOT RESTORE_WINDOW_CREDENTIAL_FILE
  temporary_credential=1
fi

restore_window_require RESTORE_WINDOW_CREDENTIAL_ROOT
if [[ "${RESTORE_WINDOW_GENERATE_CREDENTIAL:-1}" == 1 ]]; then
  command -v openssl >/dev/null 2>&1 || restore_window_fail 'openssl is required to generate a restore-window credential'
  generated_secret="$(openssl rand -base64 48)"
  RESTORE_WINDOW_CREDENTIAL_IDENTITY="$(printf '%s\n' "$generated_secret" | restore_window_create_credential_file "$RESTORE_WINDOW_CREDENTIAL_FILE")" \
    || restore_window_fail 'could not create restore-window credential safely'
  unset generated_secret
else
  RESTORE_WINDOW_CREDENTIAL_IDENTITY="$(restore_window_credential_metadata "$RESTORE_WINDOW_CREDENTIAL_FILE")" \
    || restore_window_fail 'restore-window credential file validation failed'
fi
export RESTORE_WINDOW_CREDENTIAL_IDENTITY
export RESTORE_WINDOW_GENERATE_CREDENTIAL=0

# Public O_NOFOLLOW copying, capacity checks, signature verification, and
# ciphertext hash/size validation all finish before the TTL authority window.
staged_backup="$("$STAGE_SCRIPT" "$1")" || restore_window_fail 'restore artifact staging or verification failed'
staged_dir="$(dirname "$staged_backup")"

# This wrapper, not restore-db.sh, is the sole authority opener.  Its EXIT
# trap is installed before staging and remains responsible for finalization
# across every post-prepare success and failure path.
"$SCRIPT_DIR/prepare-restore-window.sh"
window_prepared=1
restore_password="$(restore_window_read_credential_file "$RESTORE_WINDOW_CREDENTIAL_FILE")" \
  || restore_window_fail 'restore-window credential file was replaced'
export PGHOST="$RESTORE_WINDOW_PGHOST"
export PGPORT="$RESTORE_WINDOW_PGPORT"
export PGUSER=ledger_restore_admin
export PGDATABASE="$RESTORE_WINDOW_ADMIN_DATABASE"
export PGPASSWORD="$restore_password"
export RESTORE_STAGED_INPUTS=1
export RESTORE_VERIFIED_STAGE_DIR="$staged_dir"
"$RESTORE_SCRIPT" "$staged_backup"
