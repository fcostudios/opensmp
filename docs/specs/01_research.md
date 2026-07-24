# Step 1 — Research: SaaS License Lifecycle Management (Ledger)

> **Project:** `fcostudios__smp` · **Product:** Ledger · **Org:** FcoStudios (operating context: QPH / "corporativo." group) · **Date:** 2026-07-22 · **Language:** en-US (DEC-003 workspace)
> **Process under analysis:** multi-company SaaS license lifecycle — request → approval → provision → monitor → reallocate → deprovision → charge back. Phase 1 vendor: Claude (Anthropic) Enterprise seats.
> **Prior work:** `PRD.md` (Ledger PRD v2.2, stakeholder-confirmed 2026-07-22) + `PRODUCT_BRIEF.md` + DEC-SMP-001..009. This report validates and expands — it does not re-litigate confirmed decisions.
> Release legend: 🟢 R1 · 🟡 R2 · 🔴 R3+ · 🔵 cross-release.

---

## [0] Executive Summary

The process is the **complete lifecycle of paid SaaS seats** across ~30 companies operated under the QPH ("corporativo.") group's centralized management. Today the process exists only as chat/email requests resolved by hand against the Anthropic admin console; there is no system of record linking any seat to the company consuming it, and finance receives one consolidated invoice with no per-company breakdown. Ledger replaces this with an active workflow engine plus an append-only attribution register.

**Key insights (validated this step):**

1. **The automation window is real and current.** Anthropic's Admin API now covers claude.ai Enterprise membership end-to-end in beta — list/lookup members, send/withdraw invites (an invite consumes a seat), remove members (frees a seat), change roles, group management — with member/invite endpoints requiring **no beta header** (only group/custom-role calls need `ce-user-management-2026-07-13`). The PRD's §8 grounding is confirmed, and is slightly conservative: role changes, custom-role reads, and spend-limit endpoints also exist. 🟢
2. **One correction to the PRD's connector table:** ChatGPT Enterprise workspace membership is managed programmatically **only via SCIM 2.0** (`https://api.openai.com/scim/v2`, static bearer token) — there is no separate general-purpose REST admin API for membership. The future OpenAI connector is therefore a *SCIM client*, not a REST twin of the Anthropic connector. This strengthens, not weakens, the vendor-neutral core argument: the connector contract must tolerate SCIM-shaped, REST-shaped, and no-API vendors. 🔴 (design impact 🟢)
3. **The commercial SMP category is mature but mispriced for this context.** Torii, Zylo, Zluri, BetterCloud, Josys et al. charge per-employee (≈ $3–15/user/month); at QPH's ~1,000-person scale that is ≈ $36K–$100K+/yr — and their differentiating capability (shadow-IT discovery across hundreds of apps) is explicitly a non-goal for Phase 1. Build-vs-buy stays "build," with a Phase 3+ re-checkpoint (PRD §6, §12). 🔵
4. **Attribution is structurally unavailable from the vendor.** In a shared Anthropic Enterprise org, Anthropic provides no per-company cost breakdown; the gap-free/overlap-free seat register (DEC-SMP-009) is the only defensible source. This is the product's irreducible core. 🟢
5. **The mixed-org reality (D1/DEC-SMP-006) is the main operational complexity driver:** seat pools, alerts, credentials, and sync are per-org; cross-org "moves" are two operations; consolidation onto the central org is the economically correct end-state that Ledger's own utilization data should motivate. 🟢

**Key recommendations:** ship the state machine + register first and run it in orchestration mode before enabling automation (PRD Sprint 1 sequencing is correct); enforce register integrity at the database level; treat freshness labeling as a first-class UI element (Analytics lag ~3 days); model the OpenAI connector as SCIM-based in Module I's capability descriptor; keep per-employee-priced commercial SMPs as the Phase 3+ benchmark, not the MVP path.

**Expected impact:** request→active seat drops from days-of-chat to ≤ 1 business day (≤ 15 min post-approval automated); monthly close from manual reconstruction to business-day-3 statements reconciling within 0.5%; ≥ 90% seat activity after the first reclamation cycle; measurable deferral of seat purchases via reclaim-before-buy.

---

## [1] Business Context and Objectives

### 1.1 Organization and Industry Context

**QPH — Quito Publishing House ("corporativo.", June 2026 rebrand)** is a corporate building and centrally-managed group in Quito, Ecuador, housing ~30 operating companies and shared services, including sub-brands Kickoff, Opina, Right Angle Media, PPM (media/advertising), Focus (research), and Atis/Ketchum affiliates. Characteristics relevant to this process:

