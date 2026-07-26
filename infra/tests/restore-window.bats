#!/usr/bin/env bats

prepare_script="$BATS_TEST_DIRNAME/../postgres/prepare-restore-window.sh"
finalize_script="$BATS_TEST_DIRNAME/../postgres/finalize-restore-window.sh"
guarded_restore_script="$BATS_TEST_DIRNAME/../postgres/run-guarded-restore.sh"
disable_authority_sql="$BATS_TEST_DIRNAME/../postgres/disable-restore-authority.sql"
role_convergence_script="$BATS_TEST_DIRNAME/../postgres/build-role-convergence-sql.sh"

setup_file() {
  bats_require_minimum_version 1.5.0
}

setup() {
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/ledger-restore-window.XXXXXX")"
  test_root="$(cd "$test_root" && pwd -P)"
  host_psql="$(command -v psql)"
  container_id=""
  export RESTORE_WINDOW_AUDIT_LOG="$test_root/restore-window.audit.jsonl"
  export RESTORE_WINDOW_CREDENTIAL_FILE="$test_root/restore-window.credential"
  export RESTORE_WINDOW_CREDENTIAL_ROOT="$test_root"
  mkdir "$test_root/restore-staging"
  chmod 0700 "$test_root/restore-staging"
  export RESTORE_STAGING_ROOT="$test_root/restore-staging"
  export RESTORE_WINDOW_GENERATE_CREDENTIAL=1
  export RESTORE_WINDOW_TTL_SECONDS=60
  export RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION=I_CONFIRM_TARGET_IS_ISOLATED_AND_APPLICATION_STOPPED
}

teardown() {
  [[ -z "$container_id" ]] || docker rm --force "$container_id" >/dev/null 2>&1 || true
  rm -rf -- "$test_root"
}

start_target_cluster() {
  container_id="ledger-restore-window-${BATS_TEST_NUMBER}-$$"
  docker run --detach --rm --name "$container_id" \
    --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=ledger \
    --publish 127.0.0.1::5432 postgres:16-alpine >/dev/null
  local attempt
  for attempt in {1..30}; do
    docker exec "$container_id" pg_isready --username postgres --dbname postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$container_id" pg_isready --username postgres --dbname postgres >/dev/null
  postgres_port="$(docker port "$container_id" 5432/tcp | sed 's/.*://')"
  target_system_identifier="$(docker exec "$container_id" psql --username postgres --dbname postgres --tuples-only --no-align --command 'SELECT (pg_control_system()).system_identifier;')"
  "$host_psql" "postgresql://postgres:postgres@127.0.0.1:${postgres_port}/ledger" --set ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ledger_owner LOGIN PASSWORD 'owner' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ledger_restore_admin NOLOGIN CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE PASSWORD NULL;
ALTER DATABASE ledger OWNER TO ledger_owner;
SQL
  export RESTORE_WINDOW_PGHOST=127.0.0.1
  export RESTORE_WINDOW_PGPORT="$postgres_port"
  export RESTORE_WINDOW_SUPERADMIN_USER=postgres
  export RESTORE_WINDOW_SUPERADMIN_PASSWORD=postgres
  export RESTORE_WINDOW_ADMIN_DATABASE=postgres
  export RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER="$target_system_identifier"
  export RESTORE_WINDOW_CONFIRM_FINGERPRINT="127.0.0.1:${postgres_port}#${target_system_identifier}"
}

restore_admin_state() {
  "$host_psql" "postgresql://postgres:postgres@127.0.0.1:${postgres_port}/postgres" --tuples-only --no-align --command "SELECT rolcanlogin::text || '|' || (rolpassword IS NULL)::text || '|' || (SELECT count(*) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE parent.rolname = 'ledger_owner' AND member.rolname = 'ledger_restore_admin')::text || '|' || (SELECT count(*) FROM pg_stat_activity WHERE usename = 'ledger_restore_admin')::text FROM pg_authid WHERE rolname = 'ledger_restore_admin';"
}

restore_admin_can_mutate() {
  local password="$1"
  PGPASSWORD="$password" "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username ledger_restore_admin --dbname ledger --set ON_ERROR_STOP=1 --command 'SET ROLE ledger_owner; CREATE TABLE restore_window_mutation (id integer PRIMARY KEY);'
}

