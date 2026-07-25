#!/usr/bin/env bats

prepare_script="$BATS_TEST_DIRNAME/../postgres/prepare-restore-window.sh"
finalize_script="$BATS_TEST_DIRNAME/../postgres/finalize-restore-window.sh"
guarded_restore_script="$BATS_TEST_DIRNAME/../postgres/run-guarded-restore.sh"

setup_file() {
  bats_require_minimum_version 1.5.0
}

setup() {
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/ledger-restore-window.XXXXXX")"
  host_psql="$(command -v psql)"
  container_id=""
  export RESTORE_WINDOW_AUDIT_LOG="$test_root/restore-window.audit.jsonl"
  export RESTORE_WINDOW_CREDENTIAL_FILE="$test_root/restore-window.credential"
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
  run "$prepare_script"
  [ "$status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
  [ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]

  export RESTORE_WINDOW_ISOLATED_TARGET_CONFIRMATION=I_CONFIRM_TARGET_IS_ISOLATED_AND_APPLICATION_STOPPED
  export RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER=999999999999
  export RESTORE_WINDOW_CONFIRM_FINGERPRINT="127.0.0.1:${postgres_port}#${RESTORE_WINDOW_TARGET_SYSTEM_IDENTIFIER}"
  run "$prepare_script"
  [ "$status" -ne 0 ]
  [ "$(restore_admin_state)" = 'false|true|0|0' ]
  [ ! -e "$RESTORE_WINDOW_CREDENTIAL_FILE" ]
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
