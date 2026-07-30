#!/usr/bin/env python3
"""Run focused mutation evidence for the TypeScript API AST boundary."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).parents[3]
SOURCE_PATH = PROJECT_ROOT / "docs/scripts/nous_api_ast_scan.mjs"
TEST_MODULE = "infra.scripts.tests.test_nous_api_reconcile.ApiReconciliationTests"
COMPILER_PATH = (
    PROJECT_ROOT / "apps/web/node_modules/typescript/lib/typescript.js"
)


@dataclass(frozen=True)
class Mutation:
    identifier: str
    description: str
    original: str
    replacement: str
    killer: str


MUTATIONS = (
    Mutation(
        "A01",
        "exclude every owned /api/auth route with the Auth.js catch-all",
        '&& repoRelative(path) !== AUTHJS_ROUTE,\n',
        '&& !repoRelative(path).startsWith("apps/web/src/app/api/auth/"),\n',
        "test_only_exact_authjs_catchall_is_excluded",
    ),
    Mutation(
        "A02",
        "ignore TypeScript parse diagnostics",
        "  if (sourceFile.parseDiagnostics.length) {\n",
        "  if (false && sourceFile.parseDiagnostics.length) {\n",
        "test_ast_parse_and_helper_protocol_fail_closed",
    ),
    Mutation(
        "A03",
        "drop unresolved native fetch violations",
        "        } else if (value === null) {\n",
        "        } else if (false && value === null) {\n",
        "test_ast_resolves_native_fetch_inputs_and_fails_unresolved_calls_closed",
    ),
    Mutation(
        "A04",
        "treat every identifier named fetch as the native global",
        """  if (node.text === "fetch") {
    if (!symbol) return true;
    const ownedDeclaration = (symbol.declarations || []).find(
      (declaration) => declaration.getSourceFile() === node.getSourceFile(),
    );
    if (!ownedDeclaration) return true;
  }
""",
        """  if (node.text === "fetch") {
    return true;
  }
""",
        "test_shadowed_fetch_bindings_are_not_native_boundary_calls",
    ),
    Mutation(
        "A05",
        "disable Request and URL static target resolution",
        """    && (node.expression.text === "Request" || node.expression.text === "URL")
""",
        """    && false
    && (node.expression.text === "Request" || node.expression.text === "URL")
""",
        "test_ast_resolves_native_fetch_inputs_and_fails_unresolved_calls_closed",
    ),
    Mutation(
        "A06",
        "disable named export discovery",
        """      && ts.isNamedExports(statement.exportClause)
""",
        """      && false
      && ts.isNamedExports(statement.exportClause)
""",
        "test_typescript_comments_cannot_spoof_multiline_route_exports",
    ),
    Mutation(
        "A07",
        "disable destructured native-fetch alias resolution",
        """    && isGlobalObject(variable.initializer)
""",
        """    && false
    && isGlobalObject(variable.initializer)
""",
        "test_native_fetch_aliases_and_call_apply_wrappers_fail_closed",
    ),
    Mutation(
        "A08",
        "trust a shadowed global-object name in destructuring",
        """    && isGlobalObject(variable.initializer)
""",
        """    && (
      isGlobalObject(variable.initializer)
      || (
        ts.isIdentifier(variable.initializer)
        && ["globalThis", "window", "self", "global"].includes(variable.initializer.text)
      )
    )
""",
        "test_shadowed_global_objects_and_fetch_wrappers_are_not_native",
    ),
    Mutation(
        "A09",
        "disable native-fetch bind alias resolution",
        """    && isNativeFetchReference(memberObject(node.expression), seen)
""",
        """    && false
    && isNativeFetchReference(memberObject(node.expression), seen)
""",
        "test_native_fetch_aliases_and_call_apply_wrappers_fail_closed",
    ),
    Mutation(
        "A10",
        "trust a shadowed fetch property when resolving bind aliases",
        """    && isNativeFetchReference(memberObject(node.expression), seen)
