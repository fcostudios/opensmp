#!/usr/bin/env python3
"""Enforce Ledger's CHG-001 generated-document invariants.

Nous currently emits a few generic defaults that conflict with Ledger's
company-scoped execution contract. This project-owned post-sync step validates
the complete effective document set before writing, applies narrow overrides,
and keeps every coding-agent mirror byte-identical to CLAUDE.md.
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
import tempfile
from pathlib import Path


COMPLETE_CHANGE_NOTES = (
    "**Notes:** CHG-001 reconciles Sprint 1 guidance with "
    "[DEC-SMP-017](../decisions/DEC-SMP-017-sprint-1-execution-contract.md): "
    "`company_id` scoping, Keycloak/Auth.js redirect-based OIDC, and "
    "Docker Compose self-hosting."
)

REPLACEMENTS = {
    "docs/dev-guide/DEFINITION_OF_DONE.md": (
        (
            """5. **Schema applies on a fresh database (and is verified):**
   - **Prerequisite:** `DATABASE_URL` must be set to a reachable Postgres before this
     step — copy `.env.example` → `.env` and set it (or run `task setup`). The bare
     `push` below silently no-ops against an unset/unreachable URL.
   ```bash
   cd packages/db && pnpm drizzle-kit push && node scripts/verify-schema.mjs
   ```
   - `drizzle-kit push` exits **0 even on an unreachable `DATABASE_URL`** (a silent
     no-op: 0 tables). `verify-schema.mjs` counts the applied tables and exits
     non-zero on 0 — so "schema applies cleanly" can no longer be a false pass.
   - The DB client auto-selects its driver by `DATABASE_URL` (`pg` for a local/
     standard Postgres URL, `neon-http` for a Neon URL), so `push` applies locally.
   - Migrations live in `packages/db/src/migrations/` as `V<timestamp>__<slug>.sql`.
   - Once applied, a migration file is immutable — add a new one; never edit it.
   - Every Drizzle column has a corresponding migration column.
   - The release path applies committed migrations using the `ledger_owner`
     connection. It then starts the application using the lower-privilege
     `ledger_app` connection; application runtime must not use the owner role.""",
            """5. **Committed migrations apply on a fresh database (and parity is verified):**
   - **Prerequisite:** `DATABASE_ADMIN_URL` connects as `ledger_owner` and has
     permission to create the two disposable parity databases. `DATABASE_URL`
     connects as the lower-privilege `ledger_app` for runtime grant checks.
   ```bash
   pnpm --filter @smp/db db:migrate
   pnpm --filter @smp/db db:verify
   pnpm --filter @smp/db db:parity
   ```
   - `db:migrate` applies only sorted, committed `V<timestamp>__<slug>.sql` files,
     under the migration advisory lock, and rejects changed checksums.
   - `db:verify` verifies the migration ledger and the committed integrity objects.
   - `db:parity` compares committed migrations with a fresh `drizzle-kit push`
     across tables, columns, normalized types, nullability, and foreign keys.
   - Once applied, a migration file is immutable — add a new one; never edit it.
   - The release path applies committed migrations using the `ledger_owner`
     connection. It then starts the application using the lower-privilege
     `ledger_app` connection; application runtime must not use the owner role.""",
        ),
    ),
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
    "docs/stories/CHANGES.md": (
        (
            """**Notes:** # CHG-001 — Reconcile Sprint 1 execution contract

## Trigger

Sprint 1 readiness review found generator-owned guidance that contradicts the
authoritative ER model and architecture.

## Required changes

