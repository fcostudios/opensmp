#!/usr/bin/env bash
# Common safeguards for a one-time, isolated-target restore authority window.
set -euo pipefail
umask 077

readonly RESTORE_WINDOW_CONFIRMATION='I_CONFIRM_TARGET_IS_ISOLATED_AND_APPLICATION_STOPPED'
readonly RESTORE_WINDOW_LOCK_CLASS=741263
readonly RESTORE_WINDOW_LOCK_OBJECT=2

restore_window_fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

restore_window_require() {
  local name="$1"
  [[ -n "${!name:-}" ]] || restore_window_fail "$name is required"
}

restore_window_validate_target() {
  restore_window_require RESTORE_WINDOW_PGHOST
  restore_window_require RESTORE_WINDOW_PGPORT
  restore_window_require RESTORE_WINDOW_SUPERADMIN_USER
  restore_window_require RESTORE_WINDOW_SUPERADMIN_PASSWORD
  restore_window_require RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER
  restore_window_require RESTORE_WINDOW_CONFIRM_FINGERPRINT
  restore_window_require RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION
  restore_window_require RESTORE_WINDOW_AUDIT_LOG

  [[ "$RESTORE_WINDOW_PGPORT" =~ ^[0-9]+$ ]] || restore_window_fail 'RESTORE_WINDOW_PGPORT must be numeric'
  [[ "$RESTORE_WINDOW_SUPERADMIN_USER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || restore_window_fail 'RESTORE_WINDOW_SUPERADMIN_USER must be a PostgreSQL identifier'
  [[ "$RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER" =~ ^[0-9]+$ ]] || restore_window_fail 'RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER must be numeric'
  [[ "$RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION" == "$RESTORE_WINDOW_CONFIRMATION" ]] || restore_window_fail 'explicit isolated-target and application-stopped confirmation is required'

  RESTORE_WINDOW_ADMIN_DATABASE="${RESTORE_WINDOW_ADMIN_DATABASE:-postgres}"
  [[ "$RESTORE_WINDOW_ADMIN_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || restore_window_fail 'RESTORE_WINDOW_ADMIN_DATABASE must be a PostgreSQL identifier'

  if [[ "$RESTORE_WINDOW_PGHOST" == /* ]]; then
    [[ "$RESTORE_WINDOW_PGHOST" =~ ^/[A-Za-z0-9._/-]+$ ]] || restore_window_fail 'RESTORE_WINDOW_PGHOST socket directory is invalid'
    RESTORE_WINDOW_PINNED_HOST="${RESTORE_WINDOW_PGHOST%/}"
    RESTORE_WINDOW_PINNED_ENDPOINT="unix:${RESTORE_WINDOW_PINNED_HOST}"
  else
    # A maintenance window must use an operator-confirmed numeric address. It
    # cannot safely rely on a mutable DNS name while enabling a privileged role.
    [[ "$RESTORE_WINDOW_PGHOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ || "$RESTORE_WINDOW_PGHOST" =~ ^[0-9A-Fa-f:]+$ ]] || restore_window_fail 'RESTORE_WINDOW_PGHOST must be one explicit numeric address or Unix socket directory'
    RESTORE_WINDOW_PINNED_HOST="$RESTORE_WINDOW_PGHOST"
    RESTORE_WINDOW_PINNED_ENDPOINT="$RESTORE_WINDOW_PGHOST"
  fi
  local expected_fingerprint="${RESTORE_WINDOW_PINNED_ENDPOINT}:${RESTORE_WINDOW_PGPORT}#${RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER}"
  [[ "$RESTORE_WINDOW_CONFIRM_FINGERPRINT" == "$expected_fingerprint" ]] || restore_window_fail 'RESTORE_WINDOW_CONFIRM_FINGERPRINT does not match the explicit target endpoint and system identifier'

  [[ ! -L "$RESTORE_WINDOW_AUDIT_LOG" ]] || restore_window_fail 'RESTORE_WINDOW_AUDIT_LOG must not be a symlink'
  if [[ -e "$RESTORE_WINDOW_AUDIT_LOG" ]]; then
    [[ -f "$RESTORE_WINDOW_AUDIT_LOG" && -w "$RESTORE_WINDOW_AUDIT_LOG" ]] || restore_window_fail 'RESTORE_WINDOW_AUDIT_LOG must be a writable regular file'
  else
    : > "$RESTORE_WINDOW_AUDIT_LOG"
    chmod 0600 "$RESTORE_WINDOW_AUDIT_LOG"
  fi

  export PGHOST="$RESTORE_WINDOW_PINNED_HOST"
  export PGPORT="$RESTORE_WINDOW_PGPORT"
  export PGUSER="$RESTORE_WINDOW_SUPERADMIN_USER"
  export PGDATABASE="$RESTORE_WINDOW_ADMIN_DATABASE"
  # PGPASSWORD is an environment value, never an argv/psql --set value. The
  # caller must invoke this from a protected operator shell.
  export PGPASSWORD="$RESTORE_WINDOW_SUPERADMIN_PASSWORD"
  RESTORE_WINDOW_PSQL_ARGS=(
    '--no-psqlrc'
    '--no-align'
    '--tuples-only'
    '--quiet'
    '--set' 'ON_ERROR_STOP=1'
    "--host=$RESTORE_WINDOW_PINNED_HOST"
    "--port=$RESTORE_WINDOW_PGPORT"
    "--username=$RESTORE_WINDOW_SUPERADMIN_USER"
    "--dbname=$RESTORE_WINDOW_ADMIN_DATABASE"
    '--set' "restore_window_system_identifier=$RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER"
  )
}

restore_window_audit() {
  local event="$1"
  printf '{"timestamp":"%s","event":"%s","fingerprint":"%s","system_identifier":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" "$RESTORE_WINDOW_CONFIRM_FINGERPRINT" "$RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER" \
    >> "$RESTORE_WINDOW_AUDIT_LOG"
}

restore_window_psql_preamble() {
  cat <<'SQL'
\o /dev/null
SELECT pg_advisory_lock(741263, 2);
SELECT 1 / CASE WHEN current_database() = :'restore_window_admin_database' THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN (pg_control_system()).system_identifier::text = :'restore_window_system_identifier' THEN 1 ELSE 0 END;
\o
SQL
}

restore_window_psql() {
  psql "${RESTORE_WINDOW_PSQL_ARGS[@]}" \
    --set "restore_window_admin_database=$RESTORE_WINDOW_ADMIN_DATABASE" \
    "$@"
}

restore_window_remove_credential_file() {
  [[ -n "${RESTORE_WINDOW_CREDENTIAL_FILE:-}" ]] || return 0
  [[ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]] && return 0
  [[ ! -L "$RESTORE_WINDOW_CREDENTIAL_FILE" && -f "$RESTORE_WINDOW_CREDENTIAL_FILE" ]] || restore_window_fail 'RESTORE_WINDOW_CREDENTIAL_FILE must be a regular non-symlink file before removal'
  rm -f -- "$RESTORE_WINDOW_CREDENTIAL_FILE"
}
