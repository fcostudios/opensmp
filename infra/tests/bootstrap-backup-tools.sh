#!/usr/bin/env bash
# Fetches pinned, real test binaries into a gitignored directory. It never
# installs tools system-wide and refuses a download whose checksum differs.
set -euo pipefail
umask 077

readonly AGE_VERSION='1.2.1'
readonly BATS_VERSION='1.11.1'
readonly BATS_SHA256='5c57ed9616b78f7fd8c553b9bae3c7c9870119edd727ec17dbd1185c599f79d9'
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly TOOL_DIR="${BACKUP_TEST_TOOL_DIR:-$ROOT_DIR/.tmp/backup-restore-tools}"

fail() {
  printf 'backup test bootstrap: %s\n' "$*" >&2
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    age_platform='darwin-arm64'
    age_sha256='cf79875bd5970dc2dac60c87fa50cee1ff1f9a41b0eb273f65e174aff37c367a'
    ;;
  Linux-x86_64)
    age_platform='linux-amd64'
    age_sha256='7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50'
    ;;
  Linux-aarch64)
    age_platform='linux-arm64'
    # SHA-256 derived from the official v1.2.1 release artifact on 2026-07-25.
    age_sha256='57fd79a7ece5fe501f351b9dd51a82fbee1ea8db65a8839db17f5c080245e99f'
    ;;
  *) fail "unsupported host $(uname -s)-$(uname -m); install real age and bats manually" ;;
esac

[[ "$TOOL_DIR" == "$ROOT_DIR/.tmp/"* && "$TOOL_DIR" != *'/../'* && "$TOOL_DIR" != *'/./'* ]] || fail 'tool directory traversal is not permitted'
mkdir -p "$ROOT_DIR/.tmp"
[[ ! -L "$ROOT_DIR/.tmp" && ! -L "$TOOL_DIR" ]] || fail 'tool directory and repository .tmp must not be symlinks'
marker_is_owned() {
  local marker="$1" marker_owner
  [[ -f "$marker" && ! -L "$marker" ]] || return 1
  marker_owner="$(stat -f '%u' "$marker" 2>/dev/null || stat -c '%u' "$marker")"
  [[ "$marker_owner" == "$(id -u)" ]]
}

if [[ -e "$TOOL_DIR/.owner" && ! -L "$TOOL_DIR/.owner" ]] && ! marker_is_owned "$TOOL_DIR/.owner"; then
  fail 'tool ownership marker belongs to another user'
fi
if marker_is_owned "$TOOL_DIR/.owner" && [[ -x "$TOOL_DIR/bin/age" && -x "$TOOL_DIR/bin/age-keygen" && -x "$TOOL_DIR/bin/bats" ]]; then
  printf '%s\n' "$TOOL_DIR/bin"
  exit 0
fi

lock_dir="$TOOL_DIR.lock"
[[ ! -L "$lock_dir" ]] || fail 'bootstrap lock must not be a symlink'
mkdir "$lock_dir" 2>/dev/null || fail 'another backup tool bootstrap is in progress'
stage_dir="$(mktemp -d "$ROOT_DIR/.tmp/.backup-restore-tools.XXXXXX")"
cleanup() { rm -rf -- "$stage_dir" "$lock_dir"; }
trap cleanup EXIT INT TERM
readonly DOWNLOAD_DIR="$stage_dir/downloads"
readonly BIN_DIR="$stage_dir/bin"
mkdir -p "$DOWNLOAD_DIR" "$BIN_DIR"

fetch_verified() {
  local url="$1"
  local destination="$2"
  local expected="$3"
  local actual

  if [[ ! -f "$destination" ]]; then
    curl --fail --location --silent --show-error "$url" --output "$destination.partial"
    mv "$destination.partial" "$destination"
  fi
  actual="$(shasum --algorithm 256 "$destination" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || fail "checksum mismatch for $(basename "$destination")"
}

age_archive="$DOWNLOAD_DIR/age-v${AGE_VERSION}-${age_platform}.tar.gz"
bats_archive="$DOWNLOAD_DIR/bats-core-v${BATS_VERSION}.tar.gz"
fetch_verified "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/$(basename "$age_archive")" "$age_archive" "$age_sha256"
fetch_verified "https://codeload.github.com/bats-core/bats-core/tar.gz/refs/tags/v${BATS_VERSION}" "$bats_archive" "$BATS_SHA256"

tar --extract --gzip --file "$age_archive" --directory "$stage_dir"
ln -s ../age/age "$BIN_DIR/age"
ln -s ../age/age-keygen "$BIN_DIR/age-keygen"
tar --extract --gzip --file "$bats_archive" --directory "$stage_dir"
ln -s "../bats-core-${BATS_VERSION}/bin/bats" "$BIN_DIR/bats"
: > "$stage_dir/.owner"
chmod 0600 "$stage_dir/.owner"
[[ ! -e "$TOOL_DIR" ]] || fail 'tool install appeared during bootstrap; retry'
mv -- "$stage_dir" "$TOOL_DIR"
stage_dir=''
rm -rf -- "$lock_dir"
trap - EXIT INT TERM

printf '%s\n' "$TOOL_DIR/bin"
