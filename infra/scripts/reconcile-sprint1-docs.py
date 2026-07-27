#!/usr/bin/env python3
"""Enforce Ledger's CHG-001 generated-document invariants."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path


PINNED_PATHS = (
    "AGENTS.md",
    "CLAUDE.md",
    "docs/dev-guide/DEFINITION_OF_DONE.md",
    "docs/dev-guide/FRONTEND.md",
    "docs/dev-guide/SECURITY.md",
    "docs/dev-guide/STANDARDS.md",
    "docs/dev-guide/TESTING.md",
    "docs/stories/CHANGES.md",
    "testing/critical-paths.md",
)

SEMANTIC_REPLACEMENTS = {
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


def read_bytes(path: Path, description: str) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError as error:
        raise ReconciliationError(f"{description} is missing: {path}") from error


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ReconciliationError(f"required generated file is missing: {path}") from error


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def load_pinned_overrides() -> dict[str, tuple[str, str, str]]:
    data_root = Path(
        os.environ.get("RECONCILER_DATA_ROOT", Path(__file__).resolve().parent)
    )
    override_root = data_root / "overrides/CHG-001/825e882"
    fixture_root = data_root / "tests/fixtures/825e882"
    manifest_path = override_root / "manifest.json"

    try:
        manifest = json.loads(
            read_bytes(manifest_path, "override manifest").decode("utf-8")
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReconciliationError(
            f"override manifest is not valid UTF-8 JSON: {manifest_path}"
        ) from error

    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise ReconciliationError("override manifest must declare version 1")
    entries = manifest.get("paths")
    if not isinstance(entries, dict) or set(entries) != set(PINNED_PATHS):
        raise ReconciliationError(
            "override manifest paths do not match the reviewed CHG-001 path set"
        )

    pinned: dict[str, tuple[str, str, str]] = {}
    for relative_path in PINNED_PATHS:
        metadata = entries[relative_path]
        if not isinstance(metadata, dict) or set(metadata) != {
            "source_sha256",
            "desired_sha256",
        }:
            raise ReconciliationError(
                f"{relative_path}: invalid override manifest metadata"
            )
        source_hash = metadata["source_sha256"]
        desired_hash = metadata["desired_sha256"]
        if not all(
            isinstance(value, str)
            and len(value) == 64
            and all(character in "0123456789abcdef" for character in value)
            for value in (source_hash, desired_hash)
        ):
            raise ReconciliationError(
                f"{relative_path}: invalid SHA-256 in override manifest"
            )

        source_bytes = read_bytes(
            fixture_root / relative_path,
            f"{relative_path}: pinned source artifact",
        )
        desired_bytes = read_bytes(
            override_root / relative_path,
            f"{relative_path}: desired override artifact",
        )
        if sha256(source_bytes) != source_hash:
            raise ReconciliationError(
                f"{relative_path}: pinned source artifact hash mismatch"
            )
        if sha256(desired_bytes) != desired_hash:
            raise ReconciliationError(
                f"{relative_path}: desired override artifact hash mismatch"
            )
        try:
            desired_text = desired_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ReconciliationError(
                f"{relative_path}: desired override artifact is not UTF-8"
            ) from error
        pinned[relative_path] = (source_hash, desired_hash, desired_text)

    return pinned


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

    for relative_path, (source_hash, desired_hash, desired_text) in (
        load_pinned_overrides().items()
    ):
        path = root / relative_path
        current_bytes = read_bytes(path, "required generated file")
        current_hash = sha256(current_bytes)
        try:
            current_text = current_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ReconciliationError(
                f"{relative_path}: generated guidance is not UTF-8"
            ) from error
        original[path] = current_text
        if current_hash == source_hash:
            desired[path] = desired_text
        elif current_hash == desired_hash:
            desired[path] = current_text
        else:
            errors.append(
                f"{relative_path}: unknown generated guidance state "
                f"(sha256={current_hash}); review and pin a new migration"
            )

    for relative_path, replacements in SEMANTIC_REPLACEMENTS.items():
        path = root / relative_path
        text = original.setdefault(path, read_text(path))
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
    claude = desired[claude_path]
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