@test "restore authority is impossible before prepare, works only in its short window, and finalize revokes it" {
  start_target_cluster

  run restore_admin_state
  [ "$status" -eq 0 ]
  [ "$output" = 'false|true|0|0' ]
  run env PGPASSWORD=wrong "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username ledger_restore_admin --dbname ledger --command 'SELECT 1;'
  [ "$status" -ne 0 ]

  run "$prepare_script"
  [ "$status" -eq 0 ]
  [ -f "$RESTORE_WINDOW_CREDENTIAL_FILE" ]
  credential="$(< "$RESTORE_WINDOW_CREDENTIAL_FILE")"
  run restore_admin_state
  [ "$status" -eq 0 ]
  [ "$output" = 'true|false|1|0' ]
  run restore_admin_can_mutate "$credential"
  [ "$status" -eq 0 ]

  run "$finalize_script"
  [ "$status" -eq 0 ]
  [ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]
  run restore_admin_state
  [ "$status" -eq 0 ]
  [ "$output" = 'false|true|0|0' ]
  run env PGPASSWORD="$credential" "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username ledger_restore_admin --dbname ledger --command 'SET ROLE ledger_owner; CREATE TABLE post_finalize_mutation (id integer PRIMARY KEY);'
  [ "$status" -ne 0 ]
  run "$finalize_script"
  [ "$status" -eq 0 ]
  run restore_admin_state
  [ "$status" -eq 0 ]
  [ "$output" = 'false|true|0|0' ]
  run grep --fixed-strings '"event":"prepare_started"' "$RESTORE_WINDOW_AUDIT_LOG"
  [ "$status" -eq 0 ]
  run grep --fixed-strings '"event":"prepared"' "$RESTORE_WINDOW_AUDIT_LOG"
  [ "$status" -eq 0 ]
  run grep --fixed-strings '"event":"finalized"' "$RESTORE_WINDOW_AUDIT_LOG"
  [ "$status" -eq 0 ]
}

