from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).parents[3]
SCRIPT_PATH = PROJECT_ROOT / "docs/scripts/nous_api_reconcile.py"

spec = importlib.util.spec_from_file_location("nous_api_reconcile", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("unable to load API reconciler")
nous_api_reconcile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nous_api_reconcile)


class ApiReconciliationTests(unittest.TestCase):
    def write_registry(
        self,
        root: Path,
        endpoints: dict[str, dict[str, object]],
        *,
        endpoint_count: int | None = None,
    ) -> None:
        (root / "docs").mkdir()
        (root / "docs/api-contract-registry.json").write_text(
            json.dumps({
                "meta": {
                    "endpoint_count": (
                        len(endpoints) if endpoint_count is None else endpoint_count
                    ),
                    "generated": "auto",
                    "scaffold": False,
                },
                "endpoints": endpoints,
            }),
            encoding="utf-8",
        )

    def test_next_route_handlers_reconcile_by_method_and_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = {
                "meta": {"endpoint_count": 1, "generated": "auto", "scaffold": False},
                "endpoints": {
                    "GET /api/example": {
                        "method": "GET",
                        "url": "/api/example",
                        "sources": [{"type": "story", "ref": "US-999"}],
                    }
                },
            }
            (root / "docs").mkdir()
            (root / "docs/api-contract-registry.json").write_text(
                json.dumps(registry),
                encoding="utf-8",
            )
            route = root / "apps/web/src/app/api/example/route.ts"
            route.parent.mkdir(parents=True)
            route.write_text(
                "export async function GET() { return new Response(); }\n"
                "export async function POST() { return new Response(); }\n",
                encoding="utf-8",
            )
            auth_route = root / "apps/web/src/app/api/auth/[...nextauth]/route.ts"
            auth_route.parent.mkdir(parents=True)
            auth_route.write_text(
                'export { GET, POST } from "@/lib/auth/auth-config";\n',
                encoding="utf-8",
            )
            caller = root / "apps/web/src/modules/example/actions.ts"
            caller.parent.mkdir(parents=True)
            caller.write_text(
                'export const downloadUrl = "/api/example?format=csv";\n',
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertEqual(
                report["summary"],
                {
                    "spec_endpoints": 1,
                    "backend_implemented": 2,
                    "frontend_calls": 1,
                    "matched": 1,
                    "spec_no_backend": 0,
                    "backend_only": 1,
                    "raw_fetch_violations": 0,
                },
            )
            self.assertEqual(
                report["backend_only"],
                [{
                    "file": "apps/web/src/app/api/example/route.ts",
                    "line": 2,
                    "method": "POST",
                    "url": "/api/example",
                }],
            )

    def test_prescribed_no_argument_command_is_material_and_green(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            cwd=PROJECT_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Spec endpoints (registry):    2", result.stdout)
        self.assertIn("Backend route handlers found: 2", result.stdout)
        self.assertIn("Matched method + path:         2", result.stdout)
        self.assertNotIn("0/0/0", result.stdout)

    def test_backend_only_route_makes_the_command_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs/api-contract-registry.json").write_text(
                json.dumps({
                    "meta": {
                        "endpoint_count": 0,
                        "generated": "auto",
                        "scaffold": False,
                    },
                    "endpoints": {},
                }),
                encoding="utf-8",
            )
            route = root / "apps/web/src/app/api/unregistered/route.ts"
            route.parent.mkdir(parents=True)
            route.write_text(
                "export async function GET() { return new Response(); }\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), "--target", str(root)],
                cwd=PROJECT_ROOT,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("Backend-only (not in spec):   1", result.stdout)

    def test_typescript_comments_cannot_spoof_multiline_route_exports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {
                "GET /api/example": {
                    "method": "GET",
                    "url": "/api/example",
                    "sources": [],
                },
                "POST /api/example": {
                    "method": "POST",
                    "url": "/api/example",
                    "sources": [],
                },
            })
            route = root / "apps/web/src/app/api/example/route.ts"
            route.parent.mkdir(parents=True)
            route.write_text(
                "// export async function DELETE() {}\n"
                "/* export const PATCH = () => new Response(); */\n"
                "async function load() { return new Response(); }\n"
                "const submit = async () => new Response();\n"
                "export {\n"
                "  load as GET,\n"
                "  submit\n"
                "    as POST,\n"
                "};\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                [(item["method"], item["path"]) for item in report["backend_endpoints"]],
                [("GET", "/api/example"), ("POST", "/api/example")],
            )
            self.assertEqual(report["summary"]["matched"], 2)
            self.assertEqual(report["summary"]["backend_only"], 0)

    def test_comments_do_not_hide_indirect_and_bracketed_raw_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "// fetch('/api/comment-only')\n"
                "/* globalThis['fetch']('/api/block-comment-only') */\n"
                "const documentation = \"fetch('/api/string-only')\";\n"
                "const request = globalThis[\"fetch\"];\n"
                "request(`/api/indirect?value=${documentation.length}`);\n"
                "globalThis [ 'fetch' ]('/api/bracketed');\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            raw_paths = {
                item["path"]
                for item in report["raw_fetch"]
            }
            self.assertEqual(
                raw_paths,
                {
                    "/api/indirect?value=${documentation.length}",
                    "/api/bracketed",
                },
            )
            self.assertTrue(
                any(
                    item["path"] == "/api/string-only"
                    and item["type"] == "api_reference"
                    for item in report["frontend_calls"]
                ),
                "a real string literal remains a discoverable API reference",
            )

    def test_registry_schema_rejects_noncanonical_or_ambiguous_contracts(self) -> None:
        cases = {
            "count mismatch": (
                {
                    "GET /api/example": {
                        "method": "GET",
                        "url": "/api/example",
                        "sources": [],
                    },
                },
                2,
            ),
            "lowercase key method": (
                {
                    "get /api/example": {
                        "method": "GET",
                        "url": "/api/example",
                        "sources": [],
                    },
                },
                None,
            ),
            "key and payload disagree": (
                {
                    "GET /api/example": {
                        "method": "POST",
                        "url": "/api/example",
                        "sources": [],
                    },
                },
                None,
            ),
            "duplicate normalized contract": (
                {
                    "GET /api/example": {
                        "method": "GET",
                        "url": "/api/example",
                        "sources": [],
                    },
                    "GET /api/example/": {
                        "method": "GET",
                        "url": "/api/example/",
                        "sources": [],
                    },
                },
                None,
            ),
        }
        for name, (endpoints, endpoint_count) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.write_registry(
                    root,
                    endpoints,
                    endpoint_count=endpoint_count,
                )

                report = nous_api_reconcile.reconcile(str(root))

                self.assertIn("error", report)

    def test_ast_resolves_native_fetch_inputs_and_fails_unresolved_calls_closed(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "declare function chooseUrl(): string;\n"
                "const literal = '/api/from-variable';\n"
                "fetch(literal);\n"
                "const request = new Request('/api/from-request');\n"
                "fetch(request);\n"
                "const internal = new URL('/api/from-url', 'https://ledger.test');\n"
                "fetch(internal);\n"
                "fetch('/api/literal');\n"
                "fetch(chooseUrl());\n"
                "const externalUrl = 'https://example.test/public';\n"
                "fetch(externalUrl);\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                {
                    item["path"]
                    for item in report["raw_fetch"]
                    if item["path"] is not None
                },
                {
                    "/api/from-variable",
                    "/api/from-request",
                    "/api/from-url",
                    "/api/literal",
                },
            )
            unresolved = [
                item for item in report["raw_fetch"] if item["path"] is None
            ]
            self.assertEqual(len(unresolved), 1, unresolved)
            self.assertEqual(unresolved[0]["type"], "raw_fetch_unresolved")
            self.assertNotIn(
                None,
                {
                    item["path"]
                    for item in report["frontend_calls"]
                    if item["type"] == "api_reference"
                },
            )

    def test_regex_literals_cannot_hide_exports_or_native_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {
                "GET /api/example": {
                    "method": "GET",
                    "url": "/api/example",
                    "sources": [],
                },
            })
            route = root / "apps/web/src/app/api/example/route.ts"
            route.parent.mkdir(parents=True)
            route.write_text(
                "const probe = /export async function DELETE|\\/\\* spoof \\*\\//;\n"
                "export async function GET() { return new Response(); }\n",
                encoding="utf-8",
            )
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "const probe = /fetch\\(['\"]\\/api\\/fake/;\n"
                "fetch('/api/real');\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                [(item["method"], item["path"]) for item in report["backend_endpoints"]],
                [("GET", "/api/example")],
            )
            self.assertEqual(
                [item["path"] for item in report["raw_fetch"]],
                ["/api/real"],
            )

    def test_only_exact_authjs_catchall_is_excluded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {
                "GET /api/auth/foo": {
                    "method": "GET",
                    "url": "/api/auth/foo",
                    "sources": [],
                },
            })
            framework = root / "apps/web/src/app/api/auth/[...nextauth]/route.ts"
            framework.parent.mkdir(parents=True)
            framework.write_text(
                "export { GET, POST } from '@/lib/auth/auth-config';\n",
                encoding="utf-8",
            )
            owned = root / "apps/web/src/app/api/auth/foo/route.ts"
            owned.parent.mkdir(parents=True)
            owned.write_text(
                "export async function GET() { return new Response(); }\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                [(item["method"], item["path"]) for item in report["backend_endpoints"]],
                [("GET", "/api/auth/foo")],
            )
            self.assertEqual(report["summary"]["matched"], 1)

    def test_shadowed_fetch_bindings_are_not_native_boundary_calls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "function withParameter(fetch: (url: string) => void) {\n"
                "  fetch('/api/shadowed-parameter');\n"
                "}\n"
                "function withLocal() {\n"
                "  const fetch = (url: string) => url;\n"
                "  fetch('/api/shadowed-local');\n"
                "}\n"
                "globalThis.fetch('/api/native-global');\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                [item["path"] for item in report["raw_fetch"]],
                ["/api/native-global"],
            )

    def test_native_fetch_aliases_and_call_apply_wrappers_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "declare function chooseUrl(): string;\n"
                "declare function chooseArgs(): [string];\n"
                "const { fetch: request } = globalThis;\n"
                "request('/api/destructured');\n"
                "const bound = window.fetch.bind(window);\n"
                "bound('/api/bound');\n"
                "self.fetch.call(self, '/api/call');\n"
                "global.fetch.apply(global, ['/api/apply']);\n"
                "const applyArguments = ['/api/apply-variable'] as const;\n"
                "globalThis.fetch.apply(globalThis, applyArguments);\n"
                "self.fetch.call(self, chooseUrl());\n"
                "global.fetch.apply(global, chooseArgs());\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                {
                    item["path"]
                    for item in report["raw_fetch"]
                    if item["path"] is not None
                },
                {
                    "/api/destructured",
                    "/api/bound",
                    "/api/call",
                    "/api/apply",
                    "/api/apply-variable",
                },
            )
            unresolved = [
                item for item in report["raw_fetch"] if item["path"] is None
            ]
            self.assertEqual(len(unresolved), 2, unresolved)
            self.assertTrue(
                all(item["type"] == "raw_fetch_unresolved" for item in unresolved),
                unresolved,
            )

    def test_shadowed_global_objects_and_fetch_wrappers_are_not_native(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "type Client = { fetch: (...args: unknown[]) => unknown };\n"
                "function shadowGlobals(\n"
                "  globalThis: Client,\n"
                "  window: Client,\n"
                "  self: Client,\n"
                "  global: Client,\n"
                ") {\n"
                "  globalThis.fetch('/api/shadowed-globalThis');\n"
                "  const { fetch: request } = window;\n"
                "  request('/api/shadowed-destructured');\n"
                "  const bound = self.fetch.bind(self);\n"
                "  bound('/api/shadowed-bound');\n"
                "  global.fetch.call(global, '/api/shadowed-call');\n"
                "}\n"
                "function shadowFetch(fetch: (...args: unknown[]) => unknown) {\n"
                "  fetch.call(null, '/api/shadowed-fetch-call');\n"
                "  fetch.apply(null, ['/api/shadowed-fetch-apply']);\n"
                "}\n"
                "globalThis.fetch('/api/native');\n",
                encoding="utf-8",
            )

            report = nous_api_reconcile.reconcile(str(root))

            self.assertNotIn("error", report)
            self.assertEqual(
                [item["path"] for item in report["raw_fetch"]],
                ["/api/native"],
            )

    def test_ast_parse_and_helper_protocol_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            source = root / "apps/web/src/modules/example/actions.ts"
            source.parent.mkdir(parents=True)
            source.write_text("fetch('/api/unterminated'\n", encoding="utf-8")

            report = nous_api_reconcile.reconcile(str(root))

            self.assertIn("error", report)
            self.assertIn("TypeScript parse", report["error"])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            with patch.dict(
                os.environ,
                {"NOUS_API_AST_HELPER": str(root / "missing-helper.mjs")},
            ):
                report = nous_api_reconcile.reconcile(str(root))
            self.assertIn("error", report)
            self.assertIn("AST helper", report["error"])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root, {})
            helper = root / "invalid-helper.mjs"
            helper.write_text("process.stdout.write('{}');\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"NOUS_API_AST_HELPER": str(helper)},
            ):
                report = nous_api_reconcile.reconcile(str(root))
            self.assertIn("error", report)
            self.assertIn("schema", report["error"])


if __name__ == "__main__":
    unittest.main()
