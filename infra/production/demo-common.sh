# CHG-121 — shared settings and safety guards for demo-up.sh / demo-down.sh.
# Sourced, not executed. Bash 3.2 compatible (macOS /bin/bash).

demo_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
demo_project="${DEMO_PROJECT:-ledger-demo}"
demo_image_tag="${DEMO_IMAGE_TAG:-demo-up}"
# Fixed by docker-compose.rehearsal-ports.yml (Caddy listens on these inside
# and outside the container); there is deliberately no knob for them.
demo_https_port=28443
demo_http_port=28080
demo_override="$demo_repo/infra/production/docker-compose.rehearsal-ports.yml"
demo_base_url="https://ledger.localhost:$demo_https_port"
demo_state_dir="${DEMO_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/smp-demo/$demo_project}"
demo_production_data="$HOME/.local/share/smp/production"

demo_die() { printf 'demo: %s\n' "$*" >&2; exit 1; }

# Refuses anything that could address the operator's localhost production.
demo_guard_target() {
  case "$demo_project" in
    ledger-production|ledger-production-*) demo_die "refusing project '$demo_project': never the production project" ;;
  esac
  [[ "$demo_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || demo_die "invalid project name '$demo_project'"
  [[ "$demo_image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || demo_die "invalid image tag '$demo_image_tag'"
  case "$demo_state_dir/" in
    "$demo_production_data/"*|"$HOME/.local/share/smp/"*) demo_die "refusing state dir under ~/.local/share/smp (production data)" ;;
    /*) ;;
    *) demo_die "DEMO_STATE_DIR must be absolute" ;;
  esac
}

# Prints the compose project label of every container (any state) that uses
# one of this demo's three built image tags.
demo_image_users() {
  local image
  for image in "ledger-app:$demo_image_tag" "ledger-worker:$demo_image_tag" "ledger-migrations:$demo_image_tag"; do
    docker image inspect "$image" >/dev/null 2>&1 || continue
    docker ps -a --filter "ancestor=$image" --format '{{.Label "com.docker.compose.project"}}'
  done
}

demo_stack_exists() {
  [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$demo_project")" ]] \
    || [[ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$demo_project")" ]]
}

# state.env holds plain KEY=value lines written by demo-up.sh; read, never source.
demo_state_value() {
  [[ -f "$demo_state_dir/state.env" ]] || return 0
  sed -n "s/^$1=//p" "$demo_state_dir/state.env" | tail -n 1
}
