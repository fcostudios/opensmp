#!/usr/bin/env python3
"""nous_api_reconcile.py — Reconcile API contract registry vs actual implementation.

Compares the spec-defined endpoints (from TOON dataSource + stories) against
the actually implemented backend controllers and frontend API client calls.

Usage:
    # Full reconciliation report for the repository containing this script
    python3 docs/scripts/nous_api_reconcile.py

    # Update the registry with implementation status
    python3 nous_api_reconcile.py --target /path/to/dev-package --update

    # JSON output for CI
    python3 nous_api_reconcile.py --target /path/to/dev-package --json
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
AST_HELPER_SCHEMA_VERSION = 1


def _validate_ast_result(result: object) -> str | None:
    if (
        not isinstance(result, dict)
        or result.get("version") != AST_HELPER_SCHEMA_VERSION
        or set(result) != {"version", "backend_endpoints", "frontend_calls"}
        or not isinstance(result["backend_endpoints"], list)
        or not isinstance(result["frontend_calls"], list)
    ):
        return "AST helper result does not match schema version 1"
    for endpoint in result["backend_endpoints"]:
        if (
            not isinstance(endpoint, dict)
            or set(endpoint) != {"method", "path", "file", "line"}
            or endpoint.get("method") not in HTTP_METHODS
            or not isinstance(endpoint.get("path"), str)
            or not endpoint["path"].startswith("/api/")
            or not isinstance(endpoint.get("file"), str)
            or not isinstance(endpoint.get("line"), int)
            or endpoint["line"] < 1
        ):
            return "AST helper backend endpoint does not match schema"
    for call in result["frontend_calls"]:
        call_type = call.get("type") if isinstance(call, dict) else None
        path = call.get("path") if isinstance(call, dict) else None
        if (
            not isinstance(call, dict)
            or set(call) != {"path", "type", "file", "line"}
            or call_type not in {
                "api_reference",
                "shared_client",
                "raw_fetch",
                "raw_fetch_unresolved",
            }
            or (
                call_type == "raw_fetch_unresolved"
                and path is not None
            )
            or (
                call_type != "raw_fetch_unresolved"
                and (
                    not isinstance(path, str)
                    or not path.startswith("/api/")
                )
            )
            or not isinstance(call.get("file"), str)
            or not isinstance(call.get("line"), int)
            or call["line"] < 1
        ):
            return "AST helper frontend call does not match schema"
    return None


def scan_typescript_ast(target_dir: str) -> dict:
    helper = Path(
        os.environ.get(
            "NOUS_API_AST_HELPER",
            Path(__file__).with_name("nous_api_ast_scan.mjs"),
        )
    )
    if not helper.is_file():
        raise RuntimeError(f"AST helper is missing: {helper}")
    completed = subprocess.run(
        ["node", str(helper), target_dir],
        check=False,
        capture_output=True,
        text=True,
        cwd=target_dir,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "no diagnostic"
        raise RuntimeError(f"AST helper failed: {detail}")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("AST helper returned invalid JSON") from error
    schema_error = _validate_ast_result(result)
    if schema_error:
        raise RuntimeError(schema_error)
    return result


def normalize_spec_url(url: str) -> str:
    """Normalize a TOON dataSource URL for comparison.

    Remove query params, replace {{template_vars}} with :param style.
    """
    # Strip query params
    url = url.split("?")[0]
    # Replace {{var}} with :var
    url = re.sub(r"\{\{:?(\w+)\}\}", r":\1", url)
    # Replace :paramId patterns
    url = re.sub(r":(\w+)Id\b", r":\1Id", url)
    return url.rstrip("/")


def normalize_impl_path(path: str) -> str:
    """Normalize a controller path for comparison."""
    # Replace {var} with :var
    path = re.sub(r"\{(\w+)\}", r":\1", path)
    return path.rstrip("/")


def validate_registry(registry: object) -> str | None:
    if not isinstance(registry, dict):
        return "registry must be a JSON object"
    meta = registry.get("meta")
    endpoints = registry.get("endpoints")
    if not isinstance(meta, dict) or not isinstance(endpoints, dict):
        return "registry requires meta and endpoints objects"
    endpoint_count = meta.get("endpoint_count")
    if type(endpoint_count) is not int or endpoint_count != len(endpoints):
        return "registry meta.endpoint_count must equal the endpoint map size"
    seen: set[tuple[str, str]] = set()
    for key, endpoint in endpoints.items():
        if not isinstance(key, str) or not isinstance(endpoint, dict):
            return "registry endpoint entries must be keyed objects"
        method = endpoint.get("method")
        url = endpoint.get("url")
        if (
            not isinstance(method, str)
            or method not in HTTP_METHODS
            or not isinstance(url, str)
            or not url.startswith("/api/")
            or key != f"{method} {url}"
        ):
            return f"registry endpoint key/payload is not canonical: {key}"
        normalized = (method, normalize_spec_url(url))
        if normalized in seen:
            return f"registry contains duplicate normalized contract: {method} {url}"
        seen.add(normalized)
    return None


def reconcile(target_dir: str) -> dict:
    """Run full reconciliation. Returns report dict."""
    # Load registry
    registry_path = os.path.join(target_dir, "docs", "api-contract-registry.json")
    if not os.path.exists(registry_path):
        return {"error": f"Registry not found: {registry_path}. Run nous_story_patch.py first."}

    with open(registry_path, "r", encoding="utf-8") as f:
        registry = json.load(f)
    registry_error = validate_registry(registry)
    if registry_error:
        return {"error": registry_error}

    # Scan all TypeScript implementation files in one compiler-AST process.
    try:
        ast_result = scan_typescript_ast(target_dir)
    except RuntimeError as error:
        return {"error": str(error)}
    backend_endpoints = ast_result["backend_endpoints"]
    frontend_calls = ast_result["frontend_calls"]

    # Build lookup sets
    backend_set: dict[tuple[str, str], list[dict]] = {}
    for ep in backend_endpoints:
        key = (ep["method"], normalize_impl_path(ep["path"]))
        if key not in backend_set:
            backend_set[key] = []
        backend_set[key].append(ep)

    frontend_set: dict[str, list[dict]] = {}
    for call in frontend_calls:
        if not isinstance(call["path"], str):
            continue
        key = normalize_spec_url(call["path"])
        if key not in frontend_set:
            frontend_set[key] = []
        frontend_set[key].append(call)

    # Reconcile each registry endpoint
    results = {
        "matched": [],       # spec + backend + frontend all agree
        "backend_only": [],  # implemented but not in spec
        "frontend_only": [], # called from frontend but no backend
        "spec_only": [],     # in spec but not implemented anywhere
        "spec_no_backend": [],  # in spec, maybe in frontend, but no backend
        "raw_fetch": [],     # frontend calls using raw fetch instead of shared client
    }

    seen_backend = set()
    seen_frontend = set()

    for key, endpoint in registry.get("endpoints", {}).items():
        spec_url = normalize_spec_url(endpoint["url"])
        method = endpoint.get("method", "GET")

        backend_key = (method, spec_url)
        has_backend = backend_key in backend_set
        has_frontend = spec_url in frontend_set

        if has_backend:
            seen_backend.add(backend_key)
        if has_frontend:
            seen_frontend.add(spec_url)

        entry = {
            "spec_key": key,
            "url": endpoint["url"],
            "normalized": spec_url,
            "sources": endpoint.get("sources", []),
        }

        if has_backend and has_frontend:
            entry["backend_files"] = [e["file"] for e in backend_set[backend_key]]
            entry["frontend_files"] = [c["file"] for c in frontend_set[spec_url]]
            results["matched"].append(entry)
        elif has_backend and not has_frontend:
            entry["backend_files"] = [e["file"] for e in backend_set[backend_key]]
            results["matched"].append(entry)
        elif not has_backend:
            if has_frontend:
                entry["frontend_files"] = [c["file"] for c in frontend_set[spec_url]]
            results["spec_no_backend"].append(entry)

    # Find backend endpoints not in spec
    for backend_key, endpoints in backend_set.items():
        if backend_key not in seen_backend:
            results["backend_only"].append({
                "url": endpoints[0]["path"],
                "method": endpoints[0]["method"],
                "file": endpoints[0]["file"],
                "line": endpoints[0]["line"],
            })

    # Find raw fetch calls
    for call in frontend_calls:
        if call["type"] in ("raw_fetch", "raw_fetch_unresolved"):
            results["raw_fetch"].append(call)

    # Summary
    spec_count = len(registry.get("endpoints", {}))
    results["summary"] = {
        "spec_endpoints": spec_count,
        "backend_implemented": len(backend_endpoints),
        "frontend_calls": len(frontend_calls),
        "matched": len(results["matched"]),
        "spec_no_backend": len(results["spec_no_backend"]),
        "backend_only": len(results["backend_only"]),
        "raw_fetch_violations": len(results["raw_fetch"]),
    }
    results["backend_endpoints"] = backend_endpoints
    results["frontend_calls"] = frontend_calls

    return results


def print_report(results: dict) -> int:
    """Print human-readable reconciliation report."""
    if "error" in results:
        print(f"ERROR: {results['error']}")
        return 1

    s = results["summary"]
    print("=" * 70)
    print("API Contract Reconciliation Report")
    print("=" * 70)
    print(f"  Spec endpoints (registry):    {s['spec_endpoints']}")
    print(f"  Backend route handlers found: {s['backend_implemented']}")
    print(f"  Frontend API calls found:     {s['frontend_calls']}")
    print(f"  Matched method + path:         {s['matched']}")
    print(f"  Spec-only (not implemented):  {s['spec_no_backend']}")
    print(f"  Backend-only (not in spec):   {s['backend_only']}")
    print(f"  Raw fetch violations:         {s['raw_fetch_violations']}")
    print()

    if results["spec_no_backend"]:
        print("--- SPEC ENDPOINTS MISSING BACKEND ---")
        for ep in results["spec_no_backend"][:20]:
            sources = ", ".join(f"{s['type']}:{s['ref']}" for s in ep.get("sources", []))
            print(f"  ✗ {ep['url']}")
            print(f"    Sources: {sources}")
        if len(results["spec_no_backend"]) > 20:
            print(f"  ... and {len(results['spec_no_backend']) - 20} more")
        print()

    if results["backend_only"]:
        print("--- BACKEND ENDPOINTS NOT IN SPEC ---")
        for ep in results["backend_only"][:15]:
            print(f"  ? {ep['method']} {ep['url']}")
            print(f"    File: {ep['file']}:{ep['line']}")
        if len(results["backend_only"]) > 15:
            print(f"  ... and {len(results['backend_only']) - 15} more")
        print()

    if results["raw_fetch"]:
        print("--- RAW FETCH VIOLATIONS (should use shared client) ---")
        for call in results["raw_fetch"][:10]:
            path = call["path"] or "<unresolved native fetch target>"
            print(f"  ⚠ {path}")
            print(f"    File: {call['file']}:{call['line']}")
        if len(results["raw_fetch"]) > 10:
            print(f"  ... and {len(results['raw_fetch']) - 10} more")
        print()

    # Verdict
    issues = s["spec_no_backend"] + s["backend_only"] + s["raw_fetch_violations"]
    if issues == 0:
        print("✓ All spec endpoints implemented. No raw fetch violations.")
    else:
        print(f"✗ {issues} issue(s) found. Fix before sprint acceptance.")
    return 1 if issues else 0


def _create_fbk_from_reconcile(results: dict, db_path: str, project_id: str | None = None) -> int:
    """Create Type A FBK records for spec-only endpoints and raw-fetch violations."""
    import sys as _sys
    import hashlib as _hl
    _SYSTEM_DIR = os.path.dirname(os.path.abspath(__file__))
    if _SYSTEM_DIR not in _sys.path:
        _sys.path.insert(0, _SYSTEM_DIR)

    try:
        from nous_db import NousDB
    except ImportError:
        print("WARNING: nous_db not found — skipping FBK creation")
        return 0

    db = NousDB(db_path)
    try:
        db.init_schema()
    except Exception:
        pass

    if not project_id:
        row = db.conn.execute("SELECT id FROM projects LIMIT 1").fetchone()
        if not row:
            db.close()
            print("WARNING: No project in nous.db — skipping FBK creation")
            return 0
        project_id = row[0]

    created = 0

    # spec-only endpoints → integration_gap / major
    for ep in results.get("spec_only", []):
        url = ep.get("url", "")
        method = ep.get("method", "")
        desc = f"Spec-only endpoint not implemented: [{method}] {url}"
        raw = f"{project_id}:api_reconciliation:{url}:{desc[:200]}"
        dedup_key = _hl.sha256(raw.encode()).hexdigest()[:16]
        existing_check = db.conn.execute(
            "SELECT id FROM feedback WHERE project_id=? AND dedup_key=?", (project_id, dedup_key)
        ).fetchone()
        fbk = db.create_feedback(
            project_id=project_id,
            title=f"Missing impl: [{method}] {url}"[:100],
            description=desc,
            feedback_type="A",
            category="integration_gap",
            source="api_reconciliation",
            severity="major",
            created_by="nous_api_reconcile",
            dedup_key=dedup_key,
        )
        if fbk and not existing_check:
            created += 1

    # raw-fetch violations → implementation_failure / minor
    for viol in results.get("raw_fetch_violations", []):
        file_path = viol.get("file", "")
        line = viol.get("line", "")
        desc = f"Raw fetch() call (should use shared API client): {file_path}:{line}"
        raw = f"{project_id}:api_reconciliation:{file_path}:{line}"
        dedup_key = _hl.sha256(raw.encode()).hexdigest()[:16]
        existing_check = db.conn.execute(
            "SELECT id FROM feedback WHERE project_id=? AND dedup_key=?", (project_id, dedup_key)
        ).fetchone()
        fbk = db.create_feedback(
            project_id=project_id,
            title=f"Raw fetch in {os.path.basename(file_path)}"[:100],
            description=desc,
            feedback_type="A",
            category="implementation_failure",
            source="api_reconciliation",
            severity="minor",
            created_by="nous_api_reconcile",
            dedup_key=dedup_key,
        )
        if fbk and not existing_check:
            created += 1

    db.close()
    return created


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile API contract registry vs implementation")
    default_target = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--target",
        "-t",
        default=str(default_target),
        help="Dev package directory (defaults to the repository containing this script)",
    )
    parser.add_argument("--update", "-u", action="store_true", help="Update registry with implementation status")
    parser.add_argument("--json", "-j", action="store_true", help="Output as JSON")
    parser.add_argument("--create-fbk", action="store_true",
                        help="Create Type A FBK records for spec-only endpoints and raw-fetch violations")
    parser.add_argument("--db", default=None, help="Path to nous.db (required with --create-fbk if not auto-detected)")
    parser.add_argument("--project", default=None, help="Project ID (used with --create-fbk)")
    args = parser.parse_args()

    results = reconcile(os.path.abspath(args.target))

    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
        exit_code = reconciliation_exit_code(results)
    else:
        exit_code = print_report(results)

    if args.update and "error" not in results:
        registry_path = os.path.join(args.target, "docs", "api-contract-registry.json")
        with open(registry_path, "r", encoding="utf-8") as f:
            registry = json.load(f)
        registry["reconciliation"] = results["summary"]
        registry["reconciliation"]["last_run"] = "auto"
        with open(registry_path, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2, ensure_ascii=False)
        print(f"\nRegistry updated: {registry_path}")

    if args.create_fbk and "error" not in results:
        # Auto-detect nous.db
        db_path = args.db
        if not db_path:
            _system_dir = os.path.dirname(os.path.abspath(__file__))
            candidates = [
                os.path.join(_system_dir, "..", "nous.db"),
                os.path.join(_system_dir, "nous.db"),
            ]
            for c in candidates:
                if os.path.isfile(c):
                    db_path = os.path.abspath(c)
                    break
        if not db_path:
            print("WARNING: --create-fbk requires --db /path/to/nous.db (auto-detect failed)")
        else:
            n = _create_fbk_from_reconcile(results, db_path, args.project)
            print(f"\nCreated {n} FBK records from API reconciliation violations")
    return exit_code


def reconciliation_exit_code(results: dict) -> int:
    if "error" in results:
        return 1
    summary = results["summary"]
    issues = (
        summary["spec_no_backend"]
        + summary["backend_only"]
        + summary["raw_fetch_violations"]
    )
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
