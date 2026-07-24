#!/usr/bin/env bash
# scaffold-route.sh — Generate a Next.js App Router page stub from the nav map.
#
# Reads docs/specs/07c_navigation_map.json and produces:
#   apps/web/src/app/{normalized-path}/page.tsx
#
# The stub includes:
#   - Role-gated wrapper (from routes[].roles)
#   - Page title from routes[].title
#   - TODO marker referencing the TOON JSON + HTML mock for the designer's intent
#
# Usage:
#   ./infra/scripts/scaffold-route.sh SCR-31
#   ./infra/scripts/scaffold-route.sh SCR-31 --force   # overwrite existing file
#   ./infra/scripts/scaffold-route.sh --list           # list all SCR- IDs with their routes
#
# Exit:
#   0 — scaffolded (or already existed and --force not given)
#   1 — error (invalid SCR, nav map not found, etc.)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAV_MAP="$REPO_ROOT/docs/specs/07c_navigation_map.json"
APP_DIR="$REPO_ROOT/apps/web/src/app"

if [ $# -eq 0 ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  grep '^#' "$0" | sed 's/^#\s\?//' | head -20
  exit 0
fi

if [ "${1:-}" = "--list" ]; then
  python3 <<EOF
import json
with open("$NAV_MAP") as f:
    n = json.load(f)
print(f"{'SCR':<8} {'ROUTE':<55} {'TITLE':<40} ROLES")
print("─" * 120)
for r in sorted(n.get("routes", []), key=lambda x: x.get("screen", "")):
    scr = r.get("screen", "—")
    path = r.get("path", "—")
    title = r.get("title", "—")
    roles = ",".join(r.get("roles", ["—"]))
    if r.get("layout") == "modal":
        title = f"{title} (modal)"
    print(f"{scr:<8} {path:<55} {title:<40} {roles}")
EOF
  exit 0
fi

SCR="$1"
FORCE=0
[ "${2:-}" = "--force" ] && FORCE=1

if [ ! -f "$NAV_MAP" ]; then
  echo "✗ Navigation map not found: $NAV_MAP"
  echo "  Run: ./infra/scripts/sync-from-nous.sh"
  exit 1
fi

# Look up the route entry
ROUTE_INFO=$(python3 <<EOF
import json, sys
with open("$NAV_MAP") as f:
    n = json.load(f)
entry = next((r for r in n.get("routes", []) if r.get("screen") == "$SCR"), None)
if not entry:
    sys.exit(2)
print(entry.get("path", ""))
print(entry.get("title", ""))
print(",".join(entry.get("roles", [])))
print(entry.get("layout", "page"))
EOF
) || {
  echo "✗ No entry for $SCR in nav map."
  echo "  Either the SCR ID is wrong or the nav map is stale."
  echo "  List available IDs: $0 --list"
  exit 1
}

PATH_RAW=$(echo "$ROUTE_INFO" | sed -n '1p')
TITLE=$(echo "$ROUTE_INFO" | sed -n '2p')
ROLES=$(echo "$ROUTE_INFO" | sed -n '3p')
LAYOUT=$(echo "$ROUTE_INFO" | sed -n '4p')

# Normalize dynamic segments ':param' → '[param]' for Next.js App Router
PATH_NEXTJS=$(echo "$PATH_RAW" | sed -E 's|:(\w+)|[\1]|g')

# Target file
if [ "$LAYOUT" = "modal" ]; then
  echo "⚠  $SCR has layout=modal. Modals aren't standalone pages — they render as overlays on a parent route."
  echo "   Parent route is typically the URL segment before the dynamic segment."
  echo "   Consider generating a modal component instead (future work)."
  echo "   If you still want a standalone page, pass --force."
  if [ "$FORCE" != "1" ]; then
    exit 0
  fi
fi

TARGET="$APP_DIR$PATH_NEXTJS/page.tsx"
TARGET_DIR=$(dirname "$TARGET")

if [ -f "$TARGET" ] && [ "$FORCE" != "1" ]; then
  echo "✓ Already exists: $TARGET"
  echo "  Use --force to overwrite."
  exit 0
fi

mkdir -p "$TARGET_DIR"

# Format role list for TS
ROLES_TS=$(echo "$ROLES" | tr ',' '\n' | awk 'NF {print "\""$1"\""}' | paste -sd "," -)

# Generate
cat > "$TARGET" <<TSEOF
// Auto-scaffolded from nav map entry for $SCR ($PATH_RAW)
// TOON spec:  Nous/Specs/v1/toon/${SCR}.json
// HTML mock:  Nous/Specs/v1/html_mocks/${SCR}.html (preview intended UX)
// Generated:  $(date -u +%Y-%m-%dT%H:%M:%SZ) by scaffold-route.sh
//
// TODO: replace the placeholder with real implementation. Do NOT change the
// route path — it's the contract from the nav map. If you need a different
// path, update Nous/Specs/v1/07c_navigation_map.json first.

import { requireRole } from "@/lib/auth/guards";

export const metadata = { title: "$TITLE" };

export default async function Page() {
  await requireRole([${ROLES_TS}]);

  return (
    <main className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">$TITLE</h1>
        <p className="text-sm text-slate-500">
          Scaffolded from $SCR. Replace with the real implementation.
        </p>
      </header>

      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <p className="text-sm text-slate-600">
          Placeholder — see the HTML mock at{" "}
          <code className="font-mono">Nous/Specs/v1/html_mocks/${SCR}.html</code>{" "}
          for intended UX.
        </p>
      </section>
    </main>
  );
}
TSEOF

echo "✓ Scaffolded $TARGET"
echo "  Route:   $PATH_RAW → $PATH_NEXTJS"
echo "  Title:   $TITLE"
echo "  Roles:   $ROLES"
echo "  Mock:    Nous/Specs/v1/html_mocks/${SCR}.html"
echo
echo "Reminder: if this screen belongs in the sidebar, add it to app_shell.sidebar.items[]"
echo "          in the nav map, then run infra/scripts/regenerate-sidebar.py (the runtime"
echo "          sidebar at apps/web/src/components/layout/sidebar.tsx reads the generated"
echo "          apps/web/src/components/shell/nav-items.gen.ts — never hand-edit it)."
