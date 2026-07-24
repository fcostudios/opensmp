# Navigation Map — Dev Guide

> **File:** `docs/specs/07c_navigation_map.json`
> **Source of truth:** Nous pipeline (Step 7c). Synced to this repo via `nous_package.py sync -c specs` or `infra/scripts/sync-from-nous.sh`.
> **Audience:** Any developer building routes, sidebars, breadcrumbs, or role-gated views. Any AI agent doing the same.
> **Last updated:** 2026-04-20 (CHG-020)

## What this file is

`07c_navigation_map.json` is the **authoritative registry** of every screen, route, and user flow in Kaiman SaleOS. It encodes:

- **App shell** — sidebar items + order, header, mobile bottom-bar, command palette quick-actions
- **Entry points** — where users land on login, onboarding, deep-link handling
- **Routes** — one entry per URL path, with the screen it renders, required roles, query params, and layout (page vs. modal)
- **Navigation graph** — directed edges: which screen-to-screen transitions exist, what triggers them, what params they carry
- **Flows** — named sequences for each persona (e.g. `seller_daily`, `manager_coaching`, `portfolio_strategy_session`)
- **Role-based views** — which sidebar items + screens are visible per role (seller / manager / director / admin)
- **Breadcrumb patterns** — template strings for each screen's breadcrumb trail

## The invariant (don't break this)

> **Every route under `apps/web/src/app/**/page.tsx` must have a matching entry in `routes[].path` of this file.**
> **Every sidebar item in `apps/web/src/components/layout/sidebar.tsx` must reference a nav entry from `app_shell.sidebar.items[]`.**
> **Every new screen needs a TOON spec (`Nous/Specs/v1/toon/SCR-NN.json`) AND a nav map entry — before merging.**

CI enforces this via `infra/scripts/validate-routes.sh` (see below). Drift is a merge blocker.

## How to read it

### Structure at a glance

```jsonc
{
  "meta": { "total_screens": 24, "total_routes": 30, "total_edges": 80 },
  "app_shell": {
    "sidebar": { "items": [ … ] },
    "mobile_bottom_bar": { "items": [ … ] },
    "command_palette": { "shortcut": "Ctrl+K", "quick_actions": [ … ] }
  },
  "entry_points": { "login": { … }, "first_time": { … }, "default": { … } },
  "routes": [
    { "path": "/portfolio/strategy",       "screen": "SCR-30", "title": "Portfolio Strategy",     "roles": ["director", "manager"] },
    { "path": "/portfolio/sessions/:id",   "screen": "SCR-31", "title": "Session Workspace",      "roles": ["director", "manager"], "query_params": ["tab"] },
    { "path": "/portfolio/strategy/new",   "screen": "SCR-32", "title": "Start Session",          "roles": ["director", "manager"], "layout": "modal" }
    // …
  ],
  "navigation_graph": {
    "nodes": ["SCR-01", …],
    "edges": [
      { "from": "SCR-30", "to": "SCR-32", "trigger": "click_start_new_session", "label": "Start a new Portfolio Strategy session" },
      { "from": "SCR-31", "to": "SCR-35", "trigger": "click_commit_session", "label": "Open commit confirmation modal" }
    ]
  },
  "flows": {
    "portfolio_strategy_session": {
      "name": "Portfolio Strategy Session Lifecycle",
      "persona": "director",
      "steps": [
        { "screen": "SCR-30", "action": "Review active sessions …" },
        { "screen": "SCR-32", "action": "Start new session — pick trigger …" }
        // …
      ]
    }
  },
  "role_based_views": {
    "director": { "sidebar": [ … ], "screens": [ … ], "default_route": "/dashboard" }
  }
}
```

### Useful queries

**"What screens can a director see?"**
```js
const map = await fetch('/docs/specs/07c_navigation_map.json').then(r => r.json())
map.role_based_views.director.screens           // ["SCR-01", "SCR-05", …]
```

**"What's the route for SCR-31?"**
```js
map.routes.find(r => r.screen === 'SCR-31')?.path
// "/portfolio/sessions/:sessionId"
```

**"What can I navigate to from SCR-30?"**
```js
map.navigation_graph.edges.filter(e => e.from === 'SCR-30')
// [{ to: "SCR-32", trigger: "click_start_new_session", label: "…" }, …]
```

**"What's the flow for portfolio rebalancing?"**
```js
map.flows.portfolio_strategy_session.steps
```

## When to update it

| Situation | What you update in Nous |
|---|---|
| New screen (SCR-NN) | Add to `routes[]`, `navigation_graph.nodes[]`, and relevant `role_based_views[role].screens[]` |
| New sidebar item | Add to `app_shell.sidebar.items[]` and relevant `role_based_views[role].sidebar[]` |
| Screen-to-screen transition | Add edge to `navigation_graph.edges[]` with `{from, to, trigger, label}` |
| Route path change | Update `routes[].path` — then fix the corresponding Next.js folder (or the CI check fails) |
| New user flow | Add a new key to `flows` with `{name, persona, steps[], estimated_time, entry_point}` |
| Role gets a new screen | Add to `role_based_views[role].screens[]` |

**Never edit this file directly in the dev package.** It gets overwritten on sync. Edit the Nous source (`Nous/Specs/v1/07c_navigation_map.json`) via a CHG-NNN, then sync.

## How the dev package consumes it

> As of 2026-04-20, the file is a **reference document only** — no runtime code reads it. Routes, sidebars, and flows are hand-coded in `apps/web/`. We enforce alignment via CI (see below), not auto-generation.
>
> Future iterations may add a generator (`infra/scripts/scaffold-route.sh`) that creates Next.js page stubs from this file. Until then: the map is the spec you implement against.

