#!/usr/bin/env python3
"""regenerate-sidebar.py — write nav-items.gen.ts from the nav map.

The sidebar is a UX decision owned by the nav map (`app_shell.sidebar.items[]` +
`app_shell.mobile_bottom_bar.items[]`). This generator flattens that spec into a
TypeScript module that sidebar.tsx imports — keeping ordering, roles, badges, and
labels in sync with one run.

Usage (from repo root):
  ./infra/scripts/regenerate-sidebar.py
  ./infra/scripts/regenerate-sidebar.py --check   # non-writing, exit 1 if out of sync

The generator is idempotent. Runs in <1s. Safe in pre-commit / CI.

IMP-325 — icon vocabulary is DERIVED, not authored. There is no hardcoded
ICON_MAP (that was one project's SaleOS/CRM vocabulary, which silently flattened
every other project's icons to `Circle` and got mapped over each dev package on
sync). Instead we resolve each declared icon against a checked-in registry of
valid `lucide-react` exports (`infra/scripts/lucide_valid_exports.json`, synced
from `Nous/System/schemas/`): a declared icon that IS a valid export resolves to
itself; an item that declares NO icon falls back to `Circle`. A declared icon
that is NOT a valid export (a typo, or a foreign vocabulary) is a LOUD ERROR —
`--check` and writer mode both exit 1 and the writer refuses to bake a `Circle`.
The emitted allow-list is per-project (declared ∩ valid ∪ {fallback}), preserving
IMP-245's self-pass invariant (the generated module passes its own
check-lucide-allowlist.mjs).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
NAV_MAP = REPO_ROOT / "docs" / "specs" / "07c_navigation_map.json"
OUT_FILE = REPO_ROOT / "apps" / "web" / "src" / "components" / "shell" / "nav-items.gen.ts"

# IMP-137 / I03: Lucide icon allow-list emission. We emit a sibling JSON every
# run (declared ∩ valid ∪ {fallback}) so the Nous pipeline's ready-check 100 can
# validate sidebar icons against it. Idempotent: only writes when the content
# would change.
ALLOW_LIST_OUT = REPO_ROOT / "infra" / "scripts" / "allowed_lucide_icons.json"
ALLOW_LIST_VERSION = "1"

# IMP-325: the valid-lucide-export registry — the SINGLE source of "is this a
# real icon name?". Synced from Nous/System/schemas/lucide_valid_exports.json.
LUCIDE_REGISTRY = REPO_ROOT / "infra" / "scripts" / "lucide_valid_exports.json"

# IMP-325 follow-up (codex-review hardening 2): OPTIONAL curated supplemental
# icons used by non-nav UI (headers, banners, dashboards). The allow-list gate
# scans the WHOLE repo (check-lucide-allowlist.mjs), so icons imported outside
# the sidebar must be deliberately allow-listed here — validated against the
# registry exactly like nav icons (a typo fails loud, same as a nav icon).
# Shape: {"icons": ["Bell", ...]}. Absent file == empty list (nav-only repos).
EXTRA_ICONS_FILE = REPO_ROOT / "infra" / "scripts" / "lucide_extra_icons.json"


def load_extra_icons(valid: frozenset[str]) -> frozenset[str]:
    """Load the optional curated non-nav icon list; every name must be a valid
    lucide export — an invalid name is a LOUD error, not a silent drop."""
    if not EXTRA_ICONS_FILE.exists():
        return frozenset()
    data = json.loads(EXTRA_ICONS_FILE.read_text(encoding="utf-8"))
    icons = data.get("icons")
    if not isinstance(icons, list):
        print(f"✗ Malformed (no 'icons' list): {EXTRA_ICONS_FILE}", file=sys.stderr)
        sys.exit(1)
    bad = sorted(set(icons) - set(valid))
    if bad:
        print(f"✗ lucide_extra_icons.json names non-existent lucide exports: {', '.join(bad)}",
              file=sys.stderr)
        sys.exit(1)
    return frozenset(icons)

# The fallback icon emitted for nav items that declare NO icon. It is threaded
# through both build_sidebar_array (the emitted import/icon) AND
# allow_list_payload (so the allow-list = declared ∩ valid ∪ fallback). Keeping
# it one constant is what makes the generated nav-items.gen.ts pass its OWN
# check-lucide-allowlist.mjs (IMP-245 / I01). A DECLARED icon never legally
# resolves to this — if it would, main() errors out first (IMP-325).
FALLBACK_ICON = "Circle"


def load_valid_exports() -> frozenset[str]:
    """Load the valid-lucide-export registry (IMP-325). Fails loud if absent —
    the icon vocabulary cannot be derived without it."""
    if not LUCIDE_REGISTRY.exists():
        print(f"✗ Lucide registry not found: {LUCIDE_REGISTRY}", file=sys.stderr)
        print("  Run: ./infra/scripts/sync-from-nous.sh "
              "(it syncs lucide_valid_exports.json)", file=sys.stderr)
        sys.exit(1)
    data = json.loads(LUCIDE_REGISTRY.read_text(encoding="utf-8"))
    icons = data.get("icons")
    if not isinstance(icons, list) or not icons:
        print(f"✗ Lucide registry malformed (no 'icons' list): {LUCIDE_REGISTRY}",
              file=sys.stderr)
        sys.exit(1)
    return frozenset(icons)


def load_nav_map() -> dict:
    if not NAV_MAP.exists():
        print(f"✗ Nav map not found: {NAV_MAP}", file=sys.stderr)
        print("  Run: ./infra/scripts/sync-from-nous.sh", file=sys.stderr)
        sys.exit(1)
    with NAV_MAP.open() as f:
        return json.load(f)


def _sidebar_items(nav: dict) -> list[dict]:
    return nav["app_shell"]["sidebar"]["items"]


def declared_fallbacks(nav: dict, valid: frozenset[str] | None = None) -> list[tuple[str, str]]:
    """Return [(item_id, icon)] for items that DECLARE an icon which is not a
    valid lucide export — i.e. would silently fall back to Circle. This is the
    IMP-325 error set. Items that declare no icon are NOT included (the fallback
    stays legal for undeclared)."""
    if valid is None:
        valid = load_valid_exports()
    out: list[tuple[str, str]] = []
    for it in _sidebar_items(nav):
        icon = it.get("icon")
        if icon and icon not in valid:
            out.append((it["id"], icon))
    return out


def resolve_icon(icon: str | None, valid: frozenset[str]) -> str:
    """A declared valid icon resolves to itself; anything else → FALLBACK_ICON.
    (An INVALID declared icon reaching here means main() did not gate it — that
    only happens for callers that bypass main(), e.g. the pure generate_ts test
    surface; main() itself errors before generation.)"""
    if icon and icon in valid:
        return icon
    return FALLBACK_ICON


def tsroles(roles: list[str]) -> str:
    """Convert nav-map roles (lowercase) to the dev-package UserRole enum (uppercase)."""
    if not roles or roles == ["all"]:
        return "undefined"
    upper = [f'"{r.upper()}"' for r in roles if r != "all"]
    return f"[{', '.join(upper)}]"


def label_key(item_id: str) -> str:
    """Convert nav item ids such as nav-import-data to i18n keys."""
    key_overrides = {
        "nav-cycles": "nav.cycle_targets",
        "nav-developers-api-keys": "nav.developer_keys",
        "nav-developers-webhooks": "nav.developer_webhooks",
        "nav-developers-deliveries": "nav.developer_deliveries",
    }
    if item_id in key_overrides:
        return key_overrides[item_id]
    key = item_id.removeprefix("nav-").replace("-", "_")
    return f"nav.{key}"


def build_sidebar_array(items: list[dict], valid: frozenset[str]) -> tuple[list[str], list[str]]:
    """Return (imports, array_lines) for the sidebar items."""
    icons_used: set[str] = set()
    lines: list[str] = []
    for it in items:
        resolved = resolve_icon(it.get("icon"), valid)
        icons_used.add(resolved)
        lines.append(
            "  {\n"
            f'    id: "{it["id"]}",\n'
            f'    label: "{it["label"]}",\n'
            f'    labelKey: "{label_key(it["id"])}",\n'
            f'    icon: {resolved},\n'
            f'    href: "{it["route"]}",\n'
            f'    screenId: "{it.get("screen", "")}",\n'
            f"    roles: {tsroles(it.get('roles', []))},\n"
            + (f'    badge: "{it["badge"]}",\n' if it.get("badge") else "")
            + (f'    position: "{it["position"]}",\n' if it.get("position") else "")
            + "  }"
        )
    return sorted(icons_used), lines


def generate_ts(nav: dict, valid: frozenset[str] | None = None) -> str:
    if valid is None:
        valid = load_valid_exports()
    sidebar_items = _sidebar_items(nav)
    icons, lines = build_sidebar_array(sidebar_items, valid)

    meta = nav.get("meta", {})
    generated_at = meta.get("updated") or meta.get("generated", "unknown")

    header = (
        "// AUTO-GENERATED — DO NOT EDIT.\n"
        "// Source:      docs/specs/07c_navigation_map.json  (app_shell.sidebar.items[])\n"
        "// Generator:   infra/scripts/regenerate-sidebar.py\n"
        f"// Nav map updated:  {generated_at}\n"
        "//\n"
        "// Sidebar ordering, role gates, labels, and badges live in the nav map.\n"
        "// To change anything here, update the nav map in Nous and re-run the generator.\n"
        "// Regenerate with:  ./infra/scripts/regenerate-sidebar.py\n"
        "\n"
    )
    imports = "import {\n  " + ",\n  ".join(icons) + ",\n  type LucideIcon,\n} from \"lucide-react\";\n\n"

    # IMP-248 / I01 (tsc cleanliness) — `UserRole` was imported from
    # `@/hooks/useAuth`, a module the generator NEVER emits → `tsc` TS2307
    # ("Cannot find module"). `nav-items.gen.ts` is the SOLE referencer of
    # UserRole, so we DEFINE it locally as a deterministic union of the actual
    # nav-map roles (uppercased to the dev-package convention) instead of
    # importing a non-existent hook. Sorted for HR-3 determinism.
    role_set: set[str] = set()
    for it in sidebar_items:
        for r in (it.get("roles") or []):
            if r and r != "all":
                role_set.add(r.upper())
    if role_set:
        user_role = " | ".join(f'"{r}"' for r in sorted(role_set))
    else:
        user_role = "string"
    type_def = (
        "// UserRole — the distinct roles the nav map gates sidebar items on.\n"
        "// Generated locally (the dev team may re-home this in a real auth hook).\n"
        f"export type UserRole = {user_role};\n\n"
        "export interface NavItem {\n"
        "  id: string;\n"
        "  label: string;\n"
        "  labelKey: string;\n"
        "  icon: LucideIcon;\n"
        "  href: string;\n"
        "  screenId: string;\n"
        "  roles?: UserRole[];\n"
        '  /** Key on the API unread-count response — renders a numeric badge when > 0. */\n'
        "  badge?: string;\n"
        '  /** Sidebar placement bucket — "bottom" pins to the foot (e.g. Profile,\n'
        '   *  Admin); "top"/"middle" order within the main list. */\n'
        '  position?: "top" | "middle" | "bottom";\n'
        "}\n\n"
    )

    array = (
        "export const navItems: readonly NavItem[] = [\n"
        + ",\n".join(lines)
        + ",\n] as const;\n"
    )

    return header + imports + type_def + array


def allow_list_payload(nav: dict, valid: frozenset[str] | None = None) -> dict:
    """Canonical allow-list shape: sorted icon list with version stamp.

    IMP-325: per-project — the declared icons that ARE valid lucide exports,
    unioned with the generator's fallback. (declared ∩ valid ∪ {FALLBACK_ICON}).
    A generated nav-items.gen.ts imports only names in this set (IMP-245 self-pass
    invariant), because every emitted icon is either a declared-valid icon or the
    fallback.
    """
    if valid is None:
        valid = load_valid_exports()
    declared = {it["icon"] for it in _sidebar_items(nav) if it.get("icon")}
    icons = sorted((declared & set(valid)) | set(load_extra_icons(valid)) | {FALLBACK_ICON})
    return {
        "version": ALLOW_LIST_VERSION,
        "description": (
            "Lucide icon allow-list — the per-project set of declared nav-map "
            "icons (validated against lucide_valid_exports.json) plus the "
            "generator fallback. Emitted by regenerate-sidebar.py (IMP-137 / "
            "IMP-325). Consumed by Nous/System/spec_parsers/sidebar_parser.py "
            "and ready-check 100 (HR-30). DO NOT EDIT BY HAND — regenerated on "
            "every regenerate-sidebar.py invocation."
        ),
        "icons": icons,
    }


def allow_list_serialised(nav: dict, valid: frozenset[str] | None = None) -> str:
    return json.dumps(allow_list_payload(nav, valid), indent=2, ensure_ascii=False) + "\n"


def emit_allow_list(nav: dict, check_mode: bool,
                    valid: frozenset[str] | None = None) -> tuple[bool, bool]:
    """Emit (or check) the allow-list JSON. Returns (changed, ok).

    In writer mode: writes the file when content differs; idempotent.
    In --check mode: returns ok=False if the file is missing or stale.
    """
    new_content = allow_list_serialised(nav, valid)
    if check_mode:
        if not ALLOW_LIST_OUT.exists():
            print(
                f"✗ {ALLOW_LIST_OUT.relative_to(REPO_ROOT)} does not exist — "
                f"run regenerate-sidebar.py to emit it",
                file=sys.stderr,
            )
            return (True, False)
        current = ALLOW_LIST_OUT.read_text(encoding="utf-8")
        if current == new_content:
            return (False, True)
        print(
            f"✗ {ALLOW_LIST_OUT.relative_to(REPO_ROOT)} is OUT OF SYNC "
            f"with the nav map's declared icons",
            file=sys.stderr,
        )
        return (True, False)

    ALLOW_LIST_OUT.parent.mkdir(parents=True, exist_ok=True)
    current = ALLOW_LIST_OUT.read_text(encoding="utf-8") if ALLOW_LIST_OUT.exists() else ""
    if current == new_content:
        return (False, True)
    ALLOW_LIST_OUT.write_text(new_content, encoding="utf-8")
    return (True, True)


def _report_declared_fallbacks(fbs: list[tuple[str, str]]) -> None:
    """Print the IMP-325 declared-icon-fallback error block to stderr."""
    for item_id, icon in fbs:
        print(
            f"✗ {item_id}: declared icon {icon!r} would fall back to Circle — "
            f"it is not a valid lucide-react export "
            f"(infra/scripts/lucide_valid_exports.json)",
            file=sys.stderr,
        )
    print(
        f"ERROR: {len(fbs)} declared sidebar icon(s) would silently degrade to "
        f"Circle. Fix the nav map icon name(s), or add the icon to the registry "
        f"if it is a genuine lucide export. (An item with NO icon key legally "
        f"uses Circle.)",
        file=sys.stderr,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate sidebar nav-items.gen.ts from the nav map.")
    parser.add_argument("--check", action="store_true", help="Don't write; exit 1 if file would change")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    nav = load_nav_map()
    valid = load_valid_exports()

    # IMP-325 — declared-icon fallback is a LOUD ERROR in BOTH --check and writer
    # mode. The writer refuses to bake a Circle for a declared icon.
    fbs = declared_fallbacks(nav, valid)
    if fbs:
        _report_declared_fallbacks(fbs)
        return 1

    new_content = generate_ts(nav, valid)

    if args.check:
        # 1) nav-items.gen.ts in sync
        rc = 0
        if not OUT_FILE.exists():
            print(f"✗ {OUT_FILE} does not exist — run regenerate-sidebar.py (without --check)", file=sys.stderr)
            rc = 1
        else:
            current = OUT_FILE.read_text(encoding="utf-8")
            if current == new_content:
                print(f"✓ {OUT_FILE.name} is in sync with the nav map.")
            else:
                print(f"✗ {OUT_FILE.name} is OUT OF SYNC with the nav map. Run regenerate-sidebar.py.", file=sys.stderr)
                rc = 1
        # 2) allow-list in sync (IMP-137 / I03)
        _, ok = emit_allow_list(nav, check_mode=True, valid=valid)
        if not ok:
            rc = 1
        else:
            print(f"✓ {ALLOW_LIST_OUT.name} is in sync with the nav map.")
        return rc

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(new_content, encoding="utf-8")
    items = _sidebar_items(nav)
    print(f"✓ Wrote {OUT_FILE.relative_to(REPO_ROOT)} ({len(items)} nav items)")
    # Emit allow-list (IMP-137 / I03)
    changed, _ = emit_allow_list(nav, check_mode=False, valid=valid)
    n_icons = len(allow_list_payload(nav, valid)["icons"])
    if changed:
        print(f"✓ Wrote {ALLOW_LIST_OUT.relative_to(REPO_ROOT)} ({n_icons} icons)")
    else:
        print(f"  {ALLOW_LIST_OUT.relative_to(REPO_ROOT)} unchanged ({n_icons} icons)")
    if args.verbose:
        for it in items:
            print(f"    {it['id']:<28} {it['route']:<25} roles={it.get('roles', ['all'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
