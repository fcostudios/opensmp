from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import uuid
from collections.abc import Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import (
    parse_qsl,
    quote,
    unquote,
    urlencode,
    urlsplit,
    urlunsplit,
)


PROJECT_ROOT = Path(__file__).parents[3]
DATABASE_PREFIX = "nous_ledger_sync_test_"


class IntegrationConfigurationError(RuntimeError):
    """Raised when the explicitly gated real-Nous test is not configured."""


@dataclass(frozen=True)
class IntegrationConfig:
    nous_system: Path
    source_database_url: str
    pg_dump: str
    pg_restore: str
    command_timeout_seconds: float
    connect_timeout_seconds: int


@dataclass(frozen=True)
class PostgresCliCredentials:
    database_urls: tuple[str, ...]
    environment: dict[str, str]
    credential_path: Path


def positive_number(environment: Mapping[str, str], name: str, default: str) -> float:
    raw = environment.get(name, default)
    try:
        value = float(raw)
    except ValueError as error:
        raise IntegrationConfigurationError(f"{name} must be numeric") from error
    if value <= 0:
        raise IntegrationConfigurationError(f"{name} must be positive")
    return value


def load_integration_config(environment: Mapping[str, str]) -> IntegrationConfig:
    missing = [
        name
        for name in ("NOUS_SYSTEM", "NOUS_DB_URL")
        if not environment.get(name)
    ]
    if missing:
        raise IntegrationConfigurationError(
            "NOUS_SYSTEM and NOUS_DB_URL are required for the explicit "
            "real-Nous integration test"
        )

    nous_system = Path(environment["NOUS_SYSTEM"]).resolve()
    if not (nous_system / "nous_package.py").is_file():
        raise IntegrationConfigurationError(
            f"NOUS_SYSTEM does not contain nous_package.py: {nous_system}"
        )

    source_database_url = environment["NOUS_DB_URL"]
    if not source_database_url.startswith(("postgres://", "postgresql://")):
        raise IntegrationConfigurationError(
            "NOUS_DB_URL must identify explicit PostgreSQL test source state"
        )

    command_timeout = positive_number(
        environment,
        "NOUS_INTEGRATION_COMMAND_TIMEOUT_SECONDS",
        "120",
    )
    connect_timeout = positive_number(
        environment,
        "NOUS_INTEGRATION_CONNECT_TIMEOUT_SECONDS",
        "10",
    )
    if not connect_timeout.is_integer():
        raise IntegrationConfigurationError(
            "NOUS_INTEGRATION_CONNECT_TIMEOUT_SECONDS must be a whole number"
        )

    return IntegrationConfig(
        nous_system=nous_system,
        source_database_url=source_database_url,
        pg_dump=environment.get("PG_DUMP", "pg_dump"),
        pg_restore=environment.get("PG_RESTORE", "pg_restore"),
        command_timeout_seconds=command_timeout,
        connect_timeout_seconds=int(connect_timeout),
    )


def database_url_with_name(
    source_url: str,
    database_name: str,
    *,
    connect_timeout_seconds: int,
) -> str:
    parsed = urlsplit(source_url)
    query = [
        (name, value)
        for name, value in parse_qsl(parsed.query, keep_blank_values=True)
        if name != "connect_timeout"
    ]
    query.append(("connect_timeout", str(connect_timeout_seconds)))
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            f"/{database_name}",
            urlencode(query),
            parsed.fragment,
        )
    )


def run_bounded(
    command: Sequence[str],
    *,
    timeout_seconds: float,
    **kwargs: Any,
) -> subprocess.CompletedProcess:
    return subprocess.run(command, timeout=timeout_seconds, **kwargs)


def pgpass_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")


def sanitized_postgres_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    username = unquote(parsed.username or "")
    host = parsed.hostname or ""
    if not username or not host:
        raise IntegrationConfigurationError(
            "PostgreSQL CLI URLs require an explicit username and host"
        )
    display_host = f"[{host}]" if ":" in host else host
    if parsed.port:
        display_host = f"{display_host}:{parsed.port}"
    netloc = f"{quote(username, safe='')}@{display_host}"
    sensitive_options = {"password", "passfile", "servicefile", "sslpassword"}
    query = [
        (name, value)
        for name, value in parse_qsl(parsed.query, keep_blank_values=True)
        if name.lower() not in sensitive_options
    ]
    return urlunsplit(
        (
            parsed.scheme,
            netloc,
            parsed.path,
            urlencode(query),
            parsed.fragment,
        )
    )


@contextmanager
def postgres_cli_credentials(
    database_urls: Sequence[str],
    *,
    directory: Path | None = None,
):
    entries: list[str] = []
    sanitized_urls: list[str] = []
    for database_url in database_urls:
        parsed = urlsplit(database_url)
        host = parsed.hostname or ""
        username = unquote(parsed.username or "")
        password = unquote(parsed.password or "")
        database = unquote(parsed.path.lstrip("/"))
        if not host or not username or not database:
            raise IntegrationConfigurationError(
                "PostgreSQL CLI URLs require host, username, and database"
            )
        entries.append(
            ":".join(
                pgpass_escape(value)
                for value in (
                    host,
                    str(parsed.port or 5432),
                    database,
                    username,
                    password,
                )
            )
        )
        sanitized_urls.append(sanitized_postgres_url(database_url))

    descriptor, credential_name = tempfile.mkstemp(
        prefix=".ledger-pgpass-",
        dir=directory,
    )
    credential_path = Path(credential_name)
    try:
        os.fchmod(descriptor, 0o600)
        credential_file = os.fdopen(descriptor, "w", encoding="utf-8")
        descriptor = -1
        with credential_file:
            credential_file.write("\n".join(entries) + "\n")
            credential_file.flush()
            os.fsync(credential_file.fileno())
        yield PostgresCliCredentials(
            database_urls=tuple(sanitized_urls),
            environment={"PGPASSFILE": str(credential_path)},
            credential_path=credential_path,
        )
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        credential_path.unlink(missing_ok=True)


