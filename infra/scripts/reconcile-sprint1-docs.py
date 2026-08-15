#!/usr/bin/env python3
"""Enforce Ledger's CHG-001 generated-document invariants."""

from __future__ import annotations

import argparse
import difflib
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat
import sys
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
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
CHG022_PATHS = {
    "AGENTS.md": "overrides/CHG-001/825e882/AGENTS.md",
    "CLAUDE.md": "overrides/CHG-001/825e882/CLAUDE.md",
    "docs/dev-guide/DEFINITION_OF_DONE.md": (
        "overrides/CHG-001/825e882/docs/dev-guide/DEFINITION_OF_DONE.md"
    ),
}
LAYERED_OVERRIDE_SPECS = (
    ("CHG-004/e4b9a06", CHG004_PATHS),
    ("CHG-022/16f72c9", CHG022_PATHS),
)
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
FILESYSTEM_RETRY_ATTEMPTS = 3
TRANSACTION_DIR = ".reconcile-sprint1-transactions"
FAULT_EXIT_CODE = 86
TEST_FAULT_TOKEN = "CHG022-TRANSACTION-TEST"
_stage_counter = 0


@dataclass(frozen=True)
class PlanEntry:
    original_bytes: bytes
    original_sha256: str
    original_mode: int
    original_device: int
    original_inode: int
    desired_text: str
    desired_sha256: str


class ReconciliationError(RuntimeError):
    """Raised when generated guidance cannot be reconciled safely."""


@contextmanager
def reconciliation_lock(root: Path):
    """Serialize cooperating reconciler processes for one project root.

    Arbitrary editors do not take this advisory lock, so their writes are
    detected best-effort by the exact checks immediately before publication.
    """
    identity = hashlib.sha256(str(root.resolve()).encode("utf-8")).hexdigest()
    lock_path = Path(tempfile.gettempdir()) / f"ledger-reconcile-{identity}.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


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


def load_layered_overrides() -> tuple[
    tuple[str, dict[str, tuple[str, str, str, str]]], ...
]:
    data_root = Path(
        os.environ.get("RECONCILER_DATA_ROOT", Path(__file__).resolve().parent)
    )
    layers: list[tuple[str, dict[str, tuple[str, str, str, str]]]] = []
    for layer_spec, allowed_paths in LAYERED_OVERRIDE_SPECS:
        change_id = layer_spec.split("/", 1)[0]
        override_root = data_root / "overrides" / layer_spec
        manifest_path = override_root / "manifest.json"
        try:
            manifest = json.loads(
                read_bytes(
                    manifest_path,
                    f"{change_id} override manifest",
                ).decode("utf-8")
            )
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ReconciliationError(
                f"{change_id} override manifest is not valid UTF-8 JSON: "
                f"{manifest_path}"
            ) from error
        entries = manifest.get("paths") if isinstance(manifest, dict) else None
        if (
            not isinstance(manifest, dict)
            or set(manifest) != {"version", "paths"}
            or manifest.get("version") != 1
            or not isinstance(entries, dict)
        ):
            raise ReconciliationError(
                f"{change_id} override manifest must declare version 1 and paths"
            )
        if set(entries) != set(allowed_paths):
            raise ReconciliationError(
                f"{change_id} override manifest paths do not match the allowed path set"
            )

        pinned: dict[str, tuple[str, str, str, str]] = {}
        for relative_path, metadata in entries.items():
            if not isinstance(metadata, dict) or set(metadata) != {
                "source_path",
                "source_sha256",
                "desired_sha256",
            }:
                raise ReconciliationError(
                    f"{relative_path}: invalid {change_id} override metadata"
                )
            source_path = metadata["source_path"]
            if source_path != allowed_paths[relative_path]:
                raise ReconciliationError(
                    f"{relative_path}: invalid {change_id} source path"
                )
            source_hash = validate_sha256(
                metadata["source_sha256"],
                f"{relative_path}: {change_id} source hash",
            )
            desired_hash = validate_sha256(
                metadata["desired_sha256"],
                f"{relative_path}: {change_id} desired hash",
            )
            source_artifact = contained_manifest_path(
                data_root,
                source_path,
                f"{relative_path}: {change_id} source path",
            )
            desired_artifact = contained_manifest_path(
                override_root,
                relative_path,
                f"{relative_path}: {change_id} desired path",
            )
            source_bytes = read_bytes(
                source_artifact,
                f"{relative_path}: {change_id} pinned source artifact",
            )
            desired_bytes = read_bytes(
                desired_artifact,
                f"{relative_path}: {change_id} desired override artifact",
            )
            if sha256(source_bytes) != source_hash:
                raise ReconciliationError(
                    f"{relative_path}: {change_id} source artifact hash mismatch"
                )
            if sha256(desired_bytes) != desired_hash:
                raise ReconciliationError(
                    f"{relative_path}: {change_id} desired artifact hash mismatch"
                )
            try:
                source_text = source_bytes.decode("utf-8")
                desired_text = desired_bytes.decode("utf-8")
            except UnicodeDecodeError as error:
                raise ReconciliationError(
                    f"{relative_path}: {change_id} artifact is not UTF-8"
                ) from error
            pinned[relative_path] = (
                source_hash,
                desired_hash,
                source_text,
                desired_text,
            )
        layers.append((change_id, pinned))
    return tuple(layers)


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