- **Centralized shared services, decentralized consumption.** IT/platform administration (Francisco, Group Admin) is central; the consuming employees and their budgets belong to 30 distinct companies. Ecuador uses USD (no FX complexity, PRD A5).
- **Media/creative/knowledge-work profile** → high Claude Enterprise affinity (chat + Claude Code + Cowork usage), volatile headcount per company (joiners/leavers/movers are frequent), strong sensitivity to per-company cost fairness.
- **Group-internal chargeback culture:** each company's finance team expects a defensible monthly figure; central finance reconciles against the single Anthropic invoice. Statements are reconciliation-grade, not legal invoices (non-goal).
- **Future intent:** externally billed client companies (MSP mode) — drives R3+ isolation/markup requirements only, but justifies building the register correctly now.

### 1.2 Strategic Objectives of the Process

- **Why it exists:** convert "an employee needs Claude" into "an active, attributed, monitored seat" with control, speed, and an audit trail; make every seat-day chargeable to exactly one company.
- **How success is measured today:** it isn't — numbers are reconstructed by hand, late, disputed. Baseline metrics are effectively: request lead time unknown (days-to-weeks), attribution coverage ~0%, reconciliation confidence low.
- **How it should be measured (PRD §17, adopted):** G1 request→active ≤ 1 business day (p90); G2 100% seat-days attributed; G3 statements by business day 3 reconciling within 0.5%; G4 ≥ 90% monthly-active seats; G5 company #31 onboarded in < 30 min; G6 MVP in ~4 weeks.
- **Strategic alignment:** cost discipline across the group; enablement of AI adoption (seats flow to active users); groundwork for multi-vendor license governance (M365, other LLMs, SAP B1) and eventually MSP revenue.

---

## [2] AS-IS Process Description

### 2.1 High-Level Value Stream (AS-IS)

1. Employee (or their manager) asks for Claude access via chat/email/word-of-mouth.
2. Message eventually reaches whoever holds Anthropic console access (Group Admin).
3. Ad-hoc approval — sometimes the company GM is consulted, sometimes not; no recorded decision.
4. Group Admin manually sends an invite from the Anthropic console (if a seat is free; pool status is guesswork).
5. User accepts (or the invite silently expires); nobody tracks pending invites (which consume seats).
6. Usage is never reviewed; idle seats persist indefinitely; departures are deprovisioned late or never.
7. Anthropic invoice arrives consolidated; central finance allocates cost by memory/spreadsheet; companies dispute.

### 2.2 Detailed Step-by-Step Flow (AS-IS)

| # | Activity | Description | Role(s) | Inputs → Outputs | Systems | Rules/validations |
|---|----------|-------------|---------|------------------|---------|-------------------|
| A1 | Request capture | Chat/email ask, free-form | End user, manager | need → message thread | WhatsApp/email | none |
| A2 | Routing | Thread forwarded until it reaches console holder | Various | message → backlog item (implicit) | chat/email | none |
| A3 | Approval (implicit) | Sometimes a GM says yes; often skipped | Company GM, Group Admin | justification → verbal OK | chat | none recorded |
| A4 | Seat check | Console glance; purchased vs assigned counted by eye | Group Admin | console → free-seat guess | Anthropic console | 400-on-invite is the de-facto pool check |
| A5 | Invite | Manual console invite | Group Admin | email → pending invite (consumes seat) | Anthropic console | lowest-tier auto-assignment |
| A6 | Acceptance follow-up | None; invites silently expire | — | — | — | none |
| A7 | Usage review | None | — | — | — | none |
| A8 | Offboarding | Departure noticed late via hearsay; manual removal | Group Admin | HR hearsay → removal | Anthropic console | none; no end-date recorded |
| A9 | Invoice allocation | Manual spreadsheet split of the consolidated invoice | Central finance | invoice → per-company figures | Excel, email | reconstructed, disputed |

### 2.3 Actors, Roles and Responsibilities (AS-IS)

- **Group Admin (Francisco):** single point of console access; de-facto approver, provisioner, and pool manager. Bottleneck and bus factor.
- **Company GMs/IT leads:** approve informally when asked; no queue, no SLA, no visibility.
- **Company finance admins:** receive reconstructed numbers; dispute them.
- **Central finance:** allocates the invoice by hand; owns the disputes.
- **End users:** no status visibility; chase via chat.

### 2.4 Systems, Data and Integrations (AS-IS)

- **Systems:** Anthropic admin console (claude.ai Enterprise, one per org), chat (WhatsApp), email, ad-hoc spreadsheets. No workflow system, no register, no alerting.
- **Data objects (implicit, unrecorded):** request, approval, seat assignment, seat pool, invoice allocation — none exist as durable records; the Anthropic member list is the only (per-org, company-blind) truth.
- **Manual transfers:** every hop is copy/paste between chat, console, and spreadsheet. The consolidated invoice → per-company split is the most error-prone manual transfer.

---

## [3] Pain Points, Risks and Constraints

### 3.1 Identified Pain Points

