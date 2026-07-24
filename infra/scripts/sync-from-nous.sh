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
# Override the Nous checkout with NOUS_SYSTEM (defaults to the path this
# package was generated from):
#   NOUS_SYSTEM=/path/to/nous/Nous/System ./infra/scripts/sync-from-nous.sh

NOUS_SYSTEM="${NOUS_SYSTEM:-/Users/fcolomas/Projects/nous/Nous/System}"
TARGET="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Syncing from Nous ==="
echo "    Source: $NOUS_SYSTEM"
echo "    Target: $TARGET"
echo ""

python3 "$NOUS_SYSTEM/nous_package.py" sync \
    --target "$TARGET" \
    --project fcostudios__smp \
    "$@"

for argument in "$@"; do
    if [[ "$argument" == "--dry-run" ]]; then
        echo ""
        echo "=== Skipping Ledger overrides during dry run ==="
        echo ""
        echo "=== Sync complete ==="
        exit 0
    fi
done

echo ""
echo "=== Applying Ledger CHG-001 documentation overrides ==="
python3 "$TARGET/infra/scripts/reconcile-sprint1-docs.py" "$TARGET"

echo ""
echo "=== Sync complete ==="
