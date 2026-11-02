#!/usr/bin/env bash
# CHG-121 — tear down the `pnpm demo:up` stack.
#
#   pnpm demo:down            containers, volumes, network, its three built
#                             images and its temp stack dir; keeps the state dir
#   pnpm demo:down --purge    also deletes the state dir (credentials, CA copy)
#
# Only ever addresses the demo project (default ledger-demo); refuses the
# operator's ledger-production project. Shared base images (postgres,
# keycloak, caddy, postfix) are never removed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/demo-common.sh"

purge=0
for arg in "$@"; do
  case "$arg" in
    --purge) purge=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) demo_die "unknown argument '$arg' (use --purge)" ;;
  esac
done
recorded_tag="$(demo_state_value DEMO_IMAGE_TAG)"
[[ -n "$recorded_tag" ]] && demo_image_tag="$recorded_tag"
demo_guard_target

stack_dir="$(demo_state_value DEMO_STACK_DIR)"
if [[ -n "$stack_dir" && -f "$stack_dir/runtime.env" ]]; then
  docker compose --project-name "$demo_project" --env-file "$stack_dir/runtime.env" \
    -f "$demo_repo/infra/docker-compose.production.yml" -f "$demo_override" down --volumes --remove-orphans
else
  # No stack files left: address the project by name alone, from a directory
  # without a compose file so nothing else is picked up.
  (cd / && docker compose -p "$demo_project" down --volumes --remove-orphans)
fi
# Project-name-only down can leave resources it cannot resolve; sweep by label.
for id in $(docker ps -aq --filter "label=com.docker.compose.project=$demo_project"); do docker rm -f "$id" >/dev/null; done
for volume in $(docker volume ls -q --filter "label=com.docker.compose.project=$demo_project"); do docker volume rm "$volume" >/dev/null; done
for network in $(docker network ls -q --filter "label=com.docker.compose.project=$demo_project"); do docker network rm "$network" >/dev/null; done
demo_stack_exists && demo_die "resources labelled $demo_project remain; inspect with docker ps -a / docker volume ls"

# The three images this demo built. No -f: an id shared with another tag is
# only untagged, and an image some other container uses is left in place.
foreign="$(demo_image_users | grep -vx "$demo_project" | sort -u | tr '\n' ' ' || true)"
if [[ -n "${foreign// /}" ]]; then
  printf 'demo: keeping ledger-*:%s, still used by [%s]\n' "$demo_image_tag" "$foreign" >&2
else
  for image in "ledger-app:$demo_image_tag" "ledger-worker:$demo_image_tag" "ledger-migrations:$demo_image_tag"; do
    if docker image inspect "$image" >/dev/null 2>&1; then docker image rm "$image" >/dev/null && printf 'demo: removed %s\n' "$image"; fi
  done
fi

case "$stack_dir" in
  "") ;;
  */ledger-demo.*) [[ -d "$stack_dir" ]] && rm -rf "$stack_dir" && printf 'demo: removed %s\n' "$stack_dir" ;;
  *) printf 'demo: not removing unexpected stack dir %s\n' "$stack_dir" >&2 ;;
esac

if [[ -f "$demo_state_dir/root.crt" ]]; then
  sha1="$(openssl x509 -in "$demo_state_dir/root.crt" -noout -fingerprint -sha1 | sed 's/^.*=//; s/://g')"
  printf 'demo: if you trusted this demo CA, remove it by fingerprint (never by name):\n'
  printf '      security delete-certificate -Z %s ~/Library/Keychains/login.keychain-db\n' "$sha1"
fi
if [[ "$purge" == 1 ]]; then
  case "$demo_state_dir" in
    */smp-demo/*|"${DEMO_STATE_DIR:-/nonexistent}") rm -rf "$demo_state_dir"; printf 'demo: removed %s\n' "$demo_state_dir" ;;
    *) demo_die "not purging unexpected state dir $demo_state_dir" ;;
  esac
elif [[ -f "$demo_state_dir/state.env" ]]; then
  sed -i.bak 's/^DEMO_STATUS=.*/DEMO_STATUS=down/' "$demo_state_dir/state.env" && rm -f "$demo_state_dir/state.env.bak"
  printf 'demo: kept %s (credentials of a stack that no longer exists); --purge deletes it\n' "$demo_state_dir"
fi
printf 'demo: %s is down\n' "$demo_project"
