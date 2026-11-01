#!/usr/bin/env bash
set -euo pipefail

# Sync Nous pipeline changes to this dev package.
# Uses nous_package.py sync (manifest-based, hash-diffed).
#
# Usage:
#   ./infra/scripts/sync-from-nous.sh              # sync all
#   ./infra/scripts/sync-from-nous.sh --dry-run     # preview changes
#   ./infra/scripts/sync-from-nous.sh -c stories migrations  # selective
#
# CHG-112 / DEC-SMP-065: generated guidance is accepted from Nous directly;
# retired repository pins must not reapply tenant gate instructions after sync.
#
# Override the Nous checkout with NOUS_SYSTEM (defaults to the path this
# package was generated from):
#   NOUS_SYSTEM=/path/to/nous/Nous/System ./infra/scripts/sync-from-nous.sh

NOUS_SYSTEM="${NOUS_SYSTEM:-/Users/fcolomas/Projects/nous/Nous/System}"
TARGET="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Syncing from Nous ==="
echo "    Source: $NOUS_SYSTEM"
echo "    Target: $TARGET"
echo ""

DRY_RUN=false
SYNC_ARGUMENTS=("__ledger_argument_sentinel__")
for argument in "$@"; do
    if [[ "$argument" == "--dry-run" ]]; then
        DRY_RUN=true
    else
        SYNC_ARGUMENTS+=("$argument")
    fi
done

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== Nous native no-write preview ==="
    python3 "$NOUS_SYSTEM/nous_package.py" sync \
        --target "$TARGET" \
        --project fcostudios__smp \
        --dry-run \
        "${SYNC_ARGUMENTS[@]:1}"

    echo ""
    echo "=== Sync preview complete; working tree unchanged ==="
    exit 0
fi

python3 "$NOUS_SYSTEM/nous_package.py" sync \
    --target "$TARGET" \
    --project fcostudios__smp \
    "${SYNC_ARGUMENTS[@]:1}"

echo ""
echo "=== Sync complete ==="
