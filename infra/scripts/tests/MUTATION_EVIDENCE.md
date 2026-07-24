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
| M01 | Duplicate stale/expected occurrence rejection | `test_duplicate_governed_text_fails_without_writing` |
| M02 | Validate-all-before-write ordering | `test_later_validation_failure_cannot_leave_partial_writes` |
| M03 | Global forbidden-guidance scan | `test_forbidden_guidance_aborts_all_planned_writes` |
| M04 | Exact CLAUDE mirror parity | `test_reconcile_enforces_exact_mirror_parity_and_complete_change_notes` |
| M05 | Preview no-write guarantee | `test_preview_shows_effective_changes_without_writing` |
| M06 | Check-mode drift failure | `test_check_reports_exact_mirror_drift_without_writing` |
| M07 | Atomic application of a validated plan | `test_reconcile_enforces_exact_mirror_parity_and_complete_change_notes` |
