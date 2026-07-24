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
# Category selection limits Nous generation only. Ledger's post-sync guidance
# reconciliation is intentionally repository-wide because parity and forbidden
# guidance are repository invariants, not generator categories.
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
    python3 "$NOUS_SYSTEM/nous_package.py" sync \
        --target "$TARGET" \
        --project fcostudios__smp \
        --dry-run \
        "${SYNC_ARGUMENTS[@]:1}"

    PREVIEW_DIRECTORY="$(mktemp -d)"
    PREVIEW_TARGET="$PREVIEW_DIRECTORY/project"
    trap 'rm -rf "$PREVIEW_DIRECTORY"' EXIT
    mkdir -p "$PREVIEW_TARGET"
    cp -R "$TARGET/." "$PREVIEW_TARGET/"
    # Never let tools invoked in the preview resolve the real worktree metadata.
    rm -rf "$PREVIEW_TARGET/.git"

    python3 "$NOUS_SYSTEM/nous_package.py" sync \
        --target "$PREVIEW_TARGET" \
        --project fcostudios__smp \
        "${SYNC_ARGUMENTS[@]:1}" \
        >/dev/null
    python3 "$PREVIEW_TARGET/infra/scripts/reconcile-sprint1-docs.py" \
        "$PREVIEW_TARGET" \
        >/dev/null

    echo ""
    echo "=== Combined effective preview (Nous + repository-wide Ledger invariants) ==="
    set +e
    diff -ruN \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='*.tsbuildinfo' \
        "$TARGET" \
        "$PREVIEW_TARGET"
    DIFF_STATUS=$?
    set -e
    if [[ "$DIFF_STATUS" -gt 1 ]]; then
        exit "$DIFF_STATUS"
    fi
    echo ""
    echo "=== Sync preview complete; working tree unchanged ==="
    exit 0
fi

python3 "$NOUS_SYSTEM/nous_package.py" sync \
    --target "$TARGET" \
    --project fcostudios__smp \
    "${SYNC_ARGUMENTS[@]:1}"

echo ""
echo "=== Applying repository-wide Ledger documentation invariants ==="
python3 "$TARGET/infra/scripts/reconcile-sprint1-docs.py" "$TARGET"

echo ""
echo "=== Sync complete ==="
