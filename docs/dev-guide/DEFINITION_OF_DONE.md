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

4. **Tests pass** (Vitest across the workspace — coverage is a diagnostic,
   never a completion target). This is the functional suite, not a gate on its
   quality; that gate is step 8 and it runs after review:
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

6. **Report build evidence** in `.nous-feedback.jsonl`. This attests the build —
   it does NOT close the story:
   ```jsonl
   {"story":"US-XXX","event":"build_pass","notes":"type-check + lint + build + test green"}
   ```

7. **Adversarial AC verification — MANDATORY, and it comes BEFORE `done`.**
   Re-read the story file, then try to BREAK each AC; log one `ac_verify` per AC.
   Full protocol: [`FEEDBACK.md`](FEEDBACK.md) (AC Verification Protocol).
   ```jsonl
   {"story":"US-XXX","event":"ac_verify","ac":1,"method":"route check","pass":true,"notes":"empty state renders"}
   ```
   If any `ac_verify` fails, fix it and re-verify. Do not proceed to step 8.

8. **Effectiveness gate — ONE cold mutation campaign, and it runs LAST.** The bar
   is [`TESTING.md`](TESTING.md) §4. `pnpm test:mutation` is the authoritative
   campaign: it scopes to this branch's diff and runs ONE campaign, so it is the
   whole gate, not a sample of it.
   ```bash
   pnpm test:mutation
   ```
   **Any commit after the campaign invalidates it — do not run it until review is
   closed.** Every fix step 7 produces changes the diff the campaign scored, so a
   campaign run before review has to be run again. Run a whole-critical-set campaign
   only if the critical set in [`TESTING.md`](TESTING.md) §3 itself changed, and only
   if this package defines one — the diff-scoped run is the gate.
   Report the result (payload contract in [`FEEDBACK.md`](FEEDBACK.md)):
   ```jsonl
   {"story":"US-XXX","event":"test_report","mutation_score":84.2,"scope":"diff","killed":32,"survived":6,"surviving_annotated":[],"mutation_wallclock_s":720}
   ```

9. **Report terminal evidence** — only once every AC has a passing `ac_verify`
   and the campaign above has been reported:
   ```jsonl
   {"story":"US-XXX","event":"done","ts":"2026-04-02T21:30:00Z"}
   ```

## Story Rejection Criteria

A story is REJECTED during sprint acceptance if any of these hold:
- `pnpm type-check`, `pnpm lint`, `pnpm build`, or `pnpm test` fails.
- A migration file was edited instead of adding a new one.
- No `build_pass` event in `.nous-feedback.jsonl`.
- An AC was marked pass with no `ac_verify` adversarial check logged.
- Commit lacks a `US-NNN` / `CHG-NNN` reference (enforced by `.githooks/commit-msg`).
<!-- nous-emitted: sha256=ace678a0de5927bc -->
