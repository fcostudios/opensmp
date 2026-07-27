from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT = Path(
    os.environ.get(
        "RECONCILER_UNDER_TEST",
        Path(__file__).parents[1] / "reconcile-sprint1-docs.py",
    )
)
SCRIPT_DATA_ROOT = Path(__file__).parents[1]
SYNC_SCRIPT = SCRIPT_DATA_ROOT / "sync-from-nous.sh"
KNOWN_SUBSTRATE_ROOT = Path(__file__).parent / "fixtures/825e882"
PINNED_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-001/825e882"
PINNED_GUIDES = (
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
EXPECTED_NEXTJS_GUIDANCE = textwrap.dedent(
    """\
    ### nextjs 16.1.6

    - **App Router ONLY** — do NOT create files in `pages/` directory.
    - **Server Components by default** — add `"use client"` only when using hooks, event handlers, or browser APIs.
    - **Bundler: webpack** — `scripts.build` runs `next build --webpack` (Serwist injects a webpack config; Turbopack would hard-fail). Module imports MUST include file extensions for non-TS files (e.g., `import preset from './tailwind-preset.js'`).
    - **Server Actions** available. Use for form submissions instead of API routes.
    """
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


def write(root: Path, relative_path: str, content: str) -> None:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def desired_guide(relative_path: str) -> bytes:
    return (PINNED_OVERRIDE_ROOT / relative_path).read_bytes()


def create_project(root: Path) -> None:
    for relative_path in PINNED_GUIDES:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(desired_guide(relative_path))
    claude = desired_guide("CLAUDE.md").decode()
    stale_mirror = "<!-- stale generated mirror -->\n" + claude
    write(root, "CODEX.md", stale_mirror)
    write(root, ".cursorrules", stale_mirror)
    write(root, ".github/copilot-instructions.md", stale_mirror)
    write(
        root,
        "docs/dev-guide/PACKAGE_MAP.md",
        f"{STALE_PACKAGE_ENTITY}\n{STALE_PACKAGE_SCOPE}\n",
    )


def install_known_substrate_guides(root: Path) -> None:
    for relative_path in PINNED_GUIDES:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((KNOWN_SUBSTRATE_ROOT / relative_path).read_bytes())


def snapshot(root: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(path for path in root.rglob("*") if path.is_file())
    }


def copy_reconciler_data(root: Path) -> Path:
    data_root = root / "script-data"
    shutil.copytree(KNOWN_SUBSTRATE_ROOT, data_root / "tests/fixtures/825e882")
    shutil.copytree(
        PINNED_OVERRIDE_ROOT,
        data_root / "overrides/CHG-001/825e882",
    )
    return data_root


def run_reconciler(
    root: Path,
    *arguments: str,
    data_root: Path = SCRIPT_DATA_ROOT,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["RECONCILER_DATA_ROOT"] = str(data_root)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )


class ReconciliationBehaviorTests(unittest.TestCase):
    def test_committed_override_manifest_is_independent_exact_oracle(self) -> None:
        manifest_path = PINNED_OVERRIDE_ROOT / "manifest.json"

        self.assertTrue(manifest_path.is_file(), "pinned override manifest is missing")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(set(manifest["paths"]), set(PINNED_GUIDES))
        for relative_path in PINNED_GUIDES:
            metadata = manifest["paths"][relative_path]
            source = (KNOWN_SUBSTRATE_ROOT / relative_path).read_bytes()
            desired = desired_guide(relative_path)
            self.assertEqual(
                hashlib.sha256(source).hexdigest(),
                metadata["source_sha256"],
                relative_path,
            )
            self.assertEqual(
                hashlib.sha256(desired).hexdigest(),
                metadata["desired_sha256"],
                relative_path,
            )
        self.assertIn(
            EXPECTED_NEXTJS_GUIDANCE,
            desired_guide("CLAUDE.md").decode(),
        )

    def test_reconciles_known_source_hash_to_pinned_desired_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            install_known_substrate_guides(root)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            for relative_path in PINNED_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    desired_guide(relative_path),
                    relative_path,
                )
            claude = desired_guide("CLAUDE.md")
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual((root / mirror).read_bytes(), claude)

    def test_desired_hash_is_noop_and_claude_drives_mirrors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            claude = desired_guide("CLAUDE.md")
            for relative_path in PINNED_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    desired_guide(relative_path),
                    relative_path,
                )
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual((root / mirror).read_bytes(), claude)
            package_map = (root / "docs/dev-guide/PACKAGE_MAP.md").read_text(
                encoding="utf-8"
            )
            self.assertIn(EXPECTED_PACKAGE_ENTITY, package_map)
            self.assertIn(EXPECTED_PACKAGE_SCOPE, package_map)

    def test_unknown_pinned_hash_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            security = root / "docs/dev-guide/SECURITY.md"
            security.write_bytes(security.read_bytes() + b"unknown future sync\n")
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stderr)
            self.assertIn("unknown generated guidance state", result.stderr)
            self.assertIn("review and pin a new migration", result.stderr)

    def test_manifest_artifact_hash_mismatch_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            create_project(root)
            data_root = copy_reconciler_data(Path(directory))
            desired = (
                data_root
                / "overrides/CHG-001/825e882/docs/dev-guide/SECURITY.md"
            )
            desired.write_bytes(desired.read_bytes() + b"tampered\n")
            before = snapshot(root)

            result = run_reconciler(root, data_root=data_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stderr)
            self.assertIn("desired override artifact hash mismatch", result.stderr)

    def test_source_artifact_hash_mismatch_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            create_project(root)
            data_root = copy_reconciler_data(Path(directory))
            source = (
                data_root
                / "tests/fixtures/825e882/docs/dev-guide/SECURITY.md"
            )
            source.write_bytes(source.read_bytes() + b"tampered\n")
            before = snapshot(root)

            result = run_reconciler(root, data_root=data_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stderr)
            self.assertIn("pinned source artifact hash mismatch", result.stderr)

    def test_manifest_hash_tamper_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            create_project(root)
            data_root = copy_reconciler_data(Path(directory))
            manifest_path = (
                data_root / "overrides/CHG-001/825e882/manifest.json"
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["paths"]["docs/dev-guide/SECURITY.md"][
                "desired_sha256"
            ] = "0" * 64
            manifest_path.write_text(
                json.dumps(manifest, indent=2) + "\n",
                encoding="utf-8",
            )
            before = snapshot(root)

            result = run_reconciler(root, data_root=data_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stderr)
            self.assertIn("desired override artifact hash mismatch", result.stderr)

    def test_forbidden_unpinned_guidance_aborts_all_planned_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            write(
                root,
                "docs/dev-guide/EXTRA.md",
                "Use Auth0 for application authentication.\n",
            )
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/EXTRA.md", result.stderr)
            self.assertIn("Auth0", result.stderr)

    def test_preview_shows_pinned_changes_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            install_known_substrate_guides(root)
            before = snapshot(root)

            result = run_reconciler(root, "--preview")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stdout)
            self.assertIn("Keycloak", result.stdout)

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


