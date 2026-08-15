**Work item:** CHG-026
**Readiness assessment:** docs/readiness/CHG-026.json
**Approved estimate:** 35 minutes

# CHG-026 — Commit the measured Stryker sandbox exclusions

## Problem

Stryker does not read `.gitignore`. `stryker.conf.json` carried a single
`ignorePatterns` entry, `".tmp/**"`, so every campaign startup copied and
preprocessed generated and cached trees into its sandbox — including 4,513
`.turbo` build-cache files and 57 generated screen HTML files.

The measured consequence per Stryker startup on the main checkout:

| Metric | Before | After |
| --- | ---: | ---: |
| `Found 1 of N file(s)` | 5,702 | 1,132 |
| `DisableTypeChecksPreprocessor` warnings | 29 | 0 |
| Mutation score | 100.00% | 100.00% |

Both counts were byte-identical across four runs per arm — deterministic, not
noisy. Full method, decomposition and limits:
`docs/benchmarks/stryker-sandbox-exclusions.md`.

## Scope note — what this does *not* include

The working tree also carries an unrelated edit to `scripts/mutation-scope.mjs`
(an IMP-360 / L3 change separating "base config missing" from "base config
unreadable" in the failure message). No acceptance criterion here covers it and
it is not required for the exclusions to work. It is **excluded** from this
change and needs its own work item rather than riding an approved ID.

That reduces the expected changed file count from 2 to 1 against the readiness
signal. Fewer files than estimated is not a limit breach; it is recorded here
and in the completion actuals.

## Honest limits on the claim

- The 80% file-count reduction **must not** be restated as a time saving. Cold
  campaign wall time is dominated by mutant execution, not sandbox setup; the
  measured effect is roughly **4–6%** of a full cold campaign.
- The `ignorePatterns` array holds **seven** entries, six of them new. `.tmp`
  was already present in the older `.tmp/**` form.
- `.vercel`, `out` and `docs/mocks` are absent from this checkout and
  `.worktrees` is empty, so they contribute nothing today. They are retained as
  forward guards; the entire measured delta comes from `.turbo` and
  `docs/screens`.
- The 29 → 0 figure is **per Stryker startup**, not a campaign aggregate.

## Acceptance criteria

- **AC1** — `stryker.conf.json` carries the seven-entry `ignorePatterns` set.
- **AC2** — A cold single-shard run reports 0 `DisableTypeChecksPreprocessor`
  warnings, against the measured 29.
- **AC3** — Mutation score is unchanged at 100.00% for the measured shard, and
  no previously passing test fails.

## Verification

- `node scripts/test-mutation-scope.mjs` — generated shard configs inherit the
  base `ignorePatterns`
- Cold single-shard run on `packages/domain/src/alerts/approval-aging.ts`,
  counting preprocessor warnings and the reported score
- `pnpm readiness:check:all`

## Risks

An exclusion could remove a fixture some test resolves at runtime. The measured
guard was explicit: no source or test resolves `docs/screens` or `docs/mocks`,
and `docs/specs` — which three route/sidebar tests do resolve — is deliberately
not in the exclusion set.
