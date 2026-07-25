#!/usr/bin/env bats

backup_script="$BATS_TEST_DIRNAME/../scripts/backup-db.sh"
restore_script="$BATS_TEST_DIRNAME/../scripts/restore-db.sh"

setup_file() {
  bats_require_minimum_version 1.5.0
}

setup() {
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/ledger-backup-restore.XXXXXX")"
  host_path="$PATH"
  host_psql="$(command -v psql)"
  export PATH="$BATS_TEST_DIRNAME/minisign-bin:$BATS_TEST_DIRNAME/postgres16-client-bin:${BACKUP_TEST_TOOLS_DIR:?run infra/tests/bootstrap-backup-tools.sh first}:$PATH"
  container_id=""
  export PGPASSWORD=postgres
  export RESTORE_CONFIRM_HOST=127.0.0.1
  export RESTORE_CONFIRM_PORT=5432
  export RESTORE_CONFIRM_FINGERPRINT=restored@127.0.0.1:5432
  volume_name=""
  foreign_container=""
  minisign -G -W -s "$test_root/backup-signing.key" -p "$test_root/backup-verify.pub" >/dev/null
  export BACKUP_SIGNING_KEY_FILE="$test_root/backup-signing.key"
  export BACKUP_VERIFY_KEY_FILE="$test_root/backup-verify.pub"
}

teardown() {
  if [[ -n "$container_id" ]]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  if [[ -n "$volume_name" ]]; then
    docker volume rm --force "$volume_name" >/dev/null 2>&1 || true
  fi
  if [[ -n "$foreign_container" ]]; then
    docker rm --force "$foreign_container" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_root"
}

start_postgres() {
  container_id="ledger-backup-restore-${BATS_TEST_NUMBER}-$$"
  docker run --detach --rm --name "$container_id" \
    --env POSTGRES_PASSWORD=postgres \
    --env POSTGRES_DB=fixture \
    --publish 127.0.0.1::5432 \
    postgres:16-alpine >/dev/null

  local attempt
  for attempt in {1..30}; do
    if docker exec "$container_id" pg_isready --username postgres --dbname fixture >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  docker exec "$container_id" pg_isready --username postgres --dbname fixture >/dev/null

  export BACKUP_TEST_POSTGRES_CONTAINER="$container_id"
  postgres_port="$(docker port "$container_id" 5432/tcp | sed 's/.*://')"
  export BACKUP_TEST_POSTGRES_HOST_PORT="$postgres_port"
  fixture_url="postgresql://postgres@127.0.0.1:${postgres_port}/fixture"
  fixture_host_url="postgresql://postgres:postgres@127.0.0.1:${postgres_port}/fixture"
  "$host_psql" "$fixture_host_url" --set ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ledger_owner LOGIN PASSWORD 'owner' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ledger_backup LOGIN PASSWORD 'backup';
CREATE ROLE ledger_restore_admin LOGIN PASSWORD 'restore' CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE;
GRANT ledger_owner TO ledger_restore_admin;
CREATE SCHEMA ledger AUTHORIZATION ledger_owner;
SET ROLE ledger_owner;
CREATE TABLE ledger.ledger_fixture (id integer PRIMARY KEY, note text NOT NULL);
INSERT INTO ledger.ledger_fixture (id, note) VALUES (1, 'opening balance'), (2, 'closing balance');
CREATE TABLE ledger.drizzle_migrations (hash text PRIMARY KEY);
INSERT INTO ledger.drizzle_migrations (hash) VALUES ('migration-checksum-a'), ('migration-checksum-b');
RESET ROLE;
GRANT CONNECT ON DATABASE fixture TO ledger_backup;
GRANT USAGE ON SCHEMA ledger TO ledger_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO ledger_backup;
GRANT pg_read_all_data TO ledger_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_owner;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_restore_admin;
SQL
  fixture_system_identifier="$("$host_psql" "$fixture_host_url" --tuples-only --no-align --command 'SELECT (pg_control_system()).system_identifier;')"
  export PGHOST=127.0.0.1 PGPORT="$postgres_port" PGUSER=ledger_restore_admin PGPASSWORD=restore
  export RESTORE_ADMIN_DATABASE=postgres RESTORE_TARGET_DATABASE=restored RESTORE_TARGET_OWNER=ledger_owner
  export RESTORE_CONFIRM_DATABASE=restored RESTORE_CONFIRM_HOST=127.0.0.1 RESTORE_CONFIRM_PORT="$postgres_port"
  export RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$fixture_system_identifier"
  export RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$fixture_system_identifier"
  export RESTORE_CONFIRM_FINGERPRINT="restored@127.0.0.1:${postgres_port}#${fixture_system_identifier}"
  export AGE_IDENTITY_FILE="$test_root/identity.txt"
}

backup_fixture() {
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  recipient="$(age-keygen -y "$test_root/identity.txt")"
  env -u DATABASE_URL PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_SIGNING_KEY_FILE="$test_root/backup-signing.key" \
    BACKUP_TIMESTAMP=20260725070000 \
    "$backup_script"
  backup_file="$backup_dir/ledger-20260725070000.dump.age"
}

restore_fixture_into_new_target() {
  local target_database="$1"
  local target_owner="${2:-ledger_owner}"
  env -u DATABASE_URL \
    PGHOST=127.0.0.1 PGPORT="$postgres_port" PGUSER=ledger_restore_admin PGPASSWORD=restore \
    RESTORE_ADMIN_DATABASE=postgres \
    RESTORE_TARGET_DATABASE="$target_database" RESTORE_TARGET_OWNER="$target_owner" \
    RESTORE_CONFIRM_DATABASE="$target_database" RESTORE_CONFIRM_HOST=127.0.0.1 \
    RESTORE_CONFIRM_PORT="$postgres_port" \
    RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    RESTORE_CONFIRM_FINGERPRINT="${target_database}@127.0.0.1:${postgres_port}#${fixture_system_identifier}" \
    AGE_IDENTITY_FILE="$test_root/identity.txt" \
    BACKUP_VERIFY_KEY_FILE="$test_root/backup-verify.pub" \
    "$restore_script" "$backup_file"
}

@test "backup and restore scripts exist and reject unsafe execution" {
  [ -x "$BATS_TEST_DIRNAME/../scripts/backup-db.sh" ]
  [ -x "$BATS_TEST_DIRNAME/../scripts/restore-db.sh" ]
}

@test "tool bootstrap rejects traversal and symlinked install paths before download" {
  bootstrap_script="$BATS_TEST_DIRNAME/bootstrap-backup-tools.sh"
  repo_tmp="$BATS_TEST_DIRNAME/../../.tmp"
  link_path="$repo_tmp/bootstrap-link-$BATS_TEST_NUMBER-$$"

  run env BACKUP_TEST_TOOL_DIR="$repo_tmp/../outside" bash "$bootstrap_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'traversal'* ]]
  ln -s "$test_root" "$link_path"
  run env BACKUP_TEST_TOOL_DIR="$link_path" bash "$bootstrap_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'must not be symlinks'* ]]
  rm -f "$link_path"

  intermediate_link="$repo_tmp/bootstrap-parent-$BATS_TEST_NUMBER-$$"
  ln -s "$test_root" "$intermediate_link"
  run env BACKUP_TEST_TOOL_DIR="$intermediate_link/tools" bash "$bootstrap_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'must not be symlinks'* ]]
  rm -f "$intermediate_link"
}