def build_plan(root: Path) -> dict[Path, PlanEntry]:
    """Validate every invariant, then return the complete desired file plan."""
    original: dict[Path, str] = {}
    desired: dict[Path, str] = {}
    errors: list[str] = []

    layers = load_layered_overrides()
    pinned = load_pinned_overrides()
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
        layered_overrides = [
            (change_id, overrides[relative_path])
            for change_id, overrides in layers
            if relative_path in overrides
        ]
        completed_layer = -1
        if current_hash == source_hash:
            candidate = desired_text
        elif current_hash == desired_hash:
            candidate = current_text
        elif any(
            current_hash == override[1] for _, override in layered_overrides
        ):
            candidate = current_text
            completed_layer = max(
                index
                for index, (_, override) in enumerate(layered_overrides)
                if current_hash == override[1]
            )
        else:
            errors.append(
                f"{relative_path}: unknown generated guidance state "
                f"(sha256={current_hash}); review and pin a new migration"
            )
            continue
        for change_id, layered_override in layered_overrides[completed_layer + 1 :]:
            (
                layered_source_hash,
                layered_desired_hash,
                _,
                layered_desired_text,
            ) = layered_override
            candidate_hash = sha256(candidate.encode("utf-8"))
            if candidate_hash == layered_source_hash:
                candidate = layered_desired_text
            elif candidate_hash != layered_desired_hash:
                errors.append(
                    f"{relative_path}: unknown {change_id} guidance state "
                    f"(sha256={candidate_hash}); review and pin a new migration"
                )
                break
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
        layered_overrides = [
            (change_id, overrides[relative_path])
            for change_id, overrides in layers
            if relative_path in overrides
        ]
        layered_desired_sections = [
            reviewed_section(
                override[3], relative_path, "**Notes:**", "**Feedback:**"
            )
            for _, override in layered_overrides
        ]
        completed_layer = -1
        if current_section == source_section:
            candidate = current_text.replace(
                source_section,
                desired_section,
                1,
            )
        elif current_section == desired_section:
            candidate = current_text
        elif current_section in layered_desired_sections:
            candidate = current_text
            completed_layer = max(
                index
                for index, section in enumerate(layered_desired_sections)
                if current_section == section
            )
        else:
            errors.append(
                f"{relative_path}: unknown reviewed guidance section; "
                "review and pin a new migration"
            )
            continue
        for change_id, layered_override in layered_overrides[completed_layer + 1 :]:
            layered_source_section = reviewed_section(
                layered_override[2],
                relative_path,
                "**Notes:**",
                "**Feedback:**",
            )
            layered_desired_section = reviewed_section(
                layered_override[3],
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
            if candidate_section == layered_source_section:
                candidate = candidate.replace(
                    layered_source_section,
                    layered_desired_section,
                    1,
                )
            elif candidate_section != layered_desired_section:
                errors.append(
                    f"{relative_path}: unknown {change_id} reviewed guidance "
                    "section; review and pin a new migration"
                )
                break
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

    # CHG-024: the mirrors track the fully layered CLAUDE.md computed above, so
    # every assistant reads the same governing guidance. Sourcing them from the
    # CHG-001 baseline left Codex, Cursor and Copilot without CHG-022's Work
    # Readiness Gate. Reading desired[] keeps every future layer propagating
    # here with no further change.
    # When CLAUDE.md is in an unknown state the loop above records an error and
    # skips it, leaving no desired text. Mirroring is skipped too so that the
    # recorded CLAUDE.md diagnostic is what surfaces, not a KeyError.
    mirrored_claude = desired.get(project_output_path(root, "CLAUDE.md"))
    for relative_path in MIRRORS if mirrored_claude is not None else ():
        path = project_output_path(root, relative_path)
        original[path] = read_text(path)
        desired[path] = mirrored_claude

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

    plan: dict[Path, PlanEntry] = {}
    for path, text in desired.items():
        if original.get(path) == text:
            continue
        original_bytes = original[path].encode("utf-8")
        before = path.lstat()
        current_bytes = path.read_bytes()
        after = path.lstat()
        if current_bytes != original_bytes:
            raise ReconciliationError(
                f"{path.relative_to(root)} changed while building reconciliation plan"
            )
        if (
            stat.S_ISLNK(before.st_mode)
            or not stat.S_ISREG(before.st_mode)
            or before.st_ino != after.st_ino
            or before.st_mode != after.st_mode
        ):
            raise ReconciliationError(
                f"{path.relative_to(root)} changed while building reconciliation plan"
            )
        mode = stat.S_IMODE(after.st_mode)
        plan[path] = PlanEntry(
            original_bytes=original_bytes,
            original_sha256=sha256(original_bytes),
            original_mode=mode,
            original_device=after.st_dev,
            original_inode=after.st_ino,
            desired_text=text,
            desired_sha256=sha256(text.encode("utf-8")),
        )
    return plan


def stage_bytes(path: Path, content: bytes, mode: int, role: str) -> Path:
    """Write and sync an ephemeral same-directory helper file."""
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.{role}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_path, stat.S_IMODE(mode))
        verify_descriptor = os.open(temporary_path, os.O_RDONLY)
        try:
            os.fsync(verify_descriptor)
        finally:
            os.close(verify_descriptor)
        return temporary_path
    except OSError as error:
        cleanup_errors = cleanup_transaction_artifacts([temporary_path])
        if cleanup_errors:
            raise ReconciliationError(
                "staging artifact cleanup failed: " + "; ".join(cleanup_errors)
            ) from error
        raise


