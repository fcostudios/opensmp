# 06 — Design System: Ledger (`fcostudios__smp`)

**Step:** 6 — Design System · **Date:** 2026-07-22 · **Report language:** en-US (product UI es/en, es-EC primary, **tú** — DEC-SMP-013)
**Inputs:** `v1/01_research.md` · `v1/02_cx_personas.md` · `v1/04_er_model.md` · `v1/05_brand.md` + `extracts/05_brand_identity.json` (incl. `app_chrome_reference`) · `ClientDocs/QPH Design System.zip` (corporativo. DS: tokens, 14 components) · `ClientDocs/style-reference-registro-de-trabajos.jpeg` (DEC-SMP-012) · TECH_CONSTRAINTS: Next.js + TypeScript + Tailwind CSS 4 + React (DEC-SMP-002), web-only R1.

---SECTION: SEC0---

### Design System Executive Summary

Ledger's design system applies the **corporativo.** identity (DEC-SMP-005: default theme via tokens, never hardcoded) to a data-dense internal ops product serving five roles across 30 companies. UX priorities, in order: **trust through evidence** (finance personas), **one-minute decisions** (approvers), **state visibility** (everyone), **expert density without clutter** (Group Admin). The system is binding on Steps 7/7t (screens/TOONs), the mock generator, and the dev package.

Key outcomes:
- One **theme-token layer** (`--ds-*`) holding every corporativo. value — accent, grays, chrome, status ramp, fonts — so re-branding is a token override (white-label ready, R3+ MSP).
- The **data-workspace shell** matching the in-production corporativo. ops-tool reference (DEC-SMP-012): dark ink rail + filled-orange active item, warm-gray canvas, condensed uppercase display titles.
- A **12-state status-pill system** (single source of truth for state color) mapped to a 4-color WCAG-AA ramp — orange excluded from status duty.
- Reusable organisms for the product's four repeated shapes: **queue card**, **stat-tile row**, **evidence drill-down table**, **amber action callout**.
- Bilingual microcopy slots (es-EC tú / en-US) wired from the brand vocabulary lock.

---SECTION: SEC1---

### Context, Inputs and Scope

**SEC1.1 Inputs.** Research gave the AS-IS pains and trust stakes; personas gave role-scoped surfaces and the one-minute-decision constraint; the ER model gives the 22 entities and the state enum this system must render; brand (Step 5) locked palette/type/voice + the chrome reference (DEC-SMP-012); tech constraints from DEC-SMP-002 (Next.js/Tailwind 4/React, web-only R1); locales es-EC + en-US (DEC-SMP-004/013).

**SEC1.2 Product context.** Internal license-lifecycle + chargeback platform: request → approval → provision → monitor → reclaim → deprovision over one register; monthly close and reconciliation. Desktop-first (ops), responsive down to mobile for requester/approver flows.

**SEC1.3 Scope.** In: tokens, layout/shell, component library (atoms→templates), interaction patterns, ER→UI mapping, accessibility/i18n, DS JSON + `design_system.dss.json`. Out: marketing surfaces, native mobile, sub-brand theming (only the seam ships), detailed motion beyond the corporativo. timing rules, PDF statement layout (Step 7 template; type rules set here).

---SECTION: SEC2---

### Design Principles and UX Foundations

**SEC2.1 Core UX principles** (from brand SEC8, made operational):
1. **Evidence at arm's reach** — every figure links to its source rows; drill-down is a first-class pattern (drawer/expand), not a report footnote.
2. **One accent, one action** — a single orange element per region: the primary CTA, the active rail item, or the live alert. Everything else is gray structure.
3. **States, not silence** — the status pill + freshness label are mandatory wherever a request/seat/sync appears; loading, empty, error and stale are designed states.
4. **One-minute decisions** — approver organisms carry complete context inline; decide without navigating.
5. **Calm forms, honest errors** — single-column forms, inline validation, fact + next step, tú voice.
6. **Respect the reader's scope** — company-scoped chrome shows exactly one company's world; no disabled cross-tenant hints.
7. **Dense, never cluttered** — admin tables may be compact, but always with hairline dividers, 4px rhythm, and uncluttered headers.

