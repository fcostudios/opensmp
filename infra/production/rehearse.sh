#!/usr/bin/env bash
# Disposable localhost proof used by CI. Leaves volumes for inspection unless
# REHEARSAL_CLEANUP=1; never uses the operator's production keys or data.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PRODUCTION_PROJECT="${PRODUCTION_PROJECT:-ledger-production-rehearsal}"
rehearsal_dir="$(mktemp -d "${TMPDIR:-/tmp}/ledger-rehearsal.XXXXXX")"
export PRODUCTION_ENV_FILE="$rehearsal_dir/runtime.env"
export LOCAL_CA_DIR="$rehearsal_dir/ca"
export PRODUCTION_OVERRIDE_FILE="$PWD/infra/production/docker-compose.local.yml"
mkdir -p "$LOCAL_CA_DIR"
openssl rand -base64 32 > "$rehearsal_dir/credential-kek"
chmod 0440 "$rehearsal_dir/credential-kek"
for key in POSTGRES_SUPERUSER_PASSWORD LEDGER_OWNER_PASSWORD LEDGER_APP_PASSWORD \
  LEDGER_BACKUP_PASSWORD KEYCLOAK_DB_PASSWORD KEYCLOAK_ADMIN_PASSWORD \
  KEYCLOAK_CLIENT_SECRET KEYCLOAK_ADMIN_CLIENT_SECRET NEXTAUTH_SECRET; do
  printf '%s=%s\n' "$key" "$(openssl rand -hex 32)" >> "$PRODUCTION_ENV_FILE"
done
cat >> "$PRODUCTION_ENV_FILE" <<EOF
APP_DOMAIN=ledger.localhost
AUTH_DOMAIN=auth.localhost
ACME_EMAIL=ops@example.com
APP_IMAGE=ledger-app:rehearsal
WORKER_IMAGE=ledger-worker:rehearsal
MIGRATION_IMAGE=ledger-migrations:rehearsal
LEDGER_KEK_FILE=$rehearsal_dir/credential-kek
LOCAL_CA_DIR=$LOCAL_CA_DIR
SMTP_RELAYHOST=smtp.example.invalid:587
SMTP_SENDER_DOMAINS=example.com
ECUADOR_HOLIDAYS=2026-01-01
EOF
chmod 0600 "$PRODUCTION_ENV_FILE"
compose=(docker compose --project-name "$PRODUCTION_PROJECT" --env-file "$PRODUCTION_ENV_FILE"
  -f infra/docker-compose.production.yml -f "$PRODUCTION_OVERRIDE_FILE")
cleanup() {
  if [[ "${REHEARSAL_CLEANUP:-0}" == 1 ]]; then
    "${compose[@]}" down --volumes --remove-orphans
    rm -rf "$rehearsal_dir"
  else
    printf 'Rehearsal environment: %s\n' "$PRODUCTION_ENV_FILE"
  fi
}
trap cleanup EXIT
# Linux bind mounts retain numeric ownership. Docker Desktop on macOS maps
# host ownership to the container user and does not permit arbitrary chown.
if [[ "$(uname -s)" == Linux ]]; then
  docker run --rm -v "$rehearsal_dir:/fixture" alpine:3.22 chown 1001:1001 /fixture/credential-kek
fi
"${compose[@]}" build app worker migrate
"${compose[@]}" up -d --no-deps --wait caddy
"${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$LOCAL_CA_DIR/root.crt"
bash infra/production/deploy.sh existing
node --test infra/tests/production-smoke.test.mjs
# Exercise the existing backup image against the production RLS/grant state.
docker build -t ledger-backup:local -f infra/backup/Dockerfile infra
mkdir -p "$rehearsal_dir/backups"
docker run --rm --user "$(id -u):$(id -g)" -v "$rehearsal_dir:/fixture" \
  --entrypoint sh ledger-backup:local -ec '
    age-keygen -o /fixture/backup-age.key 2>/fixture/backup-recipient.txt
    minisign -G -W -s /fixture/backup-signing.key -p /fixture/backup-verify.pub
  '
chmod 0600 "$rehearsal_dir/backup-signing.key"
printf 'BACKUP_AGE_RECIPIENT=%s\n' "$(sed 's/^Public key: //' "$rehearsal_dir/backup-recipient.txt")" >> "$PRODUCTION_ENV_FILE"
export BACKUP_UID="$(id -u)" BACKUP_GID="$(id -g)"
export BACKUP_SIGNING_KEY_FILE="$rehearsal_dir/backup-signing.key"
export BACKUP_OUTPUT_DIR="$rehearsal_dir/backups"
"${compose[@]}" -f infra/docker-compose.backup.yml --profile backup run --rm backup
BACKUP_FIXTURE_DIR="$rehearsal_dir" node --test infra/tests/production-backup.test.mjs
# Restart identity and runtime, proving realm import/persistence survives startup.
"${compose[@]}" restart keycloak app worker
"${compose[@]}" up -d --wait --wait-timeout 360 app worker caddy
node --test infra/tests/production-smoke.test.mjs
