from __future__ import annotations

import inspect
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from infra.scripts.tests import test_sync_from_nous_integration as integration


class IntegrationConfigurationTests(unittest.TestCase):
    def test_configuration_requires_explicit_nous_system_and_database_url(
        self,
    ) -> None:
        loader = getattr(integration, "load_integration_config", None)
        self.assertIsNotNone(loader, "explicit integration config loader is required")

        with self.assertRaisesRegex(
            integration.IntegrationConfigurationError,
            "NOUS_SYSTEM.*NOUS_DB_URL",
        ):
            loader({})

    def test_configuration_uses_only_explicit_paths_and_timeouts(self) -> None:
        loader = getattr(integration, "load_integration_config", None)
        self.assertIsNotNone(loader, "explicit integration config loader is required")

        with tempfile.TemporaryDirectory() as directory:
            nous_system = Path(directory)
            (nous_system / "nous_package.py").touch()
            config = loader(
                {
                    "NOUS_SYSTEM": str(nous_system),
                    "NOUS_DB_URL": "postgresql://tester@localhost/nous",
                    "PG_DUMP": "/tools/pg_dump",
                    "PG_RESTORE": "/tools/pg_restore",
                    "NOUS_INTEGRATION_COMMAND_TIMEOUT_SECONDS": "41",
                    "NOUS_INTEGRATION_CONNECT_TIMEOUT_SECONDS": "7",
                }
            )

        self.assertEqual(config.nous_system, nous_system.resolve())
        self.assertEqual(
            config.source_database_url,
            "postgresql://tester@localhost/nous",
        )
        self.assertEqual(config.pg_dump, "/tools/pg_dump")
        self.assertEqual(config.pg_restore, "/tools/pg_restore")
        self.assertEqual(config.command_timeout_seconds, 41)
        self.assertEqual(config.connect_timeout_seconds, 7)

    def test_database_urls_preserve_options_and_enforce_connect_timeout(
        self,
    ) -> None:
        self.assertIn(
            "connect_timeout_seconds",
            inspect.signature(integration.database_url_with_name).parameters,
        )
        result = integration.database_url_with_name(
            "postgresql://tester@localhost/nous?sslmode=disable",
            "isolated",
            connect_timeout_seconds=9,
        )

        parsed = urlsplit(result)
        self.assertEqual(parsed.path, "/isolated")
        self.assertEqual(
            parse_qs(parsed.query),
            {"sslmode": ["disable"], "connect_timeout": ["9"]},
        )

    def test_bounded_subprocess_terminates_after_configured_timeout(self) -> None:
        runner = getattr(integration, "run_bounded", None)
        self.assertIsNotNone(runner, "bounded subprocess runner is required")

        with self.assertRaises(subprocess.TimeoutExpired):
            runner(
                [sys.executable, "-c", "import time; time.sleep(2)"],
                timeout_seconds=0.05,
                capture_output=True,
            )


if __name__ == "__main__":
    unittest.main()