@test "PostgreSQL 16 fixture adapters map the published host port to the container port" {
  run bash -c 'source "$1"; map_fixture_dbname_arg "$2" "$3"' _ \
    "$BATS_TEST_DIRNAME/postgres16-client-bin/uri-port.sh" \
    '53916' '--dbname=postgresql://postgres@127.0.0.1:53916/restored'
  [ "$status" -eq 0 ]
  [ "$output" = '--dbname=postgresql://postgres@127.0.0.1:5432/restored' ]
}

@test "backup rejects an option-injection recipient before connecting" {
  run env DATABASE_URL='postgresql://postgres@127.0.0.1:5432/fixture' \
    BACKUP_DIR="$test_root" \
    BACKUP_AGE_RECIPIENT='--identity=/tmp/stolen-key' \
    "$backup_script"

  [ "$status" -ne 0 ]
  [[ "$output" == *'invalid BACKUP_AGE_RECIPIENT'* ]]
}

@test "backup rejects a URI options injection before connecting" {
  run env DATABASE_URL='postgresql://postgres@127.0.0.1:5432/fixture?options=-c%20search_path%3Dpublic' \
    BACKUP_DIR="$test_root" \
    BACKUP_AGE_RECIPIENT='age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' \
    "$backup_script"

  [ "$status" -ne 0 ]
  [[ "$output" == *'DATABASE_URL URI query'* ]]
}

@test "backup rejects decoded and malformed URI query option mutations" {
  local uri
  for uri in \
    'postgresql://postgres@127.0.0.1:5432/fixture?opt%69ons=-c' \
    'postgresql://postgres@127.0.0.1:5432/fixture?opt%2569ons=-c' \
    'postgresql://postgres@127.0.0.1:5432/fixture?OPTIONS=-c' \
    'postgresql://postgres@127.0.0.1:5432/fixture?sslmode=require&sslmode=disable' \
    'postgresql://postgres@127.0.0.1:5432/fixture?sslmode=%ZZ'; do
    run env DATABASE_URL="$uri" BACKUP_DIR="$test_root" \
      BACKUP_AGE_RECIPIENT='age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' \
      "$backup_script"
    [ "$status" -ne 0 ]
    [[ "$output" == *'DATABASE_URL URI query'* ]]
  done
}

@test "backup rejects URI userinfo and secret query parameters" {
  local uri
  for uri in \
    'postgresql://backup:secret@127.0.0.1:5432/fixture' \
    'postgresql://backup@127.0.0.1:5432/fixture?sslpassword=secret'; do
    run env DATABASE_URL="$uri" BACKUP_DIR="$test_root" \
      BACKUP_AGE_RECIPIENT='age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' \
      "$backup_script"
    [ "$status" -ne 0 ]
    [[ "$output" == *'DATABASE_URL'* ]]
  done
}

@test "libpq URI validation preserves IPv6 socket and percent-encoded forms" {
  run env DATABASE_URL='postgresql://backup@[::1]:5432/ledger%2Drestore?sslmode=require' \
    bash -c 'source "$1"; prepare_database_connection; printf "%s" "${DATABASE_CLIENT_ARGS[0]}"' _ "$BATS_TEST_DIRNAME/../scripts/backup-common.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'[::1]:5432/ledger%2Drestore?sslmode=require'* ]]

  run env DATABASE_URL='postgresql:///ledger%5Frestore?sslmode=disable' \
    bash -c 'source "$1"; prepare_database_connection; printf "%s" "${DATABASE_CLIENT_ARGS[0]}"' _ "$BATS_TEST_DIRNAME/../scripts/backup-common.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'postgresql:///ledger%5Frestore?sslmode=disable'* ]]
}

@test "Unix-socket restore identity uses the server's single normalized socket directory" {
  start_postgres
  run env -u PGHOST -u PGPORT DATABASE_URL='postgresql://postgres@/fixture' \
    bash -c 'source "$1"; prepare_database_connection; effective_target_identity' _ "$BATS_TEST_DIRNAME/../scripts/backup-common.sh"
  [ "$status" -eq 0 ]
  [ "$output" = $'fixture\tunix:/var/run/postgresql\t5432' ]
}

@test "discrete libpq variables preserve a reserved password without a URI" {
  start_postgres
  reserved_password='p@ss:word?with/slash'
  "$host_psql" "$fixture_host_url" --set ON_ERROR_STOP=1 --command "ALTER ROLE postgres PASSWORD '$reserved_password';"
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run env PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=fixture PGUSER=postgres PGPASSWORD="$reserved_password" \
    BACKUP_DIR="$backup_dir" BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070005 "$backup_script"
  [ "$status" -eq 0 ]
  [ -s "$backup_dir/ledger-20260725070005.dump.age" ]
}

@test "ledger_backup can read the real ledger schema but cannot mutate it" {
  start_postgres
  backup_role_url="postgresql://ledger_backup:backup@127.0.0.1:${postgres_port}/fixture"

  run "$host_psql" "$backup_role_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
  run "$host_psql" "$backup_role_url" --set ON_ERROR_STOP=1 --command "INSERT INTO ledger.ledger_fixture VALUES (3, 'forbidden');"
  [ "$status" -ne 0 ]
}

@test "backup rejects a valid DATABASE_URL and requires discrete pinned libpq settings" {
  start_postgres
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run env DATABASE_URL="postgresql://ledger_backup@127.0.0.1:${postgres_port}/fixture" PGPASSWORD=backup \
    BACKUP_DIR="$test_root/backups" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725065959 \
    "$backup_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'DATABASE_URL is not permitted for backup'* ]]
}

@test "real PostgreSQL fixture backs up encrypted without a plaintext dump" {
  start_postgres
  backup_fixture

  [ -s "$backup_file" ]
  [ -s "$backup_file.sha256" ]
  [ ! -e "${backup_file%.age}" ]
  run bash -c '"$1" --decrypt --identity "$2" < "$3" | docker exec -i "$4" pg_restore --list' _ age "$test_root/identity.txt" "$backup_file" "$container_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'ledger_fixture'* ]]
}

@test "backup publishes a signed versioned manifest bound to the source cluster" {
  start_postgres
  backup_fixture

  manifest="$backup_file.manifest"
  signature="$manifest.minisig"
  [ -s "$manifest" ]
  [ -s "$signature" ]
  run minisign -Vm "$manifest" -p "$test_root/backup-verify.pub" -x "$signature"
  [ "$status" -eq 0 ]
  run grep --fixed-strings "basename=$(basename "$backup_file")" "$manifest"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'format_version=1' "$manifest"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'source_system_identifier=' "$manifest"
  [ "$status" -eq 0 ]
}