**SEC2.2 Persona-driven priorities.**

| Persona | Primary tasks | Critical UX needs | UI implications |
|---|---|---|---|
| Group Admin | exceptions, pools, drift, credentials | density + completeness; alert triage | data-workspace shell, stat tiles, compact tables, command search 🟡 |
| Company Approver | approve/reject; reclamation sign-off | one-card context, email deep links | queue-card organism, inline actions, mobile-friendly |
| Company/Central Finance | verify statements; reconcile | traceability, tabular clarity, exports | evidence tables, tabular numerals, CSV/PDF buttons |
| End User | request, track | status clarity, zero jargon | simple form template, status timeline |

**SEC2.3 Heuristics & constraints.** Visibility of system status (freshness labels), error prevention (validations before submit), recognition over recall (the 12 chips are the vocabulary), consistency (one status-pill component). Tailwind 4 + tokens as CSS custom properties; no heavy animation (corporativo. motion: 150ms hover / 250ms transitions, no bounces/loops); Play-CDN-safe CSS in mocks (no nested `var()` chains — IMP-293 lesson).

---SECTION: SEC3---

### Brand & Visual Language

All values are **theme tokens** (SEC9 JSON is normative). Corporativo. defaults:

- **Accent:** `#e7851a` (hover `#c96f12`, soft `#fdf1e3`) — DEC-SMP-010; derived programmatically from the base token so the documented `#f06820` swap is one line.
- **Grays:** `#c0bfc0 / #949394 / #787474 / #595756`; ink `#3d3d3d`; canvas `#f2f2f2`; hairline `#e3e2e2`; white surfaces.
- **Chrome (DEC-SMP-012, from the live reference):** rail bg `#2b2a29` (near-black warm charcoal), rail text `#f2f2f2`, muted `#c0bfc0`, section labels **uppercase orange 11px/0.06em**, active item = **filled `#e7851a` rounded-lg block** with white label — the rail's only orange.
- **Status ramp (Ledger addition; AA-verified ≥ 12.5px text on its bg and on white):**
  - `success` — text `#166534`, bg `#dcfce7`, dot `#16a34a`
  - `pending` — text `#92400e`, bg `#fef3c7`, dot `#d97706`
  - `attention` — text `#991b1b`, bg `#fee2e2`, dot `#dc2626`
  - `neutral` — text `#595756`, bg `#f2f2f2`, dot `#949394`
  - Orange is **never** a status color.
- **Type:** `sans` = Barlow (400/600/700/900); `display` = **Barlow Condensed 900 UPPERCASE** for page titles (per the reference's condensed cut; see SEC11 A-DS-1), tight leading (1.05), ink color; `mono` = IBM Plex Mono (money/ids/table numerals — Barlow's proportional figures are not tabular; see SEC11 A-DS-2). Body 16px/1.5; admin tables may drop to 14px; minimum 12.5px for labels.
- **Logo:** corporativo. lockups from the DS package (positive/negativo/blanco; mark at favicon size). "Ledger" product title set in Barlow beside it (A-BR-1 pending).
- **Iconography:** Lucide 2px stroke; icon tiles (white glyph on colored rounded square) for module identities; **no emoji**.
- **Radii:** cards/tiles 16px · buttons/inputs 8px · chips 999px · small inputs 4px. **Shadows:** 3 gray-tinted steps (never black). **No gradients** (the dark-photo veil is login-only).

---SECTION: SEC4---

### Layout System & Responsive Grid

