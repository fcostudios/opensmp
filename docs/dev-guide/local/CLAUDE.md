## Work Readiness Gate

Before writing a design, implementation plan, production code, test, migration,
or executable tooling for any US-* or CHG-*, run its approved readiness
assessment. A work item above 320 minutes or any cohesion limit is not
execution-ready; partition it into official, approved vertical children first.

Run `pnpm readiness:check -- <WORK-ID>`. The complete mandatory contract is in
[`docs/dev-guide/WORK_READINESS.md`](docs/dev-guide/WORK_READINESS.md).

## Verification cost (CHG-065)

Full text: `WORK_READINESS.md` §Per-task mutation previews, §Session shape and
§Closure template.

- **Re-preview only touched shards.** After a fix round, preview only the
  shards whose preflight `sources` intersect the files changed since the
  previous preview. A whole-set re-preview needs a named reason in the closure.
  Record `preview_rounds` and `preview_minutes` in `actuals`.
- **Preview budget (CHG-069).** One round per implementation task plus one
  after the final fix wave, at most 30 `preview_minutes` per child; more rounds
  or minutes need a named `root_cause` reason. A shard whose last run exceeded
  5 minutes is previewed once, in the final round, unless a fix touched its
  sources. A survivor found by a preview joins the next fix round. A
  `routing_gaps` entry from preflight means that shard's score is not evidence.
- **One line per survivor.** `surviving_annotated` holds
  `<mutant-id> <file>:<line> @equivalent: <reason>` (or `@accepted: <reason>`
  when the reviewer agrees an observable mutant is not worth a test). The
  reviewer's verdict is the sign-off; no signed equivalence report and no
  counterfactual log. A killed survivor is
  proven by the test that kills it.
- **One controller session per work item**, opened at readiness and closed at
  `done` (a checkpoint or idle restart resumes the same item). The controller briefs a reviewer for adversarial AC verification and
  scoped review instead of running them in its own context. Wait for
  background gates and campaigns with a blocking wait or a yield of 60 s or
  more, never a 1 s poll. Launch a preview round in the background, start the
  next task, and collect it at that task's review boundary.
- **Host awake during gates.** Run local gates as `caffeinate -i pnpm check`
  (Linux: `systemd-inhibit --what=idle:sleep pnpm check`); record any gate run
  above 2x the median wall time with its cause in `root_cause`.
- **`cost` on every `done`**: `calls`, `context_tokens`, `output_tokens`,
  `model`, `window`. `done` accepts no other key, so the sentence saying whether
  the numbers are measured or estimated goes in a `feedback` annotation emitted
  just before `done`.

## Sprint 1 Execution Contract (DEC-SMP-017 / CHG-001)

- `Company` is the Ledger application-tenant boundary. Every company-scoped
  query filters the real `company_id` column declared by its table.
- `VendorAccount` is a vendor organization/account, not a Ledger application
  tenant or authorization boundary.
- Auth.js obtains identity from Keycloak. Ledger obtains authorization from
  `UserAccount` and `CompanyRoleAssignment` in its own database.
- Keycloak renders and verifies OIDC passwords and TOTP challenges. Ledger
  redirects to Keycloak and never renders or collects those credentials.
- Retained, operator-queryable Keycloak security events are US-004 evidence for
  password/TOTP failures. Ledger `AuditLog` records successful OIDC/session
  linking plus callback and authorization failures that Ledger observes.
- US-004 establishes and tests the Keycloak admin-service seam required for
  admin-group synchronization. The complete user-management UI remains US-011.
- Releases apply committed migrations as `ledger_owner`; the application runs
  as `ledger_app`.
- Docker Compose on a VPS is the R1 deployment target.

## Build, bundler and tenant-isolation facts (tenant-authored; carried from CLAUDE.md on 2026-09-07)

### Bundler

- **Bundler: webpack** — `scripts.build` runs `next build --webpack` (Serwist injects a webpack config; Turbopack would hard-fail). Module imports MUST include file extensions for non-TS files (e.g., `import preset from './tailwind-preset.js'`).

### Tenant isolation

- **Tenant isolation:** every company-scoped query filters by the real
  `company_id` column. Confirm the column in `packages/db/src/schema.ts`;
  `VendorAccount` references do not define Ledger tenant scope.

### Build verification gate (tenant additions)

- `pnpm build` succeeds — runs `next build --webpack` (the production/PWA bundler).
- `pnpm test` passes — Vitest across the workspace. Tests must meet the effectiveness bar in [`docs/dev-guide/TESTING.md`](docs/dev-guide/TESTING.md) §4 (real-DB seam tests via the pglite fixture, strongest available oracle; coverage is a diagnostic, never a completion target — TE-1 / R1).
- Committed migrations apply to a fresh database as `ledger_owner`, then
  `node packages/db/scripts/verify-schema.mjs` verifies the result. Application
  runtime checks use `ledger_app`; no duplicate timestamp migrations exist
  under `packages/db/src/migrations/`.
- Report evidence: `{"story":"US-XXX","event":"build_pass",...}` then `{"event":"done",...}`.
