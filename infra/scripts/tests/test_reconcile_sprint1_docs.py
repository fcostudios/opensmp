from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
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
LATEST_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-004/e4b9a06"
STORY_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-005/277b64e"
READINESS_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-022/16f72c9"
REPINNED_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-042/fd7741f"
CRITICAL_SET_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-044/2d93300"
CHG049_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-049/6466f60"
CHG053_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-053/2dee869"
CHG055_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-055/e240d85"
CHG059_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-059/7f42371"
CHG065_OVERRIDE_ROOT = SCRIPT_DATA_ROOT / "overrides/CHG-065/7817e94"
CHG053_DELIVERED_ROOT = Path(__file__).parents[3]
CHG053_GUIDES = (
    "CLAUDE.md",
    "docs/dev-guide/FRONTEND.md",
)
CHG055_GUIDES = (
    "docs/dev-guide/DEFINITION_OF_DONE.md",
    "docs/dev-guide/SECURITY.md",
    "docs/dev-guide/STANDARDS.md",
)
# Stamp Nous's agent-sync emitted on the 2026-10-01 mirrors (CODEX.md) for the
# CLAUDE.md that the CHG-065 layer pins.
CHG065_MIRROR_HEADER = (
    b"<!-- agent-sync: ca4a7c18b2c9 | source: CLAUDE.md | DO NOT EDIT "
    b"\xe2\x80\x94 this file is auto-generated from CLAUDE.md. Edit CLAUDE.md then "
    b"run: python3 nous_agent_sync.py -->\n"
)
READINESS_GUIDES = (
    "AGENTS.md",
    "CLAUDE.md",
    "docs/dev-guide/DEFINITION_OF_DONE.md",
)
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


def latest_desired_guide(relative_path: str) -> bytes:
    chg065 = CHG065_OVERRIDE_ROOT / relative_path
    if chg065.is_file():
        return chg065.read_bytes()
    chg059 = CHG059_OVERRIDE_ROOT / relative_path
    if chg059.is_file():
        return chg059.read_bytes()
    chg055 = CHG055_OVERRIDE_ROOT / relative_path
    if chg055.is_file():
        return chg055.read_bytes()
    chg053 = CHG053_OVERRIDE_ROOT / relative_path
    if chg053.is_file():
        return chg053.read_bytes()
    chg049 = CHG049_OVERRIDE_ROOT / relative_path
    if chg049.is_file():
        return chg049.read_bytes()
    critical_set = CRITICAL_SET_OVERRIDE_ROOT / relative_path
    if critical_set.is_file():
        return critical_set.read_bytes()
    repinned = REPINNED_OVERRIDE_ROOT / relative_path
    if repinned.is_file():
        return repinned.read_bytes()
    readiness = READINESS_OVERRIDE_ROOT / relative_path
    if readiness.is_file():
        return readiness.read_bytes()
    latest = LATEST_OVERRIDE_ROOT / relative_path
    return latest.read_bytes() if latest.is_file() else desired_guide(relative_path)


def create_project(root: Path) -> None:
    for relative_path in PINNED_GUIDES:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(latest_desired_guide(relative_path))
    claude_body, trailer = split_terminal_emitted_trailer(
        latest_desired_guide("CLAUDE.md")
    )
    synced_mirror = CHG065_MIRROR_HEADER + claude_body + trailer
    for mirror in ("CODEX.md", ".cursorrules", ".github/copilot-instructions.md"):
        path = root / mirror
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(synced_mirror)
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
    shutil.copytree(
        LATEST_OVERRIDE_ROOT,
        data_root / "overrides/CHG-004/e4b9a06",
    )
    shutil.copytree(
        STORY_OVERRIDE_ROOT,
        data_root / "overrides/CHG-005/277b64e",
    )
    shutil.copytree(
        READINESS_OVERRIDE_ROOT,
        data_root / "overrides/CHG-022/16f72c9",
    )
    shutil.copytree(
        REPINNED_OVERRIDE_ROOT,
        data_root / "overrides/CHG-042/fd7741f",
    )
    shutil.copytree(
        CRITICAL_SET_OVERRIDE_ROOT,
        data_root / "overrides/CHG-044/2d93300",
    )
    if CHG049_OVERRIDE_ROOT.is_dir():
        shutil.copytree(
            CHG049_OVERRIDE_ROOT,
            data_root / "overrides/CHG-049/6466f60",
        )
    if CHG053_OVERRIDE_ROOT.is_dir():
        shutil.copytree(
            CHG053_OVERRIDE_ROOT,
            data_root / "overrides/CHG-053/2dee869",
        )
    if CHG055_OVERRIDE_ROOT.is_dir():
        shutil.copytree(
            CHG055_OVERRIDE_ROOT,
            data_root / "overrides/CHG-055/e240d85",
        )
    if CHG059_OVERRIDE_ROOT.is_dir():
        shutil.copytree(
            CHG059_OVERRIDE_ROOT,
            data_root / "overrides/CHG-059/7f42371",
        )
    if CHG065_OVERRIDE_ROOT.is_dir():
        shutil.copytree(
            CHG065_OVERRIDE_ROOT,
            data_root / "overrides/CHG-065/7817e94",
        )
    return data_root


def chg053_delivered_guide(relative_path: str) -> bytes:
    return (CHG053_DELIVERED_ROOT / relative_path).read_bytes()


def create_chg053_project(root: Path) -> None:
    create_project(root)
    for relative_path in CHG053_GUIDES:
        (root / relative_path).write_bytes(chg053_delivered_guide(relative_path))

    for mirror in ("CODEX.md", ".cursorrules", ".github/copilot-instructions.md"):
        (root / mirror).write_bytes(chg053_delivered_guide(mirror))
    write(
        root,
        "docs/dev-guide/PACKAGE_MAP.md",
        f"{EXPECTED_PACKAGE_ENTITY}\n{EXPECTED_PACKAGE_SCOPE}\n",
    )


def create_chg055_project(root: Path) -> None:
    create_project(root)
    for relative_path in CHG055_GUIDES:
        (root / relative_path).write_bytes(
            (CHG053_DELIVERED_ROOT / relative_path).read_bytes()
        )
    write(
        root,
        "docs/dev-guide/PACKAGE_MAP.md",
        f"{EXPECTED_PACKAGE_ENTITY}\n{EXPECTED_PACKAGE_SCOPE}\n",
    )


TERMINAL_EMITTED_TRAILER = re.compile(
    rb"<!-- nous-emitted: sha256=[0-9a-f]{16} -->\n?\Z"
)


def split_terminal_emitted_trailer(content: bytes) -> tuple[bytes, bytes]:
    matches = list(TERMINAL_EMITTED_TRAILER.finditer(content))
    if len(matches) != 1:
        raise AssertionError("expected exactly one valid terminal emitted trailer")
    match = matches[0]
    return content[: match.start()], match.group(0)


def latest_claude_body() -> bytes:
    body, _ = split_terminal_emitted_trailer(latest_desired_guide("CLAUDE.md"))
    return body


