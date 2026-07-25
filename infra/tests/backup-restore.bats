#!/usr/bin/env bats

backup_script="$BATS_TEST_DIRNAME/../scripts/backup-db.sh"
restore_script="$BATS_TEST_DIRNAME/../scripts/restore-db.sh"

setup_file() {
  bats_require_minimum_version 1.5.0
}

setup() {
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/ledger-backup-restore.XXXXXX")"
  host_psql="$(command -v psql)"
  export PATH="$BATS_TEST_DIRNAME/postgres16-client-bin:${BACKUP_TEST_TOOLS_DIR:?run infra/tests/bootstrap-backup-tools.sh first}:$PATH"
  container_id=""
  volume_name=""
}

teardown() {
  if [[ -n "$container_id" ]]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  if [[ -n "$volume_name" ]]; then
    docker volume rm --force "$volume_name" >/dev/null 2>&1 || true
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
  fixture_url='postgresql://postgres:postgres@127.0.0.1:5432/fixture'
  fixture_host_url="postgresql://postgres:postgres@127.0.0.1:${postgres_port}/fixture"
  "$host_psql" "$fixture_host_url" --set ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE ledger_fixture (id integer PRIMARY KEY, note text NOT NULL);
INSERT INTO ledger_fixture (id, note) VALUES (1, 'opening balance'), (2, 'closing balance');
CREATE TABLE drizzle_migrations (hash text PRIMARY KEY);
INSERT INTO drizzle_migrations (hash) VALUES ('migration-checksum-a'), ('migration-checksum-b');
SQL
}

backup_fixture() {
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  recipient="$(age-keygen -y "$test_root/identity.txt")"
  env DATABASE_URL="$fixture_url" \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_TIMESTAMP=20260725070000 \
    "$backup_script"
  backup_file="$backup_dir/ledger-20260725070000.dump.age"
}

@test "backup and restore scripts exist and reject unsafe execution" {
  [ -x "$BATS_TEST_DIRNAME/../scripts/backup-db.sh" ]
  [ -x "$BATS_TEST_DIRNAME/../scripts/restore-db.sh" ]
}

@test "backup rejects an option-injection recipient before connecting" {
  run env DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/fixture' \
    BACKUP_DIR="$test_root" \
    BACKUP_AGE_RECIPIENT='--identity=/tmp/stolen-key' \
    "$backup_script"

  [ "$status" -ne 0 ]
  [[ "$output" == *'invalid BACKUP_AGE_RECIPIENT'* ]]
}

@test "backup rejects a URI options injection before connecting" {
  run env DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/fixture?options=-c%20search_path%3Dpublic' \
    BACKUP_DIR="$test_root" \
    BACKUP_AGE_RECIPIENT='age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' \
    "$backup_script"

  [ "$status" -ne 0 ]
  [[ "$output" == *'DATABASE_URL must not contain URI options'* ]]
}

