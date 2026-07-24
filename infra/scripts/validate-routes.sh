#!/usr/bin/env bash
# validate-routes.sh — CI guard that enforces the invariant from docs/dev-guide/NAVIGATION.md:
#
#   Every Next.js route at apps/web/src/app/**/page.tsx must have a matching entry
#   in docs/specs/07c_navigation_map.json routes[].path
#
# Also checks (loose) that every nav-map route with layout=page has a folder in the
# Next.js tree. Dynamic segments (:id) are normalized to [id] for comparison.
#
# Exit code:
#   0 — aligned (no drift)
#   1 — drift detected (build should fail)
#
# Usage:
#   ./infra/scripts/validate-routes.sh            # from repo root
#   ./infra/scripts/validate-routes.sh --verbose  # explain every comparison

set -euo pipefail

VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=1 ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^#\s\?//' | head -30
      exit 0
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAV_MAP="$REPO_ROOT/docs/specs/07c_navigation_map.json"
APP_DIR="$REPO_ROOT/apps/web/src/app"

if [ ! -f "$NAV_MAP" ]; then
  echo "✗ Navigation map not found: $NAV_MAP"
  echo "  Run: ./infra/scripts/sync-from-nous.sh"
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "✗ Next.js app directory not found: $APP_DIR"
  exit 1
fi

# Extract paths from the nav map (routes[].path, only kind=page or unspecified — modals share parent paths)
NAV_PATHS=$(python3 <<EOF
import json
with open("$NAV_MAP") as f:
    n = json.load(f)
paths = []
for r in n.get("routes", []):
    if r.get("external") or r.get("redirect"):
        continue
    if r.get("layout") == "modal":
        # Modals render inline; their parent path is what's checked
        continue
    # IMP-246: read the CANONICAL route key (the schema carries route=, not the
    # legacy path= — reading path made NAV_PATHS empty, so the guard passed
    # vacuously on a 0-page package). path= kept as a back-compat alias.
    # (No backticks here: this is an UNQUOTED heredoc, so a backticked word would
    # be run as a command by the shell.)
    p = r.get("route") or r.get("path", "")
    if not p:
        continue
    # Normalize dynamic segments ':foo' to '[foo]' (Next.js app-router convention)
    import re as _re
    p_norm = _re.sub(r":(\w+)", r"[\1]", p)
    paths.append(p_norm)
print("\n".join(sorted(set(paths))))
EOF
)

# Discover Next.js routes by walking page.tsx files
# IMP-246: the root page lives at `(authenticated)/page.tsx` → after stripping
# the `/page.tsx` suffix and the `(route-group)` segment it collapses to the
# EMPTY string, which must map to `/`. The old `awk 'NF {…}'` guard DROPPED the
# empty record (NF==0 is false), so the root `/` was never discovered → the
# reverse navmap→page check flagged `/` as missing on every package. Map
# empty→`/` unconditionally (no NF guard).
DISCOVERED=$(cd "$APP_DIR" && find . -name "page.tsx" -not -path "*/node_modules/*" 2>/dev/null | \
  sed -E 's|^\.||; s|/page\.tsx$||' | \
  sed -E 's|/\([^)]+\)||g' | \
  awk '{ if ($0 == "") print "/"; else print $0 }' | \
  sort -u)

# Also include paths from (route-groups) normalized away — Next.js (folders) don't affect URL
# (The sed above strips them.)

# Show summary
total_nav=$(echo "$NAV_PATHS" | wc -l | tr -d ' ')
total_disc=$(echo "$DISCOVERED" | wc -l | tr -d ' ')

# Find discovered-but-not-in-map (missing in nav map)
# Strict: no exemption mechanism. The nav map is authoritative. If a dev needs a
# route before the map has it, the correct escape is to update the map (via CHG-NNN)
# and sync — NOT to add a bypass marker. Drift is always a build failure.
missing_in_map=()
while IFS= read -r path; do
  [ -z "$path" ] && continue
  # Skip Next.js reserved non-routes (api/ handlers, catch-all slugs used for 404s, route handlers)
  # Also skip /dev/* (dev-only storybook/preview, nav map marks as external:true)
  case "$path" in
    /api/*|*/\[\[*|*/route|/dev/*) continue ;;
  esac
  if ! echo "$NAV_PATHS" | grep -qFx "$path"; then
    missing_in_map+=("$path")
  fi
done <<< "$DISCOVERED"

# Find in-map-but-not-discovered (map declares a route with no page.tsx).
# IMP-246: this direction now FAILS THE BUILD (was warning-only). Every
# generated package ships a page.tsx per non-skip nav-map route (the generator
# scaffolds them), so a nav-map route with NO page is a real defect — the exact
# "0 routable pages" regression that previously passed vacuously. The page→map
# direction below catches drift the other way; both directions are now hard.
not_implemented=()
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! echo "$DISCOVERED" | grep -qFx "$path"; then
    not_implemented+=("$path")
  fi
done <<< "$NAV_PATHS"

echo "=== Route Alignment Check ==="
echo "  Nav map routes  (specced):  $total_nav"
echo "  Next.js pages   (code):     $total_disc"
echo

if [ "$VERBOSE" = "1" ]; then
  echo "--- Nav map routes ---"
  echo "$NAV_PATHS" | sed 's/^/    /'
  echo
  echo "--- Discovered pages ---"
  echo "$DISCOVERED" | sed 's/^/    /'
  echo
fi

if [ ${#missing_in_map[@]} -gt 0 ]; then
  echo "✗ ERRORS — ${#missing_in_map[@]} Next.js route(s) missing from nav map:"
  for p in "${missing_in_map[@]}"; do
    echo "    - $p"
  done
  echo
  echo "   Fix: update Nous/Specs/v1/07c_navigation_map.json to add these routes."
  echo "        Nav map is authoritative — no exemptions, no back doors."
  echo "        Nous edit → sync → code, in that order."
  echo "   Report: emit one nav_gap event per missing route (see docs/dev-guide/FEEDBACK.md)."
  echo
  EXIT=1
else
  echo "✓ Every Next.js route is registered in the nav map."
  EXIT=0
fi

if [ ${#not_implemented[@]} -gt 0 ]; then
  # IMP-246: nav-map route with no page.tsx is a hard failure (was warning-only).
  echo "✗ ERRORS — ${#not_implemented[@]} nav-map route(s) have NO page.tsx in code:"
  for p in "${not_implemented[@]}"; do
    echo "    - $p"
  done
  echo
  echo "   Every non-skip nav-map route must have a generated page.tsx."
  echo "   Re-run the package generator (nous_package.py generate/sync) — a 0-page"
  echo "   or partial scaffold is the IMP-246 'no routable pages' defect."
  echo
  EXIT=1
fi

exit "$EXIT"