def run_reconciler(
    root: Path,
    *arguments: str,
    data_root: Path = SCRIPT_DATA_ROOT,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["RECONCILER_DATA_ROOT"] = str(data_root)
    if extra_env:
        environment.update(extra_env)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )


def fault_environment(point: str, sync_dir: Path | None = None) -> dict[str, str]:
    environment = {
        "RECONCILER_FAULT_TOKEN": "CHG022-TRANSACTION-TEST",
        "RECONCILER_FAULT_POINT": point,
    }
    if sync_dir is not None:
        environment["RECONCILER_FAULT_SYNC_DIR"] = str(sync_dir)
    return environment


def create_chg022_drift(root: Path) -> None:
    create_project(root)
    for relative_path in READINESS_GUIDES:
        (root / relative_path).write_bytes(desired_guide(relative_path))
    claude = desired_guide("CLAUDE.md")
    _, trailer = split_terminal_emitted_trailer(
        latest_desired_guide("CLAUDE.md")
    )
    for mirror in ("CODEX.md", ".cursorrules", ".github/copilot-instructions.md"):
        (root / mirror).write_bytes(CHG065_MIRROR_HEADER + claude + trailer)
    write(
        root,
        "docs/dev-guide/PACKAGE_MAP.md",
        f"{EXPECTED_PACKAGE_ENTITY}\n{EXPECTED_PACKAGE_SCOPE}\n",
    )


def transaction_artifacts(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and (path.name.endswith(".tmp") or ".reconcile-sprint1-transactions" in str(path))
    )


