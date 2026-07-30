# Reconciler mutation evidence

Run:

```bash
pnpm test:mutation:infra
```

This is focused behavioral mutation evidence for
`infra/scripts/reconcile-sprint1-docs.py`. It does not report coverage. Each
mutant is compiled, substituted into a temporary copy, and executed against
the named exact-oracle test. A mutant is counted as killed only when that test
fails an assertion rather than raising an infrastructure or syntax error.

| Mutant | Safeguard removed | Killing behavior test |
|---|---|---|
| M01 | Pinned source-hash migration branch | `test_reconciles_known_source_hash_to_pinned_desired_artifacts` |
| M02 | Pinned desired-hash no-op branch | `test_desired_hash_is_noop_and_claude_drives_mirrors` |
| M03 | Unknown-state rejection | `test_unknown_pinned_hash_fails_without_writing` |
| M04 | Source artifact hash verification | `test_source_artifact_hash_mismatch_fails_without_writing` |
| M05 | Desired artifact hash verification | `test_manifest_artifact_hash_mismatch_fails_without_writing` |
| M06 | Desired CLAUDE mirror data flow | `test_desired_hash_is_noop_and_claude_drives_mirrors` |
| M07 | Global forbidden-guidance scan | `test_forbidden_unpinned_guidance_aborts_all_planned_writes` |
| M08 | Preview no-write guarantee | `test_preview_shows_pinned_changes_without_writing` |
| M09 | Atomic application of a validated pinned plan | `test_reconciles_known_source_hash_to_pinned_desired_artifacts` |
| M10 | Duplicate reviewed-section marker rejection | `test_unknown_reviewed_section_fails_without_writing` |
| M11 | CHG-004 exact output path set | `test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes` |
| M12 | CHG-005 exact story path set | `test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes` |
| M13 | CHG-004 output-to-source allowlist | `test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes` |
| M14 | Canonical lowercase SHA-256 validation | `test_chg004_and_chg005_manifests_reject_unsafe_schema_before_writes` |
| M15 | Resolved-path containment across symlinks | `test_manifest_source_symlink_cannot_escape_data_root` |

The same command also mutates the TypeScript compiler-AST API scanner:

| Mutant | Safeguard removed | Killing behavior test |
|---|---|---|
| A01 | Exact Auth.js catch-all exclusion | `test_only_exact_authjs_catchall_is_excluded` |
| A02 | TypeScript parse-diagnostic failure | `test_ast_parse_and_helper_protocol_fail_closed` |
| A03 | Unresolved native-fetch conservative failure | `test_ast_resolves_native_fetch_inputs_and_fails_unresolved_calls_closed` |
| A04 | Lexical fetch-shadow detection | `test_shadowed_fetch_bindings_are_not_native_boundary_calls` |
| A05 | Request/URL static target resolution | `test_ast_resolves_native_fetch_inputs_and_fails_unresolved_calls_closed` |
| A06 | Multiline named-export discovery | `test_typescript_comments_cannot_spoof_multiline_route_exports` |
| A07 | Destructured native-fetch alias resolution | `test_native_fetch_aliases_and_call_apply_wrappers_fail_closed` |
| A08 | Scope verification for destructured global objects | `test_shadowed_global_objects_and_fetch_wrappers_are_not_native` |
| A09 | Native-fetch bind alias resolution | `test_native_fetch_aliases_and_call_apply_wrappers_fail_closed` |
| A10 | Scope verification for bound fetch properties | `test_shadowed_global_objects_and_fetch_wrappers_are_not_native` |
| A11 | Native-fetch call/apply wrapper resolution | `test_native_fetch_aliases_and_call_apply_wrappers_fail_closed` |
| A12 | Scope verification for call/apply fetch properties | `test_shadowed_global_objects_and_fetch_wrappers_are_not_native` |
| A13 | Global-object symbol/scope verification | `test_shadowed_global_objects_and_fetch_wrappers_are_not_native` |
| A14 | Apply argument-array target extraction | `test_native_fetch_aliases_and_call_apply_wrappers_fail_closed` |
| A15 | Variable-bound apply argument-array resolution | `test_native_fetch_aliases_and_call_apply_wrappers_fail_closed` |