@test "prepare requires the explicit isolated-target confirmation and verified target system identifier" {
  start_target_cluster

  export RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION=not-confirmed
  if "$prepare_script"; then prepare_status=0; else prepare_status=$?; fi
  [ "$prepare_status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
  [ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]

  export RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION=I_CONFIRM_TARGET_IS_ISOLATED_AND_APPLICATION_STOPPED
  export RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER=999999999999
  export RESTORE_WINDOW_CONFIRM_FINGERPRINT="127.0.0.1:${postgres_port}#${RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER}"
  if "$prepare_script"; then prepare_status=0; else prepare_status=$?; fi
  [ "$prepare_status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
  [ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]
}

@test "prepare rejects a dangling credential symlink without opening authority" {
  start_target_cluster
  export RESTORE_WINDOW_GENERATE_CREDENTIAL=0

  ln -s "$test_root/missing-credential" "$test_root/dangling-credential"
  export RESTORE_WINDOW_CREDENTIAL_FILE="$test_root/dangling-credential"
  if "$prepare_script"; then prepare_status=0; else prepare_status=$?; fi
  [ "$prepare_status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
}

@test "prepare rejects an intermediate credential symlink without opening authority" {
  start_target_cluster
  export RESTORE_WINDOW_GENERATE_CREDENTIAL=0
  mkdir "$test_root/private-credentials"
  chmod 0700 "$test_root/private-credentials"
  printf '%064d\n' 0 > "$test_root/private-credentials/credential"
  chmod 0600 "$test_root/private-credentials/credential"
  ln -s "$test_root/private-credentials" "$test_root/credential-link"
  export RESTORE_WINDOW_CREDENTIAL_FILE="$test_root/credential-link/credential"
  if "$prepare_script"; then prepare_status=0; else prepare_status=$?; fi
  [ "$prepare_status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
}

@test "finalize terminates a concurrent restore-admin session after disabling it" {
  start_target_cluster
  "$prepare_script"
  credential="$(< "$RESTORE_WINDOW_CREDENTIAL_FILE")"
  PGPASSWORD="$credential" "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username ledger_restore_admin --dbname ledger --set ON_ERROR_STOP=1 --command 'SELECT pg_sleep(60);' >"$test_root/concurrent.stdout" 2>"$test_root/concurrent.stderr" &
  concurrent_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ "$(restore_admin_state)" == 'true|false|1|1' ]] && break
    sleep 0.1
  done
  [ "$(restore_admin_state)" = 'true|false|1|1' ]

  "$finalize_script"
  if wait "$concurrent_pid"; then
    concurrent_status=0
  else
    concurrent_status=$?
  fi
  [ "$concurrent_status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
}

@test "existing-volume disable contract terminates a restore-admin session already SET ROLE owner" {
  start_target_cluster
  "$prepare_script"
  credential="$(< "$RESTORE_WINDOW_CREDENTIAL_FILE")"
  PGPASSWORD="$credential" "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username ledger_restore_admin --dbname ledger --set ON_ERROR_STOP=1 --command 'SET ROLE ledger_owner; SELECT pg_sleep(60);' >"$test_root/set-role.stdout" 2>"$test_root/set-role.stderr" &
  set_role_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ "$(restore_admin_state)" == 'true|false|1|1' ]] && break
    sleep 0.1
  done
  [ "$(restore_admin_state)" = 'true|false|1|1' ]

  run env PGPASSWORD=postgres "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username postgres --dbname postgres --set ON_ERROR_STOP=1 --file "$disable_authority_sql"
  [ "$status" -eq 0 ]
  if wait "$set_role_pid"; then
    set_role_status=0
  else
    set_role_status=$?
  fi
  [ "$set_role_status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
}

@test "disable commits NOLOGIN before repeatedly terminating authentication-race sessions" {
  start_target_cluster
  "$prepare_script"
  credential="$(< "$RESTORE_WINDOW_CREDENTIAL_FILE")"
  stop_race="$test_root/stop-auth-race"

  (
    while [[ ! -e "$stop_race" ]]; do
      PGPASSWORD="$credential" "$host_psql" --host 127.0.0.1 --port "$postgres_port" \
        --username ledger_restore_admin --dbname ledger --command 'SELECT pg_sleep(1);' \
        >/dev/null 2>&1 || true
    done
  ) &
  race_pid=$!
  sleep 0.1

  run env PGPASSWORD=postgres "$host_psql" --host 127.0.0.1 --port "$postgres_port" \
    --username postgres --dbname postgres --set ON_ERROR_STOP=1 --file "$disable_authority_sql"
  disable_status="$status"
  : > "$stop_race"
  wait "$race_pid"
  [ "$disable_status" -eq 0 ] || { printf '%s\n' "$output" >&2; return 1; }
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
  first_commit_line="$(grep -n '^COMMIT;' "$disable_authority_sql" | head -1 | cut -d: -f1)"
  first_terminate_line="$(grep -n 'pg_terminate_backend(pid)' "$disable_authority_sql" | head -1 | cut -d: -f1)"
  [ "$first_commit_line" -lt "$first_terminate_line" ]
}

@test "existing-volume convergence waits on one maintenance lock before changing any role" {
  start_target_cluster
  "$prepare_script"
  env PGPASSWORD=postgres "$host_psql" --host 127.0.0.1 --port "$postgres_port" \
    --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
    --command 'SELECT pg_advisory_lock(741263, 2); SELECT pg_sleep(60);' \
    >"$test_root/lock-holder.stdout" 2>"$test_root/lock-holder.stderr" &
  lock_pid=$!
  for _ in {1..50}; do
    lock_count="$(env PGPASSWORD=postgres "$host_psql" --host 127.0.0.1 --port "$postgres_port" \
      --username postgres --dbname postgres --tuples-only --no-align \
      --command "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = 741263 AND objid = 2 AND granted;")"
    [[ "$lock_count" == 1 ]] && break
    sleep 0.1
  done
  [ "$lock_count" = 1 ]
  lock_backend_pid="$(env PGPASSWORD=postgres "$host_psql" --host 127.0.0.1 --port "$postgres_port" \
    --username postgres --dbname postgres --tuples-only --no-align \
    --command "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 741263 AND objid = 2 AND granted;")"
  [[ "$lock_backend_pid" =~ ^[0-9]+$ ]]

  "$role_convergence_script" | env PGPASSWORD=postgres "$host_psql" \
    --host 127.0.0.1 --port "$postgres_port" --username postgres --dbname postgres \
    --set ON_ERROR_STOP=1 \
    --set ledger_owner_password=owner-rotated \
    --set ledger_app_password=app-rotated \
    --set ledger_backup_password=backup-rotated \
    >"$test_root/convergence.stdout" 2>"$test_root/convergence.stderr" &
  convergence_pid=$!
  sleep 0.3
  held_state="$(restore_admin_state)"
  [ "$held_state" = 'true|false|1|0' ] || {
    printf 'held state: %s\n' "$held_state" >&2
    cat "$test_root/lock-holder.stdout" "$test_root/lock-holder.stderr" \
      "$test_root/convergence.stdout" "$test_root/convergence.stderr" >&2
    return 1
  }
  kill -0 "$convergence_pid"

  env PGPASSWORD=postgres "$host_psql" --host 127.0.0.1 --port "$postgres_port" \
    --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
    --command "SELECT pg_terminate_backend($lock_backend_pid);" >/dev/null
  wait "$lock_pid" || true
  wait "$convergence_pid"
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
}

@test "PostgreSQL VALID UNTIL denies the window credential after its short TTL" {
  start_target_cluster
  export RESTORE_WINDOW_TTL_SECONDS=1
  "$prepare_script"
  credential="$(< "$RESTORE_WINDOW_CREDENTIAL_FILE")"
  sleep 2
  run env PGPASSWORD="$credential" "$host_psql" --host 127.0.0.1 --port "$postgres_port" --username ledger_restore_admin --dbname ledger --command 'SELECT 1;'
  [ "$status" -ne 0 ]
  run "$finalize_script"
  [ "$status" -eq 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
}

@test "guarded restore finalizes its authority window when restore setup fails" {
  start_target_cluster
  missing_backup="$test_root/ledger-20260725070000.dump.age"

  run "$guarded_restore_script" "$missing_backup"
  [ "$status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
  [ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]
}
