#!/usr/bin/env python3
"""Apply Ledger's CHG-001 overrides after a Nous documentation sync.

Nous currently derives generic tenant guidance from the Next.js stack and has
no project-level package-map sync category. Ledger's authoritative ER model
uses company_id instead. Keep these narrow overrides in the project sync path
until the generic generator consumes project_configs.tenancy.column.
"""

from __future__ import annotations

import sys
from pathlib import Path


REPLACEMENTS = {
    "docs/dev-guide/TESTING.md": (
        (
            "every path that touches tenant-scoped data (filtered by `org_id`).",
            "every path that touches tenant-scoped data (filtered by `company_id`).",
        ),
    ),
    "testing/critical-paths.md": (
        (
            "every path that touches tenant-scoped data (filtered by `org_id`).",
            "every path that touches tenant-scoped data (filtered by `company_id`).",
        ),
    ),
    "docs/dev-guide/PACKAGE_MAP.md": (
        (
            "db table + `org_id` and both a read-list and a mutation screen",
            "db table + `company_id` and both a read-list and a mutation screen",
        ),
        (
            "take the tenant from the session, never the client.",
            "load authorized company scope from Ledger DB after verifying the "
            "session; never take it from the client.",
        ),
    ),
}


def reconcile(root: Path) -> None:
    for relative_path, replacements in REPLACEMENTS.items():
        path = root / relative_path
        text = path.read_text(encoding="utf-8")
        updated = text

        for stale, expected in replacements:
            if stale in updated:
                updated = updated.replace(stale, expected)
            elif expected not in updated:
                raise RuntimeError(
                    f"{relative_path}: neither stale nor expected CHG-001 text found"
                )

        if updated != text:
            path.write_text(updated, encoding="utf-8")
            print(f"  reconciled: {relative_path}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: reconcile-sprint1-docs.py <project-root>")
    reconcile(Path(sys.argv[1]).resolve())