@test "libpq URI validation preserves IPv6 socket and percent-encoded forms" {
  run env DATABASE_URL='postgresql://backup:p%40ss@[::1]:5432/ledger%2Drestore?sslmode=require' \
    bash -c 'source "$1"; prepare_database_connection; printf "%s" "${DATABASE_CLIENT_ARGS[0]}"' _ "$BATS_TEST_DIRNAME/../scripts/backup-common.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'[::1]:5432/ledger%2Drestore?sslmode=require'* ]]

  run env DATABASE_URL='postgresql:///ledger%5Frestore?sslmode=disable' \
    bash -c 'source "$1"; prepare_database_connection; printf "%s" "${DATABASE_CLIENT_ARGS[0]}"' _ "$BATS_TEST_DIRNAME/../scripts/backup-common.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'postgresql:///ledger%5Frestore?sslmode=disable'* ]]
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

@test "restore drill recreates exact tables and migration checksum rows" {
  start_postgres
  backup_fixture
  target_url="${fixture_url%/fixture}/restored"
  target_host_url="${fixture_host_url%/fixture}/restored"
  "$host_psql" "${fixture_host_url%/fixture}/postgres" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'

  run env DATABASE_URL="$target_url" \
    RESTORE_CONFIRM_DATABASE=restored \
    AGE_IDENTITY_FILE="$test_root/identity.txt" \
    "$restore_script" "$backup_file"
  [ "$status" -eq 0 ]

  run "$host_psql" "$target_host_url" --tuples-only --no-align --command "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command "SELECT string_agg(hash, ',' ORDER BY hash) FROM drizzle_migrations;"
  [ "$status" -eq 0 ]
  [ "$output" = 'migration-checksum-a,migration-checksum-b' ]
}

@test "restore rejects ciphertext tampering and a mismatched confirmation" {
  start_postgres
  backup_fixture
  target_url="${fixture_url%/fixture}/restored"
  target_host_url="${fixture_host_url%/fixture}/restored"
  "$host_psql" "${fixture_host_url%/fixture}/postgres" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'
  run env DATABASE_URL="$target_url" \
    RESTORE_CONFIRM_DATABASE=fixture \
    AGE_IDENTITY_FILE="$test_root/identity.txt" \
    "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'does not exactly match target database'* ]]

  tampered_file="$test_root/tampered.dump.age"
  cp "$backup_file" "$tampered_file"
  cp "$backup_file.sha256" "$tampered_file.sha256"
  printf 'tampered' >> "$tampered_file"
  run env DATABASE_URL="$target_url" \
    RESTORE_CONFIRM_DATABASE=restored \
    AGE_IDENTITY_FILE="$test_root/identity.txt" \
    "$restore_script" "$tampered_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'checksum verification failed'* ]]

  valid_checksum="$(shasum --algorithm 256 "$backup_file" | awk '{print $1}')"
  printf '%s  %s unexpected-field\n' "$valid_checksum" "$(basename "$backup_file")" > "$backup_file.sha256"
  run env DATABASE_URL="$target_url" \
    RESTORE_CONFIRM_DATABASE=restored \
    AGE_IDENTITY_FILE="$test_root/identity.txt" \
    "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'checksum metadata is invalid'* ]]

  printf '%064d  %s\n' 0 "$(basename "$backup_file")" > "$backup_file.sha256"
  run env DATABASE_URL="$target_url" \
    RESTORE_CONFIRM_DATABASE=restored \
    AGE_IDENTITY_FILE="$test_root/identity.txt" \
    "$restore_script" "$backup_file"
  [ "$status" -ne 0 ]
  [[ "$output" == *'checksum verification failed'* ]]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
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
  volume_name="ledger-backup-image-${BATS_TEST_NUMBER}-$$"
  docker volume create "$volume_name" >/dev/null
  target_host_url="${fixture_host_url%/fixture}/restored"
  "$host_psql" "${fixture_host_url%/fixture}/postgres" --set ON_ERROR_STOP=1 --command 'CREATE DATABASE restored;'

  run docker run --rm --network "container:$container_id" \
    --mount "type=volume,src=$volume_name,dst=/backups" \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGDATABASE=fixture \
    --env PGUSER=postgres --env PGPASSWORD=postgres \
    --env BACKUP_DIR=/backups --env BACKUP_AGE_RECIPIENT="$recipient" \
    --env BACKUP_TIMESTAMP=20260725070004 ledger-backup:local
  [ "$status" -eq 0 ]
  run docker run --rm --mount "type=volume,src=$volume_name,dst=/backups,readonly" \
    --entrypoint sha256sum ledger-backup:local /backups/ledger-20260725070004.dump.age
  [ "$status" -eq 0 ]

  run docker run --rm --network "container:$container_id" \
    --mount "type=volume,src=$volume_name,dst=/backups,readonly" \
    --mount "type=bind,src=$test_root/identity.txt,dst=/run/restore/identity.txt,readonly" \
    --env PGHOST=127.0.0.1 --env PGPORT=5432 --env PGDATABASE=restored \
    --env PGUSER=postgres --env PGPASSWORD=postgres \
    --env RESTORE_CONFIRM_DATABASE=restored --env AGE_IDENTITY_FILE=/run/restore/identity.txt \
    --entrypoint /usr/local/bin/restore-db.sh ledger-backup:local /backups/ledger-20260725070004.dump.age
  [ "$status" -eq 0 ]
  run "$host_psql" "$target_host_url" --tuples-only --no-align --command 'SELECT count(*) FROM ledger_fixture;'
  [ "$status" -eq 0 ]
  [ "$output" = '2' ]
}

@test "runbook builds the image and mounts only selected restore inputs" {
  run grep --fixed-strings 'docker build -f infra/backup/Dockerfile infra -t ledger-backup:local' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'dst=/restore/backup.dump.age,readonly' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'dst=/restore/backup.dump.age.sha256,readonly' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'AGE_IDENTITY_FILE=/run/restore/identity.txt' "$BATS_TEST_DIRNAME/../../docs/runbooks/backup-restore.md"
  [ "$status" -eq 0 ]
}

@test "failed final publication removes every visible half of a backup pair" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run -1 env PATH="$BATS_TEST_DIRNAME/fault-bin:$PATH" \
    BACKUP_TEST_FAIL_MV_NUMBER=2 \
    BACKUP_TEST_MV_COUNTER="$test_root/mv-count" \
    DATABASE_URL="$fixture_url" \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070003 \
    "$backup_script"
  [ "$status" -ne 0 ]
  [ ! -e "$backup_dir/ledger-20260725070003.dump.age" ]
  [ ! -e "$backup_dir/ledger-20260725070003.dump.age.sha256" ]
  run find "$backup_dir" -name '*.partial' -print
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "same timestamp race preserves one private encrypted backup without secret output" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1
  recipient="$(age-keygen -y "$test_root/identity.txt")"
  password='postgres'

  BACKUP_TEST_DELAY_PG_DUMP=2 env DATABASE_URL="$fixture_url" \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_TIMESTAMP=20260725070002 \
    "$backup_script" >"$test_root/first.stdout" 2>"$test_root/first.stderr" &
  first_pid=$!
  local attempt
  for attempt in {1..30}; do
    [[ -d "$backup_dir/.backup.lock" ]] && break
    sleep 0.1
  done
  [ -d "$backup_dir/.backup.lock" ]

  run env DATABASE_URL="$fixture_url" \
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

@test "backup removes encrypted partial output when encryption cannot start" {
  start_postgres
  backup_dir="$test_root/backups"
  mkdir -p "$backup_dir"
  age-keygen --output "$test_root/identity.txt" >/dev/null 2>&1

  run -127 env PATH="$BATS_TEST_DIRNAME/postgres16-client-bin:/usr/local/bin:/usr/bin:/bin" \
    DATABASE_URL="$fixture_url" \
    BACKUP_DIR="$backup_dir" \
    BACKUP_AGE_RECIPIENT="$(age-keygen -y "$test_root/identity.txt")" \
    BACKUP_TIMESTAMP=20260725070001 \
    "$backup_script"
  [ "$status" -ne 0 ]
  run find "$backup_dir" -name '*.partial' -print
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