## CI guard

`infra/scripts/validate-routes.sh` scans:

1. Every `apps/web/src/app/**/page.tsx` → extracts its URL path from the folder
2. Every `routes[].path` in the nav map
3. Fails the build if any Next.js route lacks a matching map entry (or vice-versa for non-dynamic routes)

Run locally:
```bash
./infra/scripts/validate-routes.sh
```

## Scaffolding a new route

`infra/scripts/scaffold-route.sh SCR-NN` reads the nav map, finds the matching entry, and generates:

- `apps/web/src/app/{route-path}/page.tsx` — Next.js page stub with role gating + title
- A reminder (if the SCR is a sidebar destination) to run `regenerate-sidebar.py` so the sidebar picks it up

Example:
```bash
./infra/scripts/scaffold-route.sh SCR-31
# Creates: apps/web/src/app/portfolio/sessions/[sessionId]/page.tsx
```

## Sidebar — also specified by the nav map

Sidebar ordering, role gates, labels, and badges are a **UX decision** — and that decision lives in the nav map at `app_shell.sidebar.items[]` (array order IS display order). The dev package doesn't hand-maintain those fields anywhere.

The runtime sidebar imports `navItems` from a generated file:

```
apps/web/src/components/shell/nav-items.gen.ts   ← AUTO-GENERATED, do not edit
```

### Regenerate after any nav map change

```bash
./infra/scripts/regenerate-sidebar.py
# ✓ Wrote apps/web/src/components/shell/nav-items.gen.ts (12 nav items)
```

### CI drift check

```bash
./infra/scripts/regenerate-sidebar.py --check
# Exits 0 if in sync, 1 if regeneration needed — fail the build on 1.
```

### How the Sidebar component consumes it

`sidebar.tsx` no longer inlines the nav items — it imports them:

```ts
import { navItems } from "./nav-items.gen";
```

All UX behavior (keyboard nav, active state, collapse, profile dropdown, translation) stays in `sidebar.tsx`. Only the data layer comes from the generated file.

### Mobile bottom-bar

`app_shell.mobile_bottom_bar.items[]` is also specified in the nav map but is not yet flowing into a generated file. Next iteration: extend `regenerate-sidebar.py` to emit `mobile-nav-items.gen.ts` too.

## Header — active-context control (IMP-229)

`app_shell.header.active_context` is an **optional** block. When present and `enabled`, the self-shell archetypes (`ledger-book`, `mobile-first`, `dashboard`) render a **config-gated active-context chip** in the header — an active-scope label plus a `<details data-nous-context>` switch disclosure listing representative scopes. Use it when one user operates across multiple tenant scopes (e.g. a treasurer who manages several savings groups) and every screen's chrome must show which scope is active.

```json
"app_shell": {
  "header": {
    "active_context": {
      "enabled": true,
      "label_key": "active_group",
      "icon": "Users",
      "switch_label_en": "Switch group",
      "switch_label_es": "Cambiar grupo",
      "current": { "label": "Grupo Esperanza" },
      "items": [
        { "label": "Grupo Esperanza", "active": true },
        { "label": "Grupo Amanecer" },
        { "label": "Grupo Solidaridad" }
      ]
    }
  }
}
```

**Contract:**

- **Optional + additive.** Omit the block and the header is **byte-for-byte identical** to before — the reproducibility contract is preserved. Existing nav maps without it stay valid against the schema.
- **Project-agnostic.** Every string (active label, switch label, scope labels) comes from this block. No project slug is ever emitted.
- **Representative only.** The mock renders a *representative* active value + list. Real session/scope resolution is the consuming application — the chip is a UX surface, not auth logic.
- **i18n + a11y.** `switch_label_en` / `switch_label_es` drive both the visible switch label and the chip's `aria-label` (es-EC honored when the locale is Spanish). The disclosure is a native `<details>`/`<summary>` (keyboard-navigable, zero JS) and the scope rows are `role="menuitemradio"`.
- **Coexists with the IMP-228 overflow "More" disclosure.** The chip uses a distinct `data-nous-context` marker (vs IMP-228's `data-nous-more`); scope rows carry **no** `data-route` (they are tenant switches, not navigations), so they never pollute the `[Nav Menu Coverage]` chrome set.
- **The archetype is the sole producer (HR-34 / IMP-210).** The chip is emitted by the generator's archetype renderer — never hand-wired into a mock or added by a post-processor.

## FAQ

**Q: I added a new screen but the validator fails. Why?**
A: The nav map is behind — update Nous's source and re-sync. You can't add the route to the dev package alone; it must exist in the map first.

**Q: What happens if I need a route before the map has it?**
A: Update the map first. No exemptions, no `.ci-skip` markers, no back doors. The workflow is **Nous edit → sync → code**. If the map is stale for your need, raise a CHG-NNN and update the map — that takes 5 minutes and protects the invariant.

**Q: Who owns the nav map?**
A: Product (via Nous, Step 7c). Engineering implements against it. If you need a route shape that doesn't exist yet, open a CHG-NNN with the Product owner.

**Q: Where do modals go?**
A: Modals have `layout: "modal"` in their route entry. They share the parent page's path tree but render as overlays. See SCR-32 through SCR-35 for examples — all have `layout: "modal"` and routes under `/portfolio/…`.

**Q: How do I preview the current map without reading JSON?**
A: Open `Nous/Specs/v1/html_mocks/journey_player.html` — it renders the flows visually with clickable mocks.

---

*Generated from Nous. Do not edit directly. See `Nous/Specs/v1/07c_navigation_map.json` for the source.*
