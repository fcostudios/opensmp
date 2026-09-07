# CHG-055 Authorization Guidance Refresh Registration Design

## Context and outcome

The 2026-09-07 PM substrate refresh after IMP-397 and IMP-399 delivered five paths: `docs/dev-guide/DEFINITION_OF_DONE.md`, `docs/dev-guide/SECURITY.md`, `docs/dev-guide/STANDARDS.md`, `docs/dev-guide/local/SECURITY.md`, and `docs/dev-guide/local/STANDARDS.md`. The first three are substrate-emitted; the latter two are the tenant-owned sources for future project additions. `AGENTS.md` remains intentionally frozen.

CHG-055 carries those exact bytes and appends one immutable reconciler layer for the three emitted states. It changes no application authorization behavior, schema, route, story, or migration.

## Immutable transition

Add `infra/scripts/overrides/CHG-055/e240d85/` after CHG-053. Its version-1 manifest contains exactly these transitions from the final current CHG-049 artifacts:

- `docs/dev-guide/DEFINITION_OF_DONE.md`: `ae0060ef2adfe269aec8bda3e14f79b4f14db0243a99b39ab91ed5bf161f4560` to `b12b953006b2c2fe0d7bad74fed0dca8451024e6c66060b1828cae195ade041e`.
- `docs/dev-guide/SECURITY.md`: `022d772834a4b78de32e5eb2baee1701878bd84d18c85564703505c0c7e3e694` to `0806022c650afcea0329c2b0380c60d12048fd35dbcb19a04df096b568999b37`.
- `docs/dev-guide/STANDARDS.md`: `3347158c79e0032db6a878b9ef92a4ba6d26d783e64f2fe463e486869a066a22` to `93460713aad5ccb32cc3fe1981d017165d7e1ff7caef90659bf4a79d3810f7ca`.

The desired files are byte-for-byte copies of the delivered emitted files. `CHG055_PATHS` uses literal source paths and `("CHG-055/e240d85", CHG055_PATHS)` is appended after CHG-053. Historical layers are not modified.

## Guidance ownership

The emitted SECURITY and STANDARDS documents describe database-resolved authorization through `loadLedgerAuthorization`, `UserAccount`, and `CompanyRoleAssignment`, never client-supplied claims. Tenant additions stay in the matching `docs/dev-guide/local/*.md` files. The overlay recognizes delivery bytes; it does not make emitted files tenant-editable.

## Verification

Focused red/green tests prove exact manifest keys, source and desired hashes, final-layer order, current-tree byte stability, and fail-closed rejection of unknown or tampered states. The reconciler's final raw bytes are re-pinned in `REVIEWED_RECONCILER_SHA256`. `pnpm run check:generated-guidance`, `pnpm lint`, `pnpm check`, and CHG-055 readiness must pass before one cache-cleared diff-scoped mutation campaign runs last.

## Scope

The implementation census is twelve paths: five delivered files; three desired artifacts and one manifest; the reconciler; its focused tests; and the readiness hash pin. Readiness, design, plan, and append-only lifecycle evidence are governance artifacts outside that census.
