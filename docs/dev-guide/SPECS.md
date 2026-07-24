# Specs — the design context behind this codebase

This package ships the **complete product-design spec set** the Nous pipeline
produced for this project. When you have an implementation question ("why is it
modelled this way?", "what's the intended flow?", "what are the NFRs?"), the
answer almost always already exists here — read it before guessing or asking.

## Where everything is

All specs live in **[`docs/specs/`](../specs/)**. Start with the catalog:
**[`docs/specs/INDEX.md`](../specs/INDEX.md)** — every delivered spec with a
one-line description (auto-generated, always current).

Related guides: [`NAVIGATION.md`](NAVIGATION.md) (routes & screens),
[`COMMITS.md`](COMMITS.md) (commit conventions).

## What's delivered, and which spec answers which question

| You're asking about… | Read |
|---|---|
| Market / competitors / AI-RAG rationale | `01_research.md` |
| Who the users are, their goals | `02_cx_personas.md` |
| The flows users go through (AS-IS / TO-BE) | `03_cx_journeys.md` |
| Data model, entities, bounded contexts | `04_er_model.md` |
| Colors, typography, brand voice | `05_brand.md` |
| Components, design tokens, WCAG/a11y | `06_design_system.md` |
| Screens & their specs | `07_screens.md`, `docs/screens/*.json` |
| The full feature backlog | `07b_features_backlog.md` |
| **Routes / screens / flows (source of truth)** | `07c_navigation_map.json` |
| User stories & acceptance criteria | `08_scope.md`, `docs/stories/` |
| Architecture, DDD contexts, NFRs | `09_architecture.md` |
| Sprints & roadmap | `10_plan.md` |
| Estimates / QA (proofread, risk, legal) | `11_estimates.md`, `12_proofread.md`, `13_risk.md`, `14_legal.md` *(if present)* |
| How/why a decision was made | `docs/decisions/`, tech-specs & design docs in `docs/specs/` |

Design docs, tech specs, sprint plans, and QA verifications are also in
`docs/specs/` (see the second table in `INDEX.md`) — useful for the "why" behind
a feature or a past change.

## Searching the specs

The specs are plain markdown + JSON, so any tool works. Two good options:

**1. grep / ripgrep (no setup):**

```bash
rg -i "forecast approval" docs/specs/
rg -l "nfr|non-functional" docs/specs/
```

**2. QMD semantic search** (if you use [`qmd`](https://) — better recall on
"how does X work" questions). Index this package's specs once, then query:

```bash
qmd collection add docs/specs --name <your-project-name>   # index docs/specs/ as a collection
qmd query  "how does the approval lifecycle work" -c <your-project-name>   # semantic
qmd search "DEC-012 audit"                            -c <your-project-name>   # lexical / BM25
qmd ls <your-project-name>                            # list indexed docs
```

Run `qmd --help` for the full command surface. (No collection ships in the
package — you create one locally over `docs/specs/`.)

## When the specs and the code disagree

The specs are the **intended** design; the code is reality. If you find a
genuine mismatch, that's a signal — surface it (it may be a spec gap to feed
back, or a code deviation to fix), don't silently diverge. The Nous side runs a
drift detector that reconciles the two.
