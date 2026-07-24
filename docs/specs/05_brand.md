# 05 — Brand Report: Ledger (`fcostudios__smp`)

**Step:** 5 — Brand · **Date:** 2026-07-22 · **Report language:** en-US (workspace DEC-003)
**PRIOR_WORK:** `PRD.md` · `v1/01_research.md` · `v1/02_cx_personas.md` (+ CX principles/anti-patterns) · `v1/03_cx_journeys.md` (vocabulary lock) · `v1/04_er_model.md` (state enum, statement_language) · `ClientDocs/QPH Design System.zip` (readme, brandbook-derived tokens, components) · DEC-SMP-004/005
**Locales:** primary `es-EC`, secondary `["en-US"]` (multilang per DEC-SMP-004), deferred: none declared. Currency USD.
> **Naming (operator correction 2026-07-22, DEC-SMP-013):** the umbrella brand is **"corporativo."** — "QPH / Quito Publishing House" is the legacy name and appears only in historical/provenance references (file names, brandbook citations). All brand-facing copy says **corporativo.** — and the voice is **informal tú, everywhere**.

---SECTION: SEC0---

**Executive Summary**

- **Ledger** is the corporativo. group's internal license-lifecycle and chargeback platform (30 companies, Quito). This report applies an **existing brand** — **SCENARIO_A** — to the product: the **corporativo.** identity (June 2026 rebrand), fully documented in the verified Design System package (`ClientDocs/QPH Design System.zip`, built from the official *Manual de Identidad Corporativa* / `brandbook_qph.pdf`).
- Per **DEC-SMP-005**, corporativo. is the **default theme, never a hardcode**: every brand value below enters the product through a theme-token layer (accent, grays, type, logo, status colors swappable per deployment — re-brand/white-label ready for the R3+ MSP horizon).
- Brand core: **Barlow** for everything (Black uppercase headlines, Regular body; Josefin Sans is logo-lettering only), **orange `#e7851a`** as the single rationed accent, **corporate grays** (`#c0bfc0→#595756`) for structure, flat white / ink `#3d3d3d` surfaces, Lucide pictograms, **no emoji**, `SECCIÓN | TÍTULO` heading pattern.
- **OQ-SMP-8 resolved → DEC-SMP-010:** the brand-orange token defaults to the brandbook value **`#e7851a`** (the DS package's own documented choice pending rebrand-palette confirmation); the newer artwork's `#f06820` remains a one-token swap if corporativo. confirms it.
- **OQ-SMP-9 resolved → DEC-SMP-011:** statements/PDFs default to **Spanish (es-EC)** with a per-company `statement_language` override (`es / en`, already modeled on `Company` in Step 4). UI is bilingual with per-user selector.
- CX/UX implication: Ledger is an **ops trust tool** — the brand shows up as clarity, evidence, and restraint (rationed orange = the one action or alert per view), not decoration. Statements and approval queues are the brand's most important canvases.

---SECTION: SEC1---

**Context, Problem and Scope**

- **Problem (from research):** 30 companies consume Claude Enterprise seats with no system of record, no controlled request path, and no defensible per-company cost; every step runs over chat/email against the vendor console. Ledger replaces this with a state-machine workflow and an attribution register.
- **Environment:** internal B2E platform for the corporativo. corporate building (Quito, Ecuador; USD; es-first culture with bilingual operators). Not a market-facing product in Phase 1 — brand's job is **internal trust and adoption**, especially with approvers (GMs) and finance teams.
- **Cultural/brand constraint:** corporativo. is an **umbrella brand**; sub-brands (Kickoff, Opina, Right Angle Media, PPM, Focus…) have their own palettes that must **never mix** with corporativo. group's. Ledger serves the *building* (shared services), so it correctly wears **corporativo.** identity — not any tenant company's.
- **Scope:** brand application + voice + visual tokens + experience principles + microcopy seeds for Steps 6–7. Out of scope: marketing/landing collateral, the commercial SMP market positioning (internal tool), sub-brand theming (only the *customizability seam* is in scope, per DEC-SMP-005).
- **Assumptions:** A-BR-1 — Ledger may use the "corporativo." wordmark + own product name lockup in-app (hypothesis: confirm with corporativo. brand owner; risk logged SEC10). A-BR-2 — the DS package is current as of the June 2026 rebrand (its readme states so).

---SECTION: SEC2---

**Inputs Used and Methodology**

- **Problem research:** `v1/01_research.md` — AS-IS forensics, personas' trust stakes, chargeback governance patterns.
- **Personas:** `v1/02_cx_personas.md` — 5 R1 personas; brand-relevant traits: Approver = non-technical, es-first, interrupt-driven; Finance pair = evidence-driven skeptics; Group Admin = expert bilingual operator; End User = consumer-grade expectations.
- **Company context:** corporativo. Design System package (official, brandbook-derived): `readme.md` (brand essentials, content fundamentals, visual foundations, iconography), `styles.css` + token files, 14 React components, guideline cards, building photography, logo lockups (`corporativo-*.png`; legacy QPH bars **deprecated**).
- **Method:** desk analysis of the DS package (primary/official source — no web research needed; the package itself records provenance against `brandbook_qph.pdf`); personas → tone calibration per locale; journeys' vocabulary lock → microcopy seeds. No missing inputs; the only ambiguity found is the orange discrepancy the DS itself documents (resolved as DEC-SMP-010).

---SECTION: SEC3---

**Brand Scenario and Initial Conclusion**

**SCENARIO_A — Existing Brand.** Evidence: a complete, current, officially-derived design system with tokens, components, content rules, and logo artwork; verified against the corporate brand manual; including explicit voice/casing/hashtag conventions and accessibility notes.

Current brand at a high level:
- **"corporativo."** wordmark (orange infinity "co" ligature, gray lowercase, orange final period) on the corporativo. umbrella; young-audience voice: professional but warm and optimistic, Spanish-first.
- Orange = optimism/sociability/creativity, rationed to one accent at a time; corporate grays = neutrality/quality/sophistication doing all structural work; lots of white space, few elements per view.
- Barlow everywhere (Black uppercase for headlines — the brandbook's signature), Josefin Sans Light reserved for logo lettering.
- Flat surfaces (white / ink `#3d3d3d`), no gradients, gray-tinted shadows, 4px spacing scale, 16px card radius, Lucide-style flat pictograms, **no emoji**.
- Area colors exist for corporativo. service areas (one color per service, accent-only) — relevant later if Ledger surfaces per-area communications; not used in R1.

---SECTION: SEC4---

**Brand Essence and Positioning**

- **Essence (existing brand, applied):** *"Claridad corporativa con calidez"* — corporate clarity with warmth. For Ledger specifically: **"Cada licencia, un solo registro"** (tagline already in `project_configs.branding`) — every license, one register: the calm, evidence-backed source of truth.
- **Product positioning (internal):** For the corporativo. building's approvers, finance teams, and employees who need SaaS licenses governed and fairly charged back, **Ledger** is the group's license operations platform that turns requests into attributed, monitored seats with defensible monthly statements — unlike chat + console + spreadsheets, because every state, seat-day, and decision is recorded and traceable.
- **Alignment check:** the corporativo. voice (warm, clear, uncluttered, young-workforce) aligns naturally with Ledger's CX needs (one-minute approver decisions, dispute-killing statements). One tension: brandbook headlines are UPPERCASE Barlow Black with orange — in a dense ops UI this must be **reserved for page titles and section headers** (`SECCIÓN | TÍTULO` pattern), never table headers or chips, or the "rationed orange / few elements" rule collapses. Guideline in SEC8.

---SECTION: SEC5---

**Brand Personality, Values and Tone of Voice**

Primary personas for tone: **Company Approver** (es, non-technical, episodic) and **Company/Central Finance** (es, evidence-driven); secondary: Group Admin + End User (bilingual).

- **Personality attributes:** claro (clear) · confiable (trustworthy) · sereno (calm/unhurried) · cercano (approachable-warm) · riguroso (rigorous).
- **Core values:** transparencia · evidencia · equidad entre compañías · respeto por el tiempo · sobriedad.
- **Tone of voice (cross-locale):** direct and factual, warm but never chatty in operational surfaces; numbers always with context (as-of dates, evidence links); imperative microcopy for actions; zero blame language in alerts (systems fail, people are notified). **Do:** "Aprueba o rechaza con un comentario", freshness labels, plain names for states. **Don't:** vendor jargon on approver/finance surfaces (no "seat tier", no API terms), no emoji ever (brand rule), no exclamation-mark enthusiasm in finance contexts, no silent failures dressed as empty states.

#### Voice in `es-EC` (primary)

- **Formality register:** **tú everywhere** (operator-confirmed 2026-07-22): informal, warm, direct across ALL surfaces — requester flows, approver queue, finance and statements ("Revisa el detalle de tu estado de cuenta"). Matches the corporativo. young-workforce voice; documents stay factual and sober in content while keeping the tuteo when addressing the reader.
- **Regional vocabulary (product term locks):** license → **licencia** (vendor-neutral; never "asiento" standalone — "seat" localizes as **licencia** or **licencia/puesto Claude** on first mention) · request → **solicitud** · approver → **aprobador/a** · statement → **estado de cuenta** · monthly close → **cierre mensual** · reconciliation → **conciliación** · chargeback → **cargo interno** (avoid anglicism) · pool → **cupo disponible** · joiners/leavers → **altas/bajas** · proration → **prorrateo** · audit trail → **registro de auditoría**.
- **Tone calibration:** Ecuadorian business Spanish is courteous and slightly formal; avoid Spain-isms ("móvil", "vale") and avoid over-apologizing — state facts + next step.
- **Sample microcopy (es-EC / en-US):**
  - Welcome banner: "Bienvenido a Ledger — el registro de licencias del grupo." / "Welcome to Ledger — the group's license register."
  - Primary CTA: "Solicitar licencia" / "Request a license"
  - Empty state (queue): "No hay solicitudes pendientes. Te avisaremos por correo cuando llegue una." / "No pending requests. We'll email you when one arrives."
  - Validation error: "Esta persona ya tiene una licencia activa (ver asignación existente)." / "This person already holds an active license (see existing assignment)."
- **Known pitfalls:** literal en→es of "Blocked: No Seat" ("Bloqueado: sin asiento") reads as furniture — use **"Bloqueada: sin licencia disponible"**; keep the tuteo consistent — mixing in usted reads as distant/bureaucratic against the confirmed voice.
- **Translation source:** LLM-generated — **flagged for human review before production** (DEC-125 pattern).

#### Voice in `en-US` (secondary)

- **Formality register:** professional-neutral, contractions allowed outside finance documents; statements/PDFs avoid contractions.
- **Vocabulary:** license (seat only when Claude-specific and first-mention glossed) · request · approver · statement · monthly close · reconciliation · chargeback · pool · joiners/leavers · proration.
- **Tone calibration:** English defaults blunter — soften with structure (state + reason + next step), not with apologies.
- **Sample microcopy:** see side-by-side pairs above.
- **Known pitfalls:** en copy that sounds curt in alerts ("Provisioning failed.") — always append the next step ("Provisioning failed — retried automatically; see the action log.").
- **Translation source:** LLM-generated — flagged for human review.

**Status-chip vocabulary (the 12-state lock, es/en pairs — feminine agreeing with *solicitud*):**

| State (en, chip) | Chip es-EC |
|---|---|
| Submitted | Enviada |
| Pending Approval | Pendiente de aprobación |
| Approved | Aprobada |
| Blocked: No Seat | Bloqueada: sin licencia disponible |
| Provisioning | Aprovisionando |
| Failed | Fallida |
| Invited | Invitación enviada |
| Active | Activa |
| Flagged Inactive | Marcada inactiva |
| Offboarding | En retiro |
| Deprovisioned | Retirada |
| Rejected | Rechazada |

---SECTION: SEC6---

**Value Proposition and Key Messages**

- **Core value proposition:** *Ledger convierte cada solicitud de licencia en un asiento atribuido, monitoreado y cobrable — con evidencia.* (Ledger turns every license request into an attributed, monitored, chargeable seat — with evidence.)
- **Key messages:**
  1. *"De la solicitud a la licencia en un día"* — functional; personas: End User, Approver; proof: G1 SLA (≤ 1 bd, ≤ 15 min post-approval automated).
  2. *"Cada día de licencia pertenece a una sola compañía"* — functional/trust; personas: Finance pair; proof: register + DB-level integrity (DEC-SMP-009).
  3. *"Estados de cuenta que se defienden solos"* — emotional (dispute relief); personas: Company Finance, Central Finance; proof: line → register row → raw payload traceability.
  4. *"Nada falla en silencio"* — risk-neutralizing; personas: Group Admin, Approver; proof: explicit Blocked/Failed states, freshness labels, drift alerts.
  5. *"Recupera antes de comprar"* — functional/economic; persona: Group Admin; proof: purchase-or-reclaim flow with inactive candidates beside prorated cost. *(Hypothesis until first optimization cycle data.)*

---SECTION: SEC7---

**Visual Identity and Design System**

Existing visual guidelines (from the DS package), applied to Ledger's UI — all values enter via **theme tokens** (DEC-SMP-005):

- **Color tokens (corporativo. default theme):**
  - `--accent` **#e7851a** (brand orange — DEC-SMP-010; hover `#c96f12`; the documented alternative `#f06820` is a one-token swap if corporativo. confirms the rebrand value).
  - Grays: `#c0bfc0` / `#949394` / `#787474` / `#595756` (structure, borders, secondary text); ink `#3d3d3d` (dark surfaces); light fill `#f2f2f2`; hairline `#e3e2e2`.
  - Surfaces flat white or ink; **no gradients**; gray-tinted shadows only (`rgba(89,87,86,…)`), 3 steps.
  - **Status colors for state chips (Ledger addition, from the DS status-colors card direction):** success/active green, warning/pending amber, error/blocked red, neutral gray for terminal states — exact ramp defined at Step 6 with WCAG AA verification on white and `#f2f2f2`; orange is NOT a status color (it stays the action accent).
- **Typography:** **Barlow** for everything — Black 900 uppercase page/section titles (the `SECCIÓN | TÍTULO` pattern with the orange bar), SemiBold 600 leads/labels, Regular 400 body (1.5 line-height), Italic for role pills; tabular numerals for money/tables (Barlow supports lining figures — verify tabular spacing at Step 6). **Josefin Sans Light: logo lettering only, never UI.** Self-hosted woff2 (in the DS package).
- **Logo:** "corporativo." lockups — positive on light, `-negativo` on dark, `-blanco` on orange; mark alone only at favicon size. Legacy corporativo. bars deprecated — never use. Ledger product lockup: "Ledger" set in Barlow beside the corporativo. mark (A-BR-1, confirm).
- **Iconography:** **Lucide**, 2px stroke, flat, one figure per icon; icon tiles = white pictogram on colored rounded square; **no emoji anywhere** (brand rule; personas anti-pattern).
- **Imagery:** minimal for an ops tool — building photography reserved for login/empty-state moments at most, with the dark `#1d1d1d` protection veil; no decorative photography inside work surfaces.
- **Accessibility (from the DS, binding):** orange on white fails AA for small text → orange only for large elements/fills/focus ring; body text = gray-700-equivalent (`#595756`) on white; visible orange focus ring (2–3px) always; tap targets and table density per Step 6.
- **Customizability seam (DEC-SMP-005):** all of the above ships as CSS custom properties / DS tokens (`--accent`, gray ramp, font stack, logo asset slots, status ramp) — corporativo. values are defaults; a deployment re-brands by overriding the token layer, never by touching components.

**Reference application style (binding — DEC-SMP-012).** An in-production corporativo. internal ops tool (job-register admin app; screenshot archived at `ClientDocs/style-reference-registro-de-trabajos.jpeg`) demonstrates the exact chrome Ledger must match:

- **Dark ink sidebar chrome:** near-black charcoal rail; item labels in light gray; small **uppercase orange section labels** (e.g. "ADMINISTRACIÓN"); the **active item is a filled orange rounded block** — the one orange element in the rail (rationed-accent rule holds).
- **Light warm-gray canvas** with a white content panel; orange breadcrumb links above the title.
- **Display page titles:** very large **UPPERCASE condensed Barlow Black** (condensed cut — exact family `Barlow Condensed`/`Barlow Semi Condensed` Black to be verified at Step 6), ink gray, wrapping to two lines with `·` separators between title segments.
- **Metadata line** under the title: gray, middot-separated facts (trigger · actor · timestamps · run ref).
- **Stat tiles:** row of white cards (16px radius, soft shadow) — small gray label over a huge bold numeral.
- **Status pills:** soft-tinted pill + colored dot + label (reference shows red "Fallido") — confirms the Step-6 status ramp direction; orange never does status duty.
- **Callout pattern:** soft amber background, **orange left border**, bold title + factual body, **right-aligned actions** — subtle gray secondary beside a filled-orange primary.
- **Tabs with counts** ("Artefactos (0)"), active tab = semibold + orange underline.
- **Buttons:** primary = filled orange, ~8px radius; secondary = quiet light-gray fill.
- **Tone proof:** the reference's own copy — *"La brecha queda registrada — sin pérdida silenciosa"* — is experience principle 3 ("states, not silence") already shipping in the family. Ledger continues this voice.

---SECTION: SEC8---

**Experience Principles (CX/UX)**

1. **Evidence at arm's reach** — every number opens its source (statement line → register rows → raw payload). Critical: J3 statements, reconciliation. Practice: drill-down affordances, "ver evidencia" links, no dead-end totals.
2. **One accent, one action** — rationed orange marks the single primary action or the single live alert per view. Critical: approval queue, dashboards. Practice: one orange CTA per screen; secondary buttons outlined gray; never orange table text.
3. **States, not silence** — the 12-state vocabulary is the interface's backbone; every wait shows its state and its clock. Critical: J1 status page, J4 exception queues. Practice: status chips (SEC5 pairs) everywhere a request appears; freshness labels ("datos al 19-jul") on every usage figure; staleness is a visible state.
4. **One-minute decisions** — approver surfaces carry full context in one card (requester, justification, cost, budget headroom) with inline approve/reject. Critical: J1 S2. Practice: no navigation required to decide; mandatory comment only on reject; email deep-links land on the scoped card.
5. **Calm forms, honest errors** — validations explain and point ("ya tiene una licencia activa — ver asignación"); errors state fact + next step; no blame, no jokes. Critical: S1 intake. Practice: inline validation, es/en per user, empty states that say what will happen next.
6. **Respect the reader's scope** — company-scoped users see a complete, coherent world of exactly their company; no grayed-out hints of other tenants. Critical: all finance surfaces. Practice: scoped navigation, scoped exports, per-company statement header with company code.
7. **Expert surfaces may be dense, never cluttered** — Group Admin views (pools, drift, credentials) allow tables-first density but keep corporativo. air: hairline dividers, 4px scale, uncluttered headers. Critical: J4. Practice: `SECCIÓN | TÍTULO` headers, data tables with tabular numerals, no decorative elements.

---SECTION: SEC9---

**Messaging and Microcopy Examples**

1. **Login screen headline** — "EL REGISTRO DE LICENCIAS DEL GRUPO" (Barlow Black uppercase + orange period motif). Persona: all. Reflects: clarity + brandbook signature casing.
2. **Approval email subject** — es: "Nueva solicitud de licencia — Ana Suárez (Right Angle Media)" / en: "New license request — Ana Suárez (Right Angle Media)". Persona: Approver. Reflects: direct, complete context, zero fluff.
3. **Blocked state notice (requester)** — es: "Tu solicitud está aprobada, pero no hay licencias disponibles en este momento. El administrador ya fue notificado; te avisaremos apenas se libere o compre una." Persona: End User. Reflects: honesty + next step, no apology spiral.
4. **Reclamation proposal (approver)** — es: "Marcos Vera no usa su licencia desde el 12 de mayo (62 días). ¿Quieres liberarla para el cupo del grupo? No se retirará sin tu aprobación." Persona: Approver. Reflects: evidence + consent, never silent removal.
5. **Reconciliation success (finance)** — es: "Cierre de agosto conciliado: diferencia 0,3% (USD 27,10) — dentro de la tolerancia. Ver detalle por línea." Persona: Central Finance. Reflects: numbers with context + drill-down.
6. **Provisioning failure (admin alert)** — en: "Provisioning failed for REQ-0142 (API 500). Retried automatically — see the action log. The request stays in Failed until a retry succeeds." Persona: Group Admin. Reflects: no silent failure, factual calm.

**Anti-pattern microcopy (never ship):** "¡Ups! Algo salió mal 😅" (emoji + vagueness) · "Seat tier could not be resolved" on an approver surface (vendor jargon) · "Sin datos" as an empty state (no next step) · enthusiasm in finance copy ("¡Felicidades por tu cierre!").

---SECTION: SEC10---

**Risks, Gaps and Recommendations**

- **Corporate-vs-product consistency:** Ledger must not drift from corporativo. while also not painting finance surfaces "young" — the split-register voice (SEC5) is the mitigation; review with corporativo. brand owner. **Quick win:** adopt the DS's existing components/tokens as-is at Step 6.
- **A-BR-1 (logo lockup):** in-app "Ledger" product lockup beside the corporativo. mark needs brand-owner sign-off; fallback = corporativo. logo alone + "Ledger" as UI title.
- **Orange token risk (DEC-SMP-010):** if corporativo. later confirms `#f06820`, hover/soft ramps must be regenerated, not just the base token — Step 6 must derive hover/soft from the base token so the swap stays one-line.
- **Register-of-voice:** RESOLVED — operator confirmed informal **tú** across all surfaces (2026-07-22); monitor approver adoption (A-J1) in the pilot as planned.
- **Human review gate:** all LLM-generated es/en microcopy in this report is production-blocked until human review (DEC-125 pattern) — track at Step 7 copy pass.
- **Next steps:** Step 6 formalizes tokens/ramps/WCAG proofs + Barlow tabular-numeral check; Step 7 applies chip vocabulary + microcopy; validate name-in-app lockup and voice register with Francisco/corporativo. before mock generation.

---SECTION: SEC11---

**Traceability of Sources and Inputs**

- **Official (facts):** `ClientDocs/QPH Design System.zip` — readme (brand essentials, content fundamentals, visual foundations, iconography rules), token CSS, components, guideline cards, logo assets; itself verified against `brandbook_qph.pdf` (Manual de Identidad Corporativa) and the ATISCODE slide template. All color/type/spacing/voice-casing facts in SEC3/SEC5/SEC7 come from this package.
- **Reference application (facts, operator-supplied 2026-07-22):** `ClientDocs/style-reference-registro-de-trabajos.jpeg` — screenshot of an in-production corporativo. internal ops tool; source of the binding app-chrome patterns in SEC7 (DEC-SMP-012): dark sidebar + orange active block, condensed uppercase display titles, stat tiles, amber callout with right-aligned actions, count tabs, status pills.
- **Internal inputs:** PRD v2.2 (problem, goals, personas §7), `01_research.md` (AS-IS, trust stakes), `02_cx_personas.md` (tone calibration, anti-patterns), `03_cx_journeys.md` + extract (12-state vocabulary lock), `04_er_model.md` (state enum, `Company.statement_language`), DECISION_MATRIX (DEC-SMP-004/005, OQ-SMP-8/9 → DEC-SMP-010/011).
- **Interpretation:** application of corporativo. rules to ops-tool surfaces (SEC8 principles), status-color direction (from the DS status card, exact ramp deferred to Step 6). Voice register: informal tú everywhere — operator-confirmed fact, not interpretation (DEC-SMP-013).
- **Hypotheses (flagged):** A-BR-1 product lockup; key message 5 (reclaim economics); all sample microcopy (LLM-generated, human review pending).
- **Web research:** none required — the official package is local and current (SCENARIO_A with complete assets).