class ReconciliationBehaviorTests(unittest.TestCase):
    def test_initializing_transaction_crashes_restart_all_old_without_orphans(self) -> None:
        for point in (
            "during_initial_journal",
            "after_initializing",
            "during_desired:1",
            "after_desired:1",
            "during_backup:1",
            "after_backup:1",
            "after_staging_dir_fsync",
        ):
            with self.subTest(point=point), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg022_drift(root)
                modes = {
                    relative_path: (root / relative_path).stat().st_mode
                    for relative_path in READINESS_GUIDES
                }

                crashed = run_reconciler(root, extra_env=fault_environment(point))
                self.assertEqual(crashed.returncode, 86, crashed.stderr)
                recovered = run_reconciler(root, "--check")

                self.assertEqual(recovered.returncode, 1, recovered.stderr)
                for relative_path in READINESS_GUIDES:
                    self.assertEqual(
                        (root / relative_path).read_bytes(),
                        desired_guide(relative_path),
                    )
                    self.assertEqual(
                        (root / relative_path).stat().st_mode,
                        modes[relative_path],
                    )
                self.assertEqual(transaction_artifacts(root), [])

                applied = run_reconciler(root)

                self.assertEqual(applied.returncode, 0, applied.stderr)
                for relative_path in READINESS_GUIDES:
                    self.assertEqual(
                        (root / relative_path).read_bytes(),
                        latest_desired_guide(relative_path),
                    )
                self.assertEqual(transaction_artifacts(root), [])

    def test_transaction_crashes_roll_back_or_forward_without_orphans(self) -> None:
        for point, expected_new in (
            ("after_publish:1", False),
            ("after_publish:2", False),
            ("after_committed", True),
        ):
            with self.subTest(point=point), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg022_drift(root)
                modes = {
                    relative_path: (root / relative_path).stat().st_mode
                    for relative_path in READINESS_GUIDES
                }

                crashed = run_reconciler(root, extra_env=fault_environment(point))
                self.assertEqual(crashed.returncode, 86, crashed.stderr)
                recovered = run_reconciler(root, "--check")

                self.assertEqual(recovered.returncode, 0 if expected_new else 1)
                for relative_path in READINESS_GUIDES:
                    expected = (
                        latest_desired_guide(relative_path)
                        if expected_new
                        else desired_guide(relative_path)
                    )
                    self.assertEqual((root / relative_path).read_bytes(), expected)
                    self.assertEqual((root / relative_path).stat().st_mode, modes[relative_path])
                self.assertEqual(transaction_artifacts(root), [])

    def test_recovery_itself_can_crash_then_resume_to_all_old(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg022_drift(root)
            self.assertEqual(
                run_reconciler(
                    root, extra_env=fault_environment("after_publish:2")
                ).returncode,
                86,
            )
            self.assertEqual(
                run_reconciler(
                    root,
                    "--check",
                    extra_env=fault_environment("recovery:1"),
                ).returncode,
                86,
            )

            recovered = run_reconciler(root, "--check")

            self.assertEqual(recovered.returncode, 1)
            for relative_path in READINESS_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(), desired_guide(relative_path)
                )
            self.assertEqual(transaction_artifacts(root), [])

    def test_concurrent_edit_after_validation_fails_with_zero_publications(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            sync_dir = Path(directory) / "sync"
            create_chg022_drift(root)
            environment = os.environ.copy()
            environment["RECONCILER_DATA_ROOT"] = str(SCRIPT_DATA_ROOT)
            environment.update(fault_environment("after_global_check", sync_dir))
            process = subprocess.Popen(
                [sys.executable, str(SCRIPT), str(root)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=environment,
            )
            deadline = time.monotonic() + 10
            while not (sync_dir / "ready").exists():
                self.assertIsNone(process.poll(), "reconciler exited before pause")
                self.assertLess(time.monotonic(), deadline, "pause marker timed out")
                time.sleep(0.01)
            competing = subprocess.Popen(
                [sys.executable, str(SCRIPT), str(root), "--check"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "RECONCILER_DATA_ROOT": str(SCRIPT_DATA_ROOT)},
            )
            time.sleep(0.1)
            self.assertIsNone(competing.poll(), "cross-process lock did not block")
            concurrent = root / "CLAUDE.md"
            concurrent.write_bytes(b"concurrent operator edit\n")
            write(sync_dir, "continue", "continue\n")

            stdout, stderr = process.communicate(timeout=10)
            competing_stdout, competing_stderr = competing.communicate(timeout=10)

            self.assertNotEqual(process.returncode, 0, stdout)
            self.assertIn("changed immediately before publication", stderr)
            self.assertNotEqual(competing.returncode, 0, competing_stdout)
            self.assertIn("unknown generated guidance state", competing_stderr)
            self.assertEqual(concurrent.read_bytes(), b"concurrent operator edit\n")
            self.assertEqual((root / "AGENTS.md").read_bytes(), desired_guide("AGENTS.md"))
            self.assertEqual(transaction_artifacts(root), [])

    def test_concurrent_edit_between_publications_rolls_back_prior_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            sync_dir = Path(directory) / "sync"
            create_chg022_drift(root)
            environment = {
                **os.environ,
                "RECONCILER_DATA_ROOT": str(SCRIPT_DATA_ROOT),
                **fault_environment("between_publish:1", sync_dir),
            }
            process = subprocess.Popen(
                [sys.executable, str(SCRIPT), str(root)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=environment,
            )
            deadline = time.monotonic() + 10
            while not (sync_dir / "ready").exists():
                self.assertIsNone(process.poll(), "reconciler exited before pause")
                self.assertLess(time.monotonic(), deadline, "pause marker timed out")
                time.sleep(0.01)
            concurrent = root / "CLAUDE.md"
            concurrent.write_bytes(b"editor bytes between replacements\n")
            write(sync_dir, "continue", "continue\n")

            stdout, stderr = process.communicate(timeout=10)

            self.assertNotEqual(process.returncode, 0, stdout)
            self.assertIn("prior files rolled back and editor bytes preserved", stderr)
            self.assertEqual(
                (root / "AGENTS.md").read_bytes(), desired_guide("AGENTS.md")
            )
            self.assertEqual(
                concurrent.read_bytes(), b"editor bytes between replacements\n"
            )
            self.assertEqual(
                (root / "docs/dev-guide/DEFINITION_OF_DONE.md").read_bytes(),
                desired_guide("docs/dev-guide/DEFINITION_OF_DONE.md"),
            )
            self.assertEqual(transaction_artifacts(root), [])

    def test_tampered_initializing_journal_rejects_before_recovery_writes(self) -> None:
        for variant in ("escape", "hash"):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg022_drift(root)
                self.assertEqual(
                    run_reconciler(
                        root, extra_env=fault_environment("after_initializing")
                    ).returncode,
                    86,
                )
                journal_path = root / ".reconcile-sprint1-transactions/active.json"
                journal = json.loads(journal_path.read_text(encoding="utf-8"))
                if variant == "escape":
                    journal["entries"][0]["desired"] = "../outside-desired.tmp"
                else:
                    journal["entries"][0]["original_sha256"] = "0" * 64
                journal_path.write_text(
                    json.dumps(journal, sort_keys=True, separators=(",", ":")) + "\n",
                    encoding="utf-8",
                )
                before = snapshot(root)

                result = run_reconciler(root, "--check")

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(root), before)
                self.assertNotIn("Traceback", result.stderr)

    def test_initializing_recovery_removes_incomplete_regular_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg022_drift(root)
            self.assertEqual(
                run_reconciler(
                    root, extra_env=fault_environment("after_desired:1")
                ).returncode,
                86,
            )
            journal_path = root / ".reconcile-sprint1-transactions/active.json"
            journal = json.loads(journal_path.read_text(encoding="utf-8"))
            declared = root / journal["entries"][0]["desired"]
            declared.write_bytes(b"incomplete staged bytes\n")

            recovered = run_reconciler(root, "--check")

            self.assertEqual(recovered.returncode, 1, recovered.stderr)
            for relative_path in READINESS_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(), desired_guide(relative_path)
                )
            self.assertEqual(transaction_artifacts(root), [])

    def test_orphan_initial_journal_auxiliary_rejects_conflicting_context(self) -> None:
        for variant in ("symlink", "extra"):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "project"
                create_chg022_drift(root)
                self.assertEqual(
                    run_reconciler(
                        root, extra_env=fault_environment("during_initial_journal")
                    ).returncode,
                    86,
                )
                transaction_dir = root / ".reconcile-sprint1-transactions"
                journal_next = transaction_dir / ".active.json.next.tmp"
                if variant == "symlink":
                    journal_next.unlink()
                    journal_next.symlink_to(Path(directory) / "outside")
                else:
                    (transaction_dir / "conflict").write_bytes(b"conflict\n")
                before = snapshot(root)

                result = run_reconciler(root, "--check")

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("conflicting or tampered", result.stderr)
                self.assertEqual(snapshot(root), before)
                self.assertNotIn("Traceback", result.stderr)

    def test_valid_initial_journal_rejects_conflicting_context_before_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg022_drift(root)
            self.assertEqual(
                run_reconciler(
                    root, extra_env=fault_environment("after_initializing")
                ).returncode,
                86,
            )
            transaction_dir = root / ".reconcile-sprint1-transactions"
            (transaction_dir / "conflict").write_bytes(b"conflict\n")
            before = snapshot(root)

            result = run_reconciler(root, "--check")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("conflicting or tampered", result.stderr)
            self.assertEqual(snapshot(root), before)
            self.assertNotIn("Traceback", result.stderr)

    def test_tampered_or_escaping_journal_fails_before_recovery_writes(self) -> None:
        for variant in ("escape", "hash"):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg022_drift(root)
                self.assertEqual(
                    run_reconciler(
                        root, extra_env=fault_environment("after_publish:1")
                    ).returncode,
                    86,
                )
                journal_path = root / ".reconcile-sprint1-transactions/active.json"
                journal = json.loads(journal_path.read_text(encoding="utf-8"))
                if variant == "escape":
                    journal["entries"][0]["backup"] = "../outside-backup"
                else:
                    journal["entries"][0]["original_sha256"] = "0" * 64
                journal_path.write_text(
                    json.dumps(journal, sort_keys=True, separators=(",", ":")) + "\n",
                    encoding="utf-8",
                )
                before = snapshot(root)

                result = run_reconciler(root, "--check")

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(root), before)
                self.assertNotIn("Traceback", result.stderr)

    def test_fault_contract_cleans_staging_and_retries_cleanup_without_mocks(self) -> None:
        for point, expected_code in (
            ("stage_failure:3", 1),
            ("staging_dir_fsync_failure", 1),
            ("after_global_check", 1),
            ("cleanup_unlink_once", 0),
        ):
            with self.subTest(point=point), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg022_drift(root)
                before = snapshot(root)

                result = run_reconciler(root, extra_env=fault_environment(point))

                self.assertEqual(result.returncode, expected_code, result.stderr)
                if point != "cleanup_unlink_once":
                    self.assertEqual(snapshot(root), before)
                else:
                    for relative_path in READINESS_GUIDES:
                        self.assertEqual(
                            (root / relative_path).read_bytes(),
                            latest_desired_guide(relative_path),
                        )
                self.assertEqual(transaction_artifacts(root), [])

    def test_persistent_rollback_failure_preserves_recovery_then_resumes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg022_drift(root)
            result = run_reconciler(
                root,
                extra_env=fault_environment(
                    "publish_failure:2,rollback_replace_persistent"
                ),
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("mixed state", result.stderr)
            self.assertIn("recovery backup", result.stderr)
            backups = list(root.rglob("*.backup.*.tmp"))
            self.assertEqual(len(backups), 1)
            self.assertIn("AGENTS.md", backups[0].name)
            unrelated_temps = [
                path
                for path in transaction_artifacts(root)
                if path != backups[0]
                and path.name != "active.json"
            ]
            self.assertEqual(unrelated_temps, [])

            recovered = run_reconciler(root, "--check")

            self.assertEqual(recovered.returncode, 1)
            for relative_path in READINESS_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(), desired_guide(relative_path)
                )
            self.assertEqual(transaction_artifacts(root), [])

    def test_chg022_manifest_binds_exact_source_and_desired_artifacts(self) -> None:
        manifest = json.loads(
            (READINESS_OVERRIDE_ROOT / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(set(manifest), {"version", "paths"})
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(set(manifest["paths"]), set(READINESS_GUIDES))
        for relative_path in READINESS_GUIDES:
            metadata = manifest["paths"][relative_path]
            self.assertEqual(
                set(metadata),
                {"source_path", "source_sha256", "desired_sha256"},
            )
            self.assertEqual(
                metadata["source_path"],
                f"overrides/CHG-001/825e882/{relative_path}",
            )
            self.assertEqual(
                metadata["source_sha256"],
                hashlib.sha256(desired_guide(relative_path)).hexdigest(),
            )
            self.assertEqual(
                metadata["desired_sha256"],
                hashlib.sha256(
                    (READINESS_OVERRIDE_ROOT / relative_path).read_bytes()
                ).hexdigest(),
            )

    def test_chg022_upgrades_current_chg001_guidance_to_readiness_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            for relative_path in READINESS_GUIDES:
                (root / relative_path).write_bytes(desired_guide(relative_path))

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            for relative_path in READINESS_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    latest_desired_guide(relative_path),
                    relative_path,
                )

    def test_chg022_check_reports_drift_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            for relative_path in READINESS_GUIDES:
                (root / relative_path).write_bytes(desired_guide(relative_path))
            before = snapshot(root)

            result = run_reconciler(root, "--check")

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            for relative_path in READINESS_GUIDES:
                self.assertIn(relative_path, result.stderr)

    def test_chg022_repairs_all_three_governed_files_together(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            for relative_path in READINESS_GUIDES:
                (root / relative_path).write_bytes(desired_guide(relative_path))

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            for relative_path in READINESS_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    latest_desired_guide(relative_path),
                )
            self.assertEqual(run_reconciler(root, "--check").returncode, 0)

    def test_chg022_source_and_desired_tamper_fail_before_writes(self) -> None:
        for artifact_kind in ("source", "desired"):
            with self.subTest(artifact_kind=artifact_kind), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                root = base / "project"
                create_project(root)
                data_root = copy_reconciler_data(base)
                artifact = (
                    data_root / "overrides/CHG-001/825e882/AGENTS.md"
                    if artifact_kind == "source"
                    else data_root / "overrides/CHG-022/16f72c9/AGENTS.md"
                )
                artifact.write_bytes(artifact.read_bytes() + b"tampered\n")
                before = snapshot(root)

                result = run_reconciler(root, data_root=data_root)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(root), before)
                self.assertIn("CHG-022", result.stderr)
                self.assertIn("hash mismatch", result.stderr)

    def test_unknown_post_chg022_state_fails_closed_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            agents = root / "AGENTS.md"
            agents.write_bytes(agents.read_bytes() + b"unknown future state\n")
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("AGENTS.md: unknown generated guidance state", result.stderr)

    def test_chg053_manifest_binds_the_two_approved_transitions(self) -> None:
        manifest_path = CHG053_OVERRIDE_ROOT / "manifest.json"
        self.assertTrue(manifest_path.is_file(), "CHG-053 override manifest is missing")

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(
            manifest,
            {
                "version": 1,
                "paths": {
                    "CLAUDE.md": {
                        "source_path": "overrides/CHG-049/6466f60/CLAUDE.md",
                        "source_sha256": (
                            "3f0905a05225b595636b0369b297c88176f764377da8543ed428df47d6f164d3"
                        ),
                        "desired_sha256": (
                            "32f30b52af12a1591e0ec0507ab7f332b5d092a45b25fb0acdba08e6b6aed94f"
                        ),
                    },
                    "docs/dev-guide/FRONTEND.md": {
                        "source_path": (
                            "overrides/CHG-049/6466f60/docs/dev-guide/FRONTEND.md"
                        ),
                        "source_sha256": (
                            "30cd67e73fe3593e1f1d0aba4088ebc63ecd0fd69a86db262e8f860e02e8ca4c"
                        ),
                        "desired_sha256": (
                            "b40ca6d396e3063a05bdfe638dc9c02cba515d410cd2d19a248433a16aa532dc"
                        ),
                    },
                },
            },
        )
        for relative_path, metadata in manifest["paths"].items():
            source = SCRIPT_DATA_ROOT / metadata["source_path"]
            desired = CHG053_OVERRIDE_ROOT / relative_path
            self.assertEqual(
                hashlib.sha256(source.read_bytes()).hexdigest(),
                metadata["source_sha256"],
                relative_path,
            )
            self.assertEqual(
                hashlib.sha256(desired.read_bytes()).hexdigest(),
                metadata["desired_sha256"],
                relative_path,
            )

    def test_chg055_manifest_binds_the_three_approved_transitions(self) -> None:
        manifest_path = CHG055_OVERRIDE_ROOT / "manifest.json"
        self.assertTrue(manifest_path.is_file(), "CHG-055 override manifest is missing")

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        expected = {
            "docs/dev-guide/DEFINITION_OF_DONE.md": (
                "ae0060ef2adfe269aec8bda3e14f79b4f14db0243a99b39ab91ed5bf161f4560",
                "b12b953006b2c2fe0d7bad74fed0dca8451024e6c66060b1828cae195ade041e",
            ),
            "docs/dev-guide/SECURITY.md": (
                "022d772834a4b78de32e5eb2baee1701878bd84d18c85564703505c0c7e3e694",
                "0806022c650afcea0329c2b0380c60d12048fd35dbcb19a04df096b568999b37",
            ),
            "docs/dev-guide/STANDARDS.md": (
                "3347158c79e0032db6a878b9ef92a4ba6d26d783e64f2fe463e486869a066a22",
                "93460713aad5ccb32cc3fe1981d017165d7e1ff7caef90659bf4a79d3810f7ca",
            ),
        }
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(set(manifest["paths"]), set(expected))
        for relative_path, (source_hash, desired_hash) in expected.items():
            metadata = manifest["paths"][relative_path]
            self.assertEqual(
                metadata,
                {
                    "source_path": f"overrides/CHG-049/6466f60/{relative_path}",
                    "source_sha256": source_hash,
                    "desired_sha256": desired_hash,
                },
            )
            self.assertEqual(
                hashlib.sha256(
                    (SCRIPT_DATA_ROOT / metadata["source_path"]).read_bytes()
                ).hexdigest(),
                source_hash,
            )
            self.assertEqual(
                hashlib.sha256(
                    (CHG055_OVERRIDE_ROOT / relative_path).read_bytes()
                ).hexdigest(),
                desired_hash,
            )

    def test_chg055_delivered_guides_are_byte_stable_in_check_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg055_project(root)
            before = snapshot(root)

            result = run_reconciler(root, "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)

    def test_chg059_manifest_binds_the_testing_contract_transition(self) -> None:
        manifest_path = CHG059_OVERRIDE_ROOT / "manifest.json"
        self.assertTrue(manifest_path.is_file(), "CHG-059 override manifest is missing")

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(
            manifest,
            {
                "version": 1,
                "paths": {
                    "docs/dev-guide/TESTING.md": {
                        "source_path": (
                            "overrides/CHG-049/6466f60/docs/dev-guide/TESTING.md"
                        ),
                        "source_sha256": (
                            "4c201f4ea67e3edc817e8edf1ff05b5d3a9ea4edff6bfb199b0120c57b902732"
                        ),
                        "desired_sha256": (
                            "5dc6ebf9336f05c9643755887ee6c5c2757d55ebf215a6e168f6801c97a6df11"
                        ),
                    },
                },
            },
        )
        metadata = manifest["paths"]["docs/dev-guide/TESTING.md"]
        self.assertEqual(
            hashlib.sha256(
                (SCRIPT_DATA_ROOT / metadata["source_path"]).read_bytes()
            ).hexdigest(),
            metadata["source_sha256"],
        )
        self.assertEqual(
            hashlib.sha256(
                (CHG059_OVERRIDE_ROOT / "docs/dev-guide/TESTING.md").read_bytes()
            ).hexdigest(),
            metadata["desired_sha256"],
        )

    def test_chg065_manifest_binds_the_2026_10_01_guidance_transitions(self) -> None:
        manifest = json.loads(
            (CHG065_OVERRIDE_ROOT / "manifest.json").read_text(encoding="utf-8")
        )

        self.assertEqual(set(manifest), {"version", "paths"})
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(
            {path: entry["source_path"] for path, entry in manifest["paths"].items()},
            {
                "AGENTS.md": "overrides/CHG-049/6466f60/AGENTS.md",
                "CLAUDE.md": "overrides/CHG-053/2dee869/CLAUDE.md",
                "docs/dev-guide/DEFINITION_OF_DONE.md": (
                    "overrides/CHG-055/e240d85/docs/dev-guide/DEFINITION_OF_DONE.md"
                ),
                "docs/dev-guide/TESTING.md": (
                    "overrides/CHG-059/7f42371/docs/dev-guide/TESTING.md"
                ),
                "testing/critical-paths.md": (
                    "overrides/CHG-049/6466f60/testing/critical-paths.md"
                ),
            },
        )
        # The four files Nous delivered on 2026-10-01 are pinned byte-for-byte;
        # these digests are the "unknown state" values check mode reported.
        self.assertEqual(
            {
                path: entry["desired_sha256"]
                for path, entry in manifest["paths"].items()
                if path != "AGENTS.md"
            },
            {
                "CLAUDE.md": (
                    "ea24b7b9af19f4a050d2dce58d2095a48e0ec96369290455504c50f8f91ce40e"
                ),
                "docs/dev-guide/DEFINITION_OF_DONE.md": (
                    "a0b4aff2d0baa8dfad6557ee51d547de4f94e037729b1d9dbc3c70a225725429"
                ),
                "docs/dev-guide/TESTING.md": (
                    "61b352aa19d768b7b66a9cd596f776b14563a6c1c42366395fd0c04666eafb5c"
                ),
                "testing/critical-paths.md": (
                    "d366c785ee8f1186f0801be9d0a893ab617e66c08109a08460c5ffc105502673"
                ),
            },
        )
        for path, entry in manifest["paths"].items():
            with self.subTest(path=path):
                self.assertEqual(
                    hashlib.sha256(
                        (SCRIPT_DATA_ROOT / entry["source_path"]).read_bytes()
                    ).hexdigest(),
                    entry["source_sha256"],
                )
                self.assertEqual(
                    hashlib.sha256((CHG065_OVERRIDE_ROOT / path).read_bytes()).hexdigest(),
                    entry["desired_sha256"],
                )

    def test_chg065_agents_guidance_links_the_project_additions(self) -> None:
        agents = (CHG065_OVERRIDE_ROOT / "AGENTS.md").read_text(encoding="utf-8")

        self.assertEqual(
            agents.count("[`docs/dev-guide/local/CLAUDE.md`](docs/dev-guide/local/CLAUDE.md)"),
            1,
        )
        self.assertIn("§Session shape", agents)

    def test_chg053_source_and_desired_tamper_fail_before_writes(self) -> None:
        for artifact_kind, relative_path in (
            ("source", "CLAUDE.md"),
            ("desired", "docs/dev-guide/FRONTEND.md"),
        ):
            with self.subTest(artifact_kind=artifact_kind), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                root = base / "project"
                create_chg053_project(root)
                data_root = copy_reconciler_data(base)
                artifact = (
                    data_root / "overrides/CHG-049/6466f60" / relative_path
                    if artifact_kind == "source"
                    else data_root / "overrides/CHG-053/2dee869" / relative_path
                )
                self.assertTrue(
                    artifact.is_file(),
                    f"CHG-053 {artifact_kind} artifact is missing: {artifact}",
                )
                artifact.write_bytes(artifact.read_bytes() + b"tampered\n")
                if artifact_kind == "source":
                    prior_manifest_path = (
                        data_root / "overrides/CHG-049/6466f60/manifest.json"
                    )
                    prior_manifest = json.loads(
                        prior_manifest_path.read_text(encoding="utf-8")
                    )
                    prior_manifest["paths"][relative_path]["desired_sha256"] = (
                        hashlib.sha256(artifact.read_bytes()).hexdigest()
                    )
                    prior_manifest_path.write_text(
                        json.dumps(prior_manifest, indent=2) + "\n",
                        encoding="utf-8",
                    )
                before = snapshot(root)

                result = run_reconciler(root, data_root=data_root)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(root), before)
                self.assertIn("CHG-053", result.stderr)
                self.assertIn("hash mismatch", result.stderr)

    def test_chg053_current_imp393_mirrors_are_byte_stable_in_check_mode(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg053_project(root)
            claude_body, claude_trailer = split_terminal_emitted_trailer(
                chg053_delivered_guide("CLAUDE.md")
            )
            source_stamp = TERMINAL_EMITTED_TRAILER.search(claude_trailer)
            self.assertIsNotNone(source_stamp)
            expected_header = (
                b"<!-- agent-sync: "
                + source_stamp.group(0).split(b"sha256=")[1][:12]
                + b" | source: CLAUDE.md | DO NOT EDIT \xe2\x80\x94 this file is auto-generated "
                + b"from CLAUDE.md. Edit CLAUDE.md then run: python3 nous_agent_sync.py -->\n"
            )
            self.assertEqual(expected_header, CHG065_MIRROR_HEADER)
            for mirror in ("CODEX.md", ".cursorrules", ".github/copilot-instructions.md"):
                delivered = chg053_delivered_guide(mirror)
                mirror_body, mirror_trailer = split_terminal_emitted_trailer(delivered)
                self.assertEqual((root / mirror).read_bytes(), delivered, mirror)
                self.assertEqual(mirror_body, expected_header + claude_body, mirror)
                self.assertNotEqual(mirror_trailer, claude_trailer, mirror)

            before = snapshot(root)
            result = run_reconciler(root, "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)

    def test_chg053_preserves_distinct_valid_mirror_trailers_in_check_mode(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg053_project(root)
            claude_body, claude_trailer = split_terminal_emitted_trailer(
                chg053_delivered_guide("CLAUDE.md")
            )
            trailers = {
                "CODEX.md": b"<!-- nous-emitted: sha256=1111111111111111 -->\n",
                ".cursorrules": b"<!-- nous-emitted: sha256=2222222222222222 -->\n",
                ".github/copilot-instructions.md": (
                    b"<!-- nous-emitted: sha256=3333333333333333 -->\n"
                ),
            }
            for relative_path, trailer in trailers.items():
                (root / relative_path).write_bytes(
                    CHG065_MIRROR_HEADER + claude_body + trailer
                )

            self.assertEqual(len(set(trailers.values())), len(trailers))
            for trailer in trailers.values():
                self.assertNotEqual(trailer, claude_trailer)
            before = snapshot(root)
            result = run_reconciler(root, "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)

    def test_chg053_repairs_a_mirror_body_without_changing_its_frames(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg053_project(root)
            claude_body, _ = split_terminal_emitted_trailer(
                chg053_delivered_guide("CLAUDE.md")
            )
            mirror = root / "CODEX.md"
            trailer = b"<!-- nous-emitted: sha256=abcdef0123456789 -->\n"
            mirror.write_bytes(CHG065_MIRROR_HEADER + b"drifted mirror body\n" + trailer)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                mirror.read_bytes(),
                CHG065_MIRROR_HEADER + claude_body + trailer,
            )

    def test_chg053_invalid_mirror_frames_fail_closed_without_writes(self) -> None:
        claude_body, _ = split_terminal_emitted_trailer(
            chg053_delivered_guide("CLAUDE.md")
        )
        valid_trailer = b"<!-- nous-emitted: sha256=abcdef0123456789 -->\n"
        stale_header = CHG065_MIRROR_HEADER.replace(b"ca4a7c18b2c9", b"000000000000")
        malformed_header = b"<!-- agent-sync: malformed -->\n"
        cases = {
            "missing header": claude_body + valid_trailer,
            "duplicate header": (
                CHG065_MIRROR_HEADER + CHG065_MIRROR_HEADER + claude_body + valid_trailer
            ),
            "stale header": stale_header + claude_body + valid_trailer,
            "misplaced header": claude_body + CHG065_MIRROR_HEADER + valid_trailer,
            "malformed header": malformed_header + claude_body + valid_trailer,
            "missing trailer": CHG065_MIRROR_HEADER + claude_body,
            "duplicate trailer": (
                CHG065_MIRROR_HEADER + claude_body + valid_trailer + valid_trailer
            ),
            "misplaced trailer": (
                CHG065_MIRROR_HEADER + valid_trailer + claude_body
            ),
            "malformed trailer": (
                CHG065_MIRROR_HEADER
                + claude_body
                + b"<!-- nous-emitted: sha256=not-hexadecimal -->\n"
            ),
        }
        for variant, content in cases.items():
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg053_project(root)
                (root / "CODEX.md").write_bytes(content)
                before = snapshot(root)

                result = run_reconciler(root)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("CODEX.md", result.stderr)
                self.assertEqual(snapshot(root), before)

    def test_chg053_collective_header_removal_fails_closed_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg053_project(root)
            for relative_path in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                body_and_header, trailer = split_terminal_emitted_trailer(
                    (root / relative_path).read_bytes()
                )
                self.assertTrue(body_and_header.startswith(CHG065_MIRROR_HEADER))
                (root / relative_path).write_bytes(
                    body_and_header[len(CHG065_MIRROR_HEADER) :] + trailer
                )
            before = snapshot(root)

            result = run_reconciler(root, "--check")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("CODEX.md", result.stderr)
            self.assertEqual(snapshot(root), before)

    def test_chg053_allows_the_two_delivered_negative_tenant_id_phrases(self) -> None:
        delivered = chg053_delivered_guide("CLAUDE.md")
        self.assertIn(b"there is no `tenant_id`", delivered)
        self.assertIn(b"do NOT invent `tenant_id`", delivered)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg053_project(root)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)

    def test_chg053_rejects_active_and_unrecognized_tenant_id_guidance(self) -> None:
        cases = {
            "active": "Use tenant_id for every multi-tenant query.\n",
            "backticked active": "Use `tenant_id` for every multi-tenant query.\n",
            "unrecognized negation": "Never use `tenant_id` for tenant scope.\n",
            "mixed": (
                "there is no `tenant_id`; use tenant_id for every multi-tenant query.\n"
            ),
            "mixed chg065 negation": (
                "the generated tenant column — not `tenant_id`; "
                "use tenant_id for every multi-tenant query.\n"
            ),
            "bare chg065 negation": "Filter on it, not `tenant_id`.\n",
        }
        for variant, guidance in cases.items():
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_chg053_project(root)
                write(root, "docs/dev-guide/EXTRA.md", guidance)
                before = snapshot(root)

                result = run_reconciler(root)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("tenant_id", result.stderr)
                self.assertEqual(snapshot(root), before)

    def test_chg053_unknown_post_layer_hash_fails_closed_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_chg053_project(root)
            claude = root / "CLAUDE.md"
            claude.write_bytes(claude.read_bytes() + b"unreviewed post-CHG-053 state\n")
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("CLAUDE.md: unknown generated guidance state", result.stderr)

    def test_distinct_valid_mirror_trailers_are_byte_stable_in_check_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            claude_body = latest_claude_body()
            trailers = {
                "CODEX.md": b"<!-- nous-emitted: sha256=1111111111111111 -->\n",
                ".cursorrules": b"<!-- nous-emitted: sha256=2222222222222222 -->\n",
                ".github/copilot-instructions.md": (
                    b"<!-- nous-emitted: sha256=3333333333333333 -->\n"
                ),
            }
            for relative_path, trailer in trailers.items():
                (root / relative_path).write_bytes(
                    CHG065_MIRROR_HEADER + claude_body + trailer
                )
            write(
                root,
                "docs/dev-guide/PACKAGE_MAP.md",
                f"{EXPECTED_PACKAGE_ENTITY}\n{EXPECTED_PACKAGE_SCOPE}\n",
            )
            before = snapshot(root)

            result = run_reconciler(root, "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(snapshot(root), before)

    def test_mirror_body_is_repaired_while_its_trailer_remains_byte_exact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            claude_body = latest_claude_body()
            mirror = root / "CODEX.md"
            trailer = b"<!-- nous-emitted: sha256=abcdef0123456789 -->\n"
            mirror.write_bytes(
                CHG065_MIRROR_HEADER + b"drifted mirror body\n" + trailer
            )

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                mirror.read_bytes(), CHG065_MIRROR_HEADER + claude_body + trailer
            )

    def test_invalid_mirror_trailers_fail_closed_without_writes(self) -> None:
        claude_body = latest_claude_body()
        valid = b"<!-- nous-emitted: sha256=abcdef0123456789 -->\n"
        cases = {
            "missing": claude_body,
            "duplicate": claude_body + valid + valid,
            "non-terminal": valid + claude_body,
            "malformed": (
                claude_body + b"<!-- nous-emitted: sha256=not-hexadecimal -->\n"
            ),
        }
        for variant, content in cases.items():
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                create_project(root)
                mirror = root / "CODEX.md"
                mirror.write_bytes(content)
                before = snapshot(root)

                result = run_reconciler(root)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("CODEX.md", result.stderr)
                self.assertEqual(snapshot(root), before)

    def test_stale_chg001_mirrors_are_relayered_onto_claude(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            # CHG-024 governs these mirrors, which CHG-022's closed allowed_paths
            # could not touch. A mirror left on the CHG-001 baseline is drift and
            # must have its body relayered while retaining valid provenance.
            _, trailer = split_terminal_emitted_trailer(
                latest_desired_guide("CLAUDE.md")
            )
            for mirror in ("CODEX.md", ".cursorrules", ".github/copilot-instructions.md"):
                (root / mirror).write_bytes(
                    CHG065_MIRROR_HEADER + desired_guide("CLAUDE.md") + trailer
                )

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            claude_body, _ = split_terminal_emitted_trailer(
                (root / "CLAUDE.md").read_bytes()
            )
            for mirror in ("CODEX.md", ".cursorrules", ".github/copilot-instructions.md"):
                self.assertEqual(
                    (root / mirror).read_bytes(),
                    CHG065_MIRROR_HEADER + claude_body + trailer,
                    mirror,
                )

    def test_mirrors_equal_the_layered_claude_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            claude = (root / "CLAUDE.md").read_bytes()
            self.assertIn(b"## Work Readiness Gate", claude)
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual(
                    (root / mirror).read_bytes(),
                    CHG065_MIRROR_HEADER + claude,
                    mirror,
                )

    def test_check_reports_a_mirror_that_drifts_from_layered_claude(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            self.assertEqual(run_reconciler(root).returncode, 0)
            (root / "CODEX.md").write_bytes(desired_guide("CLAUDE.md"))

            result = run_reconciler(root, "--check")

            self.assertNotEqual(result.returncode, 0)

    def test_chg022_guidance_contains_readiness_command_and_two_hour_rule(self) -> None:
        for relative_path in READINESS_GUIDES:
            text = (READINESS_OVERRIDE_ROOT / relative_path).read_text(encoding="utf-8")
            self.assertIn("pnpm readiness:check -- <WORK-ID>", text, relative_path)
            self.assertIn("above 120 minutes", text, relative_path)
            self.assertIn("docs/dev-guide/WORK_READINESS.md", text, relative_path)

        definition = (
            READINESS_OVERRIDE_ROOT / "docs/dev-guide/DEFINITION_OF_DONE.md"
        ).read_text(encoding="utf-8")
        self.assertIn("pnpm readiness:check:all", definition)
        self.assertIn("pnpm readiness:check:range", definition)
        self.assertIn("completion actuals", definition)
        self.assertIn("estimate variance", definition)

    def test_chg042_layer_binds_reviewed_sources_and_320_minute_guidance(self) -> None:
        manifest = json.loads(
            (REPINNED_OVERRIDE_ROOT / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(
            set(manifest["paths"]),
            {
                "AGENTS.md",
                "CLAUDE.md",
                "docs/dev-guide/DEFINITION_OF_DONE.md",
                "docs/stories/CHANGES.md",
                "testing/critical-paths.md",
            },
        )
        for relative_path, metadata in manifest["paths"].items():
            source = SCRIPT_DATA_ROOT / metadata["source_path"]
            desired = REPINNED_OVERRIDE_ROOT / relative_path
            self.assertEqual(
                hashlib.sha256(source.read_bytes()).hexdigest(),
                metadata["source_sha256"],
                relative_path,
            )
            self.assertEqual(
                hashlib.sha256(desired.read_bytes()).hexdigest(),
                metadata["desired_sha256"],
                relative_path,
            )
        for relative_path in READINESS_GUIDES:
            self.assertIn(
                "above 320 minutes",
                (REPINNED_OVERRIDE_ROOT / relative_path).read_text(encoding="utf-8"),
                relative_path,
            )

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
            changes_path = root / "docs/stories/CHANGES.md"
            generated_changes = changes_path.read_text(encoding="utf-8")
            changes_path.write_text(
                generated_changes.replace(
                    "| **US-007** | Seed: companies CSV + go-live register "
                    "backfill | Sprint 1 | 🔨 in_development |",
                    "| **US-007** | Seed: companies CSV + go-live register "
                    "backfill | Sprint 1 | ✅ dev_done |",
                ),
                encoding="utf-8",
            )

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            for relative_path in PINNED_GUIDES:
                if relative_path == "docs/stories/CHANGES.md":
                    continue
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    latest_desired_guide(relative_path),
                    relative_path,
                )
            changes = (root / "docs/stories/CHANGES.md").read_text(encoding="utf-8")
            self.assertIn(
                "| **US-007** | Seed: companies CSV + go-live register backfill "
                "| Sprint 1 | ✅ dev_done |",
                changes,
            )
            self.assertIn(
                "**Notes:** # CHG-001 — Reconcile Sprint 1 execution contract",
                changes,
            )
            self.assertIn("## Required changes", changes)
            critical_paths = (
                root / "testing/critical-paths.md"
            ).read_text(encoding="utf-8")
            self.assertIn("filtered by `company_id`", critical_paths)
            self.assertNotIn("filtered by `org_id`", critical_paths)
            claude = latest_desired_guide("CLAUDE.md")
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual(
                    (root / mirror).read_bytes(), CHG065_MIRROR_HEADER + claude
                )

    def test_desired_hash_is_noop_and_claude_drives_mirrors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            claude = latest_desired_guide("CLAUDE.md")
            for relative_path in PINNED_GUIDES:
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    latest_desired_guide(relative_path),
                    relative_path,
                )
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual(
                    (root / mirror).read_bytes(), CHG065_MIRROR_HEADER + claude
                )
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

    def test_unknown_claude_hash_reports_reconciliation_error_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            claude = root / "CLAUDE.md"
            claude.write_bytes(claude.read_bytes() + b"unknown future sync\n")
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("CLAUDE.md: unknown generated guidance state", result.stderr)
            self.assertIn("review and pin a new migration", result.stderr)
            self.assertNotIn("Traceback", result.stderr)

    def test_unknown_reviewed_section_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            changes = root / "docs/stories/CHANGES.md"
            changes.write_text(
                changes.read_text(encoding="utf-8").replace(
                    "Sprint 1 readiness review found generator-owned guidance "
                    "that contradicts the\n"
                    "authoritative ER model and architecture.",
                    "**Notes:** unreviewed but superficially harmless guidance",
                ),
                encoding="utf-8",
            )
            before = snapshot(root)

            result = run_reconciler(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/stories/CHANGES.md", result.stderr)
            self.assertIn("reviewed section markers changed", result.stderr)
            self.assertIn("review and pin a new migration", result.stderr)

    def test_later_generated_change_markers_do_not_drift_reviewed_section(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            changes = root / "docs/stories/CHANGES.md"
            changes.write_text(
                changes.read_text(encoding="utf-8")
                + "\n### CHG-002: Later generated change\n\n"
                + "**Status:** 🟡 `proposed`\n"
                + "**Notes:**\n"
                + "> Independent generated change notes.\n",
                encoding="utf-8",
            )
            before = changes.read_bytes()

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(changes.read_bytes(), before)

    def test_chg005_pins_canonical_sprint2_story_corrections(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_project(root)
            us014_path = "docs/stories/sprint-2/r1_misc_us_014.md"
            us017_path = "docs/stories/sprint-2/r1_misc_us_017.md"
            us045_path = "docs/stories/sprint-2/r1_misc_us_045.md"
            desired014 = (STORY_OVERRIDE_ROOT / us014_path).read_text(encoding="utf-8")
            desired017 = (STORY_OVERRIDE_ROOT / us017_path).read_text(encoding="utf-8")
            desired045 = (STORY_OVERRIDE_ROOT / us045_path).read_text(encoding="utf-8")
            source014 = desired014.replace(
                "| `blocked_no_seat` | `rejected` | Authorized owner cancels the blocked request |\n",
                "",
            ).replace(
                "| `offboarding` | `failed` | Connector or checklist removal fails |\n",
                "",
            )
            source017 = desired017.replace(
                "- AC1 is reconciled by CHG-005 with the actual SMTP/outbox crash semantics; edit the canonical source and regenerate.",
                "- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.",
            )
            source045 = desired045.replace(
                "- ACs are reconciled by CHG-005 with the fixed Sprint 2 execution plan; edit the canonical source and regenerate.",
                "- ACs are copied verbatim from `08_scope.md` (generated 10b pass, 2026-07-22) — the scope is the single source; edit there and regenerate.",
            )
            manifest = json.loads(
                (STORY_OVERRIDE_ROOT / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                hashlib.sha256(source014.encode()).hexdigest(),
                manifest["paths"][us014_path]["source_sha256"],
            )
            self.assertEqual(
                hashlib.sha256(source045.encode()).hexdigest(),
                manifest["paths"][us045_path]["source_sha256"],
            )
            self.assertEqual(
                hashlib.sha256(source017.encode()).hexdigest(),
                manifest["paths"][us017_path]["source_sha256"],
            )
            write(root, us014_path, source014)
            write(root, us017_path, source017)
            write(root, us045_path, source045)

            result = run_reconciler(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / us014_path).read_text(encoding="utf-8"), desired014)
            self.assertEqual((root / us017_path).read_text(encoding="utf-8"), desired017)
            self.assertEqual((root / us045_path).read_text(encoding="utf-8"), desired045)
            self.assertEqual(run_reconciler(root, "--check").returncode, 0)

    def test_manifest_artifact_hash_mismatch_fails_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            create_project(root)
            data_root = copy_reconciler_data(Path(directory))
            desired = (
                data_root
                / "overrides/CHG-049/6466f60/docs/dev-guide/SECURITY.md"
            )
            desired.write_bytes(desired.read_bytes() + b"tampered\n")
            before = snapshot(root)

            result = run_reconciler(root, data_root=data_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("docs/dev-guide/SECURITY.md", result.stderr)
            self.assertIn("desired artifact hash mismatch", result.stderr)

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

    def test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes(
        self,
    ) -> None:
        cases = (
            ("CHG-004", "output", "/tmp/escape.md"),
            ("CHG-004", "output", "../escape.md"),
            ("CHG-004", "output", "CLAUDE.md"),
            ("CHG-004", "source", "/tmp/source.md"),
            ("CHG-004", "source", "../source.md"),
            (
                "CHG-004",
                "source",
                "overrides/CHG-001/825e882/CLAUDE.md",
            ),
            ("CHG-004", "source_sha256", "A" * 64),
            ("CHG-004", "desired_sha256", "not-a-sha256"),
            ("CHG-005", "output", "/tmp/escape.md"),
            ("CHG-005", "output", "../escape.md"),
            ("CHG-005", "output", "docs/stories/sprint-2/other.md"),
            ("CHG-005", "source_sha256", "A" * 64),
            ("CHG-005", "desired_sha256", "not-a-sha256"),
        )
        for change, field, malicious in cases:
            with (
                self.subTest(change=change, field=field, malicious=malicious),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory) / "project"
                create_project(root)
                data_root = copy_reconciler_data(Path(directory))
                if change == "CHG-004":
                    manifest_path = (
                        data_root / "overrides/CHG-004/e4b9a06/manifest.json"
                    )
                else:
                    manifest_path = (
                        data_root / "overrides/CHG-005/277b64e/manifest.json"
                    )
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                relative_path = next(iter(manifest["paths"]))
                if field == "output":
                    metadata = manifest["paths"].pop(relative_path)
                    manifest["paths"][malicious] = metadata
                elif field == "source":
                    manifest["paths"][relative_path]["source_path"] = malicious
                else:
                    manifest["paths"][relative_path][field] = malicious
                manifest_path.write_text(
                    json.dumps(manifest, indent=2) + "\n",
                    encoding="utf-8",
                )
                before = snapshot(root)

                result = run_reconciler(root, data_root=data_root)

                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(root), before)
                self.assertIn(change, result.stderr)
                self.assertRegex(
                    result.stderr,
                    r"invalid|path set",
                )

    def test_manifest_source_symlink_cannot_escape_data_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "project"
            create_project(root)
            data_root = copy_reconciler_data(base)
            source = (
                data_root
                / "overrides/CHG-001/825e882/docs/stories/CHANGES.md"
            )
            external = base / "outside-source.md"
            external.write_bytes(source.read_bytes())
            source.unlink()
            source.symlink_to(external)
            before = snapshot(root)

            result = run_reconciler(root, data_root=data_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("path escapes its manifest root", result.stderr)

    def test_manifest_output_symlink_cannot_escape_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "project"
            create_project(root)
            data_root = copy_reconciler_data(base)
            sprint_stories = root / "docs/stories/sprint-2"
            external = base / "outside-project"
            external.mkdir()
            sprint_stories.symlink_to(external, target_is_directory=True)
            before = snapshot(root)

            result = run_reconciler(root, data_root=data_root)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(snapshot(root), before)
            self.assertIn("path escapes its manifest root", result.stderr)

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
            write(
                root,
                "docs/dev-guide/PACKAGE_MAP.md",
                f"{EXPECTED_PACKAGE_ENTITY}\n{EXPECTED_PACKAGE_SCOPE}\n",
            )
            mirror = root / "CODEX.md"
            _, trailer = split_terminal_emitted_trailer(mirror.read_bytes())
            mirror.write_bytes(
                CHG065_MIRROR_HEADER + b"drifted mirror body\n" + trailer
            )
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
                if relative_path == "docs/stories/CHANGES.md":
                    continue
                self.assertEqual(
                    (root / relative_path).read_bytes(),
                    latest_desired_guide(relative_path),
                    relative_path,
                )
            changes = (root / "docs/stories/CHANGES.md").read_text(encoding="utf-8")
            self.assertIn(
                "**Notes:** # CHG-001 — Reconcile Sprint 1 execution contract",
                changes,
            )
            self.assertIn(
                "| **US-007** | Seed: companies CSV + go-live register backfill "
                "| Sprint 1 | 🔨 in_development |",
                changes,
            )
            claude = latest_desired_guide("CLAUDE.md")
            for mirror in (
                "CODEX.md",
                ".cursorrules",
                ".github/copilot-instructions.md",
            ):
                self.assertEqual(
                    (root / mirror).read_bytes(), CHG065_MIRROR_HEADER + claude
                )


if __name__ == "__main__":
    unittest.main()
