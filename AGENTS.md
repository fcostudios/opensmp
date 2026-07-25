# AGENTS.md — Ledger

> Agent coordination rules for AI-assisted multi-agent development.
> This is a **single serverless nextjs app** — no separate backend service.

## Getting Started (read this first)

1. **Onboard:** install + database + the full conventions are in
   [`CLAUDE.md`](CLAUDE.md) (Quick Start). Run `pnpm install`, set
   `DATABASE_URL`, then apply the schema with
   `cd packages/db && pnpm drizzle-kit push && node scripts/verify-schema.mjs`
   (the drizzle config + verifier live with the schema, matching
   DEFINITION_OF_DONE).
2. **Pick work from [`docs/stories/SPRINT_PLAN.md`](docs/stories/SPRINT_PLAN.md)** — the
   sprint-ordered work queue (links to each story spec by sprint). `docs/stories/INDEX.md`
   is a flat catalog, NOT the queue; start from SPRINT_PLAN.
3. **Definition of Done:** a story is done only when
   [`docs/dev-guide/DEFINITION_OF_DONE.md`](docs/dev-guide/DEFINITION_OF_DONE.md) passes —
   `pnpm type-check && pnpm lint && pnpm build`, and `drizzle-kit push` + `verify-schema.mjs`
   apply the schema.
4. **Conventions** (tenant column `company_id` per DEC-SMP-017, per-table soft delete, App Router, design tokens)
   live in [`CLAUDE.md`](CLAUDE.md) and `docs/dev-guide/` — follow them verbatim.

## Agent Roles

### App Agent
- **Scope:** `apps/web/`
- **Language:** TypeScript
- **Framework:** nextjs  / react
- **Rules:**
  - App Router with Server Components by default; `"use client"` only when needed
  - Import design tokens from `packages/design-system`
  - Use Zustand for client state; validate forms with zod
  - All user-facing strings go in i18n locale files

### API Agent
- **Scope:** `apps/web/src/app/api/`, `packages/db/src/`
- **Rules:**
  - Endpoints are route handlers (`route.ts`); no separate backend service
  - Persist via the shared `drizzle` client; every multi-tenant query filters `company_id` (the generated tenant column — not `tenant_id`); add a soft-delete filter only on a table that declares `deleted_at`
  - Protect handlers with the keycloak session (`auth()`)

### Infrastructure Agent
- **Scope:** `infra/`
- **Rules:**
  - Hosting: self-hosted (Docker Compose on a VPS) — a single Next.js app plus its declared infra services (see docs/specs/09_architecture.md)
  - Shell scripts must be idempotent (`set -euo pipefail`)

### Docs Agent
- **Scope:** `docs/`, `CLAUDE.md`, `AGENTS.md`
- **Rules:**
  - Keep CLAUDE.md in sync with architecture changes
  - Story index must reflect current sprint assignments
  - Decisions must reference their DEC-NNN IDs

## Coordination Rules

1. **No cross-scope changes without discussion.** A new API shape is documented before the UI consumes it.
2. **Shared code lives in `packages/`.** Never duplicate logic between modules.
3. **Migrations are append-only.** Never modify a committed migration under `packages/db/src/migrations/`.
4. **Feature branches follow `feature/<context>/<short-desc>`.** Example: `feature/members/member-crud`.
5. **Every PR must reference a story ID** (e.g., US-004).
6. **`pnpm type-check && pnpm lint && pnpm build` must pass** before any PR is merged.

## Sprint Flow

1. **Sprint Planning:** pick stories from `docs/stories/SPRINT_PLAN.md` (the sprint-ordered work queue)
2. **Development:** Agents work on assigned stories within their scope
3. **Integration:** API contracts validated, UI connected
4. **Review:** Cross-agent review for shared boundaries
5. **Demo:** Working feature demonstrated end-to-end

## File References

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project intelligence — architecture, rules, quick start |
| `AGENTS.md` | This file — agent roles and coordination |
| `docs/stories/SPRINT_PLAN.md` | **Work queue** — sprint-ordered stories; start here |
| `docs/stories/INDEX.md` | Flat story catalog (reference, not the queue) |
| `docs/specs/` | ER model, screens, navigation map |
| `docs/decisions/` | Product decision history |
| `Taskfile.yml` | Task runner commands |
| `.env.example` | Required environment variables |

## Communication Protocol

When an agent needs to coordinate with another:

1. **API Contract:** Define the route handler path + shape before implementing
2. **UI Contract:** Define the component props interface before building
3. **Migration Ordering:** Timestamp-slug filenames avoid version conflicts

## Testing

**Before writing, modifying, or deleting any test, you MUST read `docs/dev-guide/TESTING.md`
and follow it.** The org-wide rationale is in `docs/TEST_EFFECTIVENESS_STANDARD.md`.
These are hard constraints, not suggestions — a PR that violates them will be rejected.

Non-negotiable rules (summarized from `docs/dev-guide/TESTING.md` §1):

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

When you change logic in a `docs/dev-guide/TESTING.md` §3 critical path, update its §3 in the same PR.
