#!/usr/bin/env bash
# Run from any directory. Same immutable images/config work on another host.
set -euo pipefail
deployment_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${PRODUCTION_ENV_FILE:?point PRODUCTION_ENV_FILE at the private runtime env file}"
[[ -f "$PRODUCTION_ENV_FILE" ]] || { echo 'Runtime env file not found' >&2; exit 1; }
compose=(docker compose --project-name "${PRODUCTION_PROJECT:-ledger-production}"
  --env-file "$PRODUCTION_ENV_FILE" -f "$deployment_root/infra/docker-compose.production.yml")
# Optional local-CA/port bindings are confined to the rehearsal override.
if [[ -n "${PRODUCTION_OVERRIDE_FILE:-}" ]]; then
  compose+=(-f "$PRODUCTION_OVERRIDE_FILE")
fi
"${compose[@]}" config --quiet
case "${1:-pull}" in
  build) "${compose[@]}" build app worker migrate ;;
  pull) "${compose[@]}" pull ;;
  existing) ;; # CI or an operator already loaded the immutable images.
  *) echo 'Usage: deploy.sh [pull|build|existing]' >&2; exit 2 ;;
esac
"${compose[@]}" up -d --wait postgres keycloak smtp-relay
# Always rerun the checksum-verified committed migration set before rollout.
"${compose[@]}" up -d --force-recreate migrate
migration_container="$("${compose[@]}" ps --all --quiet migrate)"
[[ "$(docker wait "$migration_container")" == 0 ]] || {
  "${compose[@]}" logs migrate; exit 1;
}
"${compose[@]}" up -d --wait --wait-timeout 360 app worker caddy
"${compose[@]}" ps
