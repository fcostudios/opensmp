#!/usr/bin/env python3
"""Run focused manual mutation evidence for the CHG-001 reconciler."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).parents[3]
SOURCE_PATH = PROJECT_ROOT / "infra/scripts/reconcile-sprint1-docs.py"
TEST_MODULE = "infra.scripts.tests.test_reconcile_sprint1_docs"


@dataclass(frozen=True)
class Mutation:
    identifier: str
    description: str
    original: str
    replacement: str
    killer: str


MUTATIONS = (
    Mutation(
        "M01",
        "disable the pinned source-hash migration branch",
        """        latest_override = latest.get(relative_path)
        if current_hash == source_hash:
""",
        """        latest_override = latest.get(relative_path)
        if False and current_hash == source_hash:
""",
        (
            "ReconciliationBehaviorTests."
            "test_reconciles_known_source_hash_to_pinned_desired_artifacts"
        ),
    ),
    Mutation(
        "M02",
        "disable the pinned desired-hash no-op branch",
        """            candidate = desired_text
        elif current_hash == desired_hash:
            candidate = current_text
""",
        """            candidate = desired_text
        elif False and current_hash == desired_hash:
            candidate = current_text
""",
        (
            "ReconciliationBehaviorTests."
            "test_desired_hash_is_noop_and_claude_drives_mirrors"
        ),
    ),
    Mutation(
        "M03",
        "accept an unknown generated guidance hash",
        """        else:
            errors.append(
                f"{relative_path}: unknown generated guidance state "
                f"(sha256={current_hash}); review and pin a new migration"
            )
""",
        """        else:
            desired[path] = current_text
""",
        (
            "ReconciliationBehaviorTests."
            "test_unknown_pinned_hash_fails_without_writing"
        ),
    ),
    Mutation(
        "M04",
        "disable pinned source-artifact hash verification",
        """        if sha256(source_bytes) != source_hash:
            raise ReconciliationError(
                f"{relative_path}: pinned source artifact hash mismatch"
            )
""",
        """        if False and sha256(source_bytes) != source_hash:
            raise ReconciliationError(
                f"{relative_path}: pinned source artifact hash mismatch"
            )
""",
        (
            "ReconciliationBehaviorTests."
            "test_source_artifact_hash_mismatch_fails_without_writing"
        ),
    ),
    Mutation(
        "M05",
        "disable desired override-artifact hash verification",
        """        if sha256(desired_bytes) != desired_hash:
            raise ReconciliationError(
                f"{relative_path}: desired override artifact hash mismatch"
            )
""",
        """        if False and sha256(desired_bytes) != desired_hash:
            raise ReconciliationError(
                f"{relative_path}: desired override artifact hash mismatch"
            )
""",
        (
            "ReconciliationBehaviorTests."
            "test_manifest_artifact_hash_mismatch_fails_without_writing"
        ),
    ),
    Mutation(
        "M06",
        "preserve stale mirrors instead of copying desired CLAUDE data",
        """        desired[path] = claude
""",
        """        desired[path] = original[path]
""",
        (
            "ReconciliationBehaviorTests."
            "test_desired_hash_is_noop_and_claude_drives_mirrors"
        ),
    ),
    Mutation(
        "M07",
        "disable the global forbidden-guidance postcondition",
        """            if match:
""",
        """            if False and match:
""",
        (
            "ReconciliationBehaviorTests."
            "test_forbidden_unpinned_guidance_aborts_all_planned_writes"
        ),
    ),
    Mutation(
        "M08",
        "make preview mode write its pinned plan",
        """def preview_plan(plan: dict[Path, str], root: Path) -> None:
    if not plan:
""",
        """def preview_plan(plan: dict[Path, str], root: Path) -> None:
    apply_plan(plan, root)
    if not plan:
""",
        (
            "ReconciliationBehaviorTests."
            "test_preview_shows_pinned_changes_without_writing"
        ),
    ),
    Mutation(
        "M09",
        "skip atomic application of a valid pinned plan",
        """        atomic_write(path, text)
""",
        """        # mutant: validated output is never committed
""",
        (
            "ReconciliationBehaviorTests."
            "test_reconciles_known_source_hash_to_pinned_desired_artifacts"
        ),
    ),
    Mutation(
        "M10",
        "accept duplicate markers in a reviewed guidance section",
        """    if (
        reviewed_change.count(start_marker) != 1
        or reviewed_change.count(end_marker) != 1
    ):
