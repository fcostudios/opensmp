# US-070 bounded critical-path declaration delivery

Config fcostudios__smp: versions 36 → 37 → 38; final record ID 70. Both patches preserved the entire prior array. Second patch clarified ignore-stale/equal-equivalent vs reject-equal-contradictory behavior and included DEC-SMP-025. Prior invitation row verified identical.

Commands (shell prefixed rtk; nested CLI invocations via Python subprocess):
- python3 /Users/fcolomas/Projects/nous/Nous/System/nous_trace.py config show --project fcostudios__smp; before snapshot private /tmp/us070-nous-config-before.json; re-read current version before second patch.
- ./infra/scripts/sync-from-nous.sh --dry-run -c agent_files sprint_plan (exit 0; critical-path-preview.log).
- nous_trace.py config patch --project fcostudios__smp --key testing.critical_paths --value <entire JSON array /tmp/us070-critical-path-array.json> (both exit 0; critical-path-config-patch.log).
- tar scratch copy excluding .git, node_modules, .next, .tmp and .nous-feedback.jsonl; scratch /var/folders/lc/1n1k0ggd2qn4p8lhmc0wp90m0000gn/T/us070-doc-delivery-tyyhue1c.
- python3 /Users/fcolomas/Projects/nous/Nous/System/nous_package.py sync --target /var/folders/lc/1n1k0ggd2qn4p8lhmc0wp90m0000gn/T/us070-doc-delivery-tyyhue1c --project fcostudios__smp --no-pull -c agent_files sprint_plan (exit 0; critical-path-generation.log).
- Same final generation with --no-drift (exit 0; critical-path-generation-final.log). --no-pull prevents feedback ingestion. Initial normal sync persisted standard drift row for 2026-W41, 574 issue counters; final skips repeated unrelated BI snapshot.

AGENTS.md refused because existing body differs from emission trailer. No force/adopt used; unrelated AGENTS untouched. Both requested guides independently generated successfully and validated with official package_templates.provenance.provenance_state == verified plus SHA256 matching generator manifest. An initial manual validation omitted generator rstrip canonicalization and failed before copying any files; replaced with official verifier.

Bounded delivery replaces only two .nous-sync.json file entries verbatim; retains unrelated entries and global synced_at. Copied clean generator .nous-provenance.json, substrate git_sha 0b48fe959bed. Other outputs remain scratch-only. No production/tests, feedback, drafts or unrelated specs changed.

Hashes:
- docs/dev-guide/TESTING.md: full SHA256 da7fd0cf7b126980d264aa7f50faa38933cabb96281d1a9e42314242397a8cb1, emitted body 4f62138bd6f1b734
- testing/critical-paths.md: full SHA256 640c1277de30c2dc105ca2c6e645b8fa2765629ce672aeeaa0ce1d0f64e4af4d, emitted body 30e8200677b99f92

Validation: config preservation, matching generated row, official provenance and manifest hashes passed; git diff --check and scoped review before commit. No application gates or mutation campaign for docs-only delivery.
