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
   pnpm build               # next build --webpack (serverless / PWA bundler)
   ```

4. **Schema applies on a fresh database (and is verified):**
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

5. **Report evidence** in `.nous-feedback.jsonl`:
   ```jsonl
   {"story":"US-XXX","event":"build_pass","notes":"type-check + lint + build green"}
   {"story":"US-XXX","event":"done"}
   ```

6. **Adversarial AC verification** — see
   [`FEEDBACK.md`](FEEDBACK.md) (AC Verification Protocol).

## Story Rejection Criteria

A story is REJECTED during sprint acceptance if any of these hold:
- `pnpm type-check`, `pnpm lint`, or `pnpm build` fails.
- A migration file was edited instead of adding a new one.
- No `build_pass` event in `.nous-feedback.jsonl`.
- An AC was marked pass with no `ac_verify` adversarial check logged.
- Commit lacks a `US-NNN` / `CHG-NNN` reference (enforced by `.githooks/commit-msg`).
