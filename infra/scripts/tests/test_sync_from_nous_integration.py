from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql


PROJECT_ROOT = Path(__file__).parents[3]
NOUS_SYSTEM = Path(
    os.environ.get(
        "NOUS_SYSTEM",
        "/Users/fcolomas/Projects/nous/Nous/System",
    )
)


def resolve_source_database_url() -> str:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys;"
                f"sys.path.insert(0, {str(NOUS_SYSTEM)!r});"
                "from nous_connect import resolve_db_url;"
                "print(resolve_db_url())"
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def database_url_with_name(source_url: str, database_name: str) -> str:
    parsed = urlsplit(source_url)
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            f"/{database_name}",
            parsed.query,
            parsed.fragment,
        )
    )


@contextmanager
def isolated_nous_database():
    source_url = resolve_source_database_url()
    if not source_url.startswith(("postgres://", "postgresql://")):
        raise AssertionError("real Nous integration requires its PostgreSQL state")

    database_name = f"nous_ledger_sync_test_{uuid.uuid4().hex}"
    isolated_url = database_url_with_name(source_url, database_name)

    with psycopg.connect(source_url, autocommit=True) as admin:
        source_database = admin.execute("SELECT current_database()").fetchone()[0]
        admin.execute(
            sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(
                sql.Identifier(database_name),
                sql.Identifier(source_database),
            )
        )

    try:
        yield isolated_url
    finally:
        with psycopg.connect(source_url, autocommit=True) as admin:
            admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (database_name,),
            )
            admin.execute(
                sql.SQL("DROP DATABASE {}").format(sql.Identifier(database_name))
            )


def canonical_database_snapshot(database_url: str) -> str:
    digest = hashlib.sha256()
    with psycopg.connect(database_url) as connection:
        schema_rows = connection.execute(
            """
            SELECT table_name, column_name, ordinal_position, data_type,
                   is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
            """
        ).fetchall()
        for row in schema_rows:
            digest.update(repr(tuple(row)).encode("utf-8"))
            digest.update(b"\n")

        table_rows = connection.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """
        ).fetchall()
        for (table_name,) in table_rows:
            digest.update(f"table:{table_name}\n".encode("utf-8"))
            rows = connection.execute(
                sql.SQL("SELECT row_to_json(row_data)::text FROM {} row_data").format(
                    sql.Identifier(table_name)
                )
            ).fetchall()
            for (serialized,) in sorted(rows):
                digest.update(serialized.encode("utf-8"))
                digest.update(b"\n")

        sequence_rows = connection.execute(
            """
            SELECT sequencename, start_value, min_value, max_value,
                   increment_by, cycle, cache_size, last_value
            FROM pg_sequences
            WHERE schemaname = 'public'
            ORDER BY sequencename
            """
        ).fetchall()
        for row in sequence_rows:
            digest.update(repr(tuple(row)).encode("utf-8"))
            digest.update(b"\n")
    return digest.hexdigest()


def copy_ledger_fixture(destination: Path) -> None:
    ignored = shutil.ignore_patterns(
        ".git",
        ".turbo",
        "node_modules",
        "dist",
        "*.tsbuildinfo",
        "__pycache__",
        "*.pyc",
    )
    shutil.copytree(PROJECT_ROOT, destination, dirs_exist_ok=True, ignore=ignored)


def canonical_filesystem_snapshot(root: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        candidate for candidate in root.rglob("*") if candidate.is_file()
    )
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


class RealNousSyncIntegrationTests(unittest.TestCase):
    def run_sync(
        self,
        fixture: Path,
        database_url: str,
        *arguments: str,
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["NOUS_SYSTEM"] = str(NOUS_SYSTEM)
        environment["NOUS_DB_URL"] = database_url
        return subprocess.run(
            [
                "bash",
                str(fixture / "infra/scripts/sync-from-nous.sh"),
                *arguments,
            ],
            cwd=fixture,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_dry_run_changes_neither_ledger_fixture_nor_isolated_nous_state(
        self,
    ) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            isolated_nous_database() as db_url,
        ):
            fixture = Path(directory) / "ledger"
            copy_ledger_fixture(fixture)
            testing_path = fixture / "docs/dev-guide/TESTING.md"
            testing_path.write_text(
                testing_path.read_text(encoding="utf-8").replace(
                    "filtered by `company_id`",
                    "filtered by `org_id`",
                ),
                encoding="utf-8",
            )
            files_before = canonical_filesystem_snapshot(fixture)
            state_before = canonical_database_snapshot(db_url)

            result = self.run_sync(
                fixture,
                db_url,
                "--dry-run",
                "--no-pull",
                "--no-drift",
                "-c",
                "sprint_plan",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(canonical_filesystem_snapshot(fixture), files_before)
            self.assertEqual(canonical_database_snapshot(db_url), state_before)
            self.assertIn("Ledger invariant preview", result.stdout)
            self.assertIn(
                "+- **Tenant isolation**",
                result.stdout,
            )

    def test_selective_sync_still_enforces_repository_wide_invariants(
        self,
    ) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            isolated_nous_database() as db_url,
        ):
            fixture = Path(directory) / "ledger"
            copy_ledger_fixture(fixture)
            testing_path = fixture / "docs/dev-guide/TESTING.md"
            testing_path.write_text(
                testing_path.read_text(encoding="utf-8").replace(
                    "filtered by `company_id`",
                    "filtered by `org_id`",
                ),
                encoding="utf-8",
            )

            result = self.run_sync(
                fixture,
                db_url,
                "--no-pull",
                "--no-drift",
                "-c",
                "sprint_plan",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("repository-wide", result.stdout)
            self.assertIn(
                "filtered by `company_id`",
                testing_path.read_text(encoding="utf-8"),
            )
            claude = (fixture / "CLAUDE.md").read_bytes()
            self.assertEqual((fixture / "CODEX.md").read_bytes(), claude)
            self.assertEqual((fixture / ".cursorrules").read_bytes(), claude)
            self.assertEqual(
                (fixture / ".github/copilot-instructions.md").read_bytes(),
                claude,
            )


if __name__ == "__main__":
    unittest.main()
