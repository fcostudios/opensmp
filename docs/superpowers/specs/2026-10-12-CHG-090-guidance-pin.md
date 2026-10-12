# CHG-090 — immutable canonical guidance pins

Canonical authority: Nous7e239ee CHG-090_TECH_SPEC.md, operator request dbf03c249f9f04ee83968d4bf87450c26acb0887. Standing approval covers this assessed60-minute, six-delivery/four-bookkeeping implementation; readiness48641cc87d4a039bd273ea320a3d88452f92dd38095cd6278250639699a7999f committedbb6b0e2 validates ready before this design.

## Design

Preserve exact delivered8a5c4fb1cc3c44a879b818368dbf9941570c9c3f full Git bytes. Create only infra/scripts/overrides/CHG-090/8a5c4fb/manifest.json and two guide artifacts. Append CHG090_PATHS and one LAYERED_OVERRIDE_SPECS registration to the existing reconciler. Manifest version1 binds separately inspected predecessor paths and source/desired hashes. No loader, parser, mutation runner, threshold, product or generated-body changes.

The actual loader validates all existing manifests and immutable artifacts. Each target resolves to CHG-065/7817e94, with different earlier chains. Desired CLAUDE05722c7d8351bffcf1f17fa1ab7d62411dbf12f5ce1759fde8f3ba26396cc685; desired DoD2d683a7b4161cdb07838b5fe3fbddff4bd4a1221ce7b8e026bdfddd39c25e392. Live files equal delivery, all three mirrors equal delivered CLAUDE body. Baseline --check . exits1 on precisely those two unknown hashes; no generated writes.

## Complete inspected chains

### CLAUDE.md

- `CHG-001/825e882` desired `bf6182a5c7ef8b51158181b8de3f91eda8e4107e1dbfa1b4adee230be4a66ea6`; source `tests/fixtures/825e882/CLAUDE.md` hash `efdbf2e5161bfe56f865bbeb812fd5e7f8019c81528f74c098198530582e2145`.
- `CHG-022/16f72c9` desired `9c3afc5674204928660976df3181c28c241d1add69167077d484a229500d5b5e`; source `overrides/CHG-001/825e882/CLAUDE.md` hash `bf6182a5c7ef8b51158181b8de3f91eda8e4107e1dbfa1b4adee230be4a66ea6`.
- `CHG-042/fd7741f` desired `9cba977d283301e1b925035b9c62ee5b64ee860fb8b049adc3b075f1f3a09283`; source `overrides/CHG-022/16f72c9/CLAUDE.md` hash `9c3afc5674204928660976df3181c28c241d1add69167077d484a229500d5b5e`.
- `CHG-049/6466f60` desired `3f0905a05225b595636b0369b297c88176f764377da8543ed428df47d6f164d3`; source `overrides/CHG-042/fd7741f/CLAUDE.md` hash `9cba977d283301e1b925035b9c62ee5b64ee860fb8b049adc3b075f1f3a09283`.
- `CHG-053/2dee869` desired `32f30b52af12a1591e0ec0507ab7f332b5d092a45b25fb0acdba08e6b6aed94f`; source `overrides/CHG-049/6466f60/CLAUDE.md` hash `3f0905a05225b595636b0369b297c88176f764377da8543ed428df47d6f164d3`.
- `CHG-065/7817e94` desired `ea24b7b9af19f4a050d2dce58d2095a48e0ec96369290455504c50f8f91ce40e`; source `overrides/CHG-053/2dee869/CLAUDE.md` hash `32f30b52af12a1591e0ec0507ab7f332b5d092a45b25fb0acdba08e6b6aed94f`.
### docs/dev-guide/DEFINITION_OF_DONE.md

