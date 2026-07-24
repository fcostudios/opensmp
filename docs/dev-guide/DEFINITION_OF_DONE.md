# Definition of Done — Build Verification Gate

A story is NOT done until the build passes — self-reported "tests pass" is not
sufficient. See `CLAUDE.md` for the summary; this is the authoritative gate.

## Before Marking Any Story as `done`

1. **Types pass:**
   ```bash
   pnpm type-check          # tsc --noEmit, zero errors
   ```

2. **Lint passes** (Next.js lint + the design-system token lints):
   ```bash
   pnpm lint
   ```

3. **Build succeeds:**
   ```bash
   pnpm build               # next build --webpack (production / PWA bundler)
   ```

4. **Tests pass** (Vitest across the workspace; effectiveness bar per
   `TESTING.md` §4 — coverage is a diagnostic, never a completion target):
   ```bash
   pnpm test
   ```

5. **Schema applies on a fresh database (and is verified):**
   - **Prerequisite:** `DATABASE_URL` must be set to a reachable Postgres before this
     step — copy `.env.example` → `.env` and set it (or run `task setup`). The bare
     `push` below silently no-ops against an unset/unreachable URL.
   ```bash
   cd packages/db && pnpm drizzle-kit push && node scripts/verify-schema.mjs
   ```
   - `drizzle-kit push` exits **0 even on an unreachable `DATABASE_URL`** (a silent
     no-op: 0 tables). `verify-schema.mjs` counts the applied tables and exits
     non-zero on 0 — so "schema applies cleanly" can no longer be a false pass.
   - The DB client auto-selects its driver by `DATABASE_URL` (`pg` for a local/
     standard Postgres URL, `neon-http` for a Neon URL), so `push` applies locally.
   - Migrations live in `packages/db/src/migrations/` as `V<timestamp>__<slug>.sql`.
   - Once applied, a migration file is immutable — add a new one; never edit it.
   - Every Drizzle column has a corresponding migration column.
   - The release path applies committed migrations using the `ledger_owner`
     connection. It then starts the application using the lower-privilege
     `ledger_app` connection; application runtime must not use the owner role.

6. **Authentication evidence passes for US-004:**
   - Auth.js redirects OIDC to Keycloak; Ledger renders no password or TOTP
     fields.
   - Keycloak realm event retention is configured, and an integration or
     operational verification proves an authorized operator can query retained
     password/TOTP failure events.
   - Ledger `AuditLog` contains only the OIDC/session linking, callback, and
     authorization outcomes Ledger observes; no Keycloak-event ingestion
     adapter is required in Sprint 1.
   - The Keycloak admin-service seam is tested for `platform-admin`
     synchronization; the complete user-management UI remains US-011.

7. **R1 deployment target is verified for release/infrastructure stories:**
   Docker Compose on a VPS (or an equivalent CI Compose environment) starts
   the Next.js app and declared infrastructure services with health checks
   passing.

8. **Report evidence** in `.nous-feedback.jsonl`:
   ```jsonl
   {"story":"US-XXX","event":"build_pass","notes":"type-check + lint + build + test green"}
   {"story":"US-XXX","event":"done"}
   ```

9. **Adversarial AC verification** — see
   [`FEEDBACK.md`](FEEDBACK.md) (AC Verification Protocol).

## Story Rejection Criteria

A story is REJECTED during sprint acceptance if any of these hold:
- `pnpm type-check`, `pnpm lint`, `pnpm build`, or `pnpm test` fails.
- A migration file was edited instead of adding a new one.
- Release migrations ran as `ledger_app`, or the deployed app runs as
  `ledger_owner`.
- A Sprint 1 deployment assumes a managed hosting target instead of the
  Docker Compose/VPS contract.
- US-004 lacks operator-queryable retained Keycloak password/TOTP failure
  evidence.
- No `build_pass` event in `.nous-feedback.jsonl`.
- An AC was marked pass with no `ac_verify` adversarial check logged.
- Commit lacks a `US-NNN` / `CHG-NNN` reference (enforced by `.githooks/commit-msg`).