@test "backup holds the shared maintenance advisory lock across its dump and provenance checks" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  ready_file="$test_root/backup-lock-ready"
  recipient="$(age-keygen -y "$test_root/identity.txt")"

  BACKUP_TEST_DELAY_PG_DUMP=2 BACKUP_TEST_PG_DUMP_READY="$ready_file" \
    env -u DATABASE_URL PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_TIMESTAMP=20260725070010 "$backup_script" >"$test_root/backup-lock.stdout" 2>"$test_root/backup-lock.stderr" &
  backup_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -f "$ready_file" ]] && break
    sleep 0.1
  done
  [ -f "$ready_file" ]
  run "$host_psql" "${fixture_host_url%/fixture}/postgres" --tuples-only --no-align --command "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = 741263 AND objid = 2 AND mode = 'ShareLock' AND granted;"
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
  run "$host_psql" "${fixture_host_url%/fixture}/postgres" --tuples-only --no-align --command 'SELECT pg_try_advisory_lock(741263, 2);'
  [ "$status" -eq 0 ]
  [ "$output" = 'f' ]
  wait "$backup_pid"
  [ -s "$backup_dir/ledger-20260725070010.dump.age" ]
}

@test "backup refuses publication when its post-dump system identifier changes" {
  start_postgres
  foreign_container="ledger-backup-switch-${BATS_TEST_NUMBER}-$$"
  docker run --detach --rm --name "$foreign_container" \
    --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=fixture \
    --publish 127.0.0.1::5432 postgres:16-alpine >/dev/null
  local attempt
  for attempt in {1..30}; do
    docker exec "$foreign_container" pg_isready --username postgres --dbname fixture >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$foreign_container" pg_isready --username postgres --dbname fixture >/dev/null
  docker exec -i "$foreign_container" psql --username postgres --dbname fixture --set ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ledger_backup LOGIN PASSWORD 'backup';
GRANT CONNECT ON DATABASE fixture TO ledger_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_backup;
SQL

  backup_dir="$test_root/backups"
  mkdir "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  run env -u DATABASE_URL PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" \
    BACKUP_TEST_SWITCH_SYSTEM_IDENTIFIER=1 BACKUP_TEST_SYSTEM_ID_COUNTER="$test_root/system-id-count" \
    BACKUP_TEST_SWITCH_CONTAINER="$foreign_container" BACKUP_TEST_FSYNC_LOG="$test_root/system-switch-fsync.log" \
    PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070011 "$backup_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'system identifier changed during backup'* ]]
  [ ! -e "$backup_dir/ledger-20260725070011.dump.age" ]
  [ ! -e "$backup_dir/ledger-20260725070011.dump.age.manifest" ]
}

@test "restore drill recreates exact tables and migration checksum rows" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  restore_fixture_into_new_target restored

  run "$host_psql" "$target_host_url" --tuples-only --no-align --command "SELECT count(*) FROM pg_tables WHERE schemaname = 'ledger';"
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command "SELECT string_agg(hash, ',' ORDER BY hash) FROM ledger.drizzle_migrations;"
  [ "$status" -eq 0 ]
  [ "$output" = 'migration-checksum-a,migration-checksum-b' ]
}

@test "restore-admin creates the target while restored objects remain ledger-owned" {
  start_postgres
  backup_fixture
  target_host_url="postgresql://postgres:postgres@127.0.0.1:${postgres_port}/restored"
  run "$host_psql" "$fixture_host_url" --tuples-only --no-align --command "SELECT rolcreatedb::text || '|' || rolsuper::text || '|' || rolcreaterole::text || '|' || rolinherit::text FROM pg_roles WHERE rolname = 'ledger_restore_admin';"
  [ "$status" -eq 0 ]
  [ "$output" = 'true|false|false|false' ]
  run "$host_psql" "$fixture_host_url" --tuples-only --no-align --command "SELECT rolcreatedb::text || '|' || rolsuper::text || '|' || rolcreaterole::text FROM pg_roles WHERE rolname = 'ledger_owner';"
  [ "$status" -eq 0 ]
  [ "$output" = 'false|false|false' ]
  run restore_fixture_into_new_target restored ledger_owner
  [ "$status" -eq 0 ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command "SELECT tableowner FROM pg_tables WHERE schemaname = 'ledger' AND tablename = 'ledger_fixture';"
  [ "$status" -eq 0 ]
  [ "$output" = 'ledger_owner' ]
}

@test "restore refuses an already-existing target without changing it" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  "$host_psql" "${fixture_host_url%/fixture}/postgres" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'
  "$host_psql" "$target_host_url" --set ON_ERROR_STOP=1 --command 'CREATE TABLE keep_me (id integer PRIMARY KEY); INSERT INTO keep_me VALUES (1);'

  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'restore target database must be absent'* ]]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM keep_me;'
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
}

@test "restore refuses an otherwise relation-free target with a user schema function and enum" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  "$host_psql" "${fixture_host_url%/fixture}/postgres" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'
  "$host_psql" "$target_host_url" --set ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA adversary;
CREATE TYPE public.restore_guard_enum AS ENUM ('blocked');
CREATE FUNCTION public.restore_guard_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SQL

  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'restore target database must be absent'* ]]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT public.restore_guard_function();'
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
}

@test "restore refuses a target containing only a PostgreSQL large object" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  "$host_psql" "${fixture_host_url%/fixture}/postgres" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'
  "$host_psql" "$target_host_url" --set ON_ERROR_STOP=1 --command 'SELECT lo_create(424242);'

  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'restore target database must be absent'* ]]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM pg_largeobject_metadata WHERE oid = 424242;'
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
}

@test "restore requires an exact host port and target fingerprint confirmation" {
  start_postgres
  backup_fixture

  run env -u RESTORE_CONFIRM_HOST -u RESTORE_CONFIRM_PORT -u RESTORE_CONFIRM_FINGERPRINT \
    "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'RESTORE_CONFIRM_HOST is required'* ]]
}

@test "restore requires independently exact signed source and target system identifier confirmations" {
  start_postgres
  backup_fixture
  admin_url="${fixture_host_url%/fixture}/postgres"

  run env RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER=0 "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'signed backup provenance'* ]]
  run "$host_psql" "$admin_url" --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = 'restored' OR datname LIKE 'ledger_restore_stage_%';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]

  run env RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER=0 "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'resolved target cluster'* ]]
  run "$host_psql" "$admin_url" --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = 'restored' OR datname LIKE 'ledger_restore_stage_%';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
}

