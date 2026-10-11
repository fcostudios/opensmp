**Work item:** CHG-080
**Readiness assessment:** docs/readiness/CHG-080.json
**Approved estimate:** 30 minutes

# Canonical guidance pin implementation plan

**Goal:** Accept exact d9d5d48 canonical guidance through one immutable registered override.
**Architecture:** Reuse CHG-044/079 registration and real-file fixture seams; preserve the loader and generated files.
**Spec:** docs/superpowers/specs/2026-10-11-chg-080-guidance-pin-design.md

## Global constraints

Nine inclusive paths and all hashes/source ancestry are fixed by the approved readiness and design. One bounded implementer; one scoped reviewer reused for design/plan and final review; fresh AC verifier last. No private PostgreSQL, baseline fixture repairs, loader changes or new IDs. Record phase timestamps and accountable closure costs. Shared full gate uses exclusive creation, owner/inode cleanup and foreign-owner waits of at least 60 seconds.

## Review focus

Exact source/desired manifest hashes; preserved generated/prior-layer bytes; missing/corrupt artifacts; unknown live bytes without writes; fixture latest-layer resolution. Existing negative fixture cases must exercise these without code-owned mocks or coverage-only tests.

### Task 1: Register both immutable published guidance artifacts

**Files:** Create the manifest and two copied artifacts under `infra/scripts/overrides/CHG-080/d9d5d48`; modify `infra/scripts/reconcile-sprint1-docs.py` and `infra/scripts/tests/test_reconcile_sprint1_docs.py`.
**Interfaces:** Consumes existing version-1 manifests, path maps, `LAYERED_OVERRIDE_SPECS`, `latest_desired_guide` and `copy_reconciler_data`; produces one latest registered layer with unchanged loader semantics.

- [ ] Read TESTING.md before modifying the fixture test; follow CHG-079 exact-manifest assertion and existing negative cases. Add the two-path CHG-080 manifest expectation, preserving both exact sources and desired hashes from the design.
- [ ] Observe the new-layer fixture expectation fails before registration. Copy the published files byte-for-byte, author their exact manifest, append the existing-style registration and update fixture layer copying/latest resolution.
- [ ] Run `pnpm check:generated-guidance` and `python3 -m unittest discover -s infra/scripts/tests -p test_reconcile_sprint1_docs.py`; both must pass. Confirm generated hashes and prior layers unchanged; unknown/corrupt bytes still reject without writes. Commit only the five implementation paths using CHG-080 and normal hooks.
- [ ] Hand the full bounded diff to the scoped reviewer, fix only justified in-scope findings, then run fresh adversarial AC verification.

### Task 2: Verify and close the approved technical prerequisite

**Files:** Update only readiness actuals and append-only feedback bookkeeping.
**Interfaces:** Consumes Task 1 reviewed commit and independent AC verdicts; produces scoped eligibility, gate evidence and terminal cost accounting.

- [ ] Freeze the task base before Task 1; run final diff-scoped mutation eligibility/campaign after review, retaining observed zero-mutatable output without a fabricated score. Re-run touched scope only for actual fixes.
- [ ] Coordinate one `caffeinate -i env MUTATION_BASE=1c7acf8d96fd6cdef65d067b37d49f7acebed89d pnpm check` with CHG-079 under `/tmp/smp-full-gate.lock`; record exact candidate and log. Named baseline failures remain outside scope and prevent a false done.
- [ ] Check the item range, record exact changed-file count, phase actuals, review loops, preview/campaign evidence and measured/estimated cost provenance. Append `build_pass` and `done.cost` only when the required gate and ACs pass. Commit closure under normal hooks; report a gate blocker instead of claiming completion if required evidence remains red.
