**Work item:** CHG-052
**Readiness assessment:** docs/readiness/CHG-052.json
**Approved estimate:** 110 minutes

# US-018 Split Reconciliation Implementation Plan

> **For agentic workers:** Use subagent-driven execution for independent evidence
> and gate review. This plan changes documentation and evidence only.

**Goal:** Permanently retire the four noncanonical split IDs and close US-018
from the committed delivery evidence of US-056, US-057, and US-058.

**Architecture:** Digest-bound blocked readiness artifacts act as tombstones for
US-059 through US-062. A reassessed zero-code US-018 artifact authorizes a
timestamped verification-only lifecycle whose AC events cite canonical child
evidence and whose single build event reflects the current repository.

**Spec:** `docs/superpowers/specs/2026-09-07-chg-052-us-018-split-reconciliation-design.md`

## Global Constraints

- Never create a Nous story row for US-059, US-060, US-061, or US-062.
- Change no file under `apps/` or `packages/`.
- Do not hand-edit the generated US-018 story; CHG-052's substrate hydration owns
  its eventual Notes update.
- Emit exactly four US-018 `ac_verify` events: AC1 to US-056, AC2 to US-057,
  and AC3 plus AC4 to US-058.
- Emit one US-018 `build_pass` and one `done`, all lifecycle/evidence events with
  ISO-8601 UTC timestamps.
- Run no cold campaign unless verification reveals a genuine need; never run
  more than one.
- At a task boundary, record a timestamped blocker or deviation if the remaining
  work is judged to exceed the approved estimate.

## Exact Path Budget

CHG-052 owns these nine tenant paths:

1. `.nous-feedback.jsonl`
2. `docs/readiness/CHG-052.json`
3. `docs/readiness/US-018.json`
4. `docs/readiness/US-059.json`
5. `docs/readiness/US-060.json`
6. `docs/readiness/US-061.json`
7. `docs/readiness/US-062.json`
8. `docs/superpowers/specs/2026-09-07-chg-052-us-018-split-reconciliation-design.md`
9. `docs/superpowers/plans/2026-09-07-chg-052-us-018-split-reconciliation.md`

### Task 1: Retire US-059 Through US-062

- [ ] Replace each artifact's executable outcome with an explicit historical
  tombstone that names its canonical replacement delivery.
- [ ] Set each decision to `blocked`, retain one unresolved permanent
  supersession condition, and bind `controlling_change` to CHG-052.
- [ ] Compute each digest and append one human-approved controlling-change
  decision record per subject.
- [ ] Run each individual readiness check and confirm it reports the expected
  blocked decision rather than valid/ready.

### Task 2: Reassess US-018 as Verification-Only

- [ ] Preserve O1 and AC1 through AC4 while reducing scope and signals to
  evidence verification only, including zero mutation shards.
- [ ] Resolve child-delivery provenance explicitly in the uncertainty record.
- [ ] Compute the new digest, bind approval through CHG-052, and validate the
  assessment as ready.
- [ ] Record the sole timestamped US-018 lifecycle `started` event.

### Task 3: Verify the Four Acceptance Criteria

- [ ] Verify AC1 from US-056's committed transport evidence and focused tests.
- [ ] Verify AC2 from US-057's committed journal evidence and focused tests.
- [ ] Verify AC3 and AC4 from US-058's conformance, Pact, review, and mutation
  evidence.
- [ ] Obtain independent specification and evidence-quality review; repair every
  material gap before integration.
- [ ] Append exactly four timestamped `ac_verify` events citing concrete child
  commits and evidence.

### Task 4: Integrate and Close

- [ ] Run `pnpm check` once on the reviewed tree; append one timestamped
  `build_pass` for the verified commit.
- [ ] Fill US-018 actuals from the CHG-052 reconciliation range, with zero cold
  mutation attempts and an evidence-based root cause.
- [ ] Append one timestamped `done` event and commit the closure.
- [ ] Pull feedback into Nous, render the US-018 timeline, and confirm it shows
  `started`, four `ac_verify`, one `build_pass`, one `done`, with `dev_done`.
- [ ] Confirm US-019 is no longer blocked by US-018.