- `CHG-001/825e882` desired `b96bf4aaf1a2e7f6a22c1342eba1854b29170060d895e07eb8d9ea4f07fcf473`; source `tests/fixtures/825e882/docs/dev-guide/DEFINITION_OF_DONE.md` hash `c061aeeb58cc4fd07c9a1037f752c590a647398f07d2e2709ebccf26b58acde8`.
- `CHG-022/16f72c9` desired `bd6de13018729de07323b7dc426fb69e57f060f04db9fea0d9ecc5fc997056e9`; source `overrides/CHG-001/825e882/docs/dev-guide/DEFINITION_OF_DONE.md` hash `b96bf4aaf1a2e7f6a22c1342eba1854b29170060d895e07eb8d9ea4f07fcf473`.
- `CHG-042/fd7741f` desired `bb19763d0e8ca8640635d0c8c4c11f16fa9938ed92984269f5d81826cfa92ce4`; source `overrides/CHG-022/16f72c9/docs/dev-guide/DEFINITION_OF_DONE.md` hash `bd6de13018729de07323b7dc426fb69e57f060f04db9fea0d9ecc5fc997056e9`.
- `CHG-049/6466f60` desired `ae0060ef2adfe269aec8bda3e14f79b4f14db0243a99b39ab91ed5bf161f4560`; source `overrides/CHG-042/fd7741f/docs/dev-guide/DEFINITION_OF_DONE.md` hash `bb19763d0e8ca8640635d0c8c4c11f16fa9938ed92984269f5d81826cfa92ce4`.
- `CHG-055/e240d85` desired `b12b953006b2c2fe0d7bad74fed0dca8451024e6c66060b1828cae195ade041e`; source `overrides/CHG-049/6466f60/docs/dev-guide/DEFINITION_OF_DONE.md` hash `ae0060ef2adfe269aec8bda3e14f79b4f14db0243a99b39ab91ed5bf161f4560`.
- `CHG-065/7817e94` desired `a0b4aff2d0baa8dfad6557ee51d547de4f94e037729b1d9dbc3c70a225725429`; source `overrides/CHG-055/e240d85/docs/dev-guide/DEFINITION_OF_DONE.md` hash `b12b953006b2c2fe0d7bad74fed0dca8451024e6c66060b1828cae195ade041e`.

## Review and evidence

Update the focused Python harness latest-guide/fixture helpers for this exact closed layer, then assert the exact manifest, predecessor transitions, idempotent accepted bytes, one-byte/unknown live rejection, missing/corrupt desired and predecessor artifacts, wrong predecessor path and tampered manifest, all without project writes on failures. Real subprocess and temporary filesystem fixtures, no owned-code mocks. New test must fail before layer registration and kill omission/misregistration of this exact acceptance. Existing general rejection/transaction tests retain their strongest assertions.

Independent scoped review reconstructs both full chains and verifies the complete reconciler delta against bfabaa0889027126dbb4721879285b40ff3b5da15cc752aa6c51cd60c36248ef reviewedbytes. Only after approval update scripts/work-readiness/git.mjs literal/provenance to the reviewed full-file hash; existing Node harness must prove exact acceptance and tampered-byte rejection. A computed digest alone is insufficient authority.

Run generated-guidance, full focused reconciler and Node readiness contracts, CHG090 readiness and range check. Global check-all currently fails pendingUS087 approval; preserve blocked artifacta587591. Root refreshes that readiness under separate standing authority only after both CHG089/090 source/review/guidanceGREEN, then root owns one coordinated stock-fixture awake gate under ownedtoken/inode lock. Native own-scope zero-source preflight/campaign, no US086 effectiveness-score borrowing or40.9258-minute campaign repeat. Retain reports/ and foreign lock. Record final actuals, five canonical AC adversarial results, truthful build/cost provenance and done only after all gates.

Canonical coverage repair: all five canonical criteria map to O1; current digest 268d716e337d577c914ae460dd45a41bed5195307de6b59a32160b06a199ae24 is approved under standing authority. Earlier digest 48641cc87d4a039bd273ea320a3d88452f92dd38095cd6278250639699a7999f authorized original start/source and remains recorded. AC4 owns truthful global/focused/stock awake gate evidence; AC5 owns actual effort and cost reassessment. Scope six delivery paths, budget60minutes unchanged.
