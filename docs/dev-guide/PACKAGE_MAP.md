# Package Map — what's live, what's scaffold, and your first delivery

This is a generated Turborepo monorepo. It **builds today** (`pnpm build`), but most
of its surface is an intentional, honestly-tracked scaffold — a Definition-of-Ready
skeleton plus shared libraries. This map tells you what is what, so you can tell a
finished primitive from a seam you are meant to fill.

## Package states

| Package | State | What it is |
|---|---|---|
| `@smp/db` | **Live** | Drizzle schema + client — the single source of truth for tables/columns. |
| `@smp/contracts` | Library | drizzle-zod `insert`/`select` schema per table. Import the one your feature validates against (the slice's action does). |
| `@smp/domain` | Skeleton (DoR) | Typed service interface per bounded context; the operation bodies are dev-team work. |
| `@smp/ui` | Library | Shared component library. Import the atoms/molecules you need; typed-stub organisms get their final layout from the Step-7 mocks. |
| `@smp/config` | Shared presets | ESLint flat-config preset. |
| `packages/design-system` | Token-asset dir | `tokens.css` / `tokens.json` + the Tailwind preset, consumed by `apps/web` via a relative path. NOT a workspace package — do not `import "@smp/design-system"`. |
| `apps/web` | **The app** | Your routes, server actions, and route handlers. Holds the worked slice. |

> **Library packages are unconsumed by construction.** `@smp/contracts` and the
> `@smp/ui` library start at 0% app-consumption on day one — a feature consumes
> the *specific* schema/component it needs. That is NOT dead code; the worked slice
> below shows the consumption pattern.

## Your first delivery

_No worked slice was emitted for this project (no salient entity with a db table + `org_id` and both a read-list and a mutation screen). Follow the decision rule below and the `@smp/db` / `@smp/contracts` patterns in the dev-guide._

## Which primitive for a screen? (the decision rule)

A cold read of the screens can't tell you which Next.js primitive to reach for. The
rule the slice follows:

- **A list / detail READ** → a **Server Component page**. Add
  `export const dynamic = "force-dynamic"` only when it reads request-time/session
  data (it almost always does — `getSession()` is request-time). See FRONTEND.md.
- **A mutation** (every screen that declares a `server_action:<name>` target) → a
  **server action** (`"use server"`). Validate the input with the `@smp/contracts`
  insert schema; take the tenant from the session, never the client.
- **A cron job or external webhook** → a **route handler**
  (`apps/web/src/app/api/<resource>/route.ts`).

The screens declare **no REST data endpoints** — reads happen inline in Server
Components and mutations go through server actions, so most features need **no**
route handler. `docs/api-contract-registry.json` is a scaffold for the day a real
external contract appears.
