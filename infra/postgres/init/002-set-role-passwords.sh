#!/usr/bin/env sh
set -euo pipefail

: "${LEDGER_OWNER_PASSWORD:?LEDGER_OWNER_PASSWORD is required}"
: "${LEDGER_APP_PASSWORD:?LEDGER_APP_PASSWORD is required}"
: "${LEDGER_BACKUP_PASSWORD:?LEDGER_BACKUP_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set ledger_owner_password="$LEDGER_OWNER_PASSWORD" \
  --command "ALTER ROLE ledger_owner PASSWORD :'ledger_owner_password';"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set ledger_app_password="$LEDGER_APP_PASSWORD" \
  --command "ALTER ROLE ledger_app PASSWORD :'ledger_app_password';"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set ledger_backup_password="$LEDGER_BACKUP_PASSWORD" \
  --command "ALTER ROLE ledger_backup PASSWORD :'ledger_backup_password';"
