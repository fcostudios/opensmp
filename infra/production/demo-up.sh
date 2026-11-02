#!/usr/bin/env bash
# CHG-121 — one-command demo stack the operator can sign in to.
#
#   pnpm demo:up            fresh stack + 5 PROVISIONAL companies + 3 users
#                           + the CHG-118 S0/S1 journey (provisional data exists)
#   pnpm demo:up --empty    fresh stack + companies + users only
#   ... --with-2fa          keep the platform admins' TOTP (CHG-124; default:
#                           admins sign in without 2FA — demo stack only)
#
# Builds a disposable production-shaped stack with infra/production/rehearse.sh
# under its own Compose project (default ledger-demo), image tag and the
# rehearsal-ports override (https://ledger.localhost:28443). Never touches the
# operator's ledger-production project, its ports, keys or ledger-backup:local.
# Credentials (passwords, plus admin TOTP secrets with --with-2fa) and the
# stack's CA land in a per-user state dir outside the repository. Stop with
# `pnpm demo:down`. Production always keeps mandatory admin 2FA.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/demo-common.sh"
cd "$demo_repo"

mode=journey
admin_otp=off
for arg in "$@"; do
  case "$arg" in
    --empty) mode=empty ;;
    --with-2fa) admin_otp=on ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) demo_die "unknown argument '$arg' (use --empty, --with-2fa)" ;;
  esac
done
demo_guard_target

credentials="$demo_state_dir/credentials.json"
ca_file="$demo_state_dir/root.crt"

# Admin 2FA of the recorded stack; stacks from before CHG-124 always had it.
recorded_otp() {
  local value
  value="$(demo_state_value DEMO_ADMIN_OTP)"
  printf '%s' "${value:-on}"
}

summary() {
  local sha1 otp
  sha1="$(openssl x509 -in "$ca_file" -noout -fingerprint -sha1 | sed 's/^.*=//; s/://g')"
  otp="$(recorded_otp)"
  cat <<EOF

SMP demo stack is up — project $demo_project, $(demo_state_value DEMO_MODE) mode (PROVISIONAL, fictitious data).

  URL           $demo_base_url
  Trust its CA  (macOS; every demo:up makes a new CA, so do this after each one)
                security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db $ca_file
                CA SHA-1 $sha1 — to remove it later, by fingerprint only (the
                production CA has the same name):
                security delete-certificate -Z $sha1 ~/Library/Keychains/login.keychain-db
  Credentials   $credentials (mode 0600)
EOF
  if [[ "$otp" == off ]]; then
    cat <<EOF
                demo-group-admin, demo-central-finance, demo-company-finance-01
  2FA           off: no 2FA (demo only). Every user signs in with username and
                password. Production keeps mandatory admin 2FA; to rehearse it
                here: pnpm demo:down, then pnpm demo:up --with-2fa.
EOF
  else
    cat <<EOF
                demo-group-admin and demo-central-finance (TOTP), demo-company-finance-01
  TOTP          For each admin, add "otpauthUri" to an authenticator app (render it
                as a QR code, e.g. qrencode -t ansiutf8 '<otpauthUri>'), or enter
                "totpSecret" as a setup key: time-based, SHA-1, 6 digits, 30 s.
EOF
  fi
  cat <<EOF
  Stop          pnpm demo:down            (keeps $demo_state_dir)
                pnpm demo:down --purge    (also deletes it)
EOF
}

# Re-run: reuse a ready stack, refuse a half-built or foreign one.
if demo_stack_exists; then
  if [[ "$(demo_state_value DEMO_STATUS)" == ready && -f "$credentials" && -f "$ca_file" ]] \
    && curl --silent --fail --max-time 10 --cacert "$ca_file" \
      --resolve "ledger.localhost:$demo_https_port:127.0.0.1" "$demo_base_url/api/health" >/dev/null; then
    printf 'demo: %s is already up and healthy; reusing it (mode %s, admin 2FA %s). Run pnpm demo:down first for a fresh one.\n' \
      "$demo_project" "$(demo_state_value DEMO_MODE)" "$(recorded_otp)"
    if [[ "$(recorded_otp)" != "$admin_otp" ]]; then
      printf 'demo: note: you asked for admin 2FA %s, but this stack has it %s; run pnpm demo:down, then pnpm demo:up again.\n' \
        "$admin_otp" "$(recorded_otp)" >&2
    fi
    summary
    exit 0
  fi
  demo_die "a '$demo_project' stack exists but is not a ready demo; run 'pnpm demo:down' first"
