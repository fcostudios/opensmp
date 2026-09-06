# CHG-044 — Re-pin `testing/critical-paths.md` after CHG-040 widens the critical set

## Outcome

The reconciler accepts the 2026-09-05 Substrate output for
`testing/critical-paths.md`, which now carries twelve critical business rules
instead of nine. BR-08 (approval aging), BR-11 (low-pool alerting), and BR-14
(same-business-day deprovisioning) return to the effectiveness-critical set,
each with the governing stories the graph carries.

## Constraints

- Add a new immutable CHG-044 migration layer; do not rewrite the CHG-004,
  CHG-022, or CHG-042 artifacts.
- Bind the source and desired artifact with SHA-256. Source is CHG-042's
  desired state (`e765dfe6…`); desired is the regenerated file (`2a3c8977…`).
- Preserve `testing/critical-paths.md` exactly as generated. If the content is
  wrong the fix goes back to `09b_business_rules` via CHG-040, never into the
  file.
- `docs/stories/CHANGES.md` is section-pinned on the `### CHG-001:` heading, so
  CHG-040's status rows there need no pin.

## Deviation from the filed acceptance criterion

CHG-044 as filed required that "`git diff` of the pin commit touches only the
reconcile script." That is not achievable with this mechanism.
`load_layered_overrides` resolves each layer's desired artifact through
`contained_manifest_path(override_root, relative_path, …)`, so a new layer must
ship its own artifact **and** its `manifest.json` under
`infra/scripts/overrides/CHG-044/2d93300/` — exactly as CHG-042 did in
`ad2af90`. The test harness pins the newest layer too
(`latest_desired_guide`, `copy_reconciler_data`), so it moves with it. The
filed criterion was written without reading the mechanism; the diff is scoped
to the pin, which is what the criterion was reaching for.

## Acceptance criteria

1. Both CHG-042's reviewed artifact and the 2026-09-05 artifact converge to the
   new pinned desired state; unknown hashes continue to fail closed.
2. `pnpm check:generated-guidance` exits zero.
3. `infra/scripts/tests/test_reconcile_sprint1_docs.py` passes at the same
   count as before the layer (41 passed, 35 subtests).
4. `testing/critical-paths.md` lists BR-08, BR-11, and BR-14 with their
   governing stories — US-015/017/032/046, US-022/052/053, US-024/042.
