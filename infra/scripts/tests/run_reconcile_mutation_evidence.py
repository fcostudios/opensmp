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
        "weaken exact occurrence validation so duplicates bypass the count guard",
        """            elif (stale_count, expected_count) != (0, 1):
""",
        """            elif stale_count == 0 and expected_count == 0:
""",
        (
            "ReconciliationBehaviorTests."
            "test_duplicate_governed_text_fails_without_writing"
        ),
    ),
    Mutation(
        "M02",
        "write each replacement during validation, reintroducing partial writes",
        """        desired[path] = updated
""",
        """        atomic_write(path, updated)
        desired[path] = updated
""",
        (
            "ReconciliationBehaviorTests."
            "test_later_validation_failure_cannot_leave_partial_writes"
        ),
    ),
    Mutation(
        "M03",
        "disable the global forbidden-guidance postcondition",
        """            if match:
""",
        """            if False and match:
""",
        (
            "ReconciliationBehaviorTests."
            "test_forbidden_guidance_aborts_all_planned_writes"
        ),
    ),
    Mutation(
        "M04",
        "preserve stale mirrors instead of copying CLAUDE.md exactly",
        """        desired[path] = claude
""",
        """        desired[path] = original[path]
""",
        (
            "ReconciliationBehaviorTests."
            "test_reconcile_enforces_exact_mirror_parity_and_complete_change_notes"
        ),
    ),
    Mutation(
        "M05",
        "make preview mode apply its plan before rendering the diff",
        """def preview_plan(plan: dict[Path, str], root: Path) -> None:
    if not plan:
""",
        """def preview_plan(plan: dict[Path, str], root: Path) -> None:
    apply_plan(plan, root)
    if not plan:
""",
        (
            "ReconciliationBehaviorTests."
            "test_preview_shows_effective_changes_without_writing"
        ),
    ),
    Mutation(
        "M06",
        "make parity check mode return successfully despite drift",
        """def check_plan(plan: dict[Path, str], root: Path) -> None:
    if not plan:
""",
        """def check_plan(plan: dict[Path, str], root: Path) -> None:
    return
    if not plan:
""",
        (
            "ReconciliationBehaviorTests."
            "test_check_reports_exact_mirror_drift_without_writing"
        ),
    ),
    Mutation(
        "M07",
        "skip atomic replacement after a valid plan is built",
        """        atomic_write(path, text)
""",
        """        # mutant: validated output is never committed
""",
        (
            "ReconciliationBehaviorTests."
            "test_reconcile_enforces_exact_mirror_parity_and_complete_change_notes"
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