- **Shell (data-workspace archetype):** fixed left **nav rail 248px** (dark chrome, sectioned: OPERACIÓN / FINANZAS / ADMINISTRACIÓN), warm-gray canvas, white content panel with 24–32px padding. Top strip inside content: breadcrumb (orange links) → **display title** (condensed uppercase, up to 2 lines, `·` separators) → gray metadata line (middot-separated) → status pill right-aligned.
- **Grid:** 12-col, 24px gutters, content `max-width` **1280px** (xl) centered; full-bleed allowed for wide tables with horizontal scroll inside the panel.
- **Stat-tile row:** 2–4 white tiles (16px radius, sm shadow), label 13px gray-600 over numeral 32–40px Barlow Bold; wraps 2×2 below `md`.
- **Breakpoints:** 320 / 480 / 768 / 1024 / 1280. Below `lg` the rail collapses to an icon rail; below `md` to a top bar + sheet menu (requester/approver flows must work at 375px; admin tables are desktop-first with scroll).
- **Density:** default comfortable (row height 48px); admin tables compact (40px) via a container class, never per-cell overrides.
- **Spacing:** 4px scale — 4/8/12/16/24/32/48/64.

---SECTION: SEC5---

### Components Library

**Atoms** (base: the 14 corporativo. DS components, re-tokened): Button (primary filled-orange / secondary gray-outline / ghost / dark), Input, Select, Switch, Badge (numeric), Pill (role), Tag, Progress, Alert, Card, Logo, IconTile, plus Ledger atoms: **StatusPill** (dot + label; the ONLY component allowed to render state colors — lint-enforced), **FreshnessLabel** ("datos al 19-jul" + stale variant), **MoneyText** (mono, right-aligned, `USD 27,10`), **Breadcrumb**, **SectionLabel** (uppercase orange rail/panel section header), **DisplayTitle** (condensed uppercase h1).

**Molecules:** StatTile · TabsWithCounts (active = semibold + orange underline) · CalloutAction (amber bg, orange left border, title/body, right-aligned quiet-secondary + orange-primary buttons) · FormField (label + control + inline error) · SearchInput 🟡 · DateRangeLabel ("Rango de consulta …") · EvidenceLink ("ver evidencia") · EmptyState (fact + what-happens-next) · ConfirmDialog (reject-with-comment, reclamation).

**Organisms:** AppShell (rail + canvas) · **QueueCard** (requester, company, justification, needed-by, cost impact, budget headroom, inline Aprobar/Rechazar) · **DataTable** (hairline rows, sortable, sticky header, per-row drill-down expander, mono numerals; compact variant) · **StatTileRow** · **RegisterDrilldown** (statement line → assignment rows → raw payload viewer) · **StateTimeline** (request transitions with actors/timestamps) · **AlertList** (ack buttons, per-company log) · **PoolGauge** (purchased/assigned/pending/free per org + low-pool state) · StatementHeader (company code, period, totals) · AuditTrailViewer (before/after JSON diff).