- **People:** single console holder (bottleneck, bus factor); approvers have no queue; finance admins re-litigate numbers monthly.
- **Process:** no defined path request→seat; no SLAs; no reclamation loop; departures leak seat-days; pending invites silently consume seats for weeks.
- **Technology:** console-only administration; no API usage; no pool telemetry; no per-company view; mixed-org reality administered org-by-org with separate credentials.
- **Data:** zero attribution records; no history of who held a seat when; usage data (available via Analytics API) entirely unused; invoice split reconstructed.
- **Governance/Compliance:** no audit trail of approvals/provisioning; no evidence for chargeback disputes; console access ungoverned.

### 3.2 Root-Cause Analysis

- The **root cause is the missing system of record**, not people: every symptom (late provisioning, idle seats, disputed statements) traces to the absence of a durable request/assignment register with enforced states.
- Secondary cause: **console-centric operations** — Anthropic's console is per-org and company-blind, so no amount of console discipline yields per-company attribution.
- Tertiary cause: **no feedback loop from usage to allocation** — Analytics data exists but nothing consumes it.

### 3.3 Business Risks (AS-IS)

- **Financial:** paying for idle/departed seats (at contracted per-seat rates × 30 companies this compounds); over-purchasing seats because reclaim is invisible; mis-allocated chargeback eroding trust between companies and center.
- **Operational:** urgent requests blocked on one person; silent invite expiry; drift between who-should-have and who-has access.
- **Compliance/audit:** no evidence chain for who approved what; departures retaining access to an AI tool holding company conversations.
- **Reputational (internal):** monthly statement disputes; perception of arbitrary cost allocation.

### 3.4 Constraints

- **Anthropic platform constraints (verified, PRD §8):** seat inventory bought/reduced only in the vendor UI (min 20 seats/org, prorated additions, renewal-only reductions); User Management API is **beta**; endpoints rejected where SCIM/JIT is active; Analytics lag ~3 days; rate limits 100 req/min (UM), 60 req/min (analytics), 1,200 invites/hour.
- **Organizational:** D1 mixed-org reality (central shared org + carve-outs, each with its own 20-seat floor and stranded-pool economics); one-developer-plus-Francisco build capacity (D3); 4-week MVP window (D4).
- **Budget:** hosting < $100/month; total cost must stay materially below commercial SMP pricing.
- **Non-negotiable design rules already decided:** orchestration mode permanent (DEC-SMP-007); vendor-neutral core (DEC-SMP-008); DB-level register integrity (DEC-SMP-009).

---

## [4] External Benchmarks and Best Practices

### 4.1 Reference Models

- **SAM/ITAM (ISO/IEC 19770 family):** software asset management prescribes an authoritative license register, entitlement vs. consumption reconciliation, and lifecycle governance — Ledger's register + reconciliation view is a lightweight SAM implementation for seat-based SaaS.
- **JML (Joiner–Mover–Leaver) lifecycle:** the identity-governance pattern behind Modules B/C — every seat event is a JML event with an approval, an execution, and an audit record. Ledger's state machine (§10 of the PRD) is a JML specialization.
- **FinOps chargeback/showback:** allocate 100% of spend to consuming units on a defensible driver (here: seat-days from the register; usage-based components mapped per-user), publish on a fixed cadence, reconcile to the vendor invoice within a tolerance, govern exceptions explicitly. Ledger's Module E is a textbook chargeback implementation with a 0.5% reconciliation tolerance.
- **Procure-to-pay (approval workflow):** aging + escalation + delegation on approvals (Module B P0/P1) mirrors P2P best practice.

### 4.2 Peer and Industry Comparisons

- Organizations at 500–2,000 employees typically adopt a commercial **SMP** (SaaS Management Platform) once app count and spend justify it; the category's center of gravity is **shadow-IT discovery** (browser extensions, SSO logs, finance-system ingestion) plus renewals management. That capability is Ledger's explicit non-goal — the group's problem is deep lifecycle control of a few high-value vendors across many *internal companies*, a multi-entity chargeback shape most SMPs treat as an edge case (their tenancy model assumes one company).
- Typical automation levels: manual (console + spreadsheet — QPH today) → semi-automated (ticketing + runbooks) → fully automated JML via IdP/SCIM (mature enterprises). Ledger targets full automation for Claude (API) with a designed manual mode — an unusual and deliberate hybrid that fits beta-API risk.

### 4.3 Comparative Table

