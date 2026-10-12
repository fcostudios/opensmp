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

5. **The COMMITTED migrations apply on a fresh database (and the result is verified):**
   - **Prerequisite:** `DATABASE_URL` must be set to a reachable Postgres before this
     step — copy `.env.example` → `.env` and set it (or run `task setup`). Set
     `DATABASE_ADMIN_URL` instead when applying DDL needs a more privileged role.
   ```bash
   cd packages/db && node scripts/apply-migrations.mjs && node scripts/verify-schema.mjs
   ```
   - `drizzle-kit push` is NOT the gate: it diffs only what `schema.ts` can model, while the committed migrations also carry RLS policies, triggers and composite tenant-scoped foreign keys — so push proposes DROPPING them and can hard-fail. Use `drizzle-kit generate` to AUTHOR a migration and the committed-migration applier (`db:migrate`) to PROVE the committed set applies.
   - The applier records each migration's SHA-256 in a `schema_migrations` ledger under
     a Postgres advisory lock, and refuses to continue if an already-applied migration's
     bytes changed or the applied history is no longer a prefix of the committed set —
     so an edited migration is caught instead of silently diverging.
   - `verify-schema.mjs` then counts the applied tables and exits non-zero on 0, so
     "schema applies cleanly" can no longer be a false pass against an unreachable URL.
   - The DB client auto-selects its driver by `DATABASE_URL` (`pg` for a local/
     standard Postgres URL, `neon-http` for a Neon URL).
   - Migrations live in `packages/db/src/migrations/` as `V<timestamp>__<slug>.sql`.
   - Once applied, a migration file is immutable — add a new one; never edit it.
     The checksum ledger above is what makes that rule enforceable rather than advisory.
   - Every Drizzle column has a corresponding migration column.

6. **Report build evidence** in `.nous-feedback.jsonl`. This attests the build —
   it does NOT close the story:
   ```jsonl
   {"story":"US-XXX","event":"build_pass","notes":"type-check + lint + build + test green"}
   ```

7. **Adversarial AC verification — MANDATORY, and it comes BEFORE `done`.**
   **Mark the phase first** — before the first AC check (it covers every fix and re-verify loop below), append `{"story":"US-XXX","event":"phase","phase":"focused_verification","ts":"<ISO-8601 now>"}`.
   Re-read the story file, then try to BREAK each AC; log one `ac_verify` per AC.
   Full protocol: [`FEEDBACK.md`](FEEDBACK.md) (AC Verification Protocol).
   ```jsonl
   {"story":"US-XXX","event":"ac_verify","ac":1,"method":"route check","pass":true,"notes":"empty state renders"}
   ```
   If any `ac_verify` fails, fix it and re-verify. Do not proceed to step 8.

8. **Effectiveness gate — ONE cold mutation campaign, and it runs LAST.**
   **Mark the phase first** — before the campaign starts, append `{"story":"US-XXX","event":"phase","phase":"integration","ts":"<ISO-8601 now>"}`.
   The bar is [`TESTING.md`](TESTING.md) §4. `pnpm test:mutation` is the authoritative
   campaign: it scopes to this branch's diff and runs ONE campaign, so it is the
   whole gate, not a sample of it.
   ```bash
   pnpm test:mutation
   ```
   **A change to what the campaign scored invalidates it — do not run it until review is
   closed.** It scored the mutatable source files in this branch's diff (`.ts`/`.tsx`,
   tests excluded), the tests that exercise them, `stryker.conf.json` and the
   installed dependencies. Every fix step 7 produces changes that, so a campaign run
   before review has to be run again. Committing the tree it just scored, or a commit
   that touches only docs, ledgers or readiness JSON, changes none of it and does not
   invalidate it. Run a whole-critical-set campaign
   only if the critical set in [`TESTING.md`](TESTING.md) §3 itself changed, and only
   if this package defines one — the diff-scoped run is the gate.
   **Running the campaign early as a PREVIEW is allowed**, and is how weak oracles
   get found before hours of work depend on them — but a preview is not the gate,
   and **you must NOT report a `test_report` for one**. Only the last campaign, with
   nothing it scored changed after it, counts.
   Report the result (payload contract in [`FEEDBACK.md`](FEEDBACK.md)):
   ```jsonl
   {"story":"US-XXX","event":"test_report","mutation_score":84.2,"scope":"diff","killed":32,"survived":6,"surviving_annotated":[],"mutation_wallclock_s":720}
   ```

9. **Report terminal evidence** — only once every AC has a passing `ac_verify`
   and the campaign above has been reported:
   ```jsonl
   {"story":"US-XXX","event":"done","ts":"2026-04-02T21:30:00Z"}
   ```
   Add a `cost` object — what this session consumed, as token counts, never money
   (an item closed without one is listed as unreported by `[Execution Cost]`): `"cost":{"calls":142,"context_tokens":310000,"output_tokens":41000,"model":"<model>","window":1000000}`
   (`calls` = tool calls, `context_tokens` = the context the session reached; both
   required inside `cost`, the rest optional). A malformed `cost` rejects the whole
   `done` at pull, naming the field.

## Story Rejection Criteria

A story is REJECTED during sprint acceptance if any of these hold:
- `pnpm type-check`, `pnpm lint`, `pnpm build`, or `pnpm test` fails.
- A migration file was edited instead of adding a new one.
- No `build_pass` event in `.nous-feedback.jsonl`.
- An AC was marked pass with no `ac_verify` adversarial check logged.
- Commit lacks a `US-NNN` / `CHG-NNN` reference (enforced by `.githooks/commit-msg`).
  The one exception: a commit `node scripts/nous-sync-owns.mjs --staged` recognises as ONLY a
  Nous sync (envelope consistent, every other changed path claimed in `.nous-sync.json` at its
  delivered hash under the substrate-managed allowlist, clean-tree provenance) needs no work id;
  that script authorizes nothing else. It is a convention gate over the package's own tree:
  whoever edits `.nous-sync.json` can claim a path, so it authorizes by consistency, not by
  proof of authorship.
<!-- nous-emitted: sha256=14bf7f24501685da -->