**Templates:** `tpl.workspace-list` (title + filters + DataTable) · `tpl.workspace-record` (title + metadata + stat tiles + callout slot + TabsWithCounts + tab panels — the reference screenshot's page) · `tpl.queue` (QueueCard stack) · `tpl.form-single` (single-column request form) · `tpl.close-workbench` (reconciliation: rollup vs invoice + variance table + override dialog) · `tpl.auth` (login with building photo + veil).

---SECTION: SEC6---

### Interaction Patterns & Behaviors

- **Motion:** 150ms ease hovers (`cubic-bezier(0.2,0,0.2,1)`), 250ms larger transitions; cards lift −2px + deeper shadow; no bounces, no infinite loops, no parallax.
- **Primary action rule:** one filled-orange button per view; destructive-ish flows (reject, reclaim, override) use ConfirmDialog with mandatory comment where the PRD demands it.
- **Inline decisions:** QueueCard approve/reject without navigation; optimistic UI **not** used for vendor-side actions (provisioning states advance only on confirmed transitions — states, not promises).
- **Drill-down:** row expander or right-side drawer; never a new tab for evidence.
- **Tabs with counts** for record sub-resources (Artefactos-style); count updates live.
- **Notifications/email deep links** land on the scoped view with the relevant card focused.
- **Callout pattern** for degraded/blocked situations: fact + consequence + the two actions (quiet secondary, orange primary) — mirrors the reference's "Recolección incompleta" card.
- **Freshness:** every synced figure renders FreshnessLabel; >48h staleness switches it to the attention style and fires the alert (Module D).
- **Keyboard/focus:** visible 2–3px orange focus ring always; table row focus + Enter to expand; dialog focus traps.

---SECTION: SEC7---

### Data-Driven UI Mapping (ER Model → UI & Controls)

| ER element | UI control | Rules |
|---|---|---|
| `LicenseRequest.state` (12-value enum) | StatusPill via the es/en chip vocabulary | color map: success={approved, active}; pending={pending_approval, provisioning, invited, flagged_inactive}; attention={blocked_no_seat, failed, rejected}; neutral={submitted, offboarding, deprovisioned} |
| `RequestTransition[]` | StateTimeline | actor, timestamp, note; system transitions marked with a gear glyph |
| Money (`decimal` USD) | MoneyText (mono, right-aligned) | es-EC `USD 27,10` / en-US `$27.10`; totals bold; never orange |
| Dates | FreshnessLabel / DateRangeLabel | `19-jul` labels; `dd/mm/aaaa` documents |
| `LicenseAssignment` rows | RegisterDrilldown table | started/ended/reason/source; open rows show "— actual" |
| Pool (capacity − assigned − pending) | PoolGauge | low-pool (< floor) renders attention state + callout |
| `Statement`/`StatementLine` | StatementHeader + DataTable + RegisterDrilldown | line kind badges (license/usage/adjustment); export buttons CSV/PDF |
| `Reconciliation` | tpl.close-workbench | variance colored by tolerance (≤0.5% success, else attention); override requires note (OQ-SMP-11 role) |
| `AlertEvent` | AlertList | unacked = attention left border; ack records user+time |
| `IntegrationCredential.health` | StatusPill (ok/auth_failed/unverified) + last4 masking | rotation flow never displays secrets |
| `AuditLog` | AuditTrailViewer | read-only, filterable by entity/actor/action |
| Enums (type/status fields) | Select with locked vocabulary labels | never free text for enum values |

---SECTION: SEC8---

### Accessibility & Internationalization

- **WCAG 2.1 AA:** status ramp verified on white and `#f2f2f2`; body text `#3d3d3d`/`#595756` on white (≥ 7:1 / 5.3:1); **orange never carries small text** (buttons use white-on-orange at ≥ 14px semibold — 3.05:1 large-text pass; prefer 16px); focus ring mandatory; tap targets ≥ 44px on requester/approver flows; tables get proper `<th>` scope + caption.
- **Color independence:** every state pairs dot+label (never color alone); variance/tolerance states also show the number.
- **i18n (DEC-SMP-004/011/013):** all strings externalized (`messages/` catalogs es-EC + en-US); **tú everywhere** in es; chip vocabulary from the brand lock is the single source; number/date formatting per locale (coma decimal es-EC); statements render in `Company.statement_language`; text expansion budget +30% on buttons/labels; no concatenated sentences.
- **Reduced motion:** respect `prefers-reduced-motion` (drop lifts/fades).

---SECTION: SEC9---

### Design Tokens & Design System JSON

```json
{
  "meta": { "project": "fcostudios__smp", "product": "Ledger", "theme": "corporativo", "theme_customizable": true, "decisions": ["DEC-SMP-005", "DEC-SMP-010", "DEC-SMP-012", "DEC-SMP-013"] },
  "tokens": {
    "color": {
      "primary": "#e7851a",
      "primary_hover": "#c96f12",
      "primary_soft": "#fdf1e3",
      "background": "#f2f2f2",
      "surface": "#ffffff",
      "surface_muted": "#f2f2f2",
      "border": "#e3e2e2",
      "text_primary": "#3d3d3d",
      "text_secondary": "#595756",
      "text_muted": "#787474",
      "text_on_primary": "#ffffff",
      "chrome": { "bg": "#2b2a29", "fg": "#f2f2f2", "fg_muted": "#c0bfc0", "border": "#454341", "hover": "#454341", "active": "#e7851a" },
      "semantic": {
        "success_text": "#166534", "success_bg": "#dcfce7", "success_dot": "#16a34a",
        "pending_text": "#92400e", "pending_bg": "#fef3c7", "pending_dot": "#d97706",
        "attention_text": "#991b1b", "attention_bg": "#fee2e2", "attention_dot": "#dc2626",
        "neutral_text": "#595756", "neutral_bg": "#f2f2f2", "neutral_dot": "#949394"
      }
    },
    "typography": {
      "fontFamily": { "sans": "Barlow, system-ui, sans-serif", "display": "Barlow Condensed, Barlow, sans-serif", "mono": "IBM Plex Mono, ui-monospace, monospace" },
      "webfonts": { "enabled": true, "provider": "google", "families": ["Barlow:400,600,700,900", "Barlow Condensed:700,900", "IBM Plex Mono:400,600"] },
      "default_body_size_px": 16,
      "table_body_size_px": 14,
      "min_label_size_px": 12.5,
      "display": { "weight": 900, "transform": "uppercase", "leading": 1.05 },
      "min_tap_target_px": 44
    },
    "spacing_scale_px": [0, 4, 8, 12, 16, 24, 32, 48, 64],
    "radius_px": { "sm": 4, "md": 8, "lg": 16, "full": 9999 },
    "shadow": {
      "sm": "0 1px 2px rgba(89,87,86,0.10)",
      "md": "0 4px 10px rgba(89,87,86,0.14)",
      "lg": "0 12px 28px rgba(61,61,61,0.18)"
    },
    "breakpoints_px": { "xs": 320, "sm": 480, "md": 768, "lg": 1024, "xl": 1280 },
    "motion_ms": { "hover": 150, "transition": 250, "easing": "cubic-bezier(0.2,0,0.2,1)", "no_bounce_no_loops": true }
  },
  "shell": {
    "archetype": "data-workspace",
    "rail_width_px": 248,
    "rail_sections": ["OPERACIÓN", "FINANZAS", "ADMINISTRACIÓN"],
    "active_item": "filled-primary rounded-lg white-label (the rail's only orange)",
    "content_max_width_px": 1280
  },
  "status_pill_state_map": {
    "success": ["approved", "active"],
    "pending": ["pending_approval", "provisioning", "invited", "flagged_inactive"],
    "attention": ["blocked_no_seat", "failed", "rejected"],
    "neutral": ["submitted", "offboarding", "deprovisioned"]
  },
  "rules": {
    "single_orange_per_region": true,
    "orange_never_status": true,
    "status_pill_single_source_of_truth": true,
    "no_emoji": true,
    "no_gradients": true,
    "freshness_label_on_all_synced_figures": true,
    "money_in_mono_right_aligned": true
  }
}
```

---SECTION: SEC10---

### Optional JSON Schema

Not emitted (not requested); the SEC9 JSON plus `design_system.dss.json` are the machine contracts.

---SECTION: SEC11---

### Open Issues, Risks & Assumptions

- **A-DS-1 (display cut):** the reference app's titles read as a condensed Black cut; declared here as **Barlow Condensed 900** with Barlow fallback. Verify against the reference build at Step 7t mock review; a swap is a token-family change only.
- **A-DS-2 (numerals):** Barlow lacks tabular figures — money/ID columns use IBM Plex Mono. If a real tabular-figures Barlow build appears, swap via `fontFamily.mono` token; alignment rules unchanged.
- **A-DS-3 (rail chrome values):** `#2b2a29 / #454341` are sampled from the reference screenshot (photo of a screen — not colorimetric). Confirm against the reference app's CSS when accessible; token-only fix.
- **Proposed (beyond inputs):** the 4-color status ramp values (corporativo. DS defines the *direction*, not exact hexes) — marked Proposed, AA-checked; final visual sign-off at Step 7t mocks.
- **Risk:** Tailwind CDN mocks must not use nested `var()` chains (IMP-293); the generator's chrome/token emission handles this — do not hand-write nested vars in TOONs.
- **Carried:** A-BR-1 product lockup sign-off; OQ-SMP-11 override role (affects tpl.close-workbench permission states); orange rebrand `#f06820` one-token swap path (DEC-SMP-010).