class SyncIntegrationTests(unittest.TestCase):
    def test_sync_repairs_known_825e882_substrate_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            scripts = root / "infra/scripts"
            scripts.mkdir(parents=True, exist_ok=True)
            (scripts / SCRIPT.name).write_bytes(SCRIPT.read_bytes())
            (scripts / SYNC_SCRIPT.name).write_bytes(SYNC_SCRIPT.read_bytes())

            nous_system = root / "fixture-nous-system"
            nous_system.mkdir()
            write(
                nous_system,
                "nous_package.py",
                textwrap.dedent(
                    """\
                    import argparse
                    import os
                    import shutil
                    from pathlib import Path

                    parser = argparse.ArgumentParser()
                    parser.add_argument("command")
                    parser.add_argument("--target", required=True)
                    parser.add_argument("--project", required=True)
                    parser.add_argument("-c", "--categories", nargs="*")
                    args = parser.parse_args()

                    fixture = Path(os.environ["KNOWN_SUBSTRATE_FIXTURE"])
                    target = Path(args.target)
                    for source in fixture.rglob("*"):
                        if source.is_file():
                            destination = target / source.relative_to(fixture)
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(source, destination)
                    """
                ),
            )
            environment = os.environ.copy()
            environment["NOUS_SYSTEM"] = str(nous_system)
            environment["KNOWN_SUBSTRATE_FIXTURE"] = str(KNOWN_SUBSTRATE_ROOT)
            environment["RECONCILER_DATA_ROOT"] = str(SCRIPT_DATA_ROOT)

            result = subprocess.run(
                ["bash", str(scripts / SYNC_SCRIPT.name)],
                cwd=root,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            for relative_path in PINNED_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    desired_guide(relative_path),
                    relative_path,
                )
            claude = desired_guide("CLAUDE.md")
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual((root / mirror).read_bytes(), claude)


if __name__ == "__main__":
    unittest.main()