""",
        """    && (
      isNativeFetchReference(memberObject(node.expression), seen)
      || memberName(memberObject(node.expression)) === "fetch"
    )
""",
        "test_shadowed_global_objects_and_fetch_wrappers_are_not_native",
    ),
    Mutation(
        "A11",
        "disable native-fetch call and apply wrapper resolution",
        """  if (!object || !["call", "apply"].includes(wrapper) || !isNativeFetchReference(object)) {
""",
        """  if (true || !object || !["call", "apply"].includes(wrapper) || !isNativeFetchReference(object)) {
""",
        "test_native_fetch_aliases_and_call_apply_wrappers_fail_closed",
    ),
    Mutation(
        "A12",
        "trust a shadowed fetch property in call and apply wrappers",
        """  if (!object || !["call", "apply"].includes(wrapper) || !isNativeFetchReference(object)) {
""",
        """  if (
    !object
    || !["call", "apply"].includes(wrapper)
    || (!isNativeFetchReference(object) && memberName(object) !== "fetch")
  ) {
""",
        "test_shadowed_global_objects_and_fetch_wrappers_are_not_native",
    ),
    Mutation(
        "A13",
        "classify every supported global-object spelling as global",
        """  const symbol = checker.getSymbolAtLocation(node);
  return Boolean(
    !symbol
    || !(symbol.declarations || []).some(
      (declaration) => declaration.getSourceFile() === node.getSourceFile(),
    ),
  );
""",
        """  return true;
""",
        "test_shadowed_global_objects_and_fetch_wrappers_are_not_native",
    ),
    Mutation(
        "A14",
        "disable apply argument-array target extraction",
        """    argument: argumentList ? firstArrayArgument(argumentList) : null,
""",
        """    argument: null,
""",
        "test_native_fetch_aliases_and_call_apply_wrappers_fail_closed",
    ),
    Mutation(
        "A15",
        "disable variable-bound apply argument-array resolution",
        """  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    const initializer = symbolInitializer(node);
    return initializer ? firstArrayArgument(initializer, seen) : null;
  }
""",
        """  if (false && ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    const initializer = symbolInitializer(node);
    return initializer ? firstArrayArgument(initializer, seen) : null;
  }
""",
        "test_native_fetch_aliases_and_call_apply_wrappers_fail_closed",
    ),
)


def main() -> int:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    survivors: list[str] = []
    for mutation in MUTATIONS:
        if source.count(mutation.original) != 1:
            raise RuntimeError(
                f"{mutation.identifier}: mutation anchor must occur exactly once"
            )
        mutated = source.replace(mutation.original, mutation.replacement, 1)
        with tempfile.TemporaryDirectory() as directory:
            mutant_path = Path(directory) / SOURCE_PATH.name
            mutant_path.write_text(mutated, encoding="utf-8")
            environment = os.environ.copy()
            environment["NOUS_API_AST_HELPER"] = str(mutant_path)
            environment["NOUS_TYPESCRIPT_COMPILER"] = str(COMPILER_PATH)
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "unittest",
                    f"{TEST_MODULE}.{mutation.killer}",
                    "-v",
                ],
                cwd=PROJECT_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
        output = result.stdout + result.stderr
        killed = (
            result.returncode != 0
            and re.search(r"FAILED \(failures=[1-9][0-9]*\)", output) is not None
            and "ERROR" not in output
        )
        if killed:
            print(f"KILLED {mutation.identifier}: {mutation.description}")
        else:
            survivors.append(mutation.identifier)
            print(f"SURVIVED {mutation.identifier}: {mutation.description}")
            print(output)
    if survivors:
        print(f"surviving mutations: {', '.join(survivors)}", file=sys.stderr)
        return 1
    print(f"mutation score: {len(MUTATIONS)}/{len(MUTATIONS)} killed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
