# Ledger Design System

Design tokens + Tailwind preset for Ledger, generated from the project's
Step-6 design system (`06_design_system_summary.json`).

## Contents

- `tokens.json` — canonical color / spacing / typography / radius tokens
- `tailwind-preset.js` — Tailwind preset extending the default theme
- `tokens.css` — CSS custom properties

## Not a workspace package — a token-asset directory

This directory is a **token-asset dir**, NOT a workspace package: it has no
`package.json` and is not part of the pnpm workspace — there is no
`@<scope>/design-system` module to import. The token data here is the
canonical source the generator derives `apps/web/src/styles/tokens.css`
(`@theme`) from, and that `@theme` block (imported by `globals.css`) is what
the app actually renders under Tailwind v4. `apps/web/tailwind.config.ts`
references the preset here but is **inert** under v4 (not auto-loaded — no
`@config` directive).

## Status colors — single source of truth

The semantic (status) hexes below MUST only ever be rendered by the
`status-pill` atom. Any color literal matching a semantic hex outside the
status-pill component is a build failure (see `scripts/check-status-pill.mjs`).

## Tokens

| Token | Hex | Usage |
|-------|-----|-------|
        | background | #f2f2f2 | brand |
| border | #e3e2e2 | brand |
| chrome_active | #e7851a | brand |
| chrome_bg | #2b2a29 | brand |
| chrome_border | #454341 | brand |
| chrome_fg | #f2f2f2 | brand |
| chrome_fg_muted | #c0bfc0 | brand |
| primary | #e7851a | brand |
| primary_hover | #c96f12 | brand |
| primary_soft | #fdf1e3 | brand |
| surface | #FFFFFF | brand |
| surface_muted | #f2f2f2 | brand |
| text_muted | #787474 | brand |
| text_on_primary | #FFFFFF | brand |
| text_primary | #3d3d3d | brand |
| text_secondary | #595756 | brand |
| error_bg | #fee2e2 | semantic (status colors — render ONLY via the status-pill atom) |
| error_dot | #dc2626 | semantic (status colors — render ONLY via the status-pill atom) |
| error_text | #991b1b | semantic (status colors — render ONLY via the status-pill atom) |
| neutral_bg | #f2f2f2 | semantic (status colors — render ONLY via the status-pill atom) |
| neutral_dot | #949394 | semantic (status colors — render ONLY via the status-pill atom) |
| neutral_text | #595756 | semantic (status colors — render ONLY via the status-pill atom) |
| pending_bg | #fef3c7 | semantic (status colors — render ONLY via the status-pill atom) |
| pending_dot | #d97706 | semantic (status colors — render ONLY via the status-pill atom) |
| pending_text | #92400e | semantic (status colors — render ONLY via the status-pill atom) |
| success | #166534 | semantic (status colors — render ONLY via the status-pill atom) |
| success_bg | #dcfce7 | semantic (status colors — render ONLY via the status-pill atom) |
| success_dot | #16a34a | semantic (status colors — render ONLY via the status-pill atom) |