def predeclare_artifact(path: Path, role: str, reserved: set[Path]) -> Path:
    """Choose a unique same-directory artifact name without creating it."""
    for _ in range(FILESYSTEM_RETRY_ATTEMPTS * 4):
        candidate = path.parent / f".{path.name}.{role}.{secrets.token_hex(12)}.tmp"
        if (
            candidate not in reserved
            and not candidate.exists()
            and not candidate.is_symlink()
        ):
            reserved.add(candidate)
            return candidate
    raise ReconciliationError(f"could not allocate a unique {role} path for {path}")


def write_declared_artifact(
    path: Path,
    next_path: Path,
    content: bytes,
    mode: int,
    crash_point: str,
) -> None:
    """Publish one artifact atomically from its journal-declared auxiliary path."""
    global _stage_counter
    _stage_counter += 1
    if fault_enabled(f"stage_failure:{_stage_counter}"):
        raise PermissionError(f"injected staging failure at {_stage_counter}")
    descriptor: int | None = None
    try:
        descriptor = os.open(next_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as artifact:
            descriptor = None
            if fault_enabled(crash_point):
                artifact.write(content[: max(1, len(content) // 2)])
                artifact.flush()
                os.fsync(artifact.fileno())
                os._exit(FAULT_EXIT_CODE)
            artifact.write(content)
            artifact.flush()
            os.fsync(artifact.fileno())
            os.fchmod(artifact.fileno(), stat.S_IMODE(mode))
            os.fsync(artifact.fileno())
        os.replace(next_path, path)
        sync_directory(path.parent)
    except OSError:
        if descriptor is not None:
            os.close(descriptor)
        raise


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def test_faults() -> set[str]:
    if os.environ.get("RECONCILER_FAULT_TOKEN") != TEST_FAULT_TOKEN:
        return set()
    return {
        value.strip()
        for value in os.environ.get("RECONCILER_FAULT_POINT", "").split(",")
        if value.strip()
    }


def fault_enabled(point: str) -> bool:
    return point in test_faults()


def crash_at(point: str) -> None:
    if fault_enabled(point):
        os._exit(FAULT_EXIT_CODE)


def pause_at(point: str) -> None:
    if not fault_enabled(point):
        return
    directory_value = os.environ.get("RECONCILER_FAULT_SYNC_DIR")
    if not directory_value:
        raise ReconciliationError(f"{point} requires a sync directory")
    directory = Path(directory_value)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "ready").write_text("ready\n", encoding="utf-8")
    deadline = time.monotonic() + 15
    while not (directory / "continue").exists():
        if time.monotonic() >= deadline:
            raise ReconciliationError(f"{point} timed out")
        time.sleep(0.01)


def retry_unlink(path: Path) -> OSError | None:
    last_error: OSError | None = None
    for attempt in range(FILESYSTEM_RETRY_ATTEMPTS):
        try:
            if fault_enabled("cleanup_unlink_once") and attempt == 0:
                raise OSError("injected one-shot cleanup failure")
            path.unlink(missing_ok=True)
            return None
        except OSError as error:
            last_error = error
    return last_error


def cleanup_transaction_artifacts(paths: list[Path]) -> list[str]:
    """Best-effort bounded cleanup; return paths that remain recoverable."""
    failures: list[str] = []
    for path in dict.fromkeys(paths):
        last_error = retry_unlink(path)
        if last_error is not None:
            failures.append(f"{path}: {last_error}")
    return failures


def restore_backup(backup: Path, target: Path, mode: int) -> OSError | None:
    """Restore through a copy so recovery bytes survive replace+directory fsync."""
    last_error: OSError | None = None
    for _ in range(FILESYSTEM_RETRY_ATTEMPTS):
        rollback_copy: Path | None = None
        try:
            if fault_enabled("rollback_replace_persistent") and target.name == "AGENTS.md":
                raise OSError("injected persistent rollback failure")
            rollback_copy = stage_bytes(
                target,
                backup.read_bytes(),
                mode,
                "rollback",
            )
            os.replace(rollback_copy, target)
            rollback_copy = None
            sync_directory(target.parent)
            cleanup_error = retry_unlink(backup)
            if cleanup_error is not None:
                raise cleanup_error
            return None
        except OSError as error:
            last_error = error
        finally:
            if rollback_copy is not None:
                retry_unlink(rollback_copy)
    return last_error


def journal_update_path(path: Path) -> Path:
    return path.parent / ".active.json.next.tmp"


def write_journal(
    path: Path,
    journal: dict[str, object],
    *,
    initialize: bool = False,
) -> None:
    content = (json.dumps(journal, sort_keys=True, separators=(",", ":")) + "\n").encode()
    destination = journal_update_path(path)
    descriptor: int | None = None
    try:
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as journal_file:
            descriptor = None
            if initialize and fault_enabled("during_initial_journal"):
                journal_file.write(content[: max(1, len(content) // 2)])
                journal_file.flush()
                os.fsync(journal_file.fileno())
                os._exit(FAULT_EXIT_CODE)
            journal_file.write(content)
            journal_file.flush()
            os.fsync(journal_file.fileno())
        os.replace(destination, path)
    except OSError:
        if descriptor is not None:
            os.close(descriptor)
        retry_unlink(destination)
        raise
    sync_directory(path.parent)


def transaction_journal_path(root: Path, *, create: bool = False) -> Path:
    directory = root / TRANSACTION_DIR
    if directory.exists() or directory.is_symlink():
        if directory.is_symlink() or not directory.is_dir():
            raise ReconciliationError("transaction journal directory is unsafe")
        if not directory.resolve().is_relative_to(root.resolve()):
            raise ReconciliationError("transaction journal directory escapes project root")
    elif create:
        directory.mkdir(mode=0o700)
        sync_directory(root)
    return directory / "active.json"


def transaction_relative(root: Path, path: Path) -> str:
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ReconciliationError(f"transaction path escapes project root: {path}")
    return str(resolved.relative_to(root.resolve()))


def validate_target(
    entry: dict[str, object], root: Path
) -> tuple[Path, Path, Path, Path, Path]:
    target = contained_manifest_path(root, entry.get("path"), "journal target")
    backup = contained_manifest_path(root, entry.get("backup"), "journal backup")
    desired = contained_manifest_path(root, entry.get("desired"), "journal desired")
    backup_next = contained_manifest_path(
        root, entry.get("backup_next"), "journal backup auxiliary"
    )
    desired_next = contained_manifest_path(
        root, entry.get("desired_next"), "journal desired auxiliary"
    )
    return target, backup, desired, backup_next, desired_next


def artifact_matches(
    path: Path,
    expected_hash: str,
    expected_mode: int,
    expected_inode: int | None = None,
    expected_device: int | None = None,
) -> bool:
    descriptor: int | None = None
    try:
        before = path.lstat()
        if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
            return False
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != before.st_dev
            or opened.st_ino != before.st_ino
            or opened.st_mode != before.st_mode
        ):
            return False
        digest = hashlib.sha256()
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
        closed_snapshot = os.fstat(descriptor)
        after = path.lstat()
        return (
            opened.st_dev == closed_snapshot.st_dev == after.st_dev
            and before.st_ino == after.st_ino
            and before.st_mode == after.st_mode
            and opened.st_ino == closed_snapshot.st_ino == after.st_ino
            and opened.st_mode == closed_snapshot.st_mode == after.st_mode
            and (expected_device is None or after.st_dev == expected_device)
            and (expected_inode in (None, 0) or after.st_ino == expected_inode)
            and digest.hexdigest() == expected_hash
            and stat.S_IMODE(after.st_mode) == expected_mode
        )
    except OSError:
        return False
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _recover_transaction(root: Path) -> None:
    journal_path = transaction_journal_path(root)
    directory = journal_path.parent
    update_path = journal_update_path(journal_path)
    if directory.exists():
        children = set(directory.iterdir())
        if not children.issubset({journal_path, update_path}):
            raise ReconciliationError(
                "transaction journal context is conflicting or tampered"
            )
        for metadata_path in (journal_path, update_path):
            if metadata_path.exists() or metadata_path.is_symlink():
                metadata_status = metadata_path.lstat()
                if (
                    stat.S_ISLNK(metadata_status.st_mode)
                    or not stat.S_ISREG(metadata_status.st_mode)
                ):
                    raise ReconciliationError(
                        "transaction journal context is conflicting or tampered"
                    )
    if not journal_path.exists():
        if directory.exists():
            children = list(directory.iterdir())
            if children:
                if (
                    children != [update_path]
                    or update_path.is_symlink()
                    or not update_path.is_file()
                ):
                    raise ReconciliationError(
                        "orphan journal update context is conflicting or tampered"
                    )
                cleanup_errors = cleanup_transaction_artifacts([update_path])
                if cleanup_errors:
                    raise ReconciliationError(
                        "journal update cleanup failed: " + "; ".join(cleanup_errors)
                    )
                sync_directory(directory)
        try:
            directory.rmdir()
            sync_directory(root)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        return
    try:
        journal = json.loads(journal_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReconciliationError(f"transaction journal is invalid: {error}") from error
    if (
        not isinstance(journal, dict)
        or set(journal) != {"version", "phase", "progress", "entries"}
        or journal.get("version") != 1
        or journal.get("phase") not in {
            "initializing", "prepared", "publishing", "committed"
        }
        or not isinstance(journal.get("progress"), int)
        or not isinstance(journal.get("entries"), list)
    ):
        raise ReconciliationError("transaction journal schema is invalid")
    entries = journal["entries"]
    if (
        journal["progress"] < 0
        or journal["progress"] > len(entries)
        or (journal["phase"] in {"initializing", "prepared"} and journal["progress"] != 0)
        or (journal["phase"] == "committed" and journal["progress"] != len(entries))
    ):
        raise ReconciliationError("transaction journal progress is invalid")
    validated: list[tuple[dict[str, object], Path, Path, Path, Path, Path]] = []
    targets: set[Path] = set()
    artifacts: set[Path] = set()
    for entry in entries:
        if (
            not isinstance(entry, dict)
            or set(entry) != {
                "path", "backup", "desired", "backup_next", "desired_next",
                "original_sha256",
                "desired_sha256", "original_mode", "desired_mode",
            }
            or not all(
                isinstance(entry.get(key), str)
                for key in (
                    "path", "backup", "desired", "backup_next", "desired_next"
                )
            )
            or not all(
                isinstance(entry.get(key), str)
                and re.fullmatch(r"[0-9a-f]{64}", entry[key]) is not None
                for key in ("original_sha256", "desired_sha256")
            )
            or not all(
                isinstance(entry.get(key), int) and 0 <= entry[key] <= 0o777
                for key in ("original_mode", "desired_mode")
            )
        ):
            raise ReconciliationError("transaction journal entry is invalid")
        target, backup, desired, backup_next, desired_next = validate_target(
            entry, root
        )
        entry_artifacts = {backup, desired, backup_next, desired_next}
        if (
            target in targets
            or target in artifacts
            or bool(entry_artifacts & artifacts)
            or bool(entry_artifacts & targets)
            or len(entry_artifacts) != 4
            or target in entry_artifacts
            or backup.parent != target.parent
            or desired.parent != target.parent
            or backup_next.parent != target.parent
            or desired_next.parent != target.parent
            or not backup.name.startswith(f".{target.name}.backup.")
            or not desired.name.startswith(f".{target.name}.desired.")
            or not backup_next.name.startswith(f".{target.name}.backup-next.")
            or not desired_next.name.startswith(f".{target.name}.desired-next.")
            or not backup.name.endswith(".tmp")
            or not desired.name.endswith(".tmp")
            or not backup_next.name.endswith(".tmp")
            or not desired_next.name.endswith(".tmp")
        ):
            raise ReconciliationError("transaction journal paths are invalid")
        targets.add(target)
        artifacts.update(entry_artifacts)
        validated.append(
            (entry, target, backup, desired, backup_next, desired_next)
        )

    if journal["phase"] == "initializing":
        for entry, target, backup, desired, backup_next, desired_next in validated:
            if not artifact_matches(
                target, entry["original_sha256"], entry["original_mode"]
            ):
                raise ReconciliationError(f"initializing transaction target changed: {target}")
            for artifact in (backup, desired, backup_next, desired_next):
                if artifact.exists() or artifact.is_symlink():
                    try:
                        artifact_status = artifact.lstat()
                    except OSError as error:
                        raise ReconciliationError(
                            f"initializing artifact cannot be inspected: {artifact}"
                        ) from error
                    if (
                        stat.S_ISLNK(artifact_status.st_mode)
                        or not stat.S_ISREG(artifact_status.st_mode)
                    ):
                        raise ReconciliationError(
                            f"initializing artifact path was tampered: {artifact}"
                        )
        cleanup_errors = cleanup_transaction_artifacts(
            [
                artifact
                for _, _, backup, desired, backup_next, desired_next in validated
                for artifact in (backup, desired, backup_next, desired_next)
            ]
        )
        if cleanup_errors:
            raise ReconciliationError(
                "initializing transaction cleanup failed: " + "; ".join(cleanup_errors)
            )
        for parent in {target.parent for _, target, _, _, _, _ in validated}:
            sync_directory(parent)
    elif journal["phase"] in {"prepared", "publishing"}:
        for entry, target, backup, desired, backup_next, desired_next in validated:
            if any(
                artifact.exists() or artifact.is_symlink()
                for artifact in (backup_next, desired_next)
            ):
                raise ReconciliationError(
                    f"prepared transaction has an unexpected staging auxiliary: {target}"
                )
            target_is_original = artifact_matches(
                target, entry["original_sha256"], entry["original_mode"]
            )
            target_is_desired = artifact_matches(
                target, entry["desired_sha256"], entry["desired_mode"]
            )
            if not target_is_original and not target_is_desired:
                raise ReconciliationError(f"transaction target was tampered: {target}")
            if backup.exists() and not artifact_matches(
                backup, entry["original_sha256"], entry["original_mode"]
            ):
                raise ReconciliationError(f"recovery backup was tampered: {backup}")
            if not backup.exists() and not target_is_original:
                raise ReconciliationError(
                    f"missing recovery backup for non-original target: {target}"
                )
            if desired.exists() and not artifact_matches(
                desired, entry["desired_sha256"], entry["desired_mode"]
            ):
                raise ReconciliationError(f"staged desired artifact was tampered: {desired}")

        recovery_errors: list[str] = []
        for index, (
            entry, target, backup, desired, backup_next, desired_next
        ) in enumerate(validated, start=1):
            original_ok = artifact_matches(
                target, entry["original_sha256"], entry["original_mode"]
            )
            if backup.exists():
                error = restore_backup(backup, target, entry["original_mode"])
                if error is not None:
                    recovery_errors.append(
                        f"mixed state at {target}; recovery backup {backup}: {error}"
                    )
            elif not original_ok:
                recovery_errors.append(
                    f"missing recovery backup for non-original target: {target}"
                )
            cleanup_errors = cleanup_transaction_artifacts(
                [desired, backup_next, desired_next]
            )
            if cleanup_errors:
                recovery_errors.append(
                    "recovery cleanup failed: " + "; ".join(cleanup_errors)
                )
            crash_at(f"recovery:{index}")
        if recovery_errors:
            raise ReconciliationError("; ".join(recovery_errors))
    else:
        for entry, target, backup, desired, backup_next, desired_next in validated:
            if any(
                artifact.exists() or artifact.is_symlink()
                for artifact in (backup_next, desired_next)
            ):
                raise ReconciliationError(
                    f"committed transaction has an unexpected staging auxiliary: {target}"
                )
            target_is_desired = artifact_matches(
                target, entry["desired_sha256"], entry["desired_mode"]
            )
            desired_is_valid = artifact_matches(
                desired, entry["desired_sha256"], entry["desired_mode"]
            )
            if not target_is_desired and not desired_is_valid:
                raise ReconciliationError(
                    f"committed transaction desired bytes missing: {target}"
                )
            if backup.exists() and not artifact_matches(
                backup, entry["original_sha256"], entry["original_mode"]
            ):
                raise ReconciliationError(f"recovery backup was tampered: {backup}")
        for entry, target, backup, desired, backup_next, desired_next in validated:
            if not artifact_matches(target, entry["desired_sha256"], entry["desired_mode"]):
                if not artifact_matches(desired, entry["desired_sha256"], entry["desired_mode"]):
                    raise ReconciliationError(f"committed transaction desired bytes missing: {target}")
                os.replace(desired, target)
                sync_directory(target.parent)
            cleanup_errors = cleanup_transaction_artifacts(
                [backup, desired, backup_next, desired_next]
            )
            if cleanup_errors:
                raise ReconciliationError("recovery cleanup failed: " + "; ".join(cleanup_errors))

    cleanup_errors = cleanup_transaction_artifacts(
        [journal_update_path(journal_path), journal_path]
    )
    if cleanup_errors:
        raise ReconciliationError("journal cleanup failed: " + "; ".join(cleanup_errors))
    try:
        journal_path.parent.rmdir()
    except OSError:
        pass
    sync_directory(root)


def recover_transaction(root: Path) -> None:
    """Recover a durable transaction and normalize filesystem errors."""
    try:
        _recover_transaction(root)
    except ReconciliationError:
        raise
    except (OSError, UnicodeError) as error:
        raise ReconciliationError(f"transaction recovery failed: {error}") from error


def abort_for_concurrent_edit(
    root: Path,
    journal_path: Path,
    staged: list[dict[str, object]],
    published_count: int,
) -> None:
    """Roll back our publications without overwriting an unpublished editor write."""
    errors: list[str] = []
    for entry in staged[:published_count]:
        path = Path(entry["path"])
        plan_entry = entry["plan"]
        if not artifact_matches(
            path, plan_entry.desired_sha256, plan_entry.original_mode
        ):
            errors.append(f"published target changed before rollback: {path}")
    if errors:
        raise ReconciliationError(
            "concurrent edit was preserved but transaction recovery requires attention: "
            + "; ".join(errors)
        )
    for entry in staged[:published_count]:
        path = Path(entry["path"])
        plan_entry = entry["plan"]
        rollback_error = restore_backup(
            Path(entry["backup"]), path, plan_entry.original_mode
        )
        if rollback_error is not None:
            errors.append(f"could not roll back {path}: {rollback_error}")
    unpublished = staged[published_count:]
    cleanup_errors = cleanup_transaction_artifacts(
        [
            artifact
            for entry in unpublished
            for artifact in (
                Path(entry["desired"]),
                Path(entry["backup"]),
                Path(entry["desired_next"]),
                Path(entry["backup_next"]),
            )
        ]
    )
    errors.extend(cleanup_errors)
    if errors:
        raise ReconciliationError(
            "concurrent edit was preserved but transaction recovery requires attention: "
            + "; ".join(errors)
        )
    for parent in {Path(entry["path"]).parent for entry in staged}:
        sync_directory(parent)
    metadata_errors = cleanup_transaction_artifacts(
        [journal_update_path(journal_path), journal_path]
    )
    if metadata_errors:
        raise ReconciliationError(
            "concurrent edit was preserved but journal cleanup failed: "
            + "; ".join(metadata_errors)
        )
    try:
        journal_path.parent.rmdir()
    except OSError:
        pass
    sync_directory(root)


def apply_plan(plan: dict[Path, PlanEntry], root: Path) -> None:
    """Publish a validated plan using a durable, recoverable transaction."""
    reserved_artifacts: set[Path] = set()
    staged: list[dict[str, object]] = []
    for path, plan_entry in sorted(plan.items()):
        staged.append(
            {
                "path": path,
                "desired": predeclare_artifact(
                    path, "desired", reserved_artifacts
                ),
                "desired_next": predeclare_artifact(
                    path, "desired-next", reserved_artifacts
                ),
                "backup": predeclare_artifact(
                    path, "backup", reserved_artifacts
                ),
                "backup_next": predeclare_artifact(
                    path, "backup-next", reserved_artifacts
                ),
                "plan": plan_entry,
            }
        )
    journal_path = transaction_journal_path(root, create=True)
    journal_entries = [
        {
            "path": transaction_relative(root, Path(entry["path"])),
            "backup": transaction_relative(root, Path(entry["backup"])),
            "desired": transaction_relative(root, Path(entry["desired"])),
            "backup_next": transaction_relative(
                root, Path(entry["backup_next"])
            ),
            "desired_next": transaction_relative(
                root, Path(entry["desired_next"])
            ),
            "original_sha256": entry["plan"].original_sha256,
            "desired_sha256": entry["plan"].desired_sha256,
            "original_mode": entry["plan"].original_mode,
            "desired_mode": entry["plan"].original_mode,
        }
        for entry in staged
    ]
    journal: dict[str, object] = {
        "version": 1,
        "phase": "initializing",
        "progress": 0,
        "entries": journal_entries,
    }
    try:
        write_journal(journal_path, journal, initialize=True)
        crash_at("after_initializing")
        for index, entry in enumerate(staged, start=1):
            plan_entry = entry["plan"]
            write_declared_artifact(
                Path(entry["desired"]),
                Path(entry["desired_next"]),
                plan_entry.desired_text.encode("utf-8"),
                plan_entry.original_mode,
                f"during_desired:{index}",
            )
            crash_at(f"after_desired:{index}")
            write_declared_artifact(
                Path(entry["backup"]),
                Path(entry["backup_next"]),
                plan_entry.original_bytes,
                plan_entry.original_mode,
                f"during_backup:{index}",
            )
            crash_at(f"after_backup:{index}")
        if fault_enabled("staging_dir_fsync_failure"):
            raise OSError("injected staging directory fsync failure")
        for parent in {Path(entry["path"]).parent for entry in staged}:
            sync_directory(parent)
        crash_at("after_staging_dir_fsync")

        for entry in staged:
            path = Path(entry["path"])
            plan_entry = entry["plan"]
            if not artifact_matches(
                path,
                plan_entry.original_sha256,
                plan_entry.original_mode,
                plan_entry.original_inode,
                plan_entry.original_device,
            ):
                abort_for_concurrent_edit(root, journal_path, staged, 0)
                raise ReconciliationError(
                    f"{path.relative_to(root)} changed after global validation; zero files published"
                )

        journal["phase"] = "prepared"
        write_journal(journal_path, journal)
        journal["phase"] = "publishing"
        write_journal(journal_path, journal)
        pause_at("after_global_check")
        for index, entry in enumerate(staged, start=1):
            path = Path(entry["path"])
            plan_entry = entry["plan"]
            if fault_enabled(f"publish_failure:{index}"):
                raise OSError(f"injected publish failure at {index}")
            # This is the narrowest portable check-before-replace sequence. An
            # arbitrary editor can still race in the instructions between this
            # lstat/read/lstat check and os.replace; POSIX has no pathname CAS.
            if not artifact_matches(
                path,
                plan_entry.original_sha256,
                plan_entry.original_mode,
                plan_entry.original_inode,
                plan_entry.original_device,
            ):
                abort_for_concurrent_edit(root, journal_path, staged, index - 1)
                raise ReconciliationError(
                    f"{path.relative_to(root)} changed immediately before publication; "
                    "prior files rolled back and editor bytes preserved"
                )
            os.replace(Path(entry["desired"]), path)
            sync_directory(path.parent)
            journal["progress"] = index
            write_journal(journal_path, journal)
            crash_at(f"after_publish:{index}")
            if index < len(staged):
                pause_at(f"between_publish:{index}")
        journal["phase"] = "committed"
        write_journal(journal_path, journal)
        crash_at("after_committed")
    except (OSError, UnicodeError, ReconciliationError) as transaction_error:
        try:
            recover_transaction(root)
        except ReconciliationError as recovery_error:
            raise ReconciliationError(
                "transaction failed and recovery requires attention: "
                f"{recovery_error}"
            ) from transaction_error
        raise ReconciliationError(
            f"transaction failed; durable recovery completed: {transaction_error}"
        ) from transaction_error

    recover_transaction(root)

    for path in sorted(plan):
        print(f"  reconciled: {path.relative_to(root)}")


def preview_plan(plan: dict[Path, PlanEntry], root: Path) -> None:
    if not plan:
        print("Ledger generated-document invariants are already satisfied.")
        return
    for path, entry in sorted(plan.items()):
        current = path.read_text(encoding="utf-8")
        relative_path = path.relative_to(root)
        sys.stdout.writelines(
            difflib.unified_diff(
                current.splitlines(keepends=True),
                entry.desired_text.splitlines(keepends=True),
                fromfile=f"a/{relative_path}",
                tofile=f"b/{relative_path}",
            )
        )


def check_plan(plan: dict[Path, PlanEntry], root: Path) -> None:
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
        with reconciliation_lock(root):
            recover_transaction(root)
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
