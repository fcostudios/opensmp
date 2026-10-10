**Work item:** CHG-070
**Readiness assessment:** docs/readiness/CHG-070.json
**Approved estimate:** 120 minutes

# CHG-070 measured experiment closure plan

**Goal:** Record the measured US-072 session experiment, apply the approved decision rule, and close CHG-070 with truthful cost and audit evidence.

**Spec:** `docs/readiness/CHG-070.json`, outcome O1 and resolutions U1–U7; existing decision handoff in `docs/superpowers/plans/2026-10-10-us-072-usage-surface.md`.

**Authority and chronology:** Francisco approved readiness payload `5590fc225a254b040de8f4e6138b9818b3077b6e9a928e49aca3b55bcb9bf4b5` in `CHG070-READINESS-20261010`. His latest instruction explicitly authorizes measuring the child, applying the rule, writing Session shape, closing US-072 then CHG-070, and handing both to Nous for independent measurement and delivery. This closure-only plan is recorded on October 10 after the local terminal evidence and the rejected closure commit exposed the missing parent-tree plan binding. It documents the authorized remaining commit and correction work; it does not claim that this plan existed or received separate approval before the experiment.

**Architecture:** The controller records decision and evidence; a fresh reviewer performs the bounded checks. The child candidate `3ae2d18`, experiment base `25c37cd`, and child completion `cc351f4` remain frozen. No product source, tests, migrations, executable tooling, dependencies, or generated Nous documents change.

## Global constraints

- Keep all changes within the approved parent outcome. Do not start US-073 or US-074.
- Retain fixed 143M input-token and 230-minute baselines, 110M / 265-minute adoption thresholds, mutation score at least 80, one campaign, and at most five review-fix loops. Apply U7 if the mutation clause misses.
- Write the default and measured decision only beneath the existing `WORK_READINESS.md` Session shape heading; add or rename no headings there.
- Distinguish transcript measurements, estimates, cached input subsets, and cumulative-advance call proxies. Keep parent and child costs separate.
- The latest user closing sequence places Nous independent transcript measurement and delivery after local closure. Record the earlier 20% agreement requirement as a pending handoff audit; claim no completed agreement.
- Preserve every feedback byte and the raw terminal actuals. Added repair time, cost, ninth parent path, and ninth parent commit require a complete append-only `actuals_corrected` replacement.
- The commit hook remains enabled. Commit this readiness-bound planning document separately before committing the Session shape implementation and closure evidence.

## Task 1: Bind and commit the authorized remaining closure procedure

**Files:** Create this plan only in the planning commit. Preserve the staged closure files without including them in that commit.

- [ ] Have the delegated reviewer inspect this header, approved readiness binding, and exact closure scope.
- [ ] Unstage the three parent closure files, stage only this plan, and commit with `docs(CHG-070): bind the measured closure procedure`.
- [ ] Stage only `docs/dev-guide/WORK_READINESS.md` and commit the reviewed decision with `docs(CHG-070): adopt the measured session shape`. The immutable parent ledger remains nonterminal for this implementation-class commit.
- [ ] Restage only `.nous-feedback.jsonl` and `docs/readiness/CHG-070.json` for the documentation-class terminal evidence commit. Do not rewrite their historical evidence. A combined Session shape and terminal commit would make candidate readiness inactive and fail the implementation guard.

## Task 2: Retain the measured decision and correct additional closure costs

**Files:** Modify `.nous-feedback.jsonl` by append only; retain immutable raw `docs/readiness/CHG-070.json` actuals; retain the approved Session shape amendment in `docs/dev-guide/WORK_READINESS.md`.

- [ ] Verify child totals: 92 active minutes, 65,719,234 measured input plus 535,000 estimated closing input, 93.643% mutation score (383 killed / 26 survived), one cold campaign, four loops, four previews totaling 14.0161 minutes.
- [ ] Retain the ADOPT decision, normalization, session counts, source/manifest provenance, and honest accepted ID63 selection gap already reviewed under AC1 and AC2.
- [ ] Measure the extra plan-repair and review intervals and costs. Append an `actuals_corrected` event at its actual UTC timestamp, naming `change: CHG-070`, a unique ref, the canonical SHA-256 of the currently effective actuals, and the complete replacement object. Its file count is 9 and commit count is 9: six historical commits, this planning commit, the Session shape commit, and the terminal evidence commit. The existing unique `CHG070-READINESS-20261010` self-bound approved decision supplies the correction authority; do not create a replacement approval. The correction's phase sum, variance, cost explanation, and provenance must agree; mutation and preview counts remain zero for the parent.
- [ ] Append a readable feedback annotation explaining the rejected hook, missing prior plan, corrective planning commit, retained raw terminal, and pending Nous audit. No new readiness approval or work item is invented.

## Task 3: Verify and commit closure, then hand off

**Files:** Review the two terminal evidence files and the prior committed plan and Session shape amendment.

- [ ] Delegate `rtk pnpm readiness:check -- CHG-070`, `rtk pnpm readiness:check -- US-072`, and `rtk pnpm test:feedback-order`; require exit 0. Retain the already green `pnpm lint` (8/8 cached) and `pnpm check:generated-guidance` evidence because their inputs remain unchanged.
- [ ] Have the fresh reviewer inspect effective correction arithmetic, canonical hash and authority, append-only feedback prefix, unchanged heading sequence, branch `chg-070`, and unchanged scored source/tests and `testing/critical-paths.md`. Run no full gate or mutation campaign for this documentation repair.
- [ ] Commit the closure with the ordinary enabled hook and a CHG-070 reference. If the hook rejects, report its exact rule and resolve only within authorized parent scope.
- [ ] Tell Francisco that local US-072 and CHG-070 closure is complete and Nous must independently measure transcripts and deliver both. Do not send a message to another person unless explicitly authorized.

## Self-review

AC1 is covered by Task 2's measured rule, protocol, costs, and pending audit; AC2 by the confined Session shape amendment and Task 3 checks. The plan adds no product behavior or acceptance outcome. The new planning commit remedies the concrete immutable-parent binding requirement and records its actual late chronology.
