#!/usr/bin/env bash
# New production volumes only; identity owns a separate database and role.
set -euo pipefail
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set keycloak_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE keycloak LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak') \gexec
ALTER ROLE keycloak PASSWORD :'keycloak_password';
SELECT 'CREATE DATABASE keycloak OWNER keycloak' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak') \gexec
SQL
# pg_read_all_data does not bypass RLS. The dedicated read-only backup role
# must see every row for pg_dump; never grant this attribute to ledger_app.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --command 'ALTER ROLE ledger_backup BYPASSRLS'