@test "restore accepts signed source provenance on an independently confirmed replacement cluster" {
  start_postgres
  backup_fixture
  foreign_container="ledger-restore-foreign-${BATS_TEST_NUMBER}-$$"
  docker run --detach --rm --name "$foreign_container" \
    --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
    --publish 127.0.0.1::5432 postgres:16-alpine >/dev/null
  local attempt
  for attempt in {1..30}; do
    docker exec "$foreign_container" pg_isready --username postgres --dbname postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$foreign_container" pg_isready --username postgres --dbname postgres >/dev/null
  foreign_port="$(docker port "$foreign_container" 5432/tcp | sed 's/.*://')"
  foreign_system_identifier="$(docker exec "$foreign_container" psql --username postgres --dbname postgres --tuples-only --no-align --command 'SELECT (pg_control_system()).system_identifier;')"
  docker exec -i "$foreign_container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ledger_owner LOGIN PASSWORD 'owner' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ledger_restore_admin LOGIN PASSWORD 'restore' CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE;
GRANT ledger_owner TO ledger_restore_admin;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_owner;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_restore_admin;
SQL

  run env PATH="$BATS_TEST_DIRNAME/minisign-bin:$BATS_TEST_DIRNAME/postgres16-client-bin:${BACKUP_TEST_TOOLS_DIR}:$host_path" \
    BACKUP_TEST_POSTGRES_CONTAINER="$foreign_container" BACKUP_TEST_POSTGRES_HOST_PORT="$foreign_port" \
    PGHOST=127.0.0.1 PGPORT="$foreign_port" PGUSER=ledger_restore_admin PGPASSWORD=restore \
    RESTORE_ADMIN_DATABASE=postgres RESTORE_TARGET_DATABASE=replacement_restore RESTORE_TARGET_OWNER=ledger_owner \
    RESTORE_CONFIRM_DATABASE=replacement_restore RESTORE_CONFIRM_HOST=127.0.0.1 \
    RESTORE_CONFIRM_PORT="$foreign_port" \
    RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$foreign_system_identifier" \
    RESTORE_CONFIRM_FINGERPRINT="replacement_restore@127.0.0.1:${foreign_port}#${foreign_system_identifier}" \
    AGE_IDENTITY_FILE="$test_root/identity.txt" BACKUP_VERIFY_KEY_FILE="$test_root/backup-verify.pub" \
    "$restore_script" "$backup_file"
  [ "$status" -eq 0 ]
  run docker exec "$foreign_container" psql --username postgres --dbname replacement_restore --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "a requested target that appears before promotion is untouched and leaves its restored staging database quarantined" {
  start_postgres
  backup_fixture
  ready_file="$test_root/staging-ready"
  admin_url="${fixture_host_url%/fixture}/postgres"

  PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" RESTORE_TEST_REAL_AGE="$(command -v age)" \
    RESTORE_TEST_STAGE_READY="$ready_file" RESTORE_TEST_STAGE_DELAY=2 \
    "$restore_script" "$backup_file" >"$test_root/promotion-race.stdout" 2>"$test_root/promotion-race.stderr" &
  restore_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -f "$ready_file" ]] && break
    sleep 0.1
  done
  [ -f "$ready_file" ]
  "$host_psql" "$admin_url" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'
  "$host_psql" "${fixture_host_url%/fixture}/restored" --set ON_ERROR_STOP=1 --command 'CREATE TABLE keep_me (id integer PRIMARY KEY); INSERT INTO keep_me VALUES (1);'
  if wait "$restore_pid"; then
    restore_status=0
  else
    restore_status=$?
  fi
  [ "$restore_status" -ne 0 ]

  quarantine_line="$(grep --fixed-strings 'quarantined staging database:' "$test_root/promotion-race.stderr")"
  staging_database="$(printf '%s\n' "$quarantine_line" | sed -n 's/.*name=\([a-z0-9_]*\) oid=.*/\1/p')"
  [[ "$staging_database" =~ ^ledger_restore_stage_[a-f0-9]{32}$ ]]
  run "$host_psql" "${fixture_host_url%/fixture}/restored" --tuples-only --no-align --command 'SELECT count(*) FROM keep_me;'
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
  run "$host_psql" "${fixture_host_url%/fixture}/$staging_database" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "restore holds the exclusive maintenance advisory lock through staging restore and promotion" {
  start_postgres
  backup_fixture
  ready_file="$test_root/maintenance-lock-ready"
  admin_url="${fixture_host_url%/fixture}/postgres"

  PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" RESTORE_TEST_REAL_AGE="$(command -v age)" \
    RESTORE_TEST_STAGE_READY="$ready_file" RESTORE_TEST_STAGE_DELAY=2 \
    "$restore_script" "$backup_file" >"$test_root/maintenance-lock.stdout" 2>"$test_root/maintenance-lock.stderr" &
  restore_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -f "$ready_file" ]] && break
    sleep 0.1
  done
  [ -f "$ready_file" ]
  run "$host_psql" "$admin_url" --tuples-only --no-align --command 'SELECT pg_try_advisory_lock(741263, 2);'
  [ "$status" -eq 0 ]
  [ "$output" = 'f' ]
  wait "$restore_pid"
  run "$host_psql" "${fixture_host_url%/fixture}/restored" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "a cooperating replacement attempt blocks on the maintenance lock and cannot replace the promoted target" {
  start_postgres
  backup_fixture
  ready_file="$test_root/cooperating-race-ready"
  adversary_started="$test_root/cooperating-race-adversary-started"
  admin_url="${fixture_host_url%/fixture}/postgres"

  PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" RESTORE_TEST_REAL_AGE="$(command -v age)" \
    RESTORE_TEST_STAGE_READY="$ready_file" RESTORE_TEST_STAGE_DELAY=2 \
    "$restore_script" "$backup_file" >"$test_root/cooperating-race.stdout" 2>"$test_root/cooperating-race.stderr" &
  restore_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -f "$ready_file" ]] && break
    sleep 0.1
  done
  [ -f "$ready_file" ]

  (
    : > "$adversary_started"
    "$host_psql" "$admin_url" --set ON_ERROR_STOP=1 --command 'SELECT pg_advisory_lock(741263, 2); CREATE DATABASE restored;'
  ) >"$test_root/cooperating-race-adversary.stdout" 2>"$test_root/cooperating-race-adversary.stderr" &
  adversary_pid=$!
  for attempt in {1..30}; do
    [[ -f "$adversary_started" ]] && break
    sleep 0.1
  done
  [ -f "$adversary_started" ]
  wait "$restore_pid"
  if wait "$adversary_pid"; then
    adversary_status=0
  else
    adversary_status=$?
  fi
  [ "$adversary_status" -ne 0 ]
  run "$host_psql" "${fixture_host_url%/fixture}/restored" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "private template0 staging denies an unrelated backup role injection before restore" {
  start_postgres
  backup_fixture
  ready_file="$test_root/stage-acl-ready"
  admin_url="${fixture_host_url%/fixture}/postgres"

  PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" RESTORE_TEST_REAL_AGE="$(command -v age)" \
    RESTORE_TEST_STAGE_READY="$ready_file" RESTORE_TEST_STAGE_DELAY=2 \
    "$restore_script" "$backup_file" >"$test_root/stage-acl.stdout" 2>"$test_root/stage-acl.stderr" &
  restore_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -f "$ready_file" ]] && break
    sleep 0.1
  done
  [ -f "$ready_file" ]
  staging_database="$("$host_psql" "$admin_url" --tuples-only --no-align --command "SELECT datname FROM pg_database WHERE datname LIKE 'ledger_restore_stage_%';")"
  [[ "$staging_database" =~ ^ledger_restore_stage_[a-f0-9]{32}$ ]]
  run "$host_psql" "postgresql://ledger_backup:backup@127.0.0.1:${postgres_port}/${staging_database}" --set ON_ERROR_STOP=1 --command 'CREATE CAST (text AS integer) WITH INOUT AS ASSIGNMENT;'
  [ "$status" -ne 0 ]
  [[ "$output" == *'permission denied for database'* ]]
  run "$host_psql" "postgresql://ledger_backup:backup@127.0.0.1:${postgres_port}/${staging_database}" --set ON_ERROR_STOP=1 --command "CREATE EVENT TRIGGER untrusted_stage_trigger ON ddl_command_start EXECUTE FUNCTION pg_catalog.pg_event_trigger_ddl_commands();"
  [ "$status" -ne 0 ]
  [[ "$output" == *'permission denied for database'* ]]
  wait "$restore_pid"
  run "$host_psql" "${fixture_host_url%/fixture}/restored" --tuples-only --no-align --command "SELECT has_schema_privilege('ledger_backup', 'public', 'CREATE');"
  [ "$status" -eq 0 ]
  [ "$output" = 'f' ]
}

