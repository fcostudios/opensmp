**Work item:** CHG-062
**Readiness assessment:** docs/readiness/CHG-062.json
**Approved estimate:** 60 minutes

# CHG-062 — readiness gate accepts the delivered feedback vocabulary — Implementation Plan

**Goal:** the DoD delivered on 2026-10-01 asks agents to emit `phase` markers (IMP-411) and allows
`cost` on `done` (IMP-412). The gate rejected both (`WR_FEEDBACK_INVALID`, `WR_APPROVAL_EVENT_UNKNOWN`)
because its event set and `done` keys are hardcoded. Make both acceptable; change nothing else.

**Changes (three files):**
1. `scripts/work-readiness/git.mjs` — `KNOWN_FEEDBACK_EVENTS` becomes the union of today's set and the
   names in `docs/dev-guide/feedback-vocabulary.json` → `canonical`. `validDone` accepts an optional
   `cost` object: `calls`, `context_tokens` required non-negative integers; `model` string; `window`,
   `output_tokens` non-negative integers; no other keys.
2. `scripts/work-readiness/model.mjs` — `isKnownFeedbackEvent` also accepts those canonical names, as
   non-execution events (they never authorize implementation evidence).
3. `scripts/test-work-readiness.mjs` — behavioural tests for both ACs.

**Out of scope:** any other gate rule, the vocabulary file itself (Nous-owned), DoD wording.

**Verification:** AC1 — a range committing a `phase` marker validates; an invented event is still
rejected. AC2 — `done` with a well-formed `cost` and without `cost` are valid terminals; `cost.calls`
as a string is not. `pnpm test:work-readiness`, `pnpm test:feedback-order`, then `pnpm check`.
