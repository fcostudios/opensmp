#!/usr/bin/env python3
"""nous_api_reconcile.py — Reconcile API contract registry vs actual implementation.

Compares the spec-defined endpoints (from TOON dataSource + stories) against
the actually implemented backend controllers and frontend API client calls.

Usage:
    # Full reconciliation report
    python3 nous_api_reconcile.py --target /path/to/dev-package

    # Update the registry with implementation status
    python3 nous_api_reconcile.py --target /path/to/dev-package --update

    # JSON output for CI
    python3 nous_api_reconcile.py --target /path/to/dev-package --json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path


def scan_backend_controllers(target_dir: str) -> list[dict]:
    """Scan Java controllers for @RequestMapping + method mappings."""
    api_dir = Path(target_dir) / "apps" / "api" / "src" / "main"
    if not api_dir.exists():
        return []

    endpoints = []
    method_annotations = {
        "GetMapping": "GET",
        "PostMapping": "POST",
        "PutMapping": "PUT",
        "PatchMapping": "PATCH",
        "DeleteMapping": "DELETE",
    }

    for java_file in api_dir.rglob("*.java"):
        content = java_file.read_text(encoding="utf-8", errors="ignore")
        lines = content.split("\n")

        # Find class-level @RequestMapping
        class_path = ""
        for line in lines:
            m = re.search(r'@RequestMapping\("([^"]+)"\)', line)
            if m:
                class_path = m.group(1).rstrip("/")
                break

        # Find method-level mappings
        for i, line in enumerate(lines):
            for annotation, method in method_annotations.items():
                pattern = rf'@{annotation}(?:\("([^"]*)"\)|\s*$)'
                m = re.search(pattern, line)
                if m:
                    method_path = m.group(1) if m.group(1) else ""
                    full_path = class_path + ("/" + method_path.lstrip("/") if method_path else "")
                    # Normalize path params: {id} → :id
                    normalized = re.sub(r"\{(\w+)\}", r":\1", full_path)
                    endpoints.append({
                        "method": method,
                        "path": full_path,
                        "normalized": normalized,
                        "file": str(java_file.relative_to(target_dir)),
                        "line": i + 1,
                    })

    return endpoints


def scan_frontend_api_calls(target_dir: str) -> list[dict]:
    """Scan frontend for API calls (both shared client and raw fetch)."""
    web_dir = Path(target_dir) / "apps" / "web" / "src"
    if not web_dir.exists():
        return []

    calls = []
    # Match: apiGet("/api/v1/..."), apiPost("/api/...", ...), fetch("/api/...", ...)
    patterns = [
        (r'api(?:Get|Post|Patch|Put|Delete)\s*[<(]\s*[`"]([^`"]+)[`"]', "shared_client"),
        (r'fetch\s*\(\s*[`"]([^`"]*\/api\/[^`"]+)[`"]', "raw_fetch"),
        (r'fetch\s*\(\s*`\$\{[^}]+\}(\/api\/[^`]+)`', "raw_fetch_template"),
    ]

    for ts_file in web_dir.rglob("*.ts"):
        if "node_modules" in str(ts_file) or ".test." in str(ts_file) or ".spec." in str(ts_file):
            continue
        content = ts_file.read_text(encoding="utf-8", errors="ignore")
        for pattern, call_type in patterns:
            for m in re.finditer(pattern, content):
                path = m.group(1)
                if "/api/" in path:
                    calls.append({
                        "path": path,
                        "type": call_type,
                        "file": str(ts_file.relative_to(target_dir)),
                    })

    for tsx_file in web_dir.rglob("*.tsx"):
        if "node_modules" in str(tsx_file) or ".test." in str(tsx_file):
            continue
        content = tsx_file.read_text(encoding="utf-8", errors="ignore")
        for pattern, call_type in patterns:
            for m in re.finditer(pattern, content):
                path = m.group(1)
                if "/api/" in path:
                    calls.append({
                        "path": path,
                        "type": call_type,
                        "file": str(tsx_file.relative_to(target_dir)),
                    })

    return calls


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


def reconcile(target_dir: str) -> dict:
    """Run full reconciliation. Returns report dict."""
    # Load registry
    registry_path = os.path.join(target_dir, "docs", "api-contract-registry.json")
    if not os.path.exists(registry_path):
        return {"error": f"Registry not found: {registry_path}. Run nous_story_patch.py first."}

    with open(registry_path, "r", encoding="utf-8") as f:
        registry = json.load(f)

    # Scan implementation
    backend_endpoints = scan_backend_controllers(target_dir)
    frontend_calls = scan_frontend_api_calls(target_dir)

    # Build lookup sets
    backend_set: dict[str, list[dict]] = {}
    for ep in backend_endpoints:
        key = normalize_impl_path(ep["path"])
        if key not in backend_set:
            backend_set[key] = []
        backend_set[key].append(ep)

    frontend_set: dict[str, list[dict]] = {}
    for call in frontend_calls:
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

        has_backend = spec_url in backend_set
        has_frontend = spec_url in frontend_set

        if has_backend:
            seen_backend.add(spec_url)
        if has_frontend:
            seen_frontend.add(spec_url)

        entry = {
            "spec_key": key,
            "url": endpoint["url"],
            "normalized": spec_url,
            "sources": endpoint.get("sources", []),
        }

        if has_backend and has_frontend:
            entry["backend_files"] = [e["file"] for e in backend_set[spec_url]]
            entry["frontend_files"] = [c["file"] for c in frontend_set[spec_url]]
            results["matched"].append(entry)
        elif has_backend and not has_frontend:
            entry["backend_files"] = [e["file"] for e in backend_set[spec_url]]
            results["spec_no_backend"].append(entry)  # has backend but no frontend call
            # Actually this is partially matched
            results["matched"].append(entry)
        elif not has_backend:
            if has_frontend:
                entry["frontend_files"] = [c["file"] for c in frontend_set[spec_url]]
            results["spec_no_backend"].append(entry)

    # Find backend endpoints not in spec
    for path, endpoints in backend_set.items():
        if path not in seen_backend:
            results["backend_only"].append({
                "url": endpoints[0]["path"],
                "method": endpoints[0]["method"],
                "file": endpoints[0]["file"],
                "line": endpoints[0]["line"],
            })

    # Find raw fetch calls
    for call in frontend_calls:
        if call["type"] == "raw_fetch" or call["type"] == "raw_fetch_template":
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

    return results


def print_report(results: dict) -> None:
    """Print human-readable reconciliation report."""
    if "error" in results:
        print(f"ERROR: {results['error']}")
        sys.exit(1)

    s = results["summary"]
    print("=" * 70)
    print("API Contract Reconciliation Report")
    print("=" * 70)
    print(f"  Spec endpoints (registry):    {s['spec_endpoints']}")
    print(f"  Backend controllers found:    {s['backend_implemented']}")
    print(f"  Frontend API calls found:     {s['frontend_calls']}")
    print(f"  Matched (spec ↔ backend):     {s['matched']}")
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
            print(f"  ⚠ {call['path']}")
            print(f"    File: {call['file']}")
        if len(results["raw_fetch"]) > 10:
            print(f"  ... and {len(results['raw_fetch']) - 10} more")
        print()

    # Verdict
    issues = s["spec_no_backend"] + s["raw_fetch_violations"]
    if issues == 0:
        print("✓ All spec endpoints implemented. No raw fetch violations.")
    else:
        print(f"✗ {issues} issue(s) found. Fix before sprint acceptance.")


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


def main():
    parser = argparse.ArgumentParser(description="Reconcile API contract registry vs implementation")
    parser.add_argument("--target", "-t", required=True, help="Dev package directory")
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
    else:
        print_report(results)

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


if __name__ == "__main__":
    main()