@test "an unrelated dormant subscription does not influence a fresh target restore" {
  start_postgres
  backup_fixture
  admin_url="${fixture_host_url%/fixture}/postgres"
  "$host_psql" "$admin_url" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE unrelated_subscription;'
  "$host_psql" "${fixture_host_url%/fixture}/unrelated_subscription" --set ON_ERROR_STOP=1 --command "CREATE SUBSCRIPTION unrelated_sub CONNECTION 'host=127.0.0.1 port=1 dbname=none user=none' PUBLICATION missing_publication WITH (connect = false, create_slot = false, enabled = false);"

  restore_fixture_into_new_target restored
  run "$host_psql" "${fixture_host_url%/fixture}/restored" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "restore rejects a target cluster switch between staging creation and its pinned restore session" {
  start_postgres
  backup_fixture
  foreign_container="ledger-restore-switch-${BATS_TEST_NUMBER}-$$"
  docker run --detach --rm --name "$foreign_container" \
    --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=postgres \
    --publish 127.0.0.1::5432 postgres:16-alpine >/dev/null
  local attempt
  for attempt in {1..30}; do
    docker exec "$foreign_container" pg_isready --username postgres --dbname postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$foreign_container" pg_isready --username postgres --dbname postgres >/dev/null
  foreign_system_identifier="$(docker exec "$foreign_container" psql --username postgres --dbname postgres --tuples-only --no-align --command 'SELECT (pg_control_system()).system_identifier;')"
  [ "$foreign_system_identifier" != "$fixture_system_identifier" ]
  docker exec -i "$foreign_container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ledger_owner LOGIN PASSWORD 'owner' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ledger_restore_admin LOGIN PASSWORD 'restore' CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE;
GRANT ledger_owner TO ledger_restore_admin;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_owner;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_restore_admin;
SQL

  switch_log="$test_root/target-switch.log"
  run env PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" \
    RESTORE_TEST_REAL_PSQL="$BATS_TEST_DIRNAME/postgres16-client-bin/psql" \
    RESTORE_TEST_SWITCH_TARGET_SESSION=1 RESTORE_TEST_SWITCH_CONTAINER="$foreign_container" \
    RESTORE_TEST_SWITCH_LOG="$switch_log" \
    "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'quarantined staging database:'* ]]
  staging_database="$(sed -n 's/^name=\([a-z0-9_]*\)$/\1/p' "$switch_log")"
  [[ "$staging_database" =~ ^ledger_restore_stage_[a-f0-9]{32}$ ]]
  run "$host_psql" "${fixture_host_url%/fixture}/postgres" --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = 'restored';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
  run "$host_psql" "${fixture_host_url%/fixture}/$staging_database" --tuples-only --no-align --command "SELECT count(*) FROM pg_tables WHERE schemaname = 'ledger';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
  run docker exec "$foreign_container" psql --username postgres --dbname postgres --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = '$staging_database';"
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
}

@test "late restore SQL failure rolls back and leaves only an empty staging database quarantined" {
  start_postgres
  "$host_psql" "$fixture_host_url" --set ON_ERROR_STOP=1 --command "CREATE FUNCTION ledger.late_restore_failure(integer) RETURNS integer LANGUAGE internal IMMUTABLE AS 'int4in';"
  backup_fixture

  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  restore_output="$output"
  run "$host_psql" "${fixture_host_url%/fixture}/postgres" --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = 'restored';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
  quarantine_line="$(printf '%s\n' "$restore_output" | grep --fixed-strings 'quarantined staging database:' || true)"
  [[ "$quarantine_line" == *'oid='* ]]
  staging_database="$(printf '%s\n' "$quarantine_line" | sed -n 's/.*name=\([a-z0-9_]*\) oid=.*/\1/p')"
  [[ "$staging_database" =~ ^ledger_restore_stage_[a-f0-9]{32}$ ]]
  run "$host_psql" "${fixture_host_url%/fixture}/$staging_database" --tuples-only --no-align --command "SELECT count(*) FROM pg_tables WHERE schemaname = 'ledger';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
}

@test "restore stages inputs in a private directory with owner-only files and cleans it" {
  start_postgres
  backup_fixture
  mkdir "$test_root/restore-tmp"

  TMPDIR="$test_root/restore-tmp" PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" RESTORE_TEST_SHA_DELAY=2 \
    "$restore_script" "$backup_file" >"$test_root/restore.stdout" 2>"$test_root/restore.stderr" &
  restore_pid=$!
  local attempt stage
  for attempt in {1..30}; do
    stage="$(find "$test_root/restore-tmp" -type d -name 'ledger-restore.*' | head -n 1)"
    [[ -n "$stage" && -f "$stage/$(basename "$backup_file")" && -f "$stage/$(basename "$backup_file").sha256" ]] && break
    sleep 0.1
  done
  [ -n "$stage" ]
  stage_mode="$(stat -f '%Lp' "$stage" 2>/dev/null || stat -c '%a' "$stage")"
  backup_mode="$(stat -f '%Lp' "$stage/$(basename "$backup_file")" 2>/dev/null || stat -c '%a' "$stage/$(basename "$backup_file")")"
  checksum_mode="$(stat -f '%Lp' "$stage/$(basename "$backup_file").sha256" 2>/dev/null || stat -c '%a' "$stage/$(basename "$backup_file").sha256")"
  [ "$stage_mode" = '700' ]
  [ "$backup_mode" = '600' ]
  [ "$checksum_mode" = '600' ]
  [ ! -e "$stage/identity.txt" ]
  wait "$restore_pid"
  [ ! -e "$stage" ]
}

