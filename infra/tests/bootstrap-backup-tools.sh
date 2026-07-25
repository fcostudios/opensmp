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
readonly DOWNLOAD_DIR="$TOOL_DIR/downloads"
readonly BIN_DIR="$TOOL_DIR/bin"

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
  *) fail "unsupported host $(uname -s)-$(uname -m); install real age and bats manually" ;;
esac

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

if [[ ! -x "$BIN_DIR/age" || ! -x "$BIN_DIR/age-keygen" ]]; then
  rm -rf "$TOOL_DIR/age"
  tar --extract --gzip --file "$age_archive" --directory "$TOOL_DIR"
  ln -sf "$TOOL_DIR/age/age" "$BIN_DIR/age"
  ln -sf "$TOOL_DIR/age/age-keygen" "$BIN_DIR/age-keygen"
fi
if [[ ! -x "$BIN_DIR/bats" ]]; then
  rm -rf "$TOOL_DIR/bats-core-${BATS_VERSION}"
  tar --extract --gzip --file "$bats_archive" --directory "$TOOL_DIR"
  ln -sf "$TOOL_DIR/bats-core-${BATS_VERSION}/bin/bats" "$BIN_DIR/bats"
fi

printf '%s\n' "$BIN_DIR"
