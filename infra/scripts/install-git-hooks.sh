#!/usr/bin/env bash
# install-git-hooks.sh — wire .githooks/ into this clone.
#
# Run once after cloning. Idempotent — safe to run repeatedly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d .githooks ]; then
  echo "✗ .githooks/ not found at $REPO_ROOT" >&2
  exit 1
fi

chmod +x .githooks/*
git config core.hooksPath .githooks

echo "✓ Git hooks installed from .githooks/"
echo "  core.hooksPath = $(git config core.hooksPath)"
echo ""
echo "Hooks active:"
for h in .githooks/*; do
  [ -f "$h" ] && echo "  - $(basename "$h")"
done