@test "restore consumes private staged bytes when the source pair is replaced during decryption" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  ready_file="$test_root/staged-ready"

  PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" RESTORE_TEST_REAL_AGE="$(command -v age)" \
    RESTORE_TEST_STAGE_READY="$ready_file" RESTORE_TEST_STAGE_DELAY=2 \
    "$restore_script" "$backup_file" >"$test_root/race.stdout" 2>"$test_root/race.stderr" &
  restore_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -f "$ready_file" ]] && break
    sleep 0.1
  done
  [ -f "$ready_file" ]
  printf 'replacement ciphertext' > "$backup_file"
  printf '%064d  %s\n' 0 "$(basename "$backup_file")" > "$backup_file.sha256"
  wait "$restore_pid"
  [ "$?" -eq 0 ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "restore rejects a symlinked backup before it touches the target" {
  start_postgres
  backup_fixture
  link_file="$test_root/ledger-20260725070000.dump.age"
  ln -s "$backup_file" "$link_file"
  ln -s "$backup_file.sha256" "$link_file.sha256"

  run "$restore_script" "$link_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'regular non-symlink'* ]]
}

@test "restore rejects ciphertext tampering and a mismatched confirmation" {
  start_postgres
  backup_fixture
  run env RESTORE_CONFIRM_DATABASE=fixture "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'does not exactly match target database'* ]]

  tampered_file="$test_root/tampered.dump.age"
  cp "$backup_file" "$tampered_file"
  cp "$backup_file.sha256" "$tampered_file.sha256"
  cp "$backup_file.manifest" "$tampered_file.manifest"
  cp "$backup_file.manifest.minisig" "$tampered_file.manifest.minisig"
  printf 'tampered' >> "$tampered_file"
  run "$restore_script" "$tampered_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'checksum verification failed'* ]]

  valid_checksum="$(shasum --algorithm 256 "$backup_file" | awk '{print $1}')"
  printf '%s  %s unexpected-field\n' "$valid_checksum" "$(basename "$backup_file")" > "$backup_file.sha256"
  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'checksum metadata is invalid'* ]]

  printf '%064d  %s\n' 0 "$(basename "$backup_file")" > "$backup_file.sha256"
  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'checksum verification failed'* ]]
  run "$host_psql" "${fixture_host_url%/fixture}/postgres" --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = 'restored';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
}

@test "restore rejects manifest signature and verification-key rotation tampering before staging" {
  start_postgres
  backup_fixture
  admin_url="${fixture_host_url%/fixture}/postgres"
  cp "$backup_file.manifest" "$test_root/manifest.original"
  cp "$backup_file.manifest.minisig" "$test_root/signature.original"

  sed 's/^created_at=.*/created_at=2026-07-25T08:00:00Z/' "$test_root/manifest.original" > "$backup_file.manifest"
  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  cp "$test_root/manifest.original" "$backup_file.manifest"

  sed '2s/./A/' "$test_root/signature.original" > "$backup_file.manifest.minisig"
  run "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  cp "$test_root/signature.original" "$backup_file.manifest.minisig"

  minisign -G -W -s "$test_root/retired-signing.key" -p "$test_root/retired-verify.pub" >/dev/null
  run env BACKUP_VERIFY_KEY_FILE="$test_root/retired-verify.pub" "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  run "$host_psql" "$admin_url" --tuples-only --no-align --command "SELECT count(*) FROM pg_database WHERE datname = 'restored' OR datname LIKE 'ledger_restore_stage_%';"
  [ "$status" -eq 0 ]
  [ "$output" = '0' ]
}

@test "backup image has a UTC nightly schedule and no restore identity" {
  [ -f "$BATS_TEST_DIRNAME/../backup/Dockerfile" ]
  [ -f "$BATS_TEST_DIRNAME/../backup/crontab" ]
  run grep --fixed-strings '0 7 * * *' "$BATS_TEST_DIRNAME/../backup/crontab"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'AGE_IDENTITY_FILE' "$BATS_TEST_DIRNAME/../backup/Dockerfile"
  [ "$status" -ne 0 ]
}

@test "cron wrapper preserves a failed Docker backup exit through logger" {
  cron_wrapper="$BATS_TEST_DIRNAME/../backup/run-cron.sh"
  mkdir "$test_root/cron-bin"
  mkdir "$test_root/cron-backups"
  : > "$test_root/cron-signing.key"
  chmod 0600 "$test_root/cron-signing.key"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$test_root/cron-bin/docker"
  printf '%s\n' '#!/usr/bin/env bash' 'cat >/dev/null' > "$test_root/cron-bin/logger"
  chmod 0700 "$test_root/cron-bin/docker" "$test_root/cron-bin/logger"
  run env PATH="$test_root/cron-bin:$PATH" BACKUP_SIGNING_KEY_FILE="$test_root/cron-signing.key" BACKUP_OUTPUT_DIR="$test_root/cron-backups" "$cron_wrapper"
  [ "$status" -eq 42 ]
  printf '%s\n' '#!/usr/bin/env bash' 'printf successful-backup' > "$test_root/cron-bin/docker"
  run env PATH="$test_root/cron-bin:$PATH" BACKUP_SIGNING_KEY_FILE="$test_root/cron-signing.key" BACKUP_OUTPUT_DIR="$test_root/cron-backups" "$cron_wrapper"
  [ "$status" -eq 0 ]
}

@test "backup build context excludes restore identities" {
  [ -f "$BATS_TEST_DIRNAME/../.dockerignore" ]
  run grep --fixed-strings '**/*identity*' "$BATS_TEST_DIRNAME/../.dockerignore"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'scripts/backup-common.sh' "$BATS_TEST_DIRNAME/../backup/Dockerfile"
  [ "$status" -eq 0 ]
}

@test "built backup image provides a portable SHA-256 implementation" {
  run docker run --rm --entrypoint sha256sum ledger-backup:local --version
  [ "$status" -eq 0 ]
}