- Replace tenant guidance that names `org_id` or `tenant_id` with
  `company_id`, matching `0...""",
            COMPLETE_CHANGE_NOTES,
        ),
    ),
}

MIRRORS = (
    "CODEX.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
)

AGENT_GUIDANCE = (
    "AGENTS.md",
    "CLAUDE.md",
    *MIRRORS,
)

FORBIDDEN_GUIDANCE = (
    re.compile(r"\borg_id\b", re.IGNORECASE),
    re.compile(r"\btenant_id\b", re.IGNORECASE),
    re.compile(r"\bAuth0\b", re.IGNORECASE),
    re.compile(r"\bVercel\b", re.IGNORECASE),
)


class ReconciliationError(RuntimeError):
    """Raised when generated guidance cannot be reconciled safely."""


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ReconciliationError(f"required generated file is missing: {path}") from error


def governed_guidance_paths(root: Path) -> tuple[Path, ...]:
    paths = [root / relative_path for relative_path in AGENT_GUIDANCE]
    paths.extend(sorted((root / "docs/dev-guide").glob("*.md")))
    paths.append(root / "testing/critical-paths.md")
    return tuple(dict.fromkeys(paths))


def build_plan(root: Path) -> dict[Path, str]:
    """Validate every invariant, then return the complete desired file plan."""
    original: dict[Path, str] = {}
    desired: dict[Path, str] = {}
    errors: list[str] = []

    for relative_path, replacements in REPLACEMENTS.items():
        path = root / relative_path
        text = read_text(path)
        original[path] = text
        updated = text

        for stale, expected in replacements:
            stale_count = updated.count(stale)
            expected_count = updated.count(expected)
            if (stale_count, expected_count) == (1, 0):
                updated = updated.replace(stale, expected, 1)
            elif (stale_count, expected_count) != (0, 1):
                errors.append(
                    f"{relative_path}: expected exactly one stale or expected "
                    "occurrence "
                    f"(stale={stale_count}, expected={expected_count})"
                )

        desired[path] = updated

    claude_path = root / "CLAUDE.md"
    claude = original.setdefault(claude_path, read_text(claude_path))
    desired.setdefault(claude_path, claude)
    for relative_path in MIRRORS:
        path = root / relative_path
        original[path] = read_text(path)
        desired[path] = claude

    for path in governed_guidance_paths(root):
        text = desired.get(path)
        if text is None:
            text = original.setdefault(path, read_text(path))
            desired[path] = text
        for pattern in FORBIDDEN_GUIDANCE:
            match = pattern.search(text)
            if match:
                errors.append(
                    f"{path.relative_to(root)}: forbidden active guidance "
                    f"{match.group(0)!r}"
                )

    if errors:
        raise ReconciliationError("\n".join(errors))

    return {
        path: text
        for path, text in desired.items()
        if original.get(path) != text
    }


def atomic_write(path: Path, text: str) -> None:
    """Replace one file atomically without exposing a partially written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(text)
            temporary.flush()
            os.fsync(temporary.fileno())
        if path.exists():
            os.chmod(temporary_path, path.stat().st_mode)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def apply_plan(plan: dict[Path, str], root: Path) -> None:
    for path, text in sorted(plan.items()):
        atomic_write(path, text)
        print(f"  reconciled: {path.relative_to(root)}")


def preview_plan(plan: dict[Path, str], root: Path) -> None:
    if not plan:
        print("Ledger generated-document invariants are already satisfied.")
        return
    for path, desired in sorted(plan.items()):
        current = path.read_text(encoding="utf-8")
        relative_path = path.relative_to(root)
        sys.stdout.writelines(
            difflib.unified_diff(
                current.splitlines(keepends=True),
                desired.splitlines(keepends=True),
                fromfile=f"a/{relative_path}",
                tofile=f"b/{relative_path}",
            )
        )


def check_plan(plan: dict[Path, str], root: Path) -> None:
    if not plan:
        return
    messages = []
    for path in sorted(plan):
        relative_path = path.relative_to(root)
        if str(relative_path) in MIRRORS:
            messages.append(f"{relative_path} differs from CLAUDE.md")
        else:
            messages.append(f"{relative_path} requires CHG-001 reconciliation")
    raise ReconciliationError("\n".join(messages))


def parse_args(arguments: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--preview", action="store_true")
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if arguments is None else arguments)
    root = args.project_root.resolve()
    try:
        plan = build_plan(root)
        if args.check:
            check_plan(plan, root)
        elif args.preview:
            preview_plan(plan, root)
        else:
            apply_plan(plan, root)
    except ReconciliationError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
