# 13 — Risk Register: Ledger (`fcostudios__smp`)

**Step:** 13 — Risk · **Date:** 2026-07-22 · Consolidates PRD §18, `01_research` §9, sizing risk_factors, `10_plan` SEC1/SEC2 into the single build-team register.

| # | Risk | L×I | Mitigation (owned) | Trigger/monitor |
|---|---|---|---|---|
| R1 | Beta UM API changes/regresses | M×H | US-054 week-1 probe; orchestration permanent (DEC-SMP-007, US-020 ships wk 2); raw payloads for replay; version/beta headers in one module (ADR-05) | Probe deltas; provider release notes |
| R2 | Velocity assumption fails (6-wk floor) | M×M | Replan trigger (<25 SP Sprint 1 → 1.5-wk sprints); Step-11 prices the 7–9-wk band; Sprint-5/6 FTE reserves | Sprint-1 actuals |
| R3 | Sprint-3 slip cascades into money milestone | M×M | Documented fallback: license-line-only close path (no analytics dependency); milestone split money-core/money-complete | Sprint-3 burndown |
| R4 | First close doesn't reconcile (data quality of backfill/rates) | M×H | US-052 on the most recent full month; variance triage into ReconciliationVarianceLines; OQ-SMP-4 rates gate before US-052 | Parallel-close variance |
| R5 | Company-isolation defect (highest-severity class, PRD §15) | L×H | BR-22 critical; US-047 CI isolation suite is a go-live gate; viewer read-only | Suite failures |
| R6 | Register integrity regression | L×H | BR-01/02/28 DB-level (EXCLUDE, trigger, grants) + US-003 rejection tests; close re-verification | Migration CI |
| R7 | Approver non-adoption (A-J1) | M×M | One-card queue + aging/escalation + GA override; Sprint-2 pilot with 3–5 companies | Decision latency telemetry |
| R8 | Finance rejects first numbers (A-J2) | M×H | Traceability drill-downs (line→register→raw payload); US-052 comparison vs manual process before go-live | Dispute count at first close |
| R9 | Drift persists (console bypass) | M×M | Hourly sync + claim tasks; console access restricted to GA; drift metric on dashboard (target 0) | register_drift alerts |
| R10 | Bus factor (2-person team) | M×M | Specs-as-source (this pipeline); runbooks + restore drill in Sprint 4 (US-048/053); AI-assisted redundancy | — |
| R11 | Keycloak outage locks everyone out | L×M | Break-glass contract (ADR-03): sealed one-time secret, TOTP enforced, audited, auto-disable; runbook in US-048 | Keycloak healthcheck |
| R12 | Calendar slip on go-live (month-boundary dependency) | M×M | Calendar anchor stated in plan SEC1; go-live honestly dated end-Sprint-6…wk 8–9 | Anchor month confirmation |
| R13 | Scope creep toward full SMP | M×M | Non-goals + R2 fence (no R1 stories) + Phase-3 build-vs-buy checkpoint | Backlog intake |
| R14 | Substrate defect IMP-330 (cross-tenant story resolution) taints local ready-checks | M×L | Filed with repro; smp evidence carried by mechanical checks until fixed; avoid trusting per-story ready-checks that read dev-package paths on this machine | IMP-330 status |
