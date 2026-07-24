# Frontend Rules — Detailed Reference

Full reference for Next.js + TypeScript frontend patterns.
See `CLAUDE.md` for the 12-rule summary; this file is the authoritative detail.

## Architecture Fundamentals

1. **App Router only** — no pages/ directory.
2. **Server Components by default** — `"use client"` only when needed.
3. **Design tokens from `packages/design-system`** — never hardcode colors, spacing, or fonts.
4. **Client state: Zustand only** — no Redux, no Context for global state.
5. **Form validation: Zod schemas** — shared between client and server.
6. **Each screen answers ONE question** — no multi-purpose dashboards.

## Screen-to-API Wiring (via TOON `dataSource`)

Every TOON section has a `dataSource` field with `url` + `method`. When implementing a screen:

1. Read `docs/screens/SCR-NN.json`.
2. For each section with a `dataSource`, call that endpoint via the shared API client (`apiGet`, `apiPost`, etc.).
3. Replace template variables: `{current_user_id}` → from session; `{:paramId}` → from route params.
4. Wire section `states`: loading → skeleton; error → error banner with retry; empty → empty state with CTA.
5. If the backend endpoint doesn't exist yet, **create it** — never show mock data.

## API Contract Registry

`docs/api-contract-registry.json` lists every API endpoint the frontend expects, extracted from TOON `dataSource` fields.

Before implementing a backend controller:
- Search the registry for your endpoint path.
- Match path + HTTP method **exactly** to the TOON `dataSource.url` / `method`.
- Do NOT invent a different path.

After implementing:
- Verify with `grep -rE '@RequestMapping|@GetMapping|@PostMapping' apps/api/src/main/ | sort`.

## Visual Fidelity & `data-testid`

- HTML mocks at `docs/mocks/*.html` are the **visual target**. Open in a browser, match colors/spacing/components.
- Mocks are **not functional code**. Never copy mock HTML into the app. Never use mock HTML as "fallback UI".
- Every TOON section/card/action/field MUST have `data-testid` matching the TOON `id`. Enforced by `e2e/toon-fidelity.spec.ts`.

## i18n

- Never hardcode user-facing strings in JSX (the `check-hardcoded-string` lint rejects bare text nodes).
- **Client Component** (`"use client"`): `useLocale()` hook from `lib/i18n/use-locale.ts`.
- **Server Component** (default; `async` pages): `useLocale()` is client-only — import the messages JSON instead (`import messages from "@/lib/i18n/<lang>.json"`; read `messages.pages[key]?.title`). See the `socias` list + `[id]` detail worked examples.
- Locale: `en-US` (single-locale project).
- Mixed-language view = i18n setup is broken.

## Authentication & Role Gating

- `hasMinRole()` from `lib/auth/roles.ts`. Hierarchy: `seller < manager < director < admin`.
- Admin sees ALL menu items.
- User display name: `session.user.name` (from Keycloak `given_name` + `family_name`). Never display UUID as identity.
- Logout: `import { logout } from "lib/auth/logout"` — ends both NextAuth + Keycloak SSO sessions.

## API Client & Error Handling

- ALL `/api/v1/*` calls use the shared client:
  ```typescript
  import { apiGet, apiPost } from "lib/api/client";
  ```
  It auto-attaches the Bearer token from the session.
- Raw `fetch('/api/v1/...')` in any page/component is a bug — replace with the shared client.
- Every page MUST have loading, empty, and error states. No blank screens. Silent failures are **rejection-level defects**.

## Banned Patterns (Rejection-Level Defects)

- **Dev mocks / fake auth** — any `if (devMode)` or `if (!process.env.KEYCLOAK_*)` branch returning fake user data.
- **Hardcoded app state** — `onboardingComplete: true`, preset feature flags, fallback IDs not matching the DB.
- **Hardcoded redirect strings** — use route constants from `lib/routes.ts`.
- **Embedded fixture data** — never preset arrays/IDs in frontend code; fetch from the API and show empty state if unavailable.
- **Copied mock HTML in app code** — mocks are visual references only.
