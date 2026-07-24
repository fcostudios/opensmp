# AGENTS.md — Ledger

> Agent coordination rules for AI-assisted multi-agent development.

## Agent Roles

### Backend Agent
- **Scope:** `apps/api/`, `packages/db/`
- **Language:** typescript 
- **Framework:** nextjs 
- **Rules:**
  - Follow DDD layer boundaries (api → application → domain → infrastructure)
  - All entities extend `BaseEntity`
  - Always include `tenant_id` in queries
  - Write JUnit 5 tests for every service method
  - Use Flyway for schema changes — never modify existing migrations

### Frontend Agent
- **Scope:** `apps/web/`
- **Language:** TypeScript
- **Framework:** nextjs  / react 
- **Rules:**
  - Use App Router with Server Components by default
  - Import design tokens from `packages/design-system`
  - Use Zustand for client state management
  - Validate all forms with zod
  - All user-facing strings go in i18n locale files

### Infrastructure Agent
- **Scope:** `infra/`, `packages/db/`
- **Rules:**
  - Docker Compose for local dev
  - keycloak realm changes go through realm export JSON
  - Shell scripts must be idempotent (`set -euo pipefail`)

### Docs Agent
- **Scope:** `docs/`, `CLAUDE.md`, `AGENTS.md`
- **Rules:**
  - Keep CLAUDE.md in sync with architecture changes
  - Story index must reflect current sprint assignments
  - Decisions must reference their DEC-NNN IDs

## Coordination Rules

1. **No cross-scope changes without discussion.** If a backend change requires
   a frontend change, document the API contract first.
2. **Shared code lives in `packages/`.** Never duplicate logic between apps.
3. **Database migrations are append-only.** Never modify a committed migration.
4. **Feature branches follow `feature/<context>/<short-desc>`.** Example:
   `feature/sales/opportunity-crud`.
5. **Every PR must reference a story ID** (e.g., US-004).
6. **ArchUnit tests must pass** before any backend PR is merged.

## Sprint Flow

1. **Sprint Planning:** Stories assigned from `docs/stories/INDEX.md`
2. **Development:** Agents work on assigned stories within their scope
3. **Integration:** API contracts validated, frontend connected
4. **Review:** Cross-agent review for shared boundaries
5. **Demo:** Working feature demonstrated end-to-end

## File References

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project intelligence — architecture, rules, quick start |
| `AGENTS.md` | This file — agent roles and coordination |
| `docs/stories/INDEX.md` | Story catalog with sprint assignments |
| `docs/specs/` | ER model, screens, navigation map |
| `docs/decisions/` | Product decision history |
| `Taskfile.yml` | Task runner commands |
| `.env.example` | Required environment variables |

## Communication Protocol

When an agent needs to coordinate with another:

1. **API Contract:** Define the endpoint in a shared spec before implementing
2. **Event Contract:** Define the domain event class before publishing
3. **UI Contract:** Define the component props interface before building
4. **Migration Ordering:** Coordinate migration version numbers to avoid conflicts

## Testing

**Before writing, modifying, or deleting any test, you MUST read `TESTING.md` in this
repo and follow it.** The org-wide rationale is in `docs/TEST_EFFECTIVENESS_STANDARD.md`.
These are hard constraints, not suggestions — a PR that violates them will be rejected.

Non-negotiable rules (summarized from `TESTING.md` §1):

- **Never use print/log as a test.** `console.log` / `System.out` / `print`, or a test that
  only checks "does not throw", is NOT an oracle. Every test asserts a property or contract.
- **Never mock code we own.** Mock ONLY true third-party network boundaries (payments,
  email/SMS/push, LLM providers). Use Testcontainers or in-memory real implementations for
  databases, our own services, the event store, and read models. Every third-party mock must
  be backed by a Pact contract test.
- **Test aggregates with given/when/then over events:** `GIVEN [past events] WHEN [command]
  THEN [emitted events | rejection]`. Do not mock the event store.
- **Use the strongest available oracle** (exact -> property-based -> metamorphic -> differential
  -> golden). Use property-based tests for all scoring/standings/money math. Do not default to
  exact-equality on large objects.
- **Do not write tests to raise coverage.** Coverage is a diagnostic, never a target. The only
  effectiveness target is the mutation score on critical paths. A new test must kill a mutant
  that was not previously killed; if it only adds coverage, it is redundant -- do not add it.
- **Keep tests deterministic:** inject the clock and RNG seed, no live network, no reliance on
  ordering or timing.
- **Assert tenant isolation** on every path touching tenant-scoped data.

Scope your test-writing to small, well-specified correctness bugs with clear reproduction and
expected behavior. Do not spray shallow or heavily-mocked tests to inflate volume -- test volume
is not a goal and is measured as a cost, not a quality.

When you change logic in a `TESTING.md` §3 critical path, update `TESTING.md` §3 in the same PR.
