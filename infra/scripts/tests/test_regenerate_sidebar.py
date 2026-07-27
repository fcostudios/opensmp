from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path
from types import ModuleType


SCRIPT = Path(__file__).parents[1] / "regenerate-sidebar.py"


def load_generator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("regenerate_sidebar", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load generator: {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generator = load_generator()


def exact_error(message: str) -> str:
    return f"^{re.escape(message)}$"


def navigation_map() -> dict:
    return {
        "app_shell": {
            "sidebar": {
                "sections": ["OPERACIÓN"],
                "items": [
                    {
                        "id": "nav-panel",
                        "label": "Panel general",
                        "route": "/panel",
                        "screen": "SCR-admin-dashboard",
                        "roles": ["group_admin"],
                        "section": "OPERACIÓN",
                    }
                ],
            }
        }
    }


class SidebarGeneratorContractTests(unittest.TestCase):
    def test_rejects_role_outside_canonical_ledger_roles(self) -> None:
        nav = navigation_map()
        nav["app_shell"]["sidebar"]["items"][0]["roles"] = ["gruop_admin"]

        with self.assertRaisesRegex(
            ValueError,
            exact_error("nav-panel: unknown sidebar role(s): gruop_admin"),
        ):
            generator.generate_ts(nav, frozenset({"Circle"}))

    def test_rejects_item_section_omitted_from_declared_sections(self) -> None:
        nav = navigation_map()
        nav["app_shell"]["sidebar"]["items"][0]["section"] = "FINANZAS"

        with self.assertRaisesRegex(
            ValueError,
            exact_error(
                "nav-panel: sidebar section 'FINANZAS' is not declared in "
                "app_shell.sidebar.sections"
            ),
        ):
            generator.generate_ts(nav, frozenset({"Circle"}))

    def test_rejects_duplicate_declared_sections(self) -> None:
        nav = navigation_map()
        nav["app_shell"]["sidebar"]["sections"].append("OPERACIÓN")

        with self.assertRaisesRegex(
            ValueError,
            exact_error("Duplicate sidebar section(s): OPERACIÓN"),
        ):
            generator.generate_ts(nav, frozenset({"Circle"}))

    def test_rejects_unknown_declared_section(self) -> None:
        nav = navigation_map()
        nav["app_shell"]["sidebar"]["sections"] = ["UNKNOWN"]
        nav["app_shell"]["sidebar"]["items"] = []

        with self.assertRaisesRegex(
            ValueError,
            exact_error("Unknown declared sidebar section(s): UNKNOWN"),
        ):
            generator.generate_ts(nav, frozenset({"Circle"}))


if __name__ == "__main__":
    unittest.main()