@test "built image performs a real libpq backup and guarded restore" {
  start_postgres
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  recipient="$(age-keygen -y "$test_root/identity.txt")"
  image_backup_dir="$test_root/image-backups"
  mkdir "$image_backup_dir"
  target_host_url="${fixture_host_url%/fixture}/restored"

  run docker run --rm --user "$(id -u):$(id -g)" --network "container:$container_id" \
    --mount "type=bind,src=$image_backup_dir,dst=/backups" \
    --mount "type=bind,src=$test_root/backup-signing.key,dst=/run/backup/signing.key,readonly" \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGDATABASE=fixture \
    --env PGUSER=postgres --env PGPASSWORD=postgres \
    --env BACKUP_DIR=/backups --env BACKUP_AGE_RECIPIENT="$recipient" \
    --env BACKUP_SIGNING_KEY_FILE=/run/backup/signing.key \
    --env BACKUP_TIMESTAMP=20260725070004 ledger-backup:local
  [ "$status" -eq 0 ]
  run docker run --rm --mount "type=bind,src=$image_backup_dir,dst=/backups,readonly" \
    --entrypoint sha256sum ledger-backup:local /backups/ledger-20260725070004.dump.age
  [ "$status" -eq 0 ]

  run docker run --rm --user "$(id -u):$(id -g)" --network "container:$container_id" \
    --mount "type=bind,src=$image_backup_dir,dst=/backups,readonly" \
    --mount "type=bind,src=$test_root/identity.txt,dst=/run/restore/identity.txt,readonly" \
    --mount "type=bind,src=$test_root/backup-verify.pub,dst=/run/restore/verify.pub,readonly" \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGUSER=ledger_restore_admin --env PGPASSWORD=restore \
    --env RESTORE_ADMIN_DATABASE=postgres --env RESTORE_TARGET_DATABASE=restored --env RESTORE_TARGET_OWNER=ledger_owner \
    --env RESTORE_CONFIRM_DATABASE=restored --env RESTORE_CONFIRM_HOST=127.0.0.1 \
    --env RESTORE_CONFIRM_PORT=5432 \
    --env RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    --env RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    --env RESTORE_CONFIRM_FINGERPRINT="restored@127.0.0.1:5432#$fixture_system_identifier" \
    --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
    --env BACKUP_VERIFY_KEY_FILE=/run/restore/verify.pub \
    --entrypoint /usr/local/bin/restore-db.sh ledger-backup:local /backups/ledger-20260725070004.dump.age
  [ "$status" -eq 0 ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "Linux restore image accepts a host 0600 identity as the invoking UID and GID" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  chmod 0600 "$test_root/identity.txt"

  run docker run --rm --user "$(id -u):$(id -g)" --network "container:$container_id" \
    --mount "type=bind,src=$backup_file,dst=/restore/$(basename "$backup_file"),readonly" \
    --mount "type=bind,src=$backup_file.sha256,dst=/restore/$(basename "$backup_file").sha256,readonly" \
    --mount "type=bind,src=$backup_file.manifest,dst=/restore/$(basename "$backup_file").manifest,readonly" \
    --mount "type=bind,src=$backup_file.manifest.minisig,dst=/restore/$(basename "$backup_file").manifest.minisig,readonly" \
    --mount "type=bind,src=$test_root/identity.txt,dst=/run/restore/identity.txt,readonly" \
    --mount "type=bind,src=$test_root/backup-verify.pub,dst=/run/restore/verify.pub,readonly" \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGUSER=ledger_restore_admin --env PGPASSWORD=restore \
    --env RESTORE_ADMIN_DATABASE=postgres --env RESTORE_TARGET_DATABASE=restored --env RESTORE_TARGET_OWNER=ledger_owner \
    --env RESTORE_CONFIRM_DATABASE=restored --env RESTORE_CONFIRM_HOST=127.0.0.1 \
    --env RESTORE_CONFIRM_PORT=5432 \
    --env RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    --env RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    --env RESTORE_CONFIRM_FINGERPRINT="restored@127.0.0.1:5432#$fixture_system_identifier" \
    --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
    --env BACKUP_VERIFY_KEY_FILE=/run/restore/verify.pub \
    --entrypoint /usr/local/bin/restore-db.sh ledger-backup:local "/restore/$(basename "$backup_file")"
  [ "$status" -eq 0 ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "runbook builds the image and mounts only selected restore inputs" {
  run grep --fixed-strings 'docker build -f infra/backup/Dockerfile infra -t ledger-backup:local' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'src="$backup_file"' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'src="$checksum_file"' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'AGE_IDENTITY_FILE=/run/restore/identity.txt' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'BACKUP_VERIFY_KEY_FILE=/run/restore/verify.pub' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'docker run --rm --user "$(id -u):$(id -g)"' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'never automatically drops a staging database' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'verify the recorded name, OID, owner,' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'RESTORE_CONFIRM_SYSTEM_IDENTIFIER' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -ne 0 ]
}

@test "runbook preserves the original dump basename for metadata validation" {
  run grep --fixed-strings 'backup_name="$(basename "$backup_file")"' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'dst="/restore/$backup_name",readonly' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'dst="/restore/$backup_name.sha256",readonly' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'ledger-backup:local "/restore/$backup_name"' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
}

@test "runbook-style selected mounts pass restore metadata-name validation" {
  start_postgres
  backup_fixture
  target_host_url="${fixture_host_url%/fixture}/restored"
  mounted_name="$(basename "$backup_file")"

  run docker run --rm --user "$(id -u):$(id -g)" --network "container:$container_id" \
    --mount "type=bind,src=$backup_file,dst=/restore/$mounted_name,readonly" \
    --mount "type=bind,src=$backup_file.sha256,dst=/restore/$mounted_name.sha256,readonly" \
    --mount "type=bind,src=$backup_file.manifest,dst=/restore/$mounted_name.manifest,readonly" \
    --mount "type=bind,src=$backup_file.manifest.minisig,dst=/restore/$mounted_name.manifest.minisig,readonly" \
    --mount "type=bind,src=$test_root/identity.txt,dst=/run/restore/identity.txt,readonly" \
    --mount "type=bind,src=$test_root/backup-verify.pub,dst=/run/restore/verify.pub,readonly" \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGUSER=ledger_restore_admin --env PGPASSWORD=restore \
    --env RESTORE_ADMIN_DATABASE=postgres --env RESTORE_TARGET_DATABASE=restored --env RESTORE_TARGET_OWNER=ledger_owner \
    --env RESTORE_CONFIRM_DATABASE=restored --env RESTORE_CONFIRM_HOST=127.0.0.1 \
    --env RESTORE_CONFIRM_PORT=5432 \
    --env RESTORE_CONFIRM_SOURCE_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    --env RESTORE_CONFIRM_TARGET_SYSTEM_IDENTIFIER="$fixture_system_identifier" \
    --env RESTORE_CONFIRM_FINGERPRINT="restored@127.0.0.1:5432#$fixture_system_identifier" \
    --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
    --env BACKUP_VERIFY_KEY_FILE=/run/restore/verify.pub \
    --entrypoint /usr/local/bin/restore-db.sh ledger-backup:local "/restore/$mounted_name"
  [ "$status" -eq 0 ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger.ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "base Compose is secret-free and the backup override declares native UID/GID mounts" {
  run grep --fixed-strings 'name: ledger_default' "$BATS_TEST_DIRNAME/../docker-compose.yml"
  [ "$status" -eq 0 ]
  run grep --fixed-strings -- '--network ledger_default' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'BACKUP_SIGNING_KEY_FILE' "$BATS_TEST_DIRNAME/../docker-compose.yml"
  [ "$status" -ne 0 ]
  run grep --fixed-strings 'user: "${BACKUP_UID:?set BACKUP_UID to the operator UID}:${BACKUP_GID:?set BACKUP_GID to the operator GID}"' "$BATS_TEST_DIRNAME/../docker-compose.backup.yml"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'BACKUP_SIGNING_KEY_FILE: /run/ledger-secrets/backup-signing.key' "$BATS_TEST_DIRNAME/../docker-compose.backup.yml"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'target: /run/ledger-secrets/backup-signing.key' "$BATS_TEST_DIRNAME/../docker-compose.backup.yml"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'read_only: true' "$BATS_TEST_DIRNAME/../docker-compose.backup.yml"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'BACKUP_VERIFY_KEY_FILE' "$BATS_TEST_DIRNAME/../docker-compose.backup.yml"
  [ "$status" -ne 0 ]
}

@test "failed final publication removes every visible half of a backup pair" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run -1 env -u DATABASE_URL PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" \
    BACKUP_TEST_FAIL_MV_NUMBER=4 \
    BACKUP_TEST_MV_COUNTER="$test_root/mv-count" \
    BACKUP_TEST_FSYNC_LOG="$test_root/fsync.log" \
    BACKUP_TEST_EVENT_LOG="$test_root/events.log" \
    PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070003 \
    "$backup_script"
  [ "$status" -ne 0 ]
  [ ! -e "$backup_dir/ledger-20260725070003.dump.age" ]
  [ ! -e "$backup_dir/ledger-20260725070003.dump.age.sha256" ]
  [ ! -e "$backup_dir/ledger-20260725070003.dump.age.manifest" ]
  [ ! -e "$backup_dir/ledger-20260725070003.dump.age.manifest.minisig" ]
  run find "$backup_dir" -name '*.partial' -print
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run grep --fixed-strings -- "-d $backup_dir" "$test_root/fsync.log"
  [ "$status" -eq 0 ]
}

@test "same timestamp race preserves one private encrypted backup without secret output" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  recipient="$(age-keygen -y "$test_root/identity.txt")"
  password='backup'

  BACKUP_TEST_DELAY_PG_DUMP=2 env -u DATABASE_URL PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_TIMESTAMP=20260725070002 \
    "$backup_script" >"$test_root/first.stdout" 2>"$test_root/first.stderr" &
  first_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -d "$backup_dir/.backup.lock.d" ]] && break
    sleep 0.1
  done
  [ -d "$backup_dir/.backup.lock.d" ]

  run env -u DATABASE_URL PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_TIMESTAMP=20260725070002 \
    "$backup_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'another backup is already running'* ]]
  wait "$first_pid"

  backup_file="$backup_dir/ledger-20260725070002.dump.age"
  [ -s "$backup_file" ]
  [ -s "$backup_file.sha256" ]
  file_mode="$(stat -f '%Lp' "$backup_file" 2>/dev/null || stat -c '%a' "$backup_file")"
  checksum_mode="$(stat -f '%Lp' "$backup_file.sha256" 2>/dev/null || stat -c '%a' "$backup_file.sha256")"
  [ "$file_mode" = '600' ]
  [ "$checksum_mode" = '600' ]
  run grep --fixed-strings "$recipient" "$test_root/first.stdout" "$test_root/first.stderr" "$backup_file" "$backup_file.sha256"
  [ "$status" -ne 0 ]
  run grep --fixed-strings "$password" "$test_root/first.stdout" "$test_root/first.stderr" "$backup_file" "$backup_file.sha256"
  [ "$status" -ne 0 ]
  run grep --fixed-strings 'AGE-SECRET-KEY-' "$test_root/first.stdout" "$test_root/first.stderr" "$backup_file" "$backup_file.sha256"
  [ "$status" -ne 0 ]
}

