from __future__ import annotations

import os
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
STALE_DEFINITION_OF_DONE = textwrap.dedent(
    """\
    5. **Schema applies on a fresh database (and is verified):**
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
         `ledger_app` connection; application runtime must not use the owner role."""
)
EXPECTED_DEFINITION_OF_DONE = textwrap.dedent(
    """\
    5. **Committed migrations apply on a fresh database (and parity is verified):**
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
         `ledger_app` connection; application runtime must not use the owner role."""
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
        "docs/dev-guide/DEFINITION_OF_DONE.md",
        STALE_DEFINITION_OF_DONE + "\n",
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
            definition_of_done = (
                root / "docs/dev-guide/DEFINITION_OF_DONE.md"
            ).read_text(encoding="utf-8")
            self.assertEqual(
                definition_of_done,
                EXPECTED_DEFINITION_OF_DONE + "\n",
            )

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


if __name__ == "__main__":
    unittest.main()
