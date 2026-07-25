#!/usr/bin/env bats

repo_root="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
compose_file="$repo_root/infra/docker-compose.yml"
backup_compose_file="$repo_root/infra/docker-compose.backup.yml"
env_example="$repo_root/.env.example"
roles_sql="$repo_root/infra/postgres/init/001-roles.sql"
passwords_script="$repo_root/infra/postgres/init/002-set-role-passwords.sh"
apply_roles_script="$repo_root/infra/postgres/apply-roles.sh"
cron_script="$repo_root/infra/backup/run-cron.sh"

setup_file() {
  bats_require_minimum_version 1.5.0
}

setup() {
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/ledger-compose-roles.XXXXXX")"
  mkdir "$test_root/output"
  : > "$test_root/backup-signing.key"
}

teardown() {
  rm -rf -- "$test_root"
}

@test "base Compose validates the supplied environment without loading backup secrets" {
  run docker compose --env-file "$env_example" -f "$compose_file" config --quiet

  [ "$status" -eq 0 ]
}

@test "backup activation rejects a missing signing secret after its other host inputs are set" {
  run env \
    BACKUP_UID=1234 \
    BACKUP_GID=2345 \
    BACKUP_OUTPUT_DIR="$test_root/output" \
    docker compose --env-file "$env_example" -f "$compose_file" -f "$backup_compose_file" --profile backup config --quiet

  [ "$status" -ne 0 ]
  [[ "$output" == *"BACKUP_SIGNING_KEY_FILE"* ]]
}

@test "backup activation runs as the configured native uid and gid with explicit host binds" {
  run env \
    BACKUP_UID=1234 \
    BACKUP_GID=2345 \
    BACKUP_OUTPUT_DIR="$test_root/output" \
    BACKUP_SIGNING_KEY_FILE="$test_root/backup-signing.key" \
    docker compose --env-file "$env_example" -f "$compose_file" -f "$backup_compose_file" --profile backup config

  [ "$status" -eq 0 ]
  [[ "$output" =~ user:\ ?\"?1234:2345\"? ]]
  [[ "$output" == *"source: $test_root/output"* ]]
  [[ "$output" == *"target: /backups"* ]]
  [[ "$output" == *"source: $test_root/backup-signing.key"* ]]
  [[ "$output" == *"target: /run/ledger-secrets/backup-signing.key"* ]]
}

@test "restore administrator is a noinherit createdb role with only the restore capabilities" {
  run grep --fixed-strings 'CREATE ROLE ledger_restore_admin LOGIN CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE;' "$roles_sql"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'GRANT ledger_owner TO ledger_restore_admin;' "$roles_sql"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_restore_admin;' "$roles_sql"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'GRANT pg_read_all_data TO ledger_restore_admin;' "$roles_sql"
  [ "$status" -ne 0 ]
}

@test "password rotation and existing-volume apply include the restore administrator" {
  run grep --fixed-strings ': "${LEDGER_RESTORE_ADMIN_PASSWORD:?LEDGER_RESTORE_ADMIN_PASSWORD is required}"' "$passwords_script"
  [ "$status" -eq 0 ]
  run grep --fixed-strings "ALTER ROLE ledger_restore_admin PASSWORD :'ledger_restore_admin_password';" "$passwords_script"
  [ "$status" -eq 0 ]
  run test -x "$apply_roles_script"
  [ "$status" -eq 0 ]
  run grep --fixed-strings '/docker-entrypoint-initdb.d/001-roles.sql' "$apply_roles_script"
  [ "$status" -eq 0 ]
  run grep --fixed-strings '/docker-entrypoint-initdb.d/002-set-role-passwords.sh' "$apply_roles_script"
  [ "$status" -eq 0 ]
}

@test "cron exports its native Linux identity and loads the backup override" {
  run grep --fixed-strings 'export BACKUP_UID="$(id -u)"' "$cron_script"
  [ "$status" -eq 0 ]
  run grep --fixed-strings 'export BACKUP_GID="$(id -g)"' "$cron_script"
  [ "$status" -eq 0 ]
  run grep --fixed-strings -- '-f infra/docker-compose.backup.yml' "$cron_script"
  [ "$status" -eq 0 ]
}
