from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "reconcile-sprint1-docs.py"
SYNC_SCRIPT = Path(__file__).parents[1] / "sync-from-nous.sh"

STALE_TESTING = (
    "every path that touches tenant-scoped data (filtered by `org_id`)."
)
EXPECTED_TESTING = (
    "every path that touches tenant-scoped data (filtered by `company_id`)."
)
STALE_PACKAGE_ENTITY = (
    "db table + `org_id` and both a read-list and a mutation screen"
)
EXPECTED_PACKAGE_ENTITY = (
    "db table + `company_id` and both a read-list and a mutation screen"
)
STALE_PACKAGE_SCOPE = "take the tenant from the session, never the client."
EXPECTED_PACKAGE_SCOPE = (
    "load authorized company scope from Ledger DB after verifying the "
    "session; never take it from the client."
)
STALE_CHANGE_NOTES = textwrap.dedent(
    """\
    **Notes:** # CHG-001 — Reconcile Sprint 1 execution contract

    ## Trigger

    Sprint 1 readiness review found generator-owned guidance that contradicts the
    authoritative ER model and architecture.

    ## Required changes

    - Replace tenant guidance that names `org_id` or `tenant_id` with
      `company_id`, matching `0..."""
)
EXPECTED_CHANGE_NOTES = (
    "**Notes:** CHG-001 reconciles Sprint 1 guidance with "
    "[DEC-SMP-017](../decisions/DEC-SMP-017-sprint-1-execution-contract.md): "
    "`company_id` scoping, Keycloak/Auth.js redirect-based OIDC, and "
    "Docker Compose self-hosting."
)


def write(root: Path, relative_path: str, content: str) -> None:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def create_project(root: Path) -> None:
    claude = (
        "# CLAUDE.md — Ledger\n\n"
        "Use `company_id`, Keycloak with Auth.js, and Docker Compose.\n"
    )
    stale_mirror = (
        "<!-- stale generated mirror -->\n"
        "# CLAUDE.md — Ledger\n\n"
        "Use `company_id`, Keycloak with Auth.js, and Docker Compose.\n"
    )
    write(root, "AGENTS.md", "# Agents\n\nUse company-scoped authorization.\n")
    write(root, "CLAUDE.md", claude)
    write(root, "CODEX.md", stale_mirror)
    write(root, ".cursorrules", stale_mirror)
    write(root, ".github/copilot-instructions.md", stale_mirror)
    write(root, "docs/dev-guide/TESTING.md", f"prefix {STALE_TESTING}\n")
    write(root, "testing/critical-paths.md", f"prefix {STALE_TESTING}\n")
    write(
        root,
        "docs/dev-guide/PACKAGE_MAP.md",
        f"{STALE_PACKAGE_ENTITY}\n{STALE_PACKAGE_SCOPE}\n",
    )
    write(
        root,
        "docs/dev-guide/SECURITY.md",
        "Keycloak identities map to Ledger company authorization.\n",
    )
    write(
        root,
        "docs/stories/CHANGES.md",
        f"# Changes\n\n{STALE_CHANGE_NOTES}\n\n**Feedback:** readiness\n",
    )


def snapshot(root: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(path for path in root.rglob("*") if path.is_file())
    }


def run_reconciler(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )


class ReconciliationBehaviorTests(unittest.TestCase):
    def test_duplicate_governed_text_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            testing = root / "docs/dev-guide/TESTING.md"
            testing.write_text(
                f"{STALE_TESTING}\n{STALE_TESTING}\n",
                encoding="utf-8",
            )
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("exactly one stale or expected occurrence", result.stderr)

    def test_later_validation_failure_cannot_leave_partial_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            write(root, "testing/critical-paths.md", "unrecognized generated text\n")
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("testing/critical-paths.md", result.stderr)

    def test_forbidden_guidance_aborts_all_planned_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            write(
                root,
                "docs/dev-guide/SECURITY.md",
                "Use Auth0 for application authentication.\n",
            )
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stderr)
            self.assertIn("Auth0", result.stderr)

    def test_reconcile_enforces_exact_mirror_parity_and_complete_change_notes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            claude = (root / "CLAUDE.md").read_bytes()
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual((root / mirror).read_bytes(), claude)
            changes = (root / "docs/stories/CHANGES.md").read_text(
                encoding="utf-8"
            )
            self.assertIn(EXPECTED_CHANGE_NOTES, changes)
            self.assertNotIn("matching `0...", changes)

    def test_preview_shows_effective_changes_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            before = snapshot(root)

            result = run_reconciler(root, "--preview")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)
            self.assertIn("+prefix " + EXPECTED_TESTING, result.stdout)
            self.assertIn("docs/stories/CHANGES.md", result.stdout)

    def test_check_reports_exact_mirror_drift_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            before = snapshot(root)

            result = run_reconciler(root, "--check")

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("CODEX.md", result.stderr)
            self.assertIn("differs from CLAUDE.md", result.stderr)


class SyncScriptBehaviorTests(unittest.TestCase):
    def create_sync_fixture(self, root: Path) -> Path:
        create_project(root)
        script_target = root / "infra/scripts"
        script_target.mkdir(parents=True, exist_ok=True)
        (script_target / SYNC_SCRIPT.name).write_bytes(SYNC_SCRIPT.read_bytes())
        (script_target / SCRIPT.name).write_bytes(SCRIPT.read_bytes())

        nous_system = root / "fixture-nous-system"
        nous_system.mkdir()
        generator = nous_system / "nous_package.py"
        generator.write_text(
            textwrap.dedent(
                """\
                import argparse

                parser = argparse.ArgumentParser()
                parser.add_argument("command")
                parser.add_argument("--target", required=True)
                parser.add_argument("--project", required=True)
                parser.add_argument("--dry-run", action="store_true")
                parser.add_argument("-c", "--categories", nargs="*")
                args = parser.parse_args()
                print("generator preview" if args.dry_run else "generator sync")
                """
            ),
            encoding="utf-8",
        )
        return nous_system

    def run_sync(
        self, root: Path, nous_system: Path, *arguments: str
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["NOUS_SYSTEM"] = str(nous_system)
        return subprocess.run(
            ["bash", str(root / "infra/scripts/sync-from-nous.sh"), *arguments],
            cwd=root,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_dry_run_previews_effective_overrides_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nous_system = self.create_sync_fixture(root)
            before = snapshot(root)

            result = self.run_sync(root, nous_system, "--dry-run")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)
            self.assertIn("generator preview", result.stdout)
            self.assertIn("+prefix " + EXPECTED_TESTING, result.stdout)

    def test_selective_sync_runs_and_reports_repository_wide_invariants(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nous_system = self.create_sync_fixture(root)

            result = self.run_sync(root, nous_system, "-c", "sprint_plan")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("repository-wide", result.stdout)
            self.assertIn(
                EXPECTED_TESTING,
                (root / "docs/dev-guide/TESTING.md").read_text(encoding="utf-8"),
            )
            claude = (root / "CLAUDE.md").read_bytes()
            self.assertEqual((root / "CODEX.md").read_bytes(), claude)
            self.assertEqual((root / ".cursorrules").read_bytes(), claude)
            self.assertEqual(
                (root / ".github/copilot-instructions.md").read_bytes(),
                claude,
            )


if __name__ == "__main__":
    unittest.main()