def set_statement_timeout(
    connection: Any,
    timeout_seconds: float,
) -> None:
    milliseconds = max(1, int(timeout_seconds * 1000))
    connection.execute(
        "SELECT set_config('statement_timeout', %s, false)",
        (str(milliseconds),),
    )


@contextmanager
def isolated_nous_database(config: IntegrationConfig):
    import psycopg
    from psycopg import sql

    source_name = urlsplit(config.source_database_url).path.lstrip("/")
    if not source_name:
        raise IntegrationConfigurationError("NOUS_DB_URL must include a database name")

    database_name = f"{DATABASE_PREFIX}{uuid.uuid4().hex}"
    if not re.fullmatch(r"nous_ledger_sync_test_[0-9a-f]{32}", database_name):
        raise AssertionError("refusing to create an invalid isolated database name")

    source_url = database_url_with_name(
        config.source_database_url,
        source_name,
        connect_timeout_seconds=config.connect_timeout_seconds,
    )
    isolated_url = database_url_with_name(
        config.source_database_url,
        database_name,
        connect_timeout_seconds=config.connect_timeout_seconds,
    )

    created = False
    with psycopg.connect(
        source_url,
        autocommit=True,
        connect_timeout=config.connect_timeout_seconds,
    ) as admin:
        set_statement_timeout(admin, config.command_timeout_seconds)
        admin.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )
        created = True

    try:
        with (
            tempfile.NamedTemporaryFile(suffix=".dump") as dump,
            postgres_cli_credentials((source_url, isolated_url)) as cli_auth,
        ):
            cli_environment = os.environ.copy()
            cli_environment.update(cli_auth.environment)
            cli_environment["PGCONNECTTIMEOUT"] = str(
                config.connect_timeout_seconds
            )
            run_bounded(
                [
                    config.pg_dump,
                    "--format=custom",
                    "--no-owner",
                    "--no-privileges",
                    "--file",
                    dump.name,
                    cli_auth.database_urls[0],
                ],
                timeout_seconds=config.command_timeout_seconds,
                env=cli_environment,
                check=True,
                capture_output=True,
            )
            run_bounded(
                [
                    config.pg_restore,
                    "--exit-on-error",
                    "--no-owner",
                    "--no-privileges",
                    "--dbname",
                    cli_auth.database_urls[1],
                    dump.name,
                ],
                timeout_seconds=config.command_timeout_seconds,
                env=cli_environment,
                check=True,
                capture_output=True,
            )
        yield isolated_url
    finally:
        if created:
            if not re.fullmatch(
                r"nous_ledger_sync_test_[0-9a-f]{32}",
                database_name,
            ):
                raise AssertionError(
                    "refusing to clean up a non-isolated database name"
                )
            with psycopg.connect(
                source_url,
                autocommit=True,
                connect_timeout=config.connect_timeout_seconds,
            ) as admin:
                set_statement_timeout(admin, config.command_timeout_seconds)
                admin.execute(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = %s AND pid <> pg_backend_pid()",
                    (database_name,),
                )
                admin.execute(
                    sql.SQL("DROP DATABASE {}").format(
                        sql.Identifier(database_name)
                    )
                )


def canonical_database_snapshot(
    database_url: str,
    config: IntegrationConfig,
) -> str:
    import psycopg
    from psycopg import sql

    digest = hashlib.sha256()
    with psycopg.connect(
        database_url,
        connect_timeout=config.connect_timeout_seconds,
    ) as connection:
        set_statement_timeout(connection, config.command_timeout_seconds)
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
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_integration_config(os.environ)

    def run_sync(
        self,
        fixture: Path,
        database_url: str,
        *arguments: str,
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["NOUS_SYSTEM"] = str(self.config.nous_system)
        environment["NOUS_DB_URL"] = database_url
        return run_bounded(
            [
                "bash",
                str(fixture / "infra/scripts/sync-from-nous.sh"),
                *arguments,
            ],
            timeout_seconds=self.config.command_timeout_seconds,
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
            isolated_nous_database(self.config) as database_url,
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
            state_before = canonical_database_snapshot(
                database_url,
                self.config,
            )

            result = self.run_sync(
                fixture,
                database_url,
                "--dry-run",
                "--no-drift",
                "-c",
                "sprint_plan",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(canonical_filesystem_snapshot(fixture), files_before)
            self.assertEqual(
                canonical_database_snapshot(database_url, self.config),
                state_before,
            )
            self.assertIn("Step 1/2 — Pulling agent feedback", result.stdout)
            self.assertIn("Ledger invariant preview", result.stdout)
            self.assertIn("+- **Tenant isolation**", result.stdout)

    def test_selective_sync_still_enforces_repository_wide_invariants(
        self,
    ) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            isolated_nous_database(self.config) as database_url,
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
                database_url,
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
