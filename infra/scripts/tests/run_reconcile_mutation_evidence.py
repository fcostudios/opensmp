#!/usr/bin/env python3
"""Run focused manual mutation evidence for the CHG-001 reconciler."""

from __future__ import annotations

import os
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
        """        if current_hash == source_hash:
""",
        """        if False and current_hash == source_hash:
""",
        (
            "ReconciliationBehaviorTests."
            "test_reconciles_known_source_hash_to_pinned_desired_artifacts"
        ),
    ),
    Mutation(
        "M02",
        "disable the pinned desired-hash no-op branch",
        """        elif current_hash == desired_hash:
""",
        """        elif False and current_hash == desired_hash:
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
""",
        """        if False and sha256(source_bytes) != source_hash:
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
""",
        """        if False and sha256(desired_bytes) != desired_hash:
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
        "accept an unknown reviewed guidance section",
        """        else:
            errors.append(
                f"{relative_path}: unknown reviewed guidance section; "
                "review and pin a new migration"
            )
""",
        """        else:
            desired[path] = current_text
""",
        (
            "ReconciliationBehaviorTests."
            "test_unknown_reviewed_section_fails_without_writing"
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
            and "FAILED (failures=1)" in output
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
