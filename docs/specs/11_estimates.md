# 11 — Estimates: Ledger (`fcostudios__smp`)

**Step:** 11 — Estimates · **Date:** 2026-07-22 · Consolidates `10_plan.md` (SEC1 pricing directives) + `extracts/01_research_sizing.json`. No new analysis — the plan already carries the estimating substance; this page is the priced statement of it.

## R1 (MVP → go-live)

- **Scope:** 55 stories · 155 SP · 5 story-sprints + go-live reserve.
- **Duration:** **6 weeks best-case (floor), 7–9 weeks expected band** (Step-1 sizing: 1.5–3 months AI-assisted vs 3–6 months conventional tier-M comparable). Replan trigger: Sprint-1 actuals < 25 SP → re-baseline to 1.5-week sprints.
- **Effort:** 2 AI-assisted FTEs × 6–9 weeks = **12–18 FTE-weeks**, where: Sprints 1–4 priced by SP/velocity except Sprint 4 (serial close chain → price by duration, ≈1.5 effective FTE); weeks 5–6 priced as FTE-time reserves (Sprint 5 stories + ~1 FTE-wk parallel-run reserve; Sprint 6 = 1 FTE-wk go-live reserve).
- **Cost (internal, indicative):** at a blended internal rate R/FTE-week, R1 = 12–18 × R. Against the Step-1 comparable band (USD 15–60K equivalent effort) the plan sits at the lower half given AI-assist. Hosting: < USD 100/mo (ADR-11); Keycloak/pg-boss/Postgres self-hosted — no new SaaS line items.
- **External gates that move dates, not effort:** OQ-SMP-1 (keys), OQ-SMP-4 (rates), OQ-SMP-7 (hosting root), calendar anchor for US-052.

## R2 (fast-follow, weeks +2–4 after go-live)

12 features (FEAT-R2-01..12). Estimate **20–30 SP ≈ 3–4 FTE-weeks** — mostly config/UI increments on shipped primitives (delegation windows, budget alerts, digests, registry CRUD, SSO = Keycloak realm config per DEC-SMP-014).

## R3+ (Phase 3, priced per PRD discipline)

- M365 connector: ≤ 2 wks/1 engineer (NFR bound, interface proven by connector #1); OpenAI = SCIM client, similar bound; SAP B1 = registry-only (no connector).
- Connector run-cost discipline: ~USD 16K/yr maintenance baseline per live connector (PRD v1 analysis) — add connectors by spend concentration only.
- Build-vs-buy checkpoint: re-compare against commercial SMP pricing (USD 36–100K+/yr at group headcount) when vendor count grows.

## Confidence & caveats

Point-estimate confidence is deliberately NOT claimed: the 6-week figure is a floor under an unvalidated velocity assumption; the honest deliverable date is the band. Single largest schedule risk remains the beta UM API (mitigated: US-054 probe week 1; orchestration fallback permanent per DEC-SMP-007).
