# Definition of Done — Build Verification Gate

A story is NOT done until the full build passes — self-reported "tests pass"
is not sufficient. See `CLAUDE.md` for the summary; this is the authoritative gate.

## Before Marking Any Story as `done`

1. **Backend build MUST pass**:
   ```bash
   ./gradlew build   # Compiles + runs all tests (unit, integration, ArchUnit)
   ```
   If ANY test fails, the story is NOT done. Fix the failure first.

2. **Frontend build MUST pass**:
   ```bash
   pnpm type-check && pnpm lint && pnpm test
   ```

3. **Coverage MUST be ≥ 80%** on both backend and frontend:
   ```bash
   ./gradlew test jacocoTestReport   # backend
   pnpm test --coverage              # frontend
   ```

4. **ArchUnit MUST pass**. If DDD layer violations are detected, create the
   missing domain interfaces and refactor. Do NOT suppress ArchUnit rules.

5. **Flyway migrations MUST validate**:
   - `./gradlew flywayMigrate` succeeds on a clean database.
   - No duplicate version numbers (check `packages/db/migrations/` for existing versions).
   - Every `@Table` / `@Column` annotation has a corresponding migration column.
   - Once applied, migrations are **immutable** — never edit a V*.sql file; add a new one.

6. **Report evidence** in `.nous-feedback.jsonl`:
   ```jsonl
   {"story":"US-XXX","event":"build_pass","backend_tests":154,"backend_coverage":"84%","frontend_tests":47,"frontend_coverage":"82%"}
   {"story":"US-XXX","event":"done","coverage":"84%","agent":"<your-agent>"}
   ```

7. **Adversarial AC verification** — see
   [`docs/dev-guide/FEEDBACK.md`](FEEDBACK.md#ac-verification-protocol-mandatory-before-done).

## Story Rejection Criteria

A story will be REJECTED during sprint acceptance if any of these hold:
- `./gradlew build` fails.
- `pnpm test` fails.
- Coverage drops below 80% (backend or frontend).
- ArchUnit violations exist.
- Migration version conflicts with existing migrations.
- A V*.sql file was edited instead of adding a new migration.
- No `build_pass` event in `.nous-feedback.jsonl`.
- An AC was marked pass but an `ac_verify` adversarial check hasn't been logged.
- Commit lacks a `US-NNN` / `CHG-NNN` reference (enforced by `.githooks/commit-msg`).

## NFR Checks

Per-NFR acceptance commands are listed in `CLAUDE.md`'s Build Verification Gate
section (generated from `nfr_enforcement.rules` in config).
