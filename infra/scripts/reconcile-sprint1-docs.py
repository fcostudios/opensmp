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
    "testing/critical-paths.md",
)

SECTION_PINNED_PATHS = ("docs/stories/CHANGES.md",)
REVIEWED_PATHS = (*PINNED_PATHS, *SECTION_PINNED_PATHS)
CHG004_PATHS = {
    "docs/stories/CHANGES.md": (
        "overrides/CHG-001/825e882/docs/stories/CHANGES.md"
    ),
    "testing/critical-paths.md": (
        "overrides/CHG-001/825e882/testing/critical-paths.md"
    ),
}
CHG005_PATHS = {
    "docs/stories/sprint-2/r1_misc_us_014.md",
    "docs/stories/sprint-2/r1_misc_us_017.md",
    "docs/stories/sprint-2/r1_misc_us_045.md",
}

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


def validate_sha256(value: object, description: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ReconciliationError(f"{description}: invalid SHA-256")
    return value


def contained_manifest_path(
    root: Path,
    relative_path: object,
    description: str,
) -> Path:
    if (
        not isinstance(relative_path, str)
        or not relative_path
        or "\\" in relative_path
        or Path(relative_path).is_absolute()
        or any(part in ("", ".", "..") for part in Path(relative_path).parts)
    ):
        raise ReconciliationError(f"{description}: invalid relative path")
    resolved_root = root.resolve()
    resolved_path = (root / relative_path).resolve()
    if not resolved_path.is_relative_to(resolved_root):
        raise ReconciliationError(f"{description}: path escapes its manifest root")
    return resolved_path


def project_output_path(root: Path, relative_path: str) -> Path:
    return contained_manifest_path(
        root,
        relative_path,
        f"{relative_path}: generated project path",
    )


def load_pinned_overrides() -> dict[str, tuple[str, str, str, str]]:
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
    if not isinstance(entries, dict) or set(entries) != set(REVIEWED_PATHS):
        raise ReconciliationError(
            "override manifest paths do not match the reviewed CHG-001 path set"
        )

    pinned: dict[str, tuple[str, str, str, str]] = {}
    for relative_path in REVIEWED_PATHS:
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
            source_text = source_bytes.decode("utf-8")
            desired_text = desired_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ReconciliationError(
                f"{relative_path}: reviewed override artifact is not UTF-8"
            ) from error
        pinned[relative_path] = (
            source_hash,
            desired_hash,
            source_text,
            desired_text,
        )

    return pinned


def load_latest_overrides() -> dict[str, tuple[str, str, str, str]]:
    data_root = Path(
        os.environ.get("RECONCILER_DATA_ROOT", Path(__file__).resolve().parent)
    )
    override_root = data_root / "overrides/CHG-004/e4b9a06"
    manifest_path = override_root / "manifest.json"
    try:
        manifest = json.loads(
            read_bytes(manifest_path, "CHG-004 override manifest").decode("utf-8")
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReconciliationError(
            f"CHG-004 override manifest is not valid UTF-8 JSON: {manifest_path}"
        ) from error
    entries = manifest.get("paths") if isinstance(manifest, dict) else None
    if (
        not isinstance(manifest, dict)
        or manifest.get("version") != 1
        or not isinstance(entries, dict)
    ):
        raise ReconciliationError("CHG-004 override manifest must declare version 1")
    if set(entries) != set(CHG004_PATHS):
        raise ReconciliationError(
            "CHG-004 override manifest paths do not match the allowed path set"
        )

    pinned: dict[str, tuple[str, str, str, str]] = {}
    for relative_path, metadata in entries.items():
        if not isinstance(metadata, dict) or set(metadata) != {
            "source_path",
            "source_sha256",
            "desired_sha256",
        }:
            raise ReconciliationError(
                f"{relative_path}: invalid CHG-004 override metadata"
            )
        source_path = metadata["source_path"]
        if source_path != CHG004_PATHS[relative_path]:
            raise ReconciliationError(
                f"{relative_path}: invalid CHG-004 source path"
            )
        source_hash = validate_sha256(
            metadata["source_sha256"],
            f"{relative_path}: CHG-004 source hash",
        )
        desired_hash = validate_sha256(
            metadata["desired_sha256"],
            f"{relative_path}: CHG-004 desired hash",
        )
        source_artifact = contained_manifest_path(
            data_root,
            source_path,
            f"{relative_path}: CHG-004 source path",
        )
        desired_artifact = contained_manifest_path(
            override_root,
            relative_path,
            f"{relative_path}: CHG-004 desired path",
        )
        source_bytes = read_bytes(
            source_artifact,
            f"{relative_path}: CHG-004 pinned source artifact",
        )
        desired_bytes = read_bytes(
            desired_artifact,
            f"{relative_path}: CHG-004 desired override artifact",
        )
        if sha256(source_bytes) != source_hash:
            raise ReconciliationError(
                f"{relative_path}: CHG-004 source artifact hash mismatch"
            )
        if sha256(desired_bytes) != desired_hash:
            raise ReconciliationError(
                f"{relative_path}: CHG-004 desired artifact hash mismatch"
            )
        try:
            source_text = source_bytes.decode("utf-8")
            desired_text = desired_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ReconciliationError(
                f"{relative_path}: CHG-004 artifact is not UTF-8"
            ) from error
        pinned[relative_path] = (
            source_hash,
            desired_hash,
            source_text,
            desired_text,
        )
    return pinned


def load_chg005_story_overrides() -> dict[str, tuple[str, str, str]]:
    data_root = Path(
        os.environ.get("RECONCILER_DATA_ROOT", Path(__file__).resolve().parent)
    )
    override_root = data_root / "overrides/CHG-005/277b64e"
    manifest_path = override_root / "manifest.json"
    try:
        manifest = json.loads(
            read_bytes(manifest_path, "CHG-005 override manifest").decode("utf-8")
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReconciliationError(
            f"CHG-005 override manifest is not valid UTF-8 JSON: {manifest_path}"
        ) from error
    entries = manifest.get("paths") if isinstance(manifest, dict) else None
    if (
        not isinstance(manifest, dict)
        or manifest.get("version") != 1
        or not isinstance(entries, dict)
    ):
        raise ReconciliationError("CHG-005 override manifest must declare version 1")
    if set(entries) != CHG005_PATHS:
        raise ReconciliationError(
            "CHG-005 override manifest paths do not match the allowed path set"
        )
    pinned: dict[str, tuple[str, str, str]] = {}
    for relative_path, metadata in entries.items():
        if not isinstance(metadata, dict) or set(metadata) != {
            "source_sha256",
            "desired_sha256",
        }:
            raise ReconciliationError(
                f"{relative_path}: invalid CHG-005 override metadata"
            )
        source_hash = validate_sha256(
            metadata["source_sha256"],
            f"{relative_path}: CHG-005 source hash",
        )
        desired_hash = validate_sha256(
            metadata["desired_sha256"],
            f"{relative_path}: CHG-005 desired hash",
        )
        desired_artifact = contained_manifest_path(
            override_root,
            relative_path,
            f"{relative_path}: CHG-005 desired path",
        )
        desired_bytes = read_bytes(
            desired_artifact,
            f"{relative_path}: CHG-005 desired override artifact",
        )
        if sha256(desired_bytes) != desired_hash:
            raise ReconciliationError(
                f"{relative_path}: CHG-005 desired artifact hash mismatch"
            )
        try:
            desired_text = desired_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ReconciliationError(
                f"{relative_path}: CHG-005 artifact is not UTF-8"
            ) from error
        pinned[relative_path] = (
            source_hash,
            desired_hash,
            desired_text,
        )
    return pinned


def governed_guidance_paths(root: Path) -> tuple[Path, ...]:
    paths = [root / relative_path for relative_path in AGENT_GUIDANCE]
    paths.extend(sorted((root / "docs/dev-guide").glob("*.md")))
    paths.append(root / "testing/critical-paths.md")
    return tuple(dict.fromkeys(paths))


def reviewed_section(
    text: str,
    relative_path: str,
    start_marker: str,
    end_marker: str,
) -> str:
    reviewed_heading = "### CHG-001:"
    heading_start = text.find(reviewed_heading)
    if heading_start < 0:
        raise ReconciliationError(
            f"{relative_path}: reviewed section markers changed; "
            "review and pin a new migration"
        )
    next_heading = text.find("\n### CHG-", heading_start + len(reviewed_heading))
    heading_end = len(text) if next_heading < 0 else next_heading
    reviewed_change = text[heading_start:heading_end]
    if (
        reviewed_change.count(start_marker) != 1
        or reviewed_change.count(end_marker) != 1
    ):
        raise ReconciliationError(
            f"{relative_path}: reviewed section markers changed; "
            "review and pin a new migration"
        )
    start = heading_start + reviewed_change.index(start_marker)
    end = heading_start + reviewed_change.index(end_marker, start - heading_start)
    return text[start:end]


def build_plan(root: Path) -> dict[Path, str]:
    """Validate every invariant, then return the complete desired file plan."""
    original: dict[Path, str] = {}
    desired: dict[Path, str] = {}
    errors: list[str] = []

    pinned = load_pinned_overrides()
    latest = load_latest_overrides()
    for relative_path in PINNED_PATHS:
        source_hash, desired_hash, _, desired_text = pinned[relative_path]
        path = project_output_path(root, relative_path)
        current_bytes = read_bytes(path, "required generated file")
        current_hash = sha256(current_bytes)
        try:
            current_text = current_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ReconciliationError(
                f"{relative_path}: generated guidance is not UTF-8"
            ) from error
        original[path] = current_text
        latest_override = latest.get(relative_path)
        if current_hash == source_hash:
            candidate = desired_text
        elif current_hash == desired_hash:
            candidate = current_text
        elif latest_override and current_hash == latest_override[1]:
            candidate = current_text
        else:
            errors.append(
                f"{relative_path}: unknown generated guidance state "
                f"(sha256={current_hash}); review and pin a new migration"
            )
            continue
        if latest_override:
            latest_source_hash, latest_desired_hash, _, latest_desired_text = (
                latest_override
            )
            candidate_hash = sha256(candidate.encode("utf-8"))
            if candidate_hash == latest_source_hash:
                candidate = latest_desired_text
            elif candidate_hash != latest_desired_hash:
                errors.append(
                    f"{relative_path}: unknown CHG-004 guidance state "
                    f"(sha256={candidate_hash}); review and pin a new migration"
                )
        desired[path] = candidate

    for relative_path in SECTION_PINNED_PATHS:
        _, _, source_text, desired_text = pinned[relative_path]
        path = project_output_path(root, relative_path)
        current_text = read_text(path)
        original[path] = current_text
        source_section = reviewed_section(
            source_text,
            relative_path,
            "**Notes:**",
            "**Feedback:**",
        )
        desired_section = reviewed_section(
            desired_text,
            relative_path,
            "**Notes:**",
            "**Feedback:**",
        )
        current_section = reviewed_section(
            current_text,
            relative_path,
            "**Notes:**",
            "**Feedback:**",
        )
        latest_override = latest.get(relative_path)
        latest_desired_section = (
            reviewed_section(
                latest_override[3],
                relative_path,
                "**Notes:**",
                "**Feedback:**",
            )
            if latest_override
            else None
        )
        if current_section == source_section:
            candidate = current_text.replace(
                source_section,
                desired_section,
                1,
            )
        elif current_section == desired_section:
            candidate = current_text
        elif latest_desired_section and current_section == latest_desired_section:
            candidate = current_text
        else:
            errors.append(
                f"{relative_path}: unknown reviewed guidance section; "
                "review and pin a new migration"
            )
            continue
        if latest_override:
            latest_source_section = reviewed_section(
                latest_override[2],
                relative_path,
                "**Notes:**",
                "**Feedback:**",
            )
            candidate_section = reviewed_section(
                candidate,
                relative_path,
                "**Notes:**",
                "**Feedback:**",
            )
            if candidate_section == latest_source_section:
                candidate = candidate.replace(
                    latest_source_section,
                    latest_desired_section,
                    1,
                )
            elif candidate_section != latest_desired_section:
                errors.append(
                    f"{relative_path}: unknown CHG-004 reviewed guidance "
                    "section; review and pin a new migration"
                )
        desired[path] = candidate

    for relative_path, (
        source_hash,
        desired_hash,
        desired_text,
    ) in load_chg005_story_overrides().items():
        path = project_output_path(root, relative_path)
        if not path.exists():
            continue
        current_text = original.setdefault(path, read_text(path))
        current_hash = sha256(current_text.encode("utf-8"))
        if current_hash == source_hash:
            desired[path] = desired_text
        elif current_hash == desired_hash:
            desired[path] = current_text
        else:
            errors.append(
                f"{relative_path}: unknown CHG-005 generated story state "
                f"(sha256={current_hash}); review and pin a new migration"
            )

    for relative_path, replacements in SEMANTIC_REPLACEMENTS.items():
        path = project_output_path(root, relative_path)
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

    claude_path = project_output_path(root, "CLAUDE.md")
    claude = desired.get(claude_path)
    if claude is not None:
        for relative_path in MIRRORS:
            path = project_output_path(root, relative_path)
            original[path] = read_text(path)
            desired[path] = claude

    for path in governed_guidance_paths(root):
        if not path.resolve().is_relative_to(root.resolve()):
            raise ReconciliationError(
                f"{path}: governed guidance path escapes the project root"
            )
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