""",
        """    if False and (
        reviewed_change.count(start_marker) != 1
        or reviewed_change.count(end_marker) != 1
    ):
""",
        (
            "ReconciliationBehaviorTests."
            "test_unknown_reviewed_section_fails_without_writing"
        ),
    ),
    Mutation(
        "M11",
        "accept a CHG-004 manifest outside its exact output path set",
        """    if set(entries) != set(CHG004_PATHS):
        raise ReconciliationError(
            "CHG-004 override manifest paths do not match the allowed path set"
        )
""",
        """    if False and set(entries) != set(CHG004_PATHS):
        raise ReconciliationError(
            "CHG-004 override manifest paths do not match the allowed path set"
        )
""",
        (
            "ReconciliationBehaviorTests."
            "test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes"
        ),
    ),
    Mutation(
        "M12",
        "accept a CHG-005 manifest outside its exact story path set",
        """    if set(entries) != CHG005_PATHS:
        raise ReconciliationError(
            "CHG-005 override manifest paths do not match the allowed path set"
        )
""",
        """    if False and set(entries) != CHG005_PATHS:
        raise ReconciliationError(
            "CHG-005 override manifest paths do not match the allowed path set"
        )
""",
        (
            "ReconciliationBehaviorTests."
            "test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes"
        ),
    ),
    Mutation(
        "M13",
        "accept a CHG-004 source artifact from an unrelated reviewed path",
        """        if source_path != CHG004_PATHS[relative_path]:
            raise ReconciliationError(
                f"{relative_path}: invalid CHG-004 source path"
            )
""",
        """        if False and source_path != CHG004_PATHS[relative_path]:
            raise ReconciliationError(
                f"{relative_path}: invalid CHG-004 source path"
            )
""",
        (
            "ReconciliationBehaviorTests."
            "test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes"
        ),
    ),
    Mutation(
        "M14",
        "accept malformed or noncanonical SHA-256 manifest values",
        """    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ReconciliationError(f"{description}: invalid SHA-256")
""",
        """    if False and (
        not isinstance(value, str)
        or re.fullmatch(r"[0-9a-f]{64}", value) is None
    ):
        raise ReconciliationError(f"{description}: invalid SHA-256")
""",
        (
            "ReconciliationBehaviorTests."
            "test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes"
        ),
    ),
    Mutation(
        "M15",
        "allow a manifest artifact symlink to escape its trusted root",
        """    if not resolved_path.is_relative_to(resolved_root):
        raise ReconciliationError(f"{description}: path escapes its manifest root")
""",
        """    if False and not resolved_path.is_relative_to(resolved_root):
        raise ReconciliationError(f"{description}: path escapes its manifest root")
""",
        (
            "ReconciliationBehaviorTests."
            "test_manifest_source_symlink_cannot_escape_data_root"
        ),
    ),
)


def main() -> int:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    survivors: list[str] = []

    for mutation in MUTATIONS:
        if source.count(mutation.original) != 1:
            raise RuntimeError(
                f"{mutation.identifier}: mutation anchor must occur exactly once"
            )
        mutated = source.replace(mutation.original, mutation.replacement, 1)
        compile(mutated, f"<{mutation.identifier}>", "exec")

        with tempfile.TemporaryDirectory() as directory:
            mutant_path = Path(directory) / SOURCE_PATH.name
            mutant_path.write_text(mutated, encoding="utf-8")
            environment = os.environ.copy()
            environment["RECONCILER_UNDER_TEST"] = str(mutant_path)
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "unittest",
                    f"{TEST_MODULE}.{mutation.killer}",
                    "-v",
                ],
                cwd=PROJECT_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

        output = result.stdout + result.stderr
        killed_by_assertion = (
            result.returncode != 0
            and re.search(r"FAILED \(failures=[1-9][0-9]*\)", output) is not None
            and "ERROR" not in output
        )
        if killed_by_assertion:
            print(f"KILLED {mutation.identifier}: {mutation.description}")
        else:
            survivors.append(mutation.identifier)
            print(f"SURVIVED {mutation.identifier}: {mutation.description}")
            print(output)

    if survivors:
        print(f"surviving mutations: {', '.join(survivors)}", file=sys.stderr)
        return 1
    print(f"mutation score: {len(MUTATIONS)}/{len(MUTATIONS)} killed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