| Dimension | AS-IS (QPH today) | Best practice | Gap / Comment |
|---|---|---|---|
| Request capture | Chat/email, free-form | Structured form + validations + duplicate check | Full gap — Module B 🟢 |
| Approval | Implicit/verbal | Designated approver, SLA 2 bd, aging + escalation, recorded decision | Full gap — Module B 🟢 |
| Provisioning | Manual console, single operator | API-automated ≤ 15 min post-approval, manual fallback | Full gap — Module C 🟢 |
| Pool management | Eyeball count | Per-org purchased/assigned/pending/free + low-pool alert + purchase-or-reclaim | Full gap — Module C 🟢 |
| Usage feedback | None | Daily activity sync, 30/60/90-day inactivity flags, reclaim proposals | Full gap — Module D 🟢 |
| Attribution | None | Append-only register, gap/overlap-free, DB-enforced | Full gap — Module E, DEC-SMP-009 🟢 |
| Chargeback | Manual reconstruction | Statements by business day 3, reconciled ≤ 0.5%, traceable to register rows | Full gap — Module E 🟢 |
| Audit | None | Immutable log of transitions/approvals/API calls/config/logins | Full gap — Module H 🟢 |
| Vendor breadth | Claude only, untracked | All licensed SaaS under one register (registry + connectors) | Phased — Module I 🟡→🔴 |

*Sources: SMP vendor documentation and comparison pages (BetterCloud, Zylo, Josys, SpendHound roundups), ITAM/FinOps reference practice, PRD v1 build-vs-buy appendix (Gartner MQ 2026, Vendr pricing data).*

### 4.4 Commercial SMP landscape & build-vs-buy validation 🔵

- Per-employee pricing dominates the category (≈ **$3–15/user/month**; BetterCloud publicly "from $3/user/month"; Zluri/Torii/Zylo custom-quoted). At ~1,000 people that is **≈ $36K/yr floor, $100K+/yr realistic** — matching the PRD's $36K–$100K+ range and its Phase 4 build-vs-buy checkpoint.
- The paid capability (discovery across hundreds of apps) is a non-goal; the needed capability (multi-company chargeback on a shared vendor org) is weak-to-absent in the category. **Build decision re-validated.** Re-check at Phase 3+ when vendor count grows (PRD §6). 
- The **$16K/yr per-connector maintenance baseline** (PRD v1 analysis, carried into Module I) remains the right discipline for adding live connectors by spend concentration.

---

## [5] TO-BE Process and Automation Opportunities

### 5.1 Target Design Principles

1. **Workflow over visibility** — every seat event flows through the state machine; dashboards are a by-product. 🟢
2. **Register as source of truth** — attribution comes from Ledger, never reconstructed from the vendor. 🟢
3. **Automate with a designed manual mode** — orchestration mode is permanent, not scaffolding (DEC-SMP-007). 🟢
4. **Vendor-neutral core, vendor-specific edges** (DEC-SMP-008): the core never learns Claude. 🟢
5. **No silent failure** — every job idempotent; failures alert; staleness labeled. 🟢
6. **Per-org everything** (DEC-SMP-006): pools, credentials, sync, alerts scoped to the Anthropic org. 🟢
7. **Reclaim before buy** — inactivity candidates always shown next to purchase cost. 🟢

### 5.2 TO-BE High-Level Process

1. Request submitted (form; validations: duplicate, domain, company active, budget headroom soft-check) → **Submitted → Pending Approval**.
2. Approver decides from their queue (SLA 2 bd; reminder 24 h; escalation 48 h) → **Approved / Rejected**.
3. Engine provisions: free seat → API invite ≤ 15 min (**Provisioning → Invited**); pool empty → **Blocked: No Seat** + purchase-or-reclaim task.
4. User accepts; member sync confirms → **Active**; seat-days accrue to the company in the register.
5. Daily analytics sync feeds 30/60/90-day inactivity flags → reclamation proposals (never silent removal).
6. Offboarding (departure/reclaim/transfer) → API removal or checklist → **Deprovisioned**; register row closes; pool increments.
7. Monthly close (business day 3): 30 statements + central rollup; reconciliation vs. invoice ≤ 0.5%; exports CSV/PDF.

### 5.3 Detailed Automation Opportunities

| Activity | Automation | Pattern | Benefit |
|---|---|---|---|
| Request intake | Form + server validations + duplicate detection | Workflow orchestration | Kills A1/A2 routing loss 🟢 |
| Approval | Queue + notifications + aging/escalation; delegation 🟡; policy auto-approve 🔴 | Workflow + decisioning | SLA-bound decisions, recorded 🟢 |
| Provisioning | `POST /v1/organizations/invites` on approval; poll membership; withdraw stale invites | API integration | ≤ 15 min, zero admin touch 🟢 |
| Deprovisioning | `DELETE /v1/organizations/users/{id}`; scheduled offboarding 🟡 | API integration | Same-day departures, freed pool 🟢 |
| Pool management | Live per-org counters + low-pool alert + purchase-or-reclaim task | Telemetry + alerting | No more 400-surprises 🟢 |
| Usage monitoring | Daily Analytics sync; inactivity windows; freshness labels | Data sync + anomaly detection | Reclaim candidates surfaced 🟢 |
| Drift detection | Hourly member sync vs. register; discrepancy → alert + claim task | Reconciliation | Console bypass visible in ≤ 1 h 🟢 |
| Monthly close | Deterministic close job: seat-days × effective-dated rates + usage mapping | Batch computation | Business-day-3 statements 🟢 |
| Reconciliation | Rollup vs. invoice with line-level variance | Reconciliation | ≤ 0.5% or explained 🟢 |
| Vendor registry | Manual Vendor/VendorAccount/inventory CRUD + renewal alerts | Registry + alerting | SAP B1 et al. under management 🟡 |
| M365 connector | Graph `assignLicense`/reports/`subscribedSkus` | API integration | Highest-automation vendor #2 🔴 |
| OpenAI connector | **SCIM 2.0 client** (`/scim/v2`) — corrected shape | SCIM integration | LLM vendor #3 🔴 |