@test "two production containers use flock and recover after the lock holder crashes" {
  start_postgres
  shared_backup_dir="$test_root/container-backups"
  mkdir "$shared_backup_dir" "$test_root/container-bin"
  printf '%s\n' \
    '#!/bin/sh' \
    'if [ "${BACKUP_TEST_DELAY:-}" = 1 ]; then : > /backups/started; sleep 60; fi' \
    'exec /usr/local/bin/pg_dump "$@"' > "$test_root/container-bin/pg_dump"
  chmod 0700 "$test_root/container-bin/pg_dump"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  recipient="$(age-keygen -y "$test_root/identity.txt")"
  first_container="ledger-backup-flock-${BATS_TEST_NUMBER}-$$"
  docker run --detach --name "$first_container" --user "$(id -u):$(id -g)" --network "container:$container_id" \
    --mount "type=bind,src=$shared_backup_dir,dst=/backups" \
    --mount "type=bind,src=$test_root/container-bin,dst=/test-bin,readonly" \
    --mount "type=bind,src=$test_root/backup-signing.key,dst=/run/backup/signing.key,readonly" \
    --env PATH=/test-bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    --env BACKUP_TEST_DELAY=1 --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGDATABASE=fixture \
    --env PGUSER=ledger_backup --env PGPASSWORD=backup --env BACKUP_DIR=/backups \
    --env BACKUP_AGE_RECIPIENT="$recipient" --env BACKUP_SIGNING_KEY_FILE=/run/backup/signing.key \
    --env BACKUP_TIMESTAMP=20260725070101 ledger-backup:local >/dev/null
  local attempt
  for attempt in {1..30}; do
    [[ -f "$shared_backup_dir/started" ]] && break
    sleep 0.1
  done
  [ -f "$shared_backup_dir/started" ]
  docker kill "$first_container" >/dev/null
  docker rm --force "$first_container" >/dev/null 2>&1 || true

  run docker run --rm --user "$(id -u):$(id -g)" --network "container:$container_id" \
    --mount "type=bind,src=$shared_backup_dir,dst=/backups" \
    --mount "type=bind,src=$test_root/container-bin,dst=/test-bin,readonly" \
    --mount "type=bind,src=$test_root/backup-signing.key,dst=/run/backup/signing.key,readonly" \
    --env PATH=/test-bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGDATABASE=fixture \
    --env PGUSER=ledger_backup --env PGPASSWORD=backup --env BACKUP_DIR=/backups \
    --env BACKUP_AGE_RECIPIENT="$recipient" --env BACKUP_SIGNING_KEY_FILE=/run/backup/signing.key \
    --env BACKUP_TIMESTAMP=20260725070102 ledger-backup:local
  [ "$status" -eq 0 ]
  [ -s "$shared_backup_dir/ledger-20260725070102.dump.age" ]
  [ -s "$shared_backup_dir/ledger-20260725070102.dump.age.manifest.minisig" ]
}

@test "host fallback treats a pre-existing lock directory as busy" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir/.backup.lock.d"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run env -u DATABASE_URL PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070006 "$backup_script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'another backup is already running'* ]]
}

@test "backup removes encrypted partial output when encryption cannot start" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run -127 env -u DATABASE_URL PATH="$BATS_TEST_DIRNAME/postgres16-client-bin:/usr/local/bin:/usr/bin:/bin" \
    PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070001 \
    "$backup_script"
  [ "$status" -ne 0 ]
  run find "$backup_dir" -name '*.partial' -print
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "fsync failure prevents publication and cleans all partial artifacts" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  run -1 env -u DATABASE_URL PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" BACKUP_TEST_FAIL_FSYNC=1 \
    PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070007 "$backup_script"
  [ "$status" -ne 0 ]
  run find "$backup_dir" -type f -print
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "backup publishes checksum before ciphertext with directory fsyncs between them" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run env -u DATABASE_URL PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" BACKUP_TEST_FSYNC_LOG="$test_root/fsync.log" \
    BACKUP_TEST_EVENT_LOG="$test_root/events.log" \
    PGHOST=127.0.0.1 PGPORT="$postgres_port" PGDATABASE=fixture PGUSER=ledger_backup PGPASSWORD=backup BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070008 "$backup_script"
  [ "$status" -eq 0 ]
  checksum_publish_line="$(grep -n "ledger-20260725070008.dump.age.sha256" "$test_root/events.log" | sed -n '1p' | cut -d: -f1)"
  ciphertext_publish_line="$(grep -n "ledger-20260725070008.dump.age$" "$test_root/events.log" | sed -n '1p' | cut -d: -f1)"
  first_directory_sync_line="$(grep -n "sync:-d $backup_dir" "$test_root/events.log" | sed -n '1p' | cut -d: -f1)"
  ciphertext_directory_sync_line="$(grep -n "sync:-d $backup_dir" "$test_root/events.log" | tail -n 1 | cut -d: -f1)"
  [[ "$checksum_publish_line" =~ ^[0-9]+$ && "$ciphertext_publish_line" =~ ^[0-9]+$ ]]
  [[ "$first_directory_sync_line" =~ ^[0-9]+$ && "$ciphertext_directory_sync_line" =~ ^[0-9]+$ ]]
  [ "$checksum_publish_line" -lt "$first_directory_sync_line" ]
  [ "$first_directory_sync_line" -lt "$ciphertext_publish_line" ]
  [ "$ciphertext_publish_line" -lt "$ciphertext_directory_sync_line" ]
}