fi

# The demo's ports must be free (no other Compose project, no other listener).
for port in "$demo_https_port" "$demo_http_port"; do
  owner="$(docker ps --filter "publish=$port" --format '{{.Label "com.docker.compose.project"}} ({{.Names}})' | head -n 1)"
  [[ -z "$owner" ]] || demo_die "port $port is published by $owner; stop that stack first"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    demo_die "port $port on 127.0.0.1 is in use by another process"
  fi
done
# The built tags must not be in use by any container outside this project.
foreign="$(demo_image_users | grep -vx "$demo_project" | sort -u | tr '\n' ' ' || true)"
[[ -z "${foreign// /}" ]] || demo_die "images ledger-*:$demo_image_tag are used by [$foreign]; set DEMO_IMAGE_TAG"

mkdir -p "$demo_state_dir"
chmod 0700 "$demo_state_dir"
stack_dir="$(mktemp -d "${TMPDIR:-/tmp}/ledger-demo.XXXXXX")"
rm -f "$credentials" "$ca_file" "$demo_state_dir/runtime.env"
cat > "$demo_state_dir/state.env" <<EOF
DEMO_PROJECT=$demo_project
DEMO_IMAGE_TAG=$demo_image_tag
DEMO_STACK_DIR=$stack_dir
DEMO_MODE=$mode
DEMO_ADMIN_OTP=$admin_otp
DEMO_STATUS=starting
EOF
chmod 0600 "$demo_state_dir/state.env"
failed() { printf '\ndemo: %s failed. Inspect, then run: pnpm demo:down\n' "$1" >&2; exit 1; }

printf 'demo: building and starting %s (stack dir %s)\n' "$demo_project" "$stack_dir"
PRODUCTION_PROJECT="$demo_project" \
PRODUCTION_OVERRIDE_FILE="$demo_override" \
REHEARSAL_HTTPS_PORT="$demo_https_port" \
REHEARSAL_SKIP_BACKUP=1 \
REHEARSAL_IMAGE_TAG="$demo_image_tag" \
REHEARSAL_CLEANUP=0 \
REHEARSAL_DIR="$stack_dir" \
  bash infra/production/rehearse.sh || failed "rehearse.sh"

install -m 0600 "$stack_dir/runtime.env" "$demo_state_dir/runtime.env"
install -m 0644 "$stack_dir/ca/root.crt" "$ca_file"

if [[ ! -x apps/web/node_modules/.bin/playwright ]]; then
  pnpm install --frozen-lockfile || failed "pnpm install"
fi
pnpm --dir apps/web exec playwright install chromium || failed "playwright install"

export DEMO_REHEARSAL_ENV_FILE="$stack_dir/runtime.env"
export DEMO_REHEARSAL_PROJECT="$demo_project"
export DEMO_BASE_URL="$demo_base_url"
# CHG-124: seeding sets the stack's admin OTP to this; the login proof checks it.
export DEMO_ADMIN_OTP="$admin_otp"
evidence_credentials="$demo_repo/apps/web/test-results/demo-s0-s1/rehearsal-users.json"
rm -f "$evidence_credentials"
suite=journey
[[ "$mode" == empty ]] && suite=accounts
seeded=0
DEMO_SUITE="$suite" pnpm --dir apps/web exec playwright test -c playwright.demo.config.ts || seeded=$?
# Whatever happened, keep what was enrolled: the passwords (and, with
# --with-2fa, the TOTP secrets) are the only way back into this stack.
[[ -f "$evidence_credentials" ]] && install -m 0600 "$evidence_credentials" "$credentials"
[[ "$seeded" == 0 ]] || failed "seeding / $suite run (credentials so far: $credentials)"

# Proof: sign in as every user with nothing but the persisted file.
DEMO_SUITE=login DEMO_CREDENTIALS_FILE="$credentials" \
  pnpm --dir apps/web exec playwright test -c playwright.demo.config.ts || failed "login check"

sed -i.bak 's/^DEMO_STATUS=.*/DEMO_STATUS=ready/' "$demo_state_dir/state.env" && rm -f "$demo_state_dir/state.env.bak"
summary
