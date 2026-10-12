**Work item:** CHG-090
**Readiness assessment:** docs/readiness/CHG-090.json
**Approved estimate:** 60 minutes

# CHG-090 guidance-pin implementation plan

Goal: accept only the exact reviewed canonical guidance through both actual immutable chains.
Spec: docs/superpowers/specs/2026-10-12-CHG-090-guidance-pin.md. Prior committed readinessbb6b0e2/digest48641cc87d4a039bd273ea320a3d88452f92dd38095cd6278250639699a7999f validates ready. Standing operator authority covers design and native execution; no repeated approval required.

## Task1 — exact immutable registration and rejection oracle

Files: create infra/scripts/overrides/CHG-090/8a5c4fb/{manifest.json,CLAUDE.md,docs/dev-guide/DEFINITION_OF_DONE.md}; modify infra/scripts/reconcile-sprint1-docs.py and infra/scripts/tests/test_reconcile_sprint1_docs.py.
Interfaces: existing load_layered_overrides() validates declared closed dictionaries and manifest paths/hashes; latest_desired_guide() and copy_reconciler_data() use real artifacts for subprocess tests.

- [ ] Add focused test_chg090_manifest_binds_actual_chains_and_rejects_tampering asserting exactly two target paths and full source/desired hashes in the spec. Run the selected unittest and capture expected RED missing immutable layer before production edits.
- [ ] Copy full8a5c4fb Git bytes; manifest sources both CHG065/7817e94, separately verified hashes from design. Append closed CHG090_PATHS and one layer registration. Extend fixture/latest helper following existing085 pattern.
- [ ] Assert real predecessor reconciliation yields exact desired bytes and --check is idempotent; reject one-byte live changes, missing/corrupt desired/source, wrong path/hash/extra manifest entries without project writes. Run focused test, full Python reconciler suite and generated-guidance check; commit source checkpoint with normal hooks.

## Task2 — independently reviewed consumer literal

File: scripts/work-readiness/git.mjs only literal REVIEWED_RECONCILER_SHA256 and provenancecomment. Existing test-work-readiness.mjs remains unchanged.

- [ ] Independent scoped reviewer reads complete reconciler delta from reviewedbfabaa bytes plus both fullchains/manifest and focused tests. No digest update until review explicitlyGREEN.
- [ ] Compute full reconcilerSHA256 only after review; set literal/comment to that reviewed identity. Run full Node readiness contracts proving exactfullbytes accepted and modifiedbytes failclosed; ownreadiness/range checksGREEN.
- [ ] Fresh adversarial reviewer verifies AC1–5 with concrete negatives and immutable live guides/mirrors/US087 history. Hand root bothtechnicalreview/guidanceGREEN before global/stockgate.

## Task3 — coordinated integration and truthful closure

- [ ] Root owns coordinated awake pnpmcheck stock sharedPG fixture under exclusive ownedtoken/device/inode lock after bothtechnicalreviews. Record actualfullgate results; global pendingUS087 is only resolved under separate authorized assessment, never silentlyignored.
- [ ] Run native scopedpreflight/campaign againstCHG090authoritybase568891c. If no eligible sources report0sources/0shards, no mutation score/test_report. No rerun ofUS086campaign, no sharedcachedeletion.
- [ ] Record finalphaseactuals, estimatevariance, evidence/cost provenance and five canonical verifiedACs appendonly; doneonlyafter gates. Rootcoordinatesledgerwrites; preserve foreignreports/locks and blockedoriginalUS087a587591.

Review focus: exact pathsourcechain; unrecognized bytes; manifest/source/desired tamper; missing/wrongpredecessor; consumer rawbyte tamper. All tests use realfilesystem/subprocess and assert no project writes. No product/model/lifecycle behavior changes; CHG089owns its own paths and correction.

Canonical coverage repair: all five canonical criteria map to O1; current digest 268d716e337d577c914ae460dd45a41bed5195307de6b59a32160b06a199ae24 is approved under standing authority. Earlier digest 48641cc87d4a039bd273ea320a3d88452f92dd38095cd6278250639699a7999f authorized original start/source and remains recorded. AC4 owns truthful global/focused/stock awake gate evidence; AC5 owns actual effort and cost reassessment. Scope six delivery paths, budget60minutes unchanged.