### 5.4 Quick Wins vs. Structural Changes

- **Quick wins (build Sprint 1, orchestration mode):** request form + approval queue + register (manual entries) + pool counter + audit log — value before any API code. 🟢
- **Medium-term (Sprints 2–3):** Anthropic automation, analytics sync, inactivity flags, drift detection, monthly close + reconciliation. 🟢
- **Structural (R2/R3+):** manual vendor registry; transfers/delegation/budgets; M365 + OpenAI(SCIM) connectors; IdP-driven provisioning; MSP isolation + markup. 🟡🔴

---

## [6] Technology and Solution Options (Comparative View)

### 6.1 Solution Architecture Overview (directional, per PRD §13 + DEC-SMP-002)

Single Next.js (App Router) application + PostgreSQL + Drizzle; background job runner (pg-boss direction) for sync/close/alert jobs; connector framework behind one interface; Docker Compose deployment (app + db + worker) on a VPS; email delivery for notifications; secrets envelope-encrypted; audit append-only at DB level. Bilingual es/en UI (DEC-SMP-004); QPH-derived themeable design system (DEC-SMP-005).

### 6.2 Verified Vendor API Capability Assessment (re-verified 2026-07-22)

| Vendor | Provision/deprovision | Usage & cost | Verified notes |
|---|---|---|---|
| **Anthropic Claude** (connector #1 🟢) | ✅ Admin API (beta) — invites (consume seat), removal (frees seat), member list/lookup, **role change**, withdraw invites; groups + **custom-role reads** behind `ce-user-management-2026-07-13`; member/invite endpoints need **no beta header**; **spend-limit endpoints** exist | ✅ Analytics API: per-user daily activity (chat/Code/Cowork), DAU/WAU/MAU, seats + pending invites, per-user cost (usage-based plans); ~3-day lag; 60 req/min | PRD §8 confirmed and slightly conservative; scoped Admin key from claude.ai; `read:org_audit`-scoped keys can read all UM GET endpoints. Beta ⇒ re-verify at build Sprint 0 |
| **Microsoft 365** (🔴 first in line) | ✅ Graph `user: assignLicense` / remove (v1.0), group-based licensing via Entra groups; requires Entra app registration per tenant | ✅ Graph reports (per-user service usage, last-activity); license inventory via `subscribedSkus` (skuId, consumedUnits, servicePlans) | Highest automation potential; one VendorAccount per company tenant — D1 multi-account model already covers it |
| **ChatGPT Enterprise / OpenAI** (🔴) | ⚠️ **SCIM 2.0 only** (`api.openai.com/scim/v2`, bearer token from admin console; Enterprise/EDU plans) — create/update/remove users + group-driven assignment; no general REST membership API | ✅ Compliance/usage APIs + workspace analytics (Global Admin Console); details plan-dependent | **Correction to PRD Module I:** connector is a SCIM client. Capability descriptor must model `identityMatching` + SCIM semantics; remaining steps orchestration mode |
| **SAP Business One** (🟡 registry / 🔴) | ❌ No public cloud API for license assignment (license server/SLD on-prem or partner-managed) | ❌ None programmatic | Pure orchestration mode; license types (Professional/Limited/Indirect) as LicenseType dimension; renewal + audit alerts are the value |
| **Any other SaaS** | Manual registry 🟡 | Manual/CSV | Connector only if spend justifies (~$16K/yr maintenance baseline) |

### 6.3 Comparative Analysis — solution options

| Option | Strengths | Weaknesses | Fit for QPH |
|---|---|---|---|
| **Status quo + discipline** (console + spreadsheets) | Zero build cost | Attribution structurally impossible in shared org; bottleneck persists | ❌ already failing at 30 companies |
| **Buy commercial SMP** (Torii/Zylo/Zluri/BetterCloud/Josys) | Mature discovery, integrations catalog, renewals | ≈$36K–$100K+/yr; single-company tenancy assumption; multi-entity chargeback weak; Claude-lifecycle depth absent | ❌ for Phase 1; ✅ re-check at Phase 3+ (build-vs-buy checkpoint) |
| **IdP/SCIM-driven JML** (Okta/Entra push) | Enterprise-grade automation | No SCIM at QPH today (D2); doesn't produce chargeback; Anthropic UM API rejected where SCIM active | 🔴 future composition, not a base |
| **Purpose-built Ledger** (chosen, DEC-SMP-001) | Exact-fit workflow + register + chargeback; self-hosted < $100/mo; vendor-neutral core for expansion | Build + run responsibility; beta-API dependency (mitigated by orchestration mode) | ✅ decision confirmed by this research |

---

## [7] Implementation Roadmap

### 7.1 Phased Plan (adopts PRD §16; validated against research findings)

| Phase | Target | Scope | Research notes |
|---|---|---|---|
| Build Sprint 0 (days 1–3) 🟢 | Foundations | Repo, CI, Docker Compose, core schema, RBAC skeleton, seed 30 companies. **Gate:** org inventory (OQ-SMP-1) + scoped Admin & Analytics keys per org | Key creation is a primary-owner action per org — first blocker to clear; re-verify beta endpoints/headers here |
| Build Sprint 1 (wks 1–2) 🟢 | Usable workflow | Request/approval/notifications/aging + register (manual) + pool counter + audit | Delivers value in orchestration mode before any API code — validated as best-practice sequencing |
| Build Sprint 2 (wk 3) 🟢 | Automation + monitoring | Anthropic connector (invite/remove/member sync/invite hygiene), Analytics sync, inactivity flags, drift detection, core alerts | Rate limits generous at this scale (100/min UM; 1,200 invites/h) |
| Build Sprint 3 (wk 4) 🟢 | Money | Rate card, monthly close, 30 statements + rollup, reconciliation, CSV/PDF | MVP complete |
| Weeks 5–6 🟢 | Hardening + first close | Parallel run vs. manual process; isolation test suite; backup/restore drill; go-live as system of record | First close is the acceptance test of H2 |
| Weeks 7–8+ 🟡 | Fast-follows | Manual vendor registry (SAP B1 in), transfers, budgets, digests, delegation | Prioritize by observed friction |
| Phase 3+ 🔴 | Multi-vendor | M365 (Graph) → OpenAI (**SCIM**) connectors; BI; MSP; build-vs-buy checkpoint | Connector order by spend concentration |

### 7.2 Change Management and Adoption

- 30 company approvers need a 15-minute onboarding (queue + SLA + reclamation role); finance contacts need the statement walkthrough at first close.
- Parallel-run month (weeks 5–6) is the trust-building device: old manual numbers vs. Ledger statements, variances explained line-by-line.
- Console access restriction (Group Admin only) is a policy change to announce explicitly — drift alerts enforce it thereafter.

### 7.3 Required Capabilities and Roles

- **Build:** Francisco (product owner/platform owner) + 1 developer, AI-assisted (Claude Code) per D3; PRD §11 ACs double as the test plan.
- **Run:** Group Admin (exceptions, pool decisions, credential rotation), company approvers (queue), central finance (close + reconciliation override), per-company finance (statement consumption).
- **Runbooks required before go-live:** seat purchase, credential rotation, restore drill (PRD §15 Maintainability).

---

## [8] KPIs, Metrics and Governance

### 8.1–8.2 Key KPIs (baseline → target)

| KPI | Baseline (AS-IS) | Target | Source |
|---|---|---|---|
| Request → active seat (free seat) | days–weeks, unmeasured | ≤ 1 bd p90; ≤ 15 min post-approval | PRD G1 🟢 |
| Seat-days attributed | ~0% | 100% (gap/overlap-free register) | PRD G2 🟢 |
| Statements by business day 3 | never | 30/30 companies | PRD G3 🟢 |
| Reconciliation variance | unknown/disputed | ≤ 0.5% or line-explained | PRD G3 🟢 |
| Monthly-active / assigned seats | unknown | ≥ 90% after first cycle | PRD G4 🟢 |
| Drift events (console bypass) | constant | 0 after go-live | PRD §17 🟢 |
| Company onboarding | n/a | < 30 min config | PRD G5 🟢 |
| Pending invites > 7 days | untracked | alerted; auto-withdraw after window | Module C 🟢 |
| Monthly close runtime | days of manual work | < 5 min for 30 companies | PRD §15 🟢 |
| New-vendor connector effort | n/a | < 2 wks / 1 engineer | PRD §15 🔴 |

### 8.3 Governance Model

- **Process owner:** Group Admin (Francisco). **Escalation:** approver → Group Admin (48 h auto).
- **Monthly cadence:** close (bd 3) → reconciliation review (central finance; tolerance override is theirs, recorded) → reclamation cycle (inactivity flags → approver sign-off).
- **Quarterly:** access review (🟡 report), rate-card review at renewals (effective-dated), connector roadmap by spend.
- **Continuous:** alert log with acknowledgments; audit trail immutable; freshness/staleness alerts self-report pipeline health.

---

## [9] Risks, Dependencies and Open Questions

### 9.1 Main Risks and Mitigations (PRD §18 validated; research-adjusted)

| Risk | Mitigation | Research note |
|---|---|---|
| Beta UM API changes/regresses | Orchestration mode permanent; raw payloads stored; connector isolated; version/beta headers centralized | Confirmed beta status 2026-07-22; member/invite endpoints header-free today |
| Analytics ~3-day lag misleads | Freshness labels; 30/60/90-day windows; no automated action on activity alone | Lag confirmed in vendor docs |
| Pool exhaustion blocks urgent requests | Low-pool alert (floor 5/org); purchase-or-reclaim flow | Per-org floors matter under D1 mix |
| Shared-org visibility (admins see all members) | Documented as acceptable for related entities; revisit for external clients | Unchanged |
| Registry drift via console | Hourly sync + drift alert + claim task; console access restricted | Drift-to-zero is a PRD success metric |
| Chargeback disputes | Statement→register→raw-payload traceability in UI; central finance owns tolerance | FinOps-standard practice |
| Bus factor (1 dev + Francisco) | PRD-as-spec, AI-assisted build, runbooks, restore drill | D3 confirmed |
| Scope creep toward full SMP | Non-goals + cut line + Phase 3+ checkpoint | Commercial pricing re-validated as the benchmark |
| **NEW: OpenAI connector shape mismatch** 🔴 | Model connector contract to accommodate SCIM-shaped vendors now (capability descriptor field), zero core change later | SCIM-only finding this step |

### 9.2 Dependencies

- **OQ-SMP-1 org inventory** (which company on which Anthropic org, seats, renewal, rate, primary owner) — gates build Sprint 0 key creation.
- Primary-owner action per org to mint Analytics + scoped Admin keys.
- Contracted per-seat rate(s) (OQ-SMP-4) — gates Sprint 3 rate card; placeholders fine in specs.
- Approver per company (OQ-SMP-5) — gates go-live, not build.
- Hosting target + root holder (OQ-SMP-7).

### 9.3 Open Questions and Assumptions

- Carried: **OQ-SMP-1..10** (see `PRODUCT_BRIEF.md` §8 / `DECISION_MATRIX.md`). This step **narrows OQ-SMP-6**: if any company consumes the Claude API via Console orgs, the secondary Usage & Cost connector is additive (same VendorAccount abstraction) — confirm inventory before build Sprint 2.
- **New assumption (A-R1):** ~1,000 people across the 30 companies (PRD §15 performance NFR "30–50 companies, ~1,000 people"); exact headcount not needed for MVP sizing — pool sizes come from the org inventory.
- **New assumption (A-R2):** Claude Enterprise contract is seat-based with possible usage components (PRD A6); if fully usage-based, chargeback math shifts to metered cost (Module E covers both).
- **Design note for Step 4/9 (from SCIM finding):** connector capability descriptor should declare `provisioningProtocol: rest | scim | none` (or equivalent) so the OpenAI connector lands without core change.

---

## [10] References and Sources

**Vendor documentation (verified 2026-07-22):**
- Anthropic Admin API / User Management (beta) — platform.claude.com/docs/en/manage-claude/admin-api · /user-management
- Anthropic Analytics API — platform.claude.com/docs/en/manage-claude/analytics-api
- Anthropic Usage & Cost API (Console orgs) — platform.claude.com/docs/en/manage-claude/usage-cost-api
- Anthropic Enterprise seat rules — support.claude.com/en/articles/13393991
- Microsoft Graph `user: assignLicense` — learn.microsoft.com/en-us/graph/api/user-assignlicense · `subscribedSku` resource — learn.microsoft.com/en-us/graph/api/resources/subscribedsku
- OpenAI ChatGPT Enterprise admin quickstart + SCIM — help.openai.com/en/articles/20001264 · help.openai.com/en/articles/10011769 (SCIM FAQ) · Global Admin Console — help.openai.com/en/articles/12289294

**Market/category:**
- BetterCloud pricing + Torii-alternatives roundups — bettercloud.com/best-torii-alternatives
- SMP category roundups 2026 — spendhound.com/blog/best-saas-management-platforms · josys.com/article/saas-management-platforms · getprimo.com/blog-infos/top-10-saas-management-tools-for-smbs-in-2026 · zylo.com/blog/best-saas-spend-management-software
- Stitchflow Claude/ChatGPT user-management guides — stitchflow.com/user-management/claude-anthropic/api · /chatgpt-openai/api
- Prior: Ledger PRD v1 appendix build-vs-buy (Gartner MQ 2026, Vendr pricing), `SMP_Comparison_Torii_Zylo_Zluri_BetterCloud.xlsx`

**Reference practice:** ISO/IEC 19770 (SAM), FinOps chargeback/showback patterns, JML identity-lifecycle governance, procure-to-pay approval conventions.

---

## [11] Project Sizing Profile

### 11.0 Organization Scale Assessment

- **Organization:** QPH / "corporativo." group, Quito, Ecuador — private; ~30 operating companies + shared services under central management. Sub-brands confirmed from brand materials: Kickoff, Opina, Right Angle Media, PPM, Focus, Atis/Ketchum affiliates (media/advertising/research profile). *Factual: company count (PRD-confirmed), sub-brands (brandbook). Inferred: headcount.*
- **Employee range:** ~500–1,500 across the group (inferred from 30 companies of media/agency size + PRD's ~1,000-people performance NFR). Revenue: not available (private).
- **Geographic spread:** effectively single-city (Quito) / single-country, multi-entity.
- **IT maturity:** mid-market with centralized shared services; no SCIM/IdP today (D2); digitally capable (AI-assisted build in-house).
- **Interacting units:** all 30 companies (approvers + finance) + central finance + platform owner.

### 11.1 Scope Magnitude Assessment

- **Processes/workflows:** 9 R1 (registry, request/approval, provisioning, deprovision/reclaim, usage monitoring, pool/purchase, monthly close, reconciliation, alerting/audit) + vendor registry 🟡.
- **Integrations:** 3 live in R1 (Anthropic UM API, Anthropic Analytics API, SMTP) + 1 conditional (Console Usage & Cost, OQ-SMP-6); future: M365 Graph, OpenAI SCIM 🔴.
- **Personas/roles:** 6 (5 active R1 + MSP 🔴).
- **Screens:** ~30 R1 estimate (auth, dashboard, requests ×4, approval queue, companies ×3, people ×2, register ×2, pools, statements ×3, reconciliation, alerts ×2, admin/credentials ×3, audit, per-company scoped views).
- **Entities:** 18 (PRD §14 vendor-neutral core; its 16 table rows split Statement/StatementLine and AlertRule/AlertEvent into distinct entities).
- **Compliance:** 1 (internal audit-trail/chargeback governance; SOC 2-oriented set deferred 🔴; no GDPR/HIPAA-class regime in scope).

### 11.2 Complexity Tier Classification

**Tier: M (Medium).** Scope signals sit squarely in M (9 processes, 3–4 integrations, ~30 screens, 1 compliance); org signals are M (500–1,500 people, multi-entity but single-city, mid-market IT). Signals agree — no higher-tier override needed. Two modifiers worth stating: (a) the 30-way multi-entity chargeback + mixed-org model adds hidden coordination complexity typical of L; (b) the AI-assisted, PRD-as-spec build model and a single vendor in R1 compress delivery below M norms. Net: **M**, with a deliberately compressed schedule (see 11.3).

### 11.3 Comparable Project Benchmarks

- **Commercial SMP subscription** at this headcount: ≈ $36K–$100K+/yr (per-employee pricing) — the buy-side comparable Ledger must undercut on TCO; it does at < $100/mo hosting + internal build.
- **Custom internal workflow + chargeback tool** (approval workflow, 2–3 API integrations, reporting) at a mid-market org: typically **3–6 months, 2–4 FTEs** at conventional pace ($60K–$250K equivalent effort).
- **Ledger's plan:** ~4-week MVP + 2-week hardening with **~2 FTEs AI-assisted** (D3/D4) — aggressive vs. the conventional benchmark by design; the PRD's module ACs + orchestration-first sequencing are the risk controls that make it plausible.

### 11.4 Sizing Signals for Estimation

---SIZING_PROFILE---
complexity_tier: M
org_employee_range: "500-1500"
org_revenue_range: "not available"
org_geo_spread: "single-location"
org_it_maturity: "mid-market"
process_count: 9
integration_count: 4
persona_count: 6
screen_or_component_count: 30
entity_or_resource_count: 18
compliance_count: 1
estimated_team_size_range: "1.5-2.5 FTEs"
estimated_duration_range: "1.5-3 months"
comparable_budget_range: "15000-60000 USD"
risk_factors: ["beta_user_management_api_dependency", "multi_anthropic_org_mix_complexity", "single_developer_bus_factor", "compressed_ai_assisted_timeline", "org_inventory_unknown_blocks_sprint0", "chargeback_dispute_trust_building", "analytics_data_lag_3_days", "scope_creep_toward_full_smp", "scim_shaped_openai_connector_future", "seat_minimum_economics_per_carveout_org"]
---/SIZING_PROFILE---
