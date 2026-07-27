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
